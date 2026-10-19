/**
 * What this phone's worker picks most, remembered on the phone.
 *
 * Per device on purpose: a worker is on one phone, and a shared server-side
 * ranking would reorder the chips under everybody whenever anyone submits.
 * Services are ranked by how often they're used (a stable order beats a
 * most-recent one — chips that jump around cause mis-taps); brands are the
 * last few, because the cars that follow each other tend to be the same make.
 */
function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* best-effort */
  }
}

const SERVICE_KEY = 'serviceUseCounts';
const BRAND_KEY = 'recentBrands';
const MAX_BRANDS = 5;

export const serviceUseCounts = () => read<Record<string, number>>(SERVICE_KEY, {});

export function bumpService(id: string) {
  const counts = serviceUseCounts();
  write(SERVICE_KEY, { ...counts, [id]: (counts[id] ?? 0) + 1 });
}

export const recentBrands = () => read<string[]>(BRAND_KEY, []);

export function pushBrand(brand: string) {
  const b = brand.trim();
  if (!b) return;
  write(BRAND_KEY, [b, ...recentBrands().filter((x) => x.toLowerCase() !== b.toLowerCase())].slice(0, MAX_BRANDS));
}
