import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleGetPhoto } from './photo';

const JOB = '0b9e5c1a-3f2d-4c8e-9a1b-7d6e5f4a3b2c';

const env = {
  SUPABASE_URL: 'https://sb.test',
  SUPABASE_ANON_KEY: 'anon',
  PHOTOS: { get: async () => ({ body: 'bytes', httpMetadata: { contentType: 'image/jpeg' } }) },
};

const ctx = (kind = 'plate', jobId = JOB) =>
  ({
    env,
    req: { param: (k: string) => (k === 'jobId' ? jobId : kind), header: () => 'Bearer caller' },
    json: (data: unknown, status = 200) => ({ data, status }),
  }) as never;

afterEach(() => vi.unstubAllGlobals());

/* Authorization is one question put to Postgres with the caller's own JWT. */
describe('handleGetPhoto', () => {
  it('asks can_view_photo for this slot, so a removed slot and Carasso are decided by Postgres', async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body as string });
      return Response.json(true);
    });
    const res = (await handleGetPhoto(ctx('vin'))) as unknown as Response;
    expect(calls[0].url).toBe('https://sb.test/rest/v1/rpc/can_view_photo');
    expect(JSON.parse(calls[0].body)).toEqual({ p_job_id: JOB, p_kind: 'vin' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
  });

  it.each([false, null, 'true'])('refuses unless the answer is exactly true (%s)', async (answer) => {
    vi.stubGlobal('fetch', async () => Response.json(answer));
    const res = (await handleGetPhoto(ctx())) as unknown as { status: number };
    expect(res.status).toBe(403);
  });

  it('fails closed when Postgres errors', async () => {
    vi.stubGlobal('fetch', async () => new Response('bad', { status: 500 }));
    const res = (await handleGetPhoto(ctx())) as unknown as { status: number };
    expect(res.status).toBe(403);
  });

  it.each(['job-1', JOB.toUpperCase(), JOB.replaceAll('-', ''), `{${JOB}}`])(
    'answers 404 without asking anyone for a non-canonical job id (%s)',
    async (jobId) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const res = (await handleGetPhoto(ctx('plate', jobId))) as unknown as { status: number };
      expect(res.status).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('answers 404 for a kind outside the allowlist', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = (await handleGetPhoto(ctx('../x'))) as unknown as { status: number };
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe('edges (test-engineer)', () => {
    const ctxWith = (opts: { auth?: string; object?: unknown; kind?: string; get?: () => Promise<unknown> }) => {
      const get = vi.fn(opts.get ?? (async () => opts.object));
      return {
        get,
        c: {
          env: { ...env, PHOTOS: { get } },
          req: {
            param: (k: string) => (k === 'jobId' ? JOB : (opts.kind ?? 'plate')),
            header: (h: string) => (h === 'Authorization' ? opts.auth : undefined),
          },
          json: (data: unknown, status = 200) => ({ data, status }),
        } as never,
      };
    };

    it('answers 404 without asking anyone when there is no Authorization header', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const { c, get } = ctxWith({ auth: undefined, object: { body: 'x' } });
      const res = (await handleGetPhoto(c)) as unknown as { status: number };
      expect(res.status).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    });

    it("asks Postgres as the caller (their JWT, the anon key), never as the service role", async () => {
      let headers: Record<string, string> = {};
      vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
        headers = init.headers as Record<string, string>;
        return Response.json(true);
      });
      const { c } = ctxWith({ auth: 'Bearer manager-jwt', object: { body: 'x' } });
      await handleGetPhoto(c);
      expect(headers.Authorization).toBe('Bearer manager-jwt');
      expect(headers.apikey).toBe('anon');
    });

    it('a refused slot (removed) never touches R2', async () => {
      vi.stubGlobal('fetch', async () => Response.json(false));
      const { c, get } = ctxWith({ auth: 'Bearer x', object: { body: 'x' } });
      const res = (await handleGetPhoto(c)) as unknown as { status: number };
      expect(res.status).toBe(403);
      expect(get).not.toHaveBeenCalled();
    });

    it('a 200 whose body is not JSON fails closed', async () => {
      vi.stubGlobal('fetch', async () => new Response('<html>', { status: 200 }));
      const { c, get } = ctxWith({ auth: 'Bearer x', object: { body: 'x' } });
      const res = (await handleGetPhoto(c)) as unknown as { status: number };
      expect(res.status).toBe(403);
      expect(get).not.toHaveBeenCalled();
    });

    it('a network failure to Postgres rejects (500 upstream) and never reads R2', async () => {
      vi.stubGlobal('fetch', async () => {
        throw new TypeError('network');
      });
      const { c, get } = ctxWith({ auth: 'Bearer x', object: { body: 'x' } });
      await expect(handleGetPhoto(c)).rejects.toThrow('network');
      expect(get).not.toHaveBeenCalled();
    });

    it('allowed but no object in R2 answers 404', async () => {
      vi.stubGlobal('fetch', async () => Response.json(true));
      const { c } = ctxWith({ auth: 'Bearer x', object: null });
      const res = (await handleGetPhoto(c)) as unknown as { status: number };
      expect(res.status).toBe(404);
    });

    it('reads the video from its own prefix and names it by the sniffed type', async () => {
      vi.stubGlobal('fetch', async () => Response.json(true));
      const keys: string[] = [];
      const { c } = ctxWith({
        auth: 'Bearer x',
        kind: 'video',
        get: async (...args: unknown[]) => {
          keys.push(args[0] as string);
          return { body: 'v', httpMetadata: { contentType: 'video/quicktime' } };
        },
      });
      const res = (await handleGetPhoto(c)) as unknown as Response;
      expect(keys).toEqual([`video/${JOB}`]);
      expect(res.headers.get('Content-Type')).toBe('video/quicktime');
      expect(res.headers.get('Content-Disposition')).toBe('inline; filename="video.mov"');
    });

    it.each([undefined, 'text/html'])('an object without a known type (%s) gets the photo filename, sandboxed and nosniff', async (contentType) => {
      vi.stubGlobal('fetch', async () => Response.json(true));
      const { c } = ctxWith({ auth: 'Bearer x', object: { body: 'b', httpMetadata: contentType ? { contentType } : undefined } });
      const res = (await handleGetPhoto(c)) as unknown as Response;
      if (!contentType) expect(res.headers.get('Content-Type')).toBe('image/jpeg');
      expect(res.headers.get('Content-Disposition')).toBe('inline; filename="photo.jpg"');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    });
  });
});
