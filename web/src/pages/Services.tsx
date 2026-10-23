import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { SERVICE_COLUMNS, type ClientPrices, type Service } from '../lib/types';
import {
  fetchServiceClientPrices,
  parsePrice as parseClientPrice,
  saveServiceClientPrices,
  validateClientPrices,
} from '../lib/clientPrices';
import { formatMoney } from '../components/money';
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

/** Catalog, name, two translations, status, order, actions — plus worker price and the two client prices for admins. */
const BASE_COLUMNS = 7;
const ADMIN_COLUMNS = 3;

/** Pay per job of this service. Admin-only, enforced by migration 0006 (non-admin writes are reverted), not just hidden in the markup. */
function parsePrice(raw: string): number | null {
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** What the expanded row under a service is currently showing, if anything. */
type Expanded = { id: string; mode: 'edit' | 'deactivate' } | null;

/**
 * Service catalog management for managers and admins. "Delete" sets deleted_at
 * (no hard DELETE is granted), so historical jobs keep their service.
 */
export default function Services() {
  const { t, i18n } = useTranslation();
  const { appUser } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [catalogNumber, setCatalogNumber] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameRu, setNameRu] = useState('');
  const [nameHe, setNameHe] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Expanded>(null);
  const [workerPrice, setWorkerPrice] = useState('');
  const [clientUnit, setClientUnit] = useState('');
  const [clientTotal, setClientTotal] = useState('');
  /** Admin only: the catalog client prices, from their own admin-only table. */
  const [clientPrices, setClientPrices] = useState<Map<string, ClientPrices>>(new Map());
  /** A failed activate/deactivate shows above the table, not inside a closed panel. */
  const [listError, setListError] = useState('');
  const [editDraft, setEditDraft] = useState({
    catalog_number: '',
    name_en: '',
    name_ru: '',
    name_he: '',
    worker_price: '',
    client_unit: '',
    client_total: '',
  });

  const isAdmin = appUser?.role === 'admin';
  const COLUMNS = BASE_COLUMNS + (isAdmin ? ADMIN_COLUMNS : 0);

  useEffect(() => {
    void load();
  }, [isAdmin]);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('services').select(SERVICE_COLUMNS).is('deleted_at', null).order('sort_order');
    setServices(data ?? []);
    if (isAdmin) setClientPrices(await fetchServiceClientPrices());
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

    /* Client prices are required for an active service, so an admin's new
       service goes in as a draft (inactive), gets its prices, and only then is
       activated. A manager cannot price one, so theirs stays a draft for an
       admin to finish. */
    let prices: { unit_price: number; total_price: number } | null = null;
    if (isAdmin) {
      const problem = validateClientPrices(true, clientUnit, clientTotal);
      if (problem) {
        setError(problem === 'invalid' ? t('prices.invalid') : t('services.clientPricesRequired'));
        return;
      }
      prices = { unit_price: parseClientPrice(clientUnit)!, total_price: parseClientPrice(clientTotal)! };
    }

    const maxSort = services.reduce((m, s) => Math.max(m, s.sort_order), 0);
    const { data: created, error: insertError } = await supabase
      .from('services')
      .insert({
        catalog_number: catalogNumber,
        name_en: nameEn,
        name_ru: nameRu || null,
        name_he: nameHe || null,
        sort_order: maxSort + 1,
        active: false,
        ...(price === undefined ? {} : { worker_price: price }),
      })
      .select('id')
      .single();
    if (insertError || !created) {
      setError(insertError?.message ?? t('common.error'));
      return;
    }
    if (prices) {
      const { error: priceError } = await saveServiceClientPrices(created.id, prices);
      const { error: activateError } = priceError
        ? { error: priceError }
        : await supabase.from('services').update({ active: true }).eq('id', created.id);
      if (priceError || activateError) {
        // The draft exists; say so rather than leave a silent half-created service.
        setError(t('services.draftSaved', { reason: (priceError ?? activateError)!.message }));
        void load();
        return;
      }
    }
    setCatalogNumber('');
    setNameEn('');
    setNameRu('');
    setNameHe('');
    setWorkerPrice('');
    setClientUnit('');
    setClientTotal('');
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
      name_he: service.name_he ?? '',
      worker_price: String(service.worker_price ?? 0),
      client_unit: String(clientPrices.get(service.id)?.unit_price ?? ''),
      client_total: String(clientPrices.get(service.id)?.total_price ?? ''),
    });
  }

  async function saveEdit(serviceId: string) {
    setError('');

        /* The price is left out of a manager's payload: the draft holds a value they
           never saw, and 0006 would revert it anyway. */
    let price: number | undefined;
    if (isAdmin) {
      const parsed = parsePrice(editDraft.worker_price);
      if (parsed === null) {
        setError(t('services.priceInvalid'));
        return;
      }
      price = parsed;
    }

    const service = services.find((x) => x.id === serviceId);
    const clientProblem = isAdmin
      ? validateClientPrices(Boolean(service?.active), editDraft.client_unit, editDraft.client_total)
      : null;
    if (clientProblem) {
      setError(clientProblem === 'invalid' ? t('prices.invalid') : t('services.clientPricesRequired'));
      return;
    }

    const { error: updateError } = await supabase
      .from('services')
      .update({
        catalog_number: editDraft.catalog_number.trim(),
        name_en: editDraft.name_en.trim(),
        name_ru: editDraft.name_ru.trim() || null,
        name_he: editDraft.name_he.trim() || null,
        ...(price === undefined ? {} : { worker_price: price }),
      })
      .eq('id', serviceId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    if (isAdmin) {
      const unit = parseClientPrice(editDraft.client_unit);
      const total = parseClientPrice(editDraft.client_total);
      const { error: priceError } = await saveServiceClientPrices(
        serviceId,
        unit !== null && total !== null ? { unit_price: unit, total_price: total } : null,
      );
      if (priceError) {
        setError(priceError.message);
        return;
      }
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
    setListError('');
    const { error: toggleError } = await supabase.from('services').update({ active: !service.active }).eq('id', service.id);
    // Activating a service with no client prices is refused by the database;
    // say what to do instead of failing silently.
    if (toggleError) setListError(!service.active ? t('services.needsPrices') : toggleError.message);
    if (toggleError && !service.active && isAdmin) startEdit(service);
    else setExpanded(null);
    void load();
  }

    /* Reordering swaps `sort_order` with the neighbour, so the arrows are hidden
       while a search narrows the table (they'd move past a hidden row). */
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
      [s.catalog_number, s.name_en, s.name_ru ?? '', s.name_he ?? ''].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }, [services, search]);

  const searching = search.trim().length > 0;

  return (
    <Page width="wide">
      {/* The tab strip labels the heading under it. */}
      {appUser?.role === 'admin' && (
        <div className="space-y-2">
          <AdminTabs active="services" />
        </div>
      )}

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
        <Card>
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
            {/* `dir="rtl"` on the input itself, not inherited from the page:
                this field is filled in while the rest of the form is in
                whatever language the manager runs the app in, so the Hebrew
                has to lay itself out regardless of what surrounds it. */}
            <Field htmlFor="service-name-he" label={t('services.nameHePlaceholder')}>
              <input
                id="service-name-he"
                lang="he"
                dir="rtl"
                value={nameHe}
                onChange={(e) => setNameHe(e.target.value)}
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

            {isAdmin && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field htmlFor="service-client-unit" label={t('prices.unit')}>
                  <input
                    id="service-client-unit"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={clientUnit}
                    onChange={(e) => setClientUnit(e.target.value)}
                    className={`${fieldClass} font-mono`}
                  />
                </Field>
                <Field htmlFor="service-client-total" label={t('prices.total')}>
                  <input
                    id="service-client-total"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={clientTotal}
                    onChange={(e) => setClientTotal(e.target.value)}
                    className={`${fieldClass} font-mono`}
                  />
                </Field>
              </div>
            )}
            {!isAdmin && <p className="text-sm text-ink-600">{t('services.draftHint')}</p>}

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

      {listError && (
        <StatusBanner tone="error" live>
          {listError}
        </StatusBanner>
      )}

      {loading && <LoadingRegion label={t('common.loading')} rows={4} />}

      {!loading && services.length === 0 && (
        <EmptyState icon="tag" title={t('services.emptyTitle')} body={t('services.emptyBody')} />
      )}

      {!loading && services.length > 0 && (
        <TableCard
          toolbar={<SearchField value={search} onChange={setSearch} label={t('services.search')} />}
        >
          <Table minWidth={isAdmin ? 84 : 60}>
            <THead>
              <tr>
                {/* A catalog number is a fixed-length code, so its column is
                    sized by the code and nothing else — the width it would
                    otherwise take as an equal share is width the name needs. */}
                <Th className="w-px whitespace-nowrap">{t('services.catalog')}</Th>
                <Th>{t('services.nameEn')}</Th>
                <Th hideBelow="md">{t('services.nameRu')}</Th>
                <Th hideBelow="lg">{t('services.nameHe')}</Th>
                {isAdmin && (
                  <Th align="end" hideBelow="sm">
                    {t('services.workerPrice')}
                  </Th>
                )}
                {isAdmin && (
                  <Th align="end" hideBelow="lg">
                    {t('prices.unit')}
                  </Th>
                )}
                {isAdmin && (
                  <Th align="end" hideBelow="lg">
                    {t('prices.total')}
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
                    <Td className="w-px whitespace-nowrap">
                      {/* The catalog number is the record the office matches on. */}
                      <CellTitle mono>{s.catalog_number}</CellTitle>
                    </Td>
                    <Td>
                      <CellTitle>{s.name_en}</CellTitle>
                    </Td>
                    <Td hideBelow="md">
                      {s.name_ru ? <CellMuted lang="ru">{s.name_ru}</CellMuted> : <CellMuted>—</CellMuted>}
                    </Td>
                    <Td hideBelow="lg">
                      {s.name_he ? (
                        <CellMuted lang="he" dir="rtl">
                          {s.name_he}
                        </CellMuted>
                      ) : (
                        <CellMuted>—</CellMuted>
                      )}
                    </Td>
                    {isAdmin && (
                      <Td align="end" hideBelow="sm">
                        <CellTitle mono>{s.worker_price}</CellTitle>
                      </Td>
                    )}
                    {isAdmin && (
                      <Td align="end" hideBelow="lg">
                        <CellMuted mono>{formatMoney(clientPrices.get(s.id)?.unit_price, i18n.language)}</CellMuted>
                      </Td>
                    )}
                    {isAdmin && (
                      <Td align="end" hideBelow="lg">
                        <CellMuted mono>{formatMoney(clientPrices.get(s.id)?.total_price, i18n.language)}</CellMuted>
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
                          <Field htmlFor={`edit-name-he-${s.id}`} label={t('services.nameHe')}>
                            <input
                              id={`edit-name-he-${s.id}`}
                              lang="he"
                              dir="rtl"
                              value={editDraft.name_he}
                              onChange={(e) => setEditDraft((d) => ({ ...d, name_he: e.target.value }))}
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
                          {isAdmin && (
                            <Field htmlFor={`edit-unit-${s.id}`} label={t('prices.unit')}>
                              <input
                                id={`edit-unit-${s.id}`}
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.01"
                                value={editDraft.client_unit}
                                onChange={(e) => setEditDraft((d) => ({ ...d, client_unit: e.target.value }))}
                                className={`${fieldClass} font-mono`}
                              />
                            </Field>
                          )}
                          {isAdmin && (
                            <Field htmlFor={`edit-total-${s.id}`} label={t('prices.total')}>
                              <input
                                id={`edit-total-${s.id}`}
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.01"
                                value={editDraft.client_total}
                                onChange={(e) => setEditDraft((d) => ({ ...d, client_total: e.target.value }))}
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
                          <Button
                            className="min-w-32 flex-1 sm:flex-none"
                            icon="check"
                            onClick={() => void saveEdit(s.id)}
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
