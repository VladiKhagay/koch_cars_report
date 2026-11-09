import { parsePrice } from '../lib/clientPrices';
import { toLocalInput } from '../lib/formatDate';
import type { Job } from '../lib/types';
import { normalizeVehicle } from '../lib/vin';

/** One service line's money as typed by an admin (strings: they live in inputs). */
export interface LineMoney {
  pay: string;
  unit: string;
  total: string;
}

export interface LineWrite extends LineMoney {
  sid: string;
  payChanged: boolean;
  pricesChanged: boolean;
}

/**
 * The per-line writes an admin's JobDetail save makes (0033). Only lines on
 * the job after the save (a removed line is gone, its client-price row with
 * it), and only where the typed value differs from the line's default (its
 * snapshot, or the catalog price a new line gets), so an untouched new line
 * keeps the database's own snapshot. `invalid`: a changed pay that is blank or
 * not a number, or a typed client price that is not one (blank prices are allowed).
 */
export function lineWrites(
  serviceIds: string[],
  defaults: Record<string, LineMoney>,
  drafts: Record<string, Partial<LineMoney>>,
): { writes: LineWrite[]; invalid: boolean } {
  const writes = serviceIds.flatMap((sid) => {
    const d = defaults[sid] ?? { pay: '', unit: '', total: '' };
    const v = { ...d, ...drafts[sid] };
    const payChanged = v.pay !== d.pay;
    const pricesChanged = v.unit !== d.unit || v.total !== d.total;
    return payChanged || pricesChanged ? [{ sid, ...v, payChanged, pricesChanged }] : [];
  });
  const bad = (s: string) => s.trim() !== '' && parsePrice(s) === null;
  const invalid = writes.some((w) => (w.payChanged && parsePrice(w.pay) === null) || bad(w.unit) || bad(w.total));
  return { writes, invalid };
}

/**
 * A job needs at least one service, except a legacy job that never had a line
 * (null service_id before 0033): it may still save its other fields as long as
 * nobody picked a service for it. Once it had lines, emptying them is refused.
 */
export const missingServices = (original: string[], picked: string[]) =>
  picked.length === 0 && original.length > 0;

/** What a manager/admin has typed into JobDetail's job fields (strings: they live in inputs). */
export interface JobFieldDraft {
  plate: string;
  vin: string;
  brand: string;
  workerNote: string;
  /** `datetime-local` value. */
  date: string;
  /** '' = keep the job's. */
  workerId: string;
  coworkerIds: string[];
  /** '' = keep the job's. */
  siteId: string;
}

export type JobFieldsBase = Pick<Job, 'plate' | 'vin' | 'brand' | 'worker_note' | 'created_at' | 'worker_id' | 'site_id'>;

const trimmedOrNull = (v: string | null | undefined) => v?.trim() || null;

/**
 * JobDetail's jobs-row update and its validation gate, in one place so the
 * inline errors and what Save sends cannot drift. Only what changed is sent:
 * an untouched plate/VIN must not re-run the duplicate check, and an old job
 * holding a plate from before today's rule must stay saveable untouched. So
 * plate/VIN format is checked only on a changed value; a VIN check-digit
 * failure only sets vin_valid_checksum false (a warning, never blocking). The
 * date must not be empty or in the future, and is checked only when changed
 * (a phone clock behind the server never blocks a job logged moments ago).
 */
export function planJobEdit(job: JobFieldsBase, d: JobFieldDraft, now: number) {
  const plateChanged = d.plate !== (job.plate ?? '');
  const vinChanged = d.vin !== (job.vin ?? '');
  const n = normalizeVehicle({ plate: d.plate, vin: d.vin });
  const vehicle = { ...n, plateError: plateChanged && n.plateError, vinError: vinChanged && n.vinError };
  const dateChanged = d.date !== toLocalInput(job.created_at);
  const dateError = dateChanged && (!d.date || new Date(d.date).getTime() > now);
  const workerId = d.workerId || job.worker_id;
  const brand = trimmedOrNull(d.brand);
  const workerNote = trimmedOrNull(d.workerNote);
  const changes = {
    worker_id: workerId,
    // The submitter can't also be their own co-worker (the trigger would drop them anyway).
    coworker_ids: d.coworkerIds.filter((id) => id !== workerId),
    site_id: d.siteId || job.site_id,
    ...(plateChanged ? { plate: vehicle.plate } : {}),
    ...(vinChanged ? { vin: vehicle.vin, vin_valid_checksum: vehicle.vinChecksum } : {}),
    ...(brand !== trimmedOrNull(job.brand) ? { brand } : {}),
    ...(workerNote !== trimmedOrNull(job.worker_note) ? { worker_note: workerNote } : {}),
    ...(dateChanged && !dateError ? { created_at: new Date(d.date).toISOString() } : {}),
  };
  const blocked = vehicle.plateError || vehicle.vinError || vehicle.missingBoth || dateError;
  return { vehicle, dateError, plateChanged, vinChanged, blocked, changes };
}
