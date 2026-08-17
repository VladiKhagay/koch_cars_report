import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { jwk } from 'hono/jwk';
import type { JwtVariables } from 'hono/jwt';
import { handleOcr } from './ocr';
import { handleUpload } from './upload';
import { handleGetPhoto } from './photo';
import { handleInvite } from './invite';
import { handleUserActive } from './userActive';

/**
 * The rate-limit binding, typed here rather than pulled from
 * @cloudflare/workers-types for the same reason `AI` is below: a minimal
 * structural type cannot be broken by a types-package bump.
 */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  PHOTOS: R2Bucket;
  // Per-user rate limits keyed on the JWT `sub`. See wrangler.toml for how the
  // two limits were sized and what they can and cannot be trusted to do.
  OCR_LIMITER: RateLimiter;
  UPLOAD_LIMITER: RateLimiter;
  // Workers AI binding (OCR). Typed minimally rather than with the versioned
  // AiModels map so bumping @cloudflare/workers-types is never forced by a
  // model change.
  AI: { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  // Service role key — used ONLY by /invite (see invite.ts for why).
  SUPABASE_SERVICE_ROLE_KEY: string;
  // Public URL of the deployed frontend; invite emails redirect to APP_URL/welcome.
  APP_URL?: string;
  // Optional override for the OCR *read* model, so alternatives can be trialled
  // on real photos without a deploy. Detection stays on Moondream (only model
  // in the catalogue with a `detect` task).
  OCR_MODEL?: string;
  // Comma-separated list of allowed origins, e.g. the Cloudflare Pages URL(s).
  ALLOWED_ORIGINS?: string;
}

type Variables = JwtVariables;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', async (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return cors({
    // Unset ALLOWED_ORIGINS denies every cross-origin caller rather than
    // allowing all of them. The old '*' fallback was inert in production —
    // the var is set in wrangler.toml — but it meant a typo or a fresh
    // environment failed open, silently, in the direction nobody checks.
    origin: allowed.length > 0 ? allowed : () => null,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
  })(c, next);
});

app.get('/health', (c) => c.json({ ok: true }));

// Every route below requires a valid Supabase-issued JWT. Supabase signs
// access tokens with its project JWT Signing Key (ES256, asymmetric) rather
// than a static shared secret these days, so we verify against Supabase's
// published JWKS instead of holding a secret ourselves. This also means key
// rotation on the Supabase side (Settings -> JWT Keys -> Create Standby Key)
// never requires touching this Worker.
const requireAuth = jwk({
  jwks_uri: (c) => `${c.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  alg: ['ES256'],
});
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
  /*
   * A rejected token is the caller's problem, not a server fault. The previous
   * version matched on `err.message === 'Unauthorized'`, which the jwk
   * middleware never produces — it throws an HTTPException — so every expired
   * session, every missing header and every bad signature came back as
   * 500 "Internal error". That reads as an outage, hides the one action that
   * fixes it (sign in again), and buries real 500s in the same bucket.
   */
  if (err instanceof HTTPException) {
    return c.json({ error: err.status === 401 ? 'Unauthorized' : err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: 'Internal error' }, 500);
});

export default app;
