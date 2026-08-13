/**
 * The customer treatment report's column set.
 *
 * This report leaves the building — it goes to the importer. Two fields must
 * never appear in it at any visibility: who did the work, and what the yard
 * pays them. `sites.customer_report_config` is a jsonb blob that a manager
 * writes through an RPC, which makes it *data*, and a privacy rule enforced
 * only by data is a privacy rule one bad row away from being off. So the set
 * of columns the report may contain lives here, in code, and the stored config
 * can only order and toggle within it.
 *
 * Migration 0007 validates the same list at the write boundary. Both layers
 * are deliberate: the database stops a bad value being stored, this stops a
 * bad value being rendered if one ever is — by a direct SQL edit, a restored
 * backup taken before 0007, or a future migration that reintroduces a key.
 */
export const CUSTOMER_COLUMNS = [
  'date',
  'brand',
  'plate',
  'vin',
  'service',
  'catalog_number',
  'billing_code',
] as const;

export type CustomerColumnKey = (typeof CUSTOMER_COLUMNS)[number];

export interface ColumnConfig {
  key: CustomerColumnKey;
  visible: boolean;
}

/**
 * Header text written into the spreadsheet.
 *
 * Fixed, English, and NOT translated: the office matches on these strings, so
 * a Hebrew-speaking manager exporting the same report must produce a file the
 * same downstream process can read. The configuration screen shows localized
 * names beside them so the manager can still tell which column is which.
 */
export const SHEET_HEADERS: Record<CustomerColumnKey, string> = {
  date: 'Date',
  brand: 'Vehicle brand',
  plate: 'Vehicle registration number',
  vin: 'VIN',
  service: 'Work performed',
  catalog_number: 'Catalog number',
  billing_code: 'Customer billing code',
};

function isCustomerColumn(value: unknown): value is CustomerColumnKey {
  return typeof value === 'string' && (CUSTOMER_COLUMNS as readonly string[]).includes(value);
}

/**
 * Turns whatever is stored on the site row into an ordered, safe column list.
 *
 * Unknown keys are dropped rather than rejected: a config carrying `worker`
 * must not produce an error the manager can't act on, and must not block the
 * export either — it should just quietly not have that column. Allowlisted
 * keys the config omits are appended HIDDEN, so a column added to the product
 * later never starts appearing in customer paperwork on its own.
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
