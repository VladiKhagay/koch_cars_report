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

/**
 * A job id exactly as Postgres prints a uuid: lowercase 8-4-4-4-12. Postgres also
 * accepts uppercase, braces or no hyphens for the same row, and the id is
 * interpolated into the R2 key, so only this one spelling may name a key.
 */
export function isCanonicalJobId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
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

/** Largest piece /video/start and /video/part take. Mirrored as VIDEO_PART_BYTES in web/src/lib/video.ts. */
export const VIDEO_PART_BYTES = 8 * 1024 * 1024;

/** R2 multipart parts a video can have: every piece but the last is exactly VIDEO_PART_BYTES. */
export const MAX_VIDEO_PARTS = Math.ceil(MAX_VIDEO_BYTES / VIDEO_PART_BYTES);

/**
 * Asks Postgres whether the caller may write this slot of this job: the caller's
 * own JWT is forwarded to `can_write_photo` (migration 0031). A malformed jobId
 * makes PostgREST answer 400, which fails closed like `false`.
 */
export async function mayWritePhoto(c: Context<{ Bindings: Env }>, jobId: string, kind: PhotoKind): Promise<boolean> {
  const checkRes = await fetch(`${c.env.SUPABASE_URL}/rest/v1/rpc/can_write_photo`, {
    method: 'POST',
    headers: {
      apikey: c.env.SUPABASE_ANON_KEY,
      Authorization: c.req.header('Authorization') ?? '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_job_id: jobId, p_kind: kind }),
  });
  return checkRes.ok ? ((await checkRes.json()) as unknown) === true : false;
}

/** Reads a whole body into one fresh buffer, or null (stream cancelled) once it passes `max` bytes. */
export async function readCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const parts: Uint8Array[] = [];
  let total = 0;
  const source = stream.getReader();
  for (;;) {
    const { done, value } = await source.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await source.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/**
 * Accepts a photo or video for a job and writes it to R2.
 *
 * Authorization is delegated to Postgres: the caller's own JWT is forwarded to
 * `can_write_photo` (migration 0031), the same function the `photos_insert`
 * policy calls, so the R2 write and the row insert go through the same rule,
 * checked at R2-put time and again at row insert. It asks
 * about writing a given slot, not visibility: a worker can see a job long after
 * its 15-minute edit window closes, and the deferred video slot has its own,
 * longer window.
 */
export async function handleUpload(c: Context<{ Bindings: Env }>) {
  const jobId = c.req.query('jobId');
  const kind = c.req.query('kind');
  const authHeader = c.req.header('Authorization');

  if (!isCanonicalJobId(jobId) || !isPhotoKind(kind) || !authHeader) {
    return c.json({ error: `Expected ?jobId=&kind=${PHOTO_KINDS.join('|')} with a photo body` }, 400);
  }

  // Before the permission check and the body read, so a flood costs neither.
  const limited = await rateLimited(c, c.env.UPLOAD_LIMITER);
  if (limited) return limited;

  // Checked before the permission lookup so a bad body costs no Postgres call.
  // R2 needs the length up front to take a stream; the web client sends a Blob, so it is always set.
  // A missing header falls back to buffering (below) rather than a 4xx, which the offline queue would treat as permanent.
  const isVideo = kind === 'video';
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES;
  const tooLarge = `${isVideo ? 'Video' : 'Photo'} too large (max ${maxBytes / 1024 / 1024}MB)`;
  const lengthHeader = c.req.header('Content-Length');
  let declared = 0;
  if (lengthHeader !== undefined) {
    if (!/^\d+$/.test(lengthHeader)) return c.json({ error: 'Invalid Content-Length' }, 400);
    declared = Number(lengthHeader);
    if (declared === 0) return c.json({ error: 'Empty body' }, 400);
    if (declared > maxBytes) return c.json({ error: tooLarge }, 413);
  }

  if (!(await mayWritePhoto(c, jobId, kind))) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Streamed, never buffered: a 75MB video would eat most of the 128MB isolate.
  let body = c.req.raw.body;
  if (lengthHeader === undefined && body) {
    // ponytail: no Content-Length is not expected from browsers; buffer (bounded by maxBytes) instead of failing the upload.
    const bytes = await readCapped(body, maxBytes);
    if (!bytes) return c.json({ error: tooLarge }, 413);
    if (bytes.byteLength === 0) return c.json({ error: 'Empty body' }, 400);
    declared = bytes.byteLength;
    body = new Blob([bytes]).stream();
  }
  if (!body) return c.json({ error: 'Empty body' }, 400);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let peeked = 0;
  while (peeked < 12) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    peeked += value.byteLength;
  }
  // A fresh copy: a chunk may be a view into a larger buffer.
  const head = new Uint8Array(Math.min(peeked, 12));
  let at = 0;
  for (const chunk of chunks) {
    if (at === head.byteLength) break;
    const part = chunk.subarray(0, head.byteLength - at);
    head.set(part, at);
    at += part.byteLength;
  }

  // The stored content type comes from the bytes, never from the client.
  const contentType = isVideo ? sniffVideoType(head.buffer) : sniffImageType(head.buffer);
  if (!contentType) {
    await reader.cancel();
    return c.json(
      {
        error: isVideo
          ? 'Body is not a supported video (MP4, MOV or WebM)'
          : 'Body is not a supported image (JPEG, PNG, WebP or HEIC)',
      },
      415,
    );
  }

  // The Content-Length above is the client's word; this counts the real bytes.
  let received = 0;
  let overLimit = false;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > declared) {
        overLimit = true;
        controller.error(new Error('Body longer than Content-Length'));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  const replay = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });

  const key = objectKey(jobId, kind);
  try {
    // R2 put is atomic: an errored stream stores nothing, so there is no partial object to
    // delete, and deleting here would wipe a copy an earlier attempt already stored.
    await c.env.PHOTOS.put(key, replay.pipeThrough(counter).pipeThrough(new FixedLengthStream(declared)), {
      httpMetadata: { contentType },
    });
  } catch (err) {
    // Only our own count is the client's fault; anything else is a 5xx so the upload stays queued.
    if (overLimit) return c.json({ error: tooLarge }, 413);
    throw err;
  }

  return c.json({ key });
}
