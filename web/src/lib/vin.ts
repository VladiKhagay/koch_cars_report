/**
 * VIN and plate validation. The ISO 3779 check digit is only mandatory for
 * North American VINs, so a failed checksum is a soft warning; format (17 chars,
 * no I/O/Q) is enforced when a VIN is present. The VIN is optional.
 *
 * Nothing here infers meaning from a VIN (no WMI->brand table): a guess in a
 * form field looks like something the worker checked. Do not reintroduce inference.
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

// Plates are stored bare (8 digits, no separators) but printed 123-45-678, so input is stripped to digits first.
const PLATE_REGEX = /^\d{8}$/;

export function stripPlate(plate: string): string {
  return plate.replace(/\D/g, '');
}

export function isValidPlate(plate: string): boolean {
  return PLATE_REGEX.test(stripPlate(plate));
}
