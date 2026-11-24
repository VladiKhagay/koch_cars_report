/**
 * The non-visual parts of the worker's two screens (New Job, My Jobs) that
 * multi-service jobs (0033) touch, kept out of the components so they can be
 * tested without a DOM.
 */
import { supabase } from '../lib/supabase';
import { setJobServices } from '../lib/jobs';
import type { AppUser, Job, JobServiceLine, Service, Site, StaffMember } from '../lib/types';

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

/** jobs.worker_label's length CHECK (0040). */
export const MAX_WORKER_LABEL = 60;

/* Exactly the characters jobs.worker_label's CHECK refuses (0040): control
   characters, soft hyphen, and the invisible direction/zero-width marks a
   pasted Hebrew name often carries. Left in, the job fails at the database
   (23514) after the form said it was fine. */
// oxlint-disable-next-line no-control-regex
const LABEL_REFUSED = /[\u0001-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g;

/**
 * A typed worker name the database will take: refused characters stripped,
 * at most MAX_WORKER_LABEL. `typing` keeps outer spaces (a space typed between
 * two words is trailing until the next letter); the stored form is trimmed.
 */
export function cleanWorkerLabel(raw: string, { typing = false } = {}): string {
  const s = raw.replace(LABEL_REFUSED, '');
  return typing ? s.slice(0, MAX_WORKER_LABEL) : s.trim().slice(0, MAX_WORKER_LABEL);
}

/** New Job's Worker field (0040): who a manager/admin may log a car for. */
export function isStaffSubmitter(role: AppUser['role'] | undefined): boolean {
  return role === 'manager' || role === 'admin';
}

/**
 * Who owns a New Job submission. A worker always owns their own car with no
 * label, whatever a draft on this (shared) phone says. A manager/admin either
 * picked a worker (that worker owns it) or typed a name (they own it, the name
 * rides as `worker_label`). The database enforces the same rules (0040).
 */
export function jobOwnership(
  appUser: Pick<AppUser, 'id' | 'role'>,
  form: { workerId: string; workerLabel: string },
): { workerId: string; workerLabel: string | null; submittedBy: string } {
  if (!isStaffSubmitter(appUser.role)) return { workerId: appUser.id, workerLabel: null, submittedBy: appUser.id };
  return {
    workerId: form.workerId || appUser.id,
    workerLabel: form.workerId ? null : cleanWorkerLabel(form.workerLabel) || null,
    submittedBy: appUser.id,
  };
}

/**
 * The site a New Job is logged at. A manager only ever at their own (the
 * database refuses anything else). An admin: their pick, else the picked
 * worker's site (that is where the car was done), else their home site, else
 * the site they are looking at elsewhere in the app; a fallback known to be
 * disabled (0041, from `sites`) is skipped, unless all are (then the first, so
 * the form says the site is disabled). A worker: pick or home.
 */
export function jobSiteId(
  appUser: Pick<AppUser, 'role' | 'site_id'>,
  picked: string | null,
  scopeSiteId: string | null,
  workerSiteId: string | null = null,
  sites: Pick<Site, 'id' | 'active'>[] = [],
): string | null {
  if (appUser.role === 'manager') return appUser.site_id;
  if (appUser.role === 'admin') {
    if (picked) return picked;
    const fallbacks = [workerSiteId, appUser.site_id, scopeSiteId].filter((id): id is string => id != null);
    return fallbacks.find((id) => siteAcceptsJobs(sites, id)) ?? fallbacks[0] ?? null;
  }
  return picked ?? appUser.site_id;
}

/**
 * Whether New Job may submit at `siteId`: false only for a site known to be
 * disabled (0041; the database refuses it with 42501). Unknown (sites still
 * loading) counts as yes, so the form never blocks on a slow request.
 */
export function siteAcceptsJobs(sites: Pick<Site, 'id' | 'active'>[], siteId: string | null): boolean {
  return sites.find((s) => s.id === siteId)?.active !== false;
}

/**
 * The workers a manager/admin may log a car for: active workers; a manager's
 * own site only (a manager with no site gets nobody, never the site-less workers).
 */
export function pickableWorkers(staff: StaffMember[], appUser: Pick<AppUser, 'role' | 'site_id'>): StaffMember[] {
  return staff.filter(
    (s) =>
      s.active &&
      s.role === 'worker' &&
      (appUser.role === 'admin' || (appUser.site_id != null && s.site_id === appUser.site_id)),
  );
}

/** The pickable worker whose name is exactly what was typed (case and outer spaces ignored), if any. */
export function workerNamed(workers: StaffMember[], typed: string): StaffMember | undefined {
  const name = cleanWorkerLabel(typed).toLowerCase();
  return name ? workers.find((w) => w.name.trim().toLowerCase() === name) : undefined;
}

/**
 * My Jobs' "with …" names: everyone on the job but the reader. The submitter of
 * a typed-name job (0040) is shown by that name, not as the manager who logged it.
 */
export function crewOthers(
  job: Pick<Job, 'worker_id' | 'coworker_ids' | 'worker_label'>,
  readerId: string | undefined,
  staff: StaffMember[],
): string[] {
  return [job.worker_id, ...(job.coworker_ids ?? [])]
    .filter((id) => id !== readerId)
    .flatMap((id) => {
      if (id === job.worker_id && job.worker_label) return [job.worker_label];
      const name = staff.find((s) => s.id === id)?.name;
      return name ? [name] : [];
    });
}
