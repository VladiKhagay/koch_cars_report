/**
 * The two spreadsheets, as data.
 *
 * Both builders are pure — they take rows and return the exact cell grid that
 * goes into the file. SheetJS is only ever handed the result. That keeps the
 * one thing worth being certain about testable: which values end up in a file
 * that leaves the building.
 */
import { SHEET_HEADERS, type ColumnConfig } from './reportConfig';

/** The job fields either report can read. Nothing else is fetched. */
export interface ExportJob {
  created_at: string;
  plate: string;
  vin: string;
  brand: string | null;
  billing_code: string | null;
  worker_price: number;
  worker?: { name: string } | null;
  service?: { name_en: string; catalog_number: string } | null;
}

/** A row of cells. Numbers stay numbers so Excel can sum and format them. */
export type Cell = string | number;

/* ------------------------------------------------- customer treatment report */

function customerValue(job: ExportJob, key: ColumnConfig['key'], locale: string): Cell {
  switch (key) {
    case 'date':
      return new Date(job.created_at).toLocaleDateString(locale);
    case 'brand':
      return job.brand ?? '';
    case 'plate':
      return job.plate;
    case 'vin':
      return job.vin;
    case 'service':
      return job.service?.name_en ?? '';
    case 'catalog_number':
      return job.service?.catalog_number ?? '';
    case 'billing_code':
      return job.billing_code ?? '';
  }
}

/**
 * The sheet the importer receives.
 *
 * There is no branch here that can reach `worker` or `worker_price`: the switch
 * above is exhaustive over the allowlisted keys, so the type checker rejects a
 * future key that has no case, and no case exists that reads either field.
 */
export function buildCustomerReport(
  jobs: ExportJob[],
  columns: ColumnConfig[],
  locale: string,
): Cell[][] {
  const shown = columns.filter((c) => c.visible);
  return [
    shown.map((c) => SHEET_HEADERS[c.key]),
    ...jobs.map((job) => shown.map((c) => customerValue(job, c.key, locale))),
  ];
}

/* ------------------------------------------------------ worker payment report */

export const PAYMENT_HEADERS = ['Date', 'Worker', 'Work performed', 'Vehicle registration number', 'Amount'];

/**
 * The internal payroll sheet: one block per worker, that worker's total under
 * their rows, and a grand total at the foot.
 *
 * Laid out as a cell grid rather than a list of objects because the totals are
 * not records — a row of objects cannot express "subtotal under this group",
 * and a payroll sheet without visible subtotals is one somebody re-adds by
 * hand.
 *
 * Amounts are summed from the rows shown, so the sheet always adds up to what
 * is printed on it.
 */
export function buildWorkerPaymentReport(jobs: ExportJob[], locale: string): Cell[][] {
  const byWorker = new Map<string, ExportJob[]>();
  for (const job of jobs) {
    // A job whose worker was deleted still cost money, so it is grouped rather
    // than dropped.
    const name = job.worker?.name ?? '—';
    const bucket = byWorker.get(name);
    if (bucket) bucket.push(job);
    else byWorker.set(name, [job]);
  }

  const rows: Cell[][] = [PAYMENT_HEADERS];
  let grandTotal = 0;

  for (const name of [...byWorker.keys()].sort((a, b) => a.localeCompare(b, locale))) {
    const jobsForWorker = byWorker
      .get(name)!
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    let total = 0;
    for (const job of jobsForWorker) {
      total += job.worker_price;
      rows.push([
        new Date(job.created_at).toLocaleDateString(locale),
        name,
        job.service?.name_en ?? '',
        job.plate,
        job.worker_price,
      ]);
    }

    grandTotal += total;
    rows.push(['', `${name} — total`, '', `${jobsForWorker.length}`, round2(total)]);
    rows.push([]);
  }

  rows.push(['', 'Total', '', '', round2(grandTotal)]);
  return rows;
}

/** Money, not floating point noise: 0.1 + 0.2 must not print as 0.30000000000000004. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
