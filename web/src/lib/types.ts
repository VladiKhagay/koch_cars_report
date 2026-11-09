/**
 * `carasso` is the client's read-only role (migration 0026): it sees jobs and
 * client prices for the sites an admin links to it (`user_sites`), never pay.
 */
export type UserRole = 'worker' | 'manager' | 'admin' | 'carasso';

export interface Site {
  id: string;
  name: string;
}

export interface Service {
  id: string;
  name_en: string;
  /** Optional translations. NULL falls back to `name_en` — see serviceName(). */
  name_ru: string | null;
  name_he: string | null;
  catalog_number: string;
  /** What the worker is paid for this service. Snapshotted onto each job. */
  worker_price: number;
  active: boolean;
  sort_order: number;
  deleted_at: string | null;
}

/** Exactly the `Service` fields, for `.select()` (no created_at). */
export const SERVICE_COLUMNS = 'id, name_en, name_ru, name_he, catalog_number, worker_price, active, sort_order, deleted_at';

export interface AppUser {
  id: string;
  auth_id: string;
  name: string;
  role: UserRole;
  site_id: string | null;
  active: boolean;
}

/** Exactly the `AppUser` fields, for `.select()` (no created_at). */
export const APP_USER_COLUMNS = 'id, auth_id, name, role, site_id, active';

export interface Job {
  id: string;
  site_id: string;
  worker_id: string;
  created_at: string;
  updated_at: string;
  /**
   * NULL when the car has no physical plate — a job is logged without one
   * rather than with a placeholder. At least one of plate/vin is always set.
   */
  plate: string | null;
  /**
   * NULL when the VIN was not readable — a car is logged without one rather
   * than with a placeholder, so readers can tell "not known" from a value.
   */
  vin: string | null;
  /** NULL when there is no VIN to check, as well as when the check was skipped. */
  vin_valid_checksum: boolean | null;
  /** Typed by a person. Never derived from the VIN — see lib/vin.ts. */
  brand: string | null;
  /**
   * @deprecated The job's FIRST service at creation only (0033); read
   * `services` / `service_ids`. Dropped in a later migration.
   */
  service_id: string | null;
  /**
   * Every service on the job (0033), catalog order. From jobs_worker_view /
   * jobs_manager; absent when the raw `jobs` table was selected. Empty only for
   * pre-0005 jobs that never had a service.
   */
  service_ids?: string[];
  services?: JobServiceLine[];
  /**
   * The sum of the job's per-service price snapshots (`job_services`, 0033),
   * not a live lookup: re-pricing a service must not rewrite what last month's
   * exports said. Set by database triggers, never by the client — workers
   * cannot edit their own pay.
   */
  worker_price: number;
  /** Up to two people who worked the car with the submitter (migration 0019). */
  coworker_ids: string[];
  /**
   * Each person's cut of worker_price, computed by Postgres (generated columns)
   * so the rounding lives in one place. The submitter's share carries the
   * leftover cent, so the shares always add up to worker_price.
   */
  submitter_share: number;
  coworker_share: number;
  worker_note: string | null;
  /** Both come from `jobs_manager` and are null for anyone but the site's managers and admins (0023). */
  manager_note: string | null;
  billing_code: string | null;
  locked_at: string;
  duplicate_of_job_id: string | null;
  deleted_at: string | null;
}

/**
 * One service on a job, as the `services` jsonb of jobs_worker_view /
 * jobs_manager carries it (0033). Names travel with the line, so a soft-deleted
 * service still reads. `worker_price` is the snapshot taken when the line was
 * added; the shares are this line's part of the job's submitter/coworker share
 * (they add up to the job's shares exactly).
 */
export interface JobServiceLine {
  service_id: string;
  name_en: string;
  name_ru: string | null;
  name_he: string | null;
  catalog_number: string;
  worker_price: number;
  submitter_share: number;
  coworker_share: number;
}

/** One service on a `jobs_carasso` row: client prices, never pay. NULL prices = not set. */
export interface CarassoServiceLine {
  service_id: string;
  name_en: string;
  name_ru: string | null;
  name_he: string | null;
  catalog_number: string;
  client_unit_price: number | null;
  client_total_price: number | null;
}

export interface JobWithRelations extends Job {
  worker?: Pick<AppUser, 'id' | 'name'>;
  service?: Service;
  photos?: Photo[];
}

export type PhotoKind = 'plate' | 'vin' | 'extra_1' | 'extra_2' | 'extra_3' | 'video';

export interface Photo {
  id: string;
  job_id: string;
  kind: PhotoKind;
  r2_key: string;
  created_at: string;
  expires_at: string;
  /** Set when a manager/admin removed the slot; the row stays as a tombstone. */
  removed_at: string | null;
}

export interface JobMonthlyStat {
  site_id: string;
  worker_id: string;
  month: string; // date, first of month
  job_count: number;
}

/**
 * One row per PERSON on the crew (migration 0019), not per submitter, and per
 * SERVICE line (0033): a two-service job counts once in each service, so sum
 * job_count/car_count here only within one service. Use JobDailyTotal for
 * job and car totals.
 */
export interface JobDailyStat {
  site_id: string;
  worker_id: string;
  service_id: string;
  day: string; // date
  /** Jobs this person worked on — a shared car counts once for each of them. */
  job_count: number;
  /** This person's share of this line's pay. */
  worker_cost: number;
  /** Cars, counted once per service (on the submitter's row). */
  car_count: number;
}

/** `job_daily_totals` (0033): JobDailyStat at job grain, no service. Sum this for job, car and pay totals. */
export interface JobDailyTotal {
  site_id: string;
  worker_id: string;
  day: string; // date
  job_count: number;
  car_count: number;
  worker_cost: number;
}

/** A row of `list_staff()` — what any signed-in user may know about a colleague. */
export interface StaffMember {
  id: string;
  name: string;
  site_id: string | null;
  active: boolean;
  role: UserRole;
}

/** A row of `jobs_carasso` (0028): the only job shape Carasso (and admin exports) can read. No pay, no manager note, no duplicate flag. */
export interface CarassoJob {
  id: string;
  site_id: string;
  site_name: string;
  created_at: string;
  plate: string | null;
  vin: string | null;
  brand: string | null;
  worker_note: string | null;
  /** @deprecated First service only; read `service_ids` / `services`. */
  service_id: string | null;
  /** Every service, joined "A, B" (each name falling back to English on its own, 0033). */
  service_name_en: string | null;
  service_name_ru: string | null;
  service_name_he: string | null;
  catalog_number: string | null;
  billing_code: string | null;
  /** NULL (and `coworker_ids` empty, `crew` null) for Carasso while the admin hides worker names. */
  worker_id: string | null;
  coworker_ids: string[];
  /** Everyone on the job, submitter first: "Dana, Avi". */
  crew: string | null;
  /** Job totals: the sum over `services`, NULL if any line has no price. */
  client_unit_price: number | null;
  client_total_price: number | null;
  service_ids?: string[];
  services?: CarassoServiceLine[];
}

/** A row of `services_carasso`: service names with no pay. */
export interface CarassoService {
  id: string;
  name_en: string;
  name_ru: string | null;
  name_he: string | null;
  catalog_number: string;
  active: boolean;
  sort_order: number;
  deleted_at: string | null;
}

/** Client prices, in shekels, as typed by an admin. */
export interface ClientPrices {
  unit_price: number | null;
  total_price: number | null;
}

/** The date, site and services (joined "A, B", 0033) of an earlier job: all a duplicate warning may say (0029). */
export interface PreviousJob {
  created_at: string;
  site_name: string;
  service_name_en: string | null;
  service_name_ru: string | null;
  service_name_he: string | null;
}
