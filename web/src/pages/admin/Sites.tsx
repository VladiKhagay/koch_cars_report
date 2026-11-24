import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import type { Site } from '../../lib/types';
import AdminTabs from '../../components/AdminTabs';
import StatusBanner from '../../components/StatusBanner';
import {
  Table,
  TableCard,
  TBody,
  Td,
  TdActions,
  Th,
  THead,
  Tr,
  TrExpanded,
  CellTitle,
  CellMuted,
} from '../../components/DataTable';
import {
  Badge,
  Button,
  ConfirmPanel,
  EmptyState,
  Field,
  IconButton,
  LoadingRegion,
  Page,
  PageHeading,
  SearchField,
  Select,
  fieldClass,
  fieldErrorClass,
} from '../../components/ui';

/** Name, status, actions. */
const COLUMNS = 3;

type Expanded = { id: string; mode: 'rename' | 'rules' | 'disable' | 'delete' } | null;
type Rule = Site['vin_rule'];
type Status =
  | 'idle'
  | 'added'
  | 'required'
  | 'duplicate'
  | 'error'
  | 'renamed'
  | 'rulesSaved'
  | 'disabled'
  | 'enabled'
  | 'deleted'
  | 'inUse';
type RenameError = '' | 'required' | 'duplicate' | 'error';

export default function AdminSites() {
  const { t } = useTranslation();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [expanded, setExpanded] = useState<Expanded>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<RenameError>('');
  const [rulesDraft, setRulesDraft] = useState<{ vin_rule: Rule; plate_rule: Rule }>({
    vin_rule: 'required',
    plate_rule: 'optional',
  });
  const [rulesError, setRulesError] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('sites').select('id, name, active, vin_rule, plate_rule').order('name');
    setSites(data ?? []);
    setLoading(false);
  }

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      setStatus('required');
      return;
    }
    setAdding(true);
    const { error } = await supabase.from('sites').insert({ name: trimmed });
    setAdding(false);
    if (error) {
      setStatus(error.code === '23505' ? 'duplicate' : 'error');
      return;
    }
    setName('');
    setStatus('added');
    void load();
  }

  function open(site: Site, mode: NonNullable<Expanded>['mode']) {
    setExpanded({ id: site.id, mode });
    setRenameDraft(site.name);
    setRenameError('');
    setRulesDraft({ vin_rule: site.vin_rule, plate_rule: site.plate_rule });
    setRulesError(false);
    setStatus('idle');
  }

  async function handleRename(site: Site) {
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      setRenameError('required');
      return;
    }
    setSaving(true);
    // .select(): RLS turns a refused update into zero rows, not an error.
    const { data, error } = await supabase.from('sites').update({ name: trimmed }).eq('id', site.id).select('id');
    setSaving(false);
    if (error || !data?.length) {
      setRenameError(error?.code === '23505' ? 'duplicate' : 'error');
      return;
    }
    setExpanded(null);
    setStatus('renamed');
    void load();
  }

  /* Which of VIN / plate a NEW job at this site must have (0042). Admin-only in
     the database (sites_write); existing jobs and their edits are unaffected. */
  async function handleRules(site: Site) {
    if (saving) return;
    setSaving(true);
    // .select(): RLS turns a refused update into zero rows, not an error.
    const { data, error } = await supabase.from('sites').update(rulesDraft).eq('id', site.id).select('id');
    setSaving(false);
    if (error || !data?.length) {
      setRulesError(true);
      return;
    }
    setExpanded(null);
    setStatus('rulesSaved');
    void load();
  }

  async function setActive(site: Site, active: boolean) {
    // A second tap while the first is in flight would report the first as an error.
    if (saving) return;
    setSaving(true);
    const { data, error } = await supabase.from('sites').update({ active }).eq('id', site.id).select('id');
    setSaving(false);
    setExpanded(null);
    setStatus(error || !data?.length ? 'error' : active ? 'enabled' : 'disabled');
    void load();
  }

  async function handleDelete(site: Site) {
    // A second tap would delete 0 rows and turn a done delete into 'error'.
    if (saving) return;
    setSaving(true);
    const { data, error } = await supabase.from('sites').delete().eq('id', site.id).select('id');
    setSaving(false);
    setExpanded(null);
    // 23503: a job, a user or a viewer link still points at it (0041 FKs).
    setStatus(error?.code === '23503' ? 'inUse' : error || !data?.length ? 'error' : 'deleted');
    void load();
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? sites.filter((s) => s.name.toLowerCase().includes(q)) : sites;
  }, [sites, search]);

  const invalid = status === 'required' || status === 'duplicate';

  return (
    <Page width="list">
      {/* The tab strip labels the heading under it. */}
      <div className="space-y-2">
        <AdminTabs active="sites" />
      </div>

      {/*
        A site name is written into every export and every analytics screen, so
        how to correct one (and why a used site is disabled, not deleted) is
        stated before the field rather than discovered later. It is the page
        lead now that the form has moved into the table's toolbar.
      */}
      <PageHeading lead={t('admin.sitesWarning')}>{t('admin.sites')}</PageHeading>

      {status === 'required' && <StatusBanner tone="error" live>{t('admin.sitesNameRequired')}</StatusBanner>}
      {status === 'duplicate' && <StatusBanner tone="error" live>{t('admin.sitesDuplicate')}</StatusBanner>}
      {status === 'error' && <StatusBanner tone="error" live>{t('common.error')}</StatusBanner>}
      {status === 'inUse' && <StatusBanner tone="error" live>{t('admin.sitesInUse')}</StatusBanner>}
      {status === 'added' && <StatusBanner tone="success" live>{t('admin.sitesAdded')}</StatusBanner>}
      {status === 'renamed' && <StatusBanner tone="success" live>{t('admin.sitesRenamed')}</StatusBanner>}
      {status === 'rulesSaved' && <StatusBanner tone="success" live>{t('admin.sitesRulesSaved')}</StatusBanner>}
      {status === 'disabled' && <StatusBanner tone="success" live>{t('admin.sitesDisabledDone')}</StatusBanner>}
      {status === 'enabled' && <StatusBanner tone="success" live>{t('admin.sitesEnabledDone')}</StatusBanner>}
      {status === 'deleted' && <StatusBanner tone="success" live>{t('admin.sitesDeleted')}</StatusBanner>}

      {loading && <LoadingRegion label={t('common.loading')} rows={3} />}

      {!loading && sites.length === 0 && (
        <EmptyState icon="grid" title={t('admin.sitesEmptyTitle')} body={t('admin.sitesEmptyBody')} />
      )}

      {!loading && sites.length > 0 && (
        <TableCard
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <SearchField
                value={search}
                onChange={setSearch}
                label={t('admin.searchSites')}
                className="min-w-48 flex-1"
              />
              <input
                value={name}
                aria-label={t('admin.sitesAddTitle')}
                placeholder={t('admin.sitesAddTitle')}
                onChange={(e) => {
                  setName(e.target.value);
                  setStatus('idle');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAdd();
                }}
                className={`${fieldClass} ${invalid ? fieldErrorClass : ''} w-auto min-w-48 flex-1`}
              />
              <Button icon="plus" busy={adding} onClick={() => void handleAdd()}>
                {t('admin.add')}
              </Button>
            </div>
          }
        >
          <Table minWidth={20}>
            <THead>
              <tr>
                <Th>{t('admin.name')}</Th>
                <Th>{t('admin.status')}</Th>
                <Th />
              </tr>
            </THead>
            <TBody>
              {filtered.map((s) => {
                const mode = expanded?.id === s.id ? expanded.mode : null;
                return (
                  <Fragment key={s.id}>
                    <Tr active={Boolean(mode)}>
                      <Td>
                        <CellTitle>{s.name}</CellTitle>
                        <span className="block text-xs">
                          <CellMuted>
                            {t('admin.sitesRulesSummary', {
                              vin: t(`admin.sitesRule.${s.vin_rule}`),
                              plate: t(`admin.sitesRule.${s.plate_rule}`),
                            })}
                          </CellMuted>
                        </span>
                      </Td>
                      <Td>
                        {s.active ? (
                          <Badge tone="ok" icon="checkCircle">
                            {t('admin.sitesActive')}
                          </Badge>
                        ) : (
                          <Badge tone="neutral" icon="lock">
                            {t('admin.sitesDisabled')}
                          </Badge>
                        )}
                      </Td>
                      <TdActions>
                        <IconButton icon="pencil" label={t('admin.sitesRename')} onClick={() => open(s, 'rename')} />
                        <IconButton icon="settings" label={t('admin.sitesRules')} onClick={() => open(s, 'rules')} />
                        {s.active ? (
                          <IconButton icon="lock" label={t('admin.sitesDisable')} onClick={() => open(s, 'disable')} />
                        ) : (
                          <IconButton
                            icon="check"
                            label={t('admin.sitesEnable')}
                            disabled={saving}
                            onClick={() => void setActive(s, true)}
                          />
                        )}
                        <IconButton icon="trash" label={t('admin.sitesDelete')} onClick={() => open(s, 'delete')} />
                      </TdActions>
                    </Tr>

                    {mode === 'rename' && (
                      <TrExpanded colSpan={COLUMNS}>
                        <div className="space-y-4">
                          <Field htmlFor={`rename-${s.id}`} label={t('admin.name')}>
                            <input
                              id={`rename-${s.id}`}
                              value={renameDraft}
                              onChange={(e) => {
                                setRenameDraft(e.target.value);
                                setRenameError('');
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void handleRename(s);
                              }}
                              aria-invalid={renameError === 'required' || renameError === 'duplicate'}
                              className={`${fieldClass} ${renameError === 'required' || renameError === 'duplicate' ? fieldErrorClass : ''}`}
                            />
                          </Field>
                          {renameError === 'required' && (
                            <StatusBanner tone="error" live>{t('admin.sitesNameRequired')}</StatusBanner>
                          )}
                          {renameError === 'duplicate' && (
                            <StatusBanner tone="error" live>{t('admin.sitesDuplicate')}</StatusBanner>
                          )}
                          {renameError === 'error' && <StatusBanner tone="error" live>{t('common.error')}</StatusBanner>}
                          <div className="flex flex-wrap gap-2">
                            <Button
                              className="min-w-32 flex-1 sm:flex-none"
                              icon="check"
                              busy={saving}
                              onClick={() => void handleRename(s)}
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

                    {mode === 'rules' && (
                      <TrExpanded colSpan={COLUMNS}>
                        <div className="space-y-4">
                          <p className="text-sm text-ink-600">{t('admin.sitesRulesHint')}</p>
                          <div className="grid gap-3 sm:grid-cols-2">
                            {(['vin_rule', 'plate_rule'] as const).map((key) => (
                              <Field
                                key={key}
                                htmlFor={`${key}-${s.id}`}
                                label={t(key === 'vin_rule' ? 'admin.sitesRuleVin' : 'admin.sitesRulePlate')}
                              >
                                <Select
                                  id={`${key}-${s.id}`}
                                  value={rulesDraft[key]}
                                  onChange={(e) => {
                                    setRulesDraft((d) => ({ ...d, [key]: e.target.value as Rule }));
                                    setRulesError(false);
                                  }}
                                >
                                  <option value="required">{t('admin.sitesRule.required')}</option>
                                  <option value="optional">{t('admin.sitesRule.optional')}</option>
                                </Select>
                              </Field>
                            ))}
                          </div>
                          {rulesError && <StatusBanner tone="error" live>{t('common.error')}</StatusBanner>}
                          <div className="flex flex-wrap gap-2">
                            <Button
                              className="min-w-32 flex-1 sm:flex-none"
                              icon="check"
                              busy={saving}
                              onClick={() => void handleRules(s)}
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

                    {mode === 'disable' && (
                      <TrExpanded colSpan={COLUMNS}>
                        <ConfirmPanel
                          variant="secondary"
                          icon="lock"
                          question={t('admin.sitesDisableQuestion', { name: s.name })}
                          confirmLabel={t('admin.sitesDisable')}
                          onConfirm={() => void setActive(s, false)}
                          onCancel={() => setExpanded(null)}
                        />
                      </TrExpanded>
                    )}

                    {mode === 'delete' && (
                      <TrExpanded colSpan={COLUMNS}>
                        <ConfirmPanel
                          question={t('admin.sitesDeleteQuestion', { name: s.name })}
                          confirmLabel={t('admin.sitesDelete')}
                          onConfirm={() => void handleDelete(s)}
                          onCancel={() => setExpanded(null)}
                        />
                      </TrExpanded>
                    )}
                  </Fragment>
                );
              })}
            </TBody>
          </Table>
        </TableCard>
      )}

      {!loading && sites.length > 0 && filtered.length === 0 && (
        <EmptyState icon="search" title={t('admin.noMatches')} />
      )}
    </Page>
  );
}
