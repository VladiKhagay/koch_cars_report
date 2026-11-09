import type { CarassoJob } from '../lib/types';
import type { ServiceNames } from '../lib/serviceName';
import { expandJobRows, type ServiceRowMode } from '../lib/serviceRows';

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
  /** The job's services, names only (the views' lines also carry pay or client prices). */
  services: ServiceNames[];
}

/** A view's service lines cut down to their names, so no money ever reaches a grid row. */
export function gridServices(lines: ServiceNames[] | null | undefined): ServiceNames[] {
  return (lines ?? []).map(({ name_en, name_ru, name_he }) => ({ name_en, name_ru, name_he }));
}

/** A `jobs_manager` row in the grid's shape: names-only services, crew resolved later from ids. */
export function managerRow(r: Omit<JobRow, 'crew' | 'services'> & { services?: ServiceNames[] | null }): JobRow {
  return {
    id: r.id,
    site_id: r.site_id,
    created_at: r.created_at,
    plate: r.plate,
    vin: r.vin,
    brand: r.brand,
    billing_code: r.billing_code,
    duplicate_of_job_id: r.duplicate_of_job_id,
    coworker_ids: r.coworker_ids ?? [],
    worker: r.worker,
    crew: null,
    services: gridServices(r.services),
  };
}

/**
 * The rows the grid draws from one fetched page: as-is (grouped), or one per
 * service (separate). Paging and the count stay per job; only this page expands.
 */
export function gridRows(rows: JobRow[], mode: ServiceRowMode): JobRow[] {
  return mode === 'separate' ? rows.flatMap((r) => expandJobRows(r)) : rows;
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
    // A row without `services` (older view) falls back to the joined names, as one entry.
    services: r.services
      ? gridServices(r.services)
      : r.service_name_en
        ? [{ name_en: r.service_name_en, name_ru: r.service_name_ru, name_he: r.service_name_he }]
        : [],
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

