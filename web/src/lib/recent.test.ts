import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushBrand, pushWorkerLabel, recentBrands, recentWorkerLabels } from './recent';

const store = new Map<string, string>();

beforeEach(() =>
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  }),
);
afterEach(() => {
  store.clear();
  vi.unstubAllGlobals();
});

describe('recent worker labels', () => {
  it('keeps the last five, newest first', () => {
    for (const n of ['A', 'B', 'C', 'D', 'E', 'F']) pushWorkerLabel(n);
    expect(recentWorkerLabels()).toEqual(['F', 'E', 'D', 'C', 'B']);
  });

  it('dedupes case-insensitively, keeping the latest spelling first', () => {
    pushWorkerLabel('Moshe');
    pushWorkerLabel('Avi');
    pushWorkerLabel('  moshe ');
    expect(recentWorkerLabels()).toEqual(['moshe', 'Avi']);
  });

  it('ignores a blank name', () => {
    pushWorkerLabel('   ');
    expect(recentWorkerLabels()).toEqual([]);
  });

  it('is its own list, apart from brands', () => {
    pushWorkerLabel('Moshe');
    pushBrand('Toyota');
    expect(recentWorkerLabels()).toEqual(['Moshe']);
    expect(recentBrands()).toEqual(['Toyota']);
  });

  it('reads a corrupt stored list as empty, then starts over', () => {
    store.set('recentWorkerLabels', '{not json');
    expect(recentWorkerLabels()).toEqual([]);
    pushWorkerLabel('Moshe');
    expect(recentWorkerLabels()).toEqual(['Moshe']);
  });
});
