import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { JobMonthlyStat } from '../lib/types';
import BarChart from '../components/BarChart';
import StatTile from '../components/StatTile';
import { EmptyState, Page, PageHeading, Skeleton } from '../components/ui';

function monthLabel(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale, { month: 'short', year: '2-digit' });
}

export default function MyStats() {
  const { t, i18n } = useTranslation();
  const { appUser } = useAuth();
  const [rows, setRows] = useState<JobMonthlyStat[]>([]);
  const [loading, setLoading] = useState(true);

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

  const total = rows.reduce((sum, r) => sum + r.job_count, 0);
  const thisMonthIso = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const thisMonth = rows.find((r) => r.month === thisMonthIso)?.job_count ?? 0;
  const avgPerMonth = rows.length > 0 ? Math.round(total / rows.length) : 0;

  const chartData = rows.slice(-12).map((r) => ({ label: monthLabel(r.month, i18n.language), value: r.job_count }));

  return (
    <Page width="form" className="space-y-5">
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
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatTile label={t('stats.totalJobs')} value={total} />
            <StatTile label={t('stats.jobsThisMonth')} value={thisMonth} />
            <StatTile label={t('stats.avgPerMonth')} value={avgPerMonth} />
          </div>

          <BarChart title={t('stats.jobsByMonth')} data={chartData} valueLabel={t('stats.jobs')} />
        </>
      )}
    </Page>
  );
}
