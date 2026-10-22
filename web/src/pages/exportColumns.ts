import type { ColumnConfig } from '../lib/reportConfig';

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
