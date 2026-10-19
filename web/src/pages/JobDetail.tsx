import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { serviceName as localizedServiceName } from '../lib/serviceName';
import { saveBilling } from '../lib/jobs';
import { recordAudit } from '../lib/audit';
import { useSiteScope } from '../lib/useSiteScope';
import { useStaff } from '../lib/useStaff';
import type { Job, PhotoKind, Service } from '../lib/types';
import PhotoViewer from '../components/PhotoViewer';
import VideoViewer from '../components/VideoViewer';
import CoworkerPicker from '../components/CoworkerPicker';
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
  Select,
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
  const staff = useStaff();
  const { sites } = useSiteScope();
  /* Submitter, crew and site are editable together: reassigning the job to one
     of its co-workers, or moving it to the yard it was really done at, are the
     corrections a manager actually makes. Shares recompute in Postgres (0019). */
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [coworkerIds, setCoworkerIds] = useState<string[]>([]);
  const [siteId, setSiteId] = useState('');
  const [serviceName, setServiceName] = useState('');
  /* Only the extras that exist: probing all three slots blind would render
     three 'photo unavailable' tiles on every job that has none. */
  const [extraKinds, setExtraKinds] = useState<PhotoKind[]>([]);
  /* Same reason: the video is optional, so most jobs have none to show. */
  const [hasVideo, setHasVideo] = useState(false);
  const [billingCode, setBillingCode] = useState('');
  const [managerNote, setManagerNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    if (id) void load(id);
  }, [id, i18n.language]);

  async function load(jobId: string) {
    setLoading(true);
    const { data: j } = await supabase.from('jobs_manager').select('*').eq('id', jobId).single();
    if (!j) {
      setLoading(false);
      return;
    }
    setJob(j);
    setBillingCode(j.billing_code ?? '');
    setManagerNote(j.manager_note ?? '');

    const { data: slots } = await supabase
      .from('photos')
      .select('kind')
      .eq('job_id', jobId)
      .or('kind.like.extra%,kind.eq.video')
      .order('kind');
    const kinds = (slots ?? []).map((p: { kind: PhotoKind }) => p.kind);
    setExtraKinds(kinds.filter((k) => k.startsWith('extra')));
    setHasVideo(kinds.includes('video'));

    setSelectedWorkerId(j.worker_id);
    setCoworkerIds(j.coworker_ids ?? []);
    setSiteId(j.site_id);

    if (j.service_id) {
      const { data: svc } = await supabase
        .from('services')
        .select('*')
        .eq('id', j.service_id)
        .single<Service>();
            // Honour the Russian service name, as the worker's chip list does.
      setServiceName(localizedServiceName(svc, i18n.language) ?? '');
    } else {
      setServiceName('');
    }
    setLoading(false);
  }

  async function handleSave() {
    if (!job || !appUser) return;
    setSaving(true);
    const billing = { billing_code: billingCode || null, manager_note: managerNote || null };
    const jobChanges = {
      worker_id: selectedWorkerId || job.worker_id,
      // The new submitter can't also be their own co-worker — the trigger would
      // drop them anyway; dropping them here keeps the screen honest.
      coworker_ids: coworkerIds.filter((id) => id !== (selectedWorkerId || job.worker_id)),
      site_id: siteId || job.site_id,
    };
    const changes = { ...billing, ...jobChanges };
    /* A manager moving a job to another site can't write its audit row
       afterwards — audit_log_insert is scoped to their own site, and the job
       has just left it. So a move is audited first, while they still can. */
    const moving = changes.site_id !== job.site_id;
    if (moving) await recordAudit(job.id, appUser.id, 'update', changes);
    // Billing first: a manager who moves the job away loses access to its billing row.
    const { error: billingError } = await saveBilling(job.id, billing);
    const { error } = billingError ? { error: billingError } : await supabase.from('jobs').update(jobChanges).eq('id', job.id);
    setSaving(false);
    if (error) {
      setSaveError(true);
      return;
    }
    if (!moving) await recordAudit(job.id, appUser.id, 'update', changes);
    setSaveError(false);
    setJob({ ...job, ...changes });
    setCoworkerIds(changes.coworker_ids);
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
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? '—';
  /* Any active colleague, from any site. The current submitter stays listed
     even if deactivated since, so the field never silently jumps on load. */
  const submitterOptions = staff.filter((s) => s.active || s.id === job.worker_id);

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

        {/* A plate is eight mono digits with wide tracking, and the brand rides
            beside it on the same line. At 28px that pair is wider than a 360px
            screen, so the brand wrapped alone under its plate. */}
        <h1 className="font-mono text-xl font-semibold tracking-wide text-ink-900 sm:text-2xl">
          {job.plate ?? job.vin ?? '—'}
          <span className="ms-3 font-sans text-sm font-normal tracking-normal text-ink-600 sm:text-base">
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

          {hasVideo && (
            <VideoViewer
              jobId={job.id}
              downloadName={`${job.plate ?? job.vin ?? job.id}_${job.created_at.slice(0, 10)}`}
            />
          )}

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
              {canManage ? (
                <div className="border-b border-line pb-3 last:border-0 last:pb-0">
                  <label htmlFor="job-worker" className="text-sm font-medium text-ink-600">
                    {t('jobDetail.worker')}
                  </label>
                  <Select
                    id="job-worker"
                    value={selectedWorkerId}
                    onChange={(e) => setSelectedWorkerId(e.target.value)}
                    className="mt-0.5"
                  >
                    {submitterOptions.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <Row label={t('jobDetail.worker')} value={nameOf(job.worker_id)} />
              )}
              {canManage ? (
                <div className="border-b border-line pb-3 last:border-0 last:pb-0">
                  <label htmlFor="job-coworkers" className="text-sm font-medium text-ink-600">
                    {t('coworkers.label')}
                  </label>
                  <div className="mt-0.5">
                    <CoworkerPicker
                      id="job-coworkers"
                      staff={staff}
                      sites={sites}
                      value={coworkerIds}
                      submitterId={selectedWorkerId || job.worker_id}
                      onChange={setCoworkerIds}
                    />
                  </div>
                </div>
              ) : (
                job.coworker_ids.length > 0 && (
                  <Row label={t('coworkers.label')} value={job.coworker_ids.map(nameOf).join(', ')} />
                )
              )}
              {canManage ? (
                <div className="border-b border-line pb-3 last:border-0 last:pb-0">
                  <label htmlFor="job-site" className="text-sm font-medium text-ink-600">
                    {t('newJob.site')}
                  </label>
                  <Select id="job-site" value={siteId} onChange={(e) => setSiteId(e.target.value)} className="mt-0.5">
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <Row label={t('newJob.site')} value={sites.find((s) => s.id === job.site_id)?.name ?? '—'} />
              )}
              <Row label={t('newJob.vin')} value={job.vin ?? '—'} mono />
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

            {saveError && <StatusBanner tone="error">{t('common.error')}</StatusBanner>}

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
