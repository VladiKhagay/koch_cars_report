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
  /** Absent on jobs whose VIN could not be read. Prints as a blank cell. */
  vin: string | null;
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
      return job.vin ?? '';
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

/** The labels the summary block at the foot of the payment sheet uses. */
export const PAYMENT_SUMMARY_HEADERS = ['Summary', 'Work performed', 'Jobs', 'Amount'];

/** Shown in place of a name when a job carries no service, or none is readable. */
const NO_SERVICE = '—';

/**
 * The internal payroll sheet for ONE worker over one date range: their jobs
 * oldest first, then a summary of what that adds up to per service.
 *
 * It used to be every worker at the site in one file, one block each. That is
 * the wrong shape for what it is used for — payroll is settled with one person
 * at a time, and a sheet you have to scroll past four colleagues' pay to reach
 * yours is not one you can hand over. The caller now picks the worker, and the
 * query is filtered to them, so this builder never sees anybody else's rows.
 *
 * Laid out as a cell grid rather than a list of objects because the totals are
 * not records — a row of objects cannot express "subtotal under this group",
 * and a payroll sheet without visible subtotals is one somebody re-adds by hand.
 *
 * Every figure is summed from the rows printed above it, so the sheet always
 * adds up to what is on it. Nothing is priced here: `worker_price` is the
 * catalog price snapshotted onto the job when it was logged (migration 0005),
 * which is why re-pricing a service next month cannot rewrite this month's pay.
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
      job.worker?.name ?? workerName,
      job.service?.name_en ?? '',
      job.plate,
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
  rows.push(['', serviceLabel, '', jobsLabel, amountLabel]);

  // Alphabetical, so the same catalog produces the same sheet order every month
  // regardless of which service happened to be logged first.
  for (const name of [...perService.keys()].sort((a, b) => a.localeCompare(b, locale))) {
    const { count, cents } = perService.get(name)!;
    rows.push(['', name, '', count, fromCents(cents)]);
  }

  rows.push(['', 'Total', '', ordered.length, fromCents(totalCents)]);
  return rows;
}

/**
 * Money as whole cents.
 *
 * Prices are `numeric` in Postgres and arrive here as JS numbers, so adding
 * them up directly reintroduces the binary-fraction error the column type
 * exists to avoid: 0.1 + 0.2 is 0.30000000000000004, and a payroll sheet whose
 * subtotals do not add to its total is one nobody signs. Every amount is
 * converted once at the edge, summed as integers, and converted back once.
 */
function toCents(amount: number | null | undefined): number {
  return Math.round((amount ?? 0) * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}
