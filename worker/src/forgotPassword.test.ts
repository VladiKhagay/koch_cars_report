import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleForgotPassword } from './forgotPassword';

const env = {
  SUPABASE_URL: 'https://sb.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  APP_URL: 'https://app.test',
  RESET_LIMITER: { limit: async () => ({ success: true }) },
};
const ctx = (body: unknown) =>
  ({ env, req: { json: async () => body }, json: (data: unknown, status = 200) => ({ data, status }) }) as never;

afterEach(() => vi.unstubAllGlobals());

function run(email: string, authUsers: { id: string; email: string; email_confirmed_at?: string }[], activeProfiles: unknown[]) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(url);
    if (url.includes('/admin/users')) return Response.json({ users: authUsers });
    if (url.includes('/rest/v1/users')) return Response.json(activeProfiles);
    return new Response('{}');
  });
  return handleForgotPassword(ctx({ email })).then((r) => ({ r: r as unknown as { data: unknown; status: number }, urls }));
}

describe('handleForgotPassword', () => {
  it('sends for an invited, active user', async () => {
    const { r, urls } = await run('Dana@Example.com', [{ id: 'a1', email: 'dana@example.com', email_confirmed_at: '2026-01-01' }], [{ id: 'u1' }]);
    expect(r).toEqual({ data: { ok: true }, status: 200 });
    expect(urls.some((u) => u.includes('/auth/v1/recover'))).toBe(true);
  });
  it('re-sends the invitation to someone who never accepted it', async () => {
    const { urls } = await run('dana@example.com', [{ id: 'a1', email: 'dana@example.com' }], [{ id: 'u1' }]);
    expect(urls.some((u) => u.includes('/auth/v1/invite'))).toBe(true);
    expect(urls.some((u) => u.includes('/recover'))).toBe(false);
  });
  it.each([
    ['unknown email', [], []],
    ['deactivated or profile-less account', [{ id: 'a1', email: 'dana@example.com' }], []],
  ])('sends nothing but still answers 200: %s', async (_n, authUsers, profiles) => {
    const { r, urls } = await run('dana@example.com', authUsers, profiles);
    expect(r.status).toBe(200);
    expect(urls.some((u) => u.includes('/recover'))).toBe(false);
  });
  it('rejects a malformed email', async () => {
    expect(((await handleForgotPassword(ctx({ email: 'x' }))) as unknown as { status: number }).status).toBe(400);
  });
});
