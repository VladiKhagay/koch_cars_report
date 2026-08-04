import { useTranslation } from 'react-i18next';
import type { Service } from '../lib/types';

interface Props {
  services: Service[];
  selected: string[];
  onToggle: (serviceId: string) => void;
}

export default function ServiceChips({ services, selected, onToggle }: Props) {
  const { i18n } = useTranslation();

  return (
    <div className="flex flex-wrap gap-2">
      {services.map((service) => {
        const active = selected.includes(service.id);
        const label = i18n.language === 'ru' && service.name_ru ? service.name_ru : service.name_en;
        return (
          <button
            key={service.id}
            type="button"
            onClick={() => onToggle(service.id)}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-slate-300 bg-white text-slate-700'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
