import { describe, expect, it } from 'vitest';
import { serviceName } from './serviceName';

const svc = { name_en: 'Exterior wash', name_ru: 'Мойка кузова' };

describe('serviceName', () => {
  it('uses the locale column when it has one', () => {
    expect(serviceName(svc, 'ru')).toBe('Мойка кузова');
    expect(serviceName(svc, 'en')).toBe('Exterior wash');
  });

  it('treats a region-tagged locale as its base language', () => {
    expect(serviceName(svc, 'ru-RU')).toBe('Мойка кузова');
  });

  it('falls back to English rather than rendering a blank chip', () => {
    // Hebrew has no column yet; an empty string in one is not a translation.
    expect(serviceName(svc, 'he')).toBe('Exterior wash');
    expect(serviceName({ name_en: 'Polish', name_ru: null }, 'ru')).toBe('Polish');
    expect(serviceName({ name_en: 'Polish', name_ru: '' }, 'ru')).toBe('Polish');
  });

  it('reads name_he once the column exists', () => {
    expect(serviceName({ ...svc, name_he: 'שטיפה חיצונית' }, 'he')).toBe('שטיפה חיצונית');
  });

  it('returns null for a missing service so callers pick their own placeholder', () => {
    expect(serviceName(null, 'en')).toBeNull();
    expect(serviceName(undefined, 'en')).toBeNull();
  });
});
