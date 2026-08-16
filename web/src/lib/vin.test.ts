import { describe, expect, it } from 'vitest';
import { isValidVinFormat, vinChecksumValid, guessBrandFromVin, isValidPlate, stripPlate } from './vin';

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

describe('guessBrandFromVin', () => {
  it('decodes common WMI prefixes', () => {
    expect(guessBrandFromVin('1HGCM82633A004352')).toBe('Honda');
    expect(guessBrandFromVin('WVWZZZ1JZXW000001')).toBe('Volkswagen');
    expect(guessBrandFromVin('JTDKB20U887654321')).toBe('Toyota');
  });

  it('returns null for unknown prefixes instead of guessing', () => {
    expect(guessBrandFromVin('XXX12345678901234')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(guessBrandFromVin('wvwzzz1jzxw000001')).toBe('Volkswagen');
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
