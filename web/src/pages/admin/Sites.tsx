import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import type { Site } from '../../lib/types';
import AdminTabs from '../../components/AdminTabs';

export default function AdminSites() {
  const { t } = useTranslation();
  const [sites, setSites] = useState<Site[]>([]);
  const [name, setName] = useState('');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const { data } = await supabase.from('sites').select('*').order('name');
    setSites(data ?? []);
  }

  async function handleAdd() {
    if (!name) return;
    await supabase.from('sites').insert({ name });
    setName('');
    void load();
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <AdminTabs active="sites" />

      <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <input placeholder={t('admin.name') ?? ''} value={name} onChange={(e) => setName(e.target.value)} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button onClick={() => void handleAdd()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
          {t('admin.add')}
        </button>
      </div>

      <div className="space-y-2">
        {sites.map((s) => (
          <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="font-medium text-slate-900">{s.name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
