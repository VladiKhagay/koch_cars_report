import { supabase } from './supabase';
import { resolveCustomerColumns, toStoredConfig, type ColumnConfig } from './reportConfig';
import type { CarassoService, StaffMember } from './types';

/**
 * Carasso reads jobs through `jobs_carasso` (0028), never `jobs`: the view
 * whitelists columns, filters to its sites and blanks the crew when the admin
 * hides worker names. It supports the same filters, search, ordering, paging
 * and counts as `jobs_manager`, so applyJobFilters works on it unchanged.
 * Admin exports use it too (it carries the client prices).
 */
export const CARASSO_JOBS_VIEW = 'jobs_carasso';

/** Every column of the view; there is no pay to leave out. */
export const CARASSO_JOB_COLUMNS =
  'id, site_id, site_name, created_at, plate, vin, brand, worker_note, service_id, ' +
  'service_name_en, service_name_ru, service_name_he, catalog_number, billing_code, ' +
  'worker_id, coworker_ids, crew, client_unit_price, client_total_price';

/** Service filter options for Carasso (services itself is closed to it, as it carries pay rates). */
export async function fetchCarassoServices(): Promise<CarassoService[]> {
  const { data } = await supabase.from('services_carasso').select('*').order('sort_order');
  return (data ?? []) as CarassoService[];
}

/** Worker filter options: the people on Carasso's jobs. Empty while names are hidden. */
export async function fetchCarassoCrew(): Promise<Pick<StaffMember, 'id' | 'name'>[]> {
  const { data, error } = await supabase.rpc('carasso_crew');
  return error ? [] : ((data ?? []) as Pick<StaffMember, 'id' | 'name'>[]);
}

/* ------------------------------------------------------------ app settings */

export interface AppSettings {
  hideWorkerNames: boolean;
  /** The one customer-report layout, already through the allowlist. */
  customerReportColumns: ColumnConfig[];
}

/**
 * The admin settings, readable by admin, manager and Carasso (0027). Fails
 * safe: if the read fails, names stay hidden and the layout is empty.
 */
export async function fetchAppSettings(): Promise<AppSettings & { ok: boolean }> {
  const { data, error } = await supabase.from('app_settings').select('key, value');
  const byKey = new Map((data ?? []).map((r) => [r.key as string, r.value as unknown]));
  return {
    ok: !error,
    hideWorkerNames: error ? true : byKey.get('hide_worker_names') === true,
    customerReportColumns: resolveCustomerColumns(byKey.get('customer_report_config')),
  };
}

/** Admin only. */
export function saveHideWorkerNames(hide: boolean) {
  return supabase.rpc('set_hide_worker_names', { p_hide: hide });
}

/** Admin only: saves the single global layout (server allowlist applies). */
export function saveCustomerReportLayout(columns: ColumnConfig[]) {
  return supabase.rpc('update_customer_report_config', { new_config: toStoredConfig(columns) });
}

/* ------------------------------------------------------------ user sites */

/** Admin: the sites linked to a Carasso user. */
export async function fetchUserSiteIds(userId: string): Promise<string[]> {
  const { data } = await supabase.from('user_sites').select('site_id').eq('user_id', userId);
  return (data ?? []).map((r) => r.site_id as string);
}

/** Admin: replaces a Carasso user's site list. Refuses an empty list (a Carasso user with no site sees nothing). */
export async function saveUserSites(userId: string, siteIds: string[]): Promise<{ error: string | null }> {
  const wanted = [...new Set(siteIds)];
  if (wanted.length === 0) return { error: 'at least one site' };
  const current = await fetchUserSiteIds(userId);
  const add = wanted.filter((id) => !current.includes(id));
  const drop = current.filter((id) => !wanted.includes(id));
  if (add.length > 0) {
    const { error } = await supabase.from('user_sites').insert(add.map((site_id) => ({ user_id: userId, site_id })));
    if (error) return { error: error.message };
  }
  if (drop.length > 0) {
    const { error } = await supabase.from('user_sites').delete().eq('user_id', userId).in('site_id', drop);
    if (error) return { error: error.message };
  }
  return { error: null };
}
