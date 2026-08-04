import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import ru from '../locales/ru.json';

void i18n
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, ru: { translation: ru } },
    lng: localStorage.getItem('lang') ?? 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export function setLanguage(lang: 'en' | 'ru') {
  localStorage.setItem('lang', lang);
  void i18n.changeLanguage(lang);
}

export default i18n;
