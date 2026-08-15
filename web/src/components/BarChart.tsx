import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './Icon';

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

const HEIGHT = 224;
const TOP = 24;
const BOTTOM = 34;
const BAR_MAX_THICKNESS = 28;
const SLOT_PADDING = 18;
const MAX_LABEL_CHARS = 11;

/**
 * Hand-rolled SVG chart — there is no charting library here and adding one is
 * not worth the payload for three bar charts on a low-traffic screen.
 *
 * Every colour is a Tailwind utility resolving to a theme token rather than a
 * hex literal, so a palette swap reaches the charts. The old implementation
 * painted bars, gridlines, axis labels and the tooltip with five hardcoded hex
 * values, which meant a brand change would have left every chart on the
 * previous blue.
 *
 * Labels are 12px in ink-700 (about 8.6:1 on white) rather than 10px in a
 * mid-grey at roughly 3:1 — a manager may be reading this outdoors.
 */
export default function BarChart({ title, data, valueLabel }: Props) {
  const { t } = useTranslation();
  const uid = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const max = Math.max(1, ...data.map((d) => d.value));
  // Clean round ticks (0 / half / max, rounded up) rather than raw fractions.
  const axisMax = Math.ceil(max / 5) * 5 || max;

  const width = Math.max(data.length * (BAR_MAX_THICKNESS + SLOT_PADDING), 260);
  const barSlot = width / Math.max(data.length, 1);
  const barWidth = Math.min(BAR_MAX_THICKNESS, barSlot - 8);
  const plotHeight = HEIGHT - TOP - BOTTOM;

  // The chart scrolls sideways inside its card once there are more bars than
  // fit; say so, because a silent overflow reads as "these are all the workers".
  const scrolls = data.length > 6;

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        <button
          type="button"
          onClick={() => setShowTable((s) => !s)}
          aria-pressed={showTable}
          className="inline-flex min-h-tap items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-ink-700 transition-colors duration-150 hover:bg-ink-100 active:bg-ink-200"
        >
          <Icon name={showTable ? 'chart' : 'list'} size={16} />
          {showTable ? t('stats.showChart') : t('stats.showTable')}
        </button>
      </div>

      {data.length === 0 && (
        <p className="flex items-center justify-center gap-2 py-10 text-center text-sm font-medium text-ink-600">
          <Icon name="info" size={18} className="text-ink-500" />
          {t('stats.noData')}
        </p>
      )}

      {data.length > 0 && !showTable && (
        <>
          {/* The plot keeps LTR semantics under any UI language: the SVG is a
              fixed coordinate space, so mirroring the page would start the
              scroll at the last bar and put the axis origin on the right
              without moving a single drawn element. Numbers read LTR anyway. */}
          <div dir="ltr" className="overflow-x-auto">
            <svg
              viewBox={`0 0 ${width} ${HEIGHT}`}
              width={width}
              height={HEIGHT}
              role="img"
              aria-label={t('stats.chartLabel', { title })}
            >
              {/* Hairline gridlines at 0 / half / max */}
              {[0, 0.5, 1].map((f) => {
                const y = TOP + plotHeight * (1 - f);
                return <line key={f} x1={0} y1={y} x2={width} y2={y} className="stroke-ink-200" strokeWidth={1} />;
              })}
              {data.map((d, i) => {
                const x = i * barSlot + (barSlot - barWidth) / 2;
                const barHeight = axisMax > 0 ? (plotHeight * d.value) / axisMax : 0;
                const y = HEIGHT - BOTTOM - barHeight;
                const isHovered = hovered === i;
                const short =
                  d.label.length > MAX_LABEL_CHARS ? `${d.label.slice(0, MAX_LABEL_CHARS - 1)}…` : d.label;
                return (
                  <g key={i}>
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={Math.max(barHeight, 2)}
                      rx={3}
                      className={isHovered ? 'fill-ink-700' : 'fill-ink-900'}
                      tabIndex={0}
                      role="graphics-symbol"
                      aria-label={`${d.label}: ${d.value}`}
                      onPointerEnter={() => setHovered(i)}
                      onPointerLeave={() => setHovered(null)}
                      onFocus={() => setHovered(i)}
                      onBlur={() => setHovered(null)}
                    />
                    <text
                      x={x + barWidth / 2}
                      y={HEIGHT - 12}
                      textAnchor="middle"
                      fontSize={12}
                      className="fill-ink-700"
                    >
                      {short}
                    </text>
                    {isHovered && (
                      <g>
                        <rect
                          x={Math.min(Math.max(x + barWidth / 2 - 26, 0), width - 52)}
                          y={Math.max(y - 26, 0)}
                          width={52}
                          height={20}
                          rx={4}
                          className="fill-ink-900"
                        />
                        <text
                          x={Math.min(Math.max(x + barWidth / 2 - 26, 0), width - 52) + 26}
                          y={Math.max(y - 26, 0) + 14}
                          textAnchor="middle"
                          fontSize={12}
                          fontWeight={700}
                          className="fill-surface"
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
          {scrolls && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-ink-600">
              <Icon name="chevronRight" size={14} />
              {t('stats.scrollHint')}
            </p>
          )}
        </>
      )}

      {data.length > 0 && showTable && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start text-xs font-semibold text-ink-600">
              <th className="py-1.5">{title}</th>
              <th className="py-1.5 text-end">{valueLabel ?? t('stats.jobs')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={`${uid}-${i}`} className="border-t border-line">
                <td className="py-2 text-ink-900">{d.label}</td>
                <td className="py-2 text-end font-mono tabular-nums font-semibold text-ink-900">{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
