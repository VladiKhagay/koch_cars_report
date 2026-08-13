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
  const jobs = [
    job({ worker: { name: 'Dana' }, worker_price: 25, created_at: '2026-03-02T08:00:00.000Z' }),
    job({ worker: { name: 'Boris' }, worker_price: 10.1, created_at: '2026-03-01T08:00:00.000Z' }),
    job({ worker: { name: 'Dana' }, worker_price: 15.5, created_at: '2026-03-01T08:00:00.000Z' }),
  ];

  it('groups by worker with a subtotal under each block', () => {
    const rows = buildWorkerPaymentReport(jobs, 'en-GB');
    const labels = rows.map((r) => String(r[1] ?? ''));
    expect(labels).toContain('Boris — total');
    expect(labels).toContain('Dana — total');
    // Boris sorts first, so his block and subtotal precede Dana's rows.
    expect(labels.indexOf('Boris — total')).toBeLessThan(labels.lastIndexOf('Dana'));
  });

  it('sums each worker and the sheet as a whole', () => {
    const rows = buildWorkerPaymentReport(jobs, 'en-GB');
    const amountFor = (label: string) => rows.find((r) => r[1] === label)?.[4];
    expect(amountFor('Dana — total')).toBe(40.5);
    expect(amountFor('Boris — total')).toBe(10.1);
    expect(rows[rows.length - 1]).toEqual(['', 'Total', '', '', 50.6]);
  });

  it('keeps amounts numeric so the sheet can be summed and formatted', () => {
    const rows = buildWorkerPaymentReport([job({ worker_price: 25 })], 'en-GB');
    expect(typeof rows[1][4]).toBe('number');
  });

  it('orders each worker\'s own rows oldest first', () => {
    const rows = buildWorkerPaymentReport(jobs, 'en-GB');
    const dana = rows.filter((r) => r[1] === 'Dana');
    expect(dana.map((r) => r[0])).toEqual(['01/03/2026', '02/03/2026']);
  });

  it('keeps a job whose worker record is gone rather than losing the cost', () => {
    const rows = buildWorkerPaymentReport([job({ worker: null, worker_price: 12 })], 'en-GB');
    expect(rows[rows.length - 1][4]).toBe(12);
  });

  it('rounds float drift out of the totals', () => {
    const rows = buildWorkerPaymentReport(
      [job({ worker_price: 0.1 }), job({ worker_price: 0.2 })],
      'en-GB',
    );
    expect(rows[rows.length - 1][4]).toBe(0.3);
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
    const rows = buildWorkerPaymentReport([job({ worker_price: 25 }), job({ worker_price: 15.5 })], 'en-GB');
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
