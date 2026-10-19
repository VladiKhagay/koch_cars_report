import type { Context } from 'hono';
import type { Env } from './index';

export interface AppUser {
  id: string;
  role: 'worker' | 'manager' | 'admin';
}

/**
 * Resolves the caller to an ACTIVE `public.users` row, or null.
 *
 * A valid JWT only proves authentication: `active = false` never reaches
 * auth.users, so a deactivated user's token keeps verifying. Routes that touch
 * Postgres get the real answer from RLS; routes that don't must ask here. Read
 * with the caller's own JWT, so it adds no privilege.
 */
export async function getActiveAppUser(c: Context<{ Bindings: Env }>): Promise<AppUser | null> {
  const authHeader = c.req.header('Authorization');
  const payload = c.get('jwtPayload' as never) as { sub?: string } | undefined;
  const sub = payload?.sub;
  if (!authHeader || !sub) return null;

  const res = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/users?auth_id=eq.${encodeURIComponent(sub)}&active=is.true&select=id,role`,
    { headers: { apikey: c.env.SUPABASE_ANON_KEY, Authorization: authHeader } },
  );
  if (!res.ok) return null;

  const rows = (await res.json()) as AppUser[];
  return rows[0] ?? null;
}
