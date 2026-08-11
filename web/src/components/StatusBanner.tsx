import type { ReactNode } from 'react';

type Tone = 'info' | 'warning' | 'error' | 'success';

const TONES: Record<Tone, string> = {
  info: 'bg-brand-50 text-brand-700',
  warning: 'bg-amber-50 text-amber-800',
  error: 'bg-red-50 text-red-800',
  success: 'bg-emerald-50 text-emerald-800',
};

export default function StatusBanner({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <div className={`rounded-xl px-4 py-3 text-sm font-medium ${TONES[tone]}`}>{children}</div>;
}
