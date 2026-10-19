import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './Icon';
import { Spinner, fieldClass } from './ui';

/**
 * The reservation number, editable in place (grid and dashboard cards). The
 * draft lives here so keystrokes don't re-render every row. Saves on blur or
 * Enter, only when changed; Enter moves to the next billing field.
 */
export default function BillingInput({
  committed,
  resetKey,
  onSave,
  fill,
  className = '',
}: {
  /** The value currently stored. */
  committed: string;
  /** Changes when the row is replaced under us (page or filter change). */
  resetKey: string;
  /** Resolves true when the save went through. */
  onSave: (value: string) => Promise<boolean>;
  /** Stretch to the row (cards) instead of the fixed grid-cell width. */
  fill?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(committed);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    setValue(committed);
    setState('idle');
  }, [committed, resetKey]);

  async function commit() {
    const next = value.trim();
    if (next === committed) return;
    setState('saving');
    const ok = await onSave(next);
    setState(ok ? 'saved' : 'error');
    if (ok) setTimeout(() => setState('idle'), 2000);
  }

  return (
    <div className={`flex items-center gap-2 ${fill ? 'min-w-0 flex-1' : ''}`}>
      <input
        value={value}
        aria-label={t('jobs.billingCode')}
        placeholder="—"
        data-billing-input
        onChange={(e) => {
          setValue(e.target.value);
          if (state !== 'idle') setState('idle');
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const all = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-billing-input]'));
            const next = all[all.indexOf(e.currentTarget) + 1];
            if (next) next.focus();
            else e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            setValue(committed);
            e.currentTarget.blur();
          }
        }}
        className={`${fieldClass} h-10 px-2 font-mono text-sm ${fill ? 'min-w-0 flex-1' : 'w-32'} ${
          state === 'error' ? 'border-danger-600 bg-danger-50' : ''
        } ${className}`}
      />
      {/* Status is a word for a screen reader and a glyph for everyone else —
          this cell is 32px wide and cannot carry a sentence. */}
      <span role="status" aria-live="polite" className="w-5 shrink-0">
        {state === 'saving' && <Spinner size={16} />}
        {state === 'saved' && <Icon name="checkCircle" size={16} className="text-ok-700" title={t('jobs.saved')} />}
        {state === 'error' && (
          <Icon name="alertCircle" size={16} className="text-danger-700" title={t('jobs.saveFailed')} />
        )}
      </span>
    </div>
  );
}
