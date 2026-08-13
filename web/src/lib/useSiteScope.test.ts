import { describe, expect, it } from 'vitest';
import { defaultSiteId } from './useSiteScope';
import type { Site } from './types';

const sites = [
  { id: 'a', name: 'Ashdod' },
  { id: 'h', name: 'Haifa' },
] as Site[];

describe('defaultSiteId', () => {
  it('opens on the user’s own site, not the first one alphabetically', () => {
    expect(defaultSiteId(sites, 'h')).toBe('h');
  });

  it('falls back to the first site when the user has none', () => {
    expect(defaultSiteId(sites, null)).toBe('a');
  });

  it('falls back when the user’s site no longer exists', () => {
    expect(defaultSiteId(sites, 'deleted-site')).toBe('a');
  });

  it('returns null when there are no sites at all', () => {
    expect(defaultSiteId([], 'h')).toBeNull();
  });
});
