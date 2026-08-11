import { ServiceChips } from 'web';
import type { Service } from 'web';

// Shape matches src/lib/types.ts Service. Catalog numbers follow the
// admin-assigned "SVC-###" convention.
const svc = (n: number, en: string, ru: string, order: number): Service => ({
  id: `svc-${n}`,
  catalog_number: `SVC-${String(n).padStart(3, '0')}`,
  name_en: en,
  name_ru: ru,
  active: true,
  sort_order: order,
});

const SERVICES: Service[] = [
  svc(1, 'Exterior wash', 'Мойка кузова', 1),
  svc(2, 'Interior vacuum', 'Пылесос салона', 2),
  svc(4, 'Wax & polish', 'Полировка и воск', 3),
  svc(7, 'Engine bay clean', 'Мойка моторного отсека', 4),
  svc(11, 'Wheel & tyre dressing', 'Обработка дисков и шин', 5),
];

const noop = () => {};

/** The New Job state a worker sees mid-flow: a couple of services tapped. */
export const Default = () => (
  <div className="max-w-sm bg-white p-4">
    <ServiceChips services={SERVICES} selected={['svc-1', 'svc-4']} onToggle={noop} />
  </div>
);

/** Fresh form — nothing picked yet. Submitting here trips "Pick at least one service". */
export const NoneSelected = () => (
  <div className="max-w-sm bg-white p-4">
    <ServiceChips services={SERVICES} selected={[]} onToggle={noop} />
  </div>
);

/** Full-detail job — every chip in its selected (brand-600) state. */
export const AllSelected = () => (
  <div className="max-w-sm bg-white p-4">
    <ServiceChips services={SERVICES} selected={SERVICES.map((s) => s.id)} onToggle={noop} />
  </div>
);

/** A long catalog wraps onto multiple rows; tap targets stay ≥44px tall. */
export const ManyServices = () => (
  <div className="max-w-sm bg-white p-4">
    <ServiceChips
      services={[
        ...SERVICES,
        svc(12, 'Headlight restoration', 'Полировка фар', 6),
        svc(15, 'Ozone odour treatment', 'Озонирование салона', 7),
        svc(18, 'Leather conditioning', 'Уход за кожей', 8),
        svc(21, 'Ceramic coating', 'Керамическое покрытие', 9),
      ]}
      selected={['svc-2', 'svc-11', 'svc-18']}
      onToggle={noop}
    />
  </div>
);
