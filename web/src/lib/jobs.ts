import { supabase } from './supabase';
import { uploadPhoto } from './workerApi';
import { vinChecksumValid } from './vin';

export interface NewJobPayload {
  siteId: string;
  workerId: string;
  plate: string;
  vin: string;
  brand: string | null;
  workerNote: string | null;
  serviceIds: string[];
  plateBlob: Blob;
  vinBlob: Blob;
}

/**
 * Creates a job row, then uploads both photos. Photos are uploaded AFTER
 * the row exists (the Worker's /upload endpoint checks photo visibility by
 * asking Supabase "can this caller see job <id>?" — see worker/src/upload.ts —
 * so the job must exist first).
 */
export async function submitJob(payload: NewJobPayload): Promise<string> {
  const plate = payload.plate.toUpperCase().trim();
  const vin = payload.vin.toUpperCase().trim();

  // Computed here (not just as a UI hint) so it's also correct for jobs that
  // were queued offline and submitted later by the retry queue, which never
  // ran the interactive duplicate check at capture time.
  const duplicateOfJobId = await findRecentDuplicate(payload.siteId, vin);

  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      site_id: payload.siteId,
      worker_id: payload.workerId,
      plate,
      vin,
      vin_valid_checksum: vinChecksumValid(vin),
      brand: payload.brand,
      worker_note: payload.workerNote,
      duplicate_of_job_id: duplicateOfJobId,
    })
    .select('id')
    .single();

  if (error || !job) throw error ?? new Error('Job creation failed');

  if (payload.serviceIds.length > 0) {
    const { error: svcError } = await supabase
      .from('job_services')
      .insert(payload.serviceIds.map((service_id) => ({ job_id: job.id, service_id })));
    if (svcError) throw svcError;
  }

  const [plateKey, vinKey] = await Promise.all([
    uploadPhoto(job.id, 'plate', payload.plateBlob),
    uploadPhoto(job.id, 'vin', payload.vinBlob),
  ]);

  const { error: photoError } = await supabase.from('photos').insert([
    { job_id: job.id, kind: 'plate', r2_key: plateKey },
    { job_id: job.id, kind: 'vin', r2_key: vinKey },
  ]);
  if (photoError) throw photoError;

  return job.id as string;
}

/** Flags jobs with the same VIN at the same site in the last 7 days. */
export async function findRecentDuplicate(siteId: string, vin: string): Promise<string | null> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('jobs')
    .select('id')
    .eq('site_id', siteId)
    .eq('vin', vin.toUpperCase().trim())
    .is('deleted_at', null)
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false })
    .limit(1);
  return data && data.length > 0 ? data[0].id : null;
}
