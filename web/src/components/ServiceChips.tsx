import { useTranslation } from 'react-i18next';
import type { Service } from '../lib/types';
import { serviceName } from '../lib/serviceName';
import Icon from './Icon';

interface Props {
  services: Service[];
  /** The chosen services, in any order. Empty before anything is picked. */
  selected: string[];
  onToggle: (serviceId: string) => void;
  label: string;
}

/**
 * The most-tapped control: one tap per service, one-handed. Multi-select since
 * 0033, so each chip is a toggle button (aria-pressed) in a labelled group;
 * plain Tab order, no roving focus. Chips clear the 44px touch floor, and
 * selection is a check glyph plus a filled field, not colour alone.
 */
export default function ServiceChips({ services, selected, onToggle, label }: Props) {
  const { i18n } = useTranslation();

  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {services.map((service) => {
        const active = selected.includes(service.id);
        return (
          <button
            key={service.id}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(service.id)}
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
            <span className="text-start">{serviceName(service, i18n.language)}</span>
          </button>
        );
      })}
    </div>
  );
}
