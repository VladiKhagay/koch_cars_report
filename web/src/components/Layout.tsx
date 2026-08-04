import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { setLanguage } from '../lib/i18n';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `flex-1 flex flex-col items-center justify-center py-2 text-xs font-medium ${
    isActive ? 'text-brand-700' : 'text-slate-500'
  }`;

export default function Layout() {
  const { t, i18n } = useTranslation();
  const { appUser, signOut } = useAuth();
  const role = appUser?.role;

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="safe-top flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <span className="text-lg font-semibold text-slate-900">{t('app.name')}</span>
        <div className="flex items-center gap-3">
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

      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>

      <nav className="safe-bottom fixed bottom-0 left-0 right-0 flex border-t border-slate-200 bg-white">
        {role === 'worker' && (
          <>
            <NavLink to="/new" className={tabClass}>
              {t('nav.newJob')}
            </NavLink>
            <NavLink to="/mine" className={tabClass}>
              {t('nav.myJobs')}
            </NavLink>
          </>
        )}
        {(role === 'manager' || role === 'admin') && (
          <>
            <NavLink to="/dashboard" className={tabClass}>
              {t('nav.dashboard')}
            </NavLink>
            <NavLink to="/export" className={tabClass}>
              {t('nav.export')}
            </NavLink>
          </>
        )}
        {role === 'admin' && (
          <NavLink to="/admin/users" className={tabClass}>
            {t('nav.admin')}
          </NavLink>
        )}
      </nav>
    </div>
  );
}
