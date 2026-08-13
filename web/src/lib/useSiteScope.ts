import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from './supabase';
import type { Site } from './types';

/**
 * The site a screen should open on.
 *
 * Everyone starts at the site they actually work at — including admins, who
 * previously landed on whichever site sorted first alphabetically. An admin
 * checking the morning's jobs is almost always standing in one of the three
 * buildings, and having to re-pick it on every screen was pure friction.
 */
export function defaultSiteId(sites: Site[], homeSiteId: string | null): string | null {
  if (homeSiteId && sites.some((s) => s.id === homeSiteId)) return homeSiteId;
  return sites[0]?.id ?? null;
}

/**
 * Shared site scoping for the three site-aware screens (dashboard, export,
 * analytics). Admins may switch sites; managers and workers are pinned to
 * their own — RLS would reject anything else anyway, so no picker is offered.
 *
 * The site list is loaded for every role, not just admins: managers need the
 * name for export filenames and chart labels.
 */
export function useSiteScope() {
  const { appUser } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const canSwitch = appUser?.role === 'admin';

  useEffect(() => {
    if (!appUser) return;
    let cancelled = false;

    if (!canSwitch) setSiteId(appUser.site_id);

    void supabase
      .from('sites')
      .select('*')
      .order('name')
      .then(({ data }) => {
        if (cancelled) return;
        const list = data ?? [];
        setSites(list);
        // Only seed the default; never clobber a site the admin picked while
        // this request was in flight.
        if (canSwitch) setSiteId((prev) => prev ?? defaultSiteId(list, appUser.site_id));
      });

    return () => {
      cancelled = true;
    };
  }, [appUser, canSwitch]);

  return { sites, siteId, setSiteId, canSwitch };
}
