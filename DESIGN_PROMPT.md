Design a UI for a small internal business app called "Vehicle Prep Tracker." Build it in React + Tailwind CSS (that's the actual stack this will be implemented in), and give me concrete, implementable output: component structure, Tailwind classes or design tokens (colors, spacing, type scale), and states — not just a mood board.

## What the app does

A car detailing/prep business logs finished vehicle jobs. A worker photographs a car's license plate and VIN, the fields auto-fill from the photos (OCR), the worker taps which services were performed, and submits. Managers review the day's jobs per site, fill in a billing code, and export to Excel. Admins manage users/services/sites and view analytics.

## Users and their devices — design mobile-first for two roles, desktop-first for one

- **Workers**: exclusively on their own phone (iPhone/Android), often with dirty/gloved hands, standing near a car. Primary screen: "New Job" — needs to be fast (under a minute), high-contrast, big tap targets, minimal typing.
- **Managers**: mobile phone, but less time-pressured — reviewing a list, tapping into records, entering a billing code.
- **Admins**: desktop/laptop, sitting at a computer. This is the one role that should get a real desktop layout (sidebar nav, multi-column dashboards, charts) rather than a scaled-up phone screen.

## Screens to design

**Worker (mobile)**
1. **New Job** — two photo-capture tiles (plate, VIN) that open the camera; below them, text fields that auto-fill from OCR but stay editable (plate, VIN, brand); a chip/tag multi-select for services performed; an optional note field; a submit button. Needs states for: capturing, OCR in progress, OCR failed (show why: blurry/glare/dark/bad angle/obstructed — let the worker retake or type manually), validation errors, offline (queued, will send when back online).
2. **My Jobs** — a list of the worker's own recent submissions, each editable for 15 minutes after submit (then locked).
3. **My Stats** — the worker's own job counts, viewable by month (simple bar chart + a couple of summary numbers: total, this month, average/month).

**Manager (mobile)**
4. **Dashboard** — today's jobs at their site, flags for possible duplicate VINs and missing billing codes, a search box, tap into a record.
5. **Job Detail** — the two photos, plate/VIN/brand/services/worker note (read-only), plus editable billing code and manager note.
6. **Export** — pick a date range, download an Excel file.

**Admin (desktop)**
7. **Analytics** — site selector, month picker, summary tiles (jobs this month, jobs today), and three bar charts: jobs by month (trend), jobs by worker, jobs by service (each service has a short catalog number like "SVC-004" shown alongside its name).
8. **Admin: Users / Services / Sites** — simple CRUD lists. Services each have a unique catalog number (admin-assigned, required), an English name, an optional Russian name, active/inactive toggle, and manual sort order.

## Constraints that matter

- **Installable PWA**, so it should feel like a native app when added to the home screen — no browser chrome assumptions.
- **Bilingual**: English and Russian (Cyrillic), toggle-able. Don't design text that only works in English (leave room for longer Russian strings).
- **Fast on mobile data**: no heavy imagery, no large icon fonts — inline SVG or system icons only.
- **Accessible tap targets** (≥44px) for workers who may be wearing light gloves or have wet/dirty hands.
- **Existing visual starting point** (feel free to improve on this, but it's the current baseline): white cards with rounded-xl corners on a light slate background, a blue primary color (#2563eb) for primary actions, slate grays for secondary text, amber for warnings, red for destructive actions/errors, green for success/active states. Bottom tab bar on mobile; a left sidebar on desktop (md breakpoint and up) for manager/admin.

## What I want back

1. A short design rationale (layout decisions, why this hierarchy).
2. For each screen above: a description or wireframe of the layout, concrete Tailwind utility classes or a token list (colors/spacing/type), and the key interactive states (empty, loading, error, success).
3. Anything you'd change about the information architecture or flows if it makes the worker's "New Job" submission meaningfully faster or the admin's analytics more useful — call it out explicitly rather than silently redesigning, since the current version is already implemented and working.
