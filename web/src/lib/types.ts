export type UserRole = 'worker' | 'manager' | 'admin';

export interface Site {
  id: string;
  name: string;
}

export interface Service {
  id: string;
  name_en: string;
  name_ru: string | null;
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
  plate: string;
  vin: string;
  vin_valid_checksum: boolean | null;
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

export type PhotoKind = 'plate' | 'vin' | 'extra_1' | 'extra_2' | 'extra_3';

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

export interface JobDailyStat {
  site_id: string;
  worker_id: string;
  service_id: string;
  day: string; // date
  job_count: number;
  worker_cost: number;
}
