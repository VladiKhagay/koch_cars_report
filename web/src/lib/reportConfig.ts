import type { UserRole } from './types';

/**
 * The customer report's column set. One layout for the whole app, stored in
 * `app_settings` (0027) and edited by admins; this list is the allowlist the
 * stored config can only order and toggle within. `worker_price` (worker PAY)
 * is deliberately not here and never may be. Migration 0027 validates the same
 * keys at write time; both layers are deliberate.
 *
 * Keys are the export's own field names, not database columns.
 */
export const CUSTOMER_COLUMNS = [
  'date',
  'site',
  'brand',
  'plate',
  'vin',
  'service',
  'catalog_number',
  'billing_code',
  'worker',
  'client_unit_price',
  'client_total_price',
] as const;

export type CustomerColumnKey = (typeof CUSTOMER_COLUMNS)[number];

export interface ColumnConfig {
  key: CustomerColumnKey;
  visible: boolean;
}

/** Language of an exported file. Independent of the app's UI language. */
export type ExportLang = 'he' | 'en';

/** Header text in the spreadsheet, fixed per language: the office and Carasso match on these strings. */
export const SHEET_HEADERS_BY_LANG: Record<ExportLang, Record<CustomerColumnKey, string>> = {
  en: {
    date: 'Date',
    site: 'Site',
    brand: 'Vehicle brand',
    plate: 'Vehicle registration number',
    vin: 'VIN',
    service: 'Work performed',
    catalog_number: 'Catalog number',
    billing_code: 'Customer billing code',
    worker: 'Worker',
    client_unit_price: 'Client unit price (₪)',
    client_total_price: 'Client total price (₪)',
  },
  he: {
    date: 'תאריך',
    site: 'אתר',
    brand: 'יצרן',
    plate: 'רישוי',
    vin: 'שלדה',
    service: 'שירות',
    catalog_number: 'מק"ט',
    billing_code: 'מספר הזמנה',
    worker: 'עובד',
    client_unit_price: 'מחיר לחלק (₪)',
    client_total_price: 'מחיר כולל (₪)',
  },
};

/** English headers, kept for callers that predate the language option. */
export const SHEET_HEADERS = SHEET_HEADERS_BY_LANG.en;

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

/** Columns that carry what the importer is billed. Only admin and Carasso may be offered them. */
export const CLIENT_PRICE_COLUMNS: readonly CustomerColumnKey[] = ['client_unit_price', 'client_total_price'];

/** Who is exporting, and the app state that narrows what they may include. */
export interface ExportContext {
  role: UserRole | undefined;
  /** The admin switch (app_settings.hide_worker_names). Only restricts Carasso. */
  hideWorkerNames: boolean;
  /** More than one site in the file: the Site column is only offered then. */
  multiSite: boolean;
}

/**
 * The columns a person may be offered, and so may export. Everything is
 * default-deny: client prices need admin or Carasso (a manager never reads
 * them, so the cells would be blank anyway), the Worker column goes while the
 * admin hides worker names from Carasso, and Site needs a multi-site file.
 */
export function availableColumns(columns: ColumnConfig[], ctx: ExportContext): ColumnConfig[] {
  const seesPrices = ctx.role === 'admin' || ctx.role === 'carasso';
  const namesHidden = ctx.role === 'carasso' && ctx.hideWorkerNames;
  return columns.filter((c) => {
    if (CLIENT_PRICE_COLUMNS.includes(c.key)) return seesPrices;
    if (c.key === 'worker') return !namesHidden;
    if (c.key === 'site') return ctx.multiSite;
    return true;
  });
}
