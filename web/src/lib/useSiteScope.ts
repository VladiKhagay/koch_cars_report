import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from './supabase';
import type { Site } from './types';

/** The site a screen opens on: the one the person works at, admins included. */
export function defaultSiteId(sites: Site[], homeSiteId: string | null): string | null {
  if (homeSiteId && sites.some((s) => s.id === homeSiteId)) return homeSiteId;
  return sites[0]?.id ?? null;
}

/**
 * Shared site scoping for the dashboard, export and analytics. Admins may
 * switch sites; managers and workers are pinned (RLS would reject anything
 * else). The site list loads for every role, as managers need names for filenames and labels.
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
