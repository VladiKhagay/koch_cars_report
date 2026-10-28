import { supabase } from './supabase';
import {
  uploadPhoto,
  HttpError,
  startVideoUpload,
  uploadVideoPart,
  completeVideoUpload,
  PIECE_TIMEOUT_MS,
} from './workerApi';
import { VIDEO_PART_BYTES } from './video';
import { searchTerm } from './search';
import { vinChecksumValid } from './vin';
import type { Job, PhotoKind, PreviousJob } from './types';

/** The optional slots, in the order they are filled. Matches migration 0005. */
export const EXTRA_KINDS: PhotoKind[] = ['extra_1', 'extra_2', 'extra_3'];
export const MAX_EXTRA_PHOTOS = EXTRA_KINDS.length;

/**
 * True when retrying `submitJob` with the same payload can never succeed: a
 * 4xx from the Worker, or a Postgres RLS rejection (42501). Anything else is
 * treated as transient so an outage never drops data. 401 (token mid-refresh),
 * 408 and 429 (rate limit hit while flushing a backlog) clear on their own.
 */
const RETRYABLE_4XX = [401, 408, 429];

export function isPermanentError(err: unknown): boolean {
  if (err instanceof HttpError) {
    return err.status >= 400 && err.status < 500 && !RETRYABLE_4XX.includes(err.status);
  }
  const code = (err as { code?: string } | null | undefined)?.code;
  return code === '42501'; // insufficient_privilege — RLS denied the write
}

/** The Worker asking us to slow down: not retried within a run, and not a failed attempt. */
export function isRateLimited(err: unknown): boolean {
  return err instanceof HttpError && err.status === 429;
}

export interface NewJobPayload {
  siteId: string;
  workerId: string;
  /** Optional: `null` (or empty) when the car has no physical plate. At least one of plate/vin must be set. */
  plate: string | null;
  /** Optional: `null` (or empty) when the VIN could not be read off the car. */
  vin: string | null;
  brand: string | null;
  workerNote: string | null;
  serviceId: string;
  /** Up to two co-workers. Absent on payloads queued before migration 0019. */
  coworkerIds?: string[];
  /** `null` when no plate photo was taken (e.g. the car has no plate). */
  plateBlob: Blob | null;
  /** `null` when no VIN photo was taken; the VIN is often unreadable, so it can't be required. */
  vinBlob: Blob | null;
  /** Up to three optional photos — damage, interior, anything worth a record. */
  extraBlobs?: Blob[];
  /** Optional condition video (≤2 min, recorded in-app). Missing on payloads queued before it existed. */
  videoBlob?: Blob | null;
  /**
   * Legacy: pre-0005 payloads queued a multi-service list. Read once in
   * submitJob; delete once every device has flushed its queue.
   */
  serviceIds?: string[];
  /** Set once the row exists, so a retry after a failed upload resumes instead of inserting a second job. */
  jobId?: string;
}

/**
 * Creates a job row, then uploads its photos (the Worker's /upload checks the
 * job exists). `jobId` is recorded on the payload before any upload starts so
 * a retry never inserts a second job for the same car.
 */
export async function submitJob(payload: NewJobPayload): Promise<string> {
  /* An absent plate or VIN is NULL, never '': an empty string would collide in the duplicate check. */
  const plate = payload.plate?.toUpperCase().trim() || null;
  const vin = payload.vin?.toUpperCase().trim() || null;

  // A job needs a plate or a VIN; guarded here for retry-queue payloads and direct callers.
  if (!plate && !vin) throw new Error('Job requires a plate or a VIN');

  let jobId = payload.jobId;

  if (!jobId) {
    // worker_price is absent on purpose: a trigger stamps it from the service catalog (0005).
    // So is duplicate_of_job_id: the database flags a repeat VIN or plate on insert (0029),
    // which also covers jobs queued offline.
    const { data: job, error } = await supabase
      .from('jobs')
      .insert({
        site_id: payload.siteId,
        worker_id: payload.workerId,
        plate,
        vin,
        vin_valid_checksum: vin ? vinChecksumValid(vin) : null,
        brand: payload.brand,
        service_id: payload.serviceId ?? payload.serviceIds?.[0] ?? null,
        // Same insert as the job itself, so a retry can never land the car
        // without its crew (or the crew twice).
        coworker_ids: payload.coworkerIds ?? [],
        worker_note: payload.workerNote,
      })
      .select('id')
      .single();

    if (error || !job) throw error ?? new Error('Job creation failed');

    jobId = job.id as string;
    // Mutating the caller's object on purpose: it is the same object handed to
    // enqueueForRetry, and IndexedDB stores it as-is.
    payload.jobId = jobId;
  }

  const extras = (payload.extraBlobs ?? []).slice(0, MAX_EXTRA_PHOTOS);
  const uploads: { kind: PhotoKind; blob: Blob }[] = [
    // A job with no plate/VIN photo simply has no row of that kind, rather
    // than an empty object standing in for one.
    ...(payload.plateBlob ? [{ kind: 'plate' as PhotoKind, blob: payload.plateBlob }] : []),
    ...(payload.vinBlob ? [{ kind: 'vin' as PhotoKind, blob: payload.vinBlob }] : []),
    ...extras.map((blob, i) => ({ kind: EXTRA_KINDS[i], blob })),
    // The video is never sent here: it follows as its own queue entry (submitVideo),
    // so Submit does not wait on a 75MB upload. videoBlob stays on the payload
    // only so a queued entry can hand it over (see flushQueue).
  ];

  /* ponytail: a retry re-sends every upload, even ones that landed. Skip kinds already in R2 if mobile data becomes a concern. */

  const keys = await Promise.all(uploads.map((u) => uploadPhoto(jobId, u.kind, u.blob)));

  // A car with no photos at all (plate and VIN photos are optional) has nothing to record.
  if (uploads.length === 0) return jobId;

  // Unique on (job_id, kind) since 0022: a retry that already wrote these rows is a no-op.
  const { error: photoError } = await supabase
    .from('photos')
    .upsert(
      uploads.map((u, i) => ({ job_id: jobId, kind: u.kind, r2_key: keys[i] })),
      { onConflict: 'job_id,kind', ignoreDuplicates: true },
    );
  if (photoError) throw photoError;

  return jobId;
}

/** Where a resumable video upload got to: the R2 upload and every piece that landed, in order. */
export type VideoUpload = { uploadId: string; partSize: number; parts: { partNumber: number; etag: string }[] };

/**
 * Saved state is only trusted if it was made with today's piece size and has
 * pieces exactly 1..k, at most as many as a clip of `size` bytes has.
 */
export function resumable(u: VideoUpload | null | undefined, size: number): u is VideoUpload {
  const totalParts = Math.max(1, Math.ceil(size / VIDEO_PART_BYTES));
  return (
    !!u &&
    typeof u.uploadId === 'string' &&
    u.partSize === VIDEO_PART_BYTES &&
    Array.isArray(u.parts) &&
    u.parts.length >= 1 &&
    u.parts.length <= totalParts &&
    u.parts.every((p, i) => p?.partNumber === i + 1 && typeof p.etag === 'string')
  );
}

/** Backoff before the 2nd and 3rd try of one request within a run. */
const RETRY_DELAYS_MS = [2_000, 6_000];

/** A transient failure (dropped signal) is retried here before the whole run gives up. */
async function withRetries<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const gone = err instanceof HttpError && err.status === 410;
      // A 429 is not retried here: these backoffs fall inside the same 60 s limiter window.
      if (gone || isRateLimited(err) || isPermanentError(err) || attempt >= RETRY_DELAYS_MS.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

/**
 * Sends the video in VIDEO_PART_BYTES pieces, continuing `upload` when given.
 * Returns the stored key. Only one piece is read into memory at a time.
 */
async function sendVideoPieces(
  jobId: string,
  blob: Blob,
  upload: VideoUpload | null,
  save: (u: VideoUpload | null) => void | Promise<void>,
): Promise<string> {
  const P = VIDEO_PART_BYTES;
  const totalParts = Math.max(1, Math.ceil(blob.size / P));
  let state = upload;
  if (!state) {
    const started = await withRetries(() => startVideoUpload(jobId, blob.slice(0, P)));
    state = { uploadId: started.uploadId, partSize: P, parts: [{ partNumber: 1, etag: started.etag }] };
    await save(state);
  }
  for (let n = state.parts.length + 1; n <= totalParts; n++) {
    const { uploadId }: VideoUpload = state;
    // A lost response leaves n unrecorded, so the next try simply re-sends the same piece.
    const { etag }: { etag: string } = await withRetries(() => uploadVideoPart(jobId, uploadId, n, blob.slice((n - 1) * P, n * P)));
    state = { ...state, parts: [...state.parts, { partNumber: n, etag }] };
    await save(state);
  }
  const { uploadId, parts } = state;
  const { key } = await withRetries(() => completeVideoUpload(jobId, uploadId, parts));
  return key;
}

/**
 * Uploads a job's condition video and records its row, after the job and its
 * photos already landed. Safe to rerun: when the row exists the clip is in, so
 * nothing is re-sent; the row is written only after the upload succeeded.
 *
 * Resumable: `upload` is where an earlier run got to and `save` is called after
 * every piece, so an interrupted clip continues from its last finished piece.
 * If R2 no longer has the upload (410) the clip starts over, once per run.
 * The caller clears the saved state once this resolves: a failed row write can
 * then rerun complete, which is idempotent on the Worker.
 */
export async function submitVideo(
  jobId: string,
  blob: Blob,
  opts: { upload?: VideoUpload | null; save?: (u: VideoUpload | null) => void | Promise<void> } = {},
): Promise<void> {
  const { data: existing, error: readError } = await supabase
    .from('photos')
    .select('id')
    .eq('job_id', jobId)
    .eq('kind', 'video');
  if (readError) throw readError;
  if (existing?.length) return;

  const save = opts.save ?? (() => {});
  const totalParts = Math.max(1, Math.ceil(blob.size / VIDEO_PART_BYTES));
  let upload: VideoUpload | null = null;
  if (resumable(opts.upload, blob.size)) upload = opts.upload;
  // Stale or foreign state: clear it so nothing (progress, the queue's attempt rule) reads it again.
  else if (opts.upload) await save(null);
  let restarted = false;
  let key: string;
  for (;;) {
    try {
      key = await sendVideoPieces(jobId, blob, upload, save);
      break;
    } catch (err) {
      // ponytail: a 404 from any /video/* call means the Worker predates (or was rolled back from)
      // the resumable routes, since web and Worker deploy separately. Send it the old way; remove
      // once the Worker is everywhere. One request, so allow it as long as its pieces would get.
      if (err instanceof HttpError && err.status === 404) {
        await save(null);
        key = await uploadPhoto(jobId, 'video', blob, totalParts * PIECE_TIMEOUT_MS);
        break;
      }
      if (!(err instanceof HttpError && err.status === 410) || restarted) throw err;
      restarted = true;
      upload = null;
      await save(null);
    }
  }

  const { error } = await supabase
    .from('photos')
    .upsert({ job_id: jobId, kind: 'video', r2_key: key }, { onConflict: 'job_id,kind', ignoreDuplicates: true });
  if (error) throw error;
}

/**
 * Writes a job's billing code / manager note to `job_billing` (migration 0023),
 * which only the site's managers and admins can access. Only passed fields change.
 */
export function saveBilling(jobId: string, fields: { billing_code?: string | null; manager_note?: string | null }) {
  return supabase.from('job_billing').upsert({ job_id: jobId, ...fields }, { onConflict: 'job_id' });
}

/**
 * The most recent earlier job with the same VIN or plate: any site, any time,
 * any service (0029). Returns only date, site and service: no money, no people.
 * Warn-only, so it never throws: offline, or any failure, is "no warning" and
 * the submit goes ahead (the database flags the job on insert regardless).
 * Blank values are never matched.
 */
export async function findPreviousJob(vehicle: { plate?: string | null; vin?: string | null }): Promise<PreviousJob | null> {
  const plate = vehicle.plate?.trim() || null;
  const vin = vehicle.vin?.trim() || null;
  if (!plate && !vin) return null;
  try {
    const { data, error } = await supabase.rpc('find_previous_job', { p_plate: plate, p_vin: vin });
    if (error) return null;
    return ((data ?? []) as PreviousJob[])[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * The job a manager/admin's duplicate flag points at (0029). Reads through a
 * function because the earlier job may be on another site, which jobs RLS hides.
 */
export async function fetchDuplicateSummary(jobId: string): Promise<PreviousJob | null> {
  const { data, error } = await supabase.rpc('duplicate_job_summary', { p_job_id: jobId });
  if (error) return null;
  return ((data ?? []) as PreviousJob[])[0] ?? null;
}

/* ------------------------------------------------------------------- crew */

/** Most co-workers a submitter may add. Mirrors jobs_guard_coworkers (0019). */
export const MAX_COWORKERS = 2;

/** Everyone on the job, submitter first. */
export function crewIds(job: Pick<Job, 'worker_id' | 'coworker_ids'>): string[] {
  return [job.worker_id, ...(job.coworker_ids ?? [])];
}

/** What this person is owed for this job. Postgres did the split — see 0019. */
export function shareFor(
  job: Pick<Job, 'worker_id' | 'submitter_share' | 'coworker_share'>,
  personId: string,
): number {
  return job.worker_id === personId ? job.submitter_share : job.coworker_share;
}

/* ------------------------------------------------------------ grid filters */

/** What the jobs grid narrows by. Every field is optional; absent means "any". */
export interface JobFilters {
  siteId?: string | null;
  /** Matches jobs this person submitted OR co-worked. */
  workerId?: string;
  /** One service or several. An empty list means "any", same as absent. */
  serviceIds?: string[];
  /** Local calendar days, `yyyy-mm-dd`, inclusive at both ends. */
  from?: string;
  to?: string;
  /** Raw box contents — sanitised here, never interpolated as typed. */
  search?: string;
  /** Only jobs still waiting for their reservation number. */
  missingBilling?: boolean;
  /**
   * Columns the term is matched against. The worker screen queries
   * `jobs_worker_view`, which has no billing_code, and PostgREST fails the whole
   * query on an unknown column, so the caller names its own.
   */
  searchColumns?: string[];
}

/** workerId goes into a PostgREST `or` string, so only a real UUID may. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_SEARCH_COLUMNS = ['plate', 'vin', 'billing_code'];

/** The query-builder methods used here, declared structurally so tests can use a recorder. */
interface JobQuery<Q> {
  eq(column: string, value: string): Q;
  in(column: string, values: string[]): Q;
  gte(column: string, value: string): Q;
  lte(column: string, value: string): Q;
  or(filter: string): Q;
}

/** Applies the grid's filters to a jobs query, server-side so paging sees the right set. */
export function applyJobFilters<Q extends JobQuery<Q>>(query: Q, filters: JobFilters): Q {
  let q = query;
  if (filters.siteId) q = q.eq('site_id', filters.siteId);
  // PostgREST ANDs separate `or` params, so this composes with the search below.
  if (filters.workerId && UUID.test(filters.workerId))
    q = q.or(`worker_id.eq.${filters.workerId},coworker_ids.cs.{${filters.workerId}}`);
  if (filters.serviceIds?.length) q = q.in('service_id', filters.serviceIds);

  if (filters.missingBilling) q = q.or('billing_code.is.null');

  // Dates are local calendar days; the column is a timestamptz, so each day is
  // widened to its full local span rather than compared against midnight UTC.
  if (filters.from) q = q.gte('created_at', new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to) q = q.lte('created_at', new Date(`${filters.to}T23:59:59.999`).toISOString());

  /* A NULL column never matches `ilike`, which is right: a blank field is not a hit. */
  const term = searchTerm(filters.search ?? '');
  const columns = filters.searchColumns ?? DEFAULT_SEARCH_COLUMNS;
  if (term) q = q.or(columns.map((c) => `${c}.ilike.%${term}%`).join(','));

  return q;
}
