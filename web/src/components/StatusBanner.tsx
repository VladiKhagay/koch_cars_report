import type { ReactNode } from 'react';
import Icon, { type IconName } from './Icon';

/**
 * The app's one inline status block. Every tone has its own icon as well as a
 * hue (hue is the first thing to fail in direct sun). Tone names are referenced
 * by the design-sync previews (web/.design-sync/previews).
 */
type Tone = 'info' | 'warning' | 'error' | 'success' | 'pending';

const TONES: Record<Tone, { box: string; icon: IconName }> = {
  info: { box: 'border-line bg-ink-50 text-ink-800', icon: 'info' },
  warning: { box: 'border-warn-200 bg-warn-50 text-warn-700', icon: 'alertTriangle' },
  error: { box: 'border-danger-200 bg-danger-50 text-danger-700', icon: 'alertCircle' },
  success: { box: 'border-ok-200 bg-ok-50 text-ok-700', icon: 'checkCircle' },
    // Queued-offline work: monochrome on purpose, neither a warning (nothing is wrong) nor a success (not recorded yet).
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
