/**
 * Sanitise a free-text term before it goes into a PostgREST `or=` filter.
 *
 * `or` takes a comma-separated grammar with parentheses — `plate.ilike.%X%,vin.ilike.%X%`.
 * A comma, parenthesis or dot pasted into the search box would not be matched
 * against the data, it would be parsed as more filter, letting whoever typed it
 * rewrite the query (`*` is PostgREST's ilike wildcard, and `(` opens a group).
 * Escaping is possible but easy to get subtly wrong; an allowlist is not.
 *
 * The three searchable columns — plate, VIN, billing code — are Latin
 * alphanumerics with hyphens and the odd space, so everything else is dropped
 * rather than escaped. The length cap keeps a pasted essay out of the URL.
 */
export function searchTerm(raw: string): string {
  const clean = raw
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);

  // Plates are printed 123-45-678 but stored bare, so a term that is only
  // digits and separators is collapsed to match. Anything with a letter is
  // left alone — a billing code's hyphens are part of the value.
  return /^[\d -]+$/.test(clean) ? clean.replace(/[ -]/g, '') : clean;
}
