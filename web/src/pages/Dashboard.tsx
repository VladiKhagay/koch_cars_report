import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { Job, Site } from '../lib/types';

interface JobRow extends Job {
  worker_name?: string;
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!appUser) return;
    if (appUser.role === 'admin') {
      supabase.from('sites').select('*').order('name').then(({ data }) => {
        setSites(data ?? []);
        setSiteId((data ?? [])[0]?.id ?? null);
      });
    } else {
      setSiteId(appUser.site_id);
    }
  }, [appUser]);

  useEffect(() => {
    if (!siteId) return;
    void load(siteId);
  }, [siteId]);

  async function load(site: string) {
    setLoading(true);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { data } = await supabase
      .from('jobs')
      .select('*, worker:users!jobs_worker_id_fkey(name)')
      .eq('site_id', site)
      .is('deleted_at', null)
      .gte('created_at', startOfDay.toISOString())
      .order('created_at', { ascending: false });

    setJobs((data ?? []).map((j: any) => ({ ...j, worker_name: j.worker?.name })));
    setLoading(false);
  }

  const duplicateCount = jobs.filter((j) => j.duplicate_of_job_id).length;
  const missingBillingCount = jobs.filter((j) => !j.billing_code).length;

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return jobs;
    return jobs.filter(
      (j) => j.plate.includes(q) || j.vin.includes(q) || (j.worker_name ?? '').toUpperCase().includes(q),
    );
  }, [jobs, search]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">{t('dashboard.title')}</h1>
        {appUser?.role === 'admin' && sites.length > 0 && (
          <select
            value={siteId ?? ''}
            onChange={(e) => setSiteId(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {(duplicateCount > 0 || missingBillingCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {duplicateCount > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
              {t('dashboard.duplicates', { count: duplicateCount })}
            </span>
          )}
          {missingBillingCount > 0 && (
            <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
              {t('dashboard.missingBilling', { count: missingBillingCount })}
            </span>
          )}
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('dashboard.search') ?? ''}
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
      />

      {loading && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {!loading && filtered.length === 0 && <p className="text-sm text-slate-500">{t('dashboard.noResults')}</p>}

      <div className="space-y-2">
        {filtered.map((job) => (
          <Link
            key={job.id}
            to={`/jobs/${job.id}`}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3"
          >
            <div>
              <p className="font-medium text-slate-900">
                {job.plate} <span className="font-normal text-slate-400">· {job.brand ?? '—'}</span>
              </p>
              <p className="text-xs text-slate-500">{job.vin}</p>
              <p className="text-xs text-slate-400">
                {job.worker_name ?? '—'} · {new Date(job.created_at).toLocaleTimeString()}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {job.duplicate_of_job_id && <span className="text-xs text-amber-700">⚠</span>}
              {!job.billing_code && <span className="text-xs text-slate-400">no code</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
