import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { inviteUser } from '../../lib/workerApi';
import type { AppUser, Site, UserRole } from '../../lib/types';
import AdminTabs from '../../components/AdminTabs';
import StatusBanner from '../../components/StatusBanner';

export default function AdminUsers() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [sites, setSites] = useState<Site[]>([]);

  // Invite form
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('worker');
  const [siteId, setSiteId] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteSent, setInviteSent] = useState(false);
  const [saving, setSaving] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; role: UserRole; site_id: string }>({
    name: '',
    role: 'worker',
    site_id: '',
  });

  useEffect(() => {
    void load();
    supabase.from('sites').select('*').order('name').then(({ data }) => setSites(data ?? []));
  }, []);

  async function load() {
    const { data } = await supabase.from('users').select('*').order('name');
    setUsers(data ?? []);
  }

  async function handleInvite() {
    setInviteError('');
    setInviteSent(false);
    if (!email || !name || !siteId) {
      setInviteError(t('admin.inviteMissingFields'));
      return;
    }
    setSaving(true);
    const result = await inviteUser({ email, name, role, siteId });
    setSaving(false);
    if (!result.ok) {
      setInviteError(result.error);
      return;
    }
    setInviteSent(true);
    setEmail('');
    setName('');
    void load();
  }

  function startEdit(user: AppUser) {
    setEditingId(user.id);
    setEditDraft({ name: user.name, role: user.role, site_id: user.site_id ?? '' });
  }

  async function saveEdit(userId: string) {
    setSaving(true);
    await supabase
      .from('users')
      .update({ name: editDraft.name.trim(), role: editDraft.role, site_id: editDraft.site_id || null })
      .eq('id', userId);
    setSaving(false);
    setEditingId(null);
    void load();
  }

  async function toggleActive(user: AppUser) {
    await supabase.rpc('set_user_active', { p_user_id: user.id, p_active: !user.active });
    void load();
  }

  const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 lg:max-w-2xl">
      <AdminTabs active="users" />

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('admin.inviteTitle')}</p>
        <input placeholder={t('auth.email') ?? ''} value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        <input placeholder={t('admin.name') ?? ''} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
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
        {inviteError && <StatusBanner tone="error">{inviteError}</StatusBanner>}
        {inviteSent && <StatusBanner tone="success">{t('admin.inviteSent')}</StatusBanner>}
        <button onClick={() => void handleInvite()} disabled={saving} className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white disabled:opacity-60">
          {t('admin.sendInvite')}
        </button>
      </div>

      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">{u.name}</p>
                <p className="text-xs text-slate-500">
                  {u.role} · {sites.find((s) => s.id === u.site_id)?.name ?? '—'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {editingId !== u.id && (
                  <button className="text-sm font-medium text-brand-700" onClick={() => startEdit(u)}>
                    {t('newJob.edit')}
                  </button>
                )}
                <button
                  onClick={() => void toggleActive(u)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${u.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}
                >
                  {u.active ? t('admin.active') : t('admin.inactive')}
                </button>
              </div>
            </div>

            {editingId === u.id && (
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                <input value={editDraft.name} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} className={inputClass} />
                <div className="flex gap-2">
                  <select
                    value={editDraft.role}
                    onChange={(e) => setEditDraft((d) => ({ ...d, role: e.target.value as UserRole }))}
                    className="flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  >
                    <option value="worker">worker</option>
                    <option value="manager">manager</option>
                    <option value="admin">admin</option>
                  </select>
                  <select
                    value={editDraft.site_id}
                    onChange={(e) => setEditDraft((d) => ({ ...d, site_id: e.target.value }))}
                    className="flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  >
                    <option value="">{t('admin.site')}</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => void saveEdit(u.id)}
                    disabled={saving}
                    className="flex-1 rounded-lg bg-brand-600 py-2 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {t('admin.save')}
                  </button>
                  <button onClick={() => setEditingId(null)} className="flex-1 rounded-lg border border-slate-300 py-2 text-sm">
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
