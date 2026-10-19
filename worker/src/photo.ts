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
 * Streams a private R2 object back to the caller. Same RLS-delegated
 * authorization as upload.ts: forward the caller's JWT and ask Supabase
 * whether they can see the job.
 */
export async function handleGetPhoto(c: Context<{ Bindings: Env }>) {
  const jobId = c.req.param('jobId');
  const kind = c.req.param('kind');
  const authHeader = c.req.header('Authorization');

  // Same allowlist as the write side.
  if (!jobId || !isPhotoKind(kind) || !authHeader) {
    return c.json({ error: 'Not found' }, 404);
  }

  const checkRes = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/jobs?id=eq.${encodeURIComponent(jobId)}&select=id`,
    { headers: { apikey: c.env.SUPABASE_ANON_KEY, Authorization: authHeader } },
  );
  const rows = checkRes.ok ? ((await checkRes.json()) as unknown[]) : [];
  if (!checkRes.ok || rows.length === 0) {
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
