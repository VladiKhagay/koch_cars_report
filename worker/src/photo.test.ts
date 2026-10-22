import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleGetPhoto } from './photo';

const env = {
  SUPABASE_URL: 'https://sb.test',
  SUPABASE_ANON_KEY: 'anon',
  PHOTOS: { get: async () => ({ body: 'bytes', httpMetadata: { contentType: 'image/jpeg' } }) },
};

const ctx = (kind = 'plate') =>
  ({
    env,
    req: { param: (k: string) => (k === 'jobId' ? 'job-1' : kind), header: () => 'Bearer caller' },
    json: (data: unknown, status = 200) => ({ data, status }),
  }) as never;

afterEach(() => vi.unstubAllGlobals());

/* Authorization is one question put to Postgres with the caller's own JWT. */
describe('handleGetPhoto', () => {
  it('asks can_view_job, so Carasso (no jobs RLS) can be allowed by Postgres', async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body as string });
      return Response.json(true);
    });
    const res = (await handleGetPhoto(ctx())) as unknown as Response;
    expect(calls[0].url).toBe('https://sb.test/rest/v1/rpc/can_view_job');
    expect(JSON.parse(calls[0].body)).toEqual({ p_job_id: 'job-1' });
    expect(res.status).toBe(200);
  });

  it.each([false, null, 'true'])('refuses unless the answer is exactly true (%s)', async (answer) => {
    vi.stubGlobal('fetch', async () => Response.json(answer));
    const res = (await handleGetPhoto(ctx())) as unknown as { status: number };
    expect(res.status).toBe(403);
  });

  it('fails closed when Postgres errors', async () => {
    vi.stubGlobal('fetch', async () => new Response('bad uuid', { status: 400 }));
    const res = (await handleGetPhoto(ctx())) as unknown as { status: number };
    expect(res.status).toBe(403);
  });
});
