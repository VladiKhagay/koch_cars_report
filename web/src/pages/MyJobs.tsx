/**
 * My Jobs — the worker's own record of the month, as a grid.
 *
 * This used to be a stack of cards. A worker checking "did that car go in, and
 * did I put the right service on it" reads down one column; cards made that
 * twenty separate reads. It is the same shape as the manager's jobs grid
 * (pages/Jobs.tsx) and shares its table primitives, so there is one table
 * behaviour in this app rather than two.
 *
 * Like that grid, the database owns the row set: the month window, the sort and
 * the paging are all query parameters, not client-side row models. The offline
 * queue is the exception — those jobs do not exist server-side yet, so they
 * stay above the table as their own list.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { serviceName } from '../lib/serviceName';
import { applyJobFilters } from '../lib/jobs';
import { buildMyJobsSheet } from '../lib/exports';
import { monthKey, monthRange, presetFor, rangeFor, type Preset } from '../lib/dateRange';
import { useQueuedJobs } from '../lib/useQueue';
import type { Job, Service } from '../lib/types';
import Icon from '../components/Icon';
import MonthNav from '../components/MonthNav';
import ServiceChips from '../components/ServiceChips';
import StatusBanner from '../components/StatusBanner';
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
  Badge,
  Button,
  Card,
  EmptyState,
  Group,
  Page,
  PageHeading,
  SearchField,
  SectionHeading,
  Select,
  Skeleton,
  fieldClass,
} from '../components/ui';

const PAGE_SIZE = 25;

/** Stable identity: a fresh `[]` fallback would invalidate the table's models. */
const NO_ROWS: Job[] = [];

/** Whole minutes left in the 15-minute edit window, or 0 once it has closed. */
function minutesLeft(lockedAt: string): number {
  return Math.max(0, Math.ceil((new Date(lockedAt).getTime() - Date.now()) / 60_000));
}

/**
 * How many rows one export request asks for.
 *
 * PostgREST caps a response server-side (1000 by default), so a three-month
 * window at this yard's volume comes back silently truncated if it is asked for
 * in one go — a spreadsheet missing its last two months with nothing to say so.
 * The export pages through until a short page proves it reached the end.
 */
const EXPORT_CHUNK = 1000;

/** How long a worker gets to stop typing before the plate search hits Postgres. */
const SEARCH_DEBOUNCE_MS = 350;

/** The quick-select options, in the order they are offered. */
const PRESETS: Preset[] = ['thisMonth', 'lastMonth', 'last3Months', 'custom'];

/** Same label treatment as the manager's grid — one label size in this app. */
const filterLabelClass = 'mb-2 block text-sm font-medium text-ink-700';

/** The columns the database can actually order by. */
type SortKey = 'created_at' | 'plate' | 'brand';
interface Sort {
  key: SortKey;
  asc: boolean;
}

/**
 * No row models are registered: sorting and paging happen in Postgres, so a
 * client-side model would re-derive the wrong answer from the 25 rows in hand.
 */
const features = tableFeatures({});
const helper = createColumnHelper<typeof features, Job>();

/** Everything the cells call back into. Held in a ref so `columns` stays stable. */
interface Handlers {
  serviceLabel: (id: string | null) => string;
  startEdit: (job: Job) => void;
  editingId: string | null;
  locale: string;
}

function buildColumns(
  t: (key: string, opts?: Record<string, unknown>) => string,
  handlers: React.RefObject<Handlers>,
) {
  return helper.columns([
    helper.accessor('created_at', {
      id: 'created_at',
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
    // No separate VIN column here, so a plate-less job is still identified by
    // something rather than showing a blank cell.
    helper.accessor((row) => row.plate ?? row.vin ?? '—', {
      id: 'plate',
      header: () => t('jobs.plate'),
      cell: ({ getValue }) => <CellTitle mono>{getValue()}</CellTitle>,
    }),
    helper.accessor((row) => row.brand ?? '—', {
      id: 'brand',
      header: () => t('newJob.brand'),
      cell: ({ getValue }) => <CellMuted>{getValue()}</CellMuted>,
    }),
    helper.accessor((row) => handlers.current.serviceLabel(row.service_id), {
      id: 'service',
      header: () => t('jobs.service'),
      cell: ({ getValue }) => <CellMuted>{getValue()}</CellMuted>,
    }),
    helper.display({
      id: 'status',
      header: () => t('myJobs.status'),
      /* The edit window is shown as time remaining, not as a binary. A worker
         who sees "3 min left to edit" walks over; one who sees only "Locked"
         has already lost the option they came for. */
      cell: ({ row }) => {
        const remaining = minutesLeft(row.original.locked_at);
        return remaining > 0 ? (
          <Badge tone="ok" icon="clock">
            {remaining <= 1 ? t('myJobs.editableSoon') : t('myJobs.editableFor', { minutes: remaining })}
          </Badge>
        ) : (
          <Badge tone="neutral" icon="lock">
            {t('myJobs.locked')}
          </Badge>
        );
      },
    }),
    helper.display({
      id: 'actions',
      header: () => t('myJobs.actions'),
      cell: ({ row }) =>
        minutesLeft(row.original.locked_at) > 0 && handlers.current.editingId !== row.original.id ? (
          <Button variant="secondary" icon="pencil" onClick={() => handlers.current.startEdit(row.original)}>
            {t('newJob.edit')}
          </Button>
        ) : null,
    }),
  ]);
}

/**
 * The one column a phone drops. Date, plate, work and status are what the
 * worker came for; the brand is the one they already know by looking at the car.
 */
const HIDE_BELOW: Record<string, 'sm' | 'md' | undefined> = { brand: 'md' };
const SORTABLE: Record<string, SortKey | undefined> = {
  created_at: 'created_at',
  plate: 'plate',
  brand: 'brand',
};

export default function MyJobs() {
  const { t, i18n } = useTranslation();
  const { appUser } = useAuth();
  const queued = useQueuedJobs();

  const [jobs, setJobs] = useState<Job[]>(NO_ROWS);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<Sort>({ key: 'created_at', asc: false });
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<Service[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ note: string; serviceId: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [, forceTick] = useState(0);
  const [exporting, setExporting] = useState(false);
  /* Named outcomes rather than a button that silently stops spinning: on a
     phone the download itself is a notification the worker may not see, and one
     that failed looks exactly like one that worked. */
  const [exported, setExported] = useState<'done' | 'error' | null>(null);

  /* ------------------------------------------------------------- filters */

  /*
   * The filters live in the URL, not in component state. That is what makes
   * them survive the trip into a job and back — the browser restores the query
   * string, so a worker who taps into a car and comes back is still looking at
   * the same window instead of at "this month" again. It also makes the view
   * something they can send to a manager.
   *
   * Defaults are never written into the URL: an absent `from` means "this
   * month", so a bare /my-jobs is the default view and "clear all" is simply
   * dropping every parameter.
   */
  const [params, setParams] = useSearchParams();
  const thisMonth = useMemo(() => rangeFor('thisMonth'), []);
  const search = params.get('q') ?? '';
  const from = params.get('from') || thisMonth.from;
  const to = params.get('to') || thisMonth.to;
  const svcParam = params.get('svc') ?? '';
  // Memoised on the raw string so the array identity is stable between renders
  // — it is a dependency of the loader.
  const serviceIds = useMemo(() => svcParam.split(',').filter(Boolean), [svcParam]);

  const setFilters = useCallback(
    (patch: Partial<Record<'q' | 'from' | 'to' | 'svc', string | null>>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        // Replace rather than push: a debounced search would otherwise stack one
        // history entry per pause in typing, and Back would walk them one by one.
        { replace: true },
      );
    },
    [setParams],
  );

  // The search box is local so it stays responsive, and reaches the URL — and
  // therefore the database — only once typing pauses.
  const [term, setTerm] = useState(search);
  useEffect(() => setTerm(search), [search]);
  useEffect(() => {
    if (term === search) return;
    const id = setTimeout(() => setFilters({ q: term || null }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [term, search, setFilters]);

  const preset = presetFor({ from, to });
  const filtered = Boolean(search || serviceIds.length || preset !== 'thisMonth');
  const activeCount = (search ? 1 : 0) + (serviceIds.length ? 1 : 0) + (preset === 'thisMonth' ? 0 : 1);
  // Open on arrival only if a filter is already narrowing the list — otherwise
  // the toolbar stays one row tall on a phone. Toggled by hand after that.
  const [showFilters, setShowFilters] = useState(filtered);

  /** True when the window is exactly one calendar month, which month nav needs. */
  const shownMonth = monthKey(from);
  const wholeMonth = from === monthRange(shownMonth).from && to === monthRange(shownMonth).to;

  const load = useCallback(async () => {
    if (!appUser) return;
    setLoading(true);
    /* The narrowing happens in Postgres, for the same reason the manager's grid
       does it there: a page of 25 rows filtered in the browser is the wrong 25
       rows — the car being looked for is usually not on it.

       `searchColumns` is plate-only: this view has no billing_code column, and
       PostgREST fails the whole query when asked to filter one that isn't
       there. The service now rides on the job row itself, so there is no second
       round-trip to resolve links. */
    const { data, count } = await applyJobFilters(
      supabase
        .from('jobs_worker_view')
        .select('*', { count: 'exact' })
        .eq('worker_id', appUser.id)
        .order(sort.key, { ascending: sort.asc })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1),
      { from, to, serviceIds, search, searchColumns: ['plate'] },
    );

    setJobs(data ?? NO_ROWS);
    setTotal(count ?? 0);
    setLoading(false);
  }, [appUser, from, to, serviceIds, search, sort, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any change to the filters invalidates the page number and any open editor.
  useEffect(() => {
    setPage(0);
    setEditingId(null);
    // The last export covered the previous window; saying it "downloaded" under
    // a different set of filters claims a file that does not contain these rows.
    setExported(null);
  }, [from, to, svcParam, search]);

  useEffect(() => {
    if (!appUser) return;
    void supabase
      .from('services')
      .select('*')
      .eq('active', true)
      .order('sort_order')
      .then(({ data }) => setServices(data ?? []));
    // Re-render every 20s so the remaining edit time counts down live.
    const interval = setInterval(() => forceTick((n) => n + 1), 20_000);
    return () => clearInterval(interval);
  }, [appUser]);

  const serviceLabel = useCallback(
    (id: string | null) =>
      (id ? serviceName(services.find((s) => s.id === id), i18n.language) : null) ?? t('myJobs.noService'),
    [services, i18n.language, t],
  );

  const startEdit = useCallback((job: Job) => {
    setEditingId(job.id);
    setEditDraft({ note: job.worker_note ?? '', serviceId: job.service_id });
  }, []);

  async function saveEdit(jobId: string) {
    if (!editDraft) return;
    setSaving(true);
    // One row, one write. worker_price is not sent: the database trigger
    // re-stamps it from the catalog whenever service_id changes.
    await supabase
      .from('jobs')
      .update({ worker_note: editDraft.note || null, service_id: editDraft.serviceId })
      .eq('id', jobId);
    setSaving(false);
    setEditingId(null);
    await load();
  }

  /* ---------------------------------------------------------------- export */

  /**
   * Every job the current filters select — not the page on screen.
   *
   * Same query as `load`, same filters, same sort, minus the paging: a worker
   * exporting "last 3 months" means the three months, and a file containing
   * only the 25 rows that happened to be visible is worse than no file, because
   * it looks complete.
   */
  async function fetchAllFiltered(): Promise<Job[] | null> {
    const all: Job[] = [];
    for (let start = 0; ; start += EXPORT_CHUNK) {
      const { data, error } = await applyJobFilters(
        supabase
          .from('jobs_worker_view')
          .select('*')
          .eq('worker_id', appUser!.id)
          .order(sort.key, { ascending: sort.asc })
          .range(start, start + EXPORT_CHUNK - 1),
        { from, to, serviceIds, search, searchColumns: ['plate'] },
      );
      if (error) return null;
      all.push(...((data ?? []) as Job[]));
      // A short page is the end of the set. A full one may not be.
      if (!data || data.length < EXPORT_CHUNK) return all;
    }
  }

  async function exportSheet() {
    setExporting(true);
    setExported(null);
    try {
      const rows = await fetchAllFiltered();
      if (!rows) throw new Error('query failed');

      const sheetRows = buildMyJobsSheet(
        rows.map((job) => ({ ...job, service: serviceLabel(job.service_id) })),
        // The sheet's headers are the table's headers, in the reader's language.
        [t('jobs.date'), t('jobs.plate'), t('newJob.brand'), t('jobs.service')],
      );

      // Loaded on demand, as on the manager's export screen: a sizeable library
      // is not worth shipping to every worker who only ever logs cars.
      const XLSX = await import('xlsx');
      const sheet = XLSX.utils.aoa_to_sheet(sheetRows, { cellDates: true });
      /* Excel's default date format drops the time, and two cars on the same
         morning are told apart by exactly that. Applied per cell because the
         free build of SheetJS has no column-level format. */
      for (let r = 1; r < sheetRows.length; r++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
        if (cell) cell.z = 'yyyy-mm-dd hh:mm';
      }

      const book = XLSX.utils.book_new();
      // Hebrew reads right to left, and so should the sheet it opens into —
      // otherwise the first column lands where the reader's eye finishes.
      if (i18n.dir() === 'rtl') book.Workbook = { Views: [{ RTL: true }] };
      XLSX.utils.book_append_sheet(book, sheet, 'Jobs');
      // The window is in the name: these land in a Downloads folder a month at
      // a time, and "my-jobs.xlsx (3)" is not something anybody can tell apart.
      XLSX.writeFile(book, `my-jobs-${from}-to-${to}.xlsx`);
      setExported('done');
    } catch {
      setExported('error');
    } finally {
      setExporting(false);
    }
  }

  /* ----------------------------------------------------------------- table */

  const handlers = useRef<Handlers>({ serviceLabel, startEdit, editingId, locale: i18n.language });
  // Refreshed every render, but the ref identity never changes — so `columns`
  // below can be built once and still call the current closures.
  handlers.current = { serviceLabel, startEdit, editingId, locale: i18n.language };

  const columns = useMemo(() => buildColumns(t, handlers), [t]);
  const table = useTable({ features, columns, data: jobs });

  /* Paging swapped the rows out from under the reader: you pressed Next at the
     bottom of the page and stayed at the bottom. Send them back to the top. */
  function goToPage(next: (p: number) => number) {
    setPage(next);
    setEditingId(null);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The shell scrolls <main>, not the window.
    document.getElementById('main')?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }

  function toggleSort(key: SortKey) {
    // A new column starts newest-first for dates, A-first for names; the same
    // column flips.
    setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: key !== 'created_at' }));
    setPage(0);
    setEditingId(null);
  }

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const firstShown = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastShown = Math.min(total, page * PAGE_SIZE + jobs.length);
  const columnCount = columns.length;
  const rangeLabel = [from, to]
    .map((d) => new Date(`${d}T00:00:00`).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short' }))
    .join(' – ');

  return (
    <Page width="wide">
      <PageHeading lead={t('myJobs.lead')}>{t('myJobs.title')}</PageHeading>

      {/*
        Jobs that failed to reach the server are listed FIRST and as real
        entries, not as a count in a banner. Previously this screen read
        straight from Supabase, so the cars most at risk of being lost were
        exactly the ones missing from the worker's own record. They are not
        rows in the table: they have no id, no status, and nothing to sort by.
      */}
      {queued.length > 0 && (
        <section className="space-y-2">
          <SectionHeading icon="sync">{t('queue.title')}</SectionHeading>
          <p className="text-sm text-ink-600">{t('queue.body')}</p>
          {queued.map((job) => (
            <Card key={job.queuedId} className={job.needsAttention ? 'border-danger-600' : 'border-ink-900'}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-base font-semibold tracking-wide text-ink-900">
                    {job.plate ?? job.vin ?? '—'}
                  </p>
                  <p className="truncate font-mono text-xs text-ink-600">
                    {(job.plate ? job.vin : null) ?? '—'} · {job.brand ?? '—'}
                  </p>
                  <p className="mt-1 text-xs text-ink-600">
                    {job.needsAttention ? t('myJobs.needsAttentionHint') : t('myJobs.queuedHint')}
                  </p>
                </div>
                {job.needsAttention ? (
                  <Badge tone="danger" icon="alertTriangle">
                    {t('myJobs.needsAttention')}
                  </Badge>
                ) : (
                  <Badge tone="info" icon="sync">
                    {t('queue.title')}
                  </Badge>
                )}
              </div>
            </Card>
          ))}
        </section>
      )}

      <Group>
        <TableCard
          toolbar={
            <div className="space-y-3">
              {/*
                Month navigation, first and largest: the month is the window
                this screen is read through, and stepping back one month is the
                thing a worker does far more often than typing a date. Shared
                with "My Stats", which is read through the same window.

                It is only shown when the window IS one calendar month. Arrows
                over a three-month range would claim to be showing June while
                the table shows June to August.
              */}
              {wholeMonth ? (
                <MonthNav month={shownMonth} onChange={(m) => setFilters(monthRange(m))} />
              ) : (
                <p className="text-center text-sm font-semibold text-ink-900">{rangeLabel}</p>
              )}

              <SearchField value={term} onChange={setTerm} label={t('myJobs.searchPlate')} />

              {/*
                The rest folds away. This screen is read on a phone held in one
                hand next to a car: month, search and the first rows of the
                table have to fit above the fold, and a permanently open bank of
                five controls pushes the table off the screen on a 360px
                viewport. It opens by itself when a filter is already on — from a
                shared link or a return trip — because a hidden filter that is
                silently narrowing the list is worse than a tall toolbar.
              */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  icon={showFilters ? 'chevronDown' : 'tag'}
                  aria-expanded={showFilters}
                  onClick={() => setShowFilters((v) => !v)}
                >
                  {t('myJobs.filters')}
                </Button>
                {/* Next to the filters, because what it exports is what the
                    filters selected — all of it, not the page on screen. It is
                    dead while the table is empty: there is no file to make. */}
                <Button
                  variant="secondary"
                  icon="download"
                  busy={exporting}
                  disabled={total === 0 || loading || exporting}
                  onClick={() => void exportSheet()}
                >
                  {t('myJobs.exportExcel')}
                </Button>
                {filtered && (
                  <>
                    <Badge tone="info" icon="tag">
                      {t('myJobs.activeFilters', { count: activeCount })}
                    </Badge>
                    <Button
                      variant="secondary"
                      icon="x"
                      className="ms-auto"
                      onClick={() => {
                        setTerm('');
                        // Every filter is a URL parameter, so clearing them all
                        // is an empty query string — which is the default view.
                        setParams(new URLSearchParams(), { replace: true });
                      }}
                    >
                      {t('jobs.clearFilters')}
                    </Button>
                  </>
                )}
              </div>

              {exported && (
                <StatusBanner tone={exported === 'done' ? 'success' : 'error'} live>
                  {exported === 'done'
                    ? t('myJobs.exportDone')
                    : t('myJobs.exportFailed')}
                </StatusBanner>
              )}

              {showFilters && (
                <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="basis-full sm:min-w-40 sm:flex-1 sm:basis-auto">
                  <span className={filterLabelClass}>{t('myJobs.range')}</span>
                  <Select
                    value={preset}
                    onChange={(e) => {
                      const next = e.target.value as Preset;
                      // "Custom" is where the two date fields already are — it
                      // selects nothing, it just stops claiming a named window.
                      if (next !== 'custom') setFilters(rangeFor(next));
                    }}
                  >
                    {PRESETS.map((p) => (
                      <option key={p} value={p}>
                        {t(`myJobs.preset.${p}`)}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="min-w-32 flex-1">
                  <span className={filterLabelClass}>{t('jobs.from')}</span>
                  <input
                    type="date"
                    value={from}
                    max={to}
                    onChange={(e) => setFilters({ from: e.target.value })}
                    className={fieldClass}
                  />
                </label>

                <label className="min-w-32 flex-1">
                  <span className={filterLabelClass}>{t('jobs.to')}</span>
                  <input
                    type="date"
                    value={to}
                    min={from}
                    onChange={(e) => setFilters({ to: e.target.value })}
                    className={fieldClass}
                  />
                </label>
              </div>

              {/*
                Services as toggles, not a multi-select list box: a worker picks
                these with a thumb, and every one of them is visible without
                opening anything. Same chip shape as the job form's service
                picker, but checkboxes — several may be on at once — so the
                pressed state is announced rather than merely drawn.
              */}
              {services.length > 0 && (
                <fieldset>
                  <legend className={filterLabelClass}>{t('jobs.service')}</legend>
                  <div className="flex flex-wrap gap-2">
                    {services.map((service) => {
                      const on = serviceIds.includes(service.id);
                      return (
                        <button
                          key={service.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setFilters({
                              svc:
                                (on
                                  ? serviceIds.filter((id) => id !== service.id)
                                  : [...serviceIds, service.id]
                                ).join(',') || null,
                            })
                          }
                          className={`inline-flex min-h-tap items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors duration-150 ${
                            on
                              ? 'border-ink-900 bg-ink-900 text-surface'
                              : 'border-line-strong bg-surface text-ink-900 hover:bg-ink-50'
                          }`}
                        >
                          <Icon
                            name={on ? 'check' : 'plus'}
                            size={16}
                            className={on ? 'shrink-0' : 'shrink-0 text-ink-500'}
                          />
                          <span className="text-start">{serviceName(service, i18n.language)}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
                </div>
              )}
            </div>
          }
        >
          <Table minWidth={56}>
            <THead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => {
                    const sortKey = SORTABLE[header.column.id];
                    const active = sortKey === sort.key;
                    return (
                      <Th
                        key={header.id}
                        hideBelow={HIDE_BELOW[header.column.id]}
                        align={header.column.id === 'actions' ? 'end' : 'start'}
                        // aria-sort belongs on the header cell, not the button.
                        className={active ? 'text-ink-900' : ''}
                        ariaSort={sortKey ? (active ? (sort.asc ? 'ascending' : 'descending') : 'none') : undefined}
                      >
                        {header.isPlaceholder ? null : sortKey ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(sortKey)}
                            className="inline-flex items-center gap-1 hover:text-ink-900"
                          >
                            <table.FlexRender header={header} />
                            {active && <Icon name={sort.asc ? 'arrowUp' : 'arrowDown'} size={12} />}
                          </button>
                        ) : (
                          <table.FlexRender header={header} />
                        )}
                      </Th>
                    );
                  })}
                </tr>
              ))}
            </THead>
            <TBody>
              {loading &&
                jobs.length === 0 &&
                Array.from({ length: 6 }).map((_, i) => (
                  <Tr key={`skeleton-${i}`}>
                    {Array.from({ length: columnCount }).map((__, j) => (
                      <Td key={j}>
                        <Skeleton className="h-4 w-full" />
                      </Td>
                    ))}
                  </Tr>
                ))}

              {/* A row and its edit panel are two <tr>s that belong together — a
                  Fragment keys them as one unit without wrapping them in an
                  element <tbody> would reject. */}
              {table.getRowModel().rows.map((row) => (
                <Fragment key={row.id}>
                  <Tr active={editingId === row.original.id}>
                    {row.getAllCells().map((cell) => (
                      <Td
                        key={cell.id}
                        hideBelow={HIDE_BELOW[cell.column.id]}
                        align={cell.column.id === 'actions' ? 'end' : 'start'}
                      >
                        <table.FlexRender cell={cell} />
                      </Td>
                    ))}
                  </Tr>

                  {editingId === row.original.id && editDraft && (
                    <TrExpanded colSpan={columnCount}>
                      <div className="space-y-4">
                        <ServiceChips
                          services={services}
                          selected={editDraft.serviceId}
                          onSelect={(id) => setEditDraft((d) => (d ? { ...d, serviceId: id } : d))}
                          label={t('newJob.service')}
                        />
                        <textarea
                          value={editDraft.note}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, note: e.target.value } : d))}
                          rows={2}
                          className="w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-base text-ink-900 focus:border-ink-900"
                          placeholder={t('newJob.note')}
                        />
                        <div className="flex gap-2">
                          <Button busy={saving} icon="check" onClick={() => void saveEdit(row.original.id)}>
                            {t('jobDetail.save')}
                          </Button>
                          <Button variant="secondary" onClick={() => setEditingId(null)}>
                            {t('common.cancel')}
                          </Button>
                        </div>
                      </div>
                    </TrExpanded>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        </TableCard>

        {/* The month is the default window, so an empty month is the common
            empty state — not "you have never logged a car". Once a filter is on,
            the answer is about the filter, and the way out is to widen it. */}
        {!loading && total === 0 && (
          <EmptyState
            icon={filtered ? 'search' : 'clipboard'}
            title={filtered ? t('jobs.noMatchesTitle') : t('myJobs.emptyMonthTitle')}
            body={filtered ? t('jobs.noMatchesBody') : t('myJobs.emptyBody')}
          />
        )}

        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-600" role="status" aria-live="polite">
              {t('jobs.showing', { first: firstShown, last: lastShown, total })}
            </p>
            {lastPage > 0 && (
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
            )}
          </div>
        )}
      </Group>
    </Page>
  );
}
