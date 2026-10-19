import type { Context } from 'hono';
import type { Env } from './index';
import { getActiveAppUser } from './appUser';

interface InviteBody {
  email: string;
  name: string;
  role: 'worker' | 'manager' | 'admin';
  siteId: string;
}

/**
 * Sends a Supabase email invitation and creates the matching public.users
 * profile. The service-role key is needed because the auth invite API requires
 * it and the invitee has no session to insert their own profile row.
 *
 * Only an active admin may call it: the caller's own JWT is forwarded to read
 * their users row.
 */
export async function handleInvite(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<InviteBody>().catch(() => null);
  if (
    !body ||
    typeof body.email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
    !body.name?.trim() ||
    !['worker', 'manager', 'admin'].includes(body.role) ||
    !body.siteId
  ) {
    return c.json({ error: 'Expected { email, name, role, siteId }' }, 400);
  }

  // Caller must be an active admin (checked through their own JWT + RLS).
  const caller = await getActiveAppUser(c);
  if (caller?.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const serviceHeaders = {
    apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  // 1. Send the invite. redirect_to must be allowlisted in Supabase Auth -> URL Configuration.
  const redirectTo = `${c.env.APP_URL ?? ''}/welcome`;
  const inviteRes = await fetch(
    `${c.env.SUPABASE_URL}/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ email: body.email.trim().toLowerCase() }),
    },
  );
  if (!inviteRes.ok) {
    const detail = (await inviteRes.json().catch(() => ({}))) as { msg?: string; error_description?: string };
    const message = detail.msg ?? detail.error_description ?? `invite failed (${inviteRes.status})`;
    return c.json({ error: message }, inviteRes.status === 422 ? 409 : 502);
  }
  const invited = (await inviteRes.json()) as { id: string };

  // 2. Create the profile row. Re-inviting resends an expired invite, so a
  //    duplicate is skipped and the existing name/role/site are kept.
  const profileRes = await fetch(`${c.env.SUPABASE_URL}/rest/v1/users?on_conflict=auth_id`, {
    method: 'POST',
    headers: { ...serviceHeaders, Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify({
      auth_id: invited.id,
      name: body.name.trim(),
      role: body.role,
      site_id: body.siteId,
    }),
  });
  if (!profileRes.ok) {
    console.error('invite: profile creation failed', profileRes.status, await profileRes.text().catch(() => ''));
    return c.json({ error: 'invited, but profile creation failed — add the profile row manually' }, 502);
  }

  return c.json({ ok: true });
}
