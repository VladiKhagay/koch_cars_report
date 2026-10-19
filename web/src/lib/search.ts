/**
 * Sanitise a free-text term before it goes into a PostgREST `or=` filter. A
 * comma, parenthesis or dot would be parsed as more filter and let the typist
 * rewrite the query, so everything but letters, digits, space and hyphen is
 * dropped (an allowlist beats escaping). The length cap keeps a pasted essay out of the URL.
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
