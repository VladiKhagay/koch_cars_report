import type { Context } from 'hono';
import type { Env, RateLimiter } from './index';

/**
 * Applies a per-caller rate limit: a 429 response when over it, null otherwise.
 *
 * Keyed on the JWT `sub`, not the IP: a yard shares one connection. Called
 * before any Postgres lookup so a flood is turned away at the cheapest point.
 * No `sub` cannot happen behind the jwk middleware, but is refused if it does.
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

  // Distinguishable 429: OCR falls back to typing, an upload stays queued.
  return c.json({ error: 'rate_limited' }, 429);
}
