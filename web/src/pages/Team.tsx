import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { AppUser } from '../lib/types';
import { Badge, Card, ConfirmAction, EmptyState, LoadingRegion, Page, PageHeading } from '../components/ui';

/**
 * Manager view of their site's team. Managers can only activate/deactivate
 * worker-role users at their own site — enforced by the set_user_active
 * security definer function (migration 0004), not just by this UI.
 */
export default function Team() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!appUser?.site_id) return;
    void load(appUser.site_id);
  }, [appUser]);

  async function load(siteId: string) {
    setLoading(true);
    const { data } = await supabase.from('users').select('*').eq('site_id', siteId).order('name');
    setUsers(data ?? []);
    setLoading(false);
  }

  async function toggleActive(user: AppUser) {
    await supabase.rpc('set_user_active', { p_user_id: user.id, p_active: !user.active });
    if (appUser?.site_id) void load(appUser.site_id);
  }

  return (
    <Page width="form" className="space-y-5">
      {/* The scope rule is stated once at the top rather than repeated as a
          disabled-control tooltip on every row it doesn't apply to. */}
      <PageHeading lead={t('team.cannotChange')}>{t('team.title')}</PageHeading>

      {loading && <LoadingRegion label={t('common.loading')} rows={4} />}

      {!loading && users.length === 0 && (
        <EmptyState icon="users" title={t('team.emptyTitle')} body={t('team.emptyBody')} />
      )}

      <div className="space-y-2">
        {users.map((u) => {
          const canToggle = u.role === 'worker' && u.id !== appUser?.id;
          return (
            <Card key={u.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="break-words text-base font-semibold tracking-tight text-ink-900">{u.name}</p>
                  <p className="mt-0.5 text-sm text-ink-600">{t(`roles.${u.role}`)}</p>
                </div>

                {/*
                  Read-only state. This row previously used one element as both
                  the "Active" label and the deactivate control, so a manager
                  reading the roster could lock a worker out mid-shift by
                  tapping what looked like a badge.
                */}
                <Badge tone={u.active ? 'ok' : 'neutral'} icon={u.active ? 'checkCircle' : 'lock'}>
                  {u.active ? t('admin.active') : t('admin.inactive')}
                </Badge>
              </div>

              {canToggle && (
                <div className="mt-4">
                  {u.active ? (
                    <ConfirmAction
                      variant="danger"
                      icon="lock"
                      trigger={t('team.deactivate')}
                      question={t('team.deactivateConfirm', { name: u.name })}
                      confirmLabel={t('team.deactivate')}
                      onConfirm={() => void toggleActive(u)}
                    />
                  ) : (
                    <ConfirmAction
                      variant="secondary"
                      icon="check"
                      trigger={t('team.activate')}
                      question={t('team.activateConfirm', { name: u.name })}
                      confirmLabel={t('team.activate')}
                      onConfirm={() => void toggleActive(u)}
                    />
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </Page>
  );
}
