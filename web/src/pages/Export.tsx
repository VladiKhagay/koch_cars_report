import { useEffect, useState } from 'react';
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
import StatusBanner from '../components/StatusBanner';
import Icon from '../components/Icon';
import {
  Button,
  Card,
  Field,
  IconButton,
  Page,
  PageHeading,
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

type Result = { kind: 'empty' } | { kind: 'done'; file: string } | { kind: 'error' } | null;

export default function Export() {
  const { t, i18n } = useTranslation();
  const { appUser } = useAuth();
  const { sites, siteId, setSiteId, canSwitch } = useSiteScope();
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [busy, setBusy] = useState<'customer' | 'payments' | null>(null);
  /**
   * Distinguishable outcomes instead of one silent button. A manager who cannot
   * tell whether the file was produced taps again and ends up with three copies
   * in Downloads — or assumes it worked when it did not.
   */
  const [result, setResult] = useState<Result>(null);

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

  async function fetchJobs(): Promise<ExportJob[] | null> {
    const fromIso = new Date(`${from}T00:00:00`).toISOString();
    const toIso = new Date(`${to}T23:59:59.999`).toISOString();

    const { data, error } = await supabase
      .from('jobs')
      .select(JOB_FIELDS)
      .eq('site_id', siteId!)
      .is('deleted_at', null)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: true });

    if (error) return null;
    return (data ?? []) as unknown as ExportJob[];
  }

  async function writeSheet(rows: Cell[][], sheetName: string, suffix: string) {
    // Loaded on demand — this is the only screen that needs it, and it's a
    // sizeable library not worth shipping to every worker on a mobile connection.
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    const siteName = sites.find((s) => s.id === siteId)?.name ?? 'site';
    const file = `${siteName}-${suffix}-${from}-to-${to}.xlsx`;
    XLSX.writeFile(workbook, file);
    return file;
  }

  async function runExport(kind: 'customer' | 'payments') {
    if (!siteId || !columns) return;
    setBusy(kind);
    setResult(null);

    const jobs = await fetchJobs();
    if (!jobs) {
      setResult({ kind: 'error' });
      setBusy(null);
      return;
    }
    if (jobs.length === 0) {
      setResult({ kind: 'empty' });
      setBusy(null);
      return;
    }

    const rows =
      kind === 'customer'
        ? buildCustomerReport(jobs, columns, i18n.language)
        : buildWorkerPaymentReport(jobs, i18n.language);

    const file = await writeSheet(
      rows,
      kind === 'customer' ? 'Treatments' : 'Payments',
      kind === 'customer' ? 'treatments' : 'payments',
    );
    setResult({ kind: 'done', file });
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

  return (
    <Page width="form">
      <PageHeading>{t('export.title')}</PageHeading>

      <Card className="space-y-4">
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

        {result?.kind === 'empty' && <StatusBanner tone="warning" live>{t('export.empty')}</StatusBanner>}
        {result?.kind === 'error' && <StatusBanner tone="error" live>{t('common.error')}</StatusBanner>}
        {result?.kind === 'done' && (
          <StatusBanner tone="success" live>
            {t('export.done', { file: result.file })}
          </StatusBanner>
        )}

        <Button
          size="lg"
          block
          icon="download"
          busy={busy === 'customer'}
          disabled={!siteId || !columns || visibleCount === 0 || busy !== null}
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
          <Button
            block
            icon="download"
            variant="secondary"
            busy={busy === 'payments'}
            disabled={!siteId || busy !== null}
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
