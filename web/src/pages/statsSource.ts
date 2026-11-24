import type { JobDailyStat, JobDailyTotal } from '../lib/types';

/**
 * The rows Analytics counts jobs and cars from (0033). `job_daily_stats` is
 * per service line, so a two-service car is in it twice: summing it unfiltered
 * double-counts. With no service picked the counts come from
 * `job_daily_totals` (one row per job); with one picked, from that service's
 * stats rows, where each job appears once.
 */
// ponytail: exact only for a single-service filter; a multi-select service filter would
// count a job once per picked line, so it needs a job-grain source (an RPC counting distinct job_id).
export function countRows(
  totals: JobDailyTotal[],
  stats: JobDailyStat[],
  workerFilter: string,
  serviceFilter: string,
): Pick<JobDailyTotal, 'worker_id' | 'worker_label' | 'day' | 'job_count' | 'car_count'>[] {
  const byWorker = <R extends { worker_id: string | null }>(r: R) => !workerFilter || r.worker_id === workerFilter;
  return serviceFilter ? stats.filter((r) => byWorker(r) && r.service_id === serviceFilter) : totals.filter(byWorker);
}

/**
 * The by-worker chart's key for a row: the person, or for a labelled job (0040,
 * no worker_id) the typed name, so "Moshe" gets his own bar and is never merged
 * into the submitter's.
 */
export function workerKey(r: Pick<JobDailyTotal, 'worker_id' | 'worker_label'>): string {
  return r.worker_id ?? `label:${r.worker_label ?? ''}`;
}
