import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useSiteScope } from '../lib/useSiteScope';
import {
  REPORT_SHEET_NAME,
  SHEET_NAMES,
  buildCustomerReport,
  buildWorkerPaymentReport,
  customerReportFileName,
  exportLocale,
  type ExportJob,
} from '../lib/exports';
import { downloadWorkbook } from '../lib/excelFile';
import { useExportLang } from '../components/useExportLang';
import { shareFor } from '../lib/jobs';
import {
  CARASSO_JOBS_VIEW,
  CARASSO_JOB_COLUMNS,
  fetchAppSettings,
  saveCustomerReportLayout,
} from '../lib/carasso';
import { availableColumns, type ColumnConfig, type ExportLang } from '../lib/reportConfig';
import { staffNames, useStaff } from '../lib/useStaff';
import type { AppUser, CarassoJob } from '../lib/types';
import ReportColumns from '../components/ReportColumns';
import StatusBanner from '../components/StatusBanner';
import Icon from '../components/Icon';
import { mergeColumnSubset } from './exportColumns';
import {
  Button,
  Card,
  Field,
  Page,
  PageHeading,
  SearchField,
  SectionHeading,
  Select,
  fieldClass,
} from '../components/ui';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Rows per request: PostgREST caps a response (1,000 by default) and a multi-site month is bigger. */
const CHUNK = 1000;

/** The payment sheet's fields. Admin only, read from jobs_manager, which carries the pay. */
const PAYMENT_FIELDS =
  'created_at, plate, vin, brand, billing_code, worker_price,' +
  ' worker_id, coworker_ids, submitter_share, coworker_share,' +
  ' worker:users!jobs_worker_id_fkey(name), site:sites(name), service:services(name_en, name_he, catalog_number)';

/** A manager's customer report: no pay and (not being readable to them) no client prices. */
const MANAGER_REPORT_FIELDS =
  'created_at, plate, vin, brand, billing_code, worker_id, coworker_ids,' +
  ' worker:users!jobs_worker_id_fkey(name), site:sites(name), service:services(name_en, name_he, catalog_number)';

type FetchedJob = ExportJob & {
  worker_id: string;
  coworker_ids: string[];
  submitter_share: number;
  coworker_share: number;
};

/** A `jobs_carasso` row as the customer report reads it. */
function fromCarasso(r: CarassoJob): ExportJob {
  return {
    created_at: r.created_at,
    plate: r.plate,
    vin: r.vin,
    brand: r.brand,
    billing_code: r.billing_code,
    worker_price: 0,
    worker: r.crew ? { name: r.crew } : null,
    site: { name: r.site_name },
    service: r.service_name_en
      ? { name_en: r.service_name_en, name_he: r.service_name_he, catalog_number: r.catalog_number ?? '' }
      : null,
    client_unit_price: r.client_unit_price,
    client_total_price: r.client_total_price,
  };
}

type ReportKind = 'customer' | 'payments';

/** The last export's outcome, tagged with its button so the banner renders under the right report. */
type Result = ({ kind: 'empty' } | { kind: 'done'; file: string } | { kind: 'error' }) & {
  for: ReportKind;
};

/** The span a report will cover, stated above its download button; weighted as configuration, not help text. */
function PeriodLine({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-ink-50 px-3 py-2 text-sm font-medium text-ink-700">
      <Icon name="calendar" size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** The outcome of an export, rendered under the button that ran it. */
function ResultBanner({ result, emptyMessage }: { result: Result; emptyMessage?: string }) {
  const { t } = useTranslation();
  if (result.kind === 'empty')
    return (
      <StatusBanner tone="warning" live>
        {emptyMessage ?? t('export.empty')}
      </StatusBanner>
    );
  if (result.kind === 'error')
    return (
      <StatusBanner tone="error" live>
        {t('common.error')}
      </StatusBanner>
    );
  return (
    <StatusBanner tone="success" live>
      {t('export.done', { file: result.file })}
    </StatusBanner>
  );
}

export default function Export() {
  const { t, i18n } = useTranslation();
  const { appUser } = useAuth();
  const { sites, siteId, setSiteId, canSwitch } = useSiteScope();
  const role = appUser?.role;
  const isAdmin = role === 'admin';
  const isCarasso = role === 'carasso';
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [busy, setBusy] = useState<ReportKind | null>(null);
  /** Distinguishable outcomes instead of one silent button, so nobody taps again for three copies. */
  const [result, setResult] = useState<Result | null>(null);

  /* The file's language, Hebrew until this person picks otherwise; remembered per user. */
  const [lang, chooseLang] = useExportLang();

  /* The one saved layout, plus this download's own toggles on top of it (never saved by a non-admin). */
  const [columns, setColumns] = useState<ColumnConfig[] | null>(null);
  const [hideNames, setHideNames] = useState(true);
  const [settingsFailed, setSettingsFailed] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [layoutResult, setLayoutResult] = useState<'saved' | 'error' | null>(null);

  useEffect(() => {
    let live = true;
    void fetchAppSettings().then((s) => {
      if (!live) return;
      setSettingsFailed(!s.ok);
      setHideNames(s.hideWorkerNames);
      setColumns(s.customerReportColumns);
    });
    return () => {
      live = false;
    };
  }, []);

  /** Admin or Carasso with no site picked = every site they may see: one file, with a Site column. */
  const multiSite = canSwitch && siteId === null && sites.length > 1;
  const shown = columns ? availableColumns(columns, { role, hideWorkerNames: hideNames, multiSite }) : [];
  const visibleCount = shown.filter((c) => c.visible).length;
  /** Managers are pinned to a site (set by the scope hook); the others read every site they may. */
  const scopeReady = canSwitch ? sites.length > 0 : Boolean(siteId);

  /* Worker pay is admin-only on the Services screen, so this sheet is too. */
  const canSeePay = isAdmin;

  /* Who the payment sheet is for. Empty until picked — the report is per
     worker, so there is no sensible default and guessing one would produce a
     file for the wrong person under a plausible name. */
  const [workers, setWorkers] = useState<Pick<AppUser, 'id' | 'name'>[]>([]);
  const [workerId, setWorkerId] = useState('');
  const [workerSearch, setWorkerSearch] = useState('');

  /* Everyone on staff, every site: the payment sheet is per person across sites
     (0019). Inactive staff are included; they are still owed for earlier jobs. */
  // list_staff() is closed to Carasso, so it is not even asked for.
  const staff = useStaff(!isCarasso);
  useEffect(() => {
    if (!canSeePay) return;
    let cancelled = false;
    void supabase
      .from('users')
      .select('id,name')
      .order('name')
      .then(({ data }) => {
        if (cancelled) return;
        setWorkers(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [canSeePay]);

  /* The search narrows a native select (a long list can't be typed at) instead of replacing it. */
  const matchingWorkers = workers.filter((w) =>
    w.name.toLowerCase().includes(workerSearch.trim().toLowerCase()),
  );
  const selectedWorker = workers.find((w) => w.id === workerId);
  /* The person already chosen stays in the list even when the search would
     exclude them — a select whose value is not among its options renders as
     something else entirely, which is how you export the wrong worker's pay. */
  const workerOptions =
    selectedWorker && !matchingWorkers.some((w) => w.id === workerId)
      ? [selectedWorker, ...matchingWorkers]
      : matchingWorkers;

  /** Both bounds are inclusive local calendar days, as in the jobs grid. */
  function bounds() {
    return {
      fromIso: new Date(`${from}T00:00:00`).toISOString(),
      toIso: new Date(`${to}T23:59:59.999`).toISOString(),
    };
  }

  /**
   * The customer report's jobs. Admin and Carasso read `jobs_carasso` (client
   * prices; for Carasso the database also blanks names while they are hidden).
   * A manager reads `jobs_manager` with none of the money fields selected.
   * Fetched in chunks so a multi-site month is never silently cut at 1,000.
   */
  async function fetchCustomerJobs(): Promise<ExportJob[] | null> {
    const { fromIso, toIso } = bounds();
    const all: ExportJob[] = [];
    for (let start = 0; ; start += CHUNK) {
      const base = isAdmin || isCarasso
        ? supabase.from(CARASSO_JOBS_VIEW).select(CARASSO_JOB_COLUMNS)
        : supabase.from('jobs_manager').select(MANAGER_REPORT_FIELDS).is('deleted_at', null);
      let query = base
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(start, start + CHUNK - 1);
      if (siteId) query = query.eq('site_id', siteId);
      const { data, error } = await query;
      if (error) return null;
      const page = (data ?? []) as unknown as (CarassoJob | (ExportJob & { coworker_ids: string[] }))[];
      all.push(
        ...page.map((j) =>
          'site_name' in j
            ? fromCarasso(j)
            : {
                ...j,
                worker_price: 0,
                // Everyone who worked the car, submitter first: "Dana, Avi".
                worker: { name: [j.worker?.name ?? '', ...staffNames(staff, j.coworker_ids)].filter(Boolean).join(', ') },
              },
        ),
      );
      if (page.length < CHUNK) return all;
    }
  }

  /**
   * The payment sheet's jobs: narrowed in Postgres to this person's (submitted
   * or co-worked, any site), so the file can never hold somebody else's job.
   */
  async function fetchPaymentJobs(forWorkerId: string): Promise<FetchedJob[] | null> {
    const { fromIso, toIso } = bounds();
    const { data, error } = await supabase
      .from('jobs_manager')
      .select(PAYMENT_FIELDS)
      .is('deleted_at', null)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: true })
      .or(`worker_id.eq.${forWorkerId},coworker_ids.cs.{${forWorkerId}}`);
    if (error) return null;
    return (data ?? []) as unknown as FetchedJob[];
  }

  async function runExport(kind: ReportKind) {
    if ((kind === 'customer' && (!scopeReady || !columns)) || !periodComplete) return;
    // The payment sheet is per worker; without one there is no report to build.
    if (kind === 'payments' && !selectedWorker) return;
    setBusy(kind);
    setResult(null);

    try {
      const locale = exportLocale(lang);
      let rows;
      let sheetName;
      let file;
      if (kind === 'customer') {
        const jobs = await fetchCustomerJobs();
        if (!jobs) return setResult({ kind: 'error', for: kind });
        if (jobs.length === 0) return setResult({ kind: 'empty', for: kind });
        rows = buildCustomerReport(jobs, shown, locale, lang);
        sheetName = REPORT_SHEET_NAME;
        file = customerReportFileName(from, to);
      } else {
        const jobs = await fetchPaymentJobs(workerId);
        if (!jobs) return setResult({ kind: 'error', for: kind });
        if (jobs.length === 0) return setResult({ kind: 'empty', for: kind });
        // This person's share, and their own name on every row — the job's
        // submitter may be somebody else.
        rows = buildWorkerPaymentReport(
          jobs.map((j) => ({ ...j, worker_price: shareFor(j, workerId), worker: { name: selectedWorker!.name } })),
          selectedWorker!.name,
          locale,
          lang,
        );
        sheetName = SHEET_NAMES[lang].payments;
        // The worker's name goes in the filename: these land in a Downloads folder a month at a time.
        file = `payments-${selectedWorker!.name}-${from}-to-${to}.xlsx`;
      }
      await downloadWorkbook(rows, sheetName, file, lang);
      setResult({ kind: 'done', file, for: kind });
    } catch {
      setResult({ kind: 'error', for: kind });
    } finally {
      setBusy(null);
    }
  }

  /** Admin: saves this view's columns as THE layout (every other column keeps its place). */
  async function saveLayout() {
    if (!columns) return;
    setSavingLayout(true);
    setLayoutResult(null);
    const { error } = await saveCustomerReportLayout(columns);
    setSavingLayout(false);
    setLayoutResult(error ? 'error' : 'saved');
  }

  /* A cleared date input makes `new Date('T00:00:00')` invalid and
     `.toISOString()` throw, so every export is gated on both ends. */
  const periodComplete = Boolean(from && to);

  /** The period as a person reads it, in their own locale. */
  const period = periodComplete
    ? {
        from: new Date(`${from}T00:00:00`).toLocaleDateString(i18n.language, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
        to: new Date(`${to}T00:00:00`).toLocaleDateString(i18n.language, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
      }
    : null;

  const siteChoices = canSwitch && sites.length > (isCarasso ? 1 : 0);

  return (
    <Page width="form">
      <PageHeading>{t('export.title')}</PageHeading>

      {/* The period comes first and on its own card, because it (and the file
          language) is shared by every report below. */}
      <Card className="space-y-4">
        <SectionHeading icon="calendar">{t('export.periodTitle')}</SectionHeading>
        <p className="text-sm text-ink-600">{canSeePay ? t('export.periodHelp') : t('export.periodHelpOne')}</p>

        {siteChoices && (
          <Field htmlFor="export-site" label={t('export.site')}>
            <Select
              id="export-site"
              value={siteId ?? ''}
              onChange={(e) => {
                setSiteId(e.target.value || null);
                setResult(null);
              }}
            >
              <option value="">{isCarasso ? t('export.allMySites') : t('jobs.allSites')}</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {/* Stacked on a phone, paired from `sm` up — a date input is unusable
            at half of a 360px row. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field htmlFor="export-from" label={t('export.from')}>
            <input
              id="export-from"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setResult(null);
              }}
              className={fieldClass}
            />
          </Field>
          <Field htmlFor="export-to" label={t('export.to')}>
            <input
              id="export-to"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setResult(null);
              }}
              className={fieldClass}
            />
          </Field>
        </div>

        <Field htmlFor="export-lang" label={t('export.language')} hint={<span className="text-ink-500">{t('export.languageHint')}</span>}>
          <Select id="export-lang" value={lang} onChange={(e) => chooseLang(e.target.value as ExportLang)}>
            <option value="he">עברית</option>
            <option value="en">English</option>
          </Select>
        </Field>

        {!periodComplete && <StatusBanner tone="warning">{t('export.periodIncomplete')}</StatusBanner>}
      </Card>

      <Card className="space-y-3">
        <SectionHeading icon="clipboard">{t('export.customerTitle')}</SectionHeading>

        {settingsFailed && <StatusBanner tone="error">{t('common.error')}</StatusBanner>}

        {period && <PeriodLine>{t('export.periodCovers', period)}</PeriodLine>}

        {/* This download's columns. Everyone may toggle them for this file; only
            an admin can keep them as the layout (and reorder). */}
        {columns && (
          <details className="rounded-xl border border-line bg-surface">
            <summary className="flex min-h-control cursor-pointer items-center justify-between gap-3 px-4 text-sm font-semibold text-ink-900">
              <span>{t('export.columnsTitle')}</span>
              <span className="font-medium text-ink-600">{t('export.configSummary', { count: visibleCount })}</span>
            </summary>
            <div className="space-y-3 border-t border-line p-4">
              <p className="text-sm text-ink-600">{isAdmin ? t('export.columnsHelpAdmin') : t('export.columnsHelp')}</p>
              <ReportColumns
                reorder={isAdmin}
                columns={shown}
                onChange={(next) => {
                  setLayoutResult(null);
                  setColumns((prev) => mergeColumnSubset(prev!, next));
                }}
              />
              {isAdmin && (
                <>
                  {layoutResult === 'saved' && (
                    <StatusBanner tone="success" live>
                      {t('export.configSaved')}
                    </StatusBanner>
                  )}
                  {layoutResult === 'error' && (
                    <StatusBanner tone="error" live>
                      {t('common.error')}
                    </StatusBanner>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="secondary" icon="check" busy={savingLayout} onClick={() => void saveLayout()}>
                      {t('export.saveLayout')}
                    </Button>
                    <Link to="/admin/settings" className="inline-flex min-h-tap items-center text-sm font-semibold underline underline-offset-2">
                      {t('export.layoutInSettings')}
                    </Link>
                  </div>
                </>
              )}
            </div>
          </details>
        )}

        {result?.for === 'customer' && <ResultBanner result={result} />}

        <Button
          size="lg"
          block
          icon="download"
          busy={busy === 'customer'}
          disabled={!scopeReady || !columns || visibleCount === 0 || !periodComplete || busy !== null}
          onClick={() => void runExport('customer')}
        >
          {busy === 'customer' ? t('export.preparing') : t('export.downloadCustomer')}
        </Button>

        {/* Stated on the button's own card, not in a help page: this is the
            file that leaves the building. */}
        <p className="flex items-start gap-1.5 text-xs text-ink-600">
          <Icon name="info" size={14} className="mt-0.5 shrink-0" />
          <span>{t('export.customerHelp')}</span>
        </p>

        {visibleCount === 0 && columns && (
          <StatusBanner tone="warning">{t('export.noColumns')}</StatusBanner>
        )}
      </Card>

      {canSeePay && (
        <Card className="space-y-3">
          <SectionHeading icon="users">{t('export.paymentsTitle')}</SectionHeading>
          <p className="text-sm text-ink-600">{t('export.paymentsHelp')}</p>

          <Field htmlFor="export-worker" label={t('export.worker')}>
            {/* Search first, then the picker it narrows — only once the list is
                long enough to be worth searching. */}
            {workers.length > 8 && (
              <SearchField
                value={workerSearch}
                onChange={setWorkerSearch}
                label={t('export.searchWorkers')}
                className="mb-2"
              />
            )}
            <Select
              id="export-worker"
              value={workerId}
              onChange={(e) => {
                setWorkerId(e.target.value);
                setResult(null);
              }}
            >
              <option value="">{t('export.pickWorker')}</option>
              {workerOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            {workerSearch.trim() && matchingWorkers.length === 0 && (
              <p className="mt-1.5 text-sm text-ink-600">{t('export.noWorkerMatches')}</p>
            )}
          </Field>

          {/* What this button is about to produce, named in full: whose jobs, and over which dates. */}
          {period && (
            <PeriodLine>
              {selectedWorker
                ? t('export.periodCoversWorker', { ...period, worker: selectedWorker.name })
                : t('export.periodCovers', period)}
            </PeriodLine>
          )}

          {result?.for === 'payments' && (
            <ResultBanner
              result={result}
              /* "No jobs in that date range" is ambiguous here — it reads as if
                 the yard was shut. Name the worker. */
              emptyMessage={
                selectedWorker ? t('export.emptyWorker', { worker: selectedWorker.name }) : undefined
              }
            />
          )}

          <Button
            block
            icon="download"
            variant="secondary"
            busy={busy === 'payments'}
            disabled={!workerId || !periodComplete || busy !== null}
            onClick={() => void runExport('payments')}
          >
            {busy === 'payments' ? t('export.preparing') : t('export.downloadPayments')}
          </Button>
        </Card>
      )}
    </Page>
  );
}
