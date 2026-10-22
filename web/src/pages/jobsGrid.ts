import type { CarassoJob } from '../lib/types';

/**
 * What the grid shows of a job, whichever view it came from. Managers and
 * admins read `jobs_manager` (crew is resolved from ids); Carasso reads
 * `jobs_carasso` (crew arrives as a string, or null while names are hidden).
 * No money: the list never shows pay or client prices.
 */
export interface JobRow {
  id: string;
  site_id: string;
  created_at: string;
  plate: string | null;
  vin: string | null;
  brand: string | null;
  billing_code: string | null;
  duplicate_of_job_id: string | null;
  coworker_ids: string[];
  worker: { id: string; name: string } | null;
  /** Carasso only: everyone on the job, already joined. */
  crew: string | null;
  service: { name_en: string; name_ru: string | null; name_he: string | null } | null;
}

/** A `jobs_carasso` row in the grid's shape. Pure, so it is testable. */
export function carassoRow(r: CarassoJob): JobRow {
  return {
    id: r.id,
    site_id: r.site_id,
    created_at: r.created_at,
    plate: r.plate,
    vin: r.vin,
    brand: r.brand,
    billing_code: r.billing_code,
    duplicate_of_job_id: null,
    coworker_ids: [],
    worker: null,
    crew: r.crew,
    service: r.service_name_en
      ? { name_en: r.service_name_en, name_ru: r.service_name_ru, name_he: r.service_name_he }
      : null,
  };
}

/** Which columns the grid offers: pure, so the role rules are testable. */
export function gridColumnPlan(opts: { isCarasso: boolean; showSite: boolean; hideNames: boolean }) {
  return {
    site: opts.showSite,
    worker: !(opts.isCarasso && opts.hideNames),
    // Carasso reads the reservation number; it never edits it or sees duplicate flags.
    editBilling: !opts.isCarasso,
    flags: !opts.isCarasso,
  };
}

