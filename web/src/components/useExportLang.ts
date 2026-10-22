import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getExportLang, setExportLang } from '../lib/excelFile';
import type { ExportLang } from '../lib/reportConfig';

/** The language of the files this person downloads: Hebrew until they choose otherwise, remembered per user. */
export function useExportLang(): [ExportLang, (lang: ExportLang) => void] {
  const { appUser } = useAuth();
  const id = appUser?.id;
  const [lang, setLang] = useState<ExportLang>(() => getExportLang(id));
  useEffect(() => setLang(getExportLang(id)), [id]);
  return [
    lang,
    (next) => {
      setLang(next);
      setExportLang(id, next);
    },
  ];
}
