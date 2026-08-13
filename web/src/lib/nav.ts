import type { IconName } from '../components/Icon';
import type { UserRole } from './types';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

/**
 * A role's destinations, split by how often they are reached.
 *
 * `primary` is what the bottom tab bar shows. Five is the ceiling: at 375px a
 * sixth tab leaves each one about 62px, which is under the touch target the
 * rest of the app holds itself to and turns the labels into two-line stubs.
 * `secondary` is everything a manager visits weekly rather than hourly — it
 * still sits directly in the desktop sidebar, which has the room, and collapses
 * behind one "More" tab on a phone.
 */
export interface Nav {
  primary: NavItem[];
  secondary: NavItem[];
}

export function navItemsFor(role: UserRole | undefined, t: (key: string) => string): Nav {
  if (role === 'worker') {
    return {
      primary: [
        { to: '/new', label: t('nav.newJob'), icon: 'camera' },
        { to: '/mine', label: t('nav.myJobs'), icon: 'list' },
        { to: '/stats', label: t('nav.myStats'), icon: 'chart' },
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
  return { primary: [], secondary: [] };
}
