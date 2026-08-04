import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import type { AppUser, Site, UserRole } from '../../lib/types';
import AdminTabs from '../../components/AdminTabs';

export default function AdminUsers() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('worker');
  const [siteId, setSiteId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
    supabase.from('sites').select('*').order('name').then(({ data }) => setSites(data ?? []));
  }, []);

  async function load() {
    const { data } = await supabase.from('users').select('*').order('name');
    setUsers(data ?? []);
  }

  async function handleAdd() {
    setError('');
    if (!email || !name || !siteId) {
      setError('Fill in email, name, and site.');
      return;
    }
    setSaving(true);
    const { data: authId, error: lookupError } = await supabase.rpc('admin_lookup_auth_id', { p_email: email });
    if (lookupError || !authId) {
      setError('No account found for that email — invite them in Supabase Studio > Authentication first.');
      setSaving(false);
      return;
    }
    const { error: insertError } = await supabase.from('users').insert({ auth_id: authId, name, role, site_id: siteId });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setEmail('');
    setName('');
    void load();
  }

  async function toggleActive(user: AppUser) {
    await supabase.from('users').update({ active: !user.active }).eq('id', user.id);
    void load();
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <AdminTabs active="users" />

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <input placeholder="Email (must already have an account)" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <input placeholder={t('admin.name') ?? ''} value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <div className="flex gap-2">
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm">
            <option value="worker">worker</option>
            <option value="manager">manager</option>
            <option value="admin">admin</option>
          </select>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm">
            <option value="">{t('admin.site')}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button onClick={() => void handleAdd()} disabled={saving} className="w-full rounded-lg bg-brand-600 py-2 text-sm font-medium text-white disabled:opacity-60">
          {t('admin.add')}
        </button>
      </div>

      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
            <div>
              <p className="font-medium text-slate-900">{u.name}</p>
              <p className="text-xs text-slate-500">
                {u.role} · {sites.find((s) => s.id === u.site_id)?.name ?? '—'}
              </p>
            </div>
            <button
              onClick={() => void toggleActive(u)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${u.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}
            >
              {u.active ? t('admin.active') : 'inactive'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
