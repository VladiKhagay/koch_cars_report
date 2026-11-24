import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from './supabase';
import { getSiteChoice, setSiteChoice } from './siteChoice';
import type { Site } from './types';

/** The site a screen opens on: the one the person works at, admins included. */
export function defaultSiteId(sites: Site[], homeSiteId: string | null): string | null {
  if (homeSiteId && sites.some((s) => s.id === homeSiteId)) return homeSiteId;
  return sites[0]?.id ?? null;
}

/**
 * The sites a picker for new work offers (new job, user/invite home site):
 * enabled ones (0041), plus any id in `keep` (the value already chosen), so a
 * select still shows a disabled site it holds instead of silently another.
 * `active` missing (an old select) counts as enabled.
 */
export function pickableSites(sites: Site[], keep: (string | null | undefined)[] = []): Site[] {
  return sites.filter((s) => s.active !== false || keep.includes(s.id));
}

/**
 * Where a switching admin opens: their remembered pick, else home, else the
 * first, all among enabled sites. With none enabled, among all of them, so the
 * history screens still open on a site.
 */
export function startSiteId(sites: Site[], saved: string | null, homeSiteId: string | null): string | null {
  const enabled = pickableSites(sites);
  const pool = enabled.length > 0 ? enabled : sites;
  return pool.some((x) => x.id === saved) ? saved : defaultSiteId(pool, homeSiteId);
}

/**
 * Shared site scoping for the dashboard, export and analytics. Admins may
 * switch sites; managers and workers are pinned (RLS would reject anything
 * else). Carasso has no home site: `sites` holds only the ones an admin linked
 * to it (RLS, 0028), `siteId` null means ALL of them, and `multiSite` says the
 * file/grid spans more than one (so the Site column is offered).
 * `sites` holds disabled sites too (history, filters, stats); only the
 * starting site is chosen among enabled ones.
 */
export function useSiteScope() {
  const { appUser } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteIdState] = useState<string | null>(null);
  const isCarasso = appUser?.role === 'carasso';
  const canSwitch = appUser?.role === 'admin' || isCarasso;

  /** A pick is remembered, so the next visit opens on it. */
  const setSiteId = (id: string | null) => {
    setSiteIdState(id);
    if (appUser && id) setSiteChoice(appUser.id, id);
  };

  useEffect(() => {
    if (!appUser) return;
    let cancelled = false;

    if (!canSwitch) setSiteIdState(appUser.site_id);

    void supabase
      .from('sites')
      .select('id, name, active')
      .order('name')
      .then(({ data }) => {
        if (cancelled) return;
        const list = data ?? [];
        setSites(list);
        // Only seed the default; never clobber a site the admin picked while
        // this request was in flight.
        // Carasso opens on "all my sites" (null), not on one of them.
        if (canSwitch && !isCarasso) {
          const start = startSiteId(list, getSiteChoice(appUser.id), appUser.site_id);
          setSiteIdState((prev) => prev ?? start);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appUser, canSwitch, isCarasso]);

  const multiSite = isCarasso ? siteId === null && sites.length > 1 : false;

  return { sites, siteId, setSiteId, canSwitch, multiSite };
}
