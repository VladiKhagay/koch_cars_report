/**
 * Calendar arithmetic for the date window on "My Jobs".
 *
 * Everything here works in `yyyy-mm-dd` local calendar days, which is what
 * `<input type="date">` speaks and what `applyJobFilters` widens into a
 * timestamptz span. Nothing here touches UTC on purpose: a worker asking for
 * "this month" means the month on the wall, and the first hours of the 1st are
 * still in the previous UTC month.
 *
 * The month a range covers is derived from the range, never stored beside it.
 * A second copy of "which month am I looking at" is the kind of state that
 * drifts out of step with the rows on screen.
 */

/** The four windows the quick-select offers. `custom` is "none of the above". */
export type Preset = 'thisMonth' | 'lastMonth' | 'last3Months' | 'custom';

export interface Range {
  /** Inclusive local calendar days, `yyyy-mm-dd`. */
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `yyyy-mm-dd` for a local date — not `toISOString`, which converts to UTC. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `yyyy-mm` — the month a day belongs to, and what `<input type="month">` uses. */
export function monthKey(day: string): string {
  return day.slice(0, 7);
}

/** The whole calendar month `yyyy-mm` names, first day to last. */
export function monthRange(month: string): Range {
  const [y, m] = month.split('-').map(Number);
  // Day 0 of the next month is the last day of this one, leap years included.
  return { from: dayKey(new Date(y, m - 1, 1)), to: dayKey(new Date(y, m, 0)) };
}

/** The month `delta` months either side of `yyyy-mm`, rolling over the year. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function rangeFor(preset: Exclude<Preset, 'custom'>, now = new Date()): Range {
  const thisMonth = monthKey(dayKey(now));
  if (preset === 'thisMonth') return monthRange(thisMonth);
  if (preset === 'lastMonth') return monthRange(shiftMonth(thisMonth, -1));
  // Three months *including* this one: asked in August, "last 3 months" is
  // June, July and August — not March through May.
  return { from: monthRange(shiftMonth(thisMonth, -2)).from, to: monthRange(thisMonth).to };
}

/** Which quick-select the current window corresponds to, if any. */
export function presetFor(range: Range, now = new Date()): Preset {
  const named: Exclude<Preset, 'custom'>[] = ['thisMonth', 'lastMonth', 'last3Months'];
  return (
    named.find((p) => {
      const r = rangeFor(p, now);
      return r.from === range.from && r.to === range.to;
    }) ?? 'custom'
  );
}
