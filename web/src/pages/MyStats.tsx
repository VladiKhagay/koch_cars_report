import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { JobMonthlyStat } from '../lib/types';
import BarChart from '../components/BarChart';
import StatTile from '../components/StatTile';

function monthLabel(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale, { month: 'short', year: '2-digit' });
}

export default function MyStats() {
  const { t, i18n } = useTranslation();
  const { appUser } = useAuth();
  const [rows, setRows] = useState<JobMonthlyStat[]>([]);

  useEffect(() => {
    if (!appUser) return;
    supabase
      .from('job_monthly_stats')
      .select('*')
      .eq('worker_id', appUser.id)
      .order('month')
      .then(({ data }) => setRows(data ?? []));
  }, [appUser]);

  const total = rows.reduce((sum, r) => sum + r.job_count, 0);
  const thisMonthIso = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const thisMonth = rows.find((r) => r.month === thisMonthIso)?.job_count ?? 0;
  const avgPerMonth = rows.length > 0 ? Math.round(total / rows.length) : 0;

  const chartData = rows.slice(-12).map((r) => ({ label: monthLabel(r.month, i18n.language), value: r.job_count }));

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('stats.myStatsTitle')}</h1>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label={t('stats.totalJobs')} value={total} />
        <StatTile label={t('stats.jobsThisMonth')} value={thisMonth} />
        <StatTile label={t('stats.avgPerMonth')} value={avgPerMonth} />
      </div>

      <BarChart title={t('stats.jobsByMonth')} data={chartData} valueLabel={t('stats.jobs')} />
    </div>
  );
}
