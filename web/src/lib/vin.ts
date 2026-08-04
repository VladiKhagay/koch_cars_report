/**
 * VIN validation and brand lookup.
 *
 * The ISO 3779 check digit is only mandatory for North American VINs — many
 * imported vehicles legitimately fail it, so `checksumValid` is surfaced as
 * a soft warning in the UI, never a hard block. Format validity (17 chars,
 * no I/O/Q) IS enforced, since that's a universal rule.
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

// Curated WMI (World Manufacturer Identifier, first 3 VIN chars) → brand
// lookup. Not exhaustive — covers common brands seen at import/resale lots.
// Brand is always editable by the worker/manager, so a missed prefix just
// means one extra tap, not a blocked submission. Extend freely.
const WMI_PREFIXES: Record<string, string> = {
  // Toyota / Lexus
  JT2: 'Toyota', JT3: 'Toyota', JTD: 'Toyota', JTE: 'Toyota', JTG: 'Toyota',
  JTH: 'Lexus', JTJ: 'Lexus', JTL: 'Toyota', JTM: 'Toyota', JTN: 'Toyota',
  '4T1': 'Toyota', '4T3': 'Toyota', '5TD': 'Toyota', '5TF': 'Toyota',
  // Honda / Acura
  JHM: 'Honda', JH4: 'Acura', '1HG': 'Honda', '2HG': 'Honda', '19X': 'Acura',
  // Nissan / Infiniti
  JN1: 'Nissan', JN6: 'Nissan', JN8: 'Nissan', '1N4': 'Nissan', '5N1': 'Nissan', JNK: 'Infiniti',
  // Mazda
  JM1: 'Mazda', JM3: 'Mazda', '1YV': 'Mazda',
  // Subaru
  JF1: 'Subaru', JF2: 'Subaru', '4S3': 'Subaru', '4S4': 'Subaru',
  // Mitsubishi
  JA3: 'Mitsubishi', JA4: 'Mitsubishi', '4A3': 'Mitsubishi', '4A4': 'Mitsubishi',
  // Suzuki
  JS1: 'Suzuki', JS2: 'Suzuki', JS3: 'Suzuki',
  // Hyundai / Kia
  KMH: 'Hyundai', KM8: 'Hyundai', '5NP': 'Hyundai', '5NM': 'Hyundai',
  KNA: 'Kia', KND: 'Kia', KNM: 'Kia', '5XY': 'Kia', '5XX': 'Kia',
  // Ford
  '1FA': 'Ford', '1FT': 'Ford', '1FM': 'Ford', WF0: 'Ford', '3FA': 'Ford',
  // GM / Chevrolet / Buick / Cadillac / GMC
  '1G1': 'Chevrolet', '1G6': 'Cadillac', '1GC': 'Chevrolet', '1GT': 'GMC',
  '3GN': 'Chevrolet', KL1: 'Chevrolet', '2G1': 'Chevrolet',
  // Chrysler / Jeep / Dodge / RAM
  '1C3': 'Chrysler', '1C4': 'Jeep', '1C6': 'RAM', '1D4': 'Dodge', '3C4': 'Jeep', '2C3': 'Chrysler',
  // Volkswagen / Audi / Skoda / Seat / Porsche
  WVW: 'Volkswagen', WV1: 'Volkswagen', WV2: 'Volkswagen', '3VW': 'Volkswagen',
  WAU: 'Audi', WA1: 'Audi', TMB: 'Skoda', VSS: 'Seat', WP0: 'Porsche', WP1: 'Porsche',
  // BMW / Mini
  WBA: 'BMW', WBS: 'BMW', WBY: 'BMW', WMW: 'Mini', '4US': 'BMW', '5UX': 'BMW',
  // Mercedes-Benz
  WDB: 'Mercedes-Benz', WDC: 'Mercedes-Benz', WDD: 'Mercedes-Benz', WDF: 'Mercedes-Benz', '4JG': 'Mercedes-Benz',
  // Volvo
  YV1: 'Volvo', YV4: 'Volvo',
  // Renault / Dacia
  VF1: 'Renault', UU1: 'Dacia',
  // Peugeot / Citroen / Opel
  VF3: 'Peugeot', VF7: 'Citroen', W0L: 'Opel', W0V: 'Opel',
  // Fiat / Alfa Romeo
  ZFA: 'Fiat', ZAR: 'Alfa Romeo',
  // Land Rover / Jaguar
  SAL: 'Land Rover', SAJ: 'Jaguar',
  // Tesla
  '5YJ': 'Tesla', '7SA': 'Tesla',
  // Honda/other Asian brands sold widely in import markets
  KPT: 'SsangYong', KPA: 'SsangYong',
};

/** Best-effort brand guess from the VIN's WMI (first 3 characters). */
export function guessBrandFromVin(vin: string): string | null {
  const wmi = vin.toUpperCase().slice(0, 3);
  return WMI_PREFIXES[wmi] ?? null;
}

const DEFAULT_PLATE_REGEX = /^[A-Z0-9-]{5,10}$/;

export function isValidPlate(plate: string): boolean {
  const pattern = import.meta.env.VITE_PLATE_REGEX
    ? new RegExp(import.meta.env.VITE_PLATE_REGEX)
    : DEFAULT_PLATE_REGEX;
  return pattern.test(plate.toUpperCase());
}
