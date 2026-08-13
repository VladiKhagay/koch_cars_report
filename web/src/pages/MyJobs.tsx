import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useQueuedJobs } from '../lib/useQueue';
import type { Job, Service } from '../lib/types';
import ServiceChips from '../components/ServiceChips';
import { Badge, Button, Card, EmptyState, LoadingRegion, Page, PageHeading, SectionHeading } from '../components/ui';

/** Whole minutes left in the 15-minute edit window, or 0 once it has closed. */
function minutesLeft(lockedAt: string): number {
  return Math.max(0, Math.ceil((new Date(lockedAt).getTime() - Date.now()) / 60_000));
}

export default function MyJobs() {
  const { t, i18n } = useTranslation();
  const { appUser } = useAuth();
  const queued = useQueuedJobs();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<Service[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ note: string; serviceId: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!appUser) return;
    void load();
    void supabase.from('services').select('*').eq('active', true).order('sort_order').then(({ data }) => setServices(data ?? []));
    // Re-render every 20s so the remaining edit time counts down live.
    const interval = setInterval(() => forceTick((n) => n + 1), 20_000);
    return () => clearInterval(interval);
  }, [appUser]);

  async function load() {
    if (!appUser) return;
    setLoading(true);
    // The service now rides on the job row itself, so the second round-trip
    // that used to resolve job_services links is gone.
    const { data: jobRows } = await supabase
      .from('jobs_worker_view')
      .select('*')
      .eq('worker_id', appUser.id)
      .order('created_at', { ascending: false })
      .limit(50);

    setJobs(jobRows ?? []);
    setLoading(false);
  }

  function startEdit(job: Job) {
    setEditingId(job.id);
    setEditDraft({ note: job.worker_note ?? '', serviceId: job.service_id });
  }

  async function saveEdit(jobId: string) {
    if (!editDraft) return;
    setSaving(true);
    // One row, one write. worker_price is not sent: the database trigger
    // re-stamps it from the catalog whenever service_id changes.
    await supabase
      .from('jobs')
      .update({ worker_note: editDraft.note || null, service_id: editDraft.serviceId })
      .eq('id', jobId);
    setSaving(false);
    setEditingId(null);
    await load();
  }

  const serviceLabel = (id: string) => {
    const service = services.find((s) => s.id === id);
    if (!service) return null;
    return i18n.language === 'ru' && service.name_ru ? service.name_ru : service.name_en;
  };

  return (
    <Page width="form" className="space-y-5">
      <PageHeading>{t('myJobs.title')}</PageHeading>

      {/*
        Jobs that failed to reach the server are listed FIRST and as real
        entries, not as a count in a banner. Previously this screen read
        straight from Supabase, so the cars most at risk of being lost were
        exactly the ones missing from the worker's own record.
      */}
      {queued.length > 0 && (
        <section className="space-y-2">
          <SectionHeading icon="sync">{t('queue.title')}</SectionHeading>
          <p className="text-sm text-ink-600">{t('queue.body')}</p>
          {queued.map((job) => (
            <Card key={job.queuedId} className="border-ink-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-base font-semibold tracking-wide text-ink-900">{job.plate}</p>
                  <p className="truncate font-mono text-xs text-ink-600">
                    {job.vin} · {job.brand ?? '—'}
                  </p>
                  <p className="mt-1 text-xs text-ink-600">{t('myJobs.queuedHint')}</p>
                </div>
                <Badge tone="info" icon="sync">
                  {t('queue.title')}
                </Badge>
              </div>
            </Card>
          ))}
        </section>
      )}

      {loading && <LoadingRegion label={t('common.loading')} rows={3} />}

      {!loading && jobs.length === 0 && queued.length === 0 && (
        <EmptyState icon="clipboard" title={t('myJobs.emptyTitle')} body={t('myJobs.emptyBody')} />
      )}

      <div className="space-y-2">
        {jobs.map((job) => {
          const remaining = minutesLeft(job.locked_at);
          const editable = remaining > 0;
          const isEditing = editingId === job.id;
          const name = job.service_id ? serviceLabel(job.service_id) : null;

          return (
            <Card key={job.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                {/* The work done is the title. A worker scanning their own day
                    is looking for "what did I do to that car", not re-reading
                    plates they already know — so the vehicle and time drop to
                    supporting metadata underneath. */}
                <div className="min-w-0">
                  <p className="break-words text-base font-semibold tracking-tight text-ink-900">
                    {name ?? t('myJobs.noService')}
                  </p>
                  <p className="mt-1 truncate text-sm text-ink-600">
                    <span className="font-mono font-medium tracking-wide text-ink-700">{job.plate}</span>
                    {job.brand ? ` · ${job.brand}` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {new Date(job.created_at).toLocaleString(i18n.language)}
                  </p>
                </div>

                {/*
                  The edit window is shown as time remaining, not as a binary.
                  A worker who sees "3 min left to edit" walks over; one who
                  sees only "Locked" has already lost the option they came for.
                */}
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {editable ? (
                    <Badge tone="ok" icon="clock">
                      {remaining <= 1 ? t('myJobs.editableSoon') : t('myJobs.editableFor', { minutes: remaining })}
                    </Badge>
                  ) : (
                    <Badge tone="neutral" icon="lock">
                      {t('myJobs.locked')}
                    </Badge>
                  )}
                  {editable && !isEditing && (
                    <Button variant="secondary" icon="pencil" onClick={() => startEdit(job)}>
                      {t('newJob.edit')}
                    </Button>
                  )}
                </div>
              </div>

              {!editable && <p className="mt-2 text-xs text-ink-600">{t('myJobs.lockedHint')}</p>}

              {isEditing && editDraft && (
                <div className="mt-4 space-y-4 border-t border-line pt-4">
                  <ServiceChips
                    services={services}
                    selected={editDraft.serviceId}
                    onSelect={(id) => setEditDraft((d) => (d ? { ...d, serviceId: id } : d))}
                    label={t('newJob.service')}
                  />
                  <textarea
                    value={editDraft.note}
                    onChange={(e) => setEditDraft((d) => (d ? { ...d, note: e.target.value } : d))}
                    rows={2}
                    className="w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-base text-ink-900 focus:border-ink-900"
                    placeholder={t('newJob.note')}
                  />
                  <div className="flex gap-2">
                    <Button busy={saving} icon="check" className="flex-1" onClick={() => void saveEdit(job.id)}>
                      {t('jobDetail.save')}
                    </Button>
                    <Button variant="secondary" className="flex-1" onClick={() => setEditingId(null)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </Page>
  );
}
