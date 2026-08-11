import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { JobDailyStat, Site } from '../lib/types';
import BarChart from '../components/BarChart';
import StatTile from '../components/StatTile';

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function monthKey(dayIso: string) {
  return dayIso.slice(0, 7);
}

/**
 * Analytics for managers (locked to their own site) and admins (site picker,
 * plus all-sites export). All aggregation reads job_daily_stats — a
 * security_invoker view, so RLS decides what each role can see; the filters
 * here only narrow, never widen.
 */
export default function Analytics() {
  const { t, i18n } = useTranslation();
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === 'admin';

  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [workerFilter, setWorkerFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');

  const [rows, setRows] = useState<JobDailyStat[]>([]);
  const [workerNames, setWorkerNames] = useState<Record<string, string>>({});
  const [serviceLabels, setServiceLabels] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!appUser) return;
    if (isAdmin) {
      supabase.from('sites').select('*').order('name').then(({ data }) => {
        setSites(data ?? []);
        setSiteId((data ?? [])[0]?.id ?? null);
      });
    } else {
      setSiteId(appUser.site_id);
      supabase.from('sites').select('*').then(({ data }) => setSites(data ?? []));
    }
  }, [appUser, isAdmin]);

  useEffect(() => {
    if (!siteId) return;
    void load(siteId, from, to);
  }, [siteId, from, to]);

  async function load(site: string, fromDay: string, toDay: string) {
    const { data } = await supabase
      .from('job_daily_stats')
      .select('*')
      .eq('site_id', site)
      .gte('day', fromDay)
      .lte('day', toDay)
      .order('day');
    const stats = (data ?? []) as JobDailyStat[];
    setRows(stats);

    const workerIds = [...new Set(stats.map((r) => r.worker_id))];
    if (workerIds.length > 0) {
      const { data: users } = await supabase.from('users').select('id, name').in('id', workerIds);
      setWorkerNames(Object.fromEntries((users ?? []).map((u) => [u.id, u.name])));
    } else {
      setWorkerNames({});
    }

    const serviceIds = [...new Set(stats.map((r) => r.service_id))];
    if (serviceIds.length > 0) {
      const { data: svc } = await supabase.from('services').select('id, catalog_number, name_en').in('id', serviceIds);
      setServiceLabels(Object.fromEntries((svc ?? []).map((s) => [s.id, `${s.catalog_number} ${s.name_en}`])));
    } else {
      setServiceLabels({});
    }
  }

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) => (!workerFilter || r.worker_id === workerFilter) && (!serviceFilter || r.service_id === serviceFilter),
      ),
    [rows, workerFilter, serviceFilter],
  );

  // NOTE: job_daily_stats has one row per (worker, service, day), so summing
  // job_count across services double-counts multi-service jobs. That's fine
  // for "by service" (each service's own count is exact) but the headline
  // totals and trend use per-(worker,day) de-duplication via max() — a job
  // appears once per service, so max over services underestimates… instead
  // we compute totals from the by-service breakdown only when a service
  // filter is active; otherwise totals come from a separate exact count.
  const [exactTotal, setExactTotal] = useState(0);
  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    (async () => {
      let query = supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', siteId)
        .is('deleted_at', null)
        .gte('created_at', `${from}T00:00:00`)
        .lte('created_at', `${to}T23:59:59`);
      if (workerFilter) query = query.eq('worker_id', workerFilter);
      const { count } = await query;
      if (!cancelled) setExactTotal(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId, from, to, workerFilter]);

  const monthlyTrend = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const r of filtered) byMonth.set(monthKey(r.day), (byMonth.get(monthKey(r.day)) ?? 0) + r.job_count);
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, v]) => ({
        label: new Date(`${m}-01`).toLocaleDateString(i18n.language, { month: 'short', year: '2-digit' }),
        value: v,
      }));
  }, [filtered, i18n.language]);

  const byWorker = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) map.set(r.worker_id, (map.get(r.worker_id) ?? 0) + r.job_count);
    return [...map.entries()]
      .map(([id, v]) => ({ label: workerNames[id] ?? '…', value: v }))
      .sort((a, b) => b.value - a.value);
  }, [filtered, workerNames]);

  const byService = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) map.set(r.service_id, (map.get(r.service_id) ?? 0) + r.job_count);
    return [...map.entries()]
      .map(([id, v]) => ({ label: serviceLabels[id] ?? '…', value: v }))
      .sort((a, b) => b.value - a.value);
  }, [filtered, serviceLabels]);

  async function exportStats(allSites: boolean) {
    setExporting(true);
    try {
      let query = supabase.from('job_daily_stats').select('*').gte('day', from).lte('day', to).order('day');
      if (!allSites && siteId) query = query.eq('site_id', siteId);
      const { data } = await query;
      const stats = ((data ?? []) as JobDailyStat[]).filter(
        (r) => (!workerFilter || r.worker_id === workerFilter) && (!serviceFilter || r.service_id === serviceFilter),
      );

      // Names for anything the current maps don't cover (other sites).
      const workerIds = [...new Set(stats.map((r) => r.worker_id))];
      const serviceIds = [...new Set(stats.map((r) => r.service_id))];
      const [{ data: users }, { data: svcs }] = await Promise.all([
        workerIds.length > 0 ? supabase.from('users').select('id, name').in('id', workerIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        serviceIds.length > 0 ? supabase.from('services').select('id, catalog_number, name_en').in('id', serviceIds) : Promise.resolve({ data: [] as { id: string; catalog_number: string; name_en: string }[] }),
      ]);
      const workerMap = Object.fromEntries((users ?? []).map((u) => [u.id, u.name]));
      const svcMap = Object.fromEntries((svcs ?? []).map((s) => [s.id, `${s.catalog_number} ${s.name_en}`]));
      const siteMap = Object.fromEntries(sites.map((s) => [s.id, s.name]));

      const exportRows = stats.map((r) => ({
        Date: r.day,
        Site: siteMap[r.site_id] ?? r.site_id,
        Worker: workerMap[r.worker_id] ?? '',
        Service: svcMap[r.service_id] ?? '',
        Jobs: r.job_count,
      }));

      const XLSX = await import('xlsx');
      const sheet = XLSX.utils.json_to_sheet(exportRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'Stats');
      const scope = allSites ? 'all-sites' : (sites.find((s) => s.id === siteId)?.name ?? 'site');
      XLSX.writeFile(workbook, `stats-${scope}-${from}-to-${to}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  const selectClass = 'rounded-lg border border-slate-300 px-2 py-1.5 text-sm';

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 lg:max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">{t('stats.analyticsTitle')}</h1>
        {isAdmin && sites.length > 0 && (
          <select value={siteId ?? ''} onChange={(e) => setSiteId(e.target.value)} className={selectClass}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs font-medium text-slate-500">
          {t('export.from')}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selectClass} />
        </label>
        <label className="flex flex-col text-xs font-medium text-slate-500">
          {t('export.to')}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selectClass} />
        </label>
        <select value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)} className={selectClass}>
          <option value="">{t('stats.allWorkers')}</option>
          {Object.entries(workerNames).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} className={selectClass}>
          <option value="">{t('stats.allServices')}</option>
          {Object.entries(serviceLabels).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('stats.jobsInRange')} value={serviceFilter ? byService.reduce((s, r) => s + r.value, 0) : exactTotal} />
        <StatTile label={t('stats.activeWorkers')} value={byWorker.length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <BarChart title={t('stats.jobsByMonth')} data={monthlyTrend} valueLabel={t('stats.jobs')} />
        </div>
        <BarChart title={t('stats.jobsByWorker')} data={byWorker} valueLabel={t('stats.jobs')} />
        <BarChart title={t('stats.jobsByService')} data={byService} valueLabel={t('stats.jobs')} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void exportStats(false)}
          disabled={exporting || !siteId}
          className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {t('stats.exportSite')}
        </button>
        {isAdmin && (
          <button
            onClick={() => void exportStats(true)}
            disabled={exporting}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            {t('stats.exportAllSites')}
          </button>
        )}
      </div>
    </div>
  );
}
