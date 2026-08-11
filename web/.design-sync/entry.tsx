// Design-system entry for /design-sync (claude.ai/design).
//
// This app has no library build, so this file is the library entry: it
// re-exports the shared UI components from src/components as named exports
// and adds the provider the preview cards need. It is NOT imported by the
// app itself — the app imports each component directly.
//
// PhotoViewer is deliberately absent: it pulls in src/lib/workerApi ->
// src/lib/supabase, whose createClient() throws at import time without
// VITE_SUPABASE_* env vars, which would take down the whole bundle.
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

// Side-effect import: initReactI18next registers the instance globally, so
// useTranslation() resolves without an <I18nextProvider> wrapper.
import '../src/lib/i18n';

export { default as StatTile } from '../src/components/StatTile';
export { default as ServiceChips } from '../src/components/ServiceChips';
export { default as BarChart } from '../src/components/BarChart';
export { default as PhotoCapture } from '../src/components/PhotoCapture';
export { default as AdminTabs } from '../src/components/AdminTabs';
export { default as StatusBanner } from '../src/components/StatusBanner';

export type { BarDatum } from '../src/components/BarChart';
export type { Service } from '../src/lib/types';

/**
 * Preview/root wrapper. AdminTabs renders react-router <Link>s, which throw
 * outside a router; MemoryRouter satisfies that without touching the URL.
 * In the real app this role is played by <BrowserRouter> in App.tsx.
 */
export function DSProvider({ children }: { children?: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}
