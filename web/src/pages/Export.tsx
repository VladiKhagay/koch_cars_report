import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { Site } from '../lib/types';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function Export() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);

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

  async function handleExport() {
    if (!siteId) return;
    setBusy(true);
    setEmpty(false);

    const fromIso = new Date(`${from}T00:00:00`).toISOString();
    const toIso = new Date(`${to}T23:59:59`).toISOString();

    const { data: jobs } = await supabase
      .from('jobs')
      .select('*, worker:users!jobs_worker_id_fkey(name)')
      .eq('site_id', siteId)
      .is('deleted_at', null)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: true });

    if (!jobs || jobs.length === 0) {
      setEmpty(true);
      setBusy(false);
      return;
    }

    const { data: links } = await supabase
      .from('job_services')
      .select('job_id, service:services(name_en)')
      .in('job_id', jobs.map((j) => j.id));

    const servicesByJob = new Map<string, string[]>();
    (links ?? []).forEach((l: any) => {
      const list = servicesByJob.get(l.job_id) ?? [];
      if (l.service?.name_en) list.push(l.service.name_en);
      servicesByJob.set(l.job_id, list);
    });

    const rows = jobs.map((j: any) => ({
      Date: new Date(j.created_at).toLocaleDateString(),
      'Vehicle registration number': j.plate,
      'Vehicle brand': j.brand ?? '',
      'Employee name': j.worker?.name ?? '',
      'Work performed': [...(servicesByJob.get(j.id) ?? []), j.worker_note].filter(Boolean).join('; '),
      Notes: j.manager_note ?? '',
      'Customer billing code': j.billing_code ?? '',
    }));

    // Loaded on demand — this is the only screen that needs it, and it's a
    // sizeable library not worth shipping to every worker on a mobile connection.
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Jobs');
    const siteName = sites.find((s) => s.id === siteId)?.name ?? 'site';
    XLSX.writeFile(workbook, `${siteName}-${from}-to-${to}.xlsx`);
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('export.title')}</h1>

      {appUser?.role === 'admin' && sites.length > 0 && (
        <select
          value={siteId ?? ''}
          onChange={(e) => setSiteId(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
        >
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium text-slate-700">{t('export.from')}</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5" />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium text-slate-700">{t('export.to')}</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5" />
        </div>
      </div>

      {empty && <p className="text-sm text-slate-500">{t('export.empty')}</p>}

      <button
        onClick={() => void handleExport()}
        disabled={busy || !siteId}
        className="w-full rounded-lg bg-brand-600 py-3 font-medium text-white disabled:opacity-60"
      >
        {t('export.download')}
      </button>
    </div>
  );
}
