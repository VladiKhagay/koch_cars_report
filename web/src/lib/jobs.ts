import { supabase } from './supabase';
import { uploadPhoto } from './workerApi';
import { searchTerm } from './search';
import { vinChecksumValid } from './vin';
import type { PhotoKind } from './types';

/** The optional slots, in the order they are filled. Matches migration 0005. */
export const EXTRA_KINDS: PhotoKind[] = ['extra_1', 'extra_2', 'extra_3'];
export const MAX_EXTRA_PHOTOS = EXTRA_KINDS.length;

export interface NewJobPayload {
  siteId: string;
  workerId: string;
  plate: string;
  /** Optional: `null` (or empty) when the VIN could not be read off the car. */
  vin: string | null;
  brand: string | null;
  workerNote: string | null;
  serviceId: string;
  plateBlob: Blob;
  vinBlob: Blob;
  /** Up to three optional photos — damage, interior, anything worth a record. */
  extraBlobs?: Blob[];
  /**
   * ponytail: pre-0005 payloads sat in IndexedDB with a multi-service list.
   * Read once in submitJob so a job queued on a phone before this deploy still
   * lands with its service. Delete this field once every device has flushed —
   * the queue drains on the next connection, so a week is generous.
   */
  serviceIds?: string[];
  /**
   * Set by submitJob once the row exists, so a retry after a failed UPLOAD
   * resumes instead of inserting the job a second time. See the note below.
   */
  jobId?: string;
}

/**
 * Creates a job row, then uploads its photos. Photos go up AFTER the row
 * exists (the Worker's /upload endpoint checks visibility by asking Supabase
 * "can this caller see job <id>?" — see worker/src/upload.ts — so the job must
 * exist first).
 *
 * That ordering has a consequence worth stating: if the insert succeeds and an
 * upload then fails, the caller queues the payload and retries. Without the
 * `jobId` carried on the payload, that retry would insert a SECOND job for the
 * same car — inflating the day's count, the export and the payroll sheet, with
 * nothing on screen to suggest it happened. Three optional photos make that
 * path considerably more likely than two required ones did, so the id is
 * recorded on the payload before any upload starts.
 */
export async function submitJob(payload: NewJobPayload): Promise<string> {
  const plate = payload.plate.toUpperCase().trim();
  /* An absent VIN is stored as NULL, never as '' — an empty string is a value,
     and it would collide with every other blank one in the duplicate check and
     sort into the middle of the VIN index as if it were a real VIN. */
  const vin = payload.vin?.toUpperCase().trim() || null;

  let jobId = payload.jobId;

  if (!jobId) {
    // Computed here (not just as a UI hint) so it's also correct for jobs that
    // were queued offline and submitted later by the retry queue, which never
    // ran the interactive duplicate check at capture time. With no VIN there is
    // nothing to match on, so no duplicate is claimed.
    const duplicateOfJobId = vin ? await findRecentDuplicate(payload.siteId, vin) : null;

    // worker_price is deliberately absent: a database trigger stamps it from the
    // service catalog (migration 0005). Sending it from here would be ignored for
    // the worker role anyway, and would read as if the client set the pay.
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
    { kind: 'plate', blob: payload.plateBlob },
    { kind: 'vin', blob: payload.vinBlob },
    ...extras.map((blob, i) => ({ kind: EXTRA_KINDS[i], blob })),
  ];

  const keys = await Promise.all(uploads.map((u) => uploadPhoto(jobId, u.kind, u.blob)));

  /* ponytail: a retry that got past the uploads and failed on this insert will
     write the photo rows twice. The R2 key is derived from job id + kind, so
     the objects themselves are overwritten rather than duplicated, and the
     viewer fetches by kind — a duplicate row is invisible. Add a unique index
     on (job_id, kind) and upsert here if that ever stops being true. */
  const { error: photoError } = await supabase
    .from('photos')
    .insert(uploads.map((u, i) => ({ job_id: jobId, kind: u.kind, r2_key: keys[i] })));
  if (photoError) throw photoError;

  return jobId;
}

/**
 * Flags jobs with the same VIN at the same site in the last 7 days.
 * Goes through a security definer RPC because workers can no longer SELECT
 * other workers' job rows directly (migration 0003) — the function returns
 * only a job id, never the row.
 */
export async function findRecentDuplicate(siteId: string, vin: string): Promise<string | null> {
  const { data } = await supabase.rpc('find_recent_duplicate', { p_site_id: siteId, p_vin: vin });
  return (data as string | null) ?? null;
}

/* ------------------------------------------------------------ grid filters */

/** What the jobs grid narrows by. Every field is optional; absent means "any". */
export interface JobFilters {
  siteId?: string | null;
  workerId?: string;
  serviceId?: string;
  /** Local calendar days, `yyyy-mm-dd`, inclusive at both ends. */
  from?: string;
  to?: string;
  /** Raw box contents — sanitised here, never interpolated as typed. */
  search?: string;
}

/**
 * The chain of `PostgrestFilterBuilder` methods this narrowing uses. Declared
 * structurally so the composition can be exercised against a recorder in a
 * test — the alternative is discovering a dropped `.eq` when a payroll figure
 * comes out wrong.
 */
interface JobQuery<Q> {
  eq(column: string, value: string): Q;
  gte(column: string, value: string): Q;
  lte(column: string, value: string): Q;
  or(filter: string): Q;
}

/**
 * Applies the grid's filters to a jobs query, in Postgres.
 *
 * All of it is server-side on purpose: at ~3,000 jobs a month, narrowing a
 * page of 50 rows that the database already chose would be filtering the
 * wrong set — the row you are looking for is usually not on it.
 */
export function applyJobFilters<Q extends JobQuery<Q>>(query: Q, filters: JobFilters): Q {
  let q = query;
  if (filters.siteId) q = q.eq('site_id', filters.siteId);
  if (filters.workerId) q = q.eq('worker_id', filters.workerId);
  if (filters.serviceId) q = q.eq('service_id', filters.serviceId);

  // Dates are local calendar days; the column is a timestamptz, so each day is
  // widened to its full local span rather than compared against midnight UTC.
  if (filters.from) q = q.gte('created_at', new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to) q = q.lte('created_at', new Date(`${filters.to}T23:59:59.999`).toISOString());

  /* A job with no VIN simply doesn't match a VIN search: `ilike` against NULL
     is NULL, not a match, which is the right answer — a blank field is not a
     hit for every query. */
  const term = searchTerm(filters.search ?? '');
  if (term) q = q.or(`plate.ilike.%${term}%,vin.ilike.%${term}%,billing_code.ilike.%${term}%`);

  return q;
}
