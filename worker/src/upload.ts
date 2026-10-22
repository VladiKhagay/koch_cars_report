import type { Context } from 'hono';
import type { Env } from './index';
import { rateLimited } from './rateLimit';

/**
 * The photo slots a job can have; mirrors `photos_kind_check` (migration 0020).
 * An allowlist, not a format check: `kind` is interpolated into the R2 key.
 */
export const PHOTO_KINDS = ['plate', 'vin', 'extra_1', 'extra_2', 'extra_3', 'video'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export function isPhotoKind(value: unknown): value is PhotoKind {
  return typeof value === 'string' && (PHOTO_KINDS as readonly string[]).includes(value);
}

/** Videos get their own `video/` prefix so R2 lifecycle rules can expire them separately. */
export function objectKey(jobId: string, kind: PhotoKind): string {
  return kind === 'video' ? `video/${jobId}` : `${jobId}/${kind}.jpg`;
}

/** Largest photo /upload stores. Mirrored in web PhotoCapture.tsx (separate packages). */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Largest video /upload stores. Mirrored as MAX_VIDEO_BYTES in web/src/lib/video.ts. */
export const MAX_VIDEO_BYTES = 75 * 1024 * 1024;

/**
 * Accepted image formats, recognised by their leading bytes. Wider than JPEG
 * because the client's downscale fallback can upload an original HEIC. SVG is
 * absent on purpose: it can carry script.
 */
const IMAGE_SIGNATURES: { type: string; match: (b: Uint8Array) => boolean }[] = [
  { type: 'image/jpeg', match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: 'image/png',
    match: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  // RIFF....WEBP
  {
    type: 'image/webp',
    match: (b) =>
      ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  },
  // ISO-BMFF still-image brands only, so an MP4 is not mistaken for a photo.
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
 * Content type implied by the leading bytes, or null if not a supported image.
 * Never trust the client's type: GET /photo serves these bytes from this origin.
 */
export function sniffImageType(body: ArrayBuffer): string | null {
  // Every signature is decided within the first 12 bytes.
  const head = new Uint8Array(body, 0, Math.min(12, body.byteLength));
  if (head.byteLength < 12) return null;
  return IMAGE_SIGNATURES.find((s) => s.match(head))?.type ?? null;
}

/** ISO-BMFF brands a phone's video recorder writes. Disjoint from the HEIC list above. */
const MP4_BRANDS = ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash'];

/** The video counterpart of sniffImageType; kept separate so a slot only accepts its own kind of bytes. */
export function sniffVideoType(body: ArrayBuffer): string | null {
  const head = new Uint8Array(body, 0, Math.min(12, body.byteLength));
  if (head.byteLength < 12) return null;
  // EBML header: WebM (Chrome's MediaRecorder on most Androids).
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'video/webm';
  if (ascii(head, 4, 8) !== 'ftyp') return null;
  const brand = ascii(head, 8, 12);
  if (brand === 'qt  ') return 'video/quicktime';
  return MP4_BRANDS.includes(brand) ? 'video/mp4' : null;
}

/**
 * Accepts a photo or video for a job and writes it to R2.
 *
 * Authorization is delegated to Postgres: the caller's own JWT is forwarded to
 * `can_write_job` (migrations 0009/0014), which mirrors the `photos_insert`
 * policy. It asks about writing, not visibility, because a worker can see a
 * job long after its 15-minute edit window closes.
 */
export async function handleUpload(c: Context<{ Bindings: Env }>) {
  const jobId = c.req.query('jobId');
  const kind = c.req.query('kind');
  const authHeader = c.req.header('Authorization');

  if (!jobId || !isPhotoKind(kind) || !authHeader) {
    return c.json({ error: `Expected ?jobId=&kind=${PHOTO_KINDS.join('|')} with a photo body` }, 400);
  }

  // Before the permission check and the body read, so a flood costs neither.
  const limited = await rateLimited(c, c.env.UPLOAD_LIMITER);
  if (limited) return limited;

  // Refuse an oversized body on its declared length, before buffering any of it.
  const isVideo = kind === 'video';
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES;
  if (Number(c.req.header('Content-Length')) > maxBytes) {
    return c.json({ error: isVideo ? 'Video too large (max 50MB)' : 'Photo too large (max 8MB)' }, 413);
  }

  // A malformed jobId makes PostgREST answer 400, which fails closed like `false`.
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
  // The Content-Length above can be absent or wrong; this is the real limit.
  if (bytes.byteLength > maxBytes) {
    return c.json({ error: isVideo ? 'Video too large (max 50MB)' : 'Photo too large (max 8MB)' }, 413);
  }

  // The stored content type comes from the bytes, never from the client.
  const contentType = isVideo ? sniffVideoType(bytes) : sniffImageType(bytes);
  if (!contentType) {
    return c.json(
      {
        error: isVideo
          ? 'Body is not a supported video (MP4, MOV or WebM)'
          : 'Body is not a supported image (JPEG, PNG, WebP or HEIC)',
      },
      415,
    );
  }

  const key = objectKey(jobId, kind);
  await c.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType } });

  return c.json({ key });
}
