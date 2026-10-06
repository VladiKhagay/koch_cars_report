import { describe, expect, it } from 'vitest';
import { percentChange, shares } from './monthStats';

/*
 * These two numbers are read as a judgement on a month of someone's work, so
 * the empty and single-row cases matter as much as the arithmetic.
 */
describe('shares', () => {
  const label = (id: string) => ({ a: 'Wash', b: 'Polish', c: 'Interior' })[id] ?? id;

  it('ranks by count and divides the month between them', () => {
    const out = shares(new Map([['a', 5], ['b', 15]]), label);
    expect(out).toEqual([
      { label: 'Polish', value: 15, share: 75 },
      { label: 'Wash', value: 5, share: 25 },
    ]);
  });

  it('breaks a tie by name rather than by Map insertion order', () => {
    expect(shares(new Map([['b', 3], ['c', 3]]), label).map((s) => s.label)).toEqual(['Interior', 'Polish']);
  });

  it('returns nothing for a month with no jobs — no 0/0 shares', () => {
    expect(shares(new Map(), label)).toEqual([]);
  });

  it('works just as well on money as on counts — My Stats reuses it for the earnings breakdown', () => {
    // Same shape as job counts, worker_cost in currency units instead of a count.
    expect(shares(new Map([['a', 120], ['b', 80]]), label)).toEqual([
      { label: 'Wash', value: 120, share: 60 },
      { label: 'Polish', value: 80, share: 40 },
    ]);
  });
});

describe('percentChange', () => {
  it('measures against last month in both directions', () => {
    expect(percentChange(12, 10)).toBe(20);
    expect(percentChange(8, 10)).toBe(-20);
    expect(percentChange(10, 10)).toBe(0);
  });

  it('refuses to divide by an empty month', () => {
    expect(percentChange(7, 0)).toBeNull();
  });
});
