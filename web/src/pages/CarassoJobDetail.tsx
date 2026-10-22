import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CARASSO_JOBS_VIEW, CARASSO_JOB_COLUMNS } from '../lib/carasso';
import { serviceName } from '../lib/serviceName';
import type { CarassoJob } from '../lib/types';
import Icon from '../components/Icon';
import JobMedia from '../components/JobMedia';
import { formatMoney } from '../components/money';
import { supabase } from '../lib/supabase';
import { Button, Card, DetailRow, EmptyState, Page, SectionHeading, Skeleton } from '../components/ui';

/**
 * Carasso's read-only job. Everything comes from `jobs_carasso` (no pay, no
 * manager note, no duplicate flag, no deleted jobs), so there is nothing here
 * to hide in the markup: what the database withholds simply is not present.
 * The crew is null while the admin hides worker names.
 */
export default function CarassoJobDetail() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<CarassoJob | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let live = true;
    setLoading(true);
    void supabase
      .from(CARASSO_JOBS_VIEW)
      .select(CARASSO_JOB_COLUMNS)
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        setJob((data as unknown as CarassoJob | null) ?? null);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [id]);

  if (loading) {
    return (
      <Page width="list">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-44" />
        <Skeleton className="h-40" />
      </Page>
    );
  }

  if (!job) {
    return (
      <Page width="list">
        <EmptyState
          icon="alertCircle"
          title={t('jobDetail.notFoundTitle')}
          body={t('jobDetail.notFoundBody')}
          action={
            <Button variant="secondary" icon="chevronLeft" onClick={() => navigate(-1)}>
              {t('jobDetail.back')}
            </Button>
          }
        />
      </Page>
    );
  }

  const service = job.service_name_en
    ? serviceName({ name_en: job.service_name_en, name_ru: job.service_name_ru, name_he: job.service_name_he }, i18n.language)
    : null;

  return (
    <Page width="list">
      <div className="space-y-2">
        <Link
          to="/jobs"
          className="inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold text-ink-700 hover:text-ink-900"
        >
          <Icon name="chevronLeft" size={18} className="rtl:-scale-x-100" />
          {t('jobDetail.back')}
        </Link>
        <h1 className="font-mono text-xl font-semibold tracking-wide text-ink-900 sm:text-2xl">
          {job.plate ?? job.vin ?? '—'}
          <span className="ms-3 font-sans text-sm font-normal tracking-normal text-ink-600 sm:text-base">
            {job.brand ?? '—'}
          </span>
        </h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <div className="space-y-4">
          <JobMedia jobId={job.id} downloadName={`${job.plate ?? job.vin ?? job.id}_${job.created_at.slice(0, 10)}`} />
        </div>

        <div className="space-y-4">
          <Card>
            <SectionHeading icon="clipboard">{t('jobDetail.details')}</SectionHeading>
            <dl className="space-y-3">
              <DetailRow label={t('jobDetail.date')} value={new Date(job.created_at).toLocaleString(i18n.language)} />
              <DetailRow label={t('newJob.site')} value={job.site_name} />
              <DetailRow label={t('jobDetail.service')} value={service || '—'} />
              <DetailRow label={t('newJob.plate')} value={job.plate ?? '—'} mono />
              <DetailRow label={t('newJob.vin')} value={job.vin ?? '—'} mono />
              <DetailRow label={t('newJob.brand')} value={job.brand ?? '—'} />
              {job.billing_code && <DetailRow label={t('jobDetail.billingCode')} value={job.billing_code} mono />}
              {job.crew && <DetailRow label={t('jobDetail.crew')} value={job.crew} />}
              {job.worker_note && <DetailRow label={t('jobDetail.workerNote')} value={job.worker_note} />}
            </dl>
          </Card>

          <Card>
            <SectionHeading icon="tag">{t('jobDetail.clientPrices')}</SectionHeading>
            <dl className="space-y-3">
              <DetailRow label={t('prices.unit')} value={formatMoney(job.client_unit_price, i18n.language)} />
              <DetailRow label={t('prices.total')} value={formatMoney(job.client_total_price, i18n.language)} />
            </dl>
          </Card>
        </div>
      </div>
    </Page>
  );
}
