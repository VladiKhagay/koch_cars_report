import { useTranslation } from 'react-i18next';
import type { Service } from '../lib/types';
import { serviceName } from '../lib/serviceName';
import Icon from './Icon';

interface Props {
  services: Service[];
  /** The chosen service, or null before anything is picked. */
  selected: string | null;
  onSelect: (serviceId: string) => void;
  label: string;
}

/**
 * The most-tapped control: one tap per car, one-handed. A real radio group
 * (single-select since migration 0005) so screen readers announce position and
 * arrows move between options. Chips clear the 44px touch floor, and selection
 * is a check glyph plus a filled field, not colour alone. No way to clear: the
 * field is required.
 */
export default function ServiceChips({ services, selected, onSelect, label }: Props) {
  const { i18n } = useTranslation();

  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {services.map((service) => {
        const active = selected === service.id;
        const name = serviceName(service, i18n.language);
        return (
          <button
            key={service.id}
            type="button"
            role="radio"
            aria-checked={active}
                        /* Roving tabindex: only the active option is a tab stop, so 20 services
                           don't cost 20 tab stops. */
            tabIndex={active || (!selected && services[0]?.id === service.id) ? 0 : -1}
            onClick={() => onSelect(service.id)}
            onKeyDown={(e) => {
              /* The horizontal keys follow the reading direction: in Hebrew the
                 chips are laid out right-to-left, so ArrowLeft is "next". The
                 vertical pair is unaffected — down is always forward. */
              const forward = document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
              const back = forward === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
              const step =
                e.key === forward || e.key === 'ArrowDown'
                  ? 1
                  : e.key === back || e.key === 'ArrowUp'
                    ? -1
                    : 0;
              if (step === 0) return;
              e.preventDefault();
              // Anchored on the focused chip, not on `selected` — they differ
              // while arrowing, and focus is what the user is steering.
              const here = services.findIndex((s) => s.id === service.id);
              const next = (here + step + services.length) % services.length;
              onSelect(services[next].id);
              (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
            }}
            className={`inline-flex min-h-control items-center gap-2 rounded-lg border px-3.5 text-sm font-semibold transition-colors duration-150 ${
              active
                ? 'border-ink-900 bg-ink-900 text-surface'
                : 'border-line-strong bg-surface text-ink-900 hover:bg-ink-50'
            }`}
          >
            <Icon
              name={active ? 'check' : 'plus'}
              size={16}
              className={active ? 'shrink-0' : 'shrink-0 text-ink-500'}
            />
            <span className="text-start">{name}</span>
          </button>
        );
      })}
    </div>
  );
}
