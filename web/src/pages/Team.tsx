import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { AppUser } from '../lib/types';

/**
 * Manager view of their site's team. Managers can only activate/deactivate
 * worker-role users at their own site — enforced by the set_user_active
 * security definer function (migration 0004), not just by this UI.
 */
export default function Team() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);

  useEffect(() => {
    if (!appUser?.site_id) return;
    void load(appUser.site_id);
  }, [appUser]);

  async function load(siteId: string) {
    const { data } = await supabase.from('users').select('*').eq('site_id', siteId).order('name');
    setUsers(data ?? []);
  }

  async function toggleActive(user: AppUser) {
    await supabase.rpc('set_user_active', { p_user_id: user.id, p_active: !user.active });
    if (appUser?.site_id) void load(appUser.site_id);
  }

  return (
    <div className="mx-auto max-w-md space-y-3 p-4">
      <h1 className="text-xl font-bold text-slate-900">{t('team.title')}</h1>

      {users.map((u) => {
        const canToggle = u.role === 'worker' && u.id !== appUser?.id;
        return (
          <div key={u.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
            <div>
              <p className="font-medium text-slate-900">{u.name}</p>
              <p className="text-xs text-slate-500">{u.role}</p>
            </div>
            <button
              onClick={() => canToggle && void toggleActive(u)}
              disabled={!canToggle}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                u.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
              } ${canToggle ? '' : 'opacity-50'}`}
            >
              {u.active ? t('admin.active') : t('admin.inactive')}
            </button>
          </div>
        );
      })}
    </div>
  );
}
