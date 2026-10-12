import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Site, StaffMember } from '../lib/types';
import { MAX_COWORKERS } from '../lib/jobs';
import { IconButton, SearchField, Select } from './ui';

/**
 * Up to MAX_COWORKERS people who worked the car with the submitter.
 *
 * Same "search narrows a native select" shape as the payment-sheet worker
 * picker (Export.tsx): the thing you finally tap is still the platform picker on
 * a phone. Staff from every site are offered — people help at other yards — so
 * each option carries its site to tell two Avis apart.
 *
 * Only active staff can be ADDED. Someone already on the job stays listed even
 * if deactivated since; removing them is still allowed.
 */
export default function CoworkerPicker({
  id,
  staff,
  sites,
  value,
  onChange,
  submitterId,
}: {
  id: string;
  staff: StaffMember[];
  sites: Site[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** Never offered as their own co-worker. */
  submitterId: string;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  const siteName = (siteId: string | null) => sites.find((s) => s.id === siteId)?.name;
  const label = (s: StaffMember) => [s.name, siteName(s.site_id)].filter(Boolean).join(' · ');

  const term = search.trim().toLowerCase();
  const candidates = staff.filter(
    (s) =>
      s.active &&
      s.id !== submitterId &&
      !value.includes(s.id) &&
      (!term || label(s).toLowerCase().includes(term)),
  );

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((personId) => {
            const person = staff.find((s) => s.id === personId);
            return (
              <li
                key={personId}
                className="inline-flex min-h-tap items-center gap-1 rounded-lg border border-ink-900 bg-ink-50 ps-3 text-sm font-semibold text-ink-900"
              >
                <span>{person ? label(person) : '—'}</span>
                <IconButton
                  icon="x"
                  label={t('coworkers.remove', { name: person?.name ?? '' })}
                  onClick={() => onChange(value.filter((v) => v !== personId))}
                />
              </li>
            );
          })}
        </ul>
      )}

      {value.length < MAX_COWORKERS ? (
        <>
          <SearchField value={search} onChange={setSearch} label={t('coworkers.search')} />
          <Select
            id={id}
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              onChange([...value, e.target.value]);
              setSearch('');
            }}
          >
            <option value="">{t('coworkers.pick')}</option>
            {candidates.map((s) => (
              <option key={s.id} value={s.id}>
                {label(s)}
              </option>
            ))}
          </Select>
          {term && candidates.length === 0 && <p className="text-sm text-ink-600">{t('coworkers.noMatches')}</p>}
        </>
      ) : (
        <p className="text-sm text-ink-600">{t('coworkers.max', { max: MAX_COWORKERS })}</p>
      )}
    </div>
  );
}
