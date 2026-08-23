import { describe, expect, it } from 'vitest';
import { dayKey, monthRange, presetFor, rangeFor, shiftMonth } from './dateRange';

/*
 * The month window decides which jobs a worker sees, so an off-by-one here is
 * a day of work missing from their own record with nothing on screen to say so.
 */
describe('dateRange', () => {
  it('keeps a local day local — the 1st is not the 31st of last month', () => {
    // 00:30 local on the 1st is still the previous month in UTC.
    expect(dayKey(new Date(2026, 7, 1, 0, 30))).toBe('2026-08-01');
  });

  it('ends a month on its real last day', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02').to).toBe('2028-02-29'); // leap year
    expect(monthRange('2026-08')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('rolls the year over when stepping past either end', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('counts the current month as one of the last three', () => {
    const now = new Date(2026, 7, 15);
    expect(rangeFor('last3Months', now)).toEqual({ from: '2026-06-01', to: '2026-08-31' });
    expect(rangeFor('lastMonth', now)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('recognises its own ranges and calls anything else custom', () => {
    const now = new Date(2026, 7, 15);
    expect(presetFor(rangeFor('thisMonth', now), now)).toBe('thisMonth');
    expect(presetFor(rangeFor('last3Months', now), now)).toBe('last3Months');
    expect(presetFor({ from: '2026-08-03', to: '2026-08-09' }, now)).toBe('custom');
  });
});
