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
| Volume | ~1,300 cars/month actual (2026), planned for ~3,000 | Trivially small. Never optimize for throughput here. |
| Photos | 2/car (plate + VIN), 60-day retention | ~6 GB rolling window. Drove the storage choice. |
| Video | optional ≤2 min walkaround/car, in-app 1080p @ 4 Mbps (≤~60 MB), 60-day retention | ~80–160 GB rolling window (~$1–3/mo at 1,300 cars, ~$5/mo at 3,000). Recorded in-app because only MediaRecorder lets us cap the bitrate (migration 0020). |
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
- **A job can have up to two co-workers** besides the submitter (`jobs.coworker_ids`,
  migration 0019), from any site. Pay is split evenly — the submitter takes the
  leftover cent — via the generated `submitter_share` / `coworker_share` columns,
  which split the job's summed pay (all its services, 0033).
  A shared job counts as one job for each person but one car for the site
  (`job_daily_totals.car_count`). Only the submitter edits; co-workers only see it.
  The submitter picks the job's site (default: their own), and payroll is per
  person across all sites.
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

**The Worker exists only for the things the browser cannot do safely:**

| Endpoint | Why it can't be client-side |
|---|---|
| `POST /ocr` | Workers AI binding is server-only. |
| `POST /upload` | R2 write credentials must not reach the client. |
| `POST /video/start`, `/video/part`, `/video/complete`, `/video/abort` | Resumable condition-video upload (R2 multipart through the same binding, 8 MiB pieces). Same reason as `/upload`; each call re-checks `can_write_photo`. |
| `GET /photo/:jobId/:kind` | Bucket is private; the Worker checks the caller may see the job, then streams the object. |
| `POST /invite` | The only place the Supabase **service-role key** is used — gated on verifying the caller is an active admin first. |

All of them verify the caller's Supabase JWT. `/upload`, `/video/*` and `/photo` go further and
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
| `0002_catalog_numbers_and_stats.sql` | `services.catalog_number` (unique until 0017), monthly/service stat views |
| `0003_tighten_worker_job_select.sql` | **Security fix** (see §6), `find_recent_duplicate()` |
| `0004_user_mgmt_services_softdelete_stats.sql` | Service soft-delete, `update_my_name()`, `set_user_active()`, `job_daily_stats` |
| `0033_multi_service_jobs.sql` | `job_services` + `job_service_client_prices` (per-line price snapshots, backfilled), `create_job()` / `set_job_services()`, `job_service_lines`, `job_daily_totals`; `job_daily_stats` per service; drops `job_service_stats` |
| `0034_manager_full_edit.sql` | `photos.removed_at` tombstone, `photos_update` (manager/admin), `can_view_photo()`, duplicate flag re-run on plate/VIN/date edits, `audit_log` written by triggers (`audit_diff()`), `audit_log_insert` dropped |

### Infrastructure
- **Cloudflare Workers static assets** hosts the frontend (project
  `koch-cars-report`), `not_found_handling = "single-page-application"`.
- **Cloudflare Worker** `car-prep-tracker-worker` hosts the API.
- **R2** bucket `car-prep-photos`, with a lifecycle rule expiring objects after
  60 days — retention policy as configuration, zero code.
- **Supabase** free tier: Postgres, Auth, RLS.
- **GitHub Actions**: `ci.yml` (test + build both packages), `deploy-web.yml`,
  `deploy-worker.yml`, `backup.yml` (nightly `pg_dump` → R2, because the
  Supabase free tier has no PITR).

---

## 4. Data model

```
sites(id, name, customer_report_config)
users(id, auth_id, name, role[worker|manager|admin], site_id, active)
services(id, catalog_number (not unique, 0017), name_en, name_ru, worker_price,
         active, sort_order, deleted_at)
jobs(id, site_id, worker_id, created_at, plate, vin, brand,
     service_id,            -- DEPRECATED (0033): first service at creation
     worker_price,          -- sum of the job's job_services lines, by trigger
     worker_note, manager_note, billing_code,
     locked_at,             -- created_at + 15 min
     duplicate_of_job_id,   -- soft flag, nullable
     deleted_at)
job_services(job_id, service_id, worker_price, created_at)   -- PK (job, service), >= 1 per job
job_service_client_prices(job_id, service_id, unit_price, total_price)  -- admin/Carasso
job_client_prices(job_id, unit_price, total_price)  -- per-job sum, NULL if any line unpriced
photos(id, job_id, kind[plate|vin|extra_1..3|video], r2_key, expires_at,
       removed_at)            -- tombstone (0034): slot removed by a manager/admin
audit_log(id, job_id, user_id, action, changes_jsonb, at)   -- trigger-written (0034)
```

**Several services per job (0033).** 0005 collapsed jobs to one service; the
yard then logged cars that got a wash *and* a polish, so 0033 brought
`job_services` back with the snapshot moved onto each line. Each service once
per job, at least one (trigger). A line's `worker_price` is a *snapshot*, not a
live lookup — re-pricing a service must not rewrite what last month's exports
said — stamped from the catalog by a trigger for every signed-in caller, never
taken from the client, because RLS is row-level and cannot stop a worker from
PATCHing their own pay during the 15-minute edit window. Only an admin may
change a line's pay afterwards. A service added later takes the price of the
day; lines already on the job keep theirs. `jobs.worker_price` stays as the
sum (trigger), so the 0019 share columns, payroll and stats keep their meaning.
Client prices follow the same pattern per line; `job_client_prices` is their
per-job sum, so `jobs_carasso` reads it unchanged.

Writes go through two security-invoker RPCs: `create_job(...)` (the job and all
its services in one call, so an offline retry never lands half a car) and
`set_job_services(job, ids)` (insert first, then delete; refused with 42501
once the job is not editable). Per-service figures come from
`job_service_lines`, which splits each person's share across lines (last line
takes the remainder, so lines add up to the share exactly). `job_daily_stats`
is now per service — summed without a service filter it counts a two-service
job twice — and `job_daily_totals` is per job for job/car counts and pay.

`jobs.service_id` is **deprecated**, kept only for builds still in the field:
an old-build insert seeds the first line, and an old-build change of it
*replaces the job's services with that one service*. New code must not write
it. Drop it in 0035 once no old build can be running.

**Deploy order: 0033 -> web. Rollback: web only; 0033 is roll-forward only.**
0033 alone keeps the previous web build working. Until the new web is live, two
old-build admin actions stop sticking: a per-job pay override on
`jobs.worker_price` (now always the line sum) and a direct `job_client_prices`
edit (recomputed on the next line change). Never drop `job_services` while any
job has more than one service — that is the 0005 data loss again. Run
`supabase/verify_0033.sql` (read-only) after applying.

**Manager/admin full edit and audit (0034).** Managers (own site) and admins
edit every job field and every media slot at any age; workers keep the
15-minute window and column guard unchanged. Two decisions:

- *Remove is a tombstone*, `photos.removed_at`, not a row delete: the R2
  object is left to the 60-day lifecycle (no hard deletes from the app), the
  row keeps the slot's unique `(job_id, kind)` so re-adding is an update, and
  history keeps what was there. Because the object outlives the removal, the
  Worker's GET `/photo` asks `can_view_photo(job, kind)` (= `can_view_job` and
  the slot not tombstoned) instead of `can_view_job`. Readers of `photos` must
  filter `removed_at is null`. Replace is an upsert without `ignoreDuplicates`
  (an update of the live row); `photos_guard_update` pins id/job/kind/R2 key and
  restarts `expires_at` on a live row (the overwrite restarts the lifecycle).
  Workers have no update policy on `photos`.
- *Audit is written by the database*, not the client. The old
  `recordAudit` insert was best-effort (any failure silently dropped the row),
  forgeable, and impossible after a manager moved a job off their site. Now
  AFTER security-definer triggers on `jobs`, `job_billing`, `job_services`,
  `job_service_client_prices` and `photos` log every manager/admin change as
  `changes = {field: {from, to}}` (actions `update`, `soft_delete`,
  `restore`, `media_add`, `media_replace`, `media_remove`,
  `client_price_update`), inside the same transaction as the row change: if
  the audit write fails, that save fails. (A media replace writes R2 before
  the row, so a failed row write can leave new bytes live without an audit
  row; see SECURITY-NOTES §6.) Worker edits and the trusted context are not
  audited. `audit_log_insert` is dropped. `audit_log_select` hides
  `client_price_update` rows (and legacy rows carrying `unit_price` /
  `total_price`) from managers: client prices stay admin-only.

A manager/admin cannot move a job date more than 5 minutes into the future
(`jobs_guard_date`): it would hold the worker's 7-day video window open.

The duplicate flag (0029) also re-runs when a manager/admin changes plate, VIN
or the date, matching only *earlier* jobs. Soft, never blocks.

**Deploy order: 0034 -> Worker -> web. Rollback: web -> Worker -> migration.**
The old web keeps working on 0034 (its `recordAudit` inserts fail silently
while the triggers log). A Worker before 0034 403s every photo view. Run
`supabase/verify_0034.sql` (read-only) after applying.

Deletion is always soft (`deleted_at`). Hard `DELETE` on `services` is granted
to **nobody** — historical jobs must keep resolving their service references.

### Roles
- **worker** — creates jobs at their own site; edits/deletes their own job
  within 15 min; sees only their own rows. Cannot see billing codes.
- **manager** — everything within their own site: view/search/edit jobs (every
  field, including plate, VIN, brand, worker note and date, at any age — 0034),
  add/replace/remove media, read the job's edit history, fill billing codes, view photos, export, analytics, manage services, activate and
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

### Offline queue and the deferred condition video

Every submission that fails is kept in IndexedDB (`web/src/lib/offlineQueue.ts`,
store `pending-jobs`) and retried on `online`, on app start and when the app
returns to the foreground (`visibilitychange`). Submit waits for the job and its
photos only. The condition video (up to 75MB) follows as its own queue entry
(`stage: 'video'`, linked by `jobId`) so the worker can start the next car:

- A job entry that lands with a video is rewritten in place into its video
  entry (same key, photo blobs dropped), so the clip never leaves the disk until
  it is uploaded or the worker discards it. Entries queued before this existed
  (video inside the job payload) flush through the same path.
- Job entries always go first; a video failure never blocks a job.
- The `photos` row for the video is written only after the upload succeeds, and
  `submitVideo` skips the upload when the row already exists (safe rerun).
- A screen wake lock is held while a video uploads. A failure after the page
  went hidden at any point during the attempt (screen locked) does not count
  toward the 5-attempt budget: iOS delivers the error after resume, when the
  page is visible again, so the queue remembers the hide instead of checking
  visibility at failure time. A failure after the signed-in user changed is not
  counted either. Past
  5 attempts / 24 hours the worker sees "Video not uploaded" in My Jobs with
  Retry (fresh budget) and Discard (with confirmation).
- The video is sent in 8 MiB pieces (`VIDEO_PART_BYTES`, mirrored in
  `web/src/lib/video.ts` and `worker/src/upload.ts`), sequentially:
  `/video/start` carries piece 1 (the Worker sniffs the type from it and opens an
  R2 multipart upload at `video/{jobId}`), `/video/part` the rest,
  `/video/complete` joins them. The phone keeps `{uploadId, partSize, etags}` in
  localStorage under `video-upload:<queuedId>` (not on the IndexedDB entry,
  which would rewrite the whole clip per piece), saved after every piece, so an
  interrupted upload, even after the app was closed, resumes from the last
  finished piece. A lost response just re-sends the same piece number. Each
  piece gets up to 3 tries in a run (2 s / 6 s backoff) for transient errors and
  a 180 s timeout (below ~0.37 Mbps up no piece can land: tune it there).
- If R2 no longer has the upload (expired, or aborted), the Worker answers 410
  and the video restarts from zero, once per run; a second 410 flags it. Saved
  state from another piece size, with gaps, or with more pieces than the clip
  is cleared (fresh start). A
  failed state write only loses resume. The state is cleared when the clip
  lands, when the entry has nothing left to send, and on Discard (which also
  asks the Worker to abort the R2 upload, best effort).
- A run that landed at least one new piece does not count as a failed attempt,
  so a slow link that keeps progressing never burns the 5 attempts; the 24-hour
  bound still applies. After a restart in a run (410, or cleared stale state)
  no piece counts as progress for that run, so a failure still counts.
- My Jobs and the header show the percentage (pieces landed / size).
- A 404 from any `/video/*` call means the Worker predates `/video/*` (or was
  rolled back after the phone saved state; web and Worker deploy in parallel
  on push to main): the phone clears the saved state and falls back to the
  single-request `/upload`, with a timeout of 180 s per piece the clip would
  have had. Deploying the Worker first is recommended; the fallback makes
  either order safe. Remove it once the Worker is everywhere.
- `/video/complete` also has the 180 s timeout (it is idempotent on the
  Worker), so a request a locked screen left hanging cannot stall the queue.
- Worker side, details in SECURITY-NOTES §4: `/video/start` has its own
  `VIDEO_START_LIMITER` (10/min per user, on top of `UPLOAD_LIMITER`) since
  every start parks an R2 multipart upload (up to 80 MiB for up to 7 days if
  never completed); `jobId` must be a canonical lowercase uuid (400 otherwise);
  complete runs its head() idempotency check on any R2 error and only maps
  known "gone" codes to 410 (anything else is a 500 the phone retries); abort
  always answers 200. Which R2 codes appear when is an assumption until the
  live check in SECURITY-NOTES §4.
- No real background upload: iOS cannot do it for a web app. Keep the app open.

This needed migration **0031** (`can_write_photo`): `can_write_job` only lets a
worker add photos within 15 minutes or while the job has none, which assumed all
slots land in one batch. A video arriving later would be refused forever. See
SECURITY-NOTES.md §4 for the window. Only the video gets a longer window: a job
with no photo rows is NOT video-writable forever (0014's "no photos yet" branch
covers photos only); its video lands through the 7-day branch like any other.
**Deploy order: migration 0031 -> Worker -> web, mandatory**: the Worker calls
`can_write_photo`, which does not exist before 0031, so it would 403 every
upload and the queue would flag those entries `needsAttention`. **Rollback:
web -> Worker -> migration**; keep `can_write_job`, and never drop
`can_write_photo` while the new Worker is live. Keep the mixed-version windows
short: an old-web queued job past its lock with zero photo rows plus a video,
soft-deleted or older than 7 days, fails as a whole until the new web is live
(Retry then sends the photos without the video).

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
- Manager/admin job and media changes are audit-logged by database triggers (who / what / when, 0034); worker edits are not.

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
│   ├── src/videoUpload.ts    # resumable video (R2 multipart), RLS-checked per call
│   ├── src/photo.ts          # R2 read, RLS-checked
│   ├── src/invite.ts         # the ONLY service-role usage
│   └── wrangler.toml
├── supabase/migrations/      # 0001–0004, applied in order
└── .github/workflows/        # ci, deploy-web, deploy-worker, backup
```

### Routes

`/login` · `/welcome` (set password from invite) · `/profile`
**worker:** `/new` `/mine` `/stats` `/lookup` (plate/VIN lookup via `lookup_vehicle`, 0018 — no submitter shown) — **manager+admin:** `/dashboard`
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
