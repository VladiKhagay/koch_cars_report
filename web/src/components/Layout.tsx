import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { startQueueSync } from '../lib/offlineQueue';
import { useQueuedCount } from '../lib/useQueue';
import { navItemsFor, type NavItem } from '../lib/nav';
import Icon from './Icon';
import Logo from './Logo';

/**
 * Pending-sync indicator.
 *
 * Queued work is as real as submitted work, so it is shown in the shell rather
 * than on the one screen that created it. Near-black on white: it must not
 * read as an error (nothing is wrong) and must survive a phone screen in
 * direct sun, which is where hue goes first.
 */
function QueueIndicator({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  const count = useQueuedCount();
  if (count === 0) return null;

  return (
    <NavLink
      to="/mine"
      className={`inline-flex min-h-tap items-center gap-2 rounded-lg bg-ink-900 px-3 font-semibold text-surface ${
        compact ? 'text-xs' : 'w-full text-sm'
      }`}
    >
      <Icon name="sync" size={16} className="shrink-0" />
      <span className="truncate">{compact ? t('queue.badge', { count }) : t('queue.pending', { count })}</span>
    </NavLink>
  );
}

export default function Layout() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const role = appUser?.role;
  const { primary, secondary } = navItemsFor(role, t);
  const isWorker = role === 'worker';

  // The sidebar has room for everything; the tab bar earns its fifth slot with
  // a single entry point to the rest.
  const sidebarItems = [...primary, ...secondary];
  const tabBarItems: NavItem[] =
    secondary.length > 0 ? [...primary, { to: '/more', label: t('nav.more'), icon: 'menu' }] : primary;

  // One sync loop for the whole app: keeps the queue snapshot current and
  // retries pending submissions whenever the device comes back online.
  useEffect(() => startQueueSync(), []);

  return (
    /* App shell, not a document: the frame is exactly one viewport tall
       (`dvh`, so a phone's collapsing address bar is accounted for) and the
       only thing that scrolls is <main>. That is what pins the tab bar — it is
       a flex sibling of the scroller, so it cannot float up on a short page,
       cannot be pushed down by a long one, and needs no content padding to
       keep from covering what it sits over. */
    <div className="flex h-dvh flex-col bg-sunken md:flex-row">
      {/* The nav is the same five-to-seven stops on every page. Without this a
          keyboard user tabs through all of them before reaching the form they
          came for — and on New Job that is the difference between one car and
          the next. Visible only when focused, so it costs nothing on screen. */}
      {/* Parked off-screen by transform rather than the usual
          `sr-only focus:not-sr-only`: that pair resolves `position` twice at
          the same specificity, so which of static/fixed wins comes down to
          stylesheet order. A transform has nothing to tie with. */}
      <a
        href="#main"
        className="fixed start-4 top-4 z-30 inline-flex min-h-tap -translate-y-24 items-center rounded-lg bg-ink-900 px-4 font-semibold text-surface shadow-raised transition-transform duration-150 focus:translate-y-0"
      >
        {t('nav.skipToContent')}
      </a>
      {/*
        Desktop sidebar. Managers and admins live here, so it is a persistent
        shell; phones keep the bottom tab bar.

        It fills the shell's height and scrolls on its own, which covers the
        short-viewport case — a phone in landscape is past `md`, so it gets
        this sidebar in ~390px of height, which is less than the nav needs.
      */}
      <aside className="safe-top hidden w-60 shrink-0 flex-col border-e border-line bg-surface p-4 md:flex md:h-full md:overflow-y-auto">
        <div className="mb-7 px-1 pt-1 text-ink-900">
          <Logo height={22} decorative />
        </div>

        <nav aria-label={t('nav.mainNav')} className="flex flex-1 flex-col gap-1">
          {sidebarItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex min-h-tap items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors duration-150 ${
                  isActive ? 'bg-ink-900 text-surface' : 'text-ink-700 hover:bg-ink-100 active:bg-ink-200'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={item.icon} size={20} className={isActive ? '' : 'text-ink-500'} />
                  <span className="min-w-0 break-words">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {isWorker && (
          <div className="mt-3">
            <QueueIndicator />
          </div>
        )}

        {/* Account. Sign out used to sit here as a 12px text link next to two
            other 12px text links; it now lives inside Profile behind the
            app's standard confirmation step. */}
        <NavLink
          to="/profile"
          className={({ isActive }) =>
            `mt-3 flex min-h-tap items-center gap-3 rounded-lg border-t border-line px-3 pt-3 text-sm font-semibold ${
              isActive ? 'text-ink-900' : 'text-ink-700 hover:text-ink-900'
            }`
          }
        >
          <Icon name="user" size={20} className="shrink-0 text-ink-500" />
          <span className="min-w-0 truncate">{appUser?.name || t('nav.profile')}</span>
        </NavLink>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Sibling of the scroller, so it stays put without `sticky`. */}
        <header className="safe-top flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5 md:hidden">
          <span className="text-ink-900">
            <Logo height={20} decorative />
          </span>
          <div className="flex items-center gap-2">
            {isWorker && <QueueIndicator compact />}
            <NavLink
              to="/profile"
              aria-label={t('nav.account')}
              className="inline-flex size-control items-center justify-center rounded-lg text-ink-700 transition-colors duration-150 hover:bg-ink-100 active:bg-ink-200"
            >
              <Icon name="user" size={22} />
            </NavLink>
          </div>
        </header>

        {/* The app's one scroll container. `min-h-0` is load-bearing: a flex
            child defaults to min-height:auto and would grow to its content
            instead of scrolling, which is how the bar gets pushed off. */}
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>

        {/* Mobile tab bar. Icons carry the identity so a label that wraps or
            shortens in Russian is never the only thing distinguishing two
            tabs — the manager role has five of these at 375px. */}
        <nav
          aria-label={t('nav.mainNav')}
          className="safe-bottom z-20 flex shrink-0 border-t border-line bg-surface shadow-bar md:hidden"
        >
          {tabBarItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `relative flex min-h-control-lg min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-center text-[11px] font-semibold leading-[1.15] active:bg-ink-50 ${
                  isActive ? 'text-ink-900' : 'text-ink-500'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* Position + weight, not only colour, marks the current tab. */}
                  {isActive && <span aria-hidden className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-ink-900" />}
                  <Icon name={item.icon} size={22} strokeWidth={isActive ? 2 : 1.75} />
                  <span className="w-full break-words">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
