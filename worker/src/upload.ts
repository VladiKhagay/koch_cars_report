import type { Context } from 'hono';
import type { Env } from './index';

/**
 * Accepts a photo for a job and writes it to R2.
 *
 * Authorization is delegated to Postgres RLS rather than reimplemented here:
 * we forward the caller's own JWT to Supabase's REST API and ask "can this
 * user see this job?" If the job row isn't returned, the same RLS policies
 * that gate the frontend's reads/writes (jobs_select / jobs_update) block
 * the upload too — one source of truth for who can touch a job.
 */
export async function handleUpload(c: Context<{ Bindings: Env }>) {
  const jobId = c.req.query('jobId');
  const kind = c.req.query('kind');
  const authHeader = c.req.header('Authorization');

  if (!jobId || (kind !== 'plate' && kind !== 'vin') || !authHeader) {
    return c.json({ error: 'Expected ?jobId=&kind=plate|vin with a photo body' }, 400);
  }

  const checkRes = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/jobs?id=eq.${encodeURIComponent(jobId)}&select=id`,
    {
      headers: {
        apikey: c.env.SUPABASE_ANON_KEY,
        Authorization: authHeader,
      },
    },
  );
  const rows = checkRes.ok ? ((await checkRes.json()) as unknown[]) : [];
  if (!checkRes.ok || rows.length === 0) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) {
    return c.json({ error: 'Empty body' }, 400);
  }
  // Normal path uploads a downscaled ~1280px JPEG (a few hundred KB). This
  // cap is a safety net for the rare fallback where client-side downscaling
  // failed and the original camera photo went up instead (modern phones can
  // shoot 10-15MB JPEGs) — generous enough to not reject those, not so high
  // that a stuck retry loop could ever pile up meaningfully in R2.
  if (bytes.byteLength > 20 * 1024 * 1024) {
    return c.json({ error: 'Photo too large (max 20MB)' }, 413);
  }

  // Content type is pinned rather than echoed from the client: the app only
  // ever uploads JPEG, and storing an attacker-chosen type (e.g. text/html)
  // would make GET /photo serve it as a page on this Worker's origin.
  const key = `${jobId}/${kind}.jpg`;
  await c.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });

  return c.json({ key });
}
