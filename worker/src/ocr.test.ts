import { describe, expect, it } from 'vitest';
import { normalizePlate, normalizeVin, parseDetectObjects, parseOcrAnswer } from './ocr';
import { isPhotoKind } from './upload';
import app from './index';

describe('normalizePlate — Israeli 8-digit format', () => {
  it('accepts every printed grouping, returning bare digits', () => {
    expect(normalizePlate('12345678')).toBe('12345678');
    expect(normalizePlate('123-45-678')).toBe('12345678');
    expect(normalizePlate('123 45 678')).toBe('12345678');
  });

  it('reads the real plate observed in production', () => {
    expect(normalizePlate('817-07-504')).toBe('81707504');
  });

  it('strips chatty preambles', () => {
    expect(normalizePlate('The plate is 12345678')).toBe('12345678');
    expect(normalizePlate('I can read the plate: 12345678')).toBe('12345678');
  });

  it('does not merge unrelated numbers into one plate', () => {
    // The year must not be glued onto the plate digits.
    expect(normalizePlate('123-45-678 on a 2019 Toyota')).toBe('12345678');
  });

  it('rejects prose with no plausible plate', () => {
    expect(normalizePlate('No plate visible')).toBeNull();
    expect(normalizePlate('UNREADABLE')).toBeNull();
    expect(normalizePlate('')).toBeNull();
  });

  it('rejects partial reads — only a full 8 digits counts', () => {
    expect(normalizePlate('123')).toBeNull();
    expect(normalizePlate('1234567')).toBeNull(); // one digit short
    expect(normalizePlate('123456789012')).toBeNull(); // too long
  });

  it('repairs letter/digit confusions inside numeric tokens only', () => {
    // I->1 and O->0 inside a mostly-numeric token.
    expect(normalizePlate('I2345678')).toBe('12345678');
    expect(normalizePlate('I234567O')).toBe('12345670');
    // ...but prose is never mangled into digits.
    expect(normalizePlate('No plate visible in image')).toBeNull();
  });
});

describe('normalizeVin', () => {
  const VIN = '1HGCM82633A004352';

  it('accepts a bare 17-character VIN', () => {
    expect(normalizeVin(VIN)).toBe(VIN);
  });

  it('normalises lowercase, spaces and hyphens', () => {
    expect(normalizeVin('1hgcm82633a004352')).toBe(VIN);
    expect(normalizeVin('1HGCM 82633 A004352')).toBe(VIN);
    expect(normalizeVin('1HGCM-82633-A004352')).toBe(VIN);
  });

  it('extracts a VIN out of a model explanation', () => {
    expect(normalizeVin(`The VIN in the photo is ${VIN}.`)).toBe(VIN);
  });

  it('maps I/O/Q onto digits — they are never valid in a VIN', () => {
    expect(normalizeVin('IHGCM82633A0O4352')).toBe('1HGCM82633A004352');
  });

  it('rejects wrong lengths and prose', () => {
    expect(normalizeVin('1HGCM82633A00435')).toBeNull(); // 16
    expect(normalizeVin('I can see a car but no VIN sticker')).toBeNull();
    expect(normalizeVin('')).toBeNull();
  });

  it('does not "correct" S/5 or B/8, which are both legal in a VIN', () => {
    expect(normalizeVin('SBGCM82633A004352')).toBe('SBGCM82633A004352');
  });
});

describe('parseOcrAnswer', () => {
  it('returns a normalised plate', () => {
    expect(parseOcrAnswer('123-45-678', 'plate')).toEqual({ text: '12345678', reason: null });
  });

  it('recovers a value the model prefixed with UNREADABLE', () => {
    // Observed in production before the prompt was changed.
    expect(parseOcrAnswer('UNREADABLE 817-07-504', 'plate')).toEqual({
      text: '81707504',
      reason: null,
    });
  });

  it('falls back to the generic reason when nothing usable is read', () => {
    expect(parseOcrAnswer('UNREADABLE blurry', 'plate')).toEqual({ text: null, reason: 'not_in_frame' });
    expect(parseOcrAnswer('No plate visible', 'plate')).toEqual({ text: null, reason: 'not_in_frame' });
    expect(parseOcrAnswer('', 'vin')).toEqual({ text: null, reason: 'not_in_frame' });
  });
});

describe('parseDetectObjects', () => {
  const box = (x_min: number, y_min: number, x_max: number, y_max: number) => ({ x_min, y_min, x_max, y_max });

  it('returns a valid box using the documented field names', () => {
    expect(parseDetectObjects([box(0.4, 0.5, 0.7, 0.6)])).toEqual({ x0: 0.4, y0: 0.5, x1: 0.7, y1: 0.6 });
  });

  it('picks the largest of multiple detected objects', () => {
    const best = parseDetectObjects([box(0.1, 0.1, 0.2, 0.2), box(0.4, 0.5, 0.7, 0.6)]);
    expect(best).toEqual({ x0: 0.4, y0: 0.5, x1: 0.7, y1: 0.6 });
  });

  it('normalises corners given in reverse order', () => {
    expect(parseDetectObjects([box(0.7, 0.6, 0.4, 0.5)])).toEqual({ x0: 0.4, y0: 0.5, x1: 0.7, y1: 0.6 });
  });

  it('passes pixel-space boxes through untouched', () => {
    expect(parseDetectObjects([box(400, 500, 700, 560)])).toEqual({ x0: 400, y0: 500, x1: 700, y1: 560 });
  });

  it('rejects zero-size, negative and out-of-frame boxes', () => {
    expect(parseDetectObjects([box(0.5, 0.5, 0.5, 0.5)])).toBeNull();
    expect(parseDetectObjects([box(0.7, 0.7, 0.7, 0.4)])).toBeNull();
    expect(parseDetectObjects([box(-0.1, 0.1, 0.3, 0.3)])).toBeNull();
  });

  it('rejects a full-frame normalised box as uninformative', () => {
    expect(parseDetectObjects([box(0, 0, 1, 1)])).toBeNull();
  });

  it('handles no objects, empty arrays and junk', () => {
    expect(parseDetectObjects(null)).toBeNull();
    expect(parseDetectObjects(undefined)).toBeNull();
    expect(parseDetectObjects([])).toBeNull();
    expect(parseDetectObjects([{ foo: 1 }])).toBeNull();
    expect(parseDetectObjects([{ x_min: 'a', y_min: 0, x_max: 1, y_max: 1 }])).toBeNull();
    expect(parseDetectObjects([box(NaN, 0, 1, 1)])).toBeNull();
  });
});

/* -------------------------------------------------------------- photo kinds */

describe('isPhotoKind', () => {
  it('accepts exactly the slots migration 0005 allows', () => {
    for (const kind of ['plate', 'vin', 'extra_1', 'extra_2', 'extra_3']) {
      expect(isPhotoKind(kind)).toBe(true);
    }
  });

  /*
   * `kind` is interpolated into the R2 object key, so this is the boundary that
   * decides which paths can be written and read. A regex would have let the
   * first three through.
   */
  it('rejects out-of-range slots, traversal and non-strings', () => {
    for (const bad of [
      'extra_0',
      'extra_4',
      'extra_10',
      '../plate',
      'plate/../../secret',
      'PLATE',
      'plate ',
      '',
      null,
      undefined,
      3,
      ['plate'],
    ]) {
      expect(isPhotoKind(bad)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------ error mapping */

describe('unauthenticated requests', () => {
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
  } as unknown as Parameters<typeof app.request>[2];

  /*
   * Regression: these all used to come back 500 "Internal error", because
   * onError matched a message string the jwk middleware never emits. A worker
   * whose session expired saw an outage instead of "sign in again", and real
   * server faults were indistinguishable from routine auth failures.
   */
  it.each([
    ['POST', '/upload?jobId=x&kind=plate'],
    ['POST', '/ocr'],
    ['GET', '/photo/abc/plate'],
    ['POST', '/invite'],
  ])('%s %s answers 401, not 500', async (method, path) => {
    const res = await app.request(path, { method }, env);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('leaves the unauthenticated health check alone', async () => {
    const res = await app.request('/health', {}, env);
    expect(res.status).toBe(200);
  });
});
