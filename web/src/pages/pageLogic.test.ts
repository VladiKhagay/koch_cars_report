import { describe, expect, it } from 'vitest';
import { carassoRow, gridColumnPlan, gridRows, managerRow } from './jobsGrid';
import { customerRows, mergeColumnSubset, paymentJobs } from './exportColumns';
import { countRows } from './statsSource';
import { lineWrites, missingServices, planJobEdit, type JobFieldDraft, type JobFieldsBase } from './jobDetailLines';
import { toLocalInput } from '../lib/formatDate';
import { describePreviousJob } from '../components/previousJob';
import type { CarassoJob, JobDailyStat, JobDailyTotal } from '../lib/types';
import { buildCustomerReport, buildWorkerPaymentReport, type Cell } from '../lib/exports';
import { resolveCustomerColumns } from '../lib/reportConfig';
import { shareFor } from '../lib/jobs';

const job: CarassoJob = {
  id: 'j1',
  site_id: 's1',
  site_name: 'Haifa',
  created_at: '2026-03-02T08:00:00Z',
  plate: '1234567',
  vin: null,
  brand: 'Toyota',
  worker_note: null,
  service_id: 'sv',
  service_name_en: 'Wash',
  service_name_ru: null,
  service_name_he: 'שטיפה',
  catalog_number: 'X1',
  billing_code: 'R-1',
  worker_id: null,
  coworker_ids: [],
  crew: null,
  client_unit_price: 10,
  client_total_price: 50,
};

describe('Carasso jobs grid', () => {
  it('carries no money, duplicate flag or worker through to the row', () => {
    const row = carassoRow(job);
    expect(row.duplicate_of_job_id).toBeNull();
    expect(row.worker).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/price|share/i);
  });

  it('read-only, no flags, and no crew column while names are hidden', () => {
    const hidden = gridColumnPlan({ isCarasso: true, showSite: true, hideNames: true });
    expect(hidden).toEqual({ site: true, worker: false, editBilling: false, flags: false });
    expect(gridColumnPlan({ isCarasso: true, showSite: false, hideNames: false }).worker).toBe(true);
  });

  it('managers and admins keep billing edit, flags and the crew', () => {
    expect(gridColumnPlan({ isCarasso: false, showSite: false, hideNames: true })).toEqual({
      site: false,
      worker: true,
      editBilling: true,
      flags: true,
    });
  });
});

describe('export column subset', () => {
  const full = [
    { key: 'date', visible: true },
    { key: 'site', visible: true },
    { key: 'plate', visible: true },
  ] as const;

  it('keeps columns that were not offered (Site) in place when the rest are reordered', () => {
    const merged = mergeColumnSubset([...full], [full[2], full[0]]);
    expect(merged.map((c) => c.key)).toEqual(['plate', 'site', 'date']);
  });
});

describe('previous job text', () => {
  it('falls back to English and says nothing about money or people', () => {
    const d = describePreviousJob(
      { created_at: '2026-03-02T08:00:00Z', site_name: 'Haifa', service_name_en: 'Wash', service_name_ru: null, service_name_he: null },
      'he',
    );
    expect(d.service).toBe('Wash');
    expect(Object.keys(d)).toEqual(['date', 'site', 'service']);
  });
});

/* ------------------------------------------------------ multi-service (0033) */

const twoLines: CarassoJob = {
  ...job,
  service_name_en: 'Wash, Polish',
  service_name_he: 'שטיפה, Polish',
  catalog_number: 'X1, X2',
  client_unit_price: 30,
  client_total_price: 80,
  service_ids: ['a', 'b'],
  services: [
    { service_id: 'a', name_en: 'Wash', name_ru: null, name_he: 'שטיפה', catalog_number: 'X1', client_unit_price: 10, client_total_price: 50 },
    { service_id: 'b', name_en: 'Polish', name_ru: null, name_he: null, catalog_number: 'X2', client_unit_price: 20, client_total_price: 30 },
  ],
};

describe('jobs grid service rows', () => {
  it('Carasso rows keep the service names and no client prices', () => {
    const row = carassoRow(twoLines);
    expect(row.services.map((s) => s.name_en)).toEqual(['Wash', 'Polish']);
    expect(JSON.stringify(row)).not.toMatch(/price|share/i);
  });

  it('a Carasso row without lines falls back to the joined names', () => {
    expect(carassoRow(job).services).toEqual([{ name_en: 'Wash', name_ru: null, name_he: 'שטיפה' }]);
  });

  it('manager rows drop the lines\' pay and shares', () => {
    const row = managerRow({
      id: 'j1', site_id: 's1', created_at: job.created_at, plate: 'P', vin: null, brand: null, billing_code: null,
      duplicate_of_job_id: null, coworker_ids: [], worker: { id: 'w', name: 'Dana' },
      services: [{ name_en: 'Wash', worker_price: 40, submitter_share: 20, coworker_share: 20 } as never],
    });
    expect(row.services).toEqual([{ name_en: 'Wash', name_ru: undefined, name_he: undefined }]);
    expect(JSON.stringify(row)).not.toMatch(/price|share/i);
  });

  it('separate expands only the page; grouped leaves it alone', () => {
    const rows = [carassoRow(twoLines), carassoRow({ ...job, id: 'j2', services: [] })];
    expect(gridRows(rows, 'grouped')).toBe(rows);
    const sep = gridRows(rows, 'separate');
    expect(sep.map((r) => [r.id, r.services.map((s) => s.name_en)])).toEqual([
      ['j1', ['Wash']],
      ['j1', ['Polish']],
      ['j2', []],
    ]);
  });
});

describe('customer report rows', () => {
  it('grouped: one row with the services joined (per-name Hebrew fallback) and the job totals', () => {
    const [row, ...rest] = customerRows([twoLines], 'grouped');
    expect(rest).toHaveLength(0);
    expect(row.service).toEqual({ name_en: 'Wash, Polish', name_he: 'שטיפה, Polish', catalog_number: 'X1, X2' });
    expect([row.client_unit_price, row.client_total_price]).toEqual([30, 80]);
  });

  it('separate: each line with its own name and client prices, never the job totals', () => {
    const rows = customerRows([twoLines], 'separate');
    expect(rows.map((r) => [r.service?.catalog_number, r.client_unit_price, r.client_total_price])).toEqual([
      ['X1', 10, 50],
      ['X2', 20, 30],
    ]);
  });

  it('a job with no lines stays one row with its job-level values', () => {
    const rows = customerRows([{ ...job, services: [] }], 'separate');
    expect(rows).toHaveLength(1);
    expect(rows[0].service?.name_en).toBe('Wash');
    expect(rows[0].client_total_price).toBe(50);
  });
});

describe('analytics count source', () => {
  const totals: JobDailyTotal[] = [
    { site_id: 's', worker_id: 'w1', day: '2026-03-02', job_count: 1, car_count: 1, worker_cost: 60 },
  ];
  // One car, two services: twice in the per-service view.
  const stats: JobDailyStat[] = [
    { site_id: 's', worker_id: 'w1', service_id: 'a', day: '2026-03-02', job_count: 1, car_count: 1, worker_cost: 40 },
    { site_id: 's', worker_id: 'w1', service_id: 'b', day: '2026-03-02', job_count: 1, car_count: 1, worker_cost: 20 },
  ];
  const cars = (rows: { car_count: number }[]) => rows.reduce((n, r) => n + r.car_count, 0);

  it('counts a multi-service car once with no service picked', () => {
    expect(cars(countRows(totals, stats, '', ''))).toBe(1);
  });

  it('counts per service with one picked, and narrows by worker', () => {
    expect(cars(countRows(totals, stats, '', 'b'))).toBe(1);
    expect(countRows(totals, stats, 'w2', '')).toEqual([]);
  });
});

describe('payment sheet jobs', () => {
  const line = (id: string, price: number, sub: number, co: number) => ({
    service_id: id, name_en: id, name_ru: null, name_he: null, catalog_number: id,
    worker_price: price, submitter_share: sub, coworker_share: co,
  });
  const shared = {
    created_at: '2026-03-02T08:00:00Z', plate: 'P', vin: null, brand: null, billing_code: null,
    worker_price: 101, worker_id: 'sub', coworker_ids: ['co'], submitter_share: 50.5, coworker_share: 50.5,
    services: [line('Wash', 60, 30, 30), line('Polish', 41, 20.5, 20.5)],
  };

  it('pays each line at the person\'s line share, never the line price', () => {
    const [j] = paymentJobs([shared], 'co', 'Avi');
    expect(j.services?.map((l) => l.amount)).toEqual([30, 20.5]);
    expect(j.worker).toEqual({ name: 'Avi' });
    expect(JSON.stringify(j.services)).not.toMatch(/worker_price|share/);
  });

  it('a job without lines falls back to the job share', () => {
    const [j] = paymentJobs([{ ...shared, services: null }], 'sub', 'Dana');
    expect(j.services).toEqual([]);
    expect(j.worker_price).toBe(50.5);
  });
});

describe('job detail line writes', () => {
  const defaults = {
    a: { pay: '40', unit: '10', total: '50' },
    b: { pay: '20', unit: '', total: '' }, // new line: catalog pay, no catalog client price
    gone: { pay: '5', unit: '', total: '' },
  };

  it('never writes a removed line, even with a draft', () => {
    expect(lineWrites(['a'], defaults, { gone: { pay: '9' } }).writes).toEqual([]);
  });

  it('leaves an untouched line (new or old) to its snapshot', () => {
    expect(lineWrites(['a', 'b'], defaults, { b: { pay: '20' } }).writes).toEqual([]);
  });

  it('flags pay and client prices separately', () => {
    const { writes, invalid } = lineWrites(['a', 'b'], defaults, { a: { pay: '45' }, b: { unit: '7', total: '7' } });
    expect(invalid).toBe(false);
    expect(writes.map((w) => [w.sid, w.payChanged, w.pricesChanged])).toEqual([
      ['a', true, false],
      ['b', false, true],
    ]);
  });

  it('rejects a cleared pay and a non-numeric price; allows clearing prices', () => {
    expect(lineWrites(['a'], defaults, { a: { pay: '' } }).invalid).toBe(true);
    expect(lineWrites(['a'], defaults, { a: { unit: 'x' } }).invalid).toBe(true);
    expect(lineWrites(['a'], defaults, { a: { unit: '', total: '' } }).invalid).toBe(false);
  });

  it('lets a legacy job with no lines save, but never empties a job that had lines', () => {
    expect(missingServices([], [])).toBe(false);
    expect(missingServices(['a'], [])).toBe(true);
    expect(missingServices([], ['a'])).toBe(false);
    expect(missingServices(['a'], ['b'])).toBe(false);
  });
});

/* ------------------------------------------------- edge cases (0033 QA) */


describe('customer report rows — client prices per line', () => {
  /* One line priced, one not: the job total is NULL in the view (any unpriced line makes it NULL). */
  const partlyPriced: CarassoJob = {
    ...twoLines,
    client_unit_price: null,
    client_total_price: null,
    services: [twoLines.services![0], { ...twoLines.services![1], client_unit_price: null, client_total_price: null }],
  };

  it('separate: an unpriced line prints null, never 0 and never the job total', () => {
    const rows = customerRows([partlyPriced], 'separate');
    expect(rows.map((r) => [r.client_unit_price, r.client_total_price])).toEqual([
      [10, 50],
      [null, null],
    ]);
  });

  it('grouped: the view\'s null job total stays null', () => {
    const [row] = customerRows([partlyPriced], 'grouped');
    expect([row.client_unit_price, row.client_total_price]).toEqual([null, null]);
  });

  it('separate: each row carries only its own line\'s names, with the Hebrew fallback per line', () => {
    const rows = customerRows([twoLines], 'separate');
    expect(rows.map((r) => r.service)).toEqual([
      { name_en: 'Wash', name_he: 'שטיפה', catalog_number: 'X1' },
      { name_en: 'Polish', name_he: 'Polish', catalog_number: 'X2' },
    ]);
  });

  /* Older view rows (no `services` key) and zero-service legacy jobs. */
  it('grouped: a row without a services key reads the joined view columns; no names prints no service', () => {
    const { services: _s, service_ids: _i, ...older } = twoLines;
    expect(customerRows([older], 'grouped')[0].service?.name_en).toBe('Wash, Polish');
    const none = customerRows([{ ...job, service_name_en: null, services: [] }], 'separate');
    expect(none).toHaveLength(1);
    expect(none[0].service).toBeNull();
  });

  it('never carries worker pay into the customer rows', () => {
    for (const mode of ['grouped', 'separate'] as const) {
      for (const r of customerRows([twoLines], mode)) expect(r.worker_price).toBe(0);
    }
  });

  it('separate: the Hebrew customer report prints one service per row with its catalog number', () => {
    const cols = resolveCustomerColumns({
      columns: [
        { key: 'service', visible: true },
        { key: 'catalog_number', visible: true },
      ],
    });
    const sheet = buildCustomerReport(customerRows([twoLines], 'separate'), cols, 'he-IL', 'he');
    expect(sheet.slice(1)).toEqual([
      ['שטיפה', 'X1'],
      ['Polish', 'X2'],
    ]);
  });
});

describe('payment sheet — the real chain, to the cent', () => {
  /* 100.00 = wash 60.01 + polish 39.99, three people. 0019: co-worker 33.33 each,
     submitter 33.34. 0033 lines (all but the last floored, the last takes the rest):
     co-worker 20.00 + 13.33, submitter 20.00 + 13.34. */
  const line = (id: string, he: string | null, price: number, sub: number, co: number) => ({
    service_id: id, name_en: id, name_ru: null, name_he: he, catalog_number: id,
    worker_price: price, submitter_share: sub, coworker_share: co,
  });
  const three = {
    created_at: '2026-03-02T08:00:00Z', plate: 'P', vin: null, brand: null, billing_code: null,
    worker_price: 100, worker_id: 'sub', coworker_ids: ['co1', 'co2'], submitter_share: 33.34, coworker_share: 33.33,
    services: [line('Wash', 'שטיפה', 60.01, 20, 20), line('Polish', null, 39.99, 13.34, 13.33)],
  };
  const data = (rows: Cell[][]) => rows.slice(1, rows.findIndex((r) => r.length === 0));
  const cents = (cells: Cell[]) => Math.round(cells.reduce<number>((a, c) => a + Number(c) * 100, 0));

  it.each([
    ['sub', 'Dana'],
    ['co1', 'Avi'],
  ])('%s: the grouped row is the job share and the separate rows add up to it', (person, name) => {
    const jobs = paymentJobs([three], person, name);
    const share = shareFor(three, person);
    const grouped = buildWorkerPaymentReport(jobs, name, 'en-GB', 'en', 'grouped');
    expect(data(grouped).map((r) => r[5])).toEqual([share]);
    const separate = buildWorkerPaymentReport(jobs, name, 'en-GB', 'en', 'separate');
    expect(data(separate)).toHaveLength(2);
    expect(cents(data(separate).map((r) => r[5]))).toBe(Math.round(share * 100));
    expect(separate[separate.length - 1][5]).toBe(share);
    expect(grouped[grouped.length - 1][5]).toBe(share);
  });

  it('Hebrew separate sheet: an untranslated line falls back to English on its own', () => {
    const rows = buildWorkerPaymentReport(paymentJobs([three], 'sub', 'Dana'), 'Dana', 'he-IL', 'he', 'separate');
    expect(data(rows).map((r) => r[3])).toEqual(['שטיפה', 'Polish']);
    const grouped = buildWorkerPaymentReport(paymentJobs([three], 'sub', 'Dana'), 'Dana', 'he-IL', 'he', 'grouped');
    expect(data(grouped)[0][3]).toBe('שטיפה, Polish');
  });

  /* A zero-service legacy job still pays its job share, in both modes, as one row. */
  it.each(['grouped', 'separate'] as const)('%s: a zero-service legacy job is one row at the job share', (mode) => {
    const legacy = { ...three, services: [] as never[] };
    const rows = buildWorkerPaymentReport(paymentJobs([legacy], 'co2', 'Avi'), 'Avi', 'en-GB', 'en', mode);
    expect(data(rows).map((r) => r[5])).toEqual([33.33]);
  });
});

describe('analytics count source — combined filters', () => {
  const totals: JobDailyTotal[] = [
    { site_id: 's', worker_id: 'w1', day: '2026-03-02', job_count: 1, car_count: 1, worker_cost: 60 },
    { site_id: 's', worker_id: 'w2', day: '2026-03-02', job_count: 1, car_count: 0, worker_cost: 30 },
  ];
  const stats: JobDailyStat[] = [
    { site_id: 's', worker_id: 'w1', service_id: 'a', day: '2026-03-02', job_count: 1, car_count: 1, worker_cost: 40 },
    { site_id: 's', worker_id: 'w2', service_id: 'a', day: '2026-03-02', job_count: 1, car_count: 0, worker_cost: 20 },
    { site_id: 's', worker_id: 'w1', service_id: 'b', day: '2026-03-02', job_count: 1, car_count: 1, worker_cost: 20 },
  ];

  it('worker + service narrows the per-service rows to that person', () => {
    expect(countRows(totals, stats, 'w2', 'a')).toEqual([stats[1]]);
    expect(countRows(totals, stats, 'w2', 'b')).toEqual([]);
  });

  it('a worker with no service picked counts their jobs once, from the totals', () => {
    expect(countRows(totals, stats, 'w1', '').map((r) => r.job_count)).toEqual([1]);
  });
});

describe('jobs grid — separate rows edge cases', () => {
  it('a soft-deleted service on a Carasso row still shows its name', () => {
    const retired = { ...twoLines, services: [{ ...twoLines.services![0], name_en: 'Old wax' }] };
    expect(gridRows([carassoRow(retired)], 'separate').map((r) => r.services[0].name_en)).toEqual(['Old wax']);
  });

  it('separate rows keep the job id and duplicate flag on every row of the job', () => {
    const r = managerRow({
      id: 'j9', site_id: 's1', created_at: job.created_at, plate: 'P', vin: null, brand: null, billing_code: null,
      duplicate_of_job_id: 'j1', coworker_ids: undefined as never, worker: null,
      services: [{ name_en: 'A' }, { name_en: 'B' }],
    });
    const rows = gridRows([r], 'separate');
    expect(rows.map((x) => [x.id, x.duplicate_of_job_id])).toEqual([
      ['j9', 'j1'],
      ['j9', 'j1'],
    ]);
    expect(r.coworker_ids).toEqual([]);
  });
});

describe('previous job text — several services (0033)', () => {
  /* The database joins the names, each falling back to English on its own. */
  it('shows the joined names in the reader\'s language', () => {
    const p = { created_at: '2026-03-02T08:00:00Z', site_name: 'Haifa', service_name_en: 'Wash, Polish', service_name_ru: 'Мойка, Polish', service_name_he: 'Wash, פוליש' };
    expect(describePreviousJob(p, 'ru-RU').service).toBe('Мойка, Polish');
    expect(describePreviousJob(p, 'he').service).toBe('Wash, פוליש');
  });
  it('a zero-service earlier job says —', () => {
    const p = { created_at: '2026-03-02T08:00:00Z', site_name: 'Haifa', service_name_en: null, service_name_ru: null, service_name_he: null };
    expect(describePreviousJob(p, 'en').service).toBe('—');
  });
});

describe('job detail field edit (planJobEdit)', () => {
  // A legacy 7-digit plate: from before today's 8-digit rule. The VIN is required (0036).
  const SAVED_VIN = 'WVWZZZ1JZXW000001';
  const base: JobFieldsBase = {
    plate: '1234567',
    vin: SAVED_VIN,
    brand: 'Kia',
    worker_note: 'scratch',
    created_at: '2026-03-02T08:00:00Z',
    worker_id: 'w1',
    site_id: 's1',
  };
  const now = new Date('2026-03-10T12:00:00Z').getTime();
  const untouched: JobFieldDraft = {
    plate: '1234567',
    vin: SAVED_VIN,
    brand: 'Kia',
    workerNote: 'scratch',
    date: toLocalInput(base.created_at),
    workerId: '',
    coworkerIds: [],
    siteId: '',
  };
  const plan = (d: Partial<JobFieldDraft>) => planJobEdit(base, { ...untouched, ...d }, now);
  const VALID_VIN = '1M8GDM9AXKP042788';
  const BAD_CHECK_DIGIT_VIN = '1M8GDM9A1KP042788';

  it('sends no plate, VIN or date when untouched, and an old invalid plate still saves', () => {
    const r = plan({});
    expect(r.blocked).toBe(false);
    expect(r.changes).toEqual({ worker_id: 'w1', coworker_ids: [], site_id: 's1' });
  });

  it('blocks a changed invalid plate, sends a changed valid one bare', () => {
    expect(plan({ plate: '123456' }).blocked).toBe(true);
    expect(plan({ plate: '123456' }).vehicle.plateError).toBe(true);
    const r = plan({ plate: '12345678' });
    expect(r.blocked).toBe(false);
    expect(r.changes).toMatchObject({ plate: '12345678' });
  });

  it('blocks a changed VIN with a bad format; a check-digit failure alone only flags it', () => {
    expect(plan({ vin: 'ABC' }).blocked).toBe(true);
    expect(plan({ vin: 'ABC' }).vehicle.vinError).toBe(true);
    const r = plan({ vin: BAD_CHECK_DIGIT_VIN });
    expect(r.blocked).toBe(false);
    expect(r.changes).toMatchObject({ vin: BAD_CHECK_DIGIT_VIN, vin_valid_checksum: false });
    expect(plan({ vin: VALID_VIN }).changes).toMatchObject({ vin: VALID_VIN, vin_valid_checksum: true });
  });

  it('sends vin_valid_checksum only with a VIN change', () => {
    expect(plan({ plate: '12345678' }).changes).not.toHaveProperty('vin_valid_checksum');
    expect(plan({ plate: '12345678' }).changes).not.toHaveProperty('vin');
  });

  it('blocks an empty or future date; sends a changed past one as ISO', () => {
    expect(plan({ date: '' }).dateError).toBe(true);
    expect(plan({ date: '' }).blocked).toBe(true);
    expect(plan({ date: toLocalInput(new Date(now + 3_600_000)) }).blocked).toBe(true);
    const past = toLocalInput(new Date('2026-03-01T09:30:00Z'));
    const r = plan({ date: past });
    expect(r.blocked).toBe(false);
    expect(r.changes).toMatchObject({ created_at: new Date(past).toISOString() });
  });

  it('trims brand and note, empty becomes null, unchanged-after-trim is not sent', () => {
    expect(plan({ brand: '  Kia ', workerNote: ' scratch ' }).changes).not.toHaveProperty('brand');
    expect(plan({ brand: '  Kia ', workerNote: ' scratch ' }).changes).not.toHaveProperty('worker_note');
    expect(plan({ brand: ' VW ', workerNote: '   ' }).changes).toMatchObject({ brand: 'VW', worker_note: null });
  });

  it('drops the (new) submitter from the co-workers', () => {
    expect(plan({ coworkerIds: ['w1', 'c1'] }).changes.coworker_ids).toEqual(['c1']);
    const r = plan({ workerId: 'c1', coworkerIds: ['w1', 'c1'] });
    expect(r.changes).toMatchObject({ worker_id: 'c1', coworker_ids: ['w1'] });
  });

  it('saves a cleared plate as NULL: the plate is optional', () => {
    const r = plan({ plate: '' });
    expect(r.blocked).toBe(false);
    expect(r.vehicle.missingVin).toBe(false);
    expect(r.changes).toMatchObject({ plate: null });
  });

  it('blocks clearing the VIN: it is required (0036)', () => {
    for (const vin of ['', '   ']) {
      const r = plan({ vin });
      expect(r.vehicle.missingVin).toBe(true);
      expect(r.vehicle.vinError).toBe(false);
      expect(r.blocked).toBe(true);
    }
  });

  it('blocks a changed short, 18-char or I/O/Q VIN; a lowercase one is saved uppercased', () => {
    for (const vin of [VALID_VIN.slice(0, 16), VALID_VIN + '1', 'IM8GDM9AXKP042788', '1M8GDM9AXKP04278O', '1M8GDM9AXKQ042788']) {
      const r = plan({ vin });
      expect(r.vehicle.vinError).toBe(true);
      expect(r.blocked).toBe(true);
    }
    const r = plan({ vin: VALID_VIN.toLowerCase() });
    expect(r.blocked).toBe(false);
    expect(r.changes).toMatchObject({ vin: VALID_VIN, vin_valid_checksum: true });
  });

  it('clearing the plate while the VIN stays put sends only the plate', () => {
    const r = plan({ plate: '' });
    expect(r.changes).not.toHaveProperty('vin');
    expect(r.changes).not.toHaveProperty('vin_valid_checksum');
  });

  it('blocks an untouched job that has no VIN, until one is entered', () => {
    const legacy = { ...base, vin: null };
    expect(planJobEdit(legacy, { ...untouched, vin: '' }, now).blocked).toBe(true);
    const r = planJobEdit(legacy, { ...untouched, vin: VALID_VIN }, now);
    expect(r.blocked).toBe(false);
    expect(r.changes).toMatchObject({ vin: VALID_VIN, vin_valid_checksum: true });
  });
});
