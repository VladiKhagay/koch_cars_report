import { useTranslation } from 'react-i18next';
import { moveColumn, type ColumnConfig } from '../lib/reportConfig';
import { IconButton } from './ui';

/**
 * The customer-report column list: a checkbox per column, and (admin) arrows to
 * reorder. One component for the saved layout (Admin > Settings) and for the
 * per-download toggles on the export screen, so both read the same.
 */
export default function ReportColumns({
  columns,
  onChange,
  reorder,
}: {
  columns: ColumnConfig[];
  onChange: (next: ColumnConfig[]) => void;
  /** Show the move up/down arrows. Off for the per-download toggles of managers and Carasso. */
  reorder?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {columns.map((column, i) => (
        <li key={column.key} className="flex min-h-tap items-center gap-2 p-2">
          <label className="flex min-h-tap min-w-0 flex-1 items-center gap-3">
            <input
              type="checkbox"
              checked={column.visible}
              onChange={() => onChange(columns.map((c) => (c.key === column.key ? { ...c, visible: !c.visible } : c)))}
              className="size-5 shrink-0 accent-ink-900"
            />
            <span className={`min-w-0 break-words text-sm font-medium ${column.visible ? 'text-ink-900' : 'text-ink-500'}`}>
              {t(`export.columns.${column.key}`)}
            </span>
          </label>
          {reorder && (
            <div className="flex shrink-0 items-center">
              <IconButton
                icon="arrowUp"
                label={t('services.moveUp')}
                disabled={i === 0}
                onClick={() => onChange(moveColumn(columns, i, -1))}
              />
              <IconButton
                icon="arrowDown"
                label={t('services.moveDown')}
                disabled={i === columns.length - 1}
                onClick={() => onChange(moveColumn(columns, i, 1))}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
