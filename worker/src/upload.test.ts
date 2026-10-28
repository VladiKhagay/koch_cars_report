import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES, handleUpload, objectKey, sniffImageType, sniffVideoType } from './upload';

/** Builds a body from leading bytes, padded so length is never what's tested. */
function body(...head: number[]): ArrayBuffer {
  const bytes = new Uint8Array(64);
  bytes.set(head);
  return bytes.buffer;
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

describe('sniffImageType', () => {
  it('accepts the format the app actually sends', () => {
    expect(sniffImageType(body(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
  });

  it('accepts the formats the downscale-failure fallback can send', () => {
    expect(sniffImageType(body(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffImageType(body(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')))).toBe('image/webp');
    expect(sniffImageType(body(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('heic')))).toBe('image/heic');
    expect(sniffImageType(body(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('mif1')))).toBe('image/heic');
  });

  /* The point of the whole function: arbitrary bytes used to be stored under an
     image content type and served back from the Worker's own origin. */
  it('rejects non-images', () => {
    expect(sniffImageType(body(...ascii('<!doctype html><script>')))).toBeNull();
    expect(sniffImageType(body(...ascii('<svg xmlns="http://')))).toBeNull(); // script-bearing
    expect(sniffImageType(body(...ascii('%PDF-1.7')))).toBeNull();
    expect(sniffImageType(body(0x00, 0x61, 0x73, 0x6d))).toBeNull(); // wasm
  });

  it('does not mistake a video for a photo', () => {
    // Same ftyp container as HEIC, non-image brand.
    expect(sniffImageType(body(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('isom')))).toBeNull();
    expect(sniffImageType(body(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('mp42')))).toBeNull();
  });

  it('rejects a body too short to carry a signature', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff]).buffer)).toBeNull();
    expect(sniffImageType(new ArrayBuffer(0))).toBeNull();
  });

  it('does not read past the end of a short RIFF body', () => {
    // 'RIFF' with nothing after it — must not throw on the WEBP subarray.
    expect(() => sniffImageType(new Uint8Array(ascii('RIFF')).buffer)).not.toThrow();
  });
});

describe('MAX_UPLOAD_BYTES', () => {
  it('is 8MB — large enough for a phone photo, small enough to bound a retry loop', () => {
    expect(MAX_UPLOAD_BYTES).toBe(8 * 1024 * 1024);
  });

  it('allows 75MB for video — ~3x the recorder target of a 2-minute clip', () => {
    expect(MAX_VIDEO_BYTES).toBe(75 * 1024 * 1024);
  });
});

describe('sniffVideoType', () => {
  it('accepts what phone recorders write', () => {
    expect(sniffVideoType(body(0, 0, 0, 0x1c, ...ascii('ftyp'), ...ascii('isom')))).toBe('video/mp4');
    expect(sniffVideoType(body(0, 0, 0, 0x1c, ...ascii('ftyp'), ...ascii('mp42')))).toBe('video/mp4');
    expect(sniffVideoType(body(0, 0, 0, 0x14, ...ascii('ftyp'), ...ascii('qt  ')))).toBe('video/quicktime');
    expect(sniffVideoType(body(0x1a, 0x45, 0xdf, 0xa3))).toBe('video/webm');
  });

  /* Each slot takes only its own kind of bytes, so a photo can't stand in for
     the condition video and a video can't land in a photo slot. */
  it('rejects photos, and photos reject video', () => {
    expect(sniffVideoType(body(0xff, 0xd8, 0xff, 0xe0))).toBeNull();
    expect(sniffVideoType(body(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('heic')))).toBeNull();
    expect(sniffImageType(body(0x1a, 0x45, 0xdf, 0xa3))).toBeNull();
  });

  it('rejects documents and short bodies', () => {
    expect(sniffVideoType(body(...ascii('<!doctype html><script>')))).toBeNull();
    expect(sniffVideoType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]).buffer)).toBeNull();
  });
});

describe('objectKey', () => {
  it('puts videos under their own prefix so they can expire separately', () => {
    expect(objectKey('job-1', 'video')).toBe('video/job-1');
    expect(objectKey('job-1', 'plate')).toBe('job-1/plate.jpg');
  });
});

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const MP4 = [0, 0, 0, 0x1c, ...ascii('ftyp'), ...ascii('isom')];

/** A body that arrives in two chunks, so the sniff has to look across a chunk boundary. */
function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 5));
      controller.enqueue(bytes.subarray(5));
      controller.close();
    },
  });
}

/** contentLength null = header absent. */
function upload(kind: string, bytes: Uint8Array, contentLength: string | null = String(bytes.byteLength)) {
  const stored: { key: string; bytes: number; contentType?: string }[] = [];
  const headers: Record<string, string | undefined> = { authorization: 'Bearer caller', 'content-length': contentLength ?? undefined };
  const ctx = {
    env: {
      SUPABASE_URL: 'https://sb.test',
      SUPABASE_ANON_KEY: 'anon',
      UPLOAD_LIMITER: { limit: async () => ({ success: true }) },
      PHOTOS: {
        // Consumes the stream like R2 does, so the byte counter actually runs.
        put: async (key: string, body: ReadableStream, opts: { httpMetadata: { contentType: string } }) => {
          const got = await new Response(body).arrayBuffer();
          stored.push({ key, bytes: got.byteLength, contentType: opts.httpMetadata.contentType });
        },
      },
    },
    get: () => ({ sub: 'user-1' }),
    req: {
      query: (k: string) => (k === 'jobId' ? 'job-1' : kind),
      header: (k: string) => headers[k.toLowerCase()],
      raw: { body: stream(bytes) },
    },
    json: (data: unknown, status = 200) => ({ data, status }),
  };
  return {
    stored,
    run: () => handleUpload(ctx as never) as unknown as Promise<{ data: { error?: string; key?: string }; status: number }>,
  };
}

function bytesOf(size: number, head: number[]): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return bytes;
}

describe('handleUpload', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => Response.json(true));
    // Workers-only; a passthrough is enough here since the handler counts bytes itself.
    vi.stubGlobal(
      'FixedLengthStream',
      class extends TransformStream {
        constructor(_length: number) {
          super();
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('streams a photo to R2 under the sniffed type', async () => {
    const { run, stored } = upload('plate', bytesOf(1000, JPEG));
    const res = await run();
    expect(res.status).toBe(200);
    expect(res.data.key).toBe('job-1/plate.jpg');
    expect(stored).toEqual([{ key: 'job-1/plate.jpg', bytes: 1000, contentType: 'image/jpeg' }]);
  });

  it('streams a video', async () => {
    const { run, stored } = upload('video', bytesOf(1000, MP4));
    expect((await run()).status).toBe(200);
    expect(stored[0]).toMatchObject({ key: 'video/job-1', contentType: 'video/mp4' });
  });

  it('refuses an oversize video on its declared length, naming the real limit', async () => {
    const { run, stored } = upload('video', bytesOf(64, MP4), String(MAX_VIDEO_BYTES + 1));
    const res = await run();
    expect(res.status).toBe(413);
    expect(res.data.error).toBe('Video too large (max 75MB)');
    expect(stored).toEqual([]);
  });

  it('names the photo limit too', async () => {
    const res = await upload('plate', bytesOf(64, JPEG), String(MAX_UPLOAD_BYTES + 1)).run();
    expect(res.status).toBe(413);
    expect(res.data.error).toBe('Photo too large (max 8MB)');
  });

  it('counts the real bytes when the body outgrows its Content-Length', async () => {
    const { run, stored } = upload('plate', bytesOf(MAX_UPLOAD_BYTES + 1, JPEG), String(MAX_UPLOAD_BYTES));
    const res = await run();
    expect(res.status).toBe(413);
    expect(stored).toEqual([]);
  });

  it('buffers a body that has no Content-Length instead of failing it', async () => {
    const { run, stored } = upload('plate', bytesOf(64, JPEG), null);
    expect((await run()).status).toBe(200);
    expect(stored).toHaveLength(1);
  });

  it('still enforces the size limit when there is no Content-Length', async () => {
    const { run, stored } = upload('plate', bytesOf(MAX_UPLOAD_BYTES + 1, JPEG), null);
    expect((await run()).status).toBe(413);
    expect(stored).toEqual([]);
  });

  it.each(['abc', '', '1e3', '-5', ' 12'])('rejects an invalid Content-Length (%j)', async (value) => {
    expect((await upload('plate', bytesOf(64, JPEG), value).run()).status).toBe(400);
  });

  it('rejects a declared-empty body', async () => {
    const res = await upload('plate', new Uint8Array(0)).run();
    expect(res).toEqual({ data: { error: 'Empty body' }, status: 400 });
  });

  it("rejects bytes that are not the slot's kind with 415", async () => {
    const html = new Uint8Array(ascii('<!doctype html><script>'));
    expect((await upload('plate', html).run()).status).toBe(415);
    const photo = upload('video', bytesOf(64, JPEG));
    expect((await photo.run()).status).toBe(415);
    expect(photo.stored).toEqual([]);
  });

  /* The video slot has its own window (0031), so Postgres must be told which slot is written. */
  it('asks can_write_photo about this exact slot', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => Response.json(true));
    vi.stubGlobal('fetch', fetchSpy);
    await upload('video', bytesOf(1000, MP4)).run();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://sb.test/rest/v1/rpc/can_write_photo');
    expect(JSON.parse(init.body as string)).toEqual({ p_job_id: 'job-1', p_kind: 'video' });
  });

  /* A photo slot must name its kind too: without p_kind PostgREST finds no one-argument can_write_photo. */
  it('asks can_write_photo with the kind for a photo slot as well', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => Response.json(true));
    vi.stubGlobal('fetch', fetchSpy);
    await upload('plate', bytesOf(1000, JPEG)).run();
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ p_job_id: 'job-1', p_kind: 'plate' });
  });

  it('refuses the write when Postgres says no', async () => {
    vi.stubGlobal('fetch', async () => Response.json(false));
    const { run, stored } = upload('video', bytesOf(1000, MP4));
    expect((await run()).status).toBe(403);
    expect(stored).toEqual([]);
  });

  it('checks the length before asking Postgres', async () => {
    const fetchSpy = vi.fn(async () => Response.json(true));
    vi.stubGlobal('fetch', fetchSpy);
    await upload('plate', bytesOf(64, JPEG), String(MAX_UPLOAD_BYTES + 1)).run();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
