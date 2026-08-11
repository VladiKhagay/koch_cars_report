# design-sync notes — Vehicle Prep Tracker UI

Project: https://claude.ai/design/p/6493c9f2-92f4-417d-a7a1-bb9e8334d370
First sync: 2026-08-10/11. Run everything from `web/`, not the repo root.

## This repo is an app, not a design system

- There is no library build. `web/dist/` is a compiled *app* (one hashed
  `index-*.js`, no exports), so the converter has nothing to point at.
  `.design-sync/entry.tsx` **is** the library entry: it re-exports the six
  shared components from `src/components` and adds `DSProvider`. Pass it with
  `--entry .design-sync/entry.tsx`. It is not imported by the app.
- Component discovery can't come from `.d.ts` exports (none exist), so
  `cfg.componentSrcMap` pins all six explicitly. **Adding a shared component to
  the app does not add it to the sync** — add it to BOTH `entry.tsx` and
  `componentSrcMap`.
- `PhotoViewer`, `Layout` and `ProtectedRoute` are deliberately excluded.
  `PhotoViewer` → `lib/workerApi` → `lib/supabase`, whose `createClient()`
  throws at import time without `VITE_SUPABASE_*`; including it takes down the
  whole bundle, not just that component. `Layout`/`ProtectedRoute` are wired to
  the router and Supabase auth context.

## Styling: the safelist is load-bearing

- `cfg.buildCmd` compiles `.design-sync/tailwind-entry.css`, not `src/index.css`.
  That wrapper adds `@source "./previews"` (so preview-only classes compile) and
  a large `@source inline(...)` safelist.
- **Why the safelist matters:** Tailwind v4 emits only utilities it finds in
  scanned source. The Claude Design agent writes its own layout glue against the
  shipped stylesheet and never runs a Tailwind build — without the safelist,
  every class the app doesn't already use silently resolves to nothing. The
  safelist takes the CSS from 17 KB to ~80 KB. If designs come out unstyled in
  some family, widen the safelist rather than telling the agent to avoid it.
- The `brand-*` scale only has steps **50, 100, 500, 600, 700, 900** — those are
  the six defined in `src/index.css`'s `@theme`. `bg-brand-200` etc. will never
  compile. `conventions.md` states this; keep the two in sync if the theme grows.
- Verify safelisted classes with escaping in mind: `md:flex` appears in the CSS
  as `.md\:flex`, so a naive `grep "md:flex"` reports a false miss.

## i18n and providers

- `src/lib/i18n.ts` self-initializes via `initReactI18next` on import, which
  registers the instance globally — so a plain side-effect import in `entry.tsx`
  is enough; no `<I18nextProvider>` needed. It reads `localStorage`, which is
  fine in the preview iframe.
- `cfg.provider` is `DSProvider` (a `MemoryRouter`), needed only by `AdminTabs`.

## Known render warns

- None. The final validate run reported 6/6 previews rendering cleanly with no
  `[RENDER_THIN]` / `variants render identically` / `[FONT_MISSING]` lines.
  System font stack only — no brand webfont to ship.

## Re-sync risks

- **The app is under active development.** `PhotoCapture` gained its `error` /
  `onTypeItIn` API and `StatusBanner` was added *during* the first sync run. A
  re-sync picks up source changes automatically, but a component whose props
  changed needs its `.design-sync/previews/<Name>.tsx` reviewed — a preview
  passing a removed prop still compiles and silently shows a stale state.
- **New shared components are invisible by default** — see the `componentSrcMap`
  note above. Check `git status` / `src/components/` against `entry.tsx` on every
  re-sync.
- **`conventions.md` enumerates real class and prop names.** Re-validate them
  against the fresh `ds-bundle/_ds_bundle.css` and `components/general/` on every
  re-sync; a name that no longer resolves makes the design agent ship unstyled
  output with no error.
- **`@tailwindcss/cli@4` is fetched via `npx` at build time** (it isn't a repo
  dependency). A major Tailwind bump could change `@source inline` semantics.
  Tailwind was 4.3.3 at first sync.
- The preview for `PhotoCapture` fabricates SVG `Blob`s as stand-in photos —
  intentional, since the component object-URLs a real `Blob`. It is not fetching
  anything.
- Playwright/chromium was installed into `.ds-sync/node_modules` +
  `~/Library/Caches/ms-playwright` for the render check; a fresh clone needs it
  again.
