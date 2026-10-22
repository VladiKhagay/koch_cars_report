import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { inviteUser, setUserActive } from '../../lib/workerApi';
import { saveUserSites } from '../../lib/carasso';
import type { AppUser, Site, UserRole } from '../../lib/types';
import AdminTabs from '../../components/AdminTabs';
import StatusBanner from '../../components/StatusBanner';
import SiteChecklist from '../../components/SiteChecklist';
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

const ROLES: UserRole[] = ['worker', 'manager', 'admin', 'carasso'];

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
  /** Carasso only: the sites they may see. */
  const [inviteSiteIds, setInviteSiteIds] = useState<string[]>([]);
  /** user id -> Carasso site ids, for the table and the edit form. */
  const [carassoSites, setCarassoSites] = useState<Map<string, string[]>>(new Map());
  const [inviteError, setInviteError] = useState('');
  const [inviteSent, setInviteSent] = useState(false);
  /** Errors from row actions, shown by the table rather than by the invite form. */
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState(false);

  // Inline edit
  const [expanded, setExpanded] = useState<Expanded>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; role: UserRole; site_id: string; site_ids: string[] }>({
    name: '',
    role: 'worker',
    site_id: '',
    site_ids: [],
  });

  useEffect(() => {
    void load();
    supabase.from('sites').select('*').order('name').then(({ data }) => setSites(data ?? []));
  }, []);

  async function load() {
    setLoading(true);
    const [{ data }, { data: links }] = await Promise.all([
      supabase.from('users').select('*').order('name'),
      supabase.from('user_sites').select('user_id, site_id'),
    ]);
    setUsers(data ?? []);
    const byUser = new Map<string, string[]>();
    for (const l of links ?? []) byUser.set(l.user_id, [...(byUser.get(l.user_id) ?? []), l.site_id]);
    setCarassoSites(byUser);
    setLoading(false);
  }

  async function handleInvite() {
    setInviteError('');
    setInviteSent(false);
    const carasso = role === 'carasso';
    if (!email || !name || (carasso ? inviteSiteIds.length === 0 : !siteId)) {
      setInviteError(carasso ? t('admin.inviteMissingSites') : t('admin.inviteMissingFields'));
      return;
    }
    setSaving(true);
    // Carasso has no home site: it is scoped by the sites list alone.
    const result = await inviteUser(carasso ? { email, name, role, siteIds: inviteSiteIds } : { email, name, role, siteId });
    setSaving(false);
    if (!result.ok) {
      setInviteError(result.error);
      return;
    }
    setInviteSent(true);
    setEmail('');
    setName('');
    setInviteSiteIds([]);
    void load();
  }

  function startEdit(user: AppUser) {
    setExpanded({ id: user.id, mode: 'edit' });
    setEditDraft({
      name: user.name,
      role: user.role,
      site_id: user.site_id ?? '',
      site_ids: carassoSites.get(user.id) ?? [],
    });
  }

  async function saveEdit(userId: string) {
    setActionError('');
    const carasso = editDraft.role === 'carasso';
    if (carasso && editDraft.site_ids.length === 0) {
      setActionError(t('admin.inviteMissingSites'));
      return;
    }
    setSaving(true);
    // A Carasso user has no home site (the database insists); their sites live in user_sites.
    const { error } = await supabase
      .from('users')
      .update({ name: editDraft.name.trim(), role: editDraft.role, site_id: carasso ? null : editDraft.site_id || null })
      .eq('id', userId);
    const sitesResult = !error && carasso ? await saveUserSites(userId, editDraft.site_ids) : { error: null };
    setSaving(false);
    if (error || sitesResult.error) {
      setActionError(
        error
          ? error.message
          : `${sitesResult.error} — ${t('admin.sitesNotSaved')}`,
      );
      return;
    }
    setExpanded(null);
    void load();
  }

  async function toggleActive(user: AppUser) {
    // Through the Worker, not the RPC directly: deactivating must also revoke
    // the Supabase auth account, or the user keeps a self-renewing token.
    setActionError('');
    const result = await setUserActive(user.id, !user.active);
    if (!result.ok) setActionError(result.error);
    // The profile change can land while the auth account survives — the person
    // is locked out of the data but can still sign in. Silence would read as
    // full success on the one action where that gap is the whole point.
    else if (!result.sessionRevoked) setActionError(t('admin.sessionNotRevoked'));
    setExpanded(null);
    void load();
  }

  const siteName = useCallback(
    (id: string | null) => sites.find((s) => s.id === id)?.name ?? t('profile.noSite'),
    [sites, t],
  );
  /** A Carasso user's sites, joined; everyone else's single home site. */
  const userSites = useCallback(
    (u: AppUser) =>
      u.role === 'carasso'
        ? (carassoSites.get(u.id) ?? []).map((id) => siteName(id)).join(', ') || t('profile.noSite')
        : siteName(u.site_id),
    [carassoSites, siteName, t],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.name.toLowerCase().includes(q) || userSites(u).toLowerCase().includes(q));
  }, [users, search, userSites]);

  return (
    <Page width="wide">
      {/* The tab strip labels the heading under it. */}
      <div className="space-y-2">
        <AdminTabs active="users" />
      </div>

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
        <Card>
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

              {role === 'carasso' ? (
                <div className="sm:col-span-2">
                  <SiteChecklist
                    label={t('admin.carassoSites')}
                    sites={sites}
                    value={inviteSiteIds}
                    onChange={setInviteSiteIds}
                  />
                </div>
              ) : (
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
              )}
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

      {actionError && (
        <StatusBanner tone="error" live>
          {actionError}
        </StatusBanner>
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
                        {t(`roles.${u.role}`)} · {userSites(u)}
                      </p>
                    </Td>
                    <Td hideBelow="sm">
                      <CellMuted>{t(`roles.${u.role}`)}</CellMuted>
                    </Td>
                    <Td hideBelow="md">
                      <CellMuted>{userSites(u)}</CellMuted>
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

                          {editDraft.role !== 'carasso' && (
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
                          )}
                        </div>

                        {editDraft.role === 'carasso' && (
                          <SiteChecklist
                            label={t('admin.carassoSites')}
                            sites={sites}
                            value={editDraft.site_ids}
                            onChange={(ids) => setEditDraft((d) => ({ ...d, site_ids: ids }))}
                          />
                        )}

                        {/* On a phone the pair fills the line, each holding a
                            128px floor, so a label is never squeezed to a
                            glyph; below that width they wrap to a line each
                            rather than shrinking. From `sm` up they sit at
                            their natural width, where a form's actions belong
                            at the start of the row, not stretched across it. */}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            className="min-w-32 flex-1 sm:flex-none"
                            icon="check"
                            busy={saving}
                            onClick={() => void saveEdit(u.id)}
                          >
                            {t('admin.save')}
                          </Button>
                          <Button
                            className="min-w-32 flex-1 sm:flex-none"
                            variant="secondary"
                            onClick={() => setExpanded(null)}
                          >
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
