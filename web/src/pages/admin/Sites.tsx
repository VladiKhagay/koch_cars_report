import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import type { Site } from '../../lib/types';
import AdminTabs from '../../components/AdminTabs';
import StatusBanner from '../../components/StatusBanner';
import { Table, TableCard, TBody, Td, Th, THead, Tr, CellTitle } from '../../components/DataTable';
import {
  Button,
  EmptyState,
  LoadingRegion,
  Page,
  PageHeading,
  SearchField,
  fieldClass,
  fieldErrorClass,
} from '../../components/ui';

export default function AdminSites() {
  const { t } = useTranslation();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'added' | 'required' | 'duplicate' | 'error'>('idle');

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('sites').select('*').order('name');
    setSites(data ?? []);
    setLoading(false);
  }

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) {
      setStatus('required');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('sites').insert({ name: trimmed });
    setSaving(false);
    if (error) {
      setStatus(error.code === '23505' ? 'duplicate' : 'error');
      return;
    }
    setName('');
    setStatus('added');
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
        A site name is written into every export and every analytics screen and
        cannot be corrected here, so the consequence is stated before the field
        rather than discovered in a spreadsheet a month later. It is the page
        lead now that the form has moved into the table's toolbar — the warning
        has to outrank the control it is about.
      */}
      <PageHeading lead={t('admin.sitesWarning')}>{t('admin.sites')}</PageHeading>

      {status === 'required' && <StatusBanner tone="error" live>{t('admin.sitesNameRequired')}</StatusBanner>}
      {status === 'duplicate' && <StatusBanner tone="error" live>{t('admin.sitesDuplicate')}</StatusBanner>}
      {status === 'error' && <StatusBanner tone="error" live>{t('common.error')}</StatusBanner>}
      {status === 'added' && <StatusBanner tone="success" live>{t('admin.sitesAdded')}</StatusBanner>}

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
              <Button icon="plus" busy={saving} onClick={() => void handleAdd()}>
                {t('admin.add')}
              </Button>
            </div>
          }
        >
          <Table minWidth={20}>
            <THead>
              <tr>
                <Th>{t('admin.name')}</Th>
              </tr>
            </THead>
            <TBody>
              {filtered.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <CellTitle>{s.name}</CellTitle>
                  </Td>
                </Tr>
              ))}
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
