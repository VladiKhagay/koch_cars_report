import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { saveBilling } from '../lib/jobs';
import { useAuth } from '../context/AuthContext';
import { recordAudit } from '../lib/audit';
import { staffNames, useStaff } from '../lib/useStaff';
import { useSiteScope } from '../lib/useSiteScope';
import type { Job } from '../lib/types';
import Icon from '../components/Icon';
import BillingInput from '../components/BillingInput';
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
  const staff = useStaff();
  const { appUser } = useAuth();
  /** Cards that just got a number stay put for the session of the day view, so
   *  the field a manager is typing in doesn't vanish under them. */
  const [justSaved, setJustSaved] = useState<Set<string>>(new Set());

  async function saveBillingCode(job: JobRow, value: string) {
    if (!appUser) return false;
    const billing_code = value || null;
    const { error } = await saveBilling(job.id, { billing_code });
    if (error) return false;
    await recordAudit(job.id, appUser.id, 'update', { billing_code });
    setJustSaved((prev) => new Set(prev).add(job.id));
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, billing_code } : j)));
    return true;
  }
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
      .from('jobs_manager')
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
      // A job with no plate/VIN is simply not a match on that field — it must
      // not throw here.
      (j) =>
        (j.plate ?? '').includes(q) ||
        (j.vin ?? '').includes(q) ||
        (j.worker_name ?? '').toUpperCase().includes(q),
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
              <Link
                to={`/jobs?billing=missing&from=${day}&to=${day}`}
                className="inline-flex min-h-tap items-center"
              >
                <Badge tone="info" icon="tag">
                  {t('dashboard.missingBilling', { count: missingBillingCount })}
                  <Icon name="chevronRight" size={14} className="rtl:-scale-x-100" />
                </Badge>
              </Link>
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
          {search.trim() ? (
            <Link
              to={`/jobs?q=${encodeURIComponent(search.trim())}`}
              className="mt-1.5 inline-flex min-h-tap items-center gap-1 text-sm font-semibold text-ink-900 underline underline-offset-2"
            >
              {t('dashboard.searchAll', { q: search.trim() })}
              <Icon name="chevronRight" size={16} className="rtl:-scale-x-100" />
            </Link>
          ) : (
            <p className="mt-1.5 text-xs text-ink-600">{t('dashboard.scopeNote')}</p>
          )}
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
            <div
              key={job.id}
              className="rounded-xl border border-line bg-surface shadow-card transition-colors duration-150 hover:border-line-strong"
            >
              <Link
                to={`/jobs/${job.id}`}
                className="flex min-h-control-lg items-center justify-between gap-3 rounded-xl p-4 active:bg-ink-50"
              >
                <div className="min-w-0">
                  <p className="font-mono text-base font-semibold tracking-wide text-ink-900">
                    {job.plate ?? job.vin ?? '—'}
                    <span className="ms-2 font-sans text-sm font-normal text-ink-600">{job.brand ?? '—'}</span>
                  </p>
                  {/* When there's no plate, the VIN already stands in for it above —
                      showing it again here would just repeat the line. */}
                  {job.plate && <p className="truncate font-mono text-xs text-ink-600">{job.vin ?? '—'}</p>}
                  <p className="truncate text-xs text-ink-600">
                    {[job.worker_name ?? '—', ...staffNames(staff, job.coworker_ids ?? [])].join(', ')} ·{' '}
                    {new Date(job.created_at).toLocaleTimeString(i18n.language)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {job.duplicate_of_job_id && (
                    <Badge tone="warn" icon="alertTriangle">
                      {t('dashboard.duplicateFlag')}
                    </Badge>
                  )}
                  <Icon name="chevronRight" size={18} className="text-ink-500 rtl:-scale-x-100" />
                </div>
              </Link>
              {/* The manager's main job on this screen is filling this in, so it
                  is a field on the card rather than a detail page away. */}
              {(!job.billing_code || justSaved.has(job.id)) && (
                <div className="flex items-center gap-3 border-t border-line px-4 py-2">
                  <span className="text-xs font-medium text-ink-600">{t('jobs.billingCode')}</span>
                  <BillingInput
                    committed={job.billing_code ?? ''}
                    resetKey={job.id}
                    onSave={(value) => saveBillingCode(job, value)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </Group>

    </Page>
  );
}
