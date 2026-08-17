import { describe, expect, it } from 'vitest';
import * as vin from './vin';
import { isValidVinFormat, vinChecksumValid, isValidPlate, stripPlate } from './vin';

describe('isValidVinFormat', () => {
  it('accepts a 17-char VIN without I/O/Q', () => {
    expect(isValidVinFormat('1HGCM82633A004352')).toBe(true);
    expect(isValidVinFormat('11111111111111111')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isValidVinFormat('1hgcm82633a004352')).toBe(true);
  });

  it('rejects wrong lengths', () => {
    expect(isValidVinFormat('1HGCM82633A00435')).toBe(false); // 16
    expect(isValidVinFormat('1HGCM82633A0043521')).toBe(false); // 18
    expect(isValidVinFormat('')).toBe(false);
  });

  it('rejects the letters I, O, and Q', () => {
    expect(isValidVinFormat('IHGCM82633A004352')).toBe(false);
    expect(isValidVinFormat('1HGCM82633A00435O')).toBe(false);
    expect(isValidVinFormat('1HGCM82633Q004352')).toBe(false);
  });
});

describe('vinChecksumValid', () => {
  it('accepts VINs with a correct ISO 3779 check digit', () => {
    // Classic reference VINs with known-valid check digits.
    expect(vinChecksumValid('1HGCM82633A004352')).toBe(true);
    expect(vinChecksumValid('11111111111111111')).toBe(true);
  });

  it('rejects a VIN whose check digit no longer matches after a typo', () => {
    expect(vinChecksumValid('1HGCM82633A004353')).toBe(false);
  });

  it('rejects VINs that fail format validation outright', () => {
    expect(vinChecksumValid('NOT-A-VIN')).toBe(false);
  });
});

/*
 * The VIN is user-provided data and nothing else. This module used to export
 * `guessBrandFromVin`, which filled the brand field from the WMI prefix — a
 * guess that arrived in the form looking exactly like something the worker had
 * read off the car. It is gone, and this is what keeps it gone: a helpful
 * reinstatement would otherwise pass every other test in the suite.
 */
describe('no vehicle inference from the VIN', () => {
  it('exports validation only — nothing that decodes a VIN into vehicle data', () => {
    expect(Object.keys(vin).sort()).toEqual([
      'isValidPlate',
      'isValidVinFormat',
      'stripPlate',
      'vinChecksumValid',
    ]);
  });
});

describe('isValidPlate (default pattern)', () => {
  it('accepts a bare 8-digit Israeli plate', () => {
    expect(isValidPlate('12345678')).toBe(true);
  });

  it('accepts the plate as printed on the car, separators and all', () => {
    expect(isValidPlate('123-45-678')).toBe(true);
    expect(isValidPlate('123 45 678')).toBe(true);
  });

  it('rejects anything that is not exactly 8 digits', () => {
    expect(isValidPlate('1234567')).toBe(false);
    expect(isValidPlate('12-345-67')).toBe(false);
    expect(isValidPlate('123456789')).toBe(false);
    expect(isValidPlate('AB123CD')).toBe(false);
  });

  it('strips to the stored form', () => {
    expect(stripPlate('123-45-678')).toBe('12345678');
  });
});
