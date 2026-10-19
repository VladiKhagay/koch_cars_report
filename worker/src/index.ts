import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { jwk } from 'hono/jwk';
import type { JwtVariables } from 'hono/jwt';
import { handleOcr } from './ocr';
import { handleUpload } from './upload';
import { handleGetPhoto } from './photo';
import { handleInvite } from './invite';
import { handleUserActive } from './userActive';

/** Typed minimally so a workers-types bump can't break it. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  PHOTOS: R2Bucket;
  // Per-user rate limits keyed on the JWT `sub`; sizing is in wrangler.toml.
  OCR_LIMITER: RateLimiter;
  UPLOAD_LIMITER: RateLimiter;
  // Workers AI binding (OCR), typed minimally.
  AI: { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  // Service role key — used only by /invite and /user-active.
  SUPABASE_SERVICE_ROLE_KEY: string;
  // Public URL of the deployed frontend; invite emails redirect to APP_URL/welcome.
  APP_URL?: string;
  // Optional override for the OCR read model. Detection stays on Moondream.
  OCR_MODEL?: string;
  // Comma-separated list of allowed origins, e.g. the Cloudflare Pages URL(s).
  ALLOWED_ORIGINS?: string;
}

type Variables = JwtVariables;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', async (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return cors({
    // Unset ALLOWED_ORIGINS denies cross-origin callers (fail closed).
    origin: allowed.length > 0 ? allowed : () => null,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
  })(c, next);
});

app.get('/health', (c) => c.json({ ok: true }));

// Every route below requires a valid Supabase JWT, verified against the
// project's JWKS so key rotation needs no change here. Built per request so
// `iss` can be pinned to this project's SUPABASE_URL; `aud` is Supabase's
// fixed 'authenticated'.
const requireAuth = (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) =>
  jwk({
    jwks_uri: `${c.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
    alg: ['ES256'],
    verification: {
      aud: 'authenticated',
      iss: `${c.env.SUPABASE_URL}/auth/v1`,
    },
  })(c, next);
app.use('/ocr', requireAuth);
app.use('/upload', requireAuth);
app.use('/photo/*', requireAuth);
app.use('/invite', requireAuth);
app.use('/user-active', requireAuth);

app.post('/ocr', handleOcr);
app.post('/upload', handleUpload);
app.get('/photo/:jobId/:kind', handleGetPhoto);
app.post('/invite', handleInvite);
app.post('/user-active', handleUserActive);

app.onError((err, c) => {
  // A rejected token is the caller's problem (401), not a server fault.
  if (err instanceof HTTPException) {
    return c.json({ error: err.status === 401 ? 'Unauthorized' : err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: 'Internal error' }, 500);
});

export default app;
