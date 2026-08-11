import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { Service } from '../lib/types';
import AdminTabs from '../components/AdminTabs';
import StatusBanner from '../components/StatusBanner';

/**
 * Service catalog management, shared by managers and admins (RLS allows
 * both to insert/update; hard DELETE isn't granted to anyone — "delete"
 * sets deleted_at, so historical jobs keep their service references).
 */
export default function Services() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [catalogNumber, setCatalogNumber] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameRu, setNameRu] = useState('');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ catalog_number: '', name_en: '', name_ru: '' });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const { data } = await supabase.from('services').select('*').is('deleted_at', null).order('sort_order');
    setServices(data ?? []);
  }

  async function handleAdd() {
    setError('');
    if (!catalogNumber || !nameEn) {
      setError(t('services.missingFields'));
      return;
    }
    const maxSort = services.reduce((m, s) => Math.max(m, s.sort_order), 0);
    const { error: insertError } = await supabase
      .from('services')
      .insert({ catalog_number: catalogNumber, name_en: nameEn, name_ru: nameRu || null, sort_order: maxSort + 1 });
    if (insertError) {
      setError(insertError.code === '23505' ? t('services.duplicateCatalog') : insertError.message);
      return;
    }
    setCatalogNumber('');
    setNameEn('');
    setNameRu('');
    void load();
  }

  function startEdit(service: Service) {
    setEditingId(service.id);
    setEditDraft({
      catalog_number: service.catalog_number,
      name_en: service.name_en,
      name_ru: service.name_ru ?? '',
    });
  }

  async function saveEdit(serviceId: string) {
    setError('');
    const { error: updateError } = await supabase
      .from('services')
      .update({
        catalog_number: editDraft.catalog_number.trim(),
        name_en: editDraft.name_en.trim(),
        name_ru: editDraft.name_ru.trim() || null,
      })
      .eq('id', serviceId);
    if (updateError) {
      setError(updateError.code === '23505' ? t('services.duplicateCatalog') : updateError.message);
      return;
    }
    setEditingId(null);
    void load();
  }

  async function softDelete(serviceId: string) {
    await supabase
      .from('services')
      .update({ deleted_at: new Date().toISOString(), active: false })
      .eq('id', serviceId);
    setConfirmDeleteId(null);
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

  const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 lg:max-w-2xl">
      {appUser?.role === 'admin' ? (
        <AdminTabs active="services" />
      ) : (
        <h1 className="text-xl font-bold text-slate-900">{t('admin.services')}</h1>
      )}

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <input placeholder={t('services.catalogPlaceholder') ?? ''} value={catalogNumber} onChange={(e) => setCatalogNumber(e.target.value)} className={inputClass} />
        <input placeholder="Name (English)" value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={inputClass} />
        <input placeholder="Name (Russian, optional)" value={nameRu} onChange={(e) => setNameRu(e.target.value)} className={inputClass} />
        {error && <StatusBanner tone="error">{error}</StatusBanner>}
        <button onClick={() => void handleAdd()} className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white">
          {t('admin.add')}
        </button>
      </div>

      <div className="space-y-2">
        {services.map((s, i) => (
          <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">
                  <span className="font-mono text-xs text-slate-400">{s.catalog_number}</span> {s.name_en}
                </p>
                {s.name_ru && <p className="truncate text-xs text-slate-500">{s.name_ru}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => void move(s, -1)} disabled={i === 0} className="px-1 text-slate-400 disabled:opacity-30">
                  ↑
                </button>
                <button onClick={() => void move(s, 1)} disabled={i === services.length - 1} className="px-1 text-slate-400 disabled:opacity-30">
                  ↓
                </button>
                <button
                  onClick={() => void toggleActive(s)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${s.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}
                >
                  {s.active ? t('admin.active') : t('admin.inactive')}
                </button>
                {editingId !== s.id && (
                  <button className="text-sm font-medium text-brand-700" onClick={() => startEdit(s)}>
                    {t('newJob.edit')}
                  </button>
                )}
              </div>
            </div>

            {editingId === s.id && (
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                <input value={editDraft.catalog_number} onChange={(e) => setEditDraft((d) => ({ ...d, catalog_number: e.target.value }))} className={inputClass} />
                <input value={editDraft.name_en} onChange={(e) => setEditDraft((d) => ({ ...d, name_en: e.target.value }))} className={inputClass} />
                <input value={editDraft.name_ru} onChange={(e) => setEditDraft((d) => ({ ...d, name_ru: e.target.value }))} className={inputClass} placeholder="Name (Russian, optional)" />
                <div className="flex gap-2">
                  <button onClick={() => void saveEdit(s.id)} className="flex-1 rounded-lg bg-brand-600 py-2 text-sm font-medium text-white">
                    {t('admin.save')}
                  </button>
                  <button onClick={() => setEditingId(null)} className="flex-1 rounded-lg border border-slate-300 py-2 text-sm">
                    {t('common.cancel')}
                  </button>
                </div>
                {confirmDeleteId === s.id ? (
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-xs text-red-700">{t('services.deleteConfirm')}</span>
                    <button onClick={() => void softDelete(s.id)} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white">
                      {t('jobDetail.delete')}
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                      {t('common.cancel')}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDeleteId(s.id)} className="w-full rounded-lg border border-red-200 py-2 text-sm text-red-600">
                    {t('jobDetail.delete')}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
