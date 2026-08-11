import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { setLanguage } from '../lib/i18n';
import type { UserRole } from '../lib/types';

interface NavItem {
  to: string;
  label: string;
}

function navItemsFor(role: UserRole | undefined, t: (key: string) => string): NavItem[] {
  if (role === 'worker') {
    return [
      { to: '/new', label: t('nav.newJob') },
      { to: '/mine', label: t('nav.myJobs') },
      { to: '/stats', label: t('nav.myStats') },
    ];
  }
  if (role === 'manager') {
    return [
      { to: '/dashboard', label: t('nav.dashboard') },
      { to: '/analytics', label: t('nav.analytics') },
      { to: '/team', label: t('nav.team') },
      { to: '/services', label: t('nav.services') },
      { to: '/export', label: t('nav.export') },
    ];
  }
  if (role === 'admin') {
    return [
      { to: '/dashboard', label: t('nav.dashboard') },
      { to: '/analytics', label: t('nav.analytics') },
      { to: '/export', label: t('nav.export') },
      { to: '/admin/users', label: t('nav.admin') },
    ];
  }
  return [];
}

const mobileTabClass = ({ isActive }: { isActive: boolean }) =>
  `min-w-0 flex-1 flex flex-col items-center justify-center px-0.5 py-2.5 text-[11px] font-medium truncate ${
    isActive ? 'text-brand-700' : 'text-slate-500'
  }`;

const sidebarLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
  }`;

export default function Layout() {
  const { t, i18n } = useTranslation();
  const { appUser, signOut } = useAuth();
  const role = appUser?.role;
  const navItems = navItemsFor(role, t);

  return (
    <div className="flex min-h-full flex-col bg-slate-50 md:flex-row">
      {/* Desktop sidebar — admin/manager mainly work here, so it's a persistent
          shell rather than the mobile bottom tab bar (which stays for phones). */}
      <aside className="safe-top hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex">
        <span className="mb-6 text-lg font-semibold text-slate-900">{t('app.name')}</span>
        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={sidebarLinkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-3 border-t border-slate-100 pt-3">
          <NavLink to="/profile" className="text-xs font-medium text-slate-500 underline underline-offset-2">
            {t('nav.profile')}
          </NavLink>
          <button
            className="text-xs font-medium text-slate-500 underline underline-offset-2"
            onClick={() => setLanguage(i18n.language === 'en' ? 'ru' : 'en')}
          >
            {i18n.language === 'en' ? 'RU' : 'EN'}
          </button>
          <button className="text-xs font-medium text-slate-500 underline underline-offset-2" onClick={() => void signOut()}>
            {t('auth.signOut')}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-top flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <span className="text-lg font-semibold text-slate-900">{t('app.name')}</span>
          <div className="flex items-center gap-3">
            <NavLink to="/profile" className="text-xs font-medium text-slate-500 underline underline-offset-2">
              {t('nav.profile')}
            </NavLink>
            <button
              className="text-xs font-medium text-slate-500 underline underline-offset-2"
              onClick={() => setLanguage(i18n.language === 'en' ? 'ru' : 'en')}
            >
              {i18n.language === 'en' ? 'RU' : 'EN'}
            </button>
            <button className="text-xs font-medium text-slate-500 underline underline-offset-2" onClick={() => void signOut()}>
              {t('auth.signOut')}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          <Outlet />
        </main>

        <nav className="safe-bottom fixed bottom-0 left-0 right-0 flex border-t border-slate-200 bg-white md:hidden">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={mobileTabClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
