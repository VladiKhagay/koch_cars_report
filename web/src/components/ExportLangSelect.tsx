import { useTranslation } from 'react-i18next';
import type { ExportLang } from '../lib/reportConfig';
import { Select } from './ui';

/** Compact file-language picker for screens whose export button sits in a toolbar. */
export default function ExportLangSelect({ value, onChange }: { value: ExportLang; onChange: (lang: ExportLang) => void }) {
  const { t } = useTranslation();
  return (
    <div className="w-auto">
      <Select aria-label={t('export.language')} value={value} onChange={(e) => onChange(e.target.value as ExportLang)}>
        <option value="he">עברית</option>
        <option value="en">English</option>
      </Select>
    </div>
  );
}
