import { useState } from 'react';
import { serviceName, type ServiceNames } from './serviceName';

/**
 * How the admin's Jobs grid and exports show a job with several services
 * (0033): one row per job with the names joined ("grouped", the default), or
 * one row per service ("separate"). Remembered per browser, not per user.
 */
export type ServiceRowMode = 'grouped' | 'separate';

export const SERVICE_ROW_MODE_KEY = 'jobsServiceRows';

export function getServiceRowMode(): ServiceRowMode {
  try {
    return localStorage.getItem(SERVICE_ROW_MODE_KEY) === 'separate' ? 'separate' : 'grouped';
  } catch {
    return 'grouped'; // storage blocked (private mode): the default
  }
}

export function setServiceRowMode(mode: ServiceRowMode): void {
  try {
    localStorage.setItem(SERVICE_ROW_MODE_KEY, mode);
  } catch {
    /* not remembered, still applied for this visit */
  }
}

/** The grid/export toggle, read once and written through on change. */
export function useServiceRowMode(): [ServiceRowMode, (mode: ServiceRowMode) => void] {
  const [mode, setMode] = useState<ServiceRowMode>(getServiceRowMode);
  return [
    mode,
    (next) => {
      setMode(next);
      setServiceRowMode(next);
    },
  ];
}

/**
 * A job's services in the reader's language, "Wash, Polish". Names come from
 * the lines themselves, so a retired or deleted service still reads. Empty
 * string for a job with none (callers show their own "no service" text).
 */
export function serviceLabel(lines: ServiceNames[] | null | undefined, language: string): string {
  return (lines ?? []).map((l) => serviceName(l, language)).join(', ');
}

/**
 * The "separate" view of one job: a copy per service line, each carrying only
 * that line in `services`. A job with no lines (logged before 0005) stays one
 * row rather than vanishing. Paging and counts stay per job; this only expands
 * the page already fetched.
 */
export function expandJobRows<J extends { services?: unknown[] | null }>(job: J): J[] {
  const lines = job.services ?? [];
  return lines.length === 0 ? [job] : lines.map((line) => ({ ...job, services: [line] }) as J);
}
