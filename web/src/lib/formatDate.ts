/** Shared `toLocaleDateString` option presets. Callers keep their own parsing (T00:00:00 vs T12:00:00 vs ISO). */
export const DAY_MONTH: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };
export const DAY_MONTH_YEAR: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
export const MONTH_YEAR: Intl.DateTimeFormatOptions = { month: 'short', year: '2-digit' };
export const LONG_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

/** A date in the reader's locale. A string is parsed with `new Date(s)`. */
export function formatDate(date: Date | string, locale: string, opts?: Intl.DateTimeFormatOptions): string {
  return (typeof date === 'string' ? new Date(date) : date).toLocaleDateString(locale, opts);
}

/** A timestamp as a `datetime-local` value: local time, minute precision. */
export function toLocalInput(when: string | Date): string {
  const d = new Date(when);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
