import { Navigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { navItemsFor } from '../lib/nav';
import Icon from '../components/Icon';
import { Page, PageHeading } from '../components/ui';

/**
 * Secondary navigation on a phone: the weekly screens one tap behind the five
 * tabs. A route, not a drawer (no overlay, focus trap or scroll lock; back
 * button and deep links come free). Unreachable on desktop, where the sidebar lists these.
 */
export default function More() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const { secondary } = navItemsFor(appUser?.role, t);

  // An admin has no secondary items — their equivalent is the Admin tabs.
  if (secondary.length === 0) return <Navigate to="/" replace />;

  return (
    <Page width="form">
      <PageHeading>{t('nav.more')}</PageHeading>

      <nav aria-label={t('nav.more')} className="space-y-2">
        {secondary.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex min-h-control-lg items-center gap-3 rounded-xl border border-line bg-surface p-4 text-base font-semibold text-ink-900 shadow-card transition-colors duration-150 hover:border-line-strong active:bg-ink-50"
          >
            <Icon name={item.icon} size={22} className="shrink-0 text-ink-500" />
            <span className="min-w-0 break-words">{item.label}</span>
            {/* Flips in Hebrew — it points along the reading direction. */}
            <Icon name="chevronRight" size={18} className="ms-auto shrink-0 text-ink-500" />
          </Link>
        ))}
      </nav>
    </Page>
  );
}
