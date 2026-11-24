/**
 * What this phone's worker picks most, remembered per device (a shared ranking
 * would reorder chips under everybody). Services rank by frequency, since a
 * stable order avoids mis-taps; brands are the last few used.
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
const WORKER_LABEL_KEY = 'recentWorkerLabels';
const MAX_RECENT = 5;

export const serviceUseCounts = () => read<Record<string, number>>(SERVICE_KEY, {});

export function bumpService(id: string) {
  const counts = serviceUseCounts();
  write(SERVICE_KEY, { ...counts, [id]: (counts[id] ?? 0) + 1 });
}

/** Puts `value` first in the list at `key`, once (case-insensitively), keeping the last five. */
function pushRecent(key: string, value: string) {
  const v = value.trim();
  if (!v) return;
  write(key, [v, ...read<string[]>(key, []).filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, MAX_RECENT));
}

export const recentBrands = () => read<string[]>(BRAND_KEY, []);
export const pushBrand = (brand: string) => pushRecent(BRAND_KEY, brand);

/** Names a manager/admin typed for someone with no account (0040), last five on this device. */
export const recentWorkerLabels = () => read<string[]>(WORKER_LABEL_KEY, []);
export const pushWorkerLabel = (label: string) => pushRecent(WORKER_LABEL_KEY, label);
