import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { serviceName, type ServiceNames } from '../lib/serviceName';
import { useSiteScope } from '../lib/useSiteScope';
import type { JobDailyStat } from '../lib/types';
import { SHEET_NAMES, buildStatsSheet } from '../lib/exports';
import { downloadWorkbook } from '../lib/excelFile';
import { useExportLang } from '../components/useExportLang';
import ExportLangSelect from '../components/ExportLangSelect';
import BarChart from '../components/BarChart';
import StatTile from '../components/StatTile';
import { Button, Card, Field, fieldClass, Group, Page, PageHeading, SectionHeading, Select, Skeleton } from '../components/ui';
import { formatDate, MONTH_YEAR } from '../lib/formatDate';

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function monthKey(dayIso: string) {
  return dayIso.slice(0, 7);
}

/**
 * Analytics for managers (own site) and admins (site picker, all-sites export).
 * Reads job_daily_stats, a security_invoker view: RLS decides what each role
 * sees and the filters only narrow.
 */
export default function Analytics() {
  const { t, i18n } = useTranslation();
  const { sites, siteId, setSiteId, canSwitch: isAdmin } = useSiteScope();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [workerFilter, setWorkerFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');

  const [rows, setRows] = useState<JobDailyStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportLang, setExportLang] = useExportLang();

    /* Filter options come from the site's roster and the service catalog, not
       from the loaded rows: otherwise narrowing the date range could drop the
       selected worker and silently revert to all-worker figures. */
  const [workerOptions, setWorkerOptions] = useState<{ id: string; name: string }[]>([]);
  const [serviceOptions, setServiceOptions] = useState<{ id: string; label: string }[]>([]);
  /** Display names for anything the stats reference, deleted rows included. */
  const [extraLabels, setExtraLabels] = useState<Record<string, string>>({});

  // Options are keyed to the site, not to the date range.
  useEffect(() => {
    if (!siteId) return;
    setWorkerFilter('');
    supabase
      .from('users')
      .select('id, name')
      .eq('site_id', siteId)
      .order('name')
      .then(({ data }) => setWorkerOptions(data ?? []));
  }, [siteId]);

  useEffect(() => {
    supabase
      .from('services')
      .select('id, catalog_number, name_en, name_ru, name_he')
      .is('deleted_at', null)
      .order('sort_order')
      .then(({ data }) =>
        setServiceOptions(
                    // Name only: the catalog number is an accounting key that crowds the label on a phone.
          (data ?? []).map((s) => ({
            id: s.id,
            label: serviceName(s, i18n.language) ?? '',
          })),
        ),
      );
  }, [i18n.language]);

  useEffect(() => {
    if (!siteId) return;
    void load(siteId, from, to);
  }, [siteId, from, to]);

  async function load(site: string, fromDay: string, toDay: string) {
    setLoading(true);
    const { data } = await supabase
      .from('job_daily_stats')
      .select('*')
      .eq('site_id', site)
      .gte('day', fromDay)
      .lte('day', toDay)
      .order('day');
    const stats = (data ?? []) as JobDailyStat[];
    setRows(stats);
    setLoading(false);

    // Chart labels only: rows can reference a soft-deleted service or a user
    // from another site, neither of which belongs in the filter dropdowns.
    const unknownWorkers = [...new Set(stats.map((r) => r.worker_id))];
    const unknownServices = [...new Set(stats.map((r) => r.service_id))];
    const [{ data: users }, { data: svc }] = await Promise.all([
      unknownWorkers.length > 0
        ? supabase.from('users').select('id, name').in('id', unknownWorkers)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      unknownServices.length > 0
        ? supabase.from('services').select('id, catalog_number, name_en, name_ru, name_he').in('id', unknownServices)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    setExtraLabels({
      ...Object.fromEntries((users ?? []).map((u) => [u.id, u.name])),
      ...Object.fromEntries(
        (svc ?? []).map((s: ServiceNames & { id: string }) => [s.id, serviceName(s, i18n.language) ?? '']),
      ),
    });
  }

  const labelFor = (id: string) =>
    extraLabels[id] ??
    workerOptions.find((w) => w.id === id)?.name ??
    serviceOptions.find((s) => s.id === id)?.label ??
    '—';

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) => (!workerFilter || r.worker_id === workerFilter) && (!serviceFilter || r.service_id === serviceFilter),
      ),
    [rows, workerFilter, serviceFilter],
  );

    /* The view has one row per person on a job (0019), so a shared car appears
       twice. Site-wide figures count cars (`car_count`, the submitter's row);
       with a worker picked it is their `job_count`, shared jobs included. */
  const countOf = (r: JobDailyStat) => (workerFilter ? r.job_count : r.car_count);
  const total = useMemo(
    () => filtered.reduce((sum, r) => sum + countOf(r), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, workerFilter],
  );

  const monthlyTrend = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const r of filtered) byMonth.set(monthKey(r.day), (byMonth.get(monthKey(r.day)) ?? 0) + countOf(r));
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, v]) => ({
        label: formatDate(new Date(`${m}-01`), i18n.language, MONTH_YEAR),
        value: v,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, workerFilter, i18n.language]);

  const byWorker = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) map.set(r.worker_id, (map.get(r.worker_id) ?? 0) + r.job_count);
    return [...map.entries()].map(([id, v]) => ({ label: labelFor(id), value: v })).sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, extraLabels, workerOptions]);

  const byService = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) map.set(r.service_id, (map.get(r.service_id) ?? 0) + countOf(r));
    return [...map.entries()].map(([id, v]) => ({ label: labelFor(id), value: v })).sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, workerFilter, extraLabels, serviceOptions]);

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
        serviceIds.length > 0 ? supabase.from('services').select('id, catalog_number, name_en, name_he').in('id', serviceIds) : Promise.resolve({ data: [] as { id: string; catalog_number: string; name_en: string; name_he: string | null }[] }),
      ]);
      const workerMap = Object.fromEntries((users ?? []).map((u) => [u.id, u.name]));
      // The catalog number is deliberately absent from the UI but present here:
      // the exported report is the whole reason it exists. Its own column, not
      // glued to the name, so the office can match on it directly.
      const svcMap = Object.fromEntries(
        (svcs ?? []).map((s) => [s.id, { code: s.catalog_number, name: s.name_en, name_he: s.name_he }]),
      );
      const siteMap = Object.fromEntries(sites.map((s) => [s.id, s.name]));

      const exportRows = stats.map((r) => ({
        day: r.day,
        site: siteMap[r.site_id] ?? r.site_id,
        worker: workerMap[r.worker_id] ?? '',
        catalog_number: svcMap[r.service_id]?.code ?? '',
        service: svcMap[r.service_id] ? { name_en: svcMap[r.service_id].name, name_he: svcMap[r.service_id].name_he } : null,
        job_count: r.job_count,
      }));

      const scope = allSites ? 'all-sites' : (sites.find((s) => s.id === siteId)?.name ?? 'site');
      await downloadWorkbook(
        buildStatsSheet(exportRows, exportLang),
        SHEET_NAMES[exportLang].stats,
        `stats-${scope}-${from}-to-${to}.xlsx`,
        exportLang,
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <Page width="list">
      <PageHeading
        action={
          isAdmin && sites.length > 0 ? (
            <Select
              aria-label={t('dashboard.site')}
              value={siteId ?? ''}
              onChange={(e) => setSiteId(e.target.value)}
                            /* Sized to its content but capped on a phone: a free-text site name
                               could push the control past the viewport. Keeps the field type size. */
              className="w-auto max-w-44 sm:max-w-none"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          ) : undefined
        }
      >
        {t('stats.analyticsTitle')}
      </PageHeading>

      <Card>
        <SectionHeading icon="calendar">{t('stats.filters')}</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field htmlFor="stats-from" label={t('export.from')}>
            <input
              id="stats-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={fieldClass}
            />
          </Field>
          <Field htmlFor="stats-to" label={t('export.to')}>
            <input id="stats-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={fieldClass} />
          </Field>
          <Field htmlFor="stats-worker" label={t('jobDetail.worker')}>
            <Select id="stats-worker" value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)}>
              <option value="">{t('stats.allWorkers')}</option>
              {workerOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="stats-service" label={t('jobDetail.services')}>
            <Select id="stats-service" value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)}>
              <option value="">{t('stats.allServices')}</option>
              {serviceOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {/* The totals and the same numbers broken out — one reading. */}
      <Group>
        {loading ? (
          <div className="grid grid-cols-2 gap-3" aria-hidden>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <StatTile label={t('stats.jobsInRange')} value={total} />
            <StatTile label={t('stats.activeWorkers')} value={byWorker.length} />
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <BarChart title={t('stats.jobsByMonth')} data={monthlyTrend} valueLabel={t('stats.jobs')} />
          </div>
          <BarChart title={t('stats.jobsByWorker')} data={byWorker} valueLabel={t('stats.jobs')} />
          <BarChart title={t('stats.jobsByService')} data={byService} valueLabel={t('stats.jobs')} />
        </div>
      </Group>

      <div className="flex flex-wrap items-center gap-2">
        <ExportLangSelect value={exportLang} onChange={setExportLang} />
        <Button icon="download" busy={exporting} disabled={!siteId} onClick={() => void exportStats(false)}>
          {t('stats.exportSite')}
        </Button>
        {isAdmin && (
          <Button variant="secondary" icon="download" busy={exporting} onClick={() => void exportStats(true)}>
            {t('stats.exportAllSites')}
          </Button>
        )}
      </div>
    </Page>
  );
}
