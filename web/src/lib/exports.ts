/**
 * The spreadsheets, as pure data: builders take rows and return the exact cell
 * grid, so what ends up in a file that leaves the building is testable.
 */
import { SHEET_HEADERS_BY_LANG, type ColumnConfig, type ExportLang } from './reportConfig';

/* ------------------------------------------------------------- language */

/** The date locale an export's language reads in. */
export function exportLocale(lang: ExportLang): string {
  return lang === 'he' ? 'he-IL' : 'en-GB';
}

/** Hebrew exports use `name_he`, falling back to `name_en` when it is empty; English always `name_en`. */
export function exportServiceName(
  service: { name_en: string; name_he?: string | null } | null | undefined,
  lang: ExportLang,
): string {
  if (!service) return '';
  return (lang === 'he' && service.name_he) || service.name_en;
}

/** The customer report's sheet, in both languages. */
export const REPORT_SHEET_NAME = 'Koch - Report';

/** `Koch-Report-{from}-to-{to}.xlsx`: Latin letters in both languages, no site name. */
export function customerReportFileName(from: string, to: string): string {
  return `Koch-Report-${from}-to-${to}.xlsx`;
}

/** Sheet names for the other exports. */
export const SHEET_NAMES: Record<ExportLang, { payments: string; stats: string; jobs: string }> = {
  en: { payments: 'Payments', stats: 'Stats', jobs: 'Jobs' },
  he: { payments: 'תשלומים', stats: 'סטטיסטיקה', jobs: 'עבודות' },
};

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
  service?: { name_en: string; name_he?: string | null; catalog_number: string } | null;
  /**
   * Client price (admin and Carasso only). Absent for managers, who cannot read it.
   * The builder prints them only when the price columns survive availableColumns().
   */
  client_unit_price?: number | null;
  client_total_price?: number | null;
}

/** Numbers and Dates stay typed so Excel can sum, sort and filter them. */
export type Cell = string | number | Date;

/* ------------------------------------------------- customer treatment report */

function customerValue(job: ExportJob, key: ColumnConfig['key'], locale: string, lang: ExportLang): Cell {
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
      return exportServiceName(job.service, lang);
    case 'site':
      return job.site?.name ?? '';
    // Money stays numeric so the sheet can be summed; no VAT handling.
    case 'client_unit_price':
      return job.client_unit_price ?? '';
    case 'client_total_price':
      return job.client_total_price ?? '';
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
 * The customer report. No case reads `worker_price` (worker pay), and the
 * exhaustive switch makes the type checker reject any key without one. Pass
 * the columns through availableColumns() first: that is what keeps client
 * prices out of a manager's file and the Worker column out of a Carasso file
 * while names are hidden.
 */
export function buildCustomerReport(
  jobs: ExportJob[],
  columns: ColumnConfig[],
  locale: string,
  lang: ExportLang = 'he',
): Cell[][] {
  const shown = columns.filter((c) => c.visible);
  const headers = SHEET_HEADERS_BY_LANG[lang];
  return [
    shown.map((c) => headers[c.key]),
    ...jobs.map((job) => shown.map((c) => customerValue(job, c.key, locale, lang))),
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

const PAYMENT_LABELS: Record<ExportLang, { headers: string[]; summary: string[]; total: string }> = {
  en: {
    headers: ['Date', 'Site', 'Worker', 'Work performed', 'Vehicle registration number', 'Amount'],
    summary: ['Summary', 'Work performed', 'Jobs', 'Amount'],
    total: 'Total',
  },
  he: {
    headers: ['תאריך', 'אתר', 'עובד', 'שירות', 'רישוי', 'סכום'],
    summary: ['סיכום', 'שירות', 'עבודות', 'סכום'],
    total: 'סה"כ',
  },
};

export const PAYMENT_HEADERS = PAYMENT_LABELS.en.headers;

/** The labels the summary block at the foot of the payment sheet uses. */
export const PAYMENT_SUMMARY_HEADERS = PAYMENT_LABELS.en.summary;

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
  lang: ExportLang = 'he',
): Cell[][] {
  const labels = PAYMENT_LABELS[lang];
  const ordered = jobs.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));

  const rows: Cell[][] = [labels.headers];
  /** service name → its own running count and subtotal, in whole cents. */
  const perService = new Map<string, { count: number; cents: number }>();
  let totalCents = 0;

  for (const job of ordered) {
    const service = exportServiceName(job.service, lang) || NO_SERVICE;
    const cents = toCents(job.worker_price);

    rows.push([
      new Date(job.created_at).toLocaleDateString(locale),
      // One sheet per person across every site they worked at (0019).
      job.site?.name ?? '',
      job.worker?.name ?? workerName,
      exportServiceName(job.service, lang),
      job.plate ?? '',
      fromCents(cents),
    ]);

    const bucket = perService.get(service) ?? { count: 0, cents: 0 };
    bucket.count += 1;
    bucket.cents += cents;
    perService.set(service, bucket);
    totalCents += cents;
  }

  const [summaryLabel, serviceLabel, jobsLabel, amountLabel] = labels.summary;

  rows.push([]);
  rows.push([summaryLabel]);
  rows.push(['', serviceLabel, '', '', jobsLabel, amountLabel]);

  // Alphabetical, so the same catalog produces the same sheet order every month
  // regardless of which service happened to be logged first.
  for (const name of [...perService.keys()].sort((a, b) => a.localeCompare(b, locale))) {
    const { count, cents } = perService.get(name)!;
    rows.push(['', name, '', '', count, fromCents(cents)]);
  }

  rows.push(['', labels.total, '', '', ordered.length, fromCents(totalCents)]);
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

/* ------------------------------------------------------------------- stats */

/** One line of the analytics export: a day's job count for one worker and service. */
export interface StatsRow {
  day: string;
  site: string;
  worker: string;
  catalog_number: string;
  service: { name_en: string; name_he?: string | null } | null;
  job_count: number;
}

const STATS_HEADERS: Record<ExportLang, string[]> = {
  en: ['Date', 'Site', 'Worker', 'Catalog number', 'Service', 'Jobs'],
  he: ['תאריך', 'אתר', 'עובד', 'מק"ט', 'שירות', 'מספר עבודות'],
};

/** The analytics export as a cell grid (it used json_to_sheet, whose headers could not be translated). */
export function buildStatsSheet(rows: StatsRow[], lang: ExportLang = 'he'): Cell[][] {
  return [
    STATS_HEADERS[lang],
    ...rows.map((r) => [r.day, r.site, r.worker, r.catalog_number, exportServiceName(r.service, lang), r.job_count]),
  ];
}

/** My Jobs headers: Date, plate, brand, service: the customer report's own words. */
export const MY_JOBS_HEADERS: Record<ExportLang, string[]> = {
  en: ['Date', 'Vehicle registration number', 'Vehicle brand', 'Work performed'],
  he: ['תאריך', 'רישוי', 'יצרן', 'שירות'],
};
