# Vehicle Prep Tracker UI — how to build with this system

Six React components lifted from the Vehicle Prep Tracker app (`web/src/components`). Styling is **Tailwind CSS v4** — the whole design language lives in utility classes, not in component props.

## Setup

Wrap anything that uses `AdminTabs` in `DSProvider` — it renders react-router `<Link>`s and throws outside a router:

```jsx
<DSProvider>
  <AdminTabs active="services" />
</DSProvider>
```

Everything else renders standalone. Copy in `en`/`ru` strings yourself where a screen needs them: the components call `react-i18next` internally and fall back to the app's bundled English when a key is missing, so labels you pass as props (`label`, `title`, banner children) are the ones you control.

## Styling idiom: Tailwind utility classes

Style your own layout glue with Tailwind classes. The shipped stylesheet carries the app's palette plus a broad layout surface — these families all resolve:

| Family | Vocabulary |
|---|---|
| Brand (primary actions, active states) | `bg-brand-600` `bg-brand-700` `text-brand-700` `border-brand-600` `bg-brand-50` — the brand scale is **only** `50 100 500 600 700 900` (defined in the app's `@theme`); `brand-200/300/400/800` do not exist |
| Neutrals | `bg-slate-50` (page) `bg-white` (cards) `border-slate-200` `text-slate-900` (primary) `text-slate-500` (secondary) `text-slate-400` (tertiary) |
| Semantic | `bg-amber-50 text-amber-800` (warning) · `bg-red-50 text-red-800` / `bg-red-600` (error, destructive) · `bg-emerald-50 text-emerald-800` (success) |
| Surface | `rounded-xl` (cards) `rounded-2xl` (photo tiles) `rounded-full` (chips, pills) `border` `shadow-sm` |
| Spacing | `p-3 p-4 gap-2 gap-3 gap-4 mt-1` — scale `0 0.5 1…24` |
| Type | `text-xs text-sm text-2xl` · `font-medium font-semibold font-bold` · `tabular-nums` for figures |
| Layout | `flex flex-col items-center justify-between` · `grid grid-cols-3` · `md:grid-cols-3` `md:flex` (`sm:` `md:` `lg:` prefixes available) |
| State | `hover:bg-brand-700` `focus-visible:ring-2` `disabled:opacity-50` `animate-spin` |

Three rules this app holds to, and you should too:

- **`bg-brand-600` (#2563eb) is the only primary-action fill.** Active tabs, selected chips, submit buttons.
- **Tap targets ≥44px** — `min-h-11` on every button a worker taps with gloves on. Worker screens are phone-only.
- **Leave room for Russian.** Every string ships in English and Russian; Cyrillic runs ~40–60% longer. Never fix a label's width; let text wrap.

Read `styles.css` and its import `_ds_bundle.css` for the full class list, and each component's `.prompt.md` for its props.

## Components

- `StatTile` — `{label, value}` figure card. Rows of 2–3 on stats/analytics screens.
- `StatusBanner` — `{tone: 'info'|'warning'|'error'|'success', children}` inline notice. The only banner; don't hand-roll one.
- `ServiceChips` — `{services, selected, onToggle}` multi-select pills. `services` items are `{id, catalog_number, name_en, name_ru, active, sort_order}`; the chip label picks `name_ru` when the language is Russian.
- `BarChart` — `{title, data: {label, value}[], valueLabel?}` SVG bars with a built-in "Show table" accessibility toggle and a "Not enough data yet" empty state.
- `PhotoCapture` — `{label, photo: Blob|null, busy?, error?, onCapture, onTypeItIn?}`. Derives four states from props: **empty** (dashed, camera icon) → **processing** (`busy`, blue + spinner) → **error** (`error`, red, Retake / Type it in) → **success** (photo present, emerald, thumbnail + Retake).
- `AdminTabs` — `{active: 'users'|'services'|'sites'}` admin sub-nav. Needs `DSProvider`.

## Example

```jsx
<div className="min-h-screen bg-slate-50 p-4">
  <div className="grid grid-cols-3 gap-3">
    <StatTile label="Total jobs" value={1284} />
    <StatTile label="This month" value={128} />
    <StatTile label="Avg / month" value={107} />
  </div>
  <div className="mt-4">
    <StatusBanner tone="warning">This VIN was already logged in the last 7 days</StatusBanner>
  </div>
  <div className="mt-4">
    <BarChart title="Jobs by month" valueLabel="Jobs" data={monthly} />
  </div>
</div>
```
