import type { Context } from 'hono';
import type { Env, RateLimiter } from './index';

/**
 * Applies a per-caller rate limit, returning a 429 response when the caller is
 * over it and null when they may proceed.
 *
 * Keyed on the JWT `sub` rather than the client IP on purpose: a yard shares
 * one connection, so an IP key would put every worker on site into the same
 * bucket and let one busy phone throttle their colleagues.
 *
 * Called before the caller is resolved against Postgres, so a flood is turned
 * away at the cheapest possible point instead of being amplified into a
 * Supabase query per request.
 *
 * No `sub` means no identity to meter, which cannot happen behind the jwk
 * middleware — but if it ever does, that is a request to refuse rather than to
 * wave through unmetered.
 */
export async function rateLimited(
  c: Context<{ Bindings: Env }>,
  limiter: RateLimiter,
): Promise<Response | null> {
  const payload = c.get('jwtPayload' as never) as { sub?: string } | undefined;
  const sub = payload?.sub;
  if (!sub) return c.json({ error: 'Forbidden' }, 403);

  const { success } = await limiter.limit({ key: sub });
  if (success) return null;

  // 429 is deliberate and distinguishable: the frontend treats a failed OCR as
  // "type it in", and a failed upload stays queued for retry, so neither path
  // loses a worker's data when this fires.
  return c.json({ error: 'rate_limited' }, 429);
}
