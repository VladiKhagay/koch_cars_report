import type { IconName } from '../components/Icon';
import type { UserRole } from './types';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

/**
 * A role's destinations by frequency. `primary` is the bottom tab bar, capped at
 * five (a sixth drops below the touch target at 375px). `secondary` sits in the
 * desktop sidebar and behind one "More" tab on a phone.
 */
export interface Nav {
  primary: NavItem[];
  secondary: NavItem[];
}

/**
 * Who may open which route: the single source for App.tsx's route guards, so
 * a new role is one edit here. Anything not listed is closed to Carasso.
 */
export const ROUTE_ROLES = {
  newJob: ['worker'],
  workerScreens: ['worker'],
  dashboard: ['manager', 'admin'],
  /** All Jobs and Job Detail (Carasso reads them through jobs_carasso, read-only). */
  jobs: ['manager', 'admin', 'carasso'],
  /** Customer report (Carasso: customer report only). */
  export: ['manager', 'admin', 'carasso'],
  analytics: ['manager', 'admin'],
  team: ['manager'],
  services: ['manager', 'admin'],
  admin: ['admin'],
} as const satisfies Record<string, readonly UserRole[]>;

/** Where `/` sends each role. An unknown role gets the safe, read-only page. */
export function landingPathFor(role: UserRole | undefined): string {
  if (role === 'worker') return '/new';
  if (role === 'manager' || role === 'admin') return '/dashboard';
  return '/jobs';
}

export function navItemsFor(role: UserRole | undefined, t: (key: string) => string): Nav {
  if (role === 'worker') {
    return {
      primary: [
        { to: '/new', label: t('nav.newJob'), icon: 'camera' },
        { to: '/mine', label: t('nav.myJobs'), icon: 'list' },
        { to: '/stats', label: t('nav.myStats'), icon: 'chart' },
        { to: '/lookup', label: t('nav.lookup'), icon: 'search' },
      ],
      secondary: [],
    };
  }
  if (role === 'manager') {
    return {
      primary: [
        { to: '/dashboard', label: t('nav.dashboard'), icon: 'grid' },
        { to: '/jobs', label: t('nav.jobs'), icon: 'clipboard' },
        { to: '/analytics', label: t('nav.analytics'), icon: 'chart' },
        { to: '/export', label: t('nav.export'), icon: 'download' },
      ],
      secondary: [
        { to: '/team', label: t('nav.team'), icon: 'users' },
        { to: '/services', label: t('nav.services'), icon: 'tag' },
      ],
    };
  }
  if (role === 'admin') {
    // Admins reach services and sites through the Admin tabs, so nothing here
    // needs demoting — this is already exactly five.
    return {
      primary: [
        { to: '/dashboard', label: t('nav.dashboard'), icon: 'grid' },
        { to: '/jobs', label: t('nav.jobs'), icon: 'clipboard' },
        { to: '/analytics', label: t('nav.analytics'), icon: 'chart' },
        { to: '/export', label: t('nav.export'), icon: 'download' },
        { to: '/admin/users', label: t('nav.admin'), icon: 'settings' },
      ],
      secondary: [],
    };
  }
  if (role === 'carasso') {
    return {
      primary: [
        { to: '/jobs', label: t('nav.jobs'), icon: 'clipboard' },
        { to: '/export', label: t('nav.export'), icon: 'download' },
      ],
      secondary: [],
    };
  }
  return { primary: [], secondary: [] };
}
