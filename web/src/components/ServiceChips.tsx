import { useTranslation } from 'react-i18next';
import type { Service } from '../lib/types';
import Icon from './Icon';

interface Props {
  services: Service[];
  /** The chosen service, or null before anything is picked. */
  selected: string | null;
  onSelect: (serviceId: string) => void;
  label: string;
}

/**
 * The most-tapped control in the product — one tap per car, hundreds of times a
 * day, one-handed, next to a vehicle.
 *
 * Single-select since migration 0005: a job carries exactly one service. It is
 * a real radio group rather than a row of buttons with one highlighted, so a
 * screen reader announces "3 of 7" and arrow keys move between options — the
 * behaviour a sighted user already infers from the shape.
 *
 * Two properties are operational rather than decorative:
 *  - chips clear the 44px touch floor
 *  - selection is marked by a check glyph AND a filled near-black field, not by
 *    colour alone. A sun-hit phone screen washes out hue long before it washes
 *    out a shape, and "which service did I tap" is not a question the worker
 *    can afford to get wrong.
 *
 * There is no way to clear a selection: the field is required, and an empty
 * state is only reachable before the first tap.
 */
export default function ServiceChips({ services, selected, onSelect, label }: Props) {
  const { i18n } = useTranslation();

  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {services.map((service) => {
        const active = selected === service.id;
        const name = i18n.language === 'ru' && service.name_ru ? service.name_ru : service.name_en;
        return (
          <button
            key={service.id}
            type="button"
            role="radio"
            aria-checked={active}
            /* Only the active option stays in the tab order; arrow keys move
               within the group. Roving tabindex is what a radio group is
               supposed to do, and it stops a 20-service catalog from costing
               20 tab stops on the way to the note field. */
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
