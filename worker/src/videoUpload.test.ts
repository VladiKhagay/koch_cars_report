import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from './index';
import { MAX_VIDEO_BYTES, MAX_VIDEO_PARTS, VIDEO_PART_BYTES } from './upload';
import { handleVideoAbort, handleVideoComplete, handleVideoPart, handleVideoStart } from './videoUpload';

/*
 * The resumable video endpoints against an in-memory R2. resumeMultipartUpload
 * validates nothing (documented). Everything the fake does when an upload is
 * wrong or finished is an ASSUMPTION until SECURITY-NOTES §4's live check: it
 * throws an R2Error with code 10024 on uploadPart, complete AND abort. Miniflare
 * does that only for uploadPart; for complete/abort under a wrong key it throws
 * InternalError, which the handlers treat as transient (complete) or swallow (abort).
 */

/* Canonical (lowercase 8-4-4-4-12) job ids, as Postgres prints them. */
const J1 = 'aaaaaaaa-1111-4111-8111-bbbbbbbbbbbb';
const J2 = 'cccccccc-2222-4222-8222-dddddddddddd';

const MP4_HEAD = [0, 0, 0, 0x1c, ...[...'ftypisom'].map((c) => c.charCodeAt(0))];

function piece(size: number, head: number[] = MP4_HEAD): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return bytes;
}

const r2Error = (code: number) => Object.assign(new Error('x'), { code });

type Upload = { key: string; contentType: string; parts: Map<number, number> };

function fakeBucket() {
  const uploads = new Map<string, Upload>();
  const objects = new Map<string, { size: number; etag: string }>();
  const calls: string[] = [];
  let seq = 0;

  function handle(key: string, uploadId: string) {
    // ASSUMPTION (S3-like, unverified live until SECURITY-NOTES §4's check): an
    // uploadId only works under the key it was created for, and a wrong key or
    // unknown uploadId throws 10024 on uploadPart, complete and abort alike.
    // Miniflare throws 10024 only for uploadPart (InternalError for complete/abort).
    const live = () => {
      const u = uploads.get(uploadId);
      if (!u || u.key !== key) throw r2Error(10024);
      return u;
    };
    return {
      key,
      uploadId,
      async uploadPart(n: number, bytes: Uint8Array) {
        calls.push(`uploadPart ${n}`);
        live().parts.set(n, bytes.byteLength);
        return { partNumber: n, etag: `e${n}` };
      },
      async complete(parts: { partNumber: number; etag: string }[]) {
        calls.push('complete');
        const u = live();
        if (parts.some((p) => u.parts.get(p.partNumber) === undefined || p.etag !== `e${p.partNumber}`)) {
          throw r2Error(10025);
        }
        const size = parts.reduce((sum, p) => sum + u.parts.get(p.partNumber)!, 0);
        uploads.delete(uploadId);
        const object = { key, size, etag: `h-${parts.length}` };
        objects.set(key, object);
        return object;
      },
      async abort() {
        calls.push('abort');
        live();
        uploads.delete(uploadId);
      },
    };
  }

  return {
    uploads,
    objects,
    calls,
    bucket: {
      async createMultipartUpload(key: string, opts: { httpMetadata: { contentType: string } }) {
        calls.push('create');
        const uploadId = `up-${++seq}`;
        uploads.set(uploadId, { key, contentType: opts.httpMetadata.contentType, parts: new Map() });
        return handle(key, uploadId);
      },
      resumeMultipartUpload(key: string, uploadId: string) {
        calls.push('resume');
        return handle(key, uploadId);
      },
      async head(key: string) {
        calls.push('head');
        return objects.get(key) ?? null;
      },
      async delete(key: string) {
        calls.push('delete');
        objects.delete(key);
      },
    },
  };
}

let r2: ReturnType<typeof fakeBucket>;
let limiterOk = true;
let startLimiterOk = true;
let startLimiterCalls = 0;
/** Spread over the stub env: e.g. a binding set to undefined, as in a deploy that forgot it. */
let envOverride: Record<string, unknown> = {};

/** The ctx-stub pattern from upload.test.ts. contentLength: omitted = the body's real length, null = header absent. */
function call(
  handler: (c: never) => unknown,
  query: Record<string, string>,
  body: Uint8Array | string | null = null,
  contentLength?: string | null,
) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const headers: Record<string, string | undefined> = {
    authorization: 'Bearer caller',
    'content-length': contentLength === undefined ? (bytes ? String(bytes.byteLength) : undefined) : (contentLength ?? undefined),
  };
  const ctx = {
    env: {
      SUPABASE_URL: 'https://sb.test',
      SUPABASE_ANON_KEY: 'anon',
      UPLOAD_LIMITER: { limit: async () => ({ success: limiterOk }) },
      VIDEO_START_LIMITER: {
        limit: async () => {
          startLimiterCalls++;
          return { success: startLimiterOk };
        },
      },
      PHOTOS: r2.bucket,
      ...envOverride,
    },
    get: () => ({ sub: 'user-1' }),
    req: {
      query: (k: string) => query[k],
      header: (k: string) => headers[k.toLowerCase()],
      raw: { body: bytes ? new Blob([bytes as Uint8Array<ArrayBuffer>]).stream() : null },
    },
    json: (data: unknown, status = 200) => ({ data, status }),
  };
  return handler(ctx as never) as Promise<{ data: Record<string, unknown>; status: number }>;
}

const start = (jobId: string, bytes: Uint8Array) => call(handleVideoStart, { jobId }, bytes);
const part = (jobId: string, uploadId: string, n: number | string, bytes: Uint8Array) =>
  call(handleVideoPart, { jobId, uploadId, partNumber: String(n) }, bytes);
const complete = (jobId: string, uploadId: string, parts: unknown) =>
  call(handleVideoComplete, { jobId, uploadId }, JSON.stringify({ parts }));
const abort = (jobId: string, uploadId: string) => call(handleVideoAbort, { jobId, uploadId });

const P = VIDEO_PART_BYTES;

describe('video upload endpoints', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    r2 = fakeBucket();
    limiterOk = true;
    startLimiterOk = true;
    startLimiterCalls = 0;
    envOverride = {};
    fetchSpy = vi.fn(async () => Response.json(true));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('start -> part -> complete stores video/{jobId} under the sniffed type', async () => {
    const s = await start(J1, piece(P));
    expect(s).toEqual({ status: 200, data: { uploadId: 'up-1', etag: 'e1' } });
    expect(r2.uploads.get('up-1')).toMatchObject({ key: `video/${J1}`, contentType: 'video/mp4' });

    expect(await part(J1, 'up-1', 2, piece(1000, []))).toEqual({ status: 200, data: { etag: 'e2' } });
    const done = await complete(J1, 'up-1', [
      { partNumber: 1, etag: 'e1' },
      { partNumber: 2, etag: 'e2' },
    ]);
    expect(done).toEqual({ status: 200, data: { key: `video/${J1}` } });
    expect(r2.objects.get(`video/${J1}`)).toMatchObject({ size: P + 1000 });
  });

  it('asks can_write_photo about the video slot on every call', async () => {
    await start(J1, piece(100));
    await part(J1, 'up-1', 2, piece(100, []));
    await complete(J1, 'up-1', [{ partNumber: 1, etag: 'e1' }, { partNumber: 2, etag: 'e2' }]);
    await abort(J1, 'up-1');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    for (const [url, init] of fetchSpy.mock.calls as [string, RequestInit][]) {
      expect(url).toBe('https://sb.test/rest/v1/rpc/can_write_photo');
      expect(JSON.parse(init.body as string)).toEqual({ p_job_id: J1, p_kind: 'video' });
    }
  });

  it('piece 1 goes only through start', async () => {
    expect((await part(J1, 'up-1', 1, piece(100))).status).toBe(400);
  });

  it.each([MAX_VIDEO_PARTS + 1, 0, 'abc', '2.5'])('partNumber %j is refused', async (n) => {
    expect(MAX_VIDEO_PARTS).toBe(10);
    expect((await part(J1, 'up-1', n, piece(100))).status).toBe(400);
    expect(r2.calls).toEqual([]);
  });

  it('refuses a piece over 8 MiB, declared or counted', async () => {
    expect((await start(J1, piece(P + 1))).status).toBe(413);
    expect((await call(handleVideoPart, { jobId: J1, uploadId: 'u', partNumber: '2' }, piece(P + 1), '10')).status).toBe(
      413,
    );
    expect(r2.calls).toEqual([]);
  });

  it('refuses an empty piece', async () => {
    expect((await call(handleVideoStart, { jobId: J1 }, null)).status).toBe(400);
  });

  it('refuses a non-video first piece with 415, before opening an upload', async () => {
    expect((await start(J1, piece(100, [0xff, 0xd8, 0xff, 0xe0]))).status).toBe(415);
    expect(r2.calls).toEqual([]);
  });

  it('403 on every route when can_write_photo says no, with no R2 call', async () => {
    vi.stubGlobal('fetch', async () => Response.json(false));
    expect((await start(J1, piece(100))).status).toBe(403);
    expect((await part(J1, 'up-1', 2, piece(100))).status).toBe(403);
    expect((await complete(J1, 'up-1', [{ partNumber: 1, etag: 'e1' }])).status).toBe(403);
    expect((await abort(J1, 'up-1')).status).toBe(403);
    expect(r2.calls).toEqual([]);
  });

  it('429 when rate limited, before asking Postgres', async () => {
    limiterOk = false;
    expect((await start(J1, piece(100))).status).toBe(429);
    expect((await part(J1, 'up-1', 2, piece(100))).status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r2.calls).toEqual([]);
  });

  /* ASSUMPTION (S3-like, see fakeBucket): verified live only by SECURITY-NOTES §4's check. */
  it("another job's uploadId is refused as gone", async () => {
    await start(J1, piece(100));
    expect(await part(J2, 'up-1', 2, piece(100, []))).toEqual({ status: 410, data: { error: 'upload_gone' } });
    expect((await complete(J2, 'up-1', [{ partNumber: 1, etag: 'e1' }])).status).toBe(410);
  });

  it('deletes an over-75MB result and answers 413', async () => {
    await start(J1, piece(P));
    const parts = [{ partNumber: 1, etag: 'e1' }];
    for (let n = 2; n <= MAX_VIDEO_PARTS; n++) {
      await part(J1, 'up-1', n, piece(P, []));
      parts.push({ partNumber: n, etag: `e${n}` });
    }
    expect(MAX_VIDEO_PARTS * P).toBeGreaterThan(MAX_VIDEO_BYTES);
    expect((await complete(J1, 'up-1', parts)).status).toBe(413);
    expect(r2.objects.has(`video/${J1}`)).toBe(false);
    expect(r2.calls).toContain('delete');
  });

  it('a retried complete whose first response was lost answers 200 via head()', async () => {
    await start(J1, piece(P));
    await part(J1, 'up-1', 2, piece(500, []));
    const parts = [{ partNumber: 1, etag: 'e1' }, { partNumber: 2, etag: 'e2' }];
    expect((await complete(J1, 'up-1', parts)).status).toBe(200);
    expect(await complete(J1, 'up-1', parts)).toEqual({ status: 200, data: { key: `video/${J1}` } });
    expect(r2.calls).toContain('head');
  });

  it('a gone upload with no matching object answers 410', async () => {
    expect((await complete(J1, 'nope', [{ partNumber: 1, etag: 'e1' }])).status).toBe(410);
    // An object from a different upload (wrong part count) is not taken as this one.
    r2.objects.set(`video/${J1}`, { size: 100, etag: 'h-1' });
    expect((await complete(J1, 'nope', [{ partNumber: 1, etag: 'e1' }, { partNumber: 2, etag: 'e2' }])).status).toBe(410);
  });

  it('a part list R2 rejects answers 410', async () => {
    await start(J1, piece(100));
    expect((await complete(J1, 'up-1', [{ partNumber: 1, etag: 'wrong' }])).status).toBe(410);
  });

  it.each([
    [[]],
    [[{ partNumber: 2, etag: 'e2' }]],
    [[{ partNumber: 1, etag: '' }]],
    [[{ partNumber: 1 }]],
    ['nope'],
  ])('a malformed part list %j is a 400 with no R2 call', async (parts) => {
    expect((await complete(J1, 'up-1', parts)).status).toBe(400);
    expect(r2.calls).toEqual([]);
  });

  it('a non-JSON complete body is a 400', async () => {
    expect((await call(handleVideoComplete, { jobId: J1, uploadId: 'up-1' }, 'not json')).status).toBe(400);
  });

  it('aborting an upload R2 no longer has is fine', async () => {
    expect((await abort(J1, 'unknown')).status).toBe(200);
    await start(J1, piece(100));
    expect((await abort(J1, 'up-1')).status).toBe(200);
    expect(r2.uploads.size).toBe(0);
  });

  it('rethrows an R2 error that is not about the upload (transient for the client)', async () => {
    r2.bucket.resumeMultipartUpload = () => ({
      uploadPart: async () => {
        throw r2Error(10001);
      },
    }) as never;
    await expect(part(J1, 'up-1', 2, piece(100))).rejects.toThrow('x');
  });

  /* Every R2 call on a resumed upload throws this code. */
  const failWith = (code: number) => {
    const fail = async () => {
      throw r2Error(code);
    };
    r2.bucket.resumeMultipartUpload = () => ({ uploadPart: fail, complete: fail, abort: fail }) as never;
  };
  const twoParts = [{ partNumber: 1, etag: 'e1' }, { partNumber: 2, etag: 'e2' }];

  it.each([10048, 10011])('R2 code %i on part and complete answers 410', async (code) => {
    failWith(code);
    expect(await part(J1, 'up-1', 2, piece(100))).toEqual({ status: 410, data: { error: 'upload_gone' } });
    expect(await complete(J1, 'up-1', twoParts)).toEqual({ status: 410, data: { error: 'upload_gone' } });
  });

  it('a gone code from start answers 410', async () => {
    const create = r2.bucket.createMultipartUpload;
    r2.bucket.createMultipartUpload = async (key, opts) => ({
      ...(await create(key, opts)),
      uploadPart: async () => {
        throw r2Error(10025);
      },
    });
    expect(await start(J1, piece(100))).toEqual({ status: 410, data: { error: 'upload_gone' } });
  });

  /* Piece 1 failing leaves an upload only this request knows of: it is aborted, and the error still maps/rethrows. */
  it.each([
    [10025, 'mapped to 410'],
    [10001, 'rethrown'],
  ])('a failed piece 1 (R2 %i) aborts the new upload, error %s', async (code) => {
    const abortSpy = vi.fn(async () => {
      throw r2Error(10001); // an abort failure must not mask the original error
    });
    const create = r2.bucket.createMultipartUpload;
    r2.bucket.createMultipartUpload = async (key, opts) => ({
      ...(await create(key, opts)),
      uploadPart: async () => {
        throw r2Error(code);
      },
      abort: abortSpy,
    });
    if (code === 10025) expect(await start(J1, piece(100))).toEqual({ status: 410, data: { error: 'upload_gone' } });
    else await expect(start(J1, piece(100))).rejects.toMatchObject({ code });
    expect(abortSpy).toHaveBeenCalledOnce();
  });

  /* The idempotency check runs on any R2 error: the code a finished upload gets is an assumption. */
  it('complete failing with an unexpected code after the object is stored answers 200', async () => {
    r2.objects.set(`video/${J1}`, { size: P + 500, etag: 'h-2' });
    failWith(10001);
    expect(await complete(J1, 'up-1', twoParts)).toEqual({ status: 200, data: { key: `video/${J1}` } });
  });

  it('complete failing with an unexpected code and no matching object is rethrown (500)', async () => {
    failWith(10001);
    await expect(complete(J1, 'up-1', twoParts)).rejects.toThrow('x');
    r2.objects.set(`video/${J1}`, { size: P + 500, etag: 'h-3' }); // another upload's object
    await expect(complete(J1, 'up-1', twoParts)).rejects.toThrow('x');
  });

  it.each([
    ['too small for 2 parts', 2, P],
    ['too big for 2 parts', 2, 2 * P + 1],
    ['over the video limit', 10, MAX_VIDEO_BYTES + 1],
  ])('a stored object %s is not taken as this complete (410)', async (_why, n, size) => {
    expect(9 * P < MAX_VIDEO_BYTES + 1 && MAX_VIDEO_BYTES + 1 <= 10 * P).toBe(true);
    r2.objects.set(`video/${J1}`, { size, etag: `h-${n}` });
    failWith(10024);
    const parts = Array.from({ length: n }, (_, i) => ({ partNumber: i + 1, etag: `e${i + 1}` }));
    expect((await complete(J1, 'up-1', parts)).status).toBe(410);
  });

  it('abort answers 200 whatever R2 says, and logs anything but "already gone"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      failWith(10024);
      expect(await abort(J1, 'up-1')).toEqual({ status: 200, data: { ok: true } });
      expect(warn).not.toHaveBeenCalled();
      failWith(10001);
      expect(await abort(J1, 'up-1')).toEqual({ status: 200, data: { ok: true } });
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it('a part with no Content-Length is counted while read: over the cap 413, within it stored', async () => {
    const query = { jobId: J1, uploadId: 'up-1', partNumber: '2' };
    expect((await call(handleVideoPart, query, piece(P + 1, []), null)).status).toBe(413);
    expect(r2.calls).toEqual([]);
    await start(J1, piece(100));
    expect(await call(handleVideoPart, query, piece(100, []), null)).toEqual({ status: 200, data: { etag: 'e2' } });
    expect(r2.uploads.get('up-1')?.parts.get(2)).toBe(100);
  });

  /* Each start parks an R2 upload, so start has its own, tighter limit. */
  it('start answers 429 when VIDEO_START_LIMITER refuses, before Postgres or R2', async () => {
    startLimiterOk = false;
    expect(await start(J1, piece(100))).toEqual({ status: 429, data: { error: 'rate_limited' } });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r2.calls).toEqual([]);
  });

  it('only start uses VIDEO_START_LIMITER', async () => {
    startLimiterOk = false;
    await r2.bucket.createMultipartUpload(`video/${J1}`, { httpMetadata: { contentType: 'video/mp4' } });
    expect((await part(J1, 'up-1', 2, piece(100, []))).status).toBe(200);
    expect((await complete(J1, 'up-1', [{ partNumber: 1, etag: 'e2' }])).status).not.toBe(429);
    expect((await abort(J1, 'up-1')).status).toBe(200);
    expect(startLimiterCalls).toBe(0);
    await start(J1, piece(100));
    expect(startLimiterCalls).toBe(1);
  });

  /* Fail closed: a deploy missing a limiter binding is a 500 (Hono's onError), never an unlimited route. */
  it.each(['VIDEO_START_LIMITER', 'UPLOAD_LIMITER'])('start with %s unbound throws, before Postgres or R2', async (name) => {
    envOverride = { [name]: undefined };
    await expect(start(J1, piece(100))).rejects.toThrow(TypeError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r2.calls).toEqual([]);
  });

  /* Postgres takes these spellings as the same row, but they would name a different R2 key. */
  it.each([J1.toUpperCase(), `{${J1}}`, J1.replaceAll('-', ''), 'job-1', ''])(
    'a non-canonical jobId %j is a 400 on every route, with no Postgres or R2 call',
    async (jobId) => {
      expect((await start(jobId, piece(100))).status).toBe(400);
      expect((await part(jobId, 'up-1', 2, piece(100))).status).toBe(400);
      expect((await complete(jobId, 'up-1', twoParts)).status).toBe(400);
      expect((await abort(jobId, 'up-1')).status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(r2.calls).toEqual([]);
    },
  );

  /* The key is derived from jobId only; a client-supplied key must be ignored on every route. */
  it('ignores a client-supplied ?key= on start, part and complete', async () => {
    const key = `video/${J2}`;
    expect((await call(handleVideoStart, { jobId: J1, key }, piece(P))).status).toBe(200);
    expect(r2.uploads.get('up-1')?.key).toBe(`video/${J1}`);
    // The fake bucket answers 10024 (410) for an uploadId under another key, so 200 means J1's key was used.
    expect(await call(handleVideoPart, { jobId: J1, uploadId: 'up-1', partNumber: '2', key }, piece(100, []))).toEqual({
      status: 200,
      data: { etag: 'e2' },
    });
    const done = await call(handleVideoComplete, { jobId: J1, uploadId: 'up-1', key }, JSON.stringify({ parts: twoParts }));
    expect(done).toEqual({ status: 200, data: { key: `video/${J1}` } });
    expect(r2.objects.has(`video/${J1}`)).toBe(true);
    expect(r2.objects.has(key)).toBe(false);
  });

  it('a declared over-8 MiB piece is refused before Postgres, even when the real body is small', async () => {
    expect((await call(handleVideoStart, { jobId: J1 }, piece(100), String(P + 1))).status).toBe(413);
    expect((await call(handleVideoPart, { jobId: J1, uploadId: 'u', partNumber: '2' }, piece(100, []), String(P + 1))).status).toBe(413);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r2.calls).toEqual([]);
  });
});

describe('video routes without a token', () => {
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon' } as unknown as Parameters<
    typeof app.request
  >[2];

  it.each(['/video/start?jobId=x', '/video/part?jobId=x&uploadId=u&partNumber=2', '/video/complete?jobId=x&uploadId=u', '/video/abort?jobId=x&uploadId=u'])(
    'POST %s answers 401',
    async (path) => {
      const res = await app.request(path, { method: 'POST' }, env);
      expect(res.status).toBe(401);
    },
  );
});
