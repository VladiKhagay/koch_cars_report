import { useTranslation } from 'react-i18next';
import { dayKey, monthKey, shiftMonth } from '../lib/dateRange';
import { IconButton, fieldClass } from './ui';

/**
 * Step a screen through calendar months (shared by My Jobs and My Stats). The
 * middle element is a native month picker; the arrows are what gets used. Labels
 * stay under `myJobs.*`, where they exist in all three locales.
 */
export default function MonthNav({
  month,
  onChange,
  className = '',
}: {
  /** `yyyy-mm`. */
  month: string;
  onChange: (month: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  // Nothing has been logged in a month that hasn't started.
  const currentMonth = monthKey(dayKey(new Date()));

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <IconButton
        icon="chevronLeft"
        variant="secondary"
        label={t('myJobs.prevMonth')}
        onClick={() => onChange(shiftMonth(month, -1))}
      />
      <input
        type="month"
        value={month}
        max={currentMonth}
        aria-label={t('myJobs.month')}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className={`${fieldClass} flex-1 text-center font-semibold`}
      />
      <IconButton
        icon="chevronRight"
        variant="secondary"
        label={t('myJobs.nextMonth')}
        disabled={month >= currentMonth}
        onClick={() => onChange(shiftMonth(month, 1))}
      />
    </div>
  );
}
