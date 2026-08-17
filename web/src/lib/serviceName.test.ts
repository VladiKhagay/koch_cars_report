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

  /* A Hebrew name is optional (migration 0012), so most of the catalog will
     not have one for a while. Every empty shape has to reach English rather
     than render a chip with nothing in it. */
  it('falls back to English rather than rendering a blank chip', () => {
    expect(serviceName(svc, 'he')).toBe('Exterior wash');
    expect(serviceName({ ...svc, name_he: null }, 'he')).toBe('Exterior wash');
    expect(serviceName({ ...svc, name_he: '' }, 'he')).toBe('Exterior wash');
    expect(serviceName({ name_en: 'Polish', name_ru: null }, 'ru')).toBe('Polish');
    expect(serviceName({ name_en: 'Polish', name_ru: '' }, 'ru')).toBe('Polish');
  });

  it('uses the Hebrew name when one has been entered', () => {
    expect(serviceName({ ...svc, name_he: 'שטיפה חיצונית' }, 'he')).toBe('שטיפה חיצונית');
    expect(serviceName({ ...svc, name_he: 'שטיפה חיצונית' }, 'he-IL')).toBe('שטיפה חיצונית');
    // And only for Hebrew — it must not leak into the other two locales.
    expect(serviceName({ ...svc, name_he: 'שטיפה חיצונית' }, 'en')).toBe('Exterior wash');
    expect(serviceName({ ...svc, name_he: 'שטיפה חיצונית' }, 'ru')).toBe('Мойка кузова');
  });

  it('returns null for a missing service so callers pick their own placeholder', () => {
    expect(serviceName(null, 'en')).toBeNull();
    expect(serviceName(undefined, 'en')).toBeNull();
  });
});
