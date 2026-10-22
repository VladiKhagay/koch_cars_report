import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleInvite } from './invite';

const env = {
  SUPABASE_URL: 'https://sb.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  APP_URL: 'https://app.test',
};

/** The slice of a Hono context handleInvite and getActiveAppUser touch. */
function ctx(body: unknown) {
  return {
    env,
    req: { json: async () => body, header: () => 'Bearer caller' },
    get: () => ({ sub: 'admin-auth-id' }),
    json: (data: unknown, status = 200) => ({ data, status }),
  } as never;
}

afterEach(() => vi.unstubAllGlobals());

/* Re-inviting is how an expired invite is resent. Supabase re-sends the email
   to an unconfirmed user, but the profile row from the first invite is already
   there — that must not turn a sent email into an error for the admin. */
describe('handleInvite — resending to an existing invitee', () => {
  it('skips the existing profile row instead of failing', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/rest/v1/users?auth_id=')) return Response.json([{ id: 'u1', role: 'admin' }]);
      if (url.includes('/auth/v1/invite')) return Response.json({ id: 'invitee-auth-id' });
      return new Response(null, { status: 201 });
    });

    const res = (await handleInvite(
      ctx({ email: 'dana@example.com', name: 'Dana', role: 'worker', siteId: 'site-1' }),
    )) as unknown as { data: unknown; status: number };

    expect(res).toEqual({ data: { ok: true }, status: 200 });
    const profile = calls.find((c) => c.init?.method === 'POST' && c.url.includes('/rest/v1/users'))!;
    expect(profile.url).toContain('on_conflict=auth_id');
    expect((profile.init!.headers as Record<string, string>).Prefer).toContain('resolution=ignore-duplicates');
  });
});

/* Carasso is scoped by a list of sites, has no home site, and is the one role
   whose invite writes a second table. */
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';

describe('handleInvite — Carasso', () => {
  function stub(callerRole = 'admin') {
    const calls: { url: string; body?: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.includes('/rest/v1/users?auth_id=')) return Response.json([{ id: 'u1', role: callerRole }]);
      if (url.includes('/auth/v1/invite')) return Response.json({ id: 'invitee-auth-id' });
      if (url.includes('/rest/v1/users?on_conflict')) return Response.json([{ id: 'new-user-id' }], { status: 201 });
      return new Response(null, { status: 201 });
    });
    return calls;
  }
  const invite = (body: unknown) => handleInvite(ctx(body)) as unknown as Promise<{ data: unknown; status: number }>;

  it('creates the profile without a home site and links every chosen site', async () => {
    const calls = stub();
    const res = await invite({ email: 'c@example.com', name: 'Carasso', role: 'carasso', siteIds: [S1, S2, S1] });

    expect(res.status).toBe(200);
    const profile = calls.find((c) => c.url.includes('/rest/v1/users?on_conflict'))!;
    expect(profile.body).toMatchObject({ role: 'carasso', site_id: null });
    const links = calls.find((c) => c.url.endsWith('/rest/v1/user_sites'))!;
    expect(links.body).toEqual([
      { user_id: 'new-user-id', site_id: S1 },
      { user_id: 'new-user-id', site_id: S2 },
    ]);
  });

  it('refuses a Carasso invite with no sites, before sending any email', async () => {
    const calls = stub();
    for (const siteIds of [undefined, [], [''], [42], ['s1'], [S1, 'nope']]) {
      const res = await invite({ email: 'c@example.com', name: 'Carasso', role: 'carasso', siteIds });
      expect(res.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it('still requires a siteId for the other roles', async () => {
    stub();
    const res = await invite({ email: 'w@example.com', name: 'W', role: 'worker', siteIds: ['s1'] });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown role', async () => {
    stub();
    const res = await invite({ email: 'w@example.com', name: 'W', role: 'owner', siteId: 's1' });
    expect(res.status).toBe(400);
  });

  it('is admin-only: a manager cannot invite a Carasso user', async () => {
    const calls = stub('manager');
    const res = await invite({ email: 'c@example.com', name: 'C', role: 'carasso', siteIds: [S1] });
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.url.includes('/auth/v1/invite'))).toBe(false);
  });
});
