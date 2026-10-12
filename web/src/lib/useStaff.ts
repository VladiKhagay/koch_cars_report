import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { StaffMember } from './types';

/**
 * Everyone on staff, every site, deactivated included — through `list_staff()`
 * (migration 0019), because workers can't read the `users` table and still need
 * colleagues' names for the co-worker picker and "with Dana".
 *
 * ponytail: fetched once per page load and shared. A colleague added mid-shift
 * shows up after a reload; refetch on mount if that ever matters.
 */
let pending: Promise<StaffMember[]> | null = null;

function loadStaff(): Promise<StaffMember[]> {
  pending ??= Promise.resolve(supabase.rpc('list_staff')).then(({ data, error }) => {
    if (error) {
      pending = null; // let the next screen try again rather than caching a failure
      return [];
    }
    return (data ?? []) as StaffMember[];
  });
  return pending;
}

export function useStaff(): StaffMember[] {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  useEffect(() => {
    let live = true;
    void loadStaff().then((list) => live && setStaff(list));
    return () => {
      live = false;
    };
  }, []);
  return staff;
}

/** Names for a list of ids, in order, skipping anyone unknown. */
export function staffNames(staff: StaffMember[], ids: string[]): string[] {
  return ids.map((id) => staff.find((s) => s.id === id)?.name).filter((n): n is string => Boolean(n));
}
