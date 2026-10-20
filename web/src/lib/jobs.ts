import { supabase } from './supabase';
import { uploadPhoto, HttpError } from './workerApi';
import { searchTerm } from './search';
import { vinChecksumValid } from './vin';
import type { Job, PhotoKind } from './types';

/** The optional slots, in the order they are filled. Matches migration 0005. */
export const EXTRA_KINDS: PhotoKind[] = ['extra_1', 'extra_2', 'extra_3'];
export const MAX_EXTRA_PHOTOS = EXTRA_KINDS.length;

/**
 * True when retrying `submitJob` with the same payload can never succeed: a
 * 4xx from the Worker, or a Postgres RLS rejection (42501). Anything else is
 * treated as transient so an outage never drops data.
 */
export function isPermanentError(err: unknown): boolean {
  if (err instanceof HttpError) return err.status >= 400 && err.status < 500;
  const code = (err as { code?: string } | null | undefined)?.code;
  return code === '42501'; // insufficient_privilege — RLS denied the write
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
    // Computed here so jobs queued offline get it too. No VIN, nothing to match.
    const duplicateOfJobId = vin ? await findRecentDuplicate(payload.siteId, vin) : null;

    // worker_price is absent on purpose: a trigger stamps it from the service catalog (0005).
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
        duplicate_of_job_id: duplicateOfJobId,
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
    ...(payload.videoBlob ? [{ kind: 'video' as PhotoKind, blob: payload.videoBlob }] : []),
  ];

  /* ponytail: a retry re-sends every upload, even ones that landed. Skip kinds already in R2 if mobile data becomes a concern. */

  const keys = await Promise.all(uploads.map((u) => uploadPhoto(jobId, u.kind, u.blob)));

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

/**
 * Writes a job's billing code / manager note to `job_billing` (migration 0023),
 * which only the site's managers and admins can access. Only passed fields change.
 */
export function saveBilling(jobId: string, fields: { billing_code?: string | null; manager_note?: string | null }) {
  return supabase.from('job_billing').upsert({ job_id: jobId, ...fields }, { onConflict: 'job_id' });
}

/**
 * Flags jobs with the same VIN at the same site in the last 7 days. A security
 * definer RPC returns only a job id, since workers can't SELECT others' jobs (0003).
 */
export async function findRecentDuplicate(siteId: string, vin: string): Promise<string | null> {
  const { data } = await supabase.rpc('find_recent_duplicate', { p_site_id: siteId, p_vin: vin });
  return (data as string | null) ?? null;
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
