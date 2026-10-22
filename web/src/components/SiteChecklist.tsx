import { useTranslation } from 'react-i18next';
import type { Site } from '../lib/types';

/** Multi-select of sites as a checkbox group (a native multi-select is unusable on a phone). */
export default function SiteChecklist({
  sites,
  value,
  onChange,
  label,
}: {
  sites: Site[];
  value: string[];
  onChange: (ids: string[]) => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium text-ink-700">{label}</legend>
      {sites.length === 0 ? (
        <p className="text-sm text-ink-600">{t('admin.noSitesYet')}</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {sites.map((s) => (
            <li key={s.id}>
              <label className="flex min-h-tap items-center gap-3 px-3">
                <input
                  type="checkbox"
                  checked={value.includes(s.id)}
                  onChange={() => onChange(value.includes(s.id) ? value.filter((id) => id !== s.id) : [...value, s.id])}
                  className="size-5 shrink-0 accent-ink-900"
                />
                <span className="min-w-0 break-words text-sm font-medium text-ink-900">{s.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
