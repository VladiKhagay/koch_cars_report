import type { Context } from 'hono';
import type { Env } from './index';

interface Body {
  userId: string;
  active: boolean;
}

/**
 * Ban duration standing in for "indefinitely". GoTrue takes a Go duration
 * string and has no unbounded form, so this is a hundred years; 'none' lifts
 * an existing ban.
 */
const BAN_FOREVER = '876000h';

/**
 * Activates or deactivates a user, in both places it has to happen.
 *
 * `active` lives on public.users and gates every RLS policy through
 * current_app_user(). What it never touched is auth.users — so a deactivated
 * employee kept a working refresh token, and supabase-js kept quietly renewing
 * their access token forever. They could no longer read or write anything, but
 * they still held a signature-valid JWT, and every Worker route that does not
 * reach Postgres had to remember to re-check `active` by hand to be safe. One
 * that forgot would silently reopen the hole for every person ever offboarded.
 *
 * Authorization is NOT reimplemented here. Who may deactivate whom is already
 * decided by set_user_active (migration 0004): admins may act on anyone but
 * themselves, managers only on workers at their own site. The caller's own JWT
 * is forwarded to that RPC and the auth account is touched only if Postgres
 * allowed the change — so this endpoint can never be a way around the rule.
 *
 * Order matters. The RPC runs first: it is both the authorization gate and the
 * source of truth, and if the ban call then fails on a deactivation the user is
 * already locked out of everything that reads the database. The reverse order
 * would ban first and risk banning someone the caller was never allowed to
 * touch.
 */
export async function handleUserActive(c: Context<{ Bindings: Env }>) {
  const authHeader = c.req.header('Authorization');
  const body = await c.req.json<Body>().catch(() => null);

  if (!authHeader || !body || typeof body.userId !== 'string' || typeof body.active !== 'boolean') {
    return c.json({ error: 'Expected { userId, active }' }, 400);
  }

  // 1. The app-level change, under the caller's own privileges.
  const rpcRes = await fetch(`${c.env.SUPABASE_URL}/rest/v1/rpc/set_user_active`, {
    method: 'POST',
    headers: {
      apikey: c.env.SUPABASE_ANON_KEY,
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_user_id: body.userId, p_active: body.active }),
  });

  if (!rpcRes.ok) {
    // The RPC raises 'forbidden' / 'cannot change your own active status',
    // which PostgREST reports as 400. Its message is written for this screen,
    // so it is passed through rather than flattened.
    const detail = (await rpcRes.json().catch(() => ({}))) as { message?: string };
    return c.json({ error: detail.message ?? 'Not allowed' }, rpcRes.status === 400 ? 403 : 502);
  }

  // 2. Resolve the target's auth account. Read with the caller's JWT, not the
  //    service key: the RPC just proved they may act on this user, and
  //    users_select already lets them see the row.
  const userRes = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(body.userId)}&select=auth_id`,
    { headers: { apikey: c.env.SUPABASE_ANON_KEY, Authorization: authHeader } },
  );
  const rows = userRes.ok ? ((await userRes.json()) as { auth_id: string }[]) : [];
  const authId = rows[0]?.auth_id;

  if (!authId) {
    // The app-level change already landed, so this is not a failure of the
    // request — but the session was not revoked and saying so is the point.
    console.error('user-active: profile updated but auth_id lookup failed', body.userId);
    return c.json({ ok: true, sessionRevoked: false, warning: 'session_not_revoked' }, 200);
  }

  // 3. Revoke (or restore) the identity itself.
  const banRes = await fetch(`${c.env.SUPABASE_URL}/auth/v1/admin/users/${authId}`, {
    method: 'PUT',
    headers: {
      apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ban_duration: body.active ? 'none' : BAN_FOREVER }),
  });

  if (!banRes.ok) {
    console.error('user-active: ban update failed', banRes.status, await banRes.text().catch(() => ''));
    return c.json({ ok: true, sessionRevoked: false, warning: 'session_not_revoked' }, 200);
  }

  return c.json({ ok: true, sessionRevoked: true });
}
