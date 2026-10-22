# Spec: Carasso role, client pricing, Hebrew exports, duplicate warning

Status: agreed design, 2026-10-22. Not implemented.
Context: the DB and R2 bucket are wiped before the pilot, so no data migration/backfill is needed.

---

## 1. Client prices on services

- Two new fields on `services`: **client unit price** (מחיר לחלק) and **client total price** (מחיר כולל).
- Both are entered manually. Never calculated. (Catalog numbers like `7777X5` encode quantity, but the system does not parse them.)
- **Required** for active services. Inactive/draft services may leave them empty.
- Only **admins** can edit them in the catalog.
- **Snapshot**: both are copied onto the job at creation (same pattern as `worker_price`, trigger `jobs_apply_worker_price`). Changing the catalog never changes existing jobs.
- **Per-job override**: admin only, from Job Detail.
- No VAT handling. Headers show `(₪)`, cells are plain numbers.
- Client prices do **not** affect worker pay.

## 2. Visibility matrix (enforced in DB/RLS, not only UI)

| Role | Worker pay | Client price | Writes |
|---|---|---|---|
| Worker | own jobs only | never | own jobs, 15-min window (unchanged) |
| Manager | own site, read-only, shown on Job Detail | never | own site (unchanged) |
| Carasso worker | never | yes (Job Detail, export) | nothing |
| Admin | yes, edit | yes, edit | everything |

- No money columns on the All Jobs list for any role.
- Client prices must be unreadable to workers and managers at the API level, not just hidden in the UI (today `jobs_manager` exposes everything it selects; split views or column-level grants needed).
- Carasso must not be able to read `worker_price`, `coworker_share`, `submitter_share` at the API level.

## 3. New role: Carasso worker

- New `user_role` value (e.g. `carasso`).
- Invited by admins only. Admin assigns **multiple sites** per Carasso user (new user↔sites link; multi-select in invite/edit user).
- **Can access**
  - All Jobs: search and filters as today (plate/VIN/billing code search, service, dates, "missing billing code", worker filter unless names hidden), site filter limited to their sites.
  - Job Detail, read-only: plate, VIN, brand, date, site, service, crew, worker note, client prices, photos and video.
  - Export: customer report only.
- **Cannot see**: worker pay, manager note, duplicate flag/compare panel, deleted jobs.
- **Cannot open**: Dashboard, Analytics, Services, Team, Admin pages, New Job, Vehicle Lookup, My Jobs/Stats.
- Strictly read-only. No billing code editing.
- Photo/video access through the Worker (`/photo/:jobId/:kind`) must allow Carasso for jobs on their sites.

### Admin setting: hide worker names from Carasso

- One app-wide switch on a new admin settings screen. Default: **off** (names shown).
- When on, for Carasso users: crew hidden on All Jobs and Job Detail, worker filter removed, `Worker` export column unavailable.

## 4. Excel export

### Layout
- **One customer-report layout for all of Carasso**, replacing per-site `sites.customer_report_config`. (This also removes the existing bug where an admin saving another site's layout overwrites their own site's.)
- Admin edits and saves the layout.
- Carasso users start from the saved layout and can toggle columns per download. Not saved.
- Client price columns are only offered to admin and Carasso. Managers' customer report never includes them.
- Multi-site export: one file, one sheet, with a `Site` column.
- Fix outdated help text `export.customerHelp` ("never contains worker names").

### Naming
- Sheet name: **`Koch - Report`** (both languages).
- File name: **`Koch-Report-{from}-to-{to}.xlsx`**. No site name, Latin letters in both languages.

### Language
- Applies to all exports: customer report, worker payments, stats, My Jobs.
- **Hebrew by default**, with an English option on the export screen, remembered per person.
- Hebrew exports: RTL sheet, service names from `name_he`, falling back to `name_en` when empty.

### Translations

Customer report

| English | Hebrew |
|---|---|
| Date | תאריך |
| Site | אתר |
| Vehicle brand | יצרן |
| Vehicle registration number | רישוי |
| VIN | שלדה |
| Work performed | שירות |
| Catalog number | מק"ט |
| Customer billing code | מספר הזמנה |
| Worker | עובד |
| Client unit price (₪) | מחיר לחלק (₪) |
| Client total price (₪) | מחיר כולל (₪) |

Worker payments (admin)

| English | Hebrew |
|---|---|
| Amount | סכום |
| Summary | סיכום |
| Jobs | עבודות |
| Total | סה"כ |
| Sheet: Payments | תשלומים |

Stats

| English | Hebrew |
|---|---|
| Service | שירות |
| Jobs (count) | מספר עבודות |
| Sheet: Stats | סטטיסטיקה |

Note: the existing UI label for Vehicle brand (`he.json`, currently דגם) should change to יצרן too.

## 5. Duplicate warning on job submit

- Match on **VIN or plate**, **any site**, **any time**, **any service**. (Today: VIN only, same site, 7 days.)
- Warn only. Never blocks. Job is still flagged (`duplicate_of_job_id`) for managers/admins.
- Warning content: the **most recent previous job's date, site, and service**. No money, no worker names.
- Shown:
  1. As soon as plate or VIN is entered (typed or OCR), and
  2. Again in a confirmation dialog on Submit.
- Lookup must be a security-definer function returning only those three fields, since workers can't read others' jobs.
- Offline queue: if the check can't run offline, submit proceeds; the flag is computed server-side on insert.

## 6. App UI language

- Default language changes from English to **Hebrew** (RTL) for everyone. Users can still switch; the choice persists.

---

## Out of scope (for now)

- Analytics for Carasso
- Money columns on All Jobs
- Margin report (client price − worker pay)
- Carasso editing billing codes
- Per-job quantity / parsing `X5` from catalog numbers
- Client entity / multi-client support
