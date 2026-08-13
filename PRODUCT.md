# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Three roles, invite-only. There is no self-signup and no public/marketing
surface — every screen is Operate mode: a signed-in person completing a task.

**Worker** (primary, and the only high-volume user). On their own phone,
standing next to a car on a lot. Submits one *job* per finished vehicle: plate
photo, VIN photo, the services performed, and an optional note. Wants to be
done in well under a minute so they can start the next car. Works both outdoors
in bright direct sunlight and inside covered/indoor garage areas, and is rushed
— many cars back to back. Sees only their own jobs (RLS, migration
`0003_tighten_worker_job_select.sql`).

**Manager**. Phone. Reviews the day's jobs for their own site, fills in billing
codes that arrive later from the importer, checks flags (possible duplicate
VINs, missing billing codes), activates/deactivates workers at their site,
maintains the shared service catalog, and exports for the office.

**Admin**. Desktop/laptop. All sites: analytics, users, sites, services,
exports. Small number of people, low frequency.

Not confirmed: whether gloves or wet hands are a factor. This was offered to
the client and not selected — do not assert it. The rushed, one-handed,
phone-in-a-yard context is confirmed and is sufficient justification on its own
for large touch targets.

## Product Purpose

Capture each finished vehicle-prep job once, correctly, at the source.

It replaces a WhatsApp-and-Excel workflow: a worker used to photograph a plate,
post it to a WhatsApp group, and a manager retyped everything into a
spreadsheet. Every step of that chain lost or corrupted data. This product
removes the retyping entirely — the worker's submission *is* the record, and
the office's Excel file is generated from it rather than typed into it.

Success is behavioural, not aesthetic: workers actually submit every car
(instead of reverting to WhatsApp), submissions stay fast enough not to slow
the line, and the manager's export is trustworthy without correction.
Submission time is the product's core metric.

## Positioning

Not a market position — an internal replacement for a specific manual process.
The mechanism that matters is that authorization lives in Postgres Row Level
Security rather than in the app, so the frontend and the Cloudflare Worker are
both thin and neither re-implements "who can see this job." Analytics read
`security_invoker` views (`job_monthly_stats`, `job_daily_stats`,
`job_service_stats`) that inherit the same RLS as the `jobs` table, so a
worker's own stats, a manager's site stats, and an admin's all-site stats are
the same query under three different identities.

## Operating Context

- **3 sites.** Site A ~6–8 workers, Site B ~10 workers, Site C 2 workers.
  ~60 cars/day at each large site, ~5/day at the small one (~125/day total,
  ~3,000/month). The client separately states the New Job screen takes ~250
  submissions/day. **Open:** these two figures do not reconcile; confirm which
  is the submission count before anyone sizes work against it. Either way, New
  Job outranks every other screen by one to two orders of magnitude.
- **Physical environment.** Both outdoor lots in bright direct sunlight and
  covered/indoor garage areas. Phone screens in sun; hurried, one-handed use.
- **Device split.** Worker: phone only. Manager: phone. Admin: desktop/laptop.
- **Connectivity.** Yard wifi and mobile data are unreliable. Failed
  submissions are persisted to IndexedDB and retried automatically when
  connectivity returns (`web/src/lib/offlineQueue.ts`). No job is ever dropped
  on the floor; the product's promise depends on the worker *believing* that.
- **Downstream ritual.** Billing codes arrive from the importer *after* the job
  is submitted, so a job is normally incomplete-by-design for a while and the
  manager fills the code in later. The office consumes an XLSX export with
  fixed column names: Date, Vehicle registration number, Vehicle brand,
  Employee name, Work performed, Notes, Customer billing code
  (`web/src/pages/Export.tsx`).
- **Rollout.** Pilot at the 2-worker site for about a week alongside the
  existing WhatsApp process, then switch the two larger sites.

## Capabilities and Constraints

**Confirmed capabilities** (all implemented; see `web/src/pages/`):

- Job submission with camera capture of plate and VIN; photos are downscaled
  client-side to ~1280px JPEG before upload.
- OCR autofill of plate and VIN via Cloudflare Workers AI (Moondream). OCR
  returns either the characters or a fixed failure reason from the enum
  `blurry | glare | dark | angle | obstructed | not_in_frame`, which the UI
  translates. Every OCR result stays editable — OCR is a shortcut, never a gate.
- Client-side validation: plate format, VIN 17-character format (no I, O, Q),
  VIN checksum as a *soft warning* (imported vehicles legitimately fail it),
  and a same-VIN-same-site-within-7-days duplicate flag.
- Brand guessed from the VIN's WMI, editable.
- Offline submission queue with automatic retry.
- 15-minute edit window: a worker may amend their own job's services and note
  for 15 minutes after submit, then the row locks (`jobs.locked_at`, enforced
  in RLS, not just the UI).
- Manager: per-site day view, plate/VIN/worker search, billing code and manager
  note entry, photo access, soft delete and restore, XLSX export by date range.
- Analytics for managers (own site) and admins (site picker), with date range,
  worker and service filters, and XLSX stats export.
- Worker self-service stats: own job counts by month.
- Service catalog: unique catalog number, English name, optional Russian name,
  active/inactive, manual sort order, soft delete (history keeps its references).
- User management: admin invites by email and edits role/site; manager
  activates/deactivates worker-role users at their own site only.
- Self-service: set password from an invite link, rename self, change password.

**Constraints that must survive any redesign:**

- Mobile-first for worker and manager; desktop-first for admin.
- English and Russian, already wired via `react-i18next`. Measured against the
  current locale files, Russian averages ~25% longer overall but short UI labels
  run 2–2.7× longer ("Save" → "Сохранить", "My Stats" → "Моя статистика").
  Layouts must never depend on English string lengths.
- Installable PWA; must feel like an app from the home screen. App-shell
  caching only — job data is never cached, so nobody is ever shown a stale
  record.
- Free-tier infrastructure end to end (Supabase, Cloudflare
  Workers/R2/Workers AI, GitHub Actions), target $0/month. No heavy asset
  payloads on mobile data. The XLSX library is already lazy-loaded because it
  is not worth shipping to workers.
- Accessibility here is operational, not decorative — see below.
- Invite-only registration. No signup screen, no marketing surface.
- Photos expire after 90 days by R2 lifecycle rule. Jobs are soft-deleted only,
  never hard-deleted; the same is true of services.

**Terminology** (the client's words — use exactly these): job, site, worker,
manager, plate, VIN, service, catalog number, billing code.

**Explicitly undecided:**

- The company's name. The GitHub repository and Cloudflare project are named
  `koch_cars_report` / `koch-cars-report`, which is suggestive but is not
  confirmation of a trading name. The in-app name is currently the generic
  "Vehicle Prep Tracker" (`web/src/locales/en.json`). Do not invent or infer a
  company name; wait for the client.
- Which of ~125 cars/day and ~250 submissions/day is the true New Job volume.
- Whether the 15-minute edit window is the right length (flagged in the README
  as a pilot question).

## Brand Commitments

A real company brand exists. **The logo and brand colors are PENDING — the
client will supply them later.** This is a hard constraint on how the redesign
is built, not a detail to be filled in at the end:

- The design must accept the real logo and palette as a **drop-in token swap**.
  Every brand-carrying value must resolve from a single token source. The
  current code does not meet this bar: `web/src/index.css` defines
  `--color-brand-*`, but `web/src/components/BarChart.tsx` hardcodes hex values
  (`#2563eb`, `#1d4ed8`, `#e1e0d9`, `#898781`, `#0b0b0b`), and the PWA
  `theme_color` / `background_color` are hardcoded in `web/vite.config.ts` and
  `web/index.html`. A brand swap today would silently miss the charts and the
  install splash.
- There must be a defined place for a logo — at minimum the sign-in screen, the
  app shell header, and the PWA icon — that currently renders the app name as
  text and can take a mark without a layout rewrite.
- Nothing in the interface may assume a specific hue. The current blue
  (`#2563eb`) is a placeholder and carries no client approval.
- Do not design or generate a logo, wordmark, or company name.

Voice: plain, operational, instructional. The existing copy is the reference
(`web/src/locales/en.json` / `ru.json`) — short imperatives, no marketing tone,
failure messages that say what to do next ("Couldn't read it (blurry) — enter
manually or retake the photo").

## Evidence on Hand

- A complete, working implementation: `web/src/pages/` (14 screens),
  `web/src/components/`, `supabase/migrations/` (data model + RLS),
  `worker/` (OCR + private photo storage), `README.md`, `worker/README.md`.
- Real bilingual copy for every screen in `web/src/locales/en.json` and
  `ru.json` — usable as-is for length and tone testing.
- Seed service catalog with real English/Russian service names
  (`supabase/migrations/0001_init.sql`).
- The original design prompt and its constraints: `DESIGN_PROMPT.md`.
- Existing design-sync tooling wired to a Claude Design project
  (`web/.design-sync/`, `web/ds-bundle/`), with six components registered as
  the shared set: StatTile, ServiceChips, BarChart, PhotoCapture, AdminTabs,
  StatusBanner. `web/.design-sync/NOTES.md` documents its constraints.

**Absent — must not be fabricated:** the company name, the logo, the brand
palette, any user research, usability testing, satisfaction scores, adoption
metrics, testimonials, pricing, or deadlines. No screen has been tested with a
real worker in a real yard.

## Product Principles

1. **Submission speed is the product.** If a change makes New Job slower or
   less certain, it is a regression regardless of how much better it looks.
   Nothing else in the app has the leverage to decide whether this succeeds.
2. **Effort follows volume.** One screen is used hundreds of times a day; most
   are used a handful of times a day by a handful of people. Design investment
   must be proportional, not evenly spread.
3. **The worker must always know where their car stands.** Submitted, queued
   offline, failed, still editable, or locked. Ambiguity here produces the two
   failure modes that destroy the data: a duplicate submission, or a car that
   was never logged at all.
4. **Assistance never becomes a gate.** OCR, checksum validation, duplicate
   detection, and brand guessing are all advisory. The worker can always
   override and get the car submitted.
5. **Capture once.** No screen may require re-entering something the system
   already knows, and no redesign may add a field the client did not ask for.

## Accessibility & Inclusion

Operational requirements, driven by the physical situation rather than by
compliance:

- **Touch targets ≥44px** for every interactive element a worker or manager
  uses on a phone. Justified by rushed, one-handed use next to a car.
- **High contrast, sunlight-legible.** The worker flow must remain readable on
  a phone at maximum brightness in direct sun, and equally in a dim covered
  garage. Small low-contrast grey type is not acceptable for anything a worker
  needs to read or act on.
- **Bilingual English/Russian**, switchable in-app, with Cyrillic strings
  running materially longer (short labels 2–2.7×). Truncated or overflowing
  Russian labels are a defect, not a cosmetic issue.
- **Non-color status encoding.** Success, warning, error, queued, duplicate,
  and locked states must be distinguishable without relying on hue alone —
  both for color-vision deficiency and because hue is exactly what washes out
  on a sun-hit phone screen.
- **Charts have a table fallback.** `BarChart` already exposes a table toggle;
  keep an equivalent non-visual path to the same numbers.
