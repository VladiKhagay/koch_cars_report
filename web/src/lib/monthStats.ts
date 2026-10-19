/** The arithmetic behind My Stats, kept out of the component so it is testable. */

export interface Slice {
  label: string;
  value: number;
  /** Percent of the month's jobs, 0–100, rounded. */
  share: number;
}

/**
 * Per-service counts as shares of the month, largest first. Rounded shares can
 * sum to 99 or 101; that is left alone, as the exact counts sit beside them.
 */
export function shares(counts: Map<string, number>, labelFor: (id: string) => string): Slice[] {
  let total = 0;
  for (const v of counts.values()) total += v;
  return [...counts.entries()]
    .map(([id, value]) => ({
      label: labelFor(id),
      value,
      share: total > 0 ? Math.round((value * 100) / total) : 0,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/** Percent change from `previous` to `current`; null with no baseline (a first month is not "up 100%"). */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) * 100) / previous);
}
