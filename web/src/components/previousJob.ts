import { serviceName } from '../lib/serviceName';
import type { PreviousJob } from '../lib/types';
import { formatDate, DAY_MONTH_YEAR } from '../lib/formatDate';

/**
 * The three things a duplicate warning may say about an earlier job: when, where,
 * what was done. Never money or people (the database function returns no more).
 */
export function describePreviousJob(job: PreviousJob, language: string) {
  return {
    date: formatDate(job.created_at, language, DAY_MONTH_YEAR),
    site: job.site_name,
    service:
      serviceName(
        { name_en: job.service_name_en ?? '', name_ru: job.service_name_ru, name_he: job.service_name_he },
        language,
      ) || '—',
  };
}
