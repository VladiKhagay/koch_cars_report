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
 * Streams a private R2 photo back to the caller. Same RLS-delegated
 * authorization pattern as upload.ts: forward the caller's JWT to Supabase
 * and ask whether they can see the job. If not, the bucket stays private.
 */
export async function handleGetPhoto(c: Context<{ Bindings: Env }>) {
  const jobId = c.req.param('jobId');
  const kind = c.req.param('kind');
  const authHeader = c.req.header('Authorization');

  // Same allowlist as the write side — a kind that cannot be uploaded must not
  // be a path that can be probed either.
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

  // Whatever /upload sniffed from the bytes at write time. Objects stored
  // before that check existed carry image/jpeg, which is what they were
  // pinned to.
  const contentType = object.httpMetadata?.contentType ?? 'image/jpeg';
  const filename = VIDEO_FILENAMES[contentType] ?? 'photo.jpg';

  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300',
      // The content type is derived from the file's own magic bytes and can
      // only be one of four image types, so there is nothing here for a
      // sniffing browser to usefully reinterpret (videos likewise: one of three
      // types, see sniffVideoType) — but this is the response
      // that serves user-supplied bytes from the Worker's own origin, so it
      // says so explicitly rather than relying on that argument holding.
      'X-Content-Type-Options': 'nosniff',
      // Renders inline in the viewer as before; the filename is fixed so a
      // download never inherits a name from anything user-controlled.
      'Content-Disposition': `inline; filename="${filename}"`,
      // A photo is only ever fetched by the app itself via fetch().
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
