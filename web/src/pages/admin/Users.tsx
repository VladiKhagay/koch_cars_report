import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { inviteUser } from '../../lib/workerApi';
import type { AppUser, Site, UserRole } from '../../lib/types';
import AdminTabs from '../../components/AdminTabs';
import StatusBanner from '../../components/StatusBanner';
import {
  CellMuted,
  CellTitle,
  Table,
  TableCard,
  TBody,
  Td,
  TdActions,
  Th,
  THead,
  Tr,
  TrExpanded,
} from '../../components/DataTable';
import {
  Badge,
  Button,
  Card,
  ConfirmPanel,
  EmptyState,
  Field,
  IconButton,
  LoadingRegion,
  Page,
  PageHeading,
  SearchField,
  SectionHeading,
  Select,
  fieldClass,
} from '../../components/ui';

const ROLES: UserRole[] = ['worker', 'manager', 'admin'];

/** Name, role, site, status, actions. */
const COLUMNS = 5;

type Expanded = { id: string; mode: 'edit' | 'toggle' } | null;

export default function AdminUsers() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Invite form
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('worker');
  const [siteId, setSiteId] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteSent, setInviteSent] = useState(false);
  const [saving, setSaving] = useState(false);

  // Inline edit
  const [expanded, setExpanded] = useState<Expanded>(null);
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
    setLoading(true);
    const { data } = await supabase.from('users').select('*').order('name');
    setUsers(data ?? []);
    setLoading(false);
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
    setExpanded({ id: user.id, mode: 'edit' });
    setEditDraft({ name: user.name, role: user.role, site_id: user.site_id ?? '' });
  }

  async function saveEdit(userId: string) {
    setSaving(true);
    await supabase
      .from('users')
      .update({ name: editDraft.name.trim(), role: editDraft.role, site_id: editDraft.site_id || null })
      .eq('id', userId);
    setSaving(false);
    setExpanded(null);
    void load();
  }

  async function toggleActive(user: AppUser) {
    await supabase.rpc('set_user_active', { p_user_id: user.id, p_active: !user.active });
    setExpanded(null);
    void load();
  }

  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name ?? t('profile.noSite');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    const nameOf = (id: string | null) => sites.find((s) => s.id === id)?.name ?? '';
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || nameOf(u.site_id).toLowerCase().includes(q),
    );
  }, [users, search, sites]);

  return (
    <Page width="wide" className="space-y-5">
      <AdminTabs active="users" />

      <PageHeading
        action={
          <Button
            icon={inviting ? 'x' : 'plus'}
            variant={inviting ? 'secondary' : 'primary'}
            onClick={() => setInviting((v) => !v)}
          >
            {inviting ? t('common.cancel') : t('admin.inviteTitle')}
          </Button>
        }
      >
        {t('admin.users')}
      </PageHeading>

      {inviting && (
        <Card className="p-5">
          <SectionHeading icon="plus">{t('admin.inviteTitle')}</SectionHeading>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field htmlFor="invite-email" label={t('auth.email')}>
                <input
                  id="invite-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setInviteSent(false);
                  }}
                  className={fieldClass}
                />
              </Field>

              <Field htmlFor="invite-name" label={t('admin.name')}>
                <input
                  id="invite-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setInviteSent(false);
                  }}
                  className={fieldClass}
                />
              </Field>

              <Field htmlFor="invite-role" label={t('admin.role')}>
                <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field htmlFor="invite-site" label={t('admin.site')}>
                <Select id="invite-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                  <option value="">{t('admin.site')}</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {inviteError && (
              <StatusBanner tone="error" live>
                {inviteError}
              </StatusBanner>
            )}
            {inviteSent && (
              <StatusBanner tone="success" live>
                {t('admin.inviteSent')}
              </StatusBanner>
            )}

            <Button icon="plus" busy={saving} onClick={() => void handleInvite()}>
              {t('admin.sendInvite')}
            </Button>
          </div>
        </Card>
      )}

      {loading && <LoadingRegion label={t('common.loading')} rows={4} />}

      {!loading && users.length === 0 && (
        <EmptyState icon="users" title={t('admin.usersEmptyTitle')} body={t('admin.usersEmptyBody')} />
      )}

      {!loading && users.length > 0 && (
        <TableCard toolbar={<SearchField value={search} onChange={setSearch} label={t('admin.searchUsers')} />}>
          <Table minWidth={48}>
            <THead>
              <tr>
                <Th>{t('admin.name')}</Th>
                <Th hideBelow="sm">{t('admin.role')}</Th>
                <Th hideBelow="md">{t('admin.site')}</Th>
                <Th hideBelow="sm">{t('admin.status')}</Th>
                <Th />
              </tr>
            </THead>
            <TBody>
              {filtered.map((u) => {
                const open = expanded?.id === u.id ? expanded : null;
                /* A row and its expanded panel are two <tr>s that belong
                   together — a Fragment keys them as one unit without wrapping
                   them in an element <tbody> would reject. */
                return (
                  <Fragment key={u.id}>
                  <Tr active={Boolean(open)}>
                    <Td>
                      <CellTitle>{u.name}</CellTitle>
                      {/* The two columns that vanish on a phone reappear here,
                          so a narrow screen loses layout, not information. */}
                      <p className="text-xs text-ink-600 sm:hidden">
                        {t(`roles.${u.role}`)} · {siteName(u.site_id)}
                      </p>
                    </Td>
                    <Td hideBelow="sm">
                      <CellMuted>{t(`roles.${u.role}`)}</CellMuted>
                    </Td>
                    <Td hideBelow="md">
                      <CellMuted>{siteName(u.site_id)}</CellMuted>
                    </Td>
                    <Td hideBelow="sm">
                      {/* State is reported, never actioned, by this element. */}
                      <Badge tone={u.active ? 'ok' : 'neutral'} icon={u.active ? 'checkCircle' : 'lock'}>
                        {u.active ? t('admin.active') : t('admin.inactive')}
                      </Badge>
                    </Td>
                    <TdActions>
                      <IconButton
                        icon={u.active ? 'lock' : 'check'}
                        label={u.active ? t('team.deactivate') : t('team.activate')}
                        onClick={() => setExpanded({ id: u.id, mode: 'toggle' })}
                      />
                      <IconButton icon="pencil" label={t('newJob.edit')} onClick={() => startEdit(u)} />
                    </TdActions>
                  </Tr>

                  {open?.mode === 'toggle' && (
                    <TrExpanded colSpan={COLUMNS}>
                      <ConfirmPanel
                        variant={u.active ? 'danger' : 'secondary'}
                        icon={u.active ? 'lock' : 'check'}
                        question={t(u.active ? 'team.deactivateConfirm' : 'team.activateConfirm', { name: u.name })}
                        confirmLabel={u.active ? t('team.deactivate') : t('team.activate')}
                        onConfirm={() => void toggleActive(u)}
                        onCancel={() => setExpanded(null)}
                      />
                    </TrExpanded>
                  )}

                  {open?.mode === 'edit' && (
                    <TrExpanded colSpan={COLUMNS}>
                      <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-3">
                          <Field htmlFor={`edit-name-${u.id}`} label={t('admin.name')}>
                            <input
                              id={`edit-name-${u.id}`}
                              value={editDraft.name}
                              onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                              className={fieldClass}
                            />
                          </Field>

                          <Field htmlFor={`edit-role-${u.id}`} label={t('admin.role')}>
                            <Select
                              id={`edit-role-${u.id}`}
                              value={editDraft.role}
                              onChange={(e) => setEditDraft((d) => ({ ...d, role: e.target.value as UserRole }))}
                            >
                              {ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {t(`roles.${r}`)}
                                </option>
                              ))}
                            </Select>
                          </Field>

                          <Field htmlFor={`edit-site-${u.id}`} label={t('admin.site')}>
                            <Select
                              id={`edit-site-${u.id}`}
                              value={editDraft.site_id}
                              onChange={(e) => setEditDraft((d) => ({ ...d, site_id: e.target.value }))}
                            >
                              <option value="">{t('admin.site')}</option>
                              {sites.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button icon="check" busy={saving} onClick={() => void saveEdit(u.id)}>
                            {t('admin.save')}
                          </Button>
                          <Button variant="secondary" onClick={() => setExpanded(null)}>
                            {t('common.cancel')}
                          </Button>
                        </div>
                      </div>
                    </TrExpanded>
                  )}
                  </Fragment>
                );
              })}
            </TBody>
          </Table>
        </TableCard>
      )}

      {!loading && users.length > 0 && filtered.length === 0 && (
        <EmptyState icon="search" title={t('admin.noMatches')} />
      )}
    </Page>
  );
}
