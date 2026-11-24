# Data model

Tables, per-migration behaviour, deploy/rollback order and roles. Former `CONTEXT.md` §4. Security reasoning per migration: [`SECURITY-NOTES.md`](../security/SECURITY-NOTES.md).

## 4. Data model

```
sites(id, name, active,   -- active false = disabled (0041)
      vin_rule, plate_rule) -- required|optional for new jobs (0042)
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
app_settings(key, value)  -- admin switches: hide_worker_names, hide_client_prices (0038); customer_report_config
photos(id, job_id, kind[plate|vin|extra_1..5|video], r2_key, expires_at,
       removed_at)            -- tombstone (0034): slot removed by a manager/admin
audit_log(id, job_id, user_id, action, changes_jsonb, at)   -- trigger-written (0034)
```

**Sites: rename, disable, delete (0041).** Everything refers to a site by id,
so an admin's rename fixes a typo everywhere, history and exports included;
the name stays unique. A site that was used cannot be deleted (every FK to
`sites` is NO ACTION, so the delete fails with 23503) because that would lose
or orphan history. Instead an admin **disables** it (`sites.active = false`):
`jobs_insert` refuses new jobs there (42501, also through `create_job`), and the
new-job, user and invite pickers and the default site scope skip it
(`pickableSites` / `startSiteId` in `useSiteScope.ts`). History, the Jobs
filter, stats and exports still list it, and users assigned to it keep their
access. An unused site (no jobs, users or viewer links) can be deleted.
Limitations: moving an existing job INTO a disabled site is blocked only in the
UI (its edit pickers offer enabled sites plus the job's own), not by the
database; and an offline job queued before the site was disabled fails with
42501 when it syncs (it stays in the queue as needing attention, with a
translated reason since 0042).

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
it. Drop it in a later migration once no old build can be running.

**Deploy order: 0033 -> web. Rollback: web only; 0033 is roll-forward only.**
0033 alone keeps the previous web build working. Until the new web is live, two
old-build admin actions stop sticking: a per-job pay override on
`jobs.worker_price` (now always the line sum) and a direct `job_client_prices`
edit (recomputed on the next line change). Never drop `job_services` while any
job has more than one service — that is the 0005 data loss again. Run
`supabase/verify_0033.sql` (read-only) after applying.

**Manager/admin full edit and audit (0034).** Managers (own site) and admins
edit every job field and every media slot at any age; workers keep the
15-minute window and column guard (and, from 0035, edit their own media inside
that window, below). Two decisions:

- *Remove is a tombstone*, `photos.removed_at`, not a row delete: the R2
  object is left to the 60-day lifecycle (no hard deletes from the app), the
  row keeps the slot's unique `(job_id, kind)` so re-adding is an update, and
  history keeps what was there. Because the object outlives the removal, the
  Worker's GET `/photo` asks `can_view_photo(job, kind)` (= `can_view_job` and
  the slot not tombstoned) instead of `can_view_job`. Readers of `photos` must
  filter `removed_at is null`. Replace is an upsert without `ignoreDuplicates`
  (an update of the live row); `photos_guard_update` pins id/job/kind/R2 key and
  restarts `expires_at` on a live row (the overwrite restarts the lifecycle).
  Workers update `photos` only through 0035's bounded branch (below).
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

**Worker media edit (0035).** In My Jobs, the worker's own job (submitter,
never a co-worker) shows its photos and video in the edit panel; while the
15-minute window is open the worker adds, replaces and removes extra photos
1-5 and the video, and replaces (never removes) plate and VIN. Same
`JobMedia` component and `setMedia`/`removeMedia` calls as managers, with
`alwaysManage` (no toggle) and `keepSlots={['plate','vin']}`; changes save at
once, apart from Save/Cancel. Workers are no longer insert-only on `photos`:
`photos_update` has a worker branch bounded by `worker_id`, `locked_at >
now()` and `deleted_at is null`, and its WITH CHECK refuses a worker's
plate/VIN tombstone, so the rule is the database's, not the UI's.
`photos_insert` refuses an already-removed row, and every worker branch of
`can_write_photo` now needs a live job. Worker media changes are not audited (no Edit
history for workers either). While the offline queue holds any entry for the job
(photos or video, sending or failed `needsAttention`) the panel shows a note
instead of controls: a manual change would race the queue's upload of the same
slot, and a later Retry re-uploads the originals over a manual replace. The
worker waits, or uses Retry/Discard on the queued card. While a media change
uploads (from the pick, downscale included), everything that would unmount the
panel is held: Save/Cancel, Edit on other rows, paging, sort and the filters.
A refusal (Worker 403, 42501, zero rows) reads as "the window closed, the
change may not have been saved", and is still shown if the window shut
mid-upload.

**Deploy order: 0035 -> web (no Worker change). Rollback: web -> 0035 down**
(commented in the migration header). Run `supabase/verify_0035.sql`.

**VIN required, plate optional (0036).** Every job has a VIN (`jobs.vin NOT
NULL`); the plate is NULL when the car has none. New Job and Job Detail block
an empty or malformed VIN; `submitJob` refuses a VIN-less payload before
`create_job` (a queued retry that already has its `jobId` still uploads its
photos), and 23502 is a permanent error. My Jobs searches plate and VIN.

**Deploy order: 0036 -> web. Rollback: web only; 0036 down is commented.**

**Per-site VIN / plate rules (0042, supersedes 0036's "VIN always").** Each
site has `vin_rule` and `plate_rule` (`required` | `optional`; defaults VIN
required, plate optional, so nothing changed until an admin edits a site).
`jobs_insert` checks them (blank or whitespace counts as missing) and also
requires a plate or a VIN; `jobs_plate_or_vin_chk` keeps every row, edits
included, with one of them. New Job reads the rules of the site the job goes
to (`siteRules` in `workerJobs.ts`; unknown site = the defaults, VIN required
and plate optional) for required markers and problems (`vehicleProblems`); the
VIN photo is required iff the VIN is. The database is authoritative: a job it
refuses (e.g. plate-required at a site the form did not know) becomes a
translated, permanent queue entry. Rules bind new jobs only: Job Detail checks formats and "plate or
VIN" (`normalizeVehicle().missingVehicle`), not the site's current rules. When
`create_job` fails with 42501, `submitJob` reads the site once and, if it
explains the refusal, throws `InvalidJobError('site-disabled' |
'site-needs-vin' | 'site-needs-plate')`; that code becomes the queue entry's
`lastError` and `QueuedJobs` shows it translated. Permanent either way.

**Deploy order: 0042 -> web. Rollback: web -> 0042 down** (refuses while any
job has a NULL or blank VIN).

**Partial plate/VIN lookup (0037).** Car lookup finds any job whose VIN, or
plate, contains the query. `lookup_vehicle` normalises server-side (upper
case, `[A-Z0-9]` only, 4..17 characters, raw input over 64 returns nothing);
digits match plate or VIN, anything with a letter matches the VIN only. Plain
parameterised plpgsql, LIKE metacharacters escaped anyway; trigram GIN
indexes keep it an index scan. The web mirrors the rule (`lookupQuery` in
`lib/search.ts`): Search stays disabled under 4 characters, one RPC per press.
This reverses 0018's exact-match-only stance (see SECURITY-NOTES §8 for the
accepted enumeration trade-off and its bounds).

**Deploy order: 0037 -> web. Rollback: web -> 0037 down** (commented in the
migration header; keeps `pg_trgm`). Run `supabase/verify_0037.sql`.

**Hide client prices from viewers (0038).** A second admin switch on Settings,
next to worker names: while on, Carasso gets no client prices from either
price table (RLS) or from `jobs_carasso` (NULLs; admin unaffected), the Job
details price card goes, and the price columns leave its exports. Default off
(today's behaviour); a missing key row also reads as off, a failed settings
read as on.

**Deploy order: 0038 -> web -> then turn the switch on. Rollback: web -> 0038
down** (commented at the end of the migration). Run `supabase/verify_0038.sql`;
behaviour in `supabase/scenarios_0038.sql` (branch DB only).

**Managers and admins submit jobs (0040).** `/new` is open to managers and
admins (secondary nav, and a "New job" button on Jobs); their landing page and
the phone tab bar are unchanged. The form adds a required Worker field: pick a
real worker (manager: active workers of their own site, job at their own site;
admin: any active worker, any site) and the job is simply that worker's —
their pay, My Stats and 15-minute edit window; or type a name for someone
without an account, and the job is the submitter's with `jobs.worker_label`
set. A `create_on_behalf` audit row records who submitted for whom.

**Deploy order: 0040 -> web. The web must not ship first:** `submitJob` always
sends `p_worker_label`, which the old 9-arg `create_job` does not have (the old
web against the new function is fine — the argument defaults to null).
**Rollback: web -> 0040 down** (commented at the end of the migration). The
down loses every label (those jobs then count as the submitter's own pay) and
keeps the `list_staff` fix. Run `supabase/verify_0040.sql`; behaviour in
`supabase/scenarios_0040.sql` (branch DB only).

Deletion is always soft (`deleted_at`). Hard `DELETE` on `services` is granted
to **nobody** — historical jobs must keep resolving their service references.

### Roles
- **worker** — creates jobs at their own site; edits/deletes their own job,
  and its photos/video (plate/VIN replace only — 0035), within 15 min; sees
  only their own rows. Cannot see billing codes.
- **manager** — everything within their own site: view/search/edit jobs (every
  field, including plate, VIN, brand, worker note and date, at any age — 0034),
  add/replace/remove media, read the job's edit history, fill billing codes, view photos, export, analytics, manage services, activate and
  deactivate *worker-role* users at their site. Can submit jobs (0040): as
  themselves at any site, under a typed name at their own site, or for an
  active worker of their own site at their own site.
- **admin** — all sites, plus user/site management and invitations. Can submit
  jobs for any active worker or under a typed name, at any site (0040).

All of it enforced by RLS policies and `security definer` RPCs, not by the UI.
