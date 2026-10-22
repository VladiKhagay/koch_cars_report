import { serviceName } from '../lib/serviceName';
import type { PreviousJob } from '../lib/types';

/**
 * The three things a duplicate warning may say about an earlier job: when, where,
 * what was done. Never money or people (the database function returns no more).
 */
export function describePreviousJob(job: PreviousJob, language: string) {
  return {
    date: new Date(job.created_at).toLocaleDateString(language, { day: '2-digit', month: 'short', year: 'numeric' }),
    site: job.site_name,
    service:
      serviceName(
        { name_en: job.service_name_en ?? '', name_ru: job.service_name_ru, name_he: job.service_name_he },
        language,
      ) || '—',
  };
}
