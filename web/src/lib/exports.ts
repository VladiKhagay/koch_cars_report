/**
 * The spreadsheets, as pure data: builders take rows and return the exact cell
 * grid, so what ends up in a file that leaves the building is testable.
 */
import { SHEET_HEADERS, type ColumnConfig } from './reportConfig';

/** The job fields either report can read. Nothing else is fetched. */
export interface ExportJob {
  created_at: string;
  /** Absent on jobs with no physical plate. Prints as a blank cell. */
  plate: string | null;
  /** Absent on jobs whose VIN could not be read. Prints as a blank cell. */
  vin: string | null;
  brand: string | null;
  billing_code: string | null;
  /** On the payment sheet: the selected person's share of the job, resolved by the caller (shareFor). */
  worker_price: number;
  /** On the customer report: everyone on the job, already joined ("Dana, Avi"). */
  worker?: { name: string } | null;
  site?: { name: string } | null;
  service?: { name_en: string; catalog_number: string } | null;
}

/** Numbers and Dates stay typed so Excel can sum, sort and filter them. */
export type Cell = string | number | Date;

/* ------------------------------------------------- customer treatment report */

function customerValue(job: ExportJob, key: ColumnConfig['key'], locale: string): Cell {
  switch (key) {
    case 'date':
      return new Date(job.created_at).toLocaleDateString(locale);
    case 'brand':
      return job.brand ?? '';
    case 'plate':
      return job.plate ?? '';
    case 'vin':
      return job.vin ?? '';
    case 'service':
      return job.service?.name_en ?? '';
    case 'catalog_number':
      return job.service?.catalog_number ?? '';
    case 'billing_code':
      return job.billing_code ?? '';
    // A missing worker record prints a blank cell, never "null".
    case 'worker':
      return job.worker?.name ?? '';
  }
}

/**
 * The customer report. No case reads `worker_price`, and the exhaustive switch
 * makes the type checker reject any key without one.
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

/* ------------------------------------------------------------ my jobs sheet */

/** One row of the worker's own grid, as the screen has it. */
export interface MyJobsRow {
  created_at: string;
  plate: string | null;
  brand: string | null;
  /** Already resolved to the reader's language by the caller, as the cell is. */
  service: string;
}

/**
 * The worker's own grid as a sheet. Status and Actions are not exported (stale
 * the moment the file opens). Dates stay Dates so the file sorts; headers are
 * the table's own, in the reader's language.
 */
export function buildMyJobsSheet(rows: MyJobsRow[], headers: string[]): Cell[][] {
  return [
    headers,
    ...rows.map((row) => [new Date(row.created_at), row.plate ?? '', row.brand ?? '', row.service]),
  ];
}

/* ------------------------------------------------------ worker payment report */

export const PAYMENT_HEADERS = ['Date', 'Site', 'Worker', 'Work performed', 'Vehicle registration number', 'Amount'];

/** The labels the summary block at the foot of the payment sheet uses. */
export const PAYMENT_SUMMARY_HEADERS = ['Summary', 'Work performed', 'Jobs', 'Amount'];

/** Shown in place of a name when a job carries no service, or none is readable. */
const NO_SERVICE = '—';

/**
 * The internal payroll sheet for one worker over a date range: their jobs
 * oldest first, then a per-service summary. A cell grid, not objects, so
 * subtotals are expressible. Every figure is summed from the rows above it, and
 * `worker_price` is the price snapshotted when the job was logged (0005), so
 * re-pricing a service never rewrites past pay.
 */
export function buildWorkerPaymentReport(
  jobs: ExportJob[],
  workerName: string,
  locale: string,
): Cell[][] {
  const ordered = jobs.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));

  const rows: Cell[][] = [PAYMENT_HEADERS];
  /** service name → its own running count and subtotal, in whole cents. */
  const perService = new Map<string, { count: number; cents: number }>();
  let totalCents = 0;

  for (const job of ordered) {
    const service = job.service?.name_en || NO_SERVICE;
    const cents = toCents(job.worker_price);

    rows.push([
      new Date(job.created_at).toLocaleDateString(locale),
      // One sheet per person across every site they worked at (0019).
      job.site?.name ?? '',
      job.worker?.name ?? workerName,
      job.service?.name_en ?? '',
      job.plate ?? '',
      fromCents(cents),
    ]);

    const bucket = perService.get(service) ?? { count: 0, cents: 0 };
    bucket.count += 1;
    bucket.cents += cents;
    perService.set(service, bucket);
    totalCents += cents;
  }

  const [summaryLabel, serviceLabel, jobsLabel, amountLabel] = PAYMENT_SUMMARY_HEADERS;

  rows.push([]);
  rows.push([summaryLabel]);
  rows.push(['', serviceLabel, '', '', jobsLabel, amountLabel]);

  // Alphabetical, so the same catalog produces the same sheet order every month
  // regardless of which service happened to be logged first.
  for (const name of [...perService.keys()].sort((a, b) => a.localeCompare(b, locale))) {
    const { count, cents } = perService.get(name)!;
    rows.push(['', name, '', '', count, fromCents(cents)]);
  }

  rows.push(['', 'Total', '', '', ordered.length, fromCents(totalCents)]);
  return rows;
}

/**
 * Money as whole cents: summing JS floats (0.1 + 0.2) would leave a payroll
 * sheet whose subtotals don't add to its total. Convert once at the edge, sum
 * integers, convert back once.
 */
function toCents(amount: number | null | undefined): number {
  return Math.round((amount ?? 0) * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}
