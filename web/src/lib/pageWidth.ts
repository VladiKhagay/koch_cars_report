/**
 * The page column widths, and the only place they are written down.
 *
 * They exist mostly to close the 768–1023px dead zone: the shell's sidebar
 * appears at `md`, so page columns have to widen at `md` too, not at `lg`.
 * `Page` applies them; NewJob's sticky submit bar reads `form` directly so the
 * bar and the column it sits under can never drift apart.
 *
 * This lives outside `ui.tsx` for a mechanical reason. React Fast Refresh can
 * only hot-patch a module whose exports are all components or statically
 * analyzable constants; an exported object literal is neither, so Vite
 * downgrades the whole module to a full page reload:
 *
 *   [vite] hmr invalidate /src/components/ui.tsx
 *     Could not Fast Refresh ("PAGE_WIDTH" export is incompatible)
 *
 * Every page imports `ui.tsx`, so that one export cost the entire app a reload
 * on every edit — and a tab that misses one of those reloads silently goes on
 * rendering stale UI. The plain string exports (`fieldClass`) are fine to keep
 * there; it is specifically the object that has to live somewhere else.
 */
export type PageWidth = 'form' | 'list' | 'wide';

export const PAGE_WIDTH: Record<PageWidth, string> = {
  form: 'max-w-md md:max-w-xl',
  list: 'max-w-2xl md:max-w-3xl lg:max-w-5xl',
  wide: 'max-w-2xl md:max-w-4xl lg:max-w-6xl',
};
