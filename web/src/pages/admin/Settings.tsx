import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchAppSettings, saveCustomerReportLayout, saveHideClientPrices, saveHideWorkerNames } from '../../lib/carasso';
import type { ColumnConfig } from '../../lib/reportConfig';
import AdminTabs from '../../components/AdminTabs';
import type { IconName } from '../../components/Icon';
import ReportColumns from '../../components/ReportColumns';
import StatusBanner from '../../components/StatusBanner';
import { Button, Card, LoadingRegion, Page, PageHeading, SectionHeading } from '../../components/ui';

type Outcome = 'saved' | 'error' | null;

/** One admin on/off switch: saves on change and reports the outcome in place. */
function SettingSwitch({
  icon,
  title,
  label,
  help,
  initial,
  save,
}: {
  icon: IconName;
  title: string;
  label: string;
  help: string;
  initial: boolean;
  save: (next: boolean) => PromiseLike<{ error: unknown }>;
}) {
  const { t } = useTranslation();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Outcome>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setResult(null);
    const { error } = await save(next);
    setBusy(false);
    if (error) return setResult('error');
    setOn(next);
    setResult('saved');
  }

  return (
    <Card className="space-y-3">
      <SectionHeading icon={icon}>{title}</SectionHeading>
      <label className="flex min-h-tap items-start gap-3">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-ink-900"
        />
        <span className="text-sm font-medium text-ink-900">{label}</span>
      </label>
      <p className="text-sm text-ink-600">{help}</p>
      {result === 'saved' && (
        <StatusBanner tone="success" live>
          {t('settings.saved')}
        </StatusBanner>
      )}
      {result === 'error' && (
        <StatusBanner tone="error" live>
          {t('common.error')}
        </StatusBanner>
      )}
    </Card>
  );
}

/** App-wide admin settings: what Carasso sees (worker names, client prices), and the one customer-report layout. */
export default function AdminSettings() {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [hideNames, setHideNames] = useState(false);
  const [hidePrices, setHidePrices] = useState(false);
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [layoutResult, setLayoutResult] = useState<Outcome>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    void fetchAppSettings().then((s) => {
      setLoadFailed(!s.ok);
      setHideNames(s.hideWorkerNames);
      setHidePrices(s.hideClientPrices);
      setColumns(s.customerReportColumns);
      setLoaded(true);
    });
  }, []);

  async function saveLayout() {
    setLayoutBusy(true);
    setLayoutResult(null);
    const { error } = await saveCustomerReportLayout(columns);
    setLayoutBusy(false);
    setLayoutResult(error ? 'error' : 'saved');
  }

  return (
    <Page width="form">
      <div className="space-y-2">
        <AdminTabs active="settings" />
      </div>
      <PageHeading>{t('settings.title')}</PageHeading>

      {!loaded && <LoadingRegion label={t('common.loading')} rows={3} />}
      {loaded && loadFailed && <StatusBanner tone="error">{t('common.error')}</StatusBanner>}

      {loaded && !loadFailed && (
        <>
          <SettingSwitch
            icon="lock"
            title={t('settings.hideTitle')}
            label={t('settings.hideLabel')}
            help={t('settings.hideHelp')}
            initial={hideNames}
            save={saveHideWorkerNames}
          />
          <SettingSwitch
            icon="tag"
            title={t('settings.pricesTitle')}
            label={t('settings.pricesLabel')}
            help={t('settings.pricesHelp')}
            initial={hidePrices}
            save={saveHideClientPrices}
          />

          <Card className="space-y-3">
            <SectionHeading icon="clipboard">{t('export.configTitle')}</SectionHeading>
            <p className="text-sm text-ink-600">{t('export.configHelp')}</p>
            <ReportColumns
              reorder
              columns={columns}
              onChange={(next) => {
                setLayoutResult(null);
                setColumns(next);
              }}
            />
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
            <Button icon="check" busy={layoutBusy} onClick={() => void saveLayout()}>
              {t('admin.save')}
            </Button>
          </Card>
        </>
      )}
    </Page>
  );
}
