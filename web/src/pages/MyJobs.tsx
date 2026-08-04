import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { Job, Service } from '../lib/types';
import ServiceChips from '../components/ServiceChips';

interface JobRow extends Job {
  serviceIds: string[];
}

export default function MyJobs() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ note: string; serviceIds: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!appUser) return;
    void load();
    void supabase.from('services').select('*').eq('active', true).order('sort_order').then(({ data }) => setServices(data ?? []));
    // Re-render every 20s so the "editable" window closes live without a manual refresh.
    const interval = setInterval(() => forceTick((n) => n + 1), 20_000);
    return () => clearInterval(interval);
  }, [appUser]);

  async function load() {
    if (!appUser) return;
    const { data: jobRows } = await supabase
      .from('jobs_worker_view')
      .select('*')
      .eq('worker_id', appUser.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!jobRows) return;

    const { data: links } = await supabase
      .from('job_services')
      .select('job_id, service_id')
      .in('job_id', jobRows.map((j) => j.id));

    setJobs(
      jobRows.map((j) => ({
        ...j,
        serviceIds: (links ?? []).filter((l) => l.job_id === j.id).map((l) => l.service_id),
      })),
    );
  }

  function startEdit(job: JobRow) {
    setEditingId(job.id);
    setEditDraft({ note: job.worker_note ?? '', serviceIds: job.serviceIds });
  }

  async function saveEdit(jobId: string) {
    if (!editDraft) return;
    setSaving(true);
    await supabase.from('jobs').update({ worker_note: editDraft.note || null }).eq('id', jobId);
    await supabase.from('job_services').delete().eq('job_id', jobId);
    if (editDraft.serviceIds.length > 0) {
      await supabase.from('job_services').insert(editDraft.serviceIds.map((service_id) => ({ job_id: jobId, service_id })));
    }
    setSaving(false);
    setEditingId(null);
    await load();
  }

  return (
    <div className="mx-auto max-w-md space-y-3 p-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('myJobs.title')}</h1>

      {jobs.length === 0 && <p className="text-sm text-slate-500">{t('myJobs.empty')}</p>}

      {jobs.map((job) => {
        const editable = new Date(job.locked_at).getTime() > Date.now();
        const isEditing = editingId === job.id;
        return (
          <div key={job.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-slate-900">{job.plate}</p>
                <p className="text-xs text-slate-500">{job.vin} · {job.brand ?? '—'}</p>
                <p className="text-xs text-slate-400">{new Date(job.created_at).toLocaleString()}</p>
              </div>
              {editable ? (
                !isEditing && (
                  <button className="text-sm font-medium text-brand-700" onClick={() => startEdit(job)}>
                    {t('newJob.edit')}
                  </button>
                )
              ) : (
                <span className="text-xs text-slate-400">{t('myJobs.locked')}</span>
              )}
            </div>

            {isEditing && editDraft && (
              <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                <ServiceChips
                  services={services}
                  selected={editDraft.serviceIds}
                  onToggle={(id) =>
                    setEditDraft((d) =>
                      d
                        ? {
                            ...d,
                            serviceIds: d.serviceIds.includes(id)
                              ? d.serviceIds.filter((s) => s !== id)
                              : [...d.serviceIds, id],
                          }
                        : d,
                    )
                  }
                />
                <textarea
                  value={editDraft.note}
                  onChange={(e) => setEditDraft((d) => (d ? { ...d, note: e.target.value } : d))}
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={t('newJob.note') ?? ''}
                />
                <div className="flex gap-2">
                  <button
                    disabled={saving}
                    onClick={() => void saveEdit(job.id)}
                    className="flex-1 rounded-lg bg-brand-600 py-2 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {t('jobDetail.save')}
                  </button>
                  <button onClick={() => setEditingId(null)} className="flex-1 rounded-lg border border-slate-300 py-2 text-sm">
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
