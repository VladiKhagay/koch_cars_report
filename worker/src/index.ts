import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';
import type { JwtVariables } from 'hono/jwt';
import { handleOcr } from './ocr';
import { handleUpload } from './upload';
import { handleGetPhoto } from './photo';

export interface Env {
  PHOTOS: R2Bucket;
  SUPABASE_JWT_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  GEMINI_API_KEY: string;
  // Comma-separated list of allowed origins, e.g. the Cloudflare Pages URL(s).
  ALLOWED_ORIGINS?: string;
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
// access tokens with HS256 using the project's JWT secret, so a plain
// hono/jwt check is enough — no network round-trip to Supabase needed.
app.use('/ocr', async (c, next) => jwt({ secret: c.env.SUPABASE_JWT_SECRET, alg: 'HS256' })(c, next));
app.use('/upload', async (c, next) => jwt({ secret: c.env.SUPABASE_JWT_SECRET, alg: 'HS256' })(c, next));
app.use('/photo/*', async (c, next) => jwt({ secret: c.env.SUPABASE_JWT_SECRET, alg: 'HS256' })(c, next));

app.post('/ocr', handleOcr);
app.post('/upload', handleUpload);
app.get('/photo/:jobId/:kind', handleGetPhoto);

app.onError((err, c) => {
  console.error(err);
  const status = err.message === 'Unauthorized' ? 401 : 500;
  return c.json({ error: status === 401 ? 'Unauthorized' : 'Internal error' }, status);
});

export default app;
