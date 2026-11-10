/**
 * The non-visual parts of the worker's two screens (New Job, My Jobs) that
 * multi-service jobs (0033) touch, kept out of the components so they can be
 * tested without a DOM.
 */
import { supabase } from '../lib/supabase';
import { setJobServices } from '../lib/jobs';
import type { Job, JobServiceLine, Service } from '../lib/types';

/** Adds the id if absent, removes it if present. */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/**
 * A saved New Job draft, read forward: drafts written before 0033 carry one
 * `serviceId`; it becomes `serviceIds` so a half-filled form survives the update.
 */
export function migrateDraft<T extends { serviceIds: string[] }>(
  draft: Partial<T> & { serviceId?: string | null },
): Partial<T> {
  const { serviceId, ...rest } = draft;
  const ids = Array.isArray(rest.serviceIds) ? rest.serviceIds : [];
  return { ...rest, serviceIds: ids.length === 0 && serviceId ? [serviceId] : ids } as unknown as Partial<T>;
}

/**
 * The chips a job's editor offers: today's active services, plus any already on
 * the job that have since been retired or deleted (built from the job's own
 * line), so the worker can still see and untick them.
 */
export function editableServices(active: Service[], lines: JobServiceLine[] | null | undefined): Service[] {
  const extra = (lines ?? [])
    .filter((line) => !active.some((s) => s.id === line.service_id))
    .map<Service>((line) => ({
      id: line.service_id,
      name_en: line.name_en,
      name_ru: line.name_ru,
      name_he: line.name_he,
      catalog_number: line.catalog_number,
      worker_price: line.worker_price,
      active: false,
      sort_order: Number.MAX_SAFE_INTEGER,
      deleted_at: null,
    }));
  return [...active, ...extra];
}

export interface WorkerEdit {
  note: string;
  serviceIds: string[];
  siteId: string;
  coworkerIds: string[];
}

/**
 * Saves a worker's edit of their own job. Services go first, and only if they
 * changed: set_job_services keeps the snapshot of lines already on the job, so
 * an untouched list must not be rewritten. Pay is never sent; the database
 * re-totals it. Stops at the first failure and says which write failed.
 */
export async function saveWorkerEdit(
  job: Pick<Job, 'id' | 'service_ids'>,
  draft: WorkerEdit,
): Promise<'services' | 'job' | null> {
  const before = new Set(job.service_ids ?? []);
  const after = new Set(draft.serviceIds);
  const changed = before.size !== after.size || [...after].some((id) => !before.has(id));
  if (changed) {
    const { error } = await setJobServices(job.id, draft.serviceIds);
    if (error) return 'services';
  }
  const { error } = await supabase
    .from('jobs')
    .update({
      worker_note: draft.note || null,
      site_id: draft.siteId,
      coworker_ids: draft.coworkerIds,
    })
    .eq('id', job.id);
  return error ? 'job' : null;
}

/**
 * What the worker's edit panel offers for a job's media (0035):
 *   'open'    own job, window open: add/replace/remove (plate/VIN replace only);
 *   'queued'  own job, window open, but the offline queue still holds an entry
 *             for it, sending or failed (needsAttention): editing now would race
 *             the queue's upload of the same slot, and a later Retry re-uploads
 *             the originals over a manual replace. Wait, or Retry/Discard it;
 *   'closed'  someone else's job, or the window has closed: read-only.
 * The database enforces the same window; this only decides what to show.
 */
export function mediaEditState(
  job: Pick<Job, 'id' | 'worker_id' | 'locked_at'>,
  userId: string | undefined,
  queued: readonly { jobId?: string }[],
  now = Date.now(),
): 'open' | 'queued' | 'closed' {
  if (!userId || job.worker_id !== userId || new Date(job.locked_at).getTime() <= now) return 'closed';
  return queued.some((e) => e.jobId === job.id) ? 'queued' : 'open';
}

/**
 * The job whose media change holds My Jobs (`busyJobId`), after `jobId`'s panel
 * reports busy or settled. A settle only frees its own job, so a late settle
 * from a panel that has gone can never free (or hold) another job's.
 */
export function nextBusyJob(cur: string | null, jobId: string, busy: boolean): string | null {
  return busy ? jobId : cur === jobId ? null : cur;
}
