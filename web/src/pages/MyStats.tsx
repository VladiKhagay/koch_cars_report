import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { dayKey, monthKey, monthRange, shiftMonth } from '../lib/dateRange';
import { percentChange, shares, type Slice } from '../lib/monthStats';
import { serviceName, type ServiceNames } from '../lib/serviceName';
import type { JobMonthlyStat } from '../lib/types';
import BarChart from '../components/BarChart';
import Icon from '../components/Icon';
import MonthNav from '../components/MonthNav';
import StatTile from '../components/StatTile';
import { EmptyState, Group, Page, PageHeading, SectionHeading, Skeleton } from '../components/ui';

/** The slice of `job_daily_stats` this screen reads. */
interface ServiceCount {
  service_id: string;
  job_count: number;
}

function monthLabel(month: string, locale: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(locale, { month: 'short', year: '2-digit' });
}

export default function MyStats() {
  const { t, i18n } = useTranslation();
  const { appUser } = useAuth();
  const [rows, setRows] = useState<JobMonthlyStat[]>([]);
  const [loading, setLoading] = useState(true);

  /** The month everything below the trend chart is about. Current on arrival. */
  const [month, setMonth] = useState(() => monthKey(dayKey(new Date())));
  /* Only the two columns the breakdown adds up — typing this as a whole
     JobDailyStat would claim a worker_cost the query never asked for, and a
     worker cannot read that column anyway. */
  const [serviceRows, setServiceRows] = useState<ServiceCount[]>([]);
  const [serviceLabels, setServiceLabels] = useState<Record<string, string>>({});
  const [monthLoading, setMonthLoading] = useState(true);

  // The whole history, one row per month. Small enough to hold: a worker
  // logging 300 cars a month for five years is 60 rows.
  useEffect(() => {
    if (!appUser) return;
    supabase
      .from('job_monthly_stats')
      .select('*')
      .eq('worker_id', appUser.id)
      .order('month')
      .then(({ data }) => {
        setRows(data ?? []);
        setLoading(false);
      });
  }, [appUser]);

  /* The service catalog, including anything soft-deleted: a month from last
     spring can reference a service that has since been retired, and dropping
     it would silently shrink that month's breakdown rather than show what was
     actually done. Names only — the catalog number means nothing on a chart. */
  useEffect(() => {
    supabase
      .from('services')
      .select('id, name_en, name_ru, name_he')
      .then(({ data }) =>
        setServiceLabels(
          Object.fromEntries(
            ((data ?? []) as (ServiceNames & { id: string })[]).map((s) => [
              s.id,
              serviceName(s, i18n.language) ?? '',
            ]),
          ),
        ),
      );
  }, [i18n.language]);

  /* Only the selected month is fetched, and only when it changes. The trend
     chart above is served by the monthly view, so stepping through months
     costs one narrow query rather than re-reading a year of daily rows. */
  useEffect(() => {
    if (!appUser) return;
    const { from, to } = monthRange(month);
    let live = true;
    setMonthLoading(true);
    supabase
      .from('job_daily_stats')
      .select('service_id, job_count')
      .eq('worker_id', appUser.id)
      .gte('day', from)
      .lte('day', to)
      .then(({ data }) => {
        // A slow response for a month the worker has already stepped past must
        // not overwrite the month they are now looking at.
        if (!live) return;
        setServiceRows((data ?? []) as ServiceCount[]);
        setMonthLoading(false);
      });
    return () => {
      live = false;
    };
  }, [appUser, month]);

  const total = rows.reduce((sum, r) => sum + r.job_count, 0);
  const avgPerMonth = rows.length > 0 ? Math.round(total / rows.length) : 0;

  const countFor = (m: string) => rows.find((r) => monthKey(r.month) === m)?.job_count ?? 0;
  const monthTotal = countFor(month);
  const prevTotal = countFor(shiftMonth(month, -1));
  const change = percentChange(monthTotal, prevTotal);

  // Twelve months ending at the selected one, so stepping back moves the
  // window with it instead of always showing the run-up to today.
  const trend = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => shiftMonth(month, i - 11));
    const byMonth = new Map(rows.map((r) => [monthKey(r.month), r.job_count]));
    return months.map((m) => ({ label: monthLabel(m, i18n.language), value: byMonth.get(m) ?? 0 }));
  }, [rows, month, i18n.language]);

  const byService = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of serviceRows) counts.set(r.service_id, (counts.get(r.service_id) ?? 0) + r.job_count);
    return shares(counts, (id) => serviceLabels[id] ?? t('myJobs.noService'));
  }, [serviceRows, serviceLabels, t]);

  return (
    <Page width="form">
      <PageHeading>{t('stats.myStatsTitle')}</PageHeading>

      {loading && (
        <div className="grid grid-cols-3 gap-3" aria-hidden>
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}

      {/* A new worker used to meet three zeroes and an empty chart, and read it
          as "the app isn't recording my work". Say what is actually true. */}
      {!loading && rows.length === 0 && (
        <EmptyState icon="chart" title={t('stats.emptyTitle')} body={t('stats.emptyBody')} />
      )}

      {!loading && rows.length > 0 && (
        <Group>
          {/* The month picker leads: every number under it is about one month,
              so the control that chooses the month comes before them rather
              than being buried under the charts it governs. */}
          <MonthNav month={month} onChange={setMonth} />

          <div className="grid grid-cols-3 gap-3">
            {/* Not "This month": the picker above can be sitting on March, and
                a tile that still says "this month" over March is a wrong
                number rather than a stale label. */}
            <StatTile label={t('stats.monthJobs')} value={monthTotal} />
            <StatTile label={t('stats.totalJobs')} value={total} />
            <StatTile label={t('stats.avgPerMonth')} value={avgPerMonth} />
          </div>

          <ChangeNote change={change} previous={prevTotal} prevMonth={shiftMonth(month, -1)} />

          <ServiceBreakdown slices={byService} loading={monthLoading} />

          {/* The same counts over time, held close to the tiles they explain.
              The window ends at the selected month, so it always contains it. */}
          <BarChart title={t('stats.jobsByMonth')} data={trend} valueLabel={t('stats.jobs')} />
        </Group>
      )}
    </Page>
  );
}

/**
 * This month against last, in words.
 *
 * Deliberately not green-up / red-down: a quieter month is usually fewer cars
 * arriving, not a failing worker, and painting it in the same red the app uses
 * for errors makes the workshop's weather look like the worker's fault. The
 * arrow carries the direction; only the increase gets colour.
 */
function ChangeNote({ change, previous, prevMonth }: { change: number | null; previous: number; prevMonth: string }) {
  const { t, i18n } = useTranslation();
  const label = monthLabel(prevMonth, i18n.language);

  if (change === null) {
    return (
      <p className="flex items-center gap-1.5 text-sm font-medium text-ink-600">
        <Icon name="info" size={16} className="shrink-0 text-ink-500" />
        {t('stats.noComparison', { month: label })}
      </p>
    );
  }

  const up = change > 0;
  return (
    <p className={`flex flex-wrap items-center gap-x-1.5 text-sm font-semibold ${up ? 'text-ok-700' : 'text-ink-700'}`}>
      {change !== 0 && <Icon name={up ? 'arrowUp' : 'arrowDown'} size={16} className="shrink-0" />}
      {/* The direction is spelled into the sentence, so it survives for anyone
          who can't see the arrow or the colour. */}
      <span>
        {change === 0
          ? t('stats.changeSame', { month: label })
          : t(up ? 'stats.changeUp' : 'stats.changeDown', { percent: Math.abs(change), month: label })}
      </span>
      <span className="font-normal text-ink-600">{t('stats.changeFrom', { jobs: previous })}</span>
    </p>
  );
}

/* Ranked shades of one hue rather than a categorical palette: the ordering IS
   the encoding, it stays legible to every kind of colour blindness and in
   greyscale, and it doesn't invent brand colours the theme doesn't have. */
const SHADES = ['bg-ink-900', 'bg-ink-800', 'bg-ink-700', 'bg-ink-600', 'bg-ink-500', 'bg-ink-400'];

/**
 * Jobs by service for the selected month.
 *
 * A horizontal bar per service rather than a pie: this is read on a phone, the
 * labels sit next to their own bars instead of in a legend that has to be
 * matched back by colour, and comparing lengths beats comparing wedges. Every
 * bar carries its exact count and its share as text, so the graphic is a
 * second reading of the numbers rather than the only one.
 */
function ServiceBreakdown({ slices, loading }: { slices: Slice[]; loading: boolean }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...slices.map((s) => s.value));

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <SectionHeading icon="chart">{t('stats.jobsByService')}</SectionHeading>

      {loading && (
        <div className="space-y-3" aria-hidden>
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      )}

      {!loading && slices.length === 0 && (
        <p className="flex items-center justify-center gap-2 py-8 text-center text-sm font-medium text-ink-600">
          <Icon name="info" size={18} className="text-ink-500" />
          {t('stats.emptyMonth')}
        </p>
      )}

      {!loading && slices.length > 0 && (
        <ul className="space-y-3">
          {slices.map((s, i) => (
            <li key={s.label} title={t('stats.serviceTooltip', { service: s.label, count: s.value, percent: s.share })}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-ink-900">{s.label}</span>
                <span className="shrink-0 font-mono text-sm tabular-nums text-ink-700">
                  <span className="font-semibold text-ink-900">{s.value}</span> · {s.share}%
                </span>
              </div>
              {/* Decorative: the count and the share are already text above it,
                  so a screen reader reading the bar too would just repeat them. */}
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-100" aria-hidden>
                <div
                  className={`h-full rounded-full ${SHADES[Math.min(i, SHADES.length - 1)]}`}
                  style={{ inlineSize: `${Math.max((s.value / max) * 100, 2)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
