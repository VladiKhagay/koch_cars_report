import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchAppSettings, saveCustomerReportLayout, saveHideWorkerNames } from '../../lib/carasso';
import type { ColumnConfig } from '../../lib/reportConfig';
import AdminTabs from '../../components/AdminTabs';
import ReportColumns from '../../components/ReportColumns';
import StatusBanner from '../../components/StatusBanner';
import { Button, Card, LoadingRegion, Page, PageHeading, SectionHeading } from '../../components/ui';

type Outcome = 'saved' | 'error' | null;

/** App-wide admin settings: whether Carasso sees worker names, and the one customer-report layout. */
export default function AdminSettings() {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [hide, setHide] = useState(false);
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [hideBusy, setHideBusy] = useState(false);
  const [hideResult, setHideResult] = useState<Outcome>(null);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [layoutResult, setLayoutResult] = useState<Outcome>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    void fetchAppSettings().then((s) => {
      setLoadFailed(!s.ok);
      setHide(s.hideWorkerNames);
      setColumns(s.customerReportColumns);
      setLoaded(true);
    });
  }, []);

  async function toggleHide(next: boolean) {
    setHideBusy(true);
    setHideResult(null);
    const { error } = await saveHideWorkerNames(next);
    setHideBusy(false);
    if (error) return setHideResult('error');
    setHide(next);
    setHideResult('saved');
  }

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
          <Card className="space-y-3">
            <SectionHeading icon="lock">{t('settings.hideTitle')}</SectionHeading>
            <label className="flex min-h-tap items-start gap-3">
              <input
                type="checkbox"
                role="switch"
                checked={hide}
                disabled={hideBusy}
                onChange={(e) => void toggleHide(e.target.checked)}
                className="mt-0.5 size-5 shrink-0 accent-ink-900"
              />
              <span className="text-sm font-medium text-ink-900">{t('settings.hideLabel')}</span>
            </label>
            <p className="text-sm text-ink-600">{t('settings.hideHelp')}</p>
            {hideResult === 'saved' && (
              <StatusBanner tone="success" live>
                {t('settings.saved')}
              </StatusBanner>
            )}
            {hideResult === 'error' && (
              <StatusBanner tone="error" live>
                {t('common.error')}
              </StatusBanner>
            )}
          </Card>

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
