/**
 * VIN and plate validation. The ISO 3779 check digit is only mandatory for
 * North American VINs, so a failed checksum is a soft warning; format (17 chars,
 * no I/O/Q) is enforced. The VIN is required (0036); the plate is optional.
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

/** New Job's VIN rule: required (0036), 17 valid characters. Blank (spaces only) counts as empty. */
export function vinProblem(vin: string): 'required' | 'invalid' | null {
  if (!vin.trim()) return 'required';
  return isValidVinFormat(vin) ? null : 'invalid';
}

export interface NormalizedVehicle {
  /** Bare 8 digits, or null when left empty. Never '': '' would collide in the duplicate check. */
  plate: string | null;
  vin: string | null;
  /** Check digit result for jobs.vin_valid_checksum; null when there is no VIN. */
  vinChecksum: boolean | null;
  /** Blocking: a started plate that is not 8 digits. */
  plateError: boolean;
  /** Blocking: a started VIN that is not 17 valid characters. A bad check digit is only `vinChecksum: false`. */
  vinError: boolean;
  /** Blocking: a job needs a VIN (0036). */
  missingVin: boolean;
}

/** The New Job rules for a plate/VIN pair, for any screen that edits them. */
export function normalizeVehicle(input: { plate: string | null; vin: string | null }): NormalizedVehicle {
  const plate = stripPlate(input.plate ?? '') || null;
  const vin = (input.vin ?? '').trim().toUpperCase() || null;
  return {
    plate,
    vin,
    vinChecksum: vin ? vinChecksumValid(vin) : null,
    plateError: plate !== null && !isValidPlate(plate),
    vinError: vin !== null && !isValidVinFormat(vin),
    missingVin: vin === null,
  };
}
