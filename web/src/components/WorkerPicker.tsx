import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './Icon';
import { IconButton, SearchField } from './ui';
import { enterPick, workerPickerOptions, type PickableWorker } from './workerPickerOptions';

/**
 * One person, picked from a search field with the matches listed under it
 * (the single-select sibling of CoworkerPicker). Nothing picked: everyone is
 * listed, narrowed as you type. Picked: their row stays on top, marked, with
 * a clear button; typing lists the others beneath it to switch to.
 */
export default function WorkerPicker({
  id,
  workers,
  value,
  onChange,
}: {
  /** The search field's id, for the Field label. */
  id: string;
  workers: PickableWorker[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const { selected, matches, term, noMatches } = workerPickerOptions(workers, value, search);
  // Once someone is picked, the others only show while searching for a replacement.
  const listed = selected && !term ? [] : matches;

  function pick(personId: string) {
    onChange(personId);
    setSearch('');
  }

  return (
    <div
      className="overflow-hidden rounded-xl border border-line-strong bg-surface"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setSearch('');
        // Enter in the search takes the top match, so a typed name is two actions: type, Enter.
        const top = enterPick(e.key, e.target instanceof HTMLInputElement, term ? listed : []);
        if (top) {
          e.preventDefault();
          pick(top);
        }
      }}
    >
      <div className="p-2">
        <SearchField
          id={id}
          // So the field announces who is picked, not just "Worker, search".
          describedBy={selected ? `${id}-selected` : undefined}
          value={search}
          onChange={setSearch}
          label={t('export.searchWorkers')}
        />
      </div>

      {selected && (
        <div className="flex min-h-control items-center justify-between gap-3 border-t border-line bg-ink-50 ps-4 pe-1">
          <span className="flex min-w-0 items-center gap-2">
            <Icon name="check" size={18} className="shrink-0 text-ink-900" />
            <span id={`${id}-selected`} className="truncate text-base font-semibold text-ink-900">
              {selected.name}
            </span>
          </span>
          <IconButton
            icon="x"
            label={t('export.clearWorker', { name: selected.name })}
            onClick={() => {
              onChange('');
              // The button goes with the selection; keep focus in the field.
              document.getElementById(id)?.focus();
            }}
          />
        </div>
      )}

      {listed.length > 0 && (
        <ul aria-label={t('export.pickWorker')} className="max-h-64 overflow-y-auto border-t border-line">
          {listed.map((w) => (
            <li key={w.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => pick(w.id)}
                className="flex min-h-control w-full items-center px-4 text-start text-base font-semibold text-ink-900 active:bg-ink-50"
              >
                <span className="truncate">{w.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p role="status" className="border-t border-line px-4 py-3 text-sm text-ink-600 empty:hidden">
        {noMatches ? t('export.noWorkerMatches') : ''}
      </p>
    </div>
  );
}
