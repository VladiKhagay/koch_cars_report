import type { Context } from 'hono';
import type { Env } from './index';
import { rateLimited } from './rateLimit';
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_PARTS,
  VIDEO_PART_BYTES,
  isCanonicalJobId,
  mayWritePhoto,
  objectKey,
  readCapped,
  sniffVideoType,
} from './upload';

/**
 * Resumable condition-video upload: R2 multipart through the PHOTOS binding, so
 * no R2 credential or signed URL reaches the client. The phone sends 8 MiB pieces
 * in order and keeps {uploadId, etags} itself, so an interrupted clip continues
 * from its last finished piece.
 *
 *   POST /video/start?jobId=                      body: piece 1     -> {uploadId, etag}
 *   POST /video/part?jobId=&uploadId=&partNumber= body: piece n>=2  -> {etag}
 *   POST /video/complete?jobId=&uploadId=         body: {parts}     -> {key}
 *   POST /video/abort?jobId=&uploadId=                              -> {ok: true}
 *
 * Every call: params incl. a canonical jobId (400) -> rate limit (429; start also
 * has its own VIDEO_START_LIMITER) -> Content-Length (413) -> can_write_photo for
 * the video slot (403, before any R2 call) -> R2. The key is always
 * objectKey(jobId, 'video'); the client never names one. An upload R2 no longer
 * has (expired, aborted, or not under this key) answers 410, and the client
 * restarts that video from zero. Which R2 error codes mean "gone" is an
 * assumption until SECURITY-NOTES §4's live check.
 */

type Ctx = Context<{ Bindings: Env }>;

/** R2 error codes meaning "this upload (or its part list) is gone or wrong": NoSuchUpload, InvalidPart, InvalidPart (size), EntityTooSmall. */
const GONE_CODES = [10024, 10025, 10048, 10011];
const NO_SUCH_UPLOAD = 10024;

/** The code R2 attaches to its errors; never parsed out of the message. */
function r2Code(err: unknown): unknown {
  return (err as { code?: unknown } | null | undefined)?.code;
}

const gone = (c: Ctx) => c.json({ error: 'upload_gone' }, 410);

/** A complete body is ~10 {partNumber, etag} pairs; anything near this is not a real client. */
const MAX_COMPLETE_BODY = 4096;
/** R2 uploadIds and etags are opaque but short; this only bounds what is echoed back to R2. */
const MAX_TOKEN_LENGTH = 1024;

const isToken = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_TOKEN_LENGTH;

/**
 * Shared front half of every handler. Returns the job id and upload id, or the
 * response to send. `maxBody` = 0 means the route takes no body.
 */
async function guard(
  c: Ctx,
  opts: { needsUploadId: boolean; maxBody: number; isStart?: boolean },
): Promise<{ jobId: string; uploadId: string } | { res: Response }> {
  const jobId = c.req.query('jobId');
  const uploadId = c.req.query('uploadId') ?? '';
  if (!isCanonicalJobId(jobId) || (opts.needsUploadId && !isToken(uploadId)) || !c.req.header('Authorization')) {
    return { res: c.json({ error: 'Expected ?jobId= (and ?uploadId= after start)' }, 400) };
  }

  // Never skipped: a missing binding throws (500), like /upload and /ocr, instead of running unlimited.
  const limiters = opts.isStart ? [c.env.UPLOAD_LIMITER, c.env.VIDEO_START_LIMITER] : [c.env.UPLOAD_LIMITER];
  for (const limiter of limiters) {
    const limited = await rateLimited(c, limiter);
    if (limited) return { res: limited };
  }

  const lengthHeader = c.req.header('Content-Length');
  if (opts.maxBody > 0 && lengthHeader !== undefined) {
    if (!/^\d+$/.test(lengthHeader)) return { res: c.json({ error: 'Invalid Content-Length' }, 400) };
    const declared = Number(lengthHeader);
    if (declared === 0) return { res: c.json({ error: 'Empty body' }, 400) };
    if (declared > opts.maxBody) return { res: c.json({ error: 'Piece too large' }, 413) };
  }

  // Every call, not just start: an upload id alone must never be a write capability.
  if (!(await mayWritePhoto(c, jobId, 'video'))) return { res: c.json({ error: 'Forbidden' }, 403) };
  return { jobId, uploadId };
}

/** The piece in the body, counted for real (Content-Length is only the client's word). */
async function readPiece(c: Ctx): Promise<Uint8Array<ArrayBuffer> | { res: Response }> {
  const body = c.req.raw.body;
  const bytes = body ? await readCapped(body, VIDEO_PART_BYTES) : new Uint8Array(0);
  if (!bytes) return { res: c.json({ error: 'Piece too large' }, 413) };
  if (bytes.byteLength === 0) return { res: c.json({ error: 'Empty body' }, 400) };
  return bytes;
}

/** Opens the multipart upload with piece 1, whose leading bytes decide the stored type. */
export async function handleVideoStart(c: Ctx) {
  const ok = await guard(c, { needsUploadId: false, maxBody: VIDEO_PART_BYTES, isStart: true });
  if (!('jobId' in ok)) return ok.res;
  const piece = await readPiece(c);
  if (!(piece instanceof Uint8Array)) return piece.res;

  // The stored content type comes from the bytes, never from the client.
  const contentType = sniffVideoType(piece.buffer);
  if (!contentType) return c.json({ error: 'Body is not a supported video (MP4, MOV or WebM)' }, 415);

  const upload = await c.env.PHOTOS.createMultipartUpload(objectKey(ok.jobId, 'video'), {
    httpMetadata: { contentType },
  });
  try {
    const part = await upload.uploadPart(1, piece);
    return c.json({ uploadId: upload.uploadId, etag: part.etag });
  } catch (err) {
    // Nobody else knows this uploadId, so drop it now rather than park it for the 7-day rule.
    await upload.abort().catch(() => {});
    if (GONE_CODES.includes(r2Code(err) as number)) return gone(c);
    throw err;
  }
}

/** Piece 2..MAX_VIDEO_PARTS. Re-sending the same bytes under the same number is safe (a lost response). */
export async function handleVideoPart(c: Ctx) {
  const n = c.req.query('partNumber') ?? '';
  const partNumber = /^\d+$/.test(n) ? Number(n) : 0;
  // Piece 1 only via start, which is where the type is sniffed.
  if (partNumber < 2 || partNumber > MAX_VIDEO_PARTS) {
    return c.json({ error: `Expected ?partNumber=2..${MAX_VIDEO_PARTS}` }, 400);
  }
  const ok = await guard(c, { needsUploadId: true, maxBody: VIDEO_PART_BYTES });
  if (!('jobId' in ok)) return ok.res;
  const piece = await readPiece(c);
  if (!(piece instanceof Uint8Array)) return piece.res;

  try {
    const part = await c.env.PHOTOS.resumeMultipartUpload(objectKey(ok.jobId, 'video'), ok.uploadId).uploadPart(
      partNumber,
      piece,
    );
    return c.json({ etag: part.etag });
  } catch (err) {
    if (GONE_CODES.includes(r2Code(err) as number)) return gone(c);
    throw err;
  }
}

/** Parts exactly 1..n in order, each with an etag, or null. */
function parseParts(bytes: Uint8Array): R2UploadedPart[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const parts = (parsed as { parts?: unknown } | null)?.parts;
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > MAX_VIDEO_PARTS) return null;
  const out: R2UploadedPart[] = [];
  for (const [i, p] of parts.entries()) {
    const { partNumber, etag } = (p ?? {}) as { partNumber?: unknown; etag?: unknown };
    if (partNumber !== i + 1 || !isToken(etag)) return null;
    out.push({ partNumber, etag });
  }
  return out;
}

/**
 * Joins the pieces into the final object. Idempotent: a retried complete whose
 * first response was lost (or timed out) fails in R2, and answers 200 if the
 * object at the key is what that complete produced (n parts, size fits n pieces).
 * Which code R2 throws then is an assumption (10024 expected), so the head()
 * check runs on any R2 error; only a gone code without a match becomes 410, and
 * anything else stays a 500 the client retries.
 */
export async function handleVideoComplete(c: Ctx) {
  const ok = await guard(c, { needsUploadId: true, maxBody: MAX_COMPLETE_BODY });
  if (!('jobId' in ok)) return ok.res;
  const body = c.req.raw.body;
  const bytes = body ? await readCapped(body, MAX_COMPLETE_BODY) : null;
  const parts = bytes && parseParts(bytes);
  if (!parts) return c.json({ error: 'Expected {"parts":[{partNumber,etag}]} numbered 1..n' }, 400);

  const key = objectKey(ok.jobId, 'video');
  const n = parts.length;
  try {
    const object = await c.env.PHOTOS.resumeMultipartUpload(key, ok.uploadId).complete(parts);
    // Each piece was capped, but n pieces can still add up past the video limit.
    if (object.size > MAX_VIDEO_BYTES) {
      await c.env.PHOTOS.delete(key);
      return c.json({ error: `Video too large (max ${MAX_VIDEO_BYTES / 1024 / 1024}MB)` }, 413);
    }
    return c.json({ key });
  } catch (err) {
    // Read-only, so safe whatever the error was.
    const object = await c.env.PHOTOS.head(key);
    if (
      object &&
      object.etag.endsWith(`-${n}`) &&
      object.size > (n - 1) * VIDEO_PART_BYTES &&
      object.size <= n * VIDEO_PART_BYTES &&
      object.size <= MAX_VIDEO_BYTES
    ) {
      return c.json({ key });
    }
    if (GONE_CODES.includes(r2Code(err) as number)) return gone(c);
    throw err;
  }
}

/**
 * Drops an upload the phone gave up on (Discard). Always 200 once authorised: the
 * client ignores the answer, the bucket's 7-day rule drops anything left, and an
 * R2 error message is not worth echoing. Already gone (10024) is silent.
 */
export async function handleVideoAbort(c: Ctx) {
  const ok = await guard(c, { needsUploadId: true, maxBody: 0 });
  if (!('jobId' in ok)) return ok.res;
  try {
    await c.env.PHOTOS.resumeMultipartUpload(objectKey(ok.jobId, 'video'), ok.uploadId).abort();
  } catch (err) {
    if (r2Code(err) !== NO_SUCH_UPLOAD) console.warn('video abort failed', r2Code(err), err);
  }
  return c.json({ ok: true });
}
