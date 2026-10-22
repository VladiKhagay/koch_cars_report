/** A shekel amount as a plain number ("1,250.5"); the field label carries the (₪). Null/absent is an em dash. */
export function formatMoney(n: number | null | undefined, language: string): string {
  return n === null || n === undefined ? '—' : n.toLocaleString(language, { maximumFractionDigits: 2 });
}
