/**
 * Which name to show for a catalog service, in the language being read.
 *
 * This lived inline in six places as `language === 'ru' && name_ru ? … : name_en`,
 * which had two consequences worth naming:
 *
 *  - Hebrew shipped as a full locale, but every one of those six branches asks
 *    only about Russian, so a Hebrew user gets a Hebrew interface and English
 *    service names — on the most-tapped control in the product.
 *  - Adding a locale meant finding all six. One of them (Job Detail) had
 *    already been missed once and rendered name_en to everybody.
 *
 * `name_he` landed in migration 0012. It stays optional in both senses: the
 * column is nullable, and a service with no Hebrew name falls back to English
 * rather than rendering blank.
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
