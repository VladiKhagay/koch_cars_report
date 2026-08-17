/**
 * VIN and plate validation.
 *
 * The ISO 3779 check digit is only mandatory for North American VINs — many
 * imported vehicles legitimately fail it, so `checksumValid` is surfaced as
 * a soft warning in the UI, never a hard block. Format validity (17 chars,
 * no I/O/Q) IS enforced when a VIN is present, since that's a universal rule.
 * The VIN itself is optional: a car with no readable VIN is logged without one.
 *
 * Nothing here reads meaning OUT of a VIN. A WMI→brand table used to live in
 * this file and fill the brand field from the first three characters; it is
 * gone deliberately. The WMI identifies a manufacturer, not a model, the table
 * could only ever cover the prefixes somebody had thought to add, and a guess
 * that lands in a form field is indistinguishable from something the worker
 * checked. Brand is typed by a person or it is empty. Do not reintroduce
 * inference here, from a table or from a decoding service.
 */

const VIN_CHARS = /^[A-HJ-NPR-Z0-9]{17}$/;

export function isValidVinFormat(vin: string): boolean {
  return VIN_CHARS.test(vin.toUpperCase());
}

const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

function charValue(ch: string): number {
  if (ch >= '0' && ch <= '9') return Number(ch);
  return TRANSLITERATION[ch] ?? 0;
}

/** ISO 3779 check digit — informational only, see module doc. */
export function vinChecksumValid(vin: string): boolean {
  const v = vin.toUpperCase();
  if (!isValidVinFormat(v)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += charValue(v[i]) * WEIGHTS[i];
  const remainder = sum % 11;
  const expected = remainder === 10 ? 'X' : String(remainder);
  return v[8] === expected;
}

// Israeli plates are stored bare: 8 digits, no separators. They are *printed*
// as 123-45-678, so anything typed, pasted or OCR'd is stripped down to the
// digits first — the plate on the car and the value in the database are the
// same plate, and validation must not reject the printed spelling.
const PLATE_REGEX = /^\d{8}$/;

export function stripPlate(plate: string): string {
  return plate.replace(/\D/g, '');
}

export function isValidPlate(plate: string): boolean {
  return PLATE_REGEX.test(stripPlate(plate));
}
