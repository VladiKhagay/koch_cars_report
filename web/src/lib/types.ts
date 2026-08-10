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
  active: boolean;
  sort_order: number;
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
  worker_note: string | null;
  manager_note: string | null;
  billing_code: string | null;
  locked_at: string;
  duplicate_of_job_id: string | null;
  deleted_at: string | null;
}

export interface JobWithRelations extends Job {
  worker?: Pick<AppUser, 'id' | 'name'>;
  services?: Service[];
  photos?: Photo[];
}

export interface Photo {
  id: string;
  job_id: string;
  kind: 'plate' | 'vin';
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
}
