import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface BarDatum {
  label: string;
  value: number;
}

interface Props {
  title: string;
  data: BarDatum[];
  /** Table view is the accessibility fallback — visible via toggle, not hidden entirely. */
  valueLabel?: string;
}

const HEIGHT = 200;
const BAR_MAX_THICKNESS = 24;
const GAP = 2;

export default function BarChart({ title, data, valueLabel }: Props) {
  const { t } = useTranslation();
  const uid = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const max = Math.max(1, ...data.map((d) => d.value));
  // Clean round ticks (0 / half / max, rounded up) rather than raw fractions.
  const axisMax = Math.ceil(max / 5) * 5 || max;

  const width = Math.max(data.length * (BAR_MAX_THICKNESS + 16), 240);
  const barSlot = width / Math.max(data.length, 1);
  const barWidth = Math.min(BAR_MAX_THICKNESS, barSlot - GAP * 2);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-700">{title}</h3>
        <button
          type="button"
          onClick={() => setShowTable((s) => !s)}
          className="text-xs font-medium text-slate-400 underline underline-offset-2"
        >
          {showTable ? t('stats.showChart') : t('stats.showTable')}
        </button>
      </div>

      {data.length === 0 && <p className="py-8 text-center text-sm text-slate-400">{t('stats.noData')}</p>}

      {data.length > 0 && !showTable && (
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} role="img" aria-label={title}>
            {/* Hairline gridlines at 0 / half / max */}
            {[0, 0.5, 1].map((f) => {
              const y = 24 + (HEIGHT - 48) * (1 - f);
              return <line key={f} x1={0} y1={y} x2={width} y2={y} stroke="#e1e0d9" strokeWidth={1} />;
            })}
            {data.map((d, i) => {
              const x = i * barSlot + (barSlot - barWidth) / 2;
              const barHeight = axisMax > 0 ? ((HEIGHT - 48) * d.value) / axisMax : 0;
              const y = HEIGHT - 24 - barHeight;
              const isHovered = hovered === i;
              return (
                <g key={i}>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(barHeight, 1)}
                    rx={4}
                    fill={isHovered ? '#1d4ed8' : '#2563eb'}
                    tabIndex={0}
                    role="graphics-symbol"
                    aria-label={`${d.label}: ${d.value}`}
                    onPointerEnter={() => setHovered(i)}
                    onPointerLeave={() => setHovered(null)}
                    onFocus={() => setHovered(i)}
                    onBlur={() => setHovered(null)}
                  />
                  <text x={x + barWidth / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={10} fill="#898781">
                    {d.label}
                  </text>
                  {isHovered && (
                    <g>
                      <rect
                        x={Math.min(Math.max(x - 16, 0), width - 64)}
                        y={Math.max(y - 24, 0)}
                        width={64}
                        height={18}
                        rx={4}
                        fill="#0b0b0b"
                      />
                      <text
                        x={Math.min(Math.max(x - 16, 0), width - 64) + 32}
                        y={Math.max(y - 24, 0) + 12}
                        textAnchor="middle"
                        fontSize={11}
                        fontWeight={600}
                        fill="#ffffff"
                      >
                        {d.value}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {data.length > 0 && showTable && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400">
              <th className="py-1 font-medium">{title}</th>
              <th className="py-1 text-right font-medium">{valueLabel ?? t('stats.jobs')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={`${uid}-${i}`} className="border-t border-slate-100">
                <td className="py-1.5 text-slate-700">{d.label}</td>
                <td className="py-1.5 text-right font-mono tabular-nums text-slate-900">{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
