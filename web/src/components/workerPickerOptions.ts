/** A person the worker picker can list. */
export interface PickableWorker {
  id: string;
  name: string;
}

/**
 * What the worker picker lists under its search field.
 *
 * `matches` is everyone whose name contains the term (case and surrounding
 * spaces ignored), minus the selected person. `selected` is listed separately
 * and always, even when the term would exclude them: a picker whose choice
 * falls off screen while you type is how you export the wrong worker's pay.
 */
export function workerPickerOptions(workers: PickableWorker[], selectedId: string, search: string) {
  const term = search.trim().toLowerCase();
  const selected = workers.find((w) => w.id === selectedId);
  const matches = workers.filter((w) => w.id !== selectedId && w.name.toLowerCase().includes(term));
  return {
    selected,
    matches,
    term,
    /** "No matches" only when the search found nobody at all, the picked person included. */
    noMatches: Boolean(term) && matches.length === 0 && !selected?.name.toLowerCase().includes(term),
  };
}

/**
 * Who Enter picks in a search-and-list picker: the top of `listed`, but only
 * when Enter was pressed in the search field itself. Enter on a focused row or
 * on a clear/remove button is that button's own click; acting on it here too
 * would pick the top match instead of the person tapped.
 */
export function enterPick(key: string, fromSearchInput: boolean, listed: { id: string }[]): string | null {
  return key === 'Enter' && fromSearchInput && listed[0] ? listed[0].id : null;
}
