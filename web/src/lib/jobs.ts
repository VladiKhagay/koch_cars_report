import { supabase } from './supabase';
import { uploadPhoto } from './workerApi';
import { vinChecksumValid } from './vin';
import type { PhotoKind } from './types';

/** The optional slots, in the order they are filled. Matches migration 0005. */
export const EXTRA_KINDS: PhotoKind[] = ['extra_1', 'extra_2', 'extra_3'];
export const MAX_EXTRA_PHOTOS = EXTRA_KINDS.length;

export interface NewJobPayload {
  siteId: string;
  workerId: string;
  plate: string;
  vin: string;
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
  const vin = payload.vin.toUpperCase().trim();

  let jobId = payload.jobId;

  if (!jobId) {
    // Computed here (not just as a UI hint) so it's also correct for jobs that
    // were queued offline and submitted later by the retry queue, which never
    // ran the interactive duplicate check at capture time.
    const duplicateOfJobId = await findRecentDuplicate(payload.siteId, vin);

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
        vin_valid_checksum: vinChecksumValid(vin),
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
