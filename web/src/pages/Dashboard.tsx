import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSiteScope } from '../lib/useSiteScope';
import type { Job } from '../lib/types';
import Icon from '../components/Icon';
import {
  Badge,
  EmptyState,
  Group,
  IconButton,
  LoadingRegion,
  Page,
  PageHeading,
  SearchField,
  Select,
} from '../components/ui';

interface JobRow extends Job {
  worker_name?: string;
}

function todayIso() {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // midday anchor keeps ±1 day arithmetic DST-safe
  return d.toISOString().slice(0, 10);
}

function shiftDay(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { sites, siteId, setSiteId, canSwitch } = useSiteScope();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  /** The day being viewed. Managers fill in billing codes that arrive a day or
   *  two late, so "today only" made yesterday's unfinished work unreachable. */
  const [day, setDay] = useState(todayIso());
  const isToday = day === todayIso();

  useEffect(() => {
    if (!siteId) return;
    void load(siteId, day);
  }, [siteId, day]);

  async function load(site: string, isoDay: string) {
    setLoading(true);
    const { data } = await supabase
      .from('jobs')
      .select('*, worker:users!jobs_worker_id_fkey(name)')
      .eq('site_id', site)
      .is('deleted_at', null)
      .gte('created_at', `${isoDay}T00:00:00`)
      .lte('created_at', `${isoDay}T23:59:59.999`)
      .order('created_at', { ascending: false });

    setJobs((data ?? []).map((j: any) => ({ ...j, worker_name: j.worker?.name })));
    setLoading(false);
  }

  const duplicateCount = jobs.filter((j) => j.duplicate_of_job_id).length;
  const missingBillingCount = jobs.filter((j) => !j.billing_code).length;

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return jobs;
    return jobs.filter(
      (j) => j.plate.includes(q) || j.vin.includes(q) || (j.worker_name ?? '').toUpperCase().includes(q),
    );
  }, [jobs, search]);

  return (
    <Page width="list">
      <PageHeading
        action={
          canSwitch && sites.length > 0 ? (
            <Select
              aria-label={t('dashboard.site')}
              value={siteId ?? ''}
              onChange={(e) => setSiteId(e.target.value)}
              className="w-auto text-sm"
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
        {t('dashboard.title')}
      </PageHeading>

      {/* Which day, and whether anything on it needs attention. */}
      <Group>
        {/* Day stepper. "Next" is disabled on today rather than hidden, so the
            control never changes shape as you move through the week. */}
        <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface p-2 shadow-card">
          <IconButton icon="chevronLeft" label={t('dashboard.prevDay')} onClick={() => setDay(shiftDay(day, -1))} />
          <div className="min-w-0 text-center">
            <p className="truncate text-sm font-semibold text-ink-900">
              {isToday
                ? t('dashboard.today')
                : new Date(`${day}T12:00:00`).toLocaleDateString(i18n.language, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
            </p>
            {!isToday && (
              <button
                type="button"
                onClick={() => setDay(todayIso())}
                className="text-xs font-medium text-ink-600 underline underline-offset-2"
              >
                {t('dashboard.backToToday')}
              </button>
            )}
          </div>
          <IconButton
            icon="chevronRight"
            label={t('dashboard.nextDay')}
            disabled={isToday}
            onClick={() => setDay(shiftDay(day, 1))}
          />
        </div>

        {/*
          Triage row. It renders whenever the day has loaded — including the
          all-clear — so "zero problems today" can never be mistaken for "the
          flags haven't arrived", which is what two conditionally-rendered pills
          used to produce on a flaky connection.
        */}
        {!loading && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral" icon="clipboard">
              {t('dashboard.jobCount', { count: jobs.length })}
            </Badge>
            {duplicateCount > 0 && (
              <Badge tone="warn" icon="alertTriangle">
                {t('dashboard.duplicates', { count: duplicateCount })}
              </Badge>
            )}
            {missingBillingCount > 0 && (
              <Badge tone="info" icon="tag">
                {t('dashboard.missingBilling', { count: missingBillingCount })}
              </Badge>
            )}
            {duplicateCount === 0 && missingBillingCount === 0 && jobs.length > 0 && (
              <Badge tone="ok" icon="checkCircle">
                {t('dashboard.allClear')}
              </Badge>
            )}
          </div>
        )}
      </Group>

      {/* Finding one car inside that day. */}
      <Group>
        <div>
          <SearchField value={search} onChange={setSearch} label={t('dashboard.search')} />
          {/* The query is scoped to today. The copy now says so, instead of
              promising a general search and reporting a car as never logged. */}
          <p className="mt-1.5 text-xs text-ink-600">{t('dashboard.scopeNote')}</p>
        </div>

        {loading && <LoadingRegion label={t('common.loading')} rows={4} />}

        {!loading && jobs.length === 0 && (
          <EmptyState icon="clipboard" title={t('dashboard.emptyTitle')} body={t('dashboard.emptyBody')} />
        )}

        {!loading && jobs.length > 0 && filtered.length === 0 && (
          <EmptyState icon="search" title={t('dashboard.noResults')} />
        )}
        <div className="space-y-2">
          {filtered.map((job) => (
            <Link
              key={job.id}
              to={`/jobs/${job.id}`}
              className="flex min-h-control-lg items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 shadow-card transition-colors duration-150 hover:border-line-strong active:bg-ink-50"
            >
              <div className="min-w-0">
                <p className="font-mono text-base font-semibold tracking-wide text-ink-900">
                  {job.plate}
                  <span className="ms-2 font-sans text-sm font-normal text-ink-600">{job.brand ?? '—'}</span>
                </p>
                <p className="truncate font-mono text-xs text-ink-600">{job.vin}</p>
                <p className="truncate text-xs text-ink-600">
                  {job.worker_name ?? '—'} · {new Date(job.created_at).toLocaleTimeString(i18n.language)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {job.duplicate_of_job_id && (
                  <Badge tone="warn" icon="alertTriangle">
                    {t('dashboard.duplicateFlag')}
                  </Badge>
                )}
                {!job.billing_code && (
                  <Badge tone="neutral" icon="tag">
                    {t('dashboard.noBillingCode')}
                  </Badge>
                )}
                <Icon name="chevronRight" size={18} className="text-ink-500" />
              </div>
            </Link>
          ))}
        </div>
      </Group>

    </Page>
  );
}
