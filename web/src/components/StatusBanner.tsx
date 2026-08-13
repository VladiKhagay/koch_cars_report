import type { ReactNode } from 'react';
import Icon, { type IconName } from './Icon';

/**
 * The app's one inline status block.
 *
 * Every tone carries an icon as well as a hue, and the icon differs per tone —
 * not just the colour. Two reasons, both operational rather than cosmetic:
 * colour-vision deficiency, and the fact that hue discrimination is the first
 * thing to fail on a phone screen in direct sunlight, which is exactly where
 * "did that submit?" gets asked.
 *
 * Tone names are unchanged from the previous implementation because the
 * design-sync preview set references them (web/.design-sync/previews).
 */
type Tone = 'info' | 'warning' | 'error' | 'success' | 'pending';

const TONES: Record<Tone, { box: string; icon: IconName }> = {
  info: { box: 'border-line bg-ink-50 text-ink-800', icon: 'info' },
  warning: { box: 'border-warn-200 bg-warn-50 text-warn-700', icon: 'alertTriangle' },
  error: { box: 'border-danger-200 bg-danger-50 text-danger-700', icon: 'alertCircle' },
  success: { box: 'border-ok-200 bg-ok-50 text-ok-700', icon: 'checkCircle' },
  // Queued-offline work. Monochrome and inverted on purpose: it must not read
  // as a warning (nothing is wrong) and it must not read as success (nothing
  // has been recorded yet). Near-black on white is also the most legible thing
  // this palette can produce outdoors.
  pending: { box: 'border-ink-900 bg-ink-900 text-surface', icon: 'sync' },
};

export default function StatusBanner({
  tone,
  children,
  icon,
  /** Announce the message to assistive tech as it appears. */
  live = false,
}: {
  tone: Tone;
  children: ReactNode;
  icon?: IconName;
  live?: boolean;
}) {
  const { box, icon: defaultIcon } = TONES[tone];
  return (
    <div
      role={live ? 'status' : undefined}
      aria-live={live ? 'polite' : undefined}
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm font-medium ${box}`}
    >
      <Icon name={icon ?? defaultIcon} size={18} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
