import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { serviceName as localizedServiceName } from '../lib/serviceName';
import { recordAudit } from '../lib/audit';
import type { Job, PhotoKind, Service } from '../lib/types';
import PhotoViewer from '../components/PhotoViewer';
import StatusBanner from '../components/StatusBanner';
import Icon from '../components/Icon';
import {
  Button,
  Card,
  ConfirmAction,
  EmptyState,
  Field,
  Page,
  SectionHeading,
  Skeleton,
  fieldClass,
} from '../components/ui';

export default function JobDetail() {
  const { t, i18n } = useTranslation();
  const { appUser } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [workerName, setWorkerName] = useState('');
  const [serviceName, setServiceName] = useState('');
  /* Only the extras that exist: probing all three slots blind would render
     three 'photo unavailable' tiles on every job that has none. */
  const [extraKinds, setExtraKinds] = useState<PhotoKind[]>([]);
  const [billingCode, setBillingCode] = useState('');
  const [managerNote, setManagerNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (id) void load(id);
  }, [id, i18n.language]);

  async function load(jobId: string) {
    setLoading(true);
    const { data: j } = await supabase.from('jobs').select('*').eq('id', jobId).single();
    if (!j) {
      setLoading(false);
      return;
    }
    setJob(j);
    setBillingCode(j.billing_code ?? '');
    setManagerNote(j.manager_note ?? '');

    const { data: extras } = await supabase
      .from('photos')
      .select('kind')
      .eq('job_id', jobId)
      .like('kind', 'extra%')
      .order('kind');
    setExtraKinds((extras ?? []).map((p: { kind: PhotoKind }) => p.kind));

    const { data: worker } = await supabase.from('users').select('name').eq('id', j.worker_id).single();
    setWorkerName(worker?.name ?? '');

    if (j.service_id) {
      const { data: svc } = await supabase
        .from('services')
        .select('*')
        .eq('id', j.service_id)
        .single<Service>();
      // Honour the Russian service name, the way the worker's own chip list
      // does. This screen was the only place in the app that always rendered
      // name_en, so a Russian-speaking manager saw English service names here
      // and nowhere else.
      setServiceName(localizedServiceName(svc, i18n.language) ?? '');
    } else {
      setServiceName('');
    }
    setLoading(false);
  }

  async function handleSave() {
    if (!job || !appUser) return;
    setSaving(true);
    const changes = { billing_code: billingCode || null, manager_note: managerNote || null };
    await supabase.from('jobs').update(changes).eq('id', job.id);
    await recordAudit(job.id, appUser.id, 'update', changes);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleDelete() {
    if (!job || !appUser) return;
    await supabase.from('jobs').update({ deleted_at: new Date().toISOString() }).eq('id', job.id);
    await recordAudit(job.id, appUser.id, 'soft_delete');
    navigate(-1);
  }

  async function handleRestore() {
    if (!job || !appUser) return;
    await supabase.from('jobs').update({ deleted_at: null }).eq('id', job.id);
    await recordAudit(job.id, appUser.id, 'restore');
    void load(job.id);
  }

  if (loading) {
    return (
      <Page width="list">
        <Skeleton className="h-7 w-48" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
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

  const canManage = appUser?.role === 'manager' || appUser?.role === 'admin';

  return (
    <Page width="list">
      {/* The back link labels the title; tight, not a section of its own. */}
      <div className="space-y-2">
        <Link
          to="/dashboard"
          className="inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold text-ink-700 hover:text-ink-900"
        >
          <Icon name="chevronLeft" size={18} />
          {t('jobDetail.back')}
        </Link>

        <h1 className="font-mono text-2xl font-semibold tracking-wide text-ink-900">
          {job.plate}
          <span className="ms-3 font-sans text-base font-normal tracking-normal text-ink-600">
            {job.brand ?? '—'}
          </span>
        </h1>
      </div>

      {job.deleted_at && <StatusBanner tone="warning">{t('jobDetail.deletedNotice')}</StatusBanner>}
      {job.duplicate_of_job_id && <StatusBanner tone="warning">{t('jobDetail.duplicateOf')}</StatusBanner>}

      {/* Two columns from md, so the manager reads the photos and types the
          billing code without scrolling between them. The old max-w-md had no
          lg variant at all, which put a 448px column on a 1440px screen. */}
      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <PhotoViewer jobId={job.id} kind="plate" label={t('newJob.platePhoto')} />
            <PhotoViewer jobId={job.id} kind="vin" label={t('newJob.vinPhoto')} />
            {extraKinds.map((kind, i) => (
              <PhotoViewer key={kind} jobId={job.id} kind={kind} label={t('newJob.extraPhoto', { n: i + 1 })} />
            ))}
          </div>

          <Card>
            <SectionHeading icon="clipboard">{t('jobDetail.details')}</SectionHeading>
            {/*
              Label above value rather than a justify-between row. A 17-character
              VIN and a comma-joined service list used to collide with the label,
              and Russian labels run about twice as long, which squeezed the
              value column further.
            */}
            <dl className="space-y-3">
              <Row label={t('jobDetail.date')} value={new Date(job.created_at).toLocaleString(i18n.language)} />
              <Row label={t('jobDetail.worker')} value={workerName || '—'} />
              <Row label={t('newJob.vin')} value={job.vin} mono />
              <Row label={t('jobDetail.service')} value={serviceName || '—'} />
              {job.worker_note && <Row label={t('jobDetail.workerNote')} value={job.worker_note} />}
            </dl>
          </Card>
        </div>

        {canManage && (
          <Card className="space-y-4">
            <SectionHeading icon="tag">{t('jobDetail.billingCode')}</SectionHeading>

            <Field htmlFor="billing-code" label={t('jobDetail.billingCode')}>
              <input
                id="billing-code"
                value={billingCode}
                onChange={(e) => setBillingCode(e.target.value)}
                className={`${fieldClass} font-mono`}
              />
            </Field>

            <Field htmlFor="manager-note" label={t('jobDetail.managerNote')} optional>
              <textarea
                id="manager-note"
                value={managerNote}
                onChange={(e) => setManagerNote(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-line-strong bg-surface px-3.5 py-3 text-base text-ink-900 focus:border-ink-900"
              />
            </Field>

            <Button size="lg" block busy={saving} icon={saved ? 'check' : undefined} onClick={() => void handleSave()}>
              {saved ? t('jobDetail.saved') : t('jobDetail.save')}
            </Button>

            {/*
              Delete used to fire on first tap, directly below Save in the same
              full-width stack, while Services already had an inline confirm.
              Both now use the app's single ConfirmAction pattern, and the
              destructive control is separated from Save by a rule.
            */}
            <div className="border-t border-line pt-4">
              {job.deleted_at ? (
                <Button variant="secondary" icon="sync" block onClick={() => void handleRestore()}>
                  {t('jobDetail.restore')}
                </Button>
              ) : (
                <ConfirmAction
                  block
                  trigger={t('jobDetail.deleteAction')}
                  question={t('jobDetail.deleteConfirm')}
                  confirmLabel={t('jobDetail.delete')}
                  onConfirm={() => void handleDelete()}
                />
              )}
            </div>
          </Card>
        )}
      </div>
    </Page>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-b border-line pb-3 last:border-0 last:pb-0">
      <dt className="text-sm font-medium text-ink-600">{label}</dt>
      <dd className={`mt-0.5 break-words text-ink-900 ${mono ? 'font-mono tracking-wide' : ''}`}>{value}</dd>
    </div>
  );
}
