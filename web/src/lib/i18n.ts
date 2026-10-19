import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import ru from '../locales/ru.json';
import he from '../locales/he.json';

/** The languages the product ships in, in switcher order, each labelled in its own script. */
export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'ru', label: 'Русский', short: 'RU' },
  { code: 'he', label: 'עברית', short: 'עב' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];

const RTL: ReadonlySet<string> = new Set(['he']);

function isLang(value: string | null): value is Lang {
  return LANGUAGES.some((l) => l.code === value);
}

/**
 * Direction lives on <html>, not React state, so Tailwind's `rtl:` variant, the
 * logical utilities and native controls follow it. `lang` moves with it.
 */
function applyDirection(lang: string) {
  const root = document.documentElement;
  root.lang = lang;
  root.dir = RTL.has(lang) ? 'rtl' : 'ltr';
}

// Registered before init so the initial language sets direction too.
i18n.on('languageChanged', applyDirection);

void i18n
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, ru: { translation: ru }, he: { translation: he } },
    lng: isLang(localStorage.getItem('lang')) ? (localStorage.getItem('lang') as Lang) : 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export function setLanguage(lang: Lang) {
  localStorage.setItem('lang', lang);
  void i18n.changeLanguage(lang);
}

export default i18n;
