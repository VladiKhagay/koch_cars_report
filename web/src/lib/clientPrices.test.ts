import { describe, expect, it } from 'vitest';
import { parsePrice, validateClientPrices } from './clientPrices';

describe('parsePrice', () => {
  it('accepts plain numbers, a decimal comma and zero', () => {
    expect(parsePrice('12.5')).toBe(12.5);
    expect(parsePrice('12,5')).toBe(12.5);
    expect(parsePrice(0)).toBe(0);
  });

  it('rejects blank, negative and non-numeric values', () => {
    for (const bad of ['', '  ', '-1', 'abc', 'NaN', 'Infinity', null, undefined]) {
      expect(parsePrice(bad)).toBeNull();
    }
  });
});

describe('validateClientPrices', () => {
  it('requires both prices for an active service', () => {
    expect(validateClientPrices(true, '', '')).toBe('required');
    expect(validateClientPrices(true, '10', '')).toBe('required');
    expect(validateClientPrices(true, '10', '40')).toBeNull();
  });

  it('lets a draft leave both empty, but not just one', () => {
    expect(validateClientPrices(false, '', '')).toBeNull();
    expect(validateClientPrices(false, '10', '')).toBe('required');
  });

  it('flags an unusable value whether or not the service is active', () => {
    expect(validateClientPrices(false, '-3', '10')).toBe('invalid');
    expect(validateClientPrices(true, 'x', '10')).toBe('invalid');
  });
});
