import { supabase } from './supabase';
import type { ClientPrices } from './types';

/** Parses what an admin typed into a price: a non-negative number, or null for blank/invalid. */
export function parsePrice(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().replace(',', '.');
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/**
 * Client prices are required for ACTIVE services (a draft may leave them
 * empty). Mirrors the database trigger of 0027, so the form can say what is
 * wrong before the save does. `'invalid'` is a filled-in but unusable value.
 */
export function validateClientPrices(
  active: boolean,
  unit: string | number | null | undefined,
  total: string | number | null | undefined,
): 'required' | 'invalid' | null {
  const blank = (v: string | number | null | undefined) => v === null || v === undefined || String(v).trim() === '';
  const bad = (v: string | number | null | undefined) => !blank(v) && parsePrice(v) === null;
  if (bad(unit) || bad(total)) return 'invalid';
  if (active && (blank(unit) || blank(total))) return 'required';
  // A price row holds both or neither.
  if (blank(unit) !== blank(total)) return 'required';
  return null;
}

/** Admin: a service's catalog client prices. RLS keeps the table admin-only. */
export async function fetchServiceClientPrices(): Promise<Map<string, ClientPrices>> {
  const { data } = await supabase.from('service_client_prices').select('service_id, unit_price, total_price');
  return new Map((data ?? []).map((r) => [r.service_id as string, { unit_price: r.unit_price, total_price: r.total_price }]));
}

/**
 * Admin: set (or, with both null, clear) a service's client prices. Clearing an
 * ACTIVE service's prices is refused by the database. New services start
 * inactive: save the service, call this, then activate it.
 */
export function saveServiceClientPrices(serviceId: string, prices: { unit_price: number; total_price: number } | null) {
  return prices
    ? supabase.from('service_client_prices').upsert({ service_id: serviceId, ...prices }, { onConflict: 'service_id' })
    : supabase.from('service_client_prices').delete().eq('service_id', serviceId);
}

/** Admin (and Carasso, for jobs on its sites): the snapshotted price of one job. */
export async function fetchJobClientPrices(jobId: string): Promise<ClientPrices | null> {
  const { data } = await supabase
    .from('job_client_prices')
    .select('unit_price, total_price')
    .eq('job_id', jobId)
    .maybeSingle();
  return data ?? null;
}

/** Admin only: the per-job override. Changing the job's service afterwards re-snapshots from the catalog. */
export function saveJobClientPrices(jobId: string, prices: ClientPrices) {
  return supabase.from('job_client_prices').upsert({ job_id: jobId, ...prices }, { onConflict: 'job_id' });
}
