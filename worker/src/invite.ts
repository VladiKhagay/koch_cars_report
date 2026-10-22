import type { Context } from 'hono';
import type { Env } from './index';
import { getActiveAppUser } from './appUser';

interface InviteBody {
  email: string;
  name: string;
  role: 'worker' | 'manager' | 'admin' | 'carasso';
  /** Home site of a worker/manager/admin. Not used for Carasso. */
  siteId?: string;
  /** Carasso only: the sites they may see (user_sites, 0027). At least one. */
  siteIds?: string[];
}

const ROLES = ['worker', 'manager', 'admin', 'carasso'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    !ROLES.includes(body.role)
  ) {
    return c.json({ error: 'Expected { email, name, role, siteId | siteIds }' }, 400);
  }
  // Carasso is scoped by a site LIST and has no home site; everyone else by one site.
  const isCarasso = body.role === 'carasso';
  const siteIds = isCarasso && Array.isArray(body.siteIds) ? [...new Set(body.siteIds)] : [];
  if (isCarasso ? siteIds.length === 0 || !siteIds.every((id) => typeof id === 'string' && UUID.test(id)) : !body.siteId) {
    return c.json({ error: isCarasso ? 'Carasso users need at least one site' : 'Expected siteId' }, 400);
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
    headers: { ...serviceHeaders, Prefer: 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify({
      auth_id: invited.id,
      name: body.name.trim(),
      role: body.role,
      site_id: isCarasso ? null : body.siteId,
    }),
  });
  if (!profileRes.ok) {
    console.error('invite: profile creation failed', profileRes.status, await profileRes.text().catch(() => ''));
    return c.json({ error: 'invited, but profile creation failed — add the profile row manually' }, 502);
  }

  // 3. Carasso's sites. Only for a profile created just now: a re-invite
  //    returns no row (ignore-duplicates) and keeps the sites it already has.
  const created = (await profileRes.json().catch(() => [])) as { id: string }[];
  if (isCarasso && created[0]) {
    const sitesRes = await fetch(`${c.env.SUPABASE_URL}/rest/v1/user_sites`, {
      method: 'POST',
      headers: { ...serviceHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify(siteIds.map((site_id) => ({ user_id: created[0].id, site_id }))),
    });
    if (!sitesRes.ok) {
      console.error('invite: user_sites failed', sitesRes.status, await sitesRes.text().catch(() => ''));
      return c.json({ error: 'invited, but assigning sites failed — assign them in Admin > Users' }, 502);
    }
  }

  return c.json({ ok: true });
}
