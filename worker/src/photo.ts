import type { Context } from 'hono';
import type { Env } from './index';
import { isPhotoKind, objectKey } from './upload';

/** Fixed download names, chosen by the sniffed type — never by anything user-controlled. */
const VIDEO_FILENAMES: Record<string, string> = {
  'video/mp4': 'video.mp4',
  'video/quicktime': 'video.mov',
  'video/webm': 'video.webm',
};

/**
 * Streams a private R2 object back to the caller. Authorization is delegated
 * to Postgres: the caller's JWT is forwarded and Supabase says whether they can
 * see the job.
 */
export async function handleGetPhoto(c: Context<{ Bindings: Env }>) {
  const jobId = c.req.param('jobId');
  const kind = c.req.param('kind');
  const authHeader = c.req.header('Authorization');

  // Same allowlist as the write side.
  if (!jobId || !isPhotoKind(kind) || !authHeader) {
    return c.json({ error: 'Not found' }, 404);
  }

  // can_view_job (migration 0028) is jobs_select plus Carasso's sites. Carasso
  // has no RLS access to `jobs`, so probing the table directly would 403 it.
  // A malformed jobId makes PostgREST answer 400, which fails closed like `false`.
  const checkRes = await fetch(`${c.env.SUPABASE_URL}/rest/v1/rpc/can_view_job`, {
    method: 'POST',
    headers: {
      apikey: c.env.SUPABASE_ANON_KEY,
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_job_id: jobId }),
  });
  if (!checkRes.ok || (await checkRes.json().catch(() => false)) !== true) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const object = await c.env.PHOTOS.get(objectKey(jobId, kind));
  if (!object) return c.json({ error: 'Not found' }, 404);

  // The type sniffed at upload; objects stored before that check are image/jpeg.
  const contentType = object.httpMetadata?.contentType ?? 'image/jpeg';
  const filename = VIDEO_FILENAMES[contentType] ?? 'photo.jpg';

  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300',
      // User-supplied bytes served from the Worker's own origin: be explicit.
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="${filename}"`,
      // Only ever fetched by the app via fetch().
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
