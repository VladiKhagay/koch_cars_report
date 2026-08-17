import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useSiteScope } from '../lib/useSiteScope';
import { buildCustomerReport, buildWorkerPaymentReport, type Cell, type ExportJob } from '../lib/exports';
import {
  moveColumn,
  resolveCustomerColumns,
  toStoredConfig,
  type ColumnConfig,
} from '../lib/reportConfig';
import type { AppUser } from '../lib/types';
import StatusBanner from '../components/StatusBanner';
import Icon from '../components/Icon';
import {
  Button,
  Card,
  Field,
  IconButton,
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

/** Only the fields the two reports read — the query asks for nothing else. */
const JOB_FIELDS =
  'created_at, plate, vin, brand, billing_code, worker_price,' +
  ' worker:users!jobs_worker_id_fkey(name), service:services(name_en, catalog_number)';

type ReportKind = 'customer' | 'payments';

/**
 * The outcome of the last export, tagged with which button produced it.
 *
 * The tag exists so the banner can be rendered under that button. There are
 * two export actions on this page and one shared date range; an unattributed
 * "Downloaded …" floating near the dates is the kind of feedback a manager
 * reads as belonging to whichever report they were looking at.
 */
type Result = ({ kind: 'empty' } | { kind: 'done'; file: string } | { kind: 'error' }) & {
  for: ReportKind;
};

/**
 * The span a report is about to cover, stated directly above its own download
 * button — "whose jobs, over which dates".
 *
 * Weighted as a statement of configuration rather than as muted help text: it
 * is the answer to "what am I about to download?", and it is the thing that
 * visibly changes when the period above is edited.
 */
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
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [busy, setBusy] = useState<ReportKind | null>(null);
  /**
   * Distinguishable outcomes instead of one silent button. A manager who cannot
   * tell whether the file was produced taps again and ends up with three copies
   * in Downloads — or assumes it worked when it did not.
   */
  const [result, setResult] = useState<Result | null>(null);

  // Report layout
  const [columns, setColumns] = useState<ColumnConfig[] | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configResult, setConfigResult] = useState<'saved' | 'error' | null>(null);

  /**
   * Worker pay is admin-only on the Services screen, so the sheet listing it
   * per job is too. Flip this to `canManage` if managers are meant to run
   * payroll — but see the note in the RLS review: a manager can still read
   * `jobs.worker_price` through the API, so the UI is the softer half of that.
   */
  const canSeePay = appUser?.role === 'admin';

  /* Who the payment sheet is for. Empty until picked — the report is per
     worker, so there is no sensible default and guessing one would produce a
     file for the wrong person under a plausible name. */
  const [workers, setWorkers] = useState<Pick<AppUser, 'id' | 'name'>[]>([]);
  const [workerId, setWorkerId] = useState('');
  const [workerSearch, setWorkerSearch] = useState('');

  /*
   * The selectable workers are the ones at the site in scope, which is the same
   * scope the jobs query runs under — RLS enforces it either way, this just
   * stops the list offering people whose rows would come back empty. Managers
   * and workers are pinned to their own site by useSiteScope; only an admin can
   * move the site, and only an admin reaches this card at all.
   *
   * Inactive staff are deliberately included: somebody who left mid-month is
   * still owed for the jobs they logged before they did.
   */
  useEffect(() => {
    if (!canSeePay || !siteId) return;
    let cancelled = false;
    void supabase
      .from('users')
      .select('id,name')
      .eq('site_id', siteId)
      .order('name')
      .then(({ data }) => {
        if (cancelled) return;
        setWorkers(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [canSeePay, siteId]);

  // A worker picked at one site must not survive a move to another.
  useEffect(() => {
    setWorkerId('');
    setWorkerSearch('');
  }, [siteId]);

  /* A yard can carry a long staff list, and a native select is a scroll with no
     way to type at it. The search narrows the options rather than replacing the
     control — so the thing you finally tap is still the same picker, and on a
     phone still the native one. */
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

  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    void supabase
      .from('sites')
      .select('customer_report_config')
      .eq('id', siteId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setColumns(resolveCustomerColumns(data?.customer_report_config));
      });
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  /**
   * The jobs both reports are built from.
   *
   * `forWorkerId` narrows to one worker in Postgres rather than filtering the
   * rows afterwards: the payment sheet must not be able to contain somebody
   * else's job even for a moment, and a client-side filter over a query that
   * fetched the whole site is one forgotten line away from doing exactly that.
   *
   * Both date bounds are inclusive local calendar days — the same widening the
   * jobs grid does, so "1st to 31st" means the same span on both screens.
   */
  async function fetchJobs(forWorkerId?: string): Promise<ExportJob[] | null> {
    const fromIso = new Date(`${from}T00:00:00`).toISOString();
    const toIso = new Date(`${to}T23:59:59.999`).toISOString();

    let query = supabase
      .from('jobs')
      .select(JOB_FIELDS)
      .eq('site_id', siteId!)
      .is('deleted_at', null)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: true });

    if (forWorkerId) query = query.eq('worker_id', forWorkerId);

    const { data, error } = await query;

    if (error) return null;
    return (data ?? []) as unknown as ExportJob[];
  }

  async function writeSheet(rows: Cell[][], sheetName: string, suffix: string, who?: string) {
    // Loaded on demand — this is the only screen that needs it, and it's a
    // sizeable library not worth shipping to every worker on a mobile connection.
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    const siteName = sites.find((s) => s.id === siteId)?.name ?? 'site';
    // The worker's name goes in the filename: these files land in a Downloads
    // folder a month at a time, and "payments-2026-03-01-to-…" ten times over
    // is ten files nobody can tell apart without opening them.
    const file = [siteName, suffix, who, from, 'to', to].filter(Boolean).join('-') + '.xlsx';
    XLSX.writeFile(workbook, file);
    return file;
  }

  async function runExport(kind: ReportKind) {
    if (!siteId || !columns || !periodComplete) return;
    // The payment sheet is per worker; without one there is no report to build.
    if (kind === 'payments' && !selectedWorker) return;
    setBusy(kind);
    setResult(null);

    const jobs = await fetchJobs(kind === 'payments' ? workerId : undefined);
    if (!jobs) {
      setResult({ kind: 'error', for: kind });
      setBusy(null);
      return;
    }
    if (jobs.length === 0) {
      setResult({ kind: 'empty', for: kind });
      setBusy(null);
      return;
    }

    const rows =
      kind === 'customer'
        ? buildCustomerReport(jobs, columns, i18n.language)
        : buildWorkerPaymentReport(jobs, selectedWorker!.name, i18n.language);

    const file = await writeSheet(
      rows,
      kind === 'customer' ? 'Treatments' : 'Payments',
      kind === 'customer' ? 'treatments' : 'payments',
      kind === 'payments' ? selectedWorker!.name : undefined,
    );
    setResult({ kind: 'done', file, for: kind });
    setBusy(null);
  }

  async function saveConfig() {
    if (!columns) return;
    setSavingConfig(true);
    setConfigResult(null);
    const { error } = await supabase.rpc('update_customer_report_config', {
      new_config: toStoredConfig(columns),
    });
    setSavingConfig(false);
    setConfigResult(error ? 'error' : 'saved');
  }

  const visibleCount = columns?.filter((c) => c.visible).length ?? 0;

  /* A date input can be cleared. Both reports then build an ISO bound out of
     `new Date('T00:00:00')`, which is an Invalid Date and throws on
     `.toISOString()` — leaving the button spinning with no error. Every export
     action is gated on having both ends of the period. */
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

  return (
    <Page width="form">
      <PageHeading>{t('export.title')}</PageHeading>

      {/*
        The period comes FIRST and on its own card, because it is the one
        setting both reports share.
        It used to sit inside the customer report's card, above that report's
        own download button — so the worker payment card below appeared to have
        no date range at all, and the range it silently used was one the manager
        had set while looking at a different report. Same two inputs, same
        component, moved to where what they govern is stated: the heading names
        them as the report period, the help line says both reports below use
        them, and each report restates the span it is about to cover directly
        above its own button.
      */}
      <Card className="space-y-4">
        <SectionHeading icon="calendar">{t('export.periodTitle')}</SectionHeading>
        <p className="text-sm text-ink-600">{t('export.periodHelp')}</p>

        {canSwitch && sites.length > 0 && (
          <Field htmlFor="export-site" label={t('export.site')}>
            <Select id="export-site" value={siteId ?? ''} onChange={(e) => setSiteId(e.target.value)}>
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

        {!periodComplete && <StatusBanner tone="warning">{t('export.periodIncomplete')}</StatusBanner>}
      </Card>

      <Card className="space-y-3">
        <SectionHeading icon="clipboard">{t('export.customerTitle')}</SectionHeading>

        {period && <PeriodLine>{t('export.periodCovers', period)}</PeriodLine>}

        {result?.for === 'customer' && <ResultBanner result={result} />}

        <Button
          size="lg"
          block
          icon="download"
          busy={busy === 'customer'}
          disabled={!siteId || !columns || visibleCount === 0 || !periodComplete || busy !== null}
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
                long enough to be worth searching. Below that it is one more
                empty box between a manager and the file they came for. */}
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

          {/* What this button is about to produce, named in full: whose jobs,
              and over which dates. It changes as either input changes, which is
              what makes the period above visibly part of THIS report rather
              than a setting that happens to sit further up the page. */}
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
                 the yard was shut. Name the worker: the range is fine, this
                 person logged nothing in it. */
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
            disabled={!siteId || !workerId || !periodComplete || busy !== null}
            onClick={() => void runExport('payments')}
          >
            {busy === 'payments' ? t('export.preparing') : t('export.downloadPayments')}
          </Button>
        </Card>
      )}

      {/* ------------------------------------------------ report layout ---- */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading icon="settings">{t('export.configTitle')}</SectionHeading>
          <Button variant="secondary" onClick={() => setConfiguring((v) => !v)}>
            {configuring ? t('common.close') : t('export.configure')}
          </Button>
        </div>

        {!configuring && (
          <p className="text-sm text-ink-600">
            {t('export.configSummary', { count: visibleCount })}
          </p>
        )}

        {configuring && columns && (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-ink-600">{t('export.configHelp')}</p>

            <ul className="divide-y divide-line rounded-xl border border-line">
              {columns.map((column, i) => (
                <li key={column.key} className="flex min-h-tap items-center gap-2 p-2">
                  <label className="flex min-w-0 flex-1 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={column.visible}
                      onChange={() => {
                        setConfigResult(null);
                        setColumns((prev) =>
                          prev!.map((c) => (c.key === column.key ? { ...c, visible: !c.visible } : c)),
                        );
                      }}
                      className="size-5 shrink-0 accent-ink-900"
                    />
                    <span
                      className={`min-w-0 break-words text-sm font-medium ${
                        column.visible ? 'text-ink-900' : 'text-ink-500'
                      }`}
                    >
                      {t(`export.columns.${column.key}`)}
                    </span>
                  </label>
                  <div className="flex shrink-0 items-center">
                    <IconButton
                      icon="arrowUp"
                      label={t('services.moveUp')}
                      disabled={i === 0}
                      onClick={() => {
                        setConfigResult(null);
                        setColumns((prev) => moveColumn(prev!, i, -1));
                      }}
                    />
                    <IconButton
                      icon="arrowDown"
                      label={t('services.moveDown')}
                      disabled={i === columns.length - 1}
                      onClick={() => {
                        setConfigResult(null);
                        setColumns((prev) => moveColumn(prev!, i, 1));
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>

            {configResult === 'saved' && (
              <StatusBanner tone="success" live>
                {t('export.configSaved')}
              </StatusBanner>
            )}
            {configResult === 'error' && (
              <StatusBanner tone="error" live>
                {t('common.error')}
              </StatusBanner>
            )}

            <Button icon="check" busy={savingConfig} onClick={() => void saveConfig()}>
              {t('admin.save')}
            </Button>
          </div>
        )}
      </Card>
    </Page>
  );
}
