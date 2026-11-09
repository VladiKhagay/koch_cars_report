import { parsePrice } from '../lib/clientPrices';

/** One service line's money as typed by an admin (strings: they live in inputs). */
export interface LineMoney {
  pay: string;
  unit: string;
  total: string;
}

export interface LineWrite extends LineMoney {
  sid: string;
  payChanged: boolean;
  pricesChanged: boolean;
}

/**
 * The per-line writes an admin's JobDetail save makes (0033). Only lines on
 * the job after the save (a removed line is gone, its client-price row with
 * it), and only where the typed value differs from the line's default (its
 * snapshot, or the catalog price a new line gets), so an untouched new line
 * keeps the database's own snapshot. `invalid`: a changed pay that is blank or
 * not a number, or a typed client price that is not one (blank prices are allowed).
 */
export function lineWrites(
  serviceIds: string[],
  defaults: Record<string, LineMoney>,
  drafts: Record<string, Partial<LineMoney>>,
): { writes: LineWrite[]; invalid: boolean } {
  const writes = serviceIds.flatMap((sid) => {
    const d = defaults[sid] ?? { pay: '', unit: '', total: '' };
    const v = { ...d, ...drafts[sid] };
    const payChanged = v.pay !== d.pay;
    const pricesChanged = v.unit !== d.unit || v.total !== d.total;
    return payChanged || pricesChanged ? [{ sid, ...v, payChanged, pricesChanged }] : [];
  });
  const bad = (s: string) => s.trim() !== '' && parsePrice(s) === null;
  const invalid = writes.some((w) => (w.payChanged && parsePrice(w.pay) === null) || bad(w.unit) || bad(w.total));
  return { writes, invalid };
}

/**
 * A job needs at least one service, except a legacy job that never had a line
 * (null service_id before 0033): it may still save its other fields as long as
 * nobody picked a service for it. Once it had lines, emptying them is refused.
 */
export const missingServices = (original: string[], picked: string[]) =>
  picked.length === 0 && original.length > 0;
