import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { startQueueSync } from '../lib/offlineQueue';
import { useQueuedJobs, useUploadingId } from '../lib/useQueue';
import { navItemsFor, type NavItem } from '../lib/nav';
import Icon from './Icon';
import Logo from './Logo';

/** Pending-sync indicator, shown in the shell. Near-black on white so it reads as neither an error nor a success, and survives direct sun. */
function QueueIndicator({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  const queued = useQueuedJobs();
  const uploadingId = useUploadingId();
  const count = queued.length;
  if (count === 0) return null;

  /* Videos follow their job on their own, so they get their own words and never
     count as unsent jobs. Priority: a failed video (only the worker can act on
     it: My Jobs, Retry / Discard), then unsent jobs, then the video uploading,
     then a video waiting. */
  const videos = queued.filter((e) => e.stage === 'video');
  const jobs = count - videos.length;
  const videoFailed = videos.some((e) => e.needsAttention);
  const state = videoFailed ? 'failed' : jobs > 0 ? 'jobs' : uploadingId ? 'uploading' : 'waiting';
  const label = {
    failed: t('queue.videoFailed'),
    jobs: t('queue.pending', { count: jobs }),
    uploading: t('queue.videoUploading'),
    waiting: t('queue.videoWaiting'),
  }[state];
  const badge = {
    failed: t('queue.badgeVideoFailed'),
    jobs: t('queue.badge', { count: jobs }),
    uploading: t('queue.badgeVideoUploading'),
    waiting: t('queue.badgeVideoWaiting'),
  }[state];

  return (
    <NavLink
      to="/mine"
      className={`inline-flex min-h-tap items-center gap-2 rounded-lg bg-accent px-3 font-semibold text-surface ${
        compact ? 'text-xs' : 'w-full text-sm'
      }`}
    >
      <Icon name={videoFailed ? 'alertTriangle' : 'sync'} size={16} className="shrink-0" />
      <span className="truncate">{compact ? badge : label}</span>
      {compact && <span className="sr-only">{label}</span>}
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
        /* App shell: exactly one viewport tall (`dvh`) with only <main> scrolling,
           so the tab bar stays pinned without content padding. */
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
        className="fixed start-4 top-4 z-30 inline-flex min-h-tap -translate-y-24 items-center rounded-lg bg-accent px-4 font-semibold text-surface shadow-raised transition-transform duration-150 focus:translate-y-0"
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
                `relative flex min-h-tap items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors duration-150 ${
                  isActive ? 'bg-accent-soft text-ink-900' : 'text-ink-700 hover:bg-ink-100 active:bg-ink-200'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* Indicator bar + weight + tint: the current page is never colour alone. */}
                  {isActive && <span aria-hidden className="absolute inset-y-2 start-0 w-1 rounded-full bg-accent" />}
                  <Icon name={item.icon} size={20} strokeWidth={isActive ? 2.25 : 1.75} className={isActive ? '' : 'text-ink-500'} />
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
          className="safe-bottom-tight z-20 flex shrink-0 border-t border-line bg-surface shadow-bar md:hidden"
        >
          {tabBarItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `relative flex min-h-control-lg min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-center text-xs font-semibold leading-[1.15] active:bg-ink-50 ${
                  isActive ? 'text-ink-900' : 'text-ink-600'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* Position + weight, not only colour, marks the current tab. */}
                  {isActive && <span aria-hidden className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-accent" />}
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
