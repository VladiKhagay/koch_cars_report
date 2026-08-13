import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { Service } from '../lib/types';
import AdminTabs from '../components/AdminTabs';
import StatusBanner from '../components/StatusBanner';
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
} from '../components/DataTable';
import {
  Badge,
  Button,
  Card,
  ConfirmAction,
  ConfirmPanel,
  EmptyState,
  Field,
  IconButton,
  LoadingRegion,
  Page,
  PageHeading,
  SearchField,
  SectionHeading,
  fieldClass,
} from '../components/ui';

/** Catalog, name, translation, status, order, actions — plus price for admins. */
const BASE_COLUMNS = 6;

/**
 * What a worker is paid for one job of this service. Admin-only, and not just
 * in the markup: migration 0006 reverts any non-admin write to this column, so
 * hiding the input removes the affordance rather than pretending to remove the
 * capability.
 */
function parsePrice(raw: string): number | null {
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** What the expanded row under a service is currently showing, if anything. */
type Expanded = { id: string; mode: 'edit' | 'deactivate' } | null;

/**
 * Service catalog management, shared by managers and admins (RLS allows
 * both to insert/update; hard DELETE isn't granted to anyone — "delete"
 * sets deleted_at, so historical jobs keep their service references).
 */
export default function Services() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [catalogNumber, setCatalogNumber] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameRu, setNameRu] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Expanded>(null);
  const [workerPrice, setWorkerPrice] = useState('');
  const [editDraft, setEditDraft] = useState({
    catalog_number: '',
    name_en: '',
    name_ru: '',
    worker_price: '',
  });

  const isAdmin = appUser?.role === 'admin';
  const COLUMNS = BASE_COLUMNS + (isAdmin ? 1 : 0);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('services').select('*').is('deleted_at', null).order('sort_order');
    setServices(data ?? []);
    setLoading(false);
  }

  async function handleAdd() {
    setError('');
    if (!catalogNumber || !nameEn) {
      setError(t('services.missingFields'));
      return;
    }
    // Only an admin's payload carries a price at all. A manager's insert omits
    // the key entirely rather than sending 0, so the column default applies and
    // the intent in the request matches the intent in the UI.
    let price: number | undefined;
    if (isAdmin && workerPrice.trim()) {
      const parsed = parsePrice(workerPrice);
      if (parsed === null) {
        setError(t('services.priceInvalid'));
        return;
      }
      price = parsed;
    }

    const maxSort = services.reduce((m, s) => Math.max(m, s.sort_order), 0);
    const { error: insertError } = await supabase.from('services').insert({
      catalog_number: catalogNumber,
      name_en: nameEn,
      name_ru: nameRu || null,
      sort_order: maxSort + 1,
      ...(price === undefined ? {} : { worker_price: price }),
    });
    if (insertError) {
      setError(insertError.code === '23505' ? t('services.duplicateCatalog') : insertError.message);
      return;
    }
    setCatalogNumber('');
    setNameEn('');
    setNameRu('');
    setWorkerPrice('');
    setAdding(false);
    void load();
  }

  function startEdit(service: Service) {
    setError('');
    setExpanded({ id: service.id, mode: 'edit' });
    setEditDraft({
      catalog_number: service.catalog_number,
      name_en: service.name_en,
      name_ru: service.name_ru ?? '',
      worker_price: String(service.worker_price ?? 0),
    });
  }

  async function saveEdit(serviceId: string) {
    setError('');

    /* The price is left out of a manager's payload rather than sent unchanged.
       The draft holds a value they never saw and cannot have meant, and 0006
       would revert it anyway — sending it would only make the request lie about
       what was being asked for. */
    let price: number | undefined;
    if (isAdmin) {
      const parsed = parsePrice(editDraft.worker_price);
      if (parsed === null) {
        setError(t('services.priceInvalid'));
        return;
      }
      price = parsed;
    }

    const { error: updateError } = await supabase
      .from('services')
      .update({
        catalog_number: editDraft.catalog_number.trim(),
        name_en: editDraft.name_en.trim(),
        name_ru: editDraft.name_ru.trim() || null,
        ...(price === undefined ? {} : { worker_price: price }),
      })
      .eq('id', serviceId);
    if (updateError) {
      setError(updateError.code === '23505' ? t('services.duplicateCatalog') : updateError.message);
      return;
    }
    setExpanded(null);
    void load();
  }

  async function softDelete(serviceId: string) {
    await supabase
      .from('services')
      .update({ deleted_at: new Date().toISOString(), active: false })
      .eq('id', serviceId);
    setExpanded(null);
    void load();
  }

  async function toggleActive(service: Service) {
    await supabase.from('services').update({ active: !service.active }).eq('id', service.id);
    setExpanded(null);
    void load();
  }

  /**
   * Reordering swaps `sort_order` with the neighbour, so it only makes sense
   * against the full catalog. While a search is narrowing the table the arrows
   * are hidden rather than left to move a row past a neighbour the manager
   * can't see.
   */
  async function move(service: Service, direction: -1 | 1) {
    const idx = services.findIndex((s) => s.id === service.id);
    const swapWith = services[idx + direction];
    if (!swapWith) return;
    await supabase.from('services').update({ sort_order: swapWith.sort_order }).eq('id', service.id);
    await supabase.from('services').update({ sort_order: service.sort_order }).eq('id', swapWith.id);
    void load();
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) =>
      [s.catalog_number, s.name_en, s.name_ru ?? ''].some((v) => v.toLowerCase().includes(q)),
    );
  }, [services, search]);

  const searching = search.trim().length > 0;

  return (
    <Page width="wide" className="space-y-5">
      {appUser?.role === 'admin' && <AdminTabs active="services" />}

      {/* Why the order matters is stated where the order is set — this list is
          the exact order a worker scrolls through on every single job. */}
      <PageHeading
        lead={t('services.orderHint')}
        action={
          <Button icon={adding ? 'x' : 'plus'} variant={adding ? 'secondary' : 'primary'} onClick={() => setAdding((a) => !a)}>
            {adding ? t('common.cancel') : t('services.addTitle')}
          </Button>
        }
      >
        {t('services.title')}
      </PageHeading>

      {adding && (
        <Card className="p-5">
          <SectionHeading icon="plus">{t('services.addTitle')}</SectionHeading>

          <div className="space-y-4">
            <Field htmlFor="service-catalog" label={t('services.catalogPlaceholder')}>
              <input
                id="service-catalog"
                value={catalogNumber}
                onChange={(e) => setCatalogNumber(e.target.value)}
                className={`${fieldClass} font-mono`}
              />
            </Field>
            <Field htmlFor="service-name-en" label={t('services.namePlaceholder')}>
              <input
                id="service-name-en"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                className={fieldClass}
              />
            </Field>
            <Field htmlFor="service-name-ru" label={t('services.nameRuPlaceholder')}>
              <input
                id="service-name-ru"
                lang="ru"
                value={nameRu}
                onChange={(e) => setNameRu(e.target.value)}
                className={fieldClass}
              />
            </Field>

            {isAdmin && (
              <Field htmlFor="service-price" label={t('services.workerPrice')} hint={<span className="text-ink-500">{t('services.workerPriceHint')}</span>}>
                <input
                  id="service-price"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={workerPrice}
                  onChange={(e) => setWorkerPrice(e.target.value)}
                  className={`${fieldClass} font-mono`}
                />
              </Field>
            )}

            {error && !expanded && (
              <StatusBanner tone="error" live>
                {error}
              </StatusBanner>
            )}

            <Button icon="plus" onClick={() => void handleAdd()}>
              {t('admin.add')}
            </Button>
          </div>
        </Card>
      )}

      {loading && <LoadingRegion label={t('common.loading')} rows={4} />}

      {!loading && services.length === 0 && (
        <EmptyState icon="tag" title={t('services.emptyTitle')} body={t('services.emptyBody')} />
      )}

      {!loading && services.length > 0 && (
        <TableCard
          toolbar={<SearchField value={search} onChange={setSearch} label={t('services.search')} />}
        >
          <Table minWidth={isAdmin ? 60 : 52}>
            <THead>
              <tr>
                <Th>{t('services.catalog')}</Th>
                <Th>{t('services.nameEn')}</Th>
                <Th hideBelow="md">{t('services.nameRu')}</Th>
                {isAdmin && (
                  <Th align="end" hideBelow="sm">
                    {t('services.workerPrice')}
                  </Th>
                )}
                <Th hideBelow="sm">{t('admin.status')}</Th>
                <Th hideBelow="md">{t('services.order')}</Th>
                <Th />
              </tr>
            </THead>
            <TBody>
              {filtered.map((s) => {
                const open = expanded?.id === s.id ? expanded : null;
                const i = services.indexOf(s);
                /* A row and its expanded panel are two <tr>s that belong
                   together — a Fragment keys them as one unit without wrapping
                   them in an element <tbody> would reject. */
                return (
                  <Fragment key={s.id}>
                  <Tr active={Boolean(open)}>
                    <Td>
                      {/* The catalog number is the record the office matches on. */}
                      <CellTitle mono>{s.catalog_number}</CellTitle>
                    </Td>
                    <Td>
                      <CellTitle>{s.name_en}</CellTitle>
                    </Td>
                    <Td hideBelow="md">
                      {s.name_ru ? <CellMuted lang="ru">{s.name_ru}</CellMuted> : <CellMuted>—</CellMuted>}
                    </Td>
                    {isAdmin && (
                      <Td align="end" hideBelow="sm">
                        <CellTitle mono>{s.worker_price}</CellTitle>
                      </Td>
                    )}
                    <Td hideBelow="sm">
                      {/* State is reported, never actioned, by this element. */}
                      <Badge tone={s.active ? 'ok' : 'neutral'} icon={s.active ? 'checkCircle' : 'lock'}>
                        {s.active ? t('admin.active') : t('admin.inactive')}
                      </Badge>
                    </Td>
                    <Td hideBelow="md">
                      {!searching && (
                        <div className="flex items-center">
                          <IconButton
                            icon="arrowUp"
                            label={t('services.moveUp')}
                            disabled={i === 0}
                            onClick={() => void move(s, -1)}
                          />
                          <IconButton
                            icon="arrowDown"
                            label={t('services.moveDown')}
                            disabled={i === services.length - 1}
                            onClick={() => void move(s, 1)}
                          />
                        </div>
                      )}
                    </Td>
                    <TdActions>
                      {s.active ? (
                        <IconButton
                          icon="lock"
                          label={t('team.deactivate')}
                          onClick={() => setExpanded({ id: s.id, mode: 'deactivate' })}
                        />
                      ) : (
                        <IconButton icon="check" label={t('team.activate')} onClick={() => void toggleActive(s)} />
                      )}
                      <IconButton icon="pencil" label={t('newJob.edit')} onClick={() => startEdit(s)} />
                    </TdActions>
                  </Tr>

                  {open?.mode === 'deactivate' && (
                    <TrExpanded colSpan={COLUMNS}>
                      <ConfirmPanel
                        variant="secondary"
                        icon="lock"
                        question={t('services.deactivateConfirm')}
                        confirmLabel={t('team.deactivate')}
                        onConfirm={() => void toggleActive(s)}
                        onCancel={() => setExpanded(null)}
                      />
                    </TrExpanded>
                  )}

                  {open?.mode === 'edit' && (
                    <TrExpanded colSpan={COLUMNS}>
                      <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          <Field htmlFor={`edit-catalog-${s.id}`} label={t('services.catalog')}>
                            <input
                              id={`edit-catalog-${s.id}`}
                              value={editDraft.catalog_number}
                              onChange={(e) => setEditDraft((d) => ({ ...d, catalog_number: e.target.value }))}
                              className={`${fieldClass} font-mono`}
                            />
                          </Field>
                          <Field htmlFor={`edit-name-en-${s.id}`} label={t('services.nameEn')}>
                            <input
                              id={`edit-name-en-${s.id}`}
                              value={editDraft.name_en}
                              onChange={(e) => setEditDraft((d) => ({ ...d, name_en: e.target.value }))}
                              className={fieldClass}
                            />
                          </Field>
                          <Field htmlFor={`edit-name-ru-${s.id}`} label={t('services.nameRu')}>
                            <input
                              id={`edit-name-ru-${s.id}`}
                              lang="ru"
                              value={editDraft.name_ru}
                              onChange={(e) => setEditDraft((d) => ({ ...d, name_ru: e.target.value }))}
                              className={fieldClass}
                            />
                          </Field>

                          {isAdmin && (
                            <Field htmlFor={`edit-price-${s.id}`} label={t('services.workerPrice')}>
                              <input
                                id={`edit-price-${s.id}`}
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.01"
                                value={editDraft.worker_price}
                                onChange={(e) => setEditDraft((d) => ({ ...d, worker_price: e.target.value }))}
                                className={`${fieldClass} font-mono`}
                              />
                            </Field>
                          )}
                        </div>

                        {error && (
                          <StatusBanner tone="error" live>
                            {error}
                          </StatusBanner>
                        )}

                        <div className="flex flex-wrap gap-2">
                          <Button icon="check" onClick={() => void saveEdit(s.id)}>
                            {t('admin.save')}
                          </Button>
                          <Button variant="secondary" onClick={() => setExpanded(null)}>
                            {t('common.cancel')}
                          </Button>
                        </div>

                        {/* Its own block behind the app's one destructive pattern:
                            removing a service is not a peer of saving a rename. */}
                        <div className="border-t border-line pt-4">
                          <ConfirmAction
                            variant="danger"
                            trigger={t('jobDetail.delete')}
                            question={t('services.deleteConfirm')}
                            confirmLabel={t('jobDetail.delete')}
                            onConfirm={() => void softDelete(s.id)}
                          />
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

      {!loading && services.length > 0 && filtered.length === 0 && (
        <EmptyState icon="search" title={t('admin.noMatches')} />
      )}
    </Page>
  );
}
