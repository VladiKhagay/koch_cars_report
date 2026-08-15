/**
 * The jobs grid — the screen that replaces the office spreadsheet.
 *
 * The Dashboard answers "what happened today"; this answers "find me that car
 * and put its receipt number in". Those are different jobs, so this is a
 * different screen rather than a mode of the first one: dense rows, a page at a
 * time, filters that persist while you work down a stack of paperwork.
 *
 * Everything that narrows the list — search, filters, paging — happens in
 * Postgres, not in the browser. At ~3,000 jobs a month, shipping the year to
 * the client to filter it there would be the one decision that makes this
 * screen unusable on the phone a manager actually carries. TanStack Table is
 * therefore in `manual` territory throughout: it owns the column model and
 * rendering, the database owns the row set.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { serviceName as localizedServiceName } from '../lib/serviceName';
import { recordAudit } from '../lib/audit';
import { searchTerm } from '../lib/search';
import { useSiteScope } from '../lib/useSiteScope';
import type { AppUser, Job } from '../lib/types';
import Icon from '../components/Icon';
import {
  CellMuted,
  CellTitle,
  Table,
  TableCard,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  TrExpanded,
} from '../components/DataTable';
import {
  Button,
  ConfirmPanel,
  EmptyState,
  IconButton,
  Group,
  Page,
  PageHeading,
  SearchField,
  Select,
  Skeleton,
  Spinner,
  fieldClass,
} from '../components/ui';

const PAGE_SIZE = 50;

/** A job row with the two names the grid shows instead of foreign keys. */
interface JobRow extends Job {
  worker: { id: string; name: string } | null;
  service: { name_en: string; name_ru: string | null } | null;
}

/** Stable identity: a fresh `[]` fallback would invalidate the table's models. */
const NO_ROWS: JobRow[] = [];

/**
 * No row models are registered. Sorting, filtering and pagination are all
 * server-side, so asking the table for client-side versions of them would
 * quietly re-derive the wrong answer from the 50 rows currently in memory.
 */
const features = tableFeatures({});
const helper = createColumnHelper<typeof features, JobRow>();

/** Everything the cells call back into. Held in a ref so `columns` stays stable. */
interface Handlers {
  saveBillingCode: (job: JobRow, value: string) => Promise<boolean>;
  openDuplicate: (jobId: string) => void;
  siteName: (id: string) => string;
  serviceName: (job: JobRow) => string;
  locale: string;
}

/* ------------------------------------------------------------------- cells */

/**
 * The receipt number, editable in place.
 *
 * The draft lives in the cell, not in a map on the page: a page-level draft
 * would re-render all 50 rows on every keystroke, and this is the one field a
 * manager types into dozens of times in a sitting.
 *
 * It saves on blur and on Enter, and only when the value actually changed —
 * tabbing through a column of filled-in codes must not write 50 rows.
 */
function BillingCell({ job, handlers }: { job: JobRow; handlers: React.RefObject<Handlers> }) {
  const { t } = useTranslation();
  const committed = job.billing_code ?? '';
  const [value, setValue] = useState(committed);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Re-seed when the row is replaced under us (page change, filter change).
  useEffect(() => {
    setValue(committed);
    setState('idle');
  }, [committed, job.id]);

  async function commit() {
    const next = value.trim();
    if (next === committed) return;
    setState('saving');
    const ok = await handlers.current.saveBillingCode(job, next);
    setState(ok ? 'saved' : 'error');
    if (ok) setTimeout(() => setState('idle'), 2000);
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        aria-label={t('jobs.billingCode')}
        placeholder="—"
        onChange={(e) => {
          setValue(e.target.value);
          if (state !== 'idle') setState('idle');
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setValue(committed);
            e.currentTarget.blur();
          }
        }}
        className={`${fieldClass} h-10 w-32 px-2 font-mono text-sm ${
          state === 'error' ? 'border-danger-600 bg-danger-50' : ''
        }`}
      />
      {/* Status is a word for a screen reader and a glyph for everyone else —
          this cell is 32px wide and cannot carry a sentence. */}
      <span role="status" aria-live="polite" className="w-5 shrink-0">
        {state === 'saving' && <Spinner size={16} />}
        {state === 'saved' && <Icon name="checkCircle" size={16} className="text-ok-700" title={t('jobs.saved')} />}
        {state === 'error' && (
          <Icon name="alertCircle" size={16} className="text-danger-700" title={t('jobs.saveFailed')} />
        )}
      </span>
    </div>
  );
}

/* ----------------------------------------------------------------- columns */

function buildColumns(t: (key: string) => string, handlers: React.RefObject<Handlers>, showSite: boolean) {
  /* `helper.columns` is what keeps each column's value type attached to its own
     cell renderer — building a plain array widens them all to `unknown` and the
     definitions stop type-checking against each other. So the full set is
     declared as one tuple and the optional column is dropped afterwards. */
  const cols = helper.columns([
    helper.accessor('created_at', {
      id: 'date',
      header: () => t('jobs.date'),
      cell: ({ getValue }) => {
        const d = new Date(getValue());
        return (
          <span className="whitespace-nowrap">
            <CellTitle>
              {d.toLocaleDateString(handlers.current.locale, { day: '2-digit', month: 'short' })}
            </CellTitle>{' '}
            <CellMuted>
              {d.toLocaleTimeString(handlers.current.locale, { hour: '2-digit', minute: '2-digit' })}
            </CellMuted>
          </span>
        );
      },
    }),
    helper.accessor('site_id', {
      id: 'site',
      header: () => t('jobs.site'),
      cell: ({ getValue }) => <CellMuted>{handlers.current.siteName(getValue())}</CellMuted>,
    }),
    helper.accessor((row) => row.worker?.name ?? '—', {
      id: 'worker',
      header: () => t('jobs.worker'),
      cell: ({ getValue }) => <CellMuted>{getValue()}</CellMuted>,
    }),
    helper.accessor('plate', {
      id: 'plate',
      header: () => t('jobs.plate'),
      // The plate is the handle on the record, so it is also the way into it.
      cell: ({ row, getValue }) => (
        <Link to={`/jobs/${row.original.id}`} className="underline-offset-2 hover:underline">
          <CellTitle mono>{getValue()}</CellTitle>
        </Link>
      ),
    }),
    helper.accessor('vin', {
      id: 'vin',
      header: () => t('jobs.vin'),
      cell: ({ getValue }) => <CellMuted mono>{getValue()}</CellMuted>,
    }),
    helper.accessor((row) => handlers.current.serviceName(row), {
      id: 'service',
      header: () => t('jobs.service'),
      cell: ({ getValue }) => <CellMuted>{getValue()}</CellMuted>,
    }),
    helper.accessor('billing_code', {
      id: 'billing',
      header: () => t('jobs.billingCode'),
      cell: ({ row }) => <BillingCell job={row.original} handlers={handlers} />,
    }),
    helper.display({
      id: 'flags',
      header: () => t('jobs.flags'),
      cell: ({ row }) =>
        row.original.duplicate_of_job_id ? (
          <IconButton
            icon="alertTriangle"
            label={t('jobs.duplicateAction')}
            className="border-warn-200 bg-warn-50 text-warn-700"
            onClick={() => handlers.current.openDuplicate(row.original.id)}
          />
        ) : null,
    }),
  ]);

  // Only an admin sees more than one site; for everyone else the column would
  // be the same string repeated 50 times.
  return showSite ? cols : cols.filter((c) => c.id !== 'site');
}

/* -------------------------------------------------------------------- page */

export default function Jobs() {
  const { t, i18n } = useTranslation();
  const { appUser } = useAuth();
  const { sites, siteId, canSwitch } = useSiteScope();

  const [rows, setRows] = useState<JobRow[]>(NO_ROWS);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  /* Paging swapped the rows out from under the reader: you pressed Next at the
     bottom of fifty rows and stayed at the bottom, now looking at row 50 of the
     next page. Send them back to the first row. */
  const goToPage = useCallback((next: (p: number) => number) => {
    setPage(next);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }, []);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [workers, setWorkers] = useState<Pick<AppUser, 'id' | 'name'>[]>([]);

  // Filters. `site` is '' for "every site", which only an admin can choose.
  const [search, setSearch] = useState('');
  const [siteFilter, setSiteFilter] = useState<string | null>(null);
  const [workerFilter, setWorkerFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // The duplicate panel: which row is open, and the job it is a duplicate of.
  const [dupeFor, setDupeFor] = useState<string | null>(null);
  /** `null` = still loading, `'missing'` = the original can't be read. */
  const [original, setOriginal] = useState<JobRow | 'missing' | null>(null);

  // Managers are pinned to their own site; admins start there and may widen.
  useEffect(() => {
    if (siteFilter === null && siteId) setSiteFilter(siteId);
  }, [siteId, siteFilter]);

  const effectiveSite = canSwitch ? siteFilter : siteId;

  /* --------------------------------------------------------------- loading */

  /*
   * Deliberately not gated on the site list having loaded. RLS already scopes a
   * manager to their own site, so an unscoped first query returns the same rows
   * the filter would; an admin gets one extra query on mount, which the debounce
   * below usually swallows. The alternative — waiting for a site id — leaves the
   * grid on a skeleton forever for anyone with no site assigned.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);

    let q = supabase
      .from('jobs')
      .select('*, worker:users!jobs_worker_id_fkey(id,name), service:services(name_en,name_ru)', {
        count: 'exact',
      })
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (effectiveSite) q = q.eq('site_id', effectiveSite);
    if (workerFilter) q = q.eq('worker_id', workerFilter);
    // Dates are local calendar days; the column is a timestamptz, so the day
    // is widened to its full span rather than compared against midnight UTC.
    if (from) q = q.gte('created_at', new Date(`${from}T00:00:00`).toISOString());
    if (to) q = q.lte('created_at', new Date(`${to}T23:59:59.999`).toISOString());

    const term = searchTerm(search);
    if (term) q = q.or(`plate.ilike.%${term}%,vin.ilike.%${term}%,billing_code.ilike.%${term}%`);

    const { data, count, error } = await q;
    if (error) {
      setFailed(true);
      setRows(NO_ROWS);
    } else {
      setRows((data as JobRow[]) ?? NO_ROWS);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [page, effectiveSite, workerFilter, from, to, search]);

  // Debounced so typing a plate doesn't fire a query per keystroke.
  useEffect(() => {
    const id = setTimeout(() => void load(), 250);
    return () => clearTimeout(id);
  }, [load]);

  // Any change to the filters invalidates the page number.
  useEffect(() => {
    setPage(0);
  }, [effectiveSite, workerFilter, from, to, search]);

  // The worker filter lists the people who can appear in the current scope.
  useEffect(() => {
    let q = supabase.from('users').select('id,name').order('name');
    if (effectiveSite) q = q.eq('site_id', effectiveSite);
    void q.then(({ data }) => setWorkers(data ?? []));
  }, [effectiveSite]);

  /* --------------------------------------------------------------- actions */

  const siteName = useCallback(
    (id: string) => sites.find((s) => s.id === id)?.name ?? '—',
    [sites],
  );

  const serviceName = useCallback(
    (job: JobRow): string => localizedServiceName(job.service, i18n.language) ?? '—',
    [i18n.language],
  );

  const saveBillingCode = useCallback(
    async (job: JobRow, value: string) => {
      if (!appUser) return false;
      const billing_code = value || null;
      const { error } = await supabase.from('jobs').update({ billing_code }).eq('id', job.id);
      if (error) return false;
      await recordAudit(job.id, appUser.id, 'update', { billing_code });
      // Patch in place instead of refetching: a reload would move the row out
      // from under a manager who is typing down the column.
      setRows((prev) => prev.map((r) => (r.id === job.id ? { ...r, billing_code } : r)));
      return true;
    },
    [appUser],
  );

  const openDuplicate = useCallback((jobId: string) => {
    setOriginal(null);
    setDupeFor((current) => (current === jobId ? null : jobId));
  }, []);

  /*
   * Fetch the job this one duplicates, only once its panel is opened.
   *
   * The original may be unreadable — soft-deleted already, or at a site this
   * manager has no RLS access to. That resolves to `missing` rather than being
   * left as `null`, because the two look identical to the skeleton and one of
   * them never ends.
   */
  useEffect(() => {
    const copy = rows.find((r) => r.id === dupeFor);
    if (!copy?.duplicate_of_job_id) return;
    let cancelled = false;
    void supabase
      .from('jobs')
      .select('*, worker:users!jobs_worker_id_fkey(id,name), service:services(name_en,name_ru)')
      .eq('id', copy.duplicate_of_job_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setOriginal((data as JobRow) ?? 'missing');
      });
    return () => {
      cancelled = true;
    };
  }, [dupeFor, rows]);

  async function deleteCopy(job: JobRow) {
    if (!appUser) return;
    await supabase.from('jobs').update({ deleted_at: new Date().toISOString() }).eq('id', job.id);
    await recordAudit(job.id, appUser.id, 'soft_delete', { reason: 'duplicate' });
    setDupeFor(null);
    setRows((prev) => prev.filter((r) => r.id !== job.id));
    setTotal((n) => Math.max(0, n - 1));
  }

  /* ----------------------------------------------------------------- table */

  const handlers = useRef<Handlers>({
    saveBillingCode,
    openDuplicate,
    siteName,
    serviceName,
    locale: i18n.language,
  });
  // Refreshed every render, but the ref identity never changes — so `columns`
  // below can be built once and still call the current closures.
  handlers.current = { saveBillingCode, openDuplicate, siteName, serviceName, locale: i18n.language };

  const columns = useMemo(
    () => buildColumns(t, handlers, canSwitch),
    [t, canSwitch],
  );

  const table = useTable({ features, columns, data: rows });

  const columnCount = columns.length;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const firstShown = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastShown = Math.min(total, page * PAGE_SIZE + rows.length);
  const filtered = Boolean(search || workerFilter || from || to || (canSwitch && siteFilter));

  return (
    <Page width="wide">
      <PageHeading lead={t('jobs.lead')}>{t('jobs.title')}</PageHeading>

      {/* The table, the states it can be in, and its pager. */}
      <Group>
        <TableCard
          toolbar={
            <div className="space-y-2">
              <SearchField value={search} onChange={setSearch} label={t('jobs.search')} />

              <div className="flex flex-wrap items-end gap-2">
                {canSwitch && (
                  <label className="min-w-40 flex-1">
                    <span className="mb-1 block text-xs font-medium text-ink-600">{t('jobs.site')}</span>
                    <Select value={siteFilter ?? ''} onChange={(e) => setSiteFilter(e.target.value)}>
                      <option value="">{t('jobs.allSites')}</option>
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}

                <label className="min-w-40 flex-1">
                  <span className="mb-1 block text-xs font-medium text-ink-600">{t('jobs.worker')}</span>
                  <Select value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)}>
                    <option value="">{t('jobs.allWorkers')}</option>
                    {workers.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="min-w-32 flex-1">
                  <span className="mb-1 block text-xs font-medium text-ink-600">{t('jobs.from')}</span>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={fieldClass} />
                </label>

                <label className="min-w-32 flex-1">
                  <span className="mb-1 block text-xs font-medium text-ink-600">{t('jobs.to')}</span>
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={fieldClass} />
                </label>

                {filtered && (
                  <Button
                    variant="secondary"
                    icon="x"
                    onClick={() => {
                      setSearch('');
                      setWorkerFilter('');
                      setFrom('');
                      setTo('');
                      if (canSwitch) setSiteFilter(siteId);
                    }}
                  >
                    {t('jobs.clearFilters')}
                  </Button>
                )}
              </div>
            </div>
          }
        >
          <Table minWidth={68}>
            <THead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <Th key={header.id} align={header.column.id === 'flags' ? 'end' : 'start'}>
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                    </Th>
                  ))}
                </tr>
              ))}
            </THead>
            <TBody>
              {loading &&
                rows.length === 0 &&
                Array.from({ length: 6 }).map((_, i) => (
                  <Tr key={`skeleton-${i}`}>
                    {Array.from({ length: columnCount }).map((__, j) => (
                      <Td key={j}>
                        <Skeleton className="h-4 w-full" />
                      </Td>
                    ))}
                  </Tr>
                ))}

              {/* A row and its duplicate panel are two <tr>s that belong together —
                  a Fragment keys them as one unit without wrapping them in an
                  element <tbody> would reject. */}
              {table.getRowModel().rows.map((row) => (
                <Fragment key={row.id}>
                <Tr active={dupeFor === row.original.id}>
                  {row.getAllCells().map((cell) => (
                    <Td key={cell.id} align={cell.column.id === 'flags' ? 'end' : 'start'}>
                      <table.FlexRender cell={cell} />
                    </Td>
                  ))}
                </Tr>

                {dupeFor === row.original.id && (
                  <TrExpanded colSpan={columnCount}>
                    {original === null ? (
                      <Skeleton className="h-24 w-full" />
                    ) : original === 'missing' ? (
                      // Still offer the delete: the flag is on this row, and the
                      // manager can see the row it flags even if we can't.
                      <ConfirmPanel
                        icon="trash"
                        question={t('jobs.duplicateUnknown')}
                        confirmLabel={t('jobs.deleteCopy')}
                        onConfirm={() => void deleteCopy(row.original)}
                        onCancel={() => setDupeFor(null)}
                      />
                    ) : (
                      <ConfirmPanel
                        icon="trash"
                        question={t('jobs.duplicateQuestion', {
                          plate: original.plate,
                          date: new Date(original.created_at).toLocaleString(i18n.language, {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          }),
                          worker: original.worker?.name ?? '—',
                          service: serviceName(original),
                        })}
                        confirmLabel={t('jobs.deleteCopy')}
                        onConfirm={() => void deleteCopy(row.original)}
                        onCancel={() => setDupeFor(null)}
                      />
                    )}
                  </TrExpanded>
                )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        </TableCard>

        {failed && (
          <EmptyState icon="alertCircle" title={t('common.error')} action={<Button icon="sync" onClick={() => void load()}>{t('common.retry')}</Button>} />
        )}

        {!loading && !failed && total === 0 && (
          <EmptyState
            icon={filtered ? 'search' : 'clipboard'}
            title={filtered ? t('jobs.noMatchesTitle') : t('jobs.emptyTitle')}
            body={filtered ? t('jobs.noMatchesBody') : t('jobs.emptyBody')}
          />
        )}

        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-600" role="status" aria-live="polite">
              {t('jobs.showing', { first: firstShown, last: lastShown, total })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                icon="chevronLeft"
                disabled={page === 0 || loading}
                onClick={() => goToPage((p) => Math.max(0, p - 1))}
              >
                {t('jobs.prev')}
              </Button>
              <span className="text-sm font-medium tabular-nums text-ink-700">
                {t('jobs.pageOf', { page: page + 1, pages: lastPage + 1 })}
              </span>
              <Button
                variant="secondary"
                icon="chevronRight"
                disabled={page >= lastPage || loading}
                onClick={() => goToPage((p) => Math.min(lastPage, p + 1))}
              >
                {t('jobs.next')}
              </Button>
            </div>
          </div>
        )}
      </Group>
    </Page>
  );
}
