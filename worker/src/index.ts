import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwk } from 'hono/jwk';
import type { JwtVariables } from 'hono/jwt';
import { handleOcr } from './ocr';
import { handleUpload } from './upload';
import { handleGetPhoto } from './photo';

export interface Env {
  PHOTOS: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  GEMINI_API_KEY: string;
  // Comma-separated list of allowed origins, e.g. the Cloudflare Pages URL(s).
  ALLOWED_ORIGINS?: string;
  // Gemini model id for OCR, e.g. "gemini-3.6-flash". Defaults in ocr.ts if unset.
  GEMINI_MODEL?: string;
}

type Variables = JwtVariables;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', async (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return cors({
    origin: allowed.length > 0 ? allowed : '*',
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

app.post('/ocr', handleOcr);
app.post('/upload', handleUpload);
app.get('/photo/:jobId/:kind', handleGetPhoto);

app.onError((err, c) => {
  console.error(err);
  const status = err.message === 'Unauthorized' ? 401 : 500;
  return c.json({ error: status === 401 ? 'Unauthorized' : 'Internal error' }, status);
});

export default app;
