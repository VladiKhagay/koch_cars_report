/**
 * Turns an audit_log `changes` value into displayable rows. Two shapes exist:
 * - current (DB triggers): `{ field: { from, to } }` on jobs, job_billing,
 *   job_services and job_service_client_prices; media actions carry
 *   `{ kind: { from, to } }`;
 * - legacy (client-written, before the triggers): `{ field: value }`, where
 *   only the new value was kept, plus JobDetail's `service_ids` /
 *   `service_lines` arrays and `{ reason }` on a duplicate delete.
 * `from: undefined` means "not recorded" (legacy); `null` means "empty".
 */

export interface ChangeRow {
  field: string;
  from: string | null | undefined;
  to: string | null;
}

export interface ChangeFormatters {
  person: (id: string) => string;
  site: (id: string) => string;
  service: (id: string) => string;
  date: (iso: string) => string;
  /** A media slot (plate, vin, extra_1, ...). */
  slot: (kind: string) => string;
  /** yes / no. */
  bool: (b: boolean) => string;
  /** A shekel amount. */
  money: (n: number) => string;
}

const MONEY = new Set(['worker_price', 'unit_price', 'total_price']);

/** A money value as stored: a number, or a numeric string in older rows. */
function formatAmount(value: unknown, f: ChangeFormatters): string {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? f.money(n) : String(value);
}

/** Bookkeeping columns a trigger may carry along; never a human edit. */
const SKIP = new Set(['updated_at', 'locked_at', 'id', 'job_id', 'r2_key', 'expires_at']);

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A trigger diff entry: an object whose keys are only `from` and/or `to`. */
function isFromTo(v: unknown): v is { from?: unknown; to?: unknown } {
  if (!isPlain(v)) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => k === 'from' || k === 'to');
}

function formatValue(field: string, value: unknown, f: ChangeFormatters): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map((v) => formatValue(field, v, f) ?? '—').join(', ');
  }
  if (field === 'service_lines' && isPlain(value)) {
    // Legacy admin line edit: { service_id, worker_price?, unit_price?, total_price? }.
    const { service_id, ...money } = value;
    const parts = Object.entries(money).map(([k, v]) => `${k}=${v == null || v === '' ? '—' : formatAmount(v, f)}`);
    return `${typeof service_id === 'string' ? f.service(service_id) : '—'}${parts.length ? ` (${parts.join(', ')})` : ''}`;
  }
  if (isPlain(value)) return JSON.stringify(value);
  if (typeof value === 'boolean') return f.bool(value);
  if (MONEY.has(field)) return formatAmount(value, f);
  const s = String(value);
  switch (field) {
    case 'worker_id':
    case 'coworker_ids':
    case 'user_id':
      return f.person(s);
    case 'site_id':
      return f.site(s);
    case 'service_id':
    case 'service_ids':
      return f.service(s);
    case 'created_at':
    case 'deleted_at':
    case 'removed_at':
      return f.date(s);
    case 'kind':
      return f.slot(s);
    default:
      return s;
  }
}

export function describeChanges(changes: unknown, f: ChangeFormatters): ChangeRow[] {
  if (!isPlain(changes)) return [];
  const rows: ChangeRow[] = [];
  for (const [field, raw] of Object.entries(changes)) {
    if (SKIP.has(field)) continue;
    if (field === 'kind' && isFromTo(raw)) {
      // Media rows (0034): {kind: {null→k}} add, {k→k} replace, {k→null} remove.
      // The action already says which; the row just names the slot.
      rows.push({ field, from: undefined, to: formatValue(field, raw.to ?? raw.from, f) });
    } else if (isFromTo(raw)) {
      rows.push({ field, from: formatValue(field, raw.from, f), to: formatValue(field, raw.to, f) });
    } else {
      rows.push({ field, from: undefined, to: formatValue(field, raw, f) });
    }
  }
  return rows;
}
