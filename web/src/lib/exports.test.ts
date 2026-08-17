import { describe, expect, it } from 'vitest';
import { buildCustomerReport, buildWorkerPaymentReport, type ExportJob } from './exports';
import { resolveCustomerColumns } from './reportConfig';

const job = (over: Partial<ExportJob> = {}): ExportJob => ({
  created_at: '2026-03-04T09:30:00.000Z',
  plate: '12-345-67',
  vin: 'WVWZZZ1JZXW000001',
  brand: 'Volkswagen',
  billing_code: 'R-900',
  worker_price: 25,
  worker: { name: 'Dana' },
  service: { name_en: 'Full detail', catalog_number: 'SVC-001' },
  ...over,
});

/** Flattens a grid so a value can be searched for wherever it landed. */
const flat = (rows: (string | number)[][]) => rows.flat().map(String);

describe('buildCustomerReport', () => {
  it('emits only the visible columns, in configured order', () => {
    const columns = resolveCustomerColumns({
      columns: [
        { key: 'plate', visible: true },
        { key: 'date', visible: true },
        { key: 'vin', visible: false },
      ],
    });
    const [header, row] = buildCustomerReport([job()], columns, 'en-GB');
    expect(header).toEqual(['Vehicle registration number', 'Date']);
    expect(row[0]).toBe('12-345-67');
    expect(row).toHaveLength(2);
  });

  /*
   * The report goes to the importer. Even handed a config that asks for them,
   * the worker's name and pay must not reach the file.
   */
  it('never emits the worker name or price, even if the config asks', () => {
    const columns = resolveCustomerColumns({
      columns: [
        { key: 'worker', visible: true },
        { key: 'worker_price', visible: true },
        { key: 'date', visible: true },
      ],
    });
    const cells = flat(buildCustomerReport([job()], columns, 'en-GB'));
    expect(cells).not.toContain('Dana');
    expect(cells).not.toContain('25');
    expect(cells.some((c) => /worker/i.test(c))).toBe(false);
  });

  it('produces a header-only sheet when nothing is visible', () => {
    const columns = resolveCustomerColumns({ columns: [] });
    const rows = buildCustomerReport([job(), job()], columns, 'en-GB');
    expect(rows[0]).toEqual([]);
    expect(rows).toHaveLength(3);
  });

  it('writes empty cells, not "null", for missing optional values', () => {
    const columns = resolveCustomerColumns({
      columns: [
        { key: 'brand', visible: true },
        { key: 'billing_code', visible: true },
        { key: 'catalog_number', visible: true },
      ],
    });
    const [, row] = buildCustomerReport(
      [job({ brand: null, billing_code: null, service: null })],
      columns,
      'en-GB',
    );
    expect(row).toEqual(['', '', '']);
  });
});

describe('buildWorkerPaymentReport', () => {
  const wash = { name_en: 'Wash', catalog_number: 'SVC-001' };
  const polish = { name_en: 'Polish', catalog_number: 'SVC-002' };

  /** Dana's month: two washes at 25, one polish at 15.5. */
  const dana = [
    job({ worker: { name: 'Dana' }, service: wash, worker_price: 25, created_at: '2026-03-02T08:00:00.000Z' }),
    job({ worker: { name: 'Dana' }, service: polish, worker_price: 15.5, created_at: '2026-03-01T08:00:00.000Z' }),
    job({ worker: { name: 'Dana' }, service: wash, worker_price: 25, created_at: '2026-03-03T08:00:00.000Z' }),
  ];

  const build = (jobs: ExportJob[] = dana) => buildWorkerPaymentReport(jobs, 'Dana', 'en-GB');
  /** The summary row for a service (or the totals), by its label in column B. */
  const summaryFor = (rows: (string | number)[][], label: string) =>
    rows.find((r) => r[1] === label);

  it('lists the jobs oldest first, one row each', () => {
    const rows = build();
    const dates = rows.slice(1, 4).map((r) => r[0]);
    expect(dates).toEqual(['01/03/2026', '02/03/2026', '03/03/2026']);
  });

  it('keeps the columns that show how the pay was arrived at', () => {
    const rows = build();
    expect(rows[0]).toEqual(['Date', 'Worker', 'Work performed', 'Vehicle registration number', 'Amount']);
    expect(rows[1]).toEqual(['01/03/2026', 'Dana', 'Polish', '12-345-67', 15.5]);
  });

  it('counts the jobs done for each service', () => {
    const rows = build();
    expect(summaryFor(rows, 'Wash')?.[3]).toBe(2);
    expect(summaryFor(rows, 'Polish')?.[3]).toBe(1);
  });

  it('subtotals each service from the jobs actually listed', () => {
    const rows = build();
    expect(summaryFor(rows, 'Wash')?.[4]).toBe(50);
    expect(summaryFor(rows, 'Polish')?.[4]).toBe(15.5);
  });

  it('totals the job count and the amount owed', () => {
    const rows = build();
    expect(rows[rows.length - 1]).toEqual(['', 'Total', '', 3, 65.5]);
  });

  /* The subtotals and the total are three separate sums over the same rows.
     If they are computed in floating point they stop agreeing at the cent, and
     a payroll sheet that does not add up is one nobody signs. */
  it('adds up in whole cents, so the parts equal the whole', () => {
    const rows = build([
      job({ service: wash, worker_price: 0.1 }),
      job({ service: wash, worker_price: 0.2 }),
      job({ service: polish, worker_price: 0.1 }),
    ]);
    expect(summaryFor(rows, 'Wash')?.[4]).toBe(0.3);
    expect(rows[rows.length - 1][4]).toBe(0.4);
  });

  it('counts a job exactly once, in one service bucket', () => {
    const rows = build();
    const counts = ['Wash', 'Polish'].map((s) => Number(summaryFor(rows, s)![3]));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(rows[rows.length - 1][3]);
  });

  it('keeps a job with no service rather than dropping its cost', () => {
    const rows = build([job({ service: null, worker_price: 12 })]);
    expect(summaryFor(rows, '—')).toEqual(['', '—', '', 1, 12]);
    expect(rows[rows.length - 1]).toEqual(['', 'Total', '', 1, 12]);
  });

  it('survives a job with no VIN — the sheet does not read it at all', () => {
    const rows = build([job({ vin: null, worker_price: 20 })]);
    expect(rows[rows.length - 1][4]).toBe(20);
    expect(flat(rows)).not.toContain('null');
  });

  it('produces a header and an empty summary when the worker did nothing', () => {
    const rows = build([]);
    expect(rows[0]).toEqual(['Date', 'Worker', 'Work performed', 'Vehicle registration number', 'Amount']);
    expect(rows[rows.length - 1]).toEqual(['', 'Total', '', 0, 0]);
  });

  it('falls back to the selected worker when the job carries no worker record', () => {
    const rows = build([job({ worker: null, worker_price: 12 })]);
    expect(rows[1][1]).toBe('Dana');
    expect(rows[rows.length - 1][4]).toBe(12);
  });

  it('keeps amounts numeric so the sheet can be summed and formatted', () => {
    expect(typeof build([job({ worker_price: 25 })])[1][4]).toBe('number');
  });
});

/*
 * The builders are pure, but the file is what the office opens. This is the
 * only place the real library runs: a grid of numbers that SheetJS writes as
 * text produces a payroll sheet whose column cannot be summed in Excel, and
 * nothing above would notice.
 */
describe('through SheetJS', () => {
  it('writes payment amounts as numeric cells, not text', async () => {
    const XLSX = await import('xlsx');
    const rows = buildWorkerPaymentReport(
      [job({ worker_price: 25 }), job({ worker_price: 15.5 })],
      'Dana',
      'en-GB',
    );
    const sheet = XLSX.utils.aoa_to_sheet(rows);

    // Column E is Amount; row 2 is the first data row.
    expect(sheet.E2.t).toBe('n');
    expect(sheet.E2.v).toBe(25);
  });

  it('round-trips the customer report back to the configured headers', async () => {
    const XLSX = await import('xlsx');
    const columns = resolveCustomerColumns({
      columns: [
        { key: 'plate', visible: true },
        { key: 'service', visible: true },
      ],
    });
    const sheet = XLSX.utils.aoa_to_sheet(buildCustomerReport([job()], columns, 'en-GB'));
    const back = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

    expect(Object.keys(back[0])).toEqual(['Vehicle registration number', 'Work performed']);
    expect(back[0]['Vehicle registration number']).toBe('12-345-67');
  });
});
