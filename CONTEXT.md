# Project context

Orientation document for an LLM picking this codebase up cold. It covers what
the system is for, how it is built, and — more usefully — *why* each choice was
made, including the ones that look odd until you know the constraint behind
them.

Companion docs: `README.md` (setup/deploy runbook), `PRODUCT.md` (product
spec), `DESIGN-BRIEF.md` (UI/UX brief).

---

## 1. What this system is

A job-tracking app for a car importer/seller that preps vehicles before sale.
Three sites detail/wash cars; each finished car must be recorded so the office
can bill the importer.

**The workflow it replaces:** a worker sent a WhatsApp message with a photo of
the licence plate, the VIN, and a free-text description. A manager re-typed all
of it into Excel by hand. Double entry, transcription errors in 17-character
VINs, photos buried in chat history, no per-site separation, no validation.

**The workflow it creates:** the worker photographs the plate and the VIN, OCR
autofills both fields, they tap the services performed, submit. The record is
structured at the source. Managers enrich it (billing code, notes) and export
Excel.

### Scale and constraints — these drive everything

| Constraint | Value | Consequence |
|---|---|---|
| Sites | 3 (6–8, 10, and 2 workers) | Multi-tenant-ish, but tiny. Site scoping matters; sharding does not. |
| Volume | ~125 cars/day, ~3,000/month | Trivially small. Never optimize for throughput here. |
| Photos | 2/car (plate + VIN), 90-day retention | ~6 GB rolling window. Drove the storage choice. |
| Budget | **$0/month** | The single hardest constraint. Every component must fit a free tier. |
| Maintainer | One technical owner | No component may require babysitting, patching, or on-call. |
| Devices | Modern phones, decent connectivity | Mobile-first PWA is enough; no native app. |
| Language | English now, Russian later | i18n built in from day one, not retrofitted. |
| Notifications | Explicitly **not wanted** | Managers check the app. Don't add push. |

### Domain rules that are not obvious

- **Billing codes arrive later.** The importer sends a per-car code days after
  the work. It is a manual manager field. There is nothing to generate or
  validate — don't build a generator.
- **Repeat vehicles are legitimate.** The same VIN can be prepped twice in a
  week. Duplicates are **flagged for managers, never blocked**.
- **Workers get a 15-minute edit window** after submitting, then the row locks.
  Managers can still edit.
- **There is no upstream vehicle list.** Cars just show up. Validation is
  format-only: VIN length/charset is hard, the ISO 3779 check digit is a *soft*
  warning (non-US VINs legitimately fail it), plate format is a configurable
  regex.
- **Catalog numbers** on services are an accounting key for the exported
  spreadsheet. Managers and workers do not need to see them in the UI — they are
  hidden from dropdowns and charts, shown on the Services editor where they are
  authored, and given their own column in exports.

---

## 2. Architecture

Static PWA + managed Postgres/Auth + one small edge Worker + object storage.
Nothing to patch, nothing that pages you at night.

```
┌──────────────┐        JWT         ┌──────────────────┐
│  React PWA   │───────────────────▶│ Supabase         │
│  (Cloudflare │  direct queries    │  Postgres + Auth │
│   Workers    │  gated by RLS      │  RLS = authz     │
│   assets)    │◀───────────────────└──────────────────┘
└──────┬───────┘                             ▲
       │ JWT                                 │ caller's JWT
       ▼                                     │ (RLS re-check)
┌──────────────────────────────────┐         │
│ Cloudflare Worker (Hono)         │─────────┘
│  /ocr  /upload  /photo  /invite  │
└───┬───────────────┬──────────────┘
    │               │
    ▼               ▼
┌─────────┐   ┌─────────────────┐
│ R2      │   │ Workers AI      │
│ photos  │   │ Moondream OCR   │
│ 90d TTL │   └─────────────────┘
└─────────┘
```

**The load-bearing idea: the database is the authorization layer.** Row Level
Security policies in Postgres decide what every role can see and do. The
frontend talks to Supabase directly; there is no REST API of our own to
maintain, and no application-layer permission checks to keep in sync with the
database. A missing UI guard is a cosmetic bug, not a security hole.

**The Worker exists only for the four things the browser cannot do safely:**

| Endpoint | Why it can't be client-side |
|---|---|
| `POST /ocr` | Workers AI binding is server-only. |
| `POST /upload` | R2 write credentials must not reach the client. |
| `GET /photo/:jobId/:kind` | Bucket is private; the Worker checks the caller may see the job, then streams the object. |
| `POST /invite` | The only place the Supabase **service-role key** is used — gated on verifying the caller is an active admin first. |

All four verify the caller's Supabase JWT. `/upload` and `/photo` go further and
**forward the caller's own JWT to Supabase**, so R2 access inherits the same RLS
policies as everything else rather than re-implementing them.

---

## 3. Tech stack

### Frontend — `web/`
- React 19 + TypeScript + **Vite 8** + React Router 7
- **Tailwind CSS v4** — ⚠️ no `tailwind.config.js`. Design tokens live in an
  `@theme` block in `web/src/index.css`. Unknown utilities compile to *nothing,
  silently* — if a class seems to do nothing, check the token exists.
- `react-i18next`, locales in `web/src/locales/{en,ru}.json`. Russian uses
  `_one/_few/_many/_other` plural forms.
- `lucide-react` behind `web/src/components/Icon.tsx`, which maps app-level
  names (`'camera'`, `'sync'`) to lucide components. **Pages never import lucide
  directly** — swapping the icon vendor is a one-file change.
- `xlsx` (SheetJS) installed **from the SheetJS CDN tarball**, pinned to
  0.20.3. The npm-registry copy is stuck at 0.18.5 with an unpatched
  high-severity vulnerability. Do not "fix" this back to the registry.
- PWA via `vite-plugin-pwa`; safe-area insets for notched phones.
- `vitest` for unit tests.

### Backend — `worker/`
- Cloudflare Worker, **Hono** router.
- JWT verification via `hono/jwk` against Supabase's JWKS
  (`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`), `alg: ['ES256']`.
- Bindings: `AI` (Workers AI), `PHOTOS` (R2).

### Data — `supabase/migrations/`
Plain SQL, applied in order via the Supabase SQL editor.

| Migration | Contents |
|---|---|
| `0001_init.sql` | Tables, RLS policies, `current_app_user()`, `jobs_worker_view` |
| `0002_catalog_numbers_and_stats.sql` | `services.catalog_number` (unique), monthly/service stat views |
| `0003_tighten_worker_job_select.sql` | **Security fix** (see §6), `find_recent_duplicate()` |
| `0004_user_mgmt_services_softdelete_stats.sql` | Service soft-delete, `update_my_name()`, `set_user_active()`, `job_daily_stats` |

### Infrastructure
- **Cloudflare Workers static assets** hosts the frontend (project
  `koch-cars-report`), `not_found_handling = "single-page-application"`.
- **Cloudflare Worker** `car-prep-tracker-worker` hosts the API.
- **R2** bucket `car-prep-photos`, with a lifecycle rule expiring objects after
  90 days — retention policy as configuration, zero code.
- **Supabase** free tier: Postgres, Auth, RLS.
- **GitHub Actions**: `ci.yml` (test + build both packages), `deploy-web.yml`,
  `deploy-worker.yml`, `backup.yml` (nightly `pg_dump` → R2, because the
  Supabase free tier has no PITR).

---

## 4. Data model

```
sites(id, name, customer_report_config)
users(id, auth_id, name, role[worker|manager|admin], site_id, active)
services(id, catalog_number UNIQUE, name_en, name_ru, worker_price,
         active, sort_order, deleted_at)
jobs(id, site_id, worker_id, created_at, plate, vin, brand,
     service_id,            -- one service per job (0005)
     worker_price,          -- catalog price snapshotted by trigger
     worker_note, manager_note, billing_code,
     locked_at,             -- created_at + 15 min
     duplicate_of_job_id,   -- soft flag, nullable
     deleted_at)
photos(id, job_id, kind[plate|vin|extra_1..3], r2_key, expires_at)
audit_log(id, job_id, user_id, action, changes_jsonb, at)
```

**One service per job.** Migration 0005 dropped the `job_services` join table.
`jobs.worker_price` is a *snapshot*, not a live lookup — re-pricing a service
must not rewrite what last month's exports said — and it is written by a
database trigger, never by the client, because RLS is row-level and cannot
stop a worker from PATCHing their own pay during the 15-minute edit window.

Deletion is always soft (`deleted_at`). Hard `DELETE` on `services` is granted
to **nobody** — historical jobs must keep resolving their service references.

### Roles
- **worker** — creates jobs at their own site; edits/deletes their own job
  within 15 min; sees only their own rows. Cannot see billing codes.
- **manager** — everything within their own site: view/search/edit jobs, fill
  billing codes, view photos, export, analytics, manage services, activate and
  deactivate *worker-role* users at their site.
- **admin** — all sites, plus user/site management and invitations.

All of it enforced by RLS policies and `security definer` RPCs, not by the UI.

---

## 5. Key decisions and their rationale

### Rejected alternatives (do not re-propose these)

| Rejected | Why |
|---|---|
| Parsing WhatsApp | Official Business API is paid and cannot read an existing group. Unofficial bridges violate ToS and break silently — the worst possible property for an unattended system. |
| Google Sheets as the database | No row-level security for 20 users, no photo handling, write races, API quotas. Fine as an export *target*; wrong as a system of record. |
| Airtable | Free tier caps at 1,000 records/base — exceeded in ~10 days. |
| Self-hosted NocoDB / Pocketbase | Adds a VPS to babysit, and the worker UX still needs a custom form. |
| Native app | App-store accounts, review delays, two codebases. No benefit over a PWA here. |
| Firebase | NoSQL makes the reporting and Excel export harder, which is the whole point. |
| Supabase Storage for photos | 1 GB free < the ~6 GB rolling photo window. R2 gives 10 GB + free egress + native lifecycle expiry. |

### OCR: Gemini → Cloudflare Workers AI

Originally Gemini 2.5 Flash. It broke **twice in one session** in production:
first `gemini-2.5-flash` became unavailable to new users (404), then the
thinking-budget parameter moved between API versions (`thinkingBudget` is
2.5-series; 3.x uses `thinkingLevel`). Migrated to Workers AI
(`@cf/moondream/moondream3.1-9B-A2B`, task=query, 10,000 neurons/day free).

Two wins beyond stability: it removed the last external API key from the
system, and it put OCR on the same platform as the rest of the infrastructure.

**OCR is an accelerator, never a dependency.** Every failure path — network,
quota, unreadable photo — resolves to a null result and the worker types the
value manually. The client deliberately swallows `/ocr` errors. A consequence
worth knowing: *when OCR silently stops working, nothing visibly breaks*, which
is exactly how the Gemini 404 went unnoticed. Check `wrangler tail` when
autofill "just stops".

`worker/src/ocr.ts` keeps its answer parsing in a **pure, unit-tested**
`parseOcrAnswer(raw, kind)` so the fiddly text-recovery logic is testable
without calling a model.

### Auth: asymmetric JWTs

The Supabase project uses **JWT Signing Keys (ES256)**, not the legacy HS256
shared secret. The Worker therefore verifies against the public JWKS endpoint
and stores **no** `SUPABASE_JWT_SECRET`. If a project only has a "Legacy JWT
Secret" and no signing key, this Worker's auth will not validate — visiting the
dashboard's JWT Keys page once provisions one; no code change needed.

### Registration is invite-only

There is no public sign-up. An admin invites by email via `POST /invite`, which
verifies the caller is an active admin *using their own JWT* before touching the
service-role key, then sends the Supabase auth invitation and pre-creates the
profile row. The invitee lands on `/welcome` and chooses a password.

### Design language

The brand is monochrome: `#1E1E1E` text, `#FFFFFF` background, `#919396` grey.
(Note: the logo SVG's grey is `#919396`; a transposed `#919936` — olive green —
has been mistyped before. The grey is correct.)

Two rounds of feedback shaped the current UI:

1. **"The design looks old fashioned, I want modern SaaS."** Two causes were
   found: the entire UI palette had been derived literally from the three brand
   colors, producing a dead flat grey; and the redesign had only been
   *half-applied* — 8 screens still used the old classes, so part of what was
   being judged was the old design. Tokens were retuned (real ink scale, clean
   status colors, tighter tracking, softer shadows) and the redesign completed.
2. Brand grey is for brand moments, **not UI borders**.

**Contrast is computed, never eyeballed.** White on brand grey is 3.08:1 — it
fails WCAG AA for body text and is only safe at ≥24px. Dark on grey is 5.41:1
and passes. `--color-ink-500` (5.01:1) is the lightest token allowed for text;
`ink-400` is never text.

`web/src/components/ui.tsx` is the shared control vocabulary — `Page`, `Card`,
`Button`, `Badge`, `Field`, `Select`, `ConfirmAction`, `EmptyState`, and so on.
Use it rather than restyling per screen. Notable rules baked in:
- Every interactive element clears a 44px tap target. The primary user is
  holding a phone next to a car.
- `Badge` is read-only and never wired to an action. The old UI used one element
  as both the "Active" label and the deactivate control — that is how a manager
  locks a worker out mid-shift by tapping what looks like a label.
- `ConfirmAction` is the single destructive pattern; nothing destructive fires
  on first tap.
- `Select` disables the native arrow and draws its own chevron. Sharing
  `fieldClass` between inputs and selects leaves the OS arrow misplaced and lets
  long option text slide under it.

### Site scoping default

Every role opens site-aware screens on **their own site**. Admins previously
landed on whichever site sorted first alphabetically. `web/src/lib/useSiteScope.ts`
centralizes this: admins may switch sites, managers and workers are pinned (RLS
would reject anything else anyway, so no picker is offered).

---

## 6. Security notes

Two real findings were found and fixed in review; both are worth remembering
because the same mistake is easy to re-introduce.

1. **Workers could read every job at their site**, including `billing_code`.
   Fixed in `0003` by restricting the worker role to their own rows, plus a
   `find_recent_duplicate(uuid, text)` `security definer` function that returns
   *only a job id* — enough to flag a duplicate, not enough to read someone
   else's record.
2. **Photo content-type was echoed from the client.** An attacker-chosen type
   (`text/html`) would make `GET /photo` serve an attacker page on the Worker's
   own origin. It is now pinned to `image/jpeg` on write, since the app only
   ever uploads JPEG.

Other standing rules:
- The service-role key appears in exactly one file, `worker/src/invite.ts`, and
  is never reachable without an admin JWT.
- The R2 bucket is private; photos are only served through the Worker after an
  RLS-backed permission check.
- `ALLOWED_ORIGINS` should be pinned to the app origin, not `*`.
- Job mutations are audit-logged (who / what / when).

---

## 7. Repository layout

```
car-prep-tracker/
├── web/                      # React PWA
│   ├── src/pages/            # one file per screen
│   │   └── admin/            # admin-only screens
│   ├── src/components/       # ui.tsx (vocabulary), DataTable.tsx, Icon.tsx, …
│   ├── src/lib/              # supabase client, types, vin, image, offlineQueue,
│   │                         #   workerApi, useSiteScope, i18n
│   ├── src/locales/          # en.json, ru.json
│   ├── src/index.css         # ⚠️ Tailwind v4 @theme — the design token source
│   └── wrangler.toml         # frontend deploy (static assets)
├── worker/
│   ├── src/index.ts          # Hono app, CORS, JWKS auth
│   ├── src/ocr.ts            # Workers AI + pure parseOcrAnswer()
│   ├── src/upload.ts         # R2 write, RLS-checked
│   ├── src/photo.ts          # R2 read, RLS-checked
│   ├── src/invite.ts         # the ONLY service-role usage
│   └── wrangler.toml
├── supabase/migrations/      # 0001–0004, applied in order
└── .github/workflows/        # ci, deploy-web, deploy-worker, backup
```

### Routes

`/login` · `/welcome` (set password from invite) · `/profile`
**worker:** `/new` `/mine` `/stats` — **manager+admin:** `/dashboard`
`/jobs/:id` `/export` `/analytics` `/services` — **manager:** `/team` —
**admin:** `/admin/users` `/admin/sites`

---

## 8. Operational gotchas

- **The frontend Cloudflare project was originally a one-time upload, not
  Git-connected**, so pushing to `main` did not deploy it. That is what
  `web/wrangler.toml` + `deploy-web.yml` fix. If the production site "remains as
  it was" after a push, check the workflow ran.
- **Build-time env vars go under Settings → Build → Build variables and
  secrets**, not the runtime "Variables & Secrets" section. A static-assets
  Workers project rejects runtime variables outright ("Variables cannot be added
  to a Worker that only has static assets").
- `VITE_*` variables are baked in at build time: `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_WORKER_URL`.
- R2 requires a one-time enablement in the Cloudflare dashboard (error 10042
  until then).
- Migrations are applied by hand in the Supabase SQL editor. There is no
  migration runner — check what is actually applied before assuming.

---

## 9. Known open threads

- Moondream OCR has returned empty answers in production; `workerApi.ts`
  currently does a two-step detect → crop → query flow (workers photograph the
  whole car, so the plate is a small patch of the frame). Temporary debug
  logging may still be present in `ocr.ts`.
- Migration `0004` has not been confirmed as applied to the live database.
- The redesign has not been visually verified by the assistant — browser tooling
  against localhost is blocked in this environment. Visual confirmation is the
  user's.
