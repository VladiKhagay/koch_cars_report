import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import type { JobMonthlyStat, JobServiceStat, Site } from '../lib/types';
import BarChart from '../components/BarChart';
import StatTile from '../components/StatTile';

function monthLabel(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale, { month: 'short', year: '2-digit' });
}

function currentMonthIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

export default function Analytics() {
  const { t, i18n } = useTranslation();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [month, setMonth] = useState(currentMonthIso());
  const [monthlyStats, setMonthlyStats] = useState<JobMonthlyStat[]>([]);
  const [serviceStats, setServiceStats] = useState<JobServiceStat[]>([]);
  const [workerNames, setWorkerNames] = useState<Record<string, string>>({});
  const [serviceLabels, setServiceLabels] = useState<Record<string, string>>({});
  const [jobsToday, setJobsToday] = useState(0);

  useEffect(() => {
    supabase.from('sites').select('*').order('name').then(({ data }) => {
      setSites(data ?? []);
      setSiteId((data ?? [])[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!siteId) return;
    void load(siteId);
  }, [siteId]);

  async function load(site: string) {
    const { data: monthly } = await supabase.from('job_monthly_stats').select('*').eq('site_id', site);
    setMonthlyStats(monthly ?? []);

    const { data: services } = await supabase.from('job_service_stats').select('*').eq('site_id', site);
    setServiceStats(services ?? []);

    const workerIds = [...new Set((monthly ?? []).map((r) => r.worker_id))];
    if (workerIds.length > 0) {
      const { data: users } = await supabase.from('users').select('id, name').in('id', workerIds);
      setWorkerNames(Object.fromEntries((users ?? []).map((u) => [u.id, u.name])));
    }

    const serviceIds = [...new Set((services ?? []).map((r) => r.service_id))];
    if (serviceIds.length > 0) {
      const { data: svc } = await supabase.from('services').select('id, catalog_number, name_en').in('id', serviceIds);
      setServiceLabels(Object.fromEntries((svc ?? []).map((s) => [s.id, `${s.catalog_number} ${s.name_en}`])));
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', site)
      .is('deleted_at', null)
      .gte('created_at', startOfDay.toISOString());
    setJobsToday(count ?? 0);
  }

  const monthlyTrend = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const r of monthlyStats) byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.job_count);
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([m, v]) => ({ label: monthLabel(m, i18n.language), value: v }));
  }, [monthlyStats, i18n.language]);

  const totalThisMonth = useMemo(
    () => monthlyStats.filter((r) => r.month === month).reduce((sum, r) => sum + r.job_count, 0),
    [monthlyStats, month],
  );

  const byWorker = useMemo(
    () =>
      monthlyStats
        .filter((r) => r.month === month)
        .map((r) => ({ label: workerNames[r.worker_id] ?? '…', value: r.job_count }))
        .sort((a, b) => b.value - a.value),
    [monthlyStats, month, workerNames],
  );

  const byService = useMemo(
    () =>
      serviceStats
        .filter((r) => r.month === month)
        .map((r) => ({ label: serviceLabels[r.service_id] ?? '…', value: r.job_count }))
        .sort((a, b) => b.value - a.value),
    [serviceStats, month, serviceLabels],
  );

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 lg:max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-900">{t('stats.analyticsTitle')}</h1>
        <div className="flex items-center gap-2">
          <select
            value={siteId ?? ''}
            onChange={(e) => setSiteId(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            type="month"
            value={month.slice(0, 7)}
            onChange={(e) => setMonth(`${e.target.value}-01`)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('stats.jobsThisMonth')} value={totalThisMonth} />
        <StatTile label={t('stats.jobsToday')} value={jobsToday} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <BarChart title={t('stats.jobsByMonth')} data={monthlyTrend} valueLabel={t('stats.jobs')} />
        </div>
        <BarChart title={t('stats.jobsByWorker')} data={byWorker} valueLabel={t('stats.jobs')} />
        <BarChart title={t('stats.jobsByService')} data={byService} valueLabel={t('stats.jobs')} />
      </div>
    </div>
  );
}
