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
      // Composes the validators above; decodes nothing.
      'normalizeVehicle',
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

/* Format validation is brand-neutral: any ISO 3779 17-character VIN passes, and
   the check digit (which Renault, Nissan and Chinese makes often don't satisfy)
   is only a warning, never a rejection. */
describe('VINs from different makes', () => {
  it.each([
    ['Renault', 'VF1RFB00X58123456'],
    ['Nissan', 'JN1TCNT32U0123456'],
    ['Chery', 'LVVDB11B4ND123456'],
    ['Xpeng', 'LNBSCCAK5NA123456'],
  ])('%s passes the format check', (_make, v) => {
    expect(isValidVinFormat(v)).toBe(true);
    expect(isValidVinFormat(v.toLowerCase())).toBe(true);
  });
});

describe('normalizeVehicle', () => {
  it('strips plate separators and uppercases the VIN', () => {
    expect(vin.normalizeVehicle({ plate: '123-45-678', vin: ' 1hgcm82633a004352 ' })).toEqual({
      plate: '12345678',
      vin: '1HGCM82633A004352',
      vinChecksum: true,
      plateError: false,
      vinError: false,
      missingBoth: false,
    });
  });

  it('turns empty values into null, never an empty string', () => {
    const r = vin.normalizeVehicle({ plate: '', vin: '   ' });
    expect(r.plate).toBeNull();
    expect(r.vin).toBeNull();
    expect(r.vinChecksum).toBeNull();
    expect(r.missingBoth).toBe(true);
    expect(r.plateError || r.vinError).toBe(false);
  });

  it('blocks a malformed plate or VIN', () => {
    expect(vin.normalizeVehicle({ plate: '1234', vin: null }).plateError).toBe(true);
    expect(vin.normalizeVehicle({ plate: null, vin: '1HGCM82633A00435' }).vinError).toBe(true);
    expect(vin.normalizeVehicle({ plate: null, vin: '1HGCM82633A0O4352' }).vinError).toBe(true);
  });

  it('only flags a bad check digit, it does not block', () => {
    const r = vin.normalizeVehicle({ plate: null, vin: '1HGCM82633A004353' });
    expect(r.vinError).toBe(false);
    expect(r.vinChecksum).toBe(false);
  });
});
