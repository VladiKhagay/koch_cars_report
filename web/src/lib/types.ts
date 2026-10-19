export type UserRole = 'worker' | 'manager' | 'admin';

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

export interface AppUser {
  id: string;
  auth_id: string;
  name: string;
  role: UserRole;
  site_id: string | null;
  active: boolean;
}

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
   * One service per job (migration 0005). Nullable only because jobs logged
   * before that migration may have had none — every new job sets it.
   */
  service_id: string | null;
  /**
   * The catalog price at the time of the job, not a live lookup: re-pricing a
   * service must not rewrite what last month's exports said. Set by a database
   * trigger, never by the client — workers cannot edit their own pay.
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
  manager_note: string | null;
  billing_code: string | null;
  locked_at: string;
  duplicate_of_job_id: string | null;
  deleted_at: string | null;
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
}

export interface JobMonthlyStat {
  site_id: string;
  worker_id: string;
  month: string; // date, first of month
  job_count: number;
}

export interface JobServiceStat {
  site_id: string;
  service_id: string;
  month: string; // date, first of month
  job_count: number;
  /** Sum of worker_price over the jobs in this bucket. */
  worker_cost: number;
}

/** One row per PERSON on the crew (migration 0019), not per submitter. */
export interface JobDailyStat {
  site_id: string;
  worker_id: string;
  service_id: string;
  day: string; // date
  /** Jobs this person worked on — a shared car counts once for each of them. */
  job_count: number;
  /** This person's share of the pay. */
  worker_cost: number;
  /** Cars, counted once (on the submitter's row). Sum this for site totals. */
  car_count: number;
}

/** A row of `list_staff()` — what any signed-in user may know about a colleague. */
export interface StaffMember {
  id: string;
  name: string;
  site_id: string | null;
  active: boolean;
}
