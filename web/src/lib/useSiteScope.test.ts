import { describe, expect, it } from 'vitest';
import { defaultSiteId, pickableSites, startSiteId } from './useSiteScope';
import type { Site } from './types';

const sites = [
  { id: 'a', name: 'Ashdod', active: true },
  { id: 'h', name: 'Haifa', active: true },
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

const withDisabled = [
  { id: 'a', name: 'Ashdod', active: false },
  { id: 'h', name: 'Haifa', active: false },
  { id: 't', name: 'Tel Aviv', active: true },
] as Site[];

describe('startSiteId', () => {
  it('opens on the remembered pick when it is still enabled', () => {
    expect(startSiteId(sites, 'a', 'h')).toBe('a');
  });

  it('skips a remembered pick that has been disabled', () => {
    expect(startSiteId(withDisabled, 'a', null)).toBe('t');
  });

  it('skips a disabled home site', () => {
    expect(startSiteId(withDisabled, null, 'h')).toBe('t');
  });

  it('falls back to all sites when every site is disabled', () => {
    expect(startSiteId(withDisabled.slice(0, 2), 'a', 'h')).toBe('a');
    expect(startSiteId(withDisabled.slice(0, 2), null, 'h')).toBe('h');
    expect(startSiteId(withDisabled.slice(0, 2), null, null)).toBe('a');
  });

  it('returns null when there are no sites', () => {
    expect(startSiteId([], 'a', 'h')).toBeNull();
  });
});

describe('pickableSites', () => {
  it('offers enabled sites only', () => {
    expect(pickableSites(withDisabled).map((s) => s.id)).toEqual(['t']);
  });

  it('keeps a disabled site the field already holds', () => {
    expect(pickableSites(withDisabled, ['h', null]).map((s) => s.id)).toEqual(['h', 't']);
  });

  it('treats a site without the flag as enabled', () => {
    expect(pickableSites([{ id: 'x', name: 'X' } as Site]).map((s) => s.id)).toEqual(['x']);
  });
});
