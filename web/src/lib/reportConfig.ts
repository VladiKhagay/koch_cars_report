/**
 * The customer treatment report's column set. This report goes to the importer,
 * so `worker_price` must never appear in it; `worker` (the name) became allowed
 * in 0013. The site's stored config is data, so the allowed columns live here in
 * code and the config can only order and toggle within them. Migration 0013
 * validates the same list at write time; both layers are deliberate.
 */
export const CUSTOMER_COLUMNS = [
  'date',
  'brand',
  'plate',
  'vin',
  'service',
  'catalog_number',
  'billing_code',
  'worker',
] as const;

export type CustomerColumnKey = (typeof CUSTOMER_COLUMNS)[number];

export interface ColumnConfig {
  key: CustomerColumnKey;
  visible: boolean;
}

/** Header text in the spreadsheet: fixed English and not translated, because the office matches on these strings. */
export const SHEET_HEADERS: Record<CustomerColumnKey, string> = {
  date: 'Date',
  brand: 'Vehicle brand',
  plate: 'Vehicle registration number',
  vin: 'VIN',
  service: 'Work performed',
  catalog_number: 'Catalog number',
  billing_code: 'Customer billing code',
  worker: 'Worker',
};

function isCustomerColumn(value: unknown): value is CustomerColumnKey {
  return typeof value === 'string' && (CUSTOMER_COLUMNS as readonly string[]).includes(value);
}

/**
 * Turns the stored site config into an ordered, safe column list. Unknown keys
 * (e.g. `worker_price`) are dropped quietly, and allowlisted keys the config
 * omits are appended hidden, so a new column never appears in paperwork alone.
 */
export function resolveCustomerColumns(raw: unknown): ColumnConfig[] {
  const stored = raw as { columns?: unknown } | null | undefined;
  const entries = Array.isArray(stored?.columns) ? stored.columns : [];

  const seen = new Set<CustomerColumnKey>();
  const out: ColumnConfig[] = [];

  for (const entry of entries) {
    const key = (entry as { key?: unknown } | null)?.key;
    if (!isCustomerColumn(key) || seen.has(key)) continue;
    seen.add(key);
    // Anything other than an explicit `false` counts as visible, so a
    // hand-written config without the field still renders.
    out.push({ key, visible: (entry as { visible?: unknown }).visible !== false });
  }

  for (const key of CUSTOMER_COLUMNS) {
    if (!seen.has(key)) out.push({ key, visible: false });
  }

  return out;
}

/** The shape the RPC expects back. Visibility and order are all it carries. */
export function toStoredConfig(columns: ColumnConfig[]) {
  return { columns: columns.map(({ key, visible }) => ({ key, visible })) };
}

/** Moves one column up or down, for the reorder controls. */
export function moveColumn(columns: ColumnConfig[], index: number, direction: -1 | 1): ColumnConfig[] {
  const target = index + direction;
  if (target < 0 || target >= columns.length) return columns;
  const next = [...columns];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
