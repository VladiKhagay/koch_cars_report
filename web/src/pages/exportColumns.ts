import type { ColumnConfig } from '../lib/reportConfig';
import { exportService, type ExportJob } from '../lib/exports';
import { expandJobRows, type ServiceRowMode } from '../lib/serviceRows';
import type { CarassoJob, JobServiceLine } from '../lib/types';
import { lineShareFor, shareFor } from '../lib/jobs';

/**
 * The export screen shows only the columns a person may have (availableColumns),
 * but the saved layout holds all of them. Folds an edited subset back into the
 * full list: the subset's entries take the subset's slots in their new order, and
 * every column that was not offered keeps its position, so saving from a
 * single-site view never shoves the Site column to the end.
 */
export function mergeColumnSubset(full: ColumnConfig[], nextSubset: ColumnConfig[]): ColumnConfig[] {
  const offered = new Set(nextSubset.map((c) => c.key));
  const queue = [...nextSubset];
  return full.map((c) => (offered.has(c.key) ? queue.shift()! : c));
}

/**
 * `jobs_carasso` rows as customer-report rows. Grouped: one row per job, its
 * services joined and the job's client totals. Separate: one row per service
 * with THAT line's names and client prices (never the job totals repeated on
 * every line). A job with no lines stays one row with its job-level values.
 */
export function customerRows(jobs: CarassoJob[], mode: ServiceRowMode): ExportJob[] {
  const rows = mode === 'separate' ? jobs.flatMap((j) => expandJobRows(j)) : jobs;
  return rows.map((r) => {
    const line = mode === 'separate' ? r.services?.[0] : undefined;
    return {
      created_at: r.created_at,
      plate: r.plate,
      vin: r.vin,
      brand: r.brand,
      billing_code: r.billing_code,
      worker_price: 0,
      worker: r.crew ? { name: r.crew } : null,
      site: { name: r.site_name },
      // Per-name Hebrew fallback from the lines; the joined view columns only for a row without them.
      service: r.services?.length
        ? exportService(r.services)
        : r.service_name_en
          ? { name_en: r.service_name_en, name_he: r.service_name_he, catalog_number: r.catalog_number ?? '' }
          : null,
      client_unit_price: line ? line.client_unit_price : r.client_unit_price,
      client_total_price: line ? line.client_total_price : r.client_total_price,
    };
  });
}

/** A `jobs_manager` row as fetched for the payment sheet: the view's own service lines, not yet the sheet's. */
export type PaymentFetchedJob = Omit<ExportJob, 'services' | 'service'> & {
  worker_id: string;
  coworker_ids: string[];
  submitter_share: number;
  coworker_share: number;
  services: JobServiceLine[] | null;
};

/**
 * The payment sheet's jobs for one person: their own name on every row (the
 * submitter may be somebody else) and each line at THEIR share of that line
 * (Postgres allocated it, 0033), never the full line price. The job share is
 * only the fallback for a job with no lines.
 */
export function paymentJobs(jobs: PaymentFetchedJob[], workerId: string, workerName: string): ExportJob[] {
  return jobs.map((j) => ({
    ...j,
    worker_price: shareFor(j, workerId),
    worker: { name: workerName },
    services: (j.services ?? []).map((l) => ({
      name_en: l.name_en,
      name_he: l.name_he,
      catalog_number: l.catalog_number,
      amount: lineShareFor(j, l, workerId),
    })),
  }));
}
