/**
 * Which name to show for a catalog service in the language being read: Hebrew
 * (`name_he`, 0012) or Russian when present, else English. One place, so adding
 * a locale doesn't mean finding every inline branch.
 */

/** Any row carrying the catalog's localized names — the full Service, or a join. */
export interface ServiceNames {
  name_en: string;
  name_ru?: string | null;
  name_he?: string | null;
}

export function serviceName(service: ServiceNames | null | undefined, language: string): string | null {
  if (!service) return null;
  // `he-IL` and `he` must behave the same; i18n.language is region-tagged the
  // moment anything sets a locale rather than a bare language code.
  const code = language.split('-')[0];
  const localized = code === 'ru' ? service.name_ru : code === 'he' ? service.name_he : null;
  return localized || service.name_en;
}
