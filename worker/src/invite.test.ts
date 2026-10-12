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
