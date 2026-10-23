import { describe, expect, it } from 'vitest';
import { DAY_MONTH, DAY_MONTH_YEAR, formatDate, LONG_DATE, MONTH_YEAR } from './formatDate';

describe('formatDate', () => {
  const d = new Date('2026-03-05T12:00:00');
  it('matches toLocaleDateString for every preset', () => {
    for (const opts of [undefined, DAY_MONTH, DAY_MONTH_YEAR, MONTH_YEAR, LONG_DATE]) {
      expect(formatDate(d, 'en', opts)).toBe(d.toLocaleDateString('en', opts));
    }
  });
  it('parses a string with new Date', () => {
    expect(formatDate('2026-03-05T12:00:00Z', 'he', DAY_MONTH)).toBe(new Date('2026-03-05T12:00:00Z').toLocaleDateString('he', DAY_MONTH));
  });
});
