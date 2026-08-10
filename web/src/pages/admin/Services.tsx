import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import type { Service } from '../../lib/types';
import AdminTabs from '../../components/AdminTabs';

export default function AdminServices() {
  const { t } = useTranslation();
  const [services, setServices] = useState<Service[]>([]);
  const [catalogNumber, setCatalogNumber] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameRu, setNameRu] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const { data } = await supabase.from('services').select('*').order('sort_order');
    setServices(data ?? []);
  }

  async function handleAdd() {
    setError('');
    if (!catalogNumber || !nameEn) {
      setError('Catalog number and name are required.');
      return;
    }
    const maxSort = services.reduce((m, s) => Math.max(m, s.sort_order), 0);
    const { error: insertError } = await supabase
      .from('services')
      .insert({ catalog_number: catalogNumber, name_en: nameEn, name_ru: nameRu || null, sort_order: maxSort + 1 });
    if (insertError) {
      setError(insertError.code === '23505' ? 'That catalog number is already in use.' : insertError.message);
      return;
    }
    setCatalogNumber('');
    setNameEn('');
    setNameRu('');
    void load();
  }

  async function toggleActive(service: Service) {
    await supabase.from('services').update({ active: !service.active }).eq('id', service.id);
    void load();
  }

  async function move(service: Service, direction: -1 | 1) {
    const idx = services.findIndex((s) => s.id === service.id);
    const swapWith = services[idx + direction];
    if (!swapWith) return;
    await supabase.from('services').update({ sort_order: swapWith.sort_order }).eq('id', service.id);
    await supabase.from('services').update({ sort_order: service.sort_order }).eq('id', swapWith.id);
    void load();
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 lg:max-w-2xl">
      <AdminTabs active="services" />

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <input
          placeholder="Catalog number (e.g. SVC-006)"
          value={catalogNumber}
          onChange={(e) => setCatalogNumber(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input placeholder="Name (English)" value={nameEn} onChange={(e) => setNameEn(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input placeholder="Name (Russian, optional)" value={nameRu} onChange={(e) => setNameRu(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button onClick={() => void handleAdd()} className="w-full rounded-lg bg-brand-600 py-2 text-sm font-medium text-white">
          {t('admin.add')}
        </button>
      </div>

      <div className="space-y-2">
        {services.map((s, i) => (
          <div key={s.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
            <div>
              <p className="font-medium text-slate-900">
                <span className="font-mono text-xs text-slate-400">{s.catalog_number}</span> {s.name_en}
              </p>
              {s.name_ru && <p className="text-xs text-slate-500">{s.name_ru}</p>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => void move(s, -1)} disabled={i === 0} className="text-slate-400 disabled:opacity-30">
                ↑
              </button>
              <button onClick={() => void move(s, 1)} disabled={i === services.length - 1} className="text-slate-400 disabled:opacity-30">
                ↓
              </button>
              <button
                onClick={() => void toggleActive(s)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${s.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}
              >
                {s.active ? t('admin.active') : 'inactive'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
