import type { Context } from 'hono';
import type { Env } from './index';
import { rateLimited } from './rateLimit';

/**
 * The photo slots a job can have. Mirrors the `photos_kind_check` constraint
 * added in migration 0005.
 *
 * This is an allowlist, not a format check, and it must stay one: `kind` is
 * interpolated into the R2 object key below. A pattern like /^[a-z_0-9]+$/
 * would accept `extra_9` and quietly create slots the database would then
 * reject, and any loosening beyond that reaches for the key path itself.
 */
export const PHOTO_KINDS = ['plate', 'vin', 'extra_1', 'extra_2', 'extra_3'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export function isPhotoKind(value: unknown): value is PhotoKind {
  return typeof value === 'string' && (PHOTO_KINDS as readonly string[]).includes(value);
}

/**
 * Largest body /upload will store. See the note at the call site for why 8MB.
 * PhotoCapture.tsx carries the same number; the two packages ship separately,
 * so it is written down twice on purpose rather than shared through a module.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * The image formats a photo may actually be, and how to recognise one.
 *
 * Deliberately wider than "JPEG", which is all the app sends on its normal
 * path: PhotoCapture falls back to uploading the *original* file when canvas
 * downscaling throws, and on iOS that original can still be HEIC. A JPEG-only
 * check would reject real photos on precisely the path the fallback exists to
 * serve. SVG is absent and must stay absent — it is a script-bearing document,
 * not an image, and this is the one entry point where that matters.
 */
const IMAGE_SIGNATURES: { type: string; match: (b: Uint8Array) => boolean }[] = [
  { type: 'image/jpeg', match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: 'image/png',
    match: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  // RIFF....WEBP — the four size bytes in between are skipped.
  {
    type: 'image/webp',
    match: (b) =>
      ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  },
  // ISO-BMFF: ....ftyp<brand>. Only the still-image brands are listed, so an
  // MP4 (ftypisom / ftypmp42) is not mistaken for a photo.
  {
    type: 'image/heic',
    match: (b) =>
      ascii(b, 4, 8) === 'ftyp' &&
      ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(
        ascii(b, 8, 12),
      ),
  },
];

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/**
 * Returns the content type implied by the leading bytes, or null if they are
 * not a supported image.
 *
 * This is the check that makes the pinned content type honest: without it,
 * `PUT`ing arbitrary bytes stored them under an image type and served them
 * back from the Worker's own origin.
 */
export function sniffImageType(body: ArrayBuffer): string | null {
  // Every signature above is decided within the first 12 bytes.
  const head = new Uint8Array(body, 0, Math.min(12, body.byteLength));
  if (head.byteLength < 12) return null;
  return IMAGE_SIGNATURES.find((s) => s.match(head))?.type ?? null;
}

/**
 * Accepts a photo for a job and writes it to R2.
 *
 * Authorization is delegated to Postgres rather than reimplemented here: we
 * forward the caller's own JWT and ask `can_write_job` (migration 0009), which
 * mirrors the `photos_insert` policy exactly. One source of truth for who may
 * attach a photo to a job.
 *
 * It asks about writing, not reading, and the difference matters: a worker can
 * SELECT their own jobs indefinitely, but may only add photos inside the
 * 15-minute edit window. Probing visibility — which is what this did before —
 * let a worker overwrite the plate photo on a job frozen weeks earlier. See
 * the migration for the full account.
 */
export async function handleUpload(c: Context<{ Bindings: Env }>) {
  const jobId = c.req.query('jobId');
  const kind = c.req.query('kind');
  const authHeader = c.req.header('Authorization');

  if (!jobId || !isPhotoKind(kind) || !authHeader) {
    return c.json({ error: `Expected ?jobId=&kind=${PHOTO_KINDS.join('|')} with a photo body` }, 400);
  }

  // Ahead of both the permission check and reading the body, so a flood costs
  // neither a Supabase round-trip nor 8MB of ingest per request.
  const limited = await rateLimited(c, c.env.UPLOAD_LIMITER);
  if (limited) return limited;

  // A malformed jobId makes PostgREST answer 400, which lands in the same
  // branch as an explicit `false` — the check fails closed either way.
  const checkRes = await fetch(`${c.env.SUPABASE_URL}/rest/v1/rpc/can_write_job`, {
    method: 'POST',
    headers: {
      apikey: c.env.SUPABASE_ANON_KEY,
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_job_id: jobId }),
  });
  const mayWrite = checkRes.ok ? ((await checkRes.json()) as unknown) === true : false;
  if (!mayWrite) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) {
    return c.json({ error: 'Empty body' }, 400);
  }
  // Normal path uploads a downscaled ~1280px JPEG (a few hundred KB). This cap
  // is a safety net for the rare fallback where client-side downscaling failed
  // and the original camera photo went up instead. 8MB covers every real phone
  // photo with room to spare; the old 20MB was sized for "a stuck retry loop
  // can't pile up much", which is a weaker question than "what does this app
  // actually send". Mirrored client-side in PhotoCapture.tsx so the fallback
  // fails on the phone rather than after pushing the bytes over a yard
  // connection — a 413 there would queue for retry and never succeed.
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return c.json({ error: 'Photo too large (max 8MB)' }, 413);
  }

  // Content type comes from the bytes themselves, never from the client. The
  // previous version pinned image/jpeg, which was right about the threat (an
  // attacker-chosen text/html would make GET /photo serve a page on this
  // Worker's origin) but assumed the body was already an image. Nothing
  // checked that: any bytes at all were stored and then served back under an
  // image content type. sniffImageType both rejects non-images and picks the
  // type from a closed table, so the threat stays closed while HEIC/PNG from
  // the downscale-failure path are stored as what they actually are.
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    return c.json({ error: 'Body is not a supported image (JPEG, PNG, WebP or HEIC)' }, 415);
  }

  const key = `${jobId}/${kind}.jpg`;
  await c.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType } });

  return c.json({ key });
}
