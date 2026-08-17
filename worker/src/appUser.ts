import type { Context } from 'hono';
import type { Env } from './index';

export interface AppUser {
  id: string;
  role: 'worker' | 'manager' | 'admin';
}

/**
 * Resolves the caller to an ACTIVE `public.users` row, or null.
 *
 * The jwk middleware in index.ts proves a token was signed by this Supabase
 * project and has not expired. That is authentication, and on its own it is a
 * weaker statement than it looks: `active = false` lives in public.users and
 * never reaches auth.users, so deactivating someone leaves their refresh token
 * working indefinitely and their JWT passing verification forever.
 *
 * Routes that reach Postgres inherit the real answer for free — every RLS
 * policy and RPC goes through current_app_user(), which filters on `active`.
 * Routes that do NOT touch Postgres have no such backstop and must ask here.
 *
 * Read with the caller's own JWT under RLS (users_select lets a user read
 * their own row), so this adds no privilege: a token that cannot see its own
 * profile row gets null, which is the correct answer anyway.
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
