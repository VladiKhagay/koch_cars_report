import { describe, expect, it } from 'vitest';
import { searchTerm } from './search';

describe('searchTerm', () => {
  it('keeps ordinary plate and VIN queries intact', () => {
    expect(searchTerm('12-345-67')).toBe('12-345-67');
    expect(searchTerm('WVWZZZ1JZXW000001')).toBe('WVWZZZ1JZXW000001');
  });

  it('keeps non-Latin letters so worker-language terms survive', () => {
    expect(searchTerm('Иванов')).toBe('Иванов');
    expect(searchTerm('כהן')).toBe('כהן');
  });

  // The point of the function: these characters are PostgREST filter grammar,
  // not data. Leaking any one of them lets the search box rewrite the query.
  it('strips characters that would break out of an or= filter', () => {
    expect(searchTerm('a,vin.ilike.*')).toBe('avinilike');
    expect(searchTerm('x),(deleted_at.is.null')).toBe('xdeletedatisnull');
    // SQL LIKE wildcards go too — otherwise the box is a scan-everything button.
    expect(searchTerm('%_*')).toBe('');
    expect(searchTerm('"quoted"')).toBe('quoted');
  });

  it('collapses whitespace and trims', () => {
    expect(searchTerm('  ab   cd  ')).toBe('ab cd');
  });

  it('caps length so a pasted essay never reaches the URL', () => {
    expect(searchTerm('a'.repeat(200))).toHaveLength(40);
  });
});
