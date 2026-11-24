# Architecture overview

Orientation for an agent or person picking this codebase up cold: what the system is, how it is built, and where things live. *Why* each major choice was made lives in [`docs/decisions/`](../decisions/README.md). Split out of the former `CONTEXT.md` (2026-11-24); section numbers below are the old ones, so old "CONTEXT §N" references still map.

Index: [data model](data-model.md) · [operations](operations.md) · [decisions](../decisions/README.md) · [security](../security/SECURITY-NOTES.md) · [product](../../PRODUCT.md) · [design](../../DESIGN.md), [brief](../design/DESIGN-BRIEF.md)

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
| Photos | plate + VIN + up to 5 optional extras per car, ≤1920px JPEG q0.82 (~300–500 KB each), 60-day retention | Small next to video: estimated ≤~20 GB rolling even if every car had all 7 at 500 KB at 3,000 cars/month; typically far less. Drove the storage choice. |
| Video | optional ≤2.5 min walkaround/car, in-app 1080p @ 4 Mbps (≤~75 MB, cap 90 MB), 60-day retention | ~80–160 GB rolling window (~$1–3/mo at 1,300 cars, ~$5/mo at 3,000). Recorded in-app because only MediaRecorder lets us cap the bitrate (migration 0020). |
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
- **A labelled job belongs to its submitter but pays nobody personally**
  (0040). When a manager/admin types a name instead of picking a worker,
  `worker_id` is the submitter (so every RLS path keeps working) and
  `jobs.worker_label` holds the name. The stats views put that job's ord-1
  (submitter) row under `worker_id` NULL with the label, so it counts in site
  totals, car counts and billing, but not in the submitter's pay, My Stats or
  payroll share. Co-workers on it are paid as usual and see the label
  (`jobs_worker_view.worker_label`). The label is set only at insert, only when
  the submitter is the owner; it can be cleared but never set or changed later,
  and reassigning the job (`worker_id` change) clears it. Picker site rules:
  a manager's labelled or on-behalf job is at their own site; an admin's at
  any site.
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
| `0003_tighten_worker_job_select.sql` | **Security fix** (see SECURITY-NOTES §12), `find_recent_duplicate()` |
| `0004_user_mgmt_services_softdelete_stats.sql` | Service soft-delete, `update_my_name()`, `set_user_active()`, `job_daily_stats` |
| `0033_multi_service_jobs.sql` | `job_services` + `job_service_client_prices` (per-line price snapshots, backfilled), `create_job()` / `set_job_services()`, `job_service_lines`, `job_daily_totals`; `job_daily_stats` per service; drops `job_service_stats` |
| `0034_manager_full_edit.sql` | `photos.removed_at` tombstone, `photos_update` (manager/admin), `can_view_photo()`, duplicate flag re-run on plate/VIN/date edits, `audit_log` written by triggers (`audit_diff()`), `audit_log_insert` dropped |
| `0035_worker_media_edit.sql` | `photos_update` worker branch (own job, 15-minute window, not deleted; never removes plate/VIN), `photos_insert` refuses removed rows, `can_write_photo` worker branches all need a live job |
| `0036_vin_required_plate_optional.sql` | `jobs.vin` NOT NULL (refuses to run while any job, soft-deleted included, has a NULL or blank VIN), `jobs_plate_or_vin_chk` dropped, `jobs.plate` stays nullable |
| `0037_partial_vehicle_lookup.sql` | `pg_trgm` (schema `extensions`), trigram GIN indexes on `jobs.vin` / `jobs.plate` (live jobs), `lookup_vehicle()` matches "contains" from 4 normalised characters |
| `0038_hide_client_prices.sql` | `app_settings` key `hide_client_prices` (default false), admin-only `set_hide_client_prices()`, both Carasso price policies and `jobs_carasso` withhold client prices while it is on |
| `0039_extra_photos_5.sql` | `photos_kind_check` widened to `extra_1..extra_5` (plate, vin, video unchanged). Apply before the web/Worker that send `extra_4`/`extra_5`; run `supabase/verify_0039.sql` |
| `0040_staff_submit_for_worker.sql` | Managers/admins submit jobs: `jobs.worker_label` (1..60 chars, no control/zero-width/bidi chars), `jobs_insert` widened for on-behalf submits, `jobs_guard_worker_label` trigger, 10-arg `create_job(..., p_worker_label)`, stats views put a labelled job's submitter row under `worker_id` NULL, `worker_label` on `jobs_manager` / `jobs_worker_view` / daily stats, label in `jobs_carasso.crew`, `create_on_behalf` audit row, `jobs_audit` logs the label, `list_staff` regression fix. Run `supabase/verify_0040.sql`; behaviour in `supabase/scenarios_0040.sql` |
| `0042_site_vehicle_id_rules.sql` | Per-site rules: `sites.vin_rule` (default `required`) and `sites.plate_rule` (default `optional`), each `required`/`optional`; `jobs.vin` nullable again; `jobs_plate_or_vin_chk` restored; `jobs_insert` = 0041 AND the site's rules (blank counts as missing) AND a plate or a VIN. Run `supabase/verify_0042.sql`; behaviour in `supabase/scenarios_0042.sql` |

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
**worker:** `/new` `/mine` `/stats` `/lookup` (partial plate/VIN lookup, 4+ characters, via `lookup_vehicle`, 0018/0037 — no submitter shown) — **manager+admin:** `/dashboard`
`/jobs/:id` `/export` `/analytics` `/services` — **manager:** `/team` —
**admin:** `/admin/users` `/admin/sites`
