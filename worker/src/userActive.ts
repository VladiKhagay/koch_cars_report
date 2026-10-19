import type { Context } from 'hono';
import type { Env } from './index';

interface Body {
  userId: string;
  active: boolean;
}

/** GoTrue has no unbounded ban; a hundred years stands in for it. 'none' lifts one. */
const BAN_FOREVER = '876000h';

/**
 * Activates or deactivates a user in both places it must happen: `active` on
 * public.users (which gates RLS) and the Supabase auth account (so a
 * deactivated user's refresh token stops working).
 *
 * Authorization stays in Postgres: the caller's JWT is forwarded to
 * set_user_active (migration 0004), and the auth account is touched only if
 * that allowed the change. The RPC runs first so a failed ban never hits
 * someone the caller may not touch.
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
    // The RPC's 'forbidden' / 'cannot change your own…' errors arrive as 400 and are screen-ready.
    const detail = (await rpcRes.json().catch(() => ({}))) as { message?: string };
    return c.json({ error: detail.message ?? 'Not allowed' }, rpcRes.status === 400 ? 403 : 502);
  }

  // 2. Resolve the target's auth account with the caller's JWT, not the service key.
  const userRes = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(body.userId)}&select=auth_id`,
    { headers: { apikey: c.env.SUPABASE_ANON_KEY, Authorization: authHeader } },
  );
  const rows = userRes.ok ? ((await userRes.json()) as { auth_id: string }[]) : [];
  const authId = rows[0]?.auth_id;

  if (!authId) {
    // The profile change landed but the session was not revoked; say so.
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
