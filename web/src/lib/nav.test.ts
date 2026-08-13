import { describe, expect, it } from 'vitest';
import { navItemsFor } from './nav';
import type { UserRole } from './types';

/** The nav is built from `t()` calls; the labels don't matter here. */
const t = (key: string) => key;

const ROLES: UserRole[] = ['worker', 'manager', 'admin'];

/**
 * The bottom tab bar is `primary` plus one "More" tab when anything was
 * demoted. Five is a hard ceiling: a sixth tab at 375px is ~62px wide, under
 * the touch target the rest of the app holds itself to.
 */
function tabBarSize(role: UserRole) {
  const { primary, secondary } = navItemsFor(role, t);
  return primary.length + (secondary.length > 0 ? 1 : 0);
}

describe('navItemsFor', () => {
  it.each(ROLES)('keeps the %s tab bar within five items', (role) => {
    expect(tabBarSize(role)).toBeLessThanOrEqual(5);
  });

  it('demotes the manager screens that are visited weekly, not hourly', () => {
    const { primary, secondary } = navItemsFor('manager', t);
    const paths = (items: { to: string }[]) => items.map((i) => i.to);
    expect(paths(secondary)).toEqual(['/team', '/services']);
    expect(paths(primary)).not.toContain('/team');
    expect(paths(primary)).not.toContain('/services');
  });

  it('routes every role somewhere and never repeats a destination', () => {
    for (const role of ROLES) {
      const { primary, secondary } = navItemsFor(role, t);
      const all = [...primary, ...secondary].map((i) => i.to);
      expect(all.length).toBeGreaterThan(0);
      expect(new Set(all).size).toBe(all.length);
    }
  });

  /* The More tab is only added when something was demoted, so a role with no
     secondary items must fit in five on its own — otherwise the ceiling is
     breached with no way to relieve it. */
  it.each(ROLES)('gives %s either demoted items or a bar that already fits', (role) => {
    const { primary, secondary } = navItemsFor(role, t);
    if (secondary.length === 0) expect(primary.length).toBeLessThanOrEqual(5);
    else expect(primary.length).toBeLessThanOrEqual(4);
  });

  it('returns nothing for a user whose role has not loaded yet', () => {
    expect(navItemsFor(undefined, t)).toEqual({ primary: [], secondary: [] });
  });
});
