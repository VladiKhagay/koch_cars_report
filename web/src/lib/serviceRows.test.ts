import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expandJobRows, getServiceRowMode, serviceLabel, setServiceRowMode, SERVICE_ROW_MODE_KEY } from './serviceRows';

const wash = { name_en: 'Wash', name_ru: 'Мойка', name_he: null };
const polish = { name_en: 'Polish', name_ru: null, name_he: 'פוליש' };

describe('serviceLabel', () => {
  it('joins every service in the reader language, each falling back to English on its own', () => {
    expect(serviceLabel([wash, polish], 'en')).toBe('Wash, Polish');
    expect(serviceLabel([wash, polish], 'ru')).toBe('Мойка, Polish');
    expect(serviceLabel([wash, polish], 'he-IL')).toBe('Wash, פוליש');
  });
  it('is empty for a job with no services', () => {
    expect(serviceLabel([], 'en')).toBe('');
    expect(serviceLabel(undefined, 'en')).toBe('');
  });
});

describe('expandJobRows', () => {
  it('gives one row per service, each with only its own line', () => {
    const rows = expandJobRows({ id: 'j1', services: [wash, polish] });
    expect(rows).toEqual([
      { id: 'j1', services: [wash] },
      { id: 'j1', services: [polish] },
    ]);
  });
  /* Pre-0005 jobs have no service at all: they must not vanish from the separate view. */
  it('keeps a job with no services as one row', () => {
    expect(expandJobRows({ id: 'j0', services: [] })).toEqual([{ id: 'j0', services: [] }]);
    expect(expandJobRows({ id: 'j0', services: null })).toEqual([{ id: 'j0', services: null }]);
  });
});

describe('service row mode', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('defaults to grouped and remembers a choice', () => {
    expect(getServiceRowMode()).toBe('grouped');
    setServiceRowMode('separate');
    expect(getServiceRowMode()).toBe('separate');
    setServiceRowMode('grouped');
    expect(getServiceRowMode()).toBe('grouped');
  });
  it('treats a junk stored value as the default', () => {
    localStorage.setItem(SERVICE_ROW_MODE_KEY, 'sideways');
    expect(getServiceRowMode()).toBe('grouped');
  });
  /* Private mode can make storage throw: the grid must still render, grouped. */
  it('falls back to grouped when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(getServiceRowMode()).toBe('grouped');
    expect(() => setServiceRowMode('separate')).not.toThrow();
  });
});

describe('serviceLabel — region-tagged languages (0033 QA)', () => {
  it('reads ru-RU and he-IL like ru and he, falling back per name', () => {
    expect(serviceLabel([wash, polish], 'ru-RU')).toBe('Мойка, Polish');
    expect(serviceLabel([polish, wash], 'he')).toBe('פוליש, Wash');
  });
  it('falls back to English for a blank translation', () => {
    expect(serviceLabel([{ name_en: 'Wax', name_ru: '', name_he: '' }], 'ru')).toBe('Wax');
  });
});

describe('expandJobRows — job fields (0033 QA)', () => {
  it('copies every job field onto each service row and leaves the source job intact', () => {
    const src = { id: 'j1', plate: 'P', worker_price: 100, services: [wash, polish] };
    const rows = expandJobRows(src);
    expect(rows.every((r) => r.id === 'j1' && r.plate === 'P' && r.worker_price === 100)).toBe(true);
    expect(src.services).toEqual([wash, polish]);
  });
  it('treats a missing services field as one row', () => {
    const bare: { id: string; services?: unknown[] } = { id: 'j0' };
    expect(expandJobRows(bare)).toEqual([{ id: 'j0' }]);
  });
});
