import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Site, StaffMember } from '../lib/types';
import { MAX_COWORKERS } from '../lib/jobs';
import Icon from './Icon';
import { Button, IconButton, SearchField } from './ui';

/**
 * Up to MAX_COWORKERS people who worked the car with the submitter.
 *
 * One tap on "Add a co-worker" opens a search with the people already listed
 * under it, filtered as you type, and one tap on a name adds them. The matches
 * are on screen the whole time — the old search box only narrowed a hidden
 * dropdown, so you had to open it to see what the search had found.
 *
 * Staff from every site are offered, the submitter's own site first (that is
 * who they worked with). Only active staff can be added, but someone already on
 * the job stays listed and removable.
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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  // Straight into typing when the panel opens.
  useEffect(() => {
    if (open) panelRef.current?.querySelector('input')?.focus();
  }, [open]);

  const siteName = (siteId: string | null) => sites.find((s) => s.id === siteId)?.name;
  const label = (s: StaffMember) => [s.name, siteName(s.site_id)].filter(Boolean).join(' · ');
  const mySite = staff.find((s) => s.id === submitterId)?.site_id;

  const term = search.trim().toLowerCase();
  const candidates = staff
    .filter(
      (s) =>
        s.active &&
        s.id !== submitterId &&
        !value.includes(s.id) &&
        (!term || label(s).toLowerCase().includes(term)),
    )
    .sort(
      (a, b) =>
        Number(b.site_id === mySite) - Number(a.site_id === mySite) || a.name.localeCompare(b.name),
    );

  function add(personId: string) {
    onChange([...value, personId]);
    setSearch('');
    setOpen(false);
  }

  function close() {
    setSearch('');
    setOpen(false);
  }

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

      {value.length >= MAX_COWORKERS ? (
        <p className="text-sm text-ink-600">{t('coworkers.max', { max: MAX_COWORKERS })}</p>
      ) : !open ? (
        <Button id={id} variant="secondary" icon="plus" block onClick={() => setOpen(true)}>
          {t('coworkers.add')}
        </Button>
      ) : (
        <div
          ref={panelRef}
          className="overflow-hidden rounded-xl border border-line-strong bg-surface"
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            // Enter takes the top match, so a typed name is two actions: type, Enter.
            if (e.key === 'Enter' && candidates[0]) {
              e.preventDefault();
              add(candidates[0].id);
            }
          }}
        >
          <div className="flex items-center gap-2 p-2">
            <SearchField className="flex-1" value={search} onChange={setSearch} label={t('coworkers.search')} />
            <IconButton icon="x" label={t('coworkers.close')} onClick={close} />
          </div>

          <ul className="max-h-64 overflow-y-auto border-t border-line">
            {candidates.map((s) => (
              <li key={s.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => add(s.id)}
                  className="flex min-h-control w-full items-center justify-between gap-3 px-4 text-start active:bg-ink-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold text-ink-900">{s.name}</span>
                    {siteName(s.site_id) && (
                      <span className="block truncate text-xs text-ink-600">{siteName(s.site_id)}</span>
                    )}
                  </span>
                  <Icon name="plus" size={18} className="shrink-0 text-ink-500" />
                </button>
              </li>
            ))}
          </ul>

          <p role="status" className="px-4 py-3 text-sm text-ink-600 empty:hidden">
            {candidates.length === 0 ? t('coworkers.noMatches') : ''}
          </p>
        </div>
      )}
    </div>
  );
}
