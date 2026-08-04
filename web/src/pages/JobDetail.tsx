import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { recordAudit } from '../lib/audit';
import type { Job, Service } from '../lib/types';
import PhotoViewer from '../components/PhotoViewer';

export default function JobDetail() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<Job | null>(null);
  const [workerName, setWorkerName] = useState('');
  const [serviceNames, setServiceNames] = useState<string[]>([]);
  const [billingCode, setBillingCode] = useState('');
  const [managerNote, setManagerNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (id) void load(id);
  }, [id]);

  async function load(jobId: string) {
    const { data: j } = await supabase.from('jobs').select('*').eq('id', jobId).single();
    if (!j) return;
    setJob(j);
    setBillingCode(j.billing_code ?? '');
    setManagerNote(j.manager_note ?? '');

    const { data: worker } = await supabase.from('users').select('name').eq('id', j.worker_id).single();
    setWorkerName(worker?.name ?? '');

    const { data: links } = await supabase.from('job_services').select('service_id').eq('job_id', jobId);
    if (links && links.length > 0) {
      const { data: svc } = await supabase
        .from('services')
        .select('*')
        .in('id', links.map((l) => l.service_id));
      setServiceNames((svc ?? []).map((s: Service) => s.name_en));
    }
  }

  async function handleSave() {
    if (!job || !appUser) return;
    setSaving(true);
    const changes = { billing_code: billingCode || null, manager_note: managerNote || null };
    await supabase.from('jobs').update(changes).eq('id', job.id);
    await recordAudit(job.id, appUser.id, 'update', changes);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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

  if (!job) return <div className="p-4 text-sm text-slate-500">{t('common.loading')}</div>;

  const canManage = appUser?.role === 'manager' || appUser?.role === 'admin';

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-lg font-semibold text-slate-900">
        {job.plate} <span className="font-normal text-slate-400">· {job.brand ?? '—'}</span>
      </h1>

      {job.duplicate_of_job_id && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('jobDetail.duplicateOf')}</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <PhotoViewer jobId={job.id} kind="plate" label={t('newJob.platePhoto')} />
        <PhotoViewer jobId={job.id} kind="vin" label={t('newJob.vinPhoto')} />
      </div>

      <dl className="space-y-1 text-sm">
        <Row label={t('jobDetail.date')} value={new Date(job.created_at).toLocaleString()} />
        <Row label={t('jobDetail.worker')} value={workerName} />
        <Row label={t('newJob.vin')} value={job.vin} />
        <Row label={t('jobDetail.services')} value={serviceNames.join(', ') || '—'} />
        {job.worker_note && <Row label={t('jobDetail.workerNote')} value={job.worker_note} />}
      </dl>

      {canManage && (
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">{t('jobDetail.billingCode')}</label>
            <input
              value={billingCode}
              onChange={(e) => setBillingCode(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">{t('jobDetail.managerNote')}</label>
            <textarea
              value={managerNote}
              onChange={(e) => setManagerNote(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
            />
          </div>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="w-full rounded-lg bg-brand-600 py-3 font-medium text-white disabled:opacity-60"
          >
            {saved ? t('jobDetail.saved') : t('jobDetail.save')}
          </button>

          {job.deleted_at ? (
            <button onClick={() => void handleRestore()} className="w-full rounded-lg border border-slate-300 py-2.5 text-sm">
              {t('jobDetail.restore')}
            </button>
          ) : (
            <button onClick={() => void handleDelete()} className="w-full rounded-lg border border-red-200 py-2.5 text-sm text-red-600">
              {t('jobDetail.delete')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-900">{value}</dd>
    </div>
  );
}
