import { describe, expect, it } from 'vitest';
import { LOOKUP_MIN, lookupQuery, searchTerm } from './search';

describe('searchTerm', () => {
  it('keeps ordinary plate and VIN queries intact', () => {
    expect(searchTerm('12345678')).toBe('12345678');
    expect(searchTerm('WVWZZZ1JZXW000001')).toBe('WVWZZZ1JZXW000001');
  });

  // Plates are stored bare, so the printed spelling has to be collapsed or it
  // matches nothing.
  it('drops separators from an all-digit term', () => {
    expect(searchTerm('123-45-678')).toBe('12345678');
    expect(searchTerm('123 45 678')).toBe('12345678');
  });

  it('leaves hyphens alone when the term has letters — billing codes use them', () => {
    expect(searchTerm('KC-2024-17')).toBe('KC-2024-17');
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

describe('lookupQuery', () => {
  it('upper-cases and keeps only A-Z and 0-9, as lookup_vehicle (0037)', () => {
    expect(lookupQuery(' wvw-zzz 1j ')).toBe('WVWZZZ1J');
    expect(lookupQuery('123-45-678')).toBe('12345678');
  });

  it('drops LIKE metacharacters, quotes and SQL-looking input', () => {
    expect(lookupQuery('%_\\%')).toBe('');
    expect(lookupQuery("' or '1'='1")).toBe('OR11');
    expect(lookupQuery("'; drop table jobs;--")).toBe('DROPTABLEJOBS');
  });

  it('counts only kept characters toward the minimum', () => {
    expect(lookupQuery('12-3').length).toBeLessThan(LOOKUP_MIN);
    expect(lookupQuery('1234').length).toBe(LOOKUP_MIN);
    expect(lookupQuery('אבגד').length).toBe(0);
  });
});
