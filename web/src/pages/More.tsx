import { Navigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { navItemsFor } from '../lib/nav';
import Icon from '../components/Icon';
import { Page, PageHeading } from '../components/ui';

/**
 * Secondary navigation, on a phone.
 *
 * The bottom tab bar caps at five, so a manager's weekly screens live one tap
 * behind here rather than crowding the four they use hourly.
 *
 * It is a route, not a drawer. A drawer means an overlay, a focus trap, escape
 * handling and scroll locking to be accessible, and the app has no other modal
 * anywhere — even destructive confirmation is an inline panel. A page gets the
 * back button, deep links and focus management for free, and matches the
 * pattern already in the product.
 *
 * On desktop it is unreachable by design: the sidebar already lists these, so
 * anyone arriving here with a wide window is sent home.
 */
export default function More() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const { secondary } = navItemsFor(appUser?.role, t);

  // An admin has no secondary items — their equivalent is the Admin tabs.
  if (secondary.length === 0) return <Navigate to="/" replace />;

  return (
    <Page width="form" className="space-y-5">
      <PageHeading>{t('nav.more')}</PageHeading>

      <nav aria-label={t('nav.more')} className="space-y-2">
        {secondary.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex min-h-control-lg items-center gap-3 rounded-xl border border-line bg-surface p-4 text-base font-semibold text-ink-900 shadow-card transition-colors duration-150 hover:border-line-strong"
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
