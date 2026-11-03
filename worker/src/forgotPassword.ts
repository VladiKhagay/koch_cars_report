import type { Context } from 'hono';
import type { Env } from './index';

/**
 * Public "forgot password" endpoint. Supabase's own /recover emails any auth
 * account, including ones with no app profile and deactivated ones, so the
 * allow-check lives here: mail goes out only to an invited user whose
 * public.users profile is active. The answer is always the same 200, so the
 * endpoint can't be used to learn who has an account.
 */
export async function handleForgotPassword(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{ email?: unknown }>().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Expected { email }' }, 400);

  // Keyed on the address: caps mailbox spam per target. Counters are per location (see wrangler.toml).
  const { success } = await c.env.RESET_LIMITER.limit({ key: email });
  if (!success) return c.json({ error: 'rate_limited' }, 429);

  const service = {
    apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
  };

  // ponytail: GoTrue admin has no email filter; scanning one page is fine for a ~20-user roster. Paginate past 1000 users.
  const listRes = await fetch(`${c.env.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers: service });
  if (!listRes.ok) {
    console.error('forgot-password: user lookup failed', listRes.status);
    return c.json({ error: 'Internal error' }, 500);
  }
  const { users = [] } = (await listRes.json()) as { users?: { id: string; email?: string }[] };
  const authUser = users.find((u) => u.email?.toLowerCase() === email);

  if (authUser) {
    const profRes = await fetch(
      `${c.env.SUPABASE_URL}/rest/v1/users?auth_id=eq.${encodeURIComponent(authUser.id)}&active=eq.true&select=id`,
      { headers: service },
    );
    const profiles = profRes.ok ? ((await profRes.json()) as unknown[]) : [];
    if (profiles.length > 0) {
      const res = await fetch(
        `${c.env.SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(`${c.env.APP_URL ?? ''}/welcome`)}`,
        {
          method: 'POST',
          headers: { apikey: c.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        },
      );
      if (!res.ok) console.error('forgot-password: recover failed', res.status);
    }
  }
  return c.json({ ok: true });
}
