# Security Notes — Manual Ops Checklist

Companion to `SECURITY-AUDIT.md`. Everything here is a dashboard/CLI action
the repo cannot perform on its own — tick items off as you do them. See
`SECURITY-AUDIT.md` §11 (Production Security Checklist) for the full list;
this file has the step-by-step for the three items that were still open
after the 2026-08-25 follow-up audit.

## 1. Supabase password policy (L-5)

Supabase Dashboard → your project → **Authentication** → **Policies** (or
**Settings** → **Auth**, label varies by dashboard version) → **Password
Requirements**:

- [ ] Set **Minimum password length** to `8` (currently defaults to 6 —
      the frontend already enforces 8 in `Welcome.tsx`, this closes the
      server-side gap so it can't be bypassed by calling the API directly).
- [ ] Enable **"Prevent use of leaked passwords"** (HIBP breach-database
      check).

No app downtime, no code change. Existing users are unaffected — the
policy only applies at signup/password-change, and there's no self-signup
path (`/invite`-only) so nothing is force-reset.

## 2. Cloudflare API token separation (deploy vs. backup)

**Why:** `deploy-web.yml`, `deploy-worker.yml`, and `backup.yml` all
currently read the *same* GitHub Actions secret, `CLOUDFLARE_API_TOKEN`
(confirmed in all three workflow files). That token deploys both Worker
scripts — i.e. it can overwrite the running application — while the
backup job only ever needs to write one object to one R2 bucket. If the
GitHub secret ever leaks (compromised runner, malicious workflow change in
a PR, leaked log), the blast radius today is "attacker can redeploy the
Worker," not just "attacker can write to the backup bucket." Splitting the
token means a leak scoped to the backup job can only touch backups.

**Steps:**

- [ ] Cloudflare Dashboard → **My Profile** → **API Tokens** → **Create
      Token** → **Custom token**.
- [ ] Name it `car-prep-backup-r2` (or similar). Permissions:
      **Account** → **Workers R2 Storage** → **Edit**. Scope to the
      specific account only (not "All accounts"). No zone permissions
      needed.
- [ ] In the repo: **Settings** → **Secrets and variables** → **Actions**
      → add a new secret `CLOUDFLARE_BACKUP_API_TOKEN` with this token's
      value.
- [ ] Edit `.github/workflows/backup.yml` line 28: change
      `CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}` to
      `CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_BACKUP_API_TOKEN }}`
      (wrangler reads the env var by that fixed name regardless of which
      GitHub secret backs it — only the right-hand side changes).
- [ ] Trigger the backup workflow manually (`workflow_dispatch`) once to
      confirm the new token works before the next scheduled run.
- [ ] Leave `CLOUDFLARE_API_TOKEN` (the existing, broader token) as-is for
      `deploy-web.yml` / `deploy-worker.yml` — those genuinely need
      Workers Scripts:Edit.

*(This edits a workflow YAML file, not application code — flagged here as
documentation per the current task's scope; apply the one-line workflow
change yourself, or ask for it as a separate follow-up.)*

## 3. R2 photo lifecycle rule — verify it's actually applied (not just documented)

The 60-day photo expiry and 180-day backup expiry are **already documented
as CLI commands** in `worker/README.md:47,52` and referenced in
`worker/wrangler.toml`'s trailing comment — they are not dashboard steps,
they're one-time `wrangler` invocations run against the live buckets. The
open item is confirming they were actually run, since a documented command
and an applied rule are two different things.

- [ ] Run (idempotent — re-adding an existing rule with the same `--id`
      is safe):
  ```
  npx wrangler r2 bucket lifecycle list car-prep-photos
  npx wrangler r2 bucket lifecycle list car-prep-backups
  ```
  Confirm `expire-60d` (photos and condition videos) and `expire-180d`
  (backups) both appear. If any is
  missing, apply it:
  ```
  npx wrangler r2 bucket lifecycle add car-prep-photos --id expire-60d --expire-days 60 --prefix ""
  npx wrangler r2 bucket lifecycle add car-prep-backups --id expire-180d --expire-days 180 --prefix ""
  ```
- [ ] **Caveat before relying on this:** confirm 60-day photo retention and
      180-day backup retention actually satisfy whatever record-keeping
      obligation applies to vehicle prep/service jobs in your
      jurisdiction (insurance, warranty, or consumer-protection
      recordkeeping periods sometimes exceed 60 days). This is a business/
      legal call, not a technical one — the rule is easy to widen
      (`--expire-days 365`) if 60 turns out to be too short.

## 4. Deferred video: the video-slot write window (migration 0031)

Photo writes (R2 via the Worker's `/upload`, and the `photos` row via
`photos_insert`) are both authorized by `can_write_photo(job, kind)`.
`can_write_job` itself is unchanged (the old Worker path, which calls it, works
as before). For a worker's own job:

- plate/VIN/extra photos: exactly `can_write_job`'s 0014 rule (lock open, or
  the job has no photo rows yet), so finished evidence photos stay
  unreplaceable;
- the video: only while the 15-minute lock is open, or through the bounded
  video branch below. The 0014 "no photo rows yet" branch does not apply to
  the video, so a job with zero photos is not video-writable forever.

The bounded video branch:

- the job is not soft-deleted;
- no `video` row exists yet: once the row is recorded the slot is closed to
  the worker;
- within 7 days of `jobs.created_at`, which the server stamps for workers
  (0021), so the window cannot be stretched by the client.

The clip is not strictly write-once. Exceptions, accepted (low):

- inside the 15-minute lock the clip can be overwritten, like any photo;
- R2 write-once TOCTOU: the "no video row" check runs before the up-to-90MB R2
  put, and the row is written only after it. Until the row lands, a
  hand-crafted concurrent upload by the same worker can overwrite the clip at
  the same key. (A conditional R2 put / per-upload nonce would close it; not
  done.)

Residual risk, accepted: within those 7 days a worker can attach a video to
any of their own jobs that never got one. Do not widen this without a reason;
if Worker and policy ever disagree, a clip lands in R2 without a row (or the
reverse).

Resumable video upload (`/video/*`, `worker/src/videoUpload.ts`):

- Every call (start, part, complete, abort) runs `can_write_photo(job, 'video')`
  with the caller's JWT before any R2 call. An upload id alone is never a write
  capability: a user who loses write access mid-upload is refused on the next
  piece.
- `jobId` must be a canonical uuid (lowercase 8-4-4-4-12), else 400 before the
  rate limiter, Postgres or R2 (`isCanonicalJobId`, also on `/upload`; `/photo`
  unchanged). Postgres accepts uppercase, braces or no hyphens for the same
  row, but each spelling would be a different R2 key.
- The R2 key is always derived from `jobId` (`video/{jobId}`); the client never
  names one. The upload id is resumed under that key only. **ASSUMPTION until
  the live check below:** R2 refuses an upload id under a key it was not
  created for, so job B's write permission cannot be used to add pieces to,
  complete or abort job A's upload. Which error it throws is also an
  assumption: the code expects NoSuchUpload (10024) on part, complete and
  abort; miniflare throws 10024 only for `uploadPart` and InternalError for
  complete/abort under a wrong key.
- Error mapping (R2 codes assumed until the live check): part and start answer
  410 for 10024/10025/10048/10011 and rethrow anything else (500, the phone
  retries). Complete, on ANY R2 error, first runs the read-only idempotency
  check below and answers 200 if it matches; otherwise 410 for those codes,
  else rethrow (500). An arbitrary error is never turned into 410. Abort always
  answers 200 `{ok: true}` once authorised: 10024 silently, any other R2 error
  with a `console.warn` (the phone ignores abort failures; nothing leaks).
- The type is sniffed from piece 1 (MP4/MOV/WebM, else 415). Each piece is
  counted on the Worker (8 MiB cap, 413, with or without a Content-Length); at
  complete the stored size is checked against 90 MB and an oversized object is
  deleted (413). Pieces are buffered in the isolate (~16 MiB peak per request:
  the body plus the copy handed to R2), accepted.
- Complete is idempotent: a retry after a lost or timed-out response answers
  200 only if the object at the key looks like that complete's result
  (multipart etag ending `-N`, `(N-1) x 8 MiB < size <= N x 8 MiB`, size <=
  90 MB; the etag format is an assumption until the live check).
- `/video/start` has its own limiter, `VIDEO_START_LIMITER` (10/min per user,
  on top of `UPLOAD_LIMITER`), because every start opens a new multipart
  upload. A legitimate phone starts once per clip (twice after a 410). The
  binding is in `worker/wrangler.toml` and ships with the Worker deploy; no
  dashboard step. Both limiters fail closed: a missing binding is a 500 on
  the routes that use it, like `/upload` and `/ocr`, never an unlimited route.
- The real ceiling of that limiter, accepted: 10 starts/min x up to 80 MiB =
  ~800 MiB/min of incomplete uploads per account, ~1 TiB/day if sustained.
  Soft: limiter counters are per Cloudflare location and eventually
  consistent, so a caller spread over locations can exceed it. Who can do it:
  a worker with an own job under 7 days old that has no video row, or any
  manager/admin (any job they can write). Incomplete uploads expire after 7
  days (assumption until the lifecycle check below), so the parked total is
  bounded by 7 days of that rate. The phone itself never retries a 429 inside
  a run and does not count it as a failed attempt.
- Orphan uploads (started, never completed: a discarded clip whose abort
  failed, a lost start response, a restart after 410) hold storage until R2's
  default rule aborts incomplete multipart uploads after 7 days (assumption
  until the read-only lifecycle check below). The number of starts is now
  bounded by the limiter, but storage per upload is up to 80 MiB (10 pieces of
  8 MiB, assuming R2 replaces a re-sent part number rather than keeping both)
  for up to 7 days.
- The TOCTOU note above still applies: the "no video row" check runs per call,
  and the row is written only after complete.
- Accepted: the uploadId travels in the query string, so it appears in Worker
  logs; it is not a capability on its own (every call re-checks
  `can_write_photo`).

Shared phone, accepted: queued entries (with their photos and the clip) sit in
the browser's IndexedDB. The queue's owner filter only decides what is shown and
flushed for the signed-in user; it is not access control, and logging out does
not clear the store. Anyone with the unlocked phone and devtools can read it.

- [ ] Apply 0031 before deploying the Worker that calls `can_write_photo`,
      then the web build: **migration -> Worker -> web** is mandatory. A Worker
      deployed before the migration gets a 404 from the missing function and
      answers 403 to every upload (photos too); the queue treats 403 as
      permanent and flags those entries `needsAttention`.
      Check it is applied: an anon call to `rpc/can_write_photo` must be
      refused with 401 / permission denied, not answer 200 `false`.
- [ ] Rollback, in reverse: **web -> Worker -> migration**. Keep
      `can_write_job` in place throughout; never drop `can_write_photo` while
      the new Worker is live.
- [ ] Keep the mixed-version windows short: an old-web queued job past its
      lock with zero photo rows plus a video, soft-deleted or older than 7
      days, fails as a whole until the new web is live (Retry then sends the
      photos without the video).
- [ ] Resumable video, deploy: Worker first is recommended (deploy-web and
      deploy-worker run in parallel on push to main); the web falls back to
      `/upload` when `/video/start` answers 404, so either order is safe.
- [ ] Read-only: `npx wrangler r2 bucket lifecycle list car-prep-photos`
      should show the default rule aborting incomplete multipart uploads after
      7 days. If it is missing, orphan uploads are never cleaned up.
- [ ] Live R2 check (every R2-behaviour statement above is an assumption
      until this passes). With a worker who may write both jobs A and B, and a
      real video: `/video/start?jobId=A` (piece 1), `/video/part?jobId=A`
      (piece 2), noting A's uploadId and both etags. Then:
      1. Cross-key part: `/video/part?jobId=B&uploadId=<A's id>&partNumber=3`
         answers non-2xx (410 expected).
      2. Cross-key complete: `/video/complete?jobId=B&uploadId=<A's id>` with
         A's real etags answers non-2xx, and `npx wrangler r2 object head`
         (or the dashboard) shows `video/B` unchanged.
      3. Cross-key abort: `/video/abort?jobId=B&uploadId=<A's id>`, then A's
         own `/video/part?jobId=A` and `/video/complete?jobId=A` still succeed.
      4. The completed `video/A` object's etag ends in `-N` (N = part count).
      5. A second `/video/complete?jobId=A` on the same, already-completed
         uploadId answers 200 via the head() idempotency path (R2 throwing
         10024 there, or at least a code the head() check catches), not a
         retry loop of 500s.
      6. Same-key gone path (the restart path the client depends on): start a
         fresh upload A2 for job A, abort it (`/video/abort?jobId=A&uploadId=<A2>`),
         then `/video/part?jobId=A&uploadId=<A2>&partNumber=2` and
         `/video/complete?jobId=A&uploadId=<A2>` both answer 410, not 500.
      Then abort A (`/video/abort?jobId=A&uploadId=<A's id>`; a no-op if it
      completed) and delete the test objects.
- [ ] Live limiter check: the deployed Worker enforces `VIDEO_START_LIMITER`:
      11+ `/video/start` calls inside one minute from one account get a 429
      (counters are per location, so allow a little leniency; abort the
      uploads it opened afterwards).
- [ ] Confirm no other Worker on the Cloudflare account uses ratelimit
      `namespace_id` 1003 (`VIDEO_START_LIMITER`); a shared namespace would
      share its counters.

## 5. Multi-service jobs (migration 0033)

A job's services live in `job_services` (one row per job and service), each
line carrying its own pay snapshot; client prices per line in
`job_service_client_prices`. RLS is on for both and anon is revoked.

`job_services` policies mirror `jobs`:

- select: whoever can read the job (the subquery runs under `jobs_select`);
- insert / delete: the `jobs_update` rule — admin; manager at the job's site;
  the submitter while the 15-minute lock is open and the job is not deleted.
  Co-workers never. Insert's submitter branch also covers a manager who logs a
  job at another site (allowed by `jobs_insert`);
- update (a line's pay): admin only.

`job_service_client_prices`: admin all; Carasso select via `can_view_job`.
Workers and managers have no access. `jobs_carasso.services` carries names and
client prices, never worker pay.

**Hidden client prices (0038).** While the admin switch
`app_settings.hide_client_prices` is on, Carasso's select on both
`job_client_prices` and `job_service_client_prices` matches no row (the policy
adds `not <switch>`; a missing key row counts as off), and `jobs_carasso`
returns `client_unit_price`, `client_total_price` and each `services[]`
element's price keys as NULL for a Carasso caller (admin still sees them).
Both layers are required: the policies cover a direct table read, but
`jobs_carasso` is owner-rights and reads the price tables past RLS, so it has
to blank them itself. Only `set_hide_client_prices` (security definer, admin
only, anon revoked) writes the switch. The web hides the Job details price
card and the export price columns too, failing closed (hidden) when the
settings cannot be read; that is UX, not the control. The two policies read the
switch with the caller's own rights, so they rely on `app_settings_select`
admitting Carasso: narrowing that policy later would make them read "off" and
show prices again (the view is unaffected). Keep them in step.

Price snapshot (trigger `job_services_guard`, security definer): on insert,
every signed-in caller gets the catalog `services.worker_price`, whatever the
client sent; only the trusted context (no app user: SQL editor, service role)
may insert a line at a given price. On update, a line cannot be moved to
another job/service, and a non-admin's pay change is silently reverted. Client
prices are snapshotted from `service_client_prices` by a security-definer
trigger on insert. `jobs.worker_price` and `job_client_prices` are recomputed
sums, so neither can be set directly any more. At least one line per job is
enforced by trigger (with a row lock on the job against concurrent deletes).

Writes go through `create_job` / `set_job_services`, both **security
invoker**, so RLS and the triggers above apply as-is; execute is revoked from
public/anon and granted to `authenticated`. `set_job_services` refuses (42501)
when the caller's `jobs` update touches no row (window closed, deleted job,
co-worker). A manager's job insert, including their own job at another site,
now gets the server's `locked_at` (now + 15 minutes) from
`jobs_guard_worker_columns`, the same as a worker's, so the submitter branch of
`job_services_insert` closes after 15 minutes there too; manager updates are
unchanged. Both guards test `caller.id` (no app user = trusted context),
never the composite (`caller is [not] null`): on a row variable that tests
every column, so with `is not null` a signed-in user with a null column (no
`site_id`: Carasso, staff without a site) would pass as the trusted context.
`is null` was safe but is changed for consistency.

A job queued offline whose service is soft-deleted before the phone syncs is
refused by `create_job` (23514, permanent): the entry stays on the device,
flagged `needsAttention`, until an admin restores the service or the worker
re-picks.

Mixed-version window: the PWA caches its app shell, so phones keep running the
previous build until they reload after the web deploy. That build writes the
deprecated `jobs.service_id`:

- a new job from it gets its first line from the seed trigger (price stamped
  as above), so submissions keep working;
- an edit of `service_id` from it **replaces the job's services with that one
  service**: a multi-service job (logged from a new build) that a manager or
  admin on the old build re-services loses its other lines. Unchanged
  `service_id` on save does nothing (the trigger fires only on a change);
- an old-build admin's per-job pay override and direct `job_client_prices`
  edit do not stick (recomputed from the lines).

Old offline-queue entries (single `serviceId`) are normalised by the new web
before `create_job`.

- [ ] Deploy order: **0033 -> web**. 0033 alone keeps the previous web working.
- [ ] Run `supabase/verify_0033.sql` (read-only, SQL editor): every row `ok`
      (line/job parity, RLS on, policies present, anon cannot execute
      `create_job`, views `security_invoker`, no worker pay in `jobs_carasso`).
- [ ] Keep the mixed-version window short: right after the web deploy, ask
      managers and admins (and workers) to reload the app (close and reopen
      from the home screen) so no old build edits a multi-service job.
- [ ] Rollback: **web only**. 0033 is roll-forward only — never drop
      `job_services` while any job has more than one service (the 0005 data
      loss again). A rolled-back web is an old build, with the caveats above.
- [ ] Drop the deprecated `jobs.service_id` and its triggers in 0036, once no
      old build can still be running.

---

## 6. Manager/admin full edit, photo tombstones, trigger-written audit (migration 0034)

Managers (own site) and admins can now edit plate, VIN, brand, worker note and
the job date, and add, replace or remove any media slot at any age. Workers
kept the 15-minute window, column guard (0021/0028/0033) and `can_write_photo`
(0031); from 0035 they also edit their own job's media inside that window (§7).

What the database enforces:

- `photos_update`: admin, or manager at the job's site (USING and WITH CHECK);
  0035 adds a bounded worker branch (§7). Still **no DELETE policy** on `photos`. Removal sets
  `removed_at` (server-stamped); the R2 object is left to the 60-day lifecycle.
- `photos_guard_update` pins `id`, `job_id`, `kind`, `r2_key`, `created_at`, so
  a row can never be repointed at another job's object.
- GET `/photo` asks `can_view_photo(job, kind)`: `can_view_job` AND the slot is
  not tombstoned. A removed photo stops streaming at once even though the
  object is still in R2. The Worker also refuses (404) any job id that is not a
  canonical lowercase uuid before calling Postgres or R2. Note: responses carry
  `Cache-Control: private, max-age=300`, so a browser that already fetched a
  removed/replaced photo may show the old bytes for up to 5 minutes.
- `audit_log` rows are written only by security-definer AFTER triggers on
  `jobs`, `job_billing`, `job_services`, `job_service_client_prices` and
  `photos`, for manager/admin callers (`caller.id is not null`, never
  `caller is null`). They run in the same transaction as the row change, so
  a row edit cannot land unaudited. Exception, accepted (low): a media
  add/replace writes the R2 object (Worker `/upload`) *before* the `photos`
  row; if the row write then fails, the new bytes are live at the slot's key
  with no audit row (the user sees an error). `audit_log_insert` is dropped:
  clients can no longer write or forge audit rows. `audit_diff()` is not
  executable by `anon`/`authenticated`. Worker edits are no longer audited at
  all (they were client-written before; workers stay limited by the 15-minute
  window).
- `audit_log_select` (redefined in 0034): admins read every row; a manager at
  the job's site reads every row except client prices, i.e. never action
  `client_price_update` (the `job_service_client_prices` trigger's own
  action) and never a legacy client-written row whose `changes` text mentions
  a `"unit_price"` / `"total_price"` key (e.g. inside `service_lines`). Without
  this, a manager could read admin-only client prices from the log. Check:
  `verify_0034.sql`.
- Job date: `jobs_guard_date` refuses (errcode 22023) a manager/admin update
  that moves `jobs.created_at` more than 5 minutes into the future, so the
  worker's 7-day video window (§4, keyed on `created_at`) cannot be held open.
  Accepted (low): a manager can still re-date an old job to the recent past,
  which reopens that window for its worker; managers are a trusted, own-site
  role.
- Accepted (low), 0034 review L-2: `jobs_flag_duplicate` searches every site,
  so a manager editing plate/VIN can learn that the car was done earlier
  elsewhere (the flag is set; the other job's details stay hidden by RLS).
- Accepted (low): a worker overwriting a manager's replacement inside the
  15-minute window, see §7.
- Accepted (noise): a manager's own new job writes `media_add` audit rows for
  its photos (the photos trigger cannot tell creation from a later add; job
  services use the same-transaction rule, photos land in later requests).

- [ ] Deploy order: **0034 -> Worker -> web**. The old web keeps working (its
      audit inserts are refused and swallowed; the triggers log instead). A
      Worker deployed before 0034 403s every photo view.
- [ ] Run `supabase/verify_0034.sql` (read-only, SQL editor): every row `ok`.
- [ ] Rollback in reverse: **web -> Worker -> migration**. Never drop
      `can_view_photo` while the new Worker is live. Before redeploying an old
      web on a rolled-back database, recreate `audit_log_insert` (0001) or its
      audit rows are lost.

---

## 7. Worker media edit inside the 15-minute window (migration 0035)

A worker can add, replace and remove extra photos 1-5 (4 and 5 since 0039) and the video, and replace
(never remove) the plate and VIN photos, on **their own** job (`jobs.worker_id`,
never `coworker_ids`) while `jobs.locked_at > now()` and the job is not
soft-deleted. Worker changes are not audited (`photos_audit` skips worker
callers, as in 0034). After the window, worker rules are 0031's, except that a deleted job is now
refused in every worker branch of `can_write_photo`.

What the database enforces:

- `photos_update` worker branch (USING and WITH CHECK): `u.id = j.worker_id`,
  `j.locked_at > now()`, `j.deleted_at is null`. WITH CHECK also requires
  `removed_at is null or kind not in ('plate','vin')`: a worker's tombstone of
  plate/VIN is refused with 42501. `photos_guard_update` (0034) still pins
  id/job/kind/R2 key/created_at and server-stamps `removed_at`; WITH CHECK runs
  on the row after it.
- `photos_insert`: `can_write_photo(...) and removed_at is null`, so nobody
  inserts an already-removed row. A worker's replace is an upsert, so it passes
  both this (on the proposed row) and `photos_update` (on the conflict path).
- `can_write_photo`: the worker's window branch and its "no photo rows yet"
  branch (0014/0031) now also require `j.deleted_at is null` (the bounded video
  branch already did), so `/upload` and `/video/*` refuse R2 writes to a
  deleted job in every worker branch. Workers cannot soft-delete
  (`jobs_guard_worker_columns` pins `deleted_at`); this covers a manager
  deleting the job while the worker's window is still open. Managers/admins
  are unchanged (a manager may restore a deleted job).
- Still no DELETE policy. Managers/admins unchanged.

Accepted (low):

- **ACCEPTED (lead decision): a worker can un-remove a manager-removed slot.**
  Inside their own job's 15-minute window, a worker can set `removed_at = null`
  (PATCH or upsert) on any slot a manager removed, plate and VIN included
  (WITH CHECK only stops a worker *ending* with a plate/VIN tombstoned). This
  brings back no new media: it un-hides the object already stored at that
  slot's R2 key (job id + kind), which stays until the 60-day lifecycle.
  Bounded (15 minutes, own job only) and unaudited (worker changes write no
  audit rows); managers rarely act on a job that young.
- **ACCEPTED (lead decision): every Worker 403 reads as "window closed".**
  The web cannot tell the Worker's refusals apart, so any 403 from `/upload` or
  `/video/*` (and any 42501 or zero-row update) in the worker's panel shows the
  window-closed message, which says the change *may* not have been saved and
  asks for a reload.
- Stale R2 objects: a removed slot's object stays in R2 until the lifecycle
  (0025). An upload checked by `can_write_photo` just before the deadline
  (each `/video/*` call and `/upload` check once, before the R2 write) can land
  its object after the window closes; the row write that follows is refused,
  and the worker sees "window closed". The overwritten object is what `/photo`
  serves for that slot (it does not require a row, only no tombstone), so a
  video or photo can change a few seconds to minutes after the window.
- A worker (or their offline queue) can overwrite a manager's in-window
  replacement of a slot, in R2 and in the row, with no audit row for the
  worker's change. Same 15-minute bound; the manager's change is audited.

- [ ] Deploy order: **0035 -> web**. No Worker change. 0035 alone keeps the
      old web working (it never sends a worker update).
- [ ] Run `supabase/verify_0035.sql` (read-only, SQL editor): every row `ok`.
      `verify_0034.sql` now expects the manager/admin branches (it no longer
      asserts "no worker" in `photos_update`).
- [ ] Optional, on a local/branch database only: `supabase/scenarios_0035.sql`
      (impersonates a worker, ends in ROLLBACK) raises on any leak.
- [ ] Rollback: **web -> 0035 down** (the commented block in the migration
      header): restores the 0034 `photos_update`, the 0031 `photos_insert` and
      the 0031 `can_write_photo`.

## 8. Partial plate / VIN lookup (migration 0037)

`lookup_vehicle` now matches "contains" instead of exact. 0018 refused that
because it lets a caller page through every job one fragment at a time; the
product owner accepted that trade-off (workers often see only part of a dirty
plate or VIN). What bounds it:

- Staff only: `current_app_user()` role must be worker, manager or admin (as
  0033). The read-only role and unknown users get `forbidden`; anon has no
  EXECUTE.
- At least 4 characters after normalisation, at most 17; raw input over 64
  characters returns nothing before any regex runs.
- At most 100 rows per call, newest first. 100 is unchanged from 0018/0033: a
  lower cap does not slow an enumerator (more fragments do the same work) and
  only hides real matches from the worker.
- Same columns as before: date, site, plate, VIN, brand, service names. Never
  the worker, notes, billing code or price.

Injection: no dynamic SQL. The query is static plpgsql with the pattern bound
as a value. Input is reduced to `[A-Z0-9]` first, and `\`, `%`, `_` are still
escaped in the LIKE pattern (`escape '\'`) so a wider allowlist later cannot
turn them into wildcards. `supabase/scenarios_0037.sql` covers `%`, `_`,
quotes and SQL-looking strings.

Accepted (lead decision): enumeration of plate/VIN/brand/site/service history
by any active staff account, bounded as above. Not rate-limited server-side.

- [ ] Deploy order: **0037 -> web**. 0037 alone keeps the old web working (an
      exact plate or VIN still matches).
- [ ] Precondition: `select extnamespace::regnamespace from pg_extension where
      extname = 'pg_trgm';` returns nothing or `extensions`.
- [ ] Run `supabase/verify_0037.sql` (read-only): every row `ok`.
- [ ] Optional, local/branch database only: `supabase/scenarios_0037.sql`
      (impersonates users, ends in ROLLBACK).
- [ ] Rollback: **web -> 0037 down** (commented block in the migration
      header): drops the two trigram indexes and restores the 0033 body.

## 9. Managers/admins submit jobs for workers or under a typed name (migration 0040)

Who may INSERT a job (`jobs_insert`, plus `create_job` which is security
invoker and goes through it):

| Caller  | As self                         | Typed name (`worker_label`) | For a worker (on behalf)                         |
|---------|---------------------------------|-----------------------------|--------------------------------------------------|
| worker  | any site (unchanged)            | refused                     | refused                                          |
| manager | any site (unchanged since 0028) | own site only               | active worker of own site, job at own site only  |
| admin   | any site                        | any site                    | any active worker, any site                      |
| carasso | refused                         | refused                     | refused                                          |

On behalf means only `role = 'worker'` targets: never a manager, admin,
carasso or inactive user.

Label rules (`jobs_worker_label_check` + `jobs_guard_worker_label`):

- 1..60 characters after trimming (`''`/spaces = no label); control,
  zero-width and bidi-override characters are refused by the CHECK, so a label
  cannot hide or reorder text in the Jobs list, exports or Carasso.
- Only valid when the submitter is the owner (`worker_id` = caller); a label
  together with someone else's `worker_id` is refused at INSERT.
- A **worker's** label at INSERT is **rejected** (RLS, 42501). A worker's
  write to the label on UPDATE is **silently reverted** (0021 style: a client
  resending the whole row must not fail). Manager/admin: the label can be
  cleared but never set or changed after insert (42501); reassigning the job
  (`worker_id` change) clears it.
- Carasso: `jobs_carasso.crew` shows the label in place of the submitter's
  name and `worker_id` is NULL for a labelled job, so `carasso_crew()` never
  lists the submitter. With `hide_worker_names` on, crew and `worker_id` are
  NULL as before.

Audit: an on-behalf insert writes an `audit_log` row (`action =
'create_on_behalf'`, `user_id` = submitter, `changes = {worker_id: {from:
null, to: owner}}`) from an AFTER INSERT trigger; self-submits and the trusted
context write none. `jobs_audit` now also logs label changes.

`list_staff()` regression fixed: 0032 recreated it from the 0019 body and lost
0028's checks, so a Carasso user could call it and Carasso accounts were
listed. 0040 restores "worker/manager/admin callers only, Carasso not listed"
with 0032's columns.

Accepted (lead decision):

- An admin's on-behalf insert keeps an admin-supplied `locked_at`
  (`jobs_guard_worker_columns` does not stamp admins, L-2). Admin is trusted;
  the web sends none, so the default 15-minute window applies.
- No `created_by` column: who submitted an on-behalf job is in the audit row
  only. A labelled job's submitter is its `worker_id`.
- Recent typed names are stored per device (localStorage), not shared.

- [ ] Deploy order: **0040 -> web**. The new web must not ship first:
      `submitJob` always sends `p_worker_label`.
- [ ] Run `supabase/verify_0040.sql` (read-only): every row `ok`.
- [ ] Optional, local/branch database only: `supabase/scenarios_0040.sql`
      (impersonates users, ends in ROLLBACK).
- [ ] Rollback: **web -> 0040 down** (commented at the end of the migration).
      Loses every label; keeps the `list_staff` fix.

## 10. Admins rename / disable / delete sites (migration 0041)

- **Admin only.** `sites_write` (0001) is the only write policy on `sites` and
  is admin-only; there is no manager carve-out (0005's report-config RPC writes
  `app_settings` since 0027, and the column it wrote was dropped in 0030).
  Managers and workers updating or deleting a site change 0 rows.
- **No new jobs at a disabled site, in the database.** `jobs_insert` (0040
  body, unchanged) is now ANDed with "the site exists and is active", so
  `create_job` (security invoker) and a direct insert both fail with 42501.
  Existing jobs stay readable and editable.
- **Delete guard.** `users.site_id` (was SET NULL) and `user_sites.site_id`
  (was CASCADE) are now NO ACTION like `jobs.site_id`, so deleting a site that
  still has jobs (soft-deleted ones included), users or viewer links fails
  with 23503 instead of silently un-homing users or dropping viewer access.

Accepted (lead decision):

- `worker/src/invite.ts` does not check `sites.active`: an admin can invite
  someone onto a disabled site through the API (the UI offers enabled sites
  only). Admin is trusted, and such a user can still log no job there.
- Moving an existing job into a disabled site is blocked only in the UI.

- [ ] Deploy order: **0041 -> web** (the new web selects `sites.active`).
- [ ] Run `supabase/verify_0041.sql` (read-only): every row `ok`.
- [ ] Optional, local/branch database only: `supabase/scenarios_0041.sql`
      (impersonates users, ends in ROLLBACK).
- [ ] Rollback: **web -> 0041 down** (commented at the end of the migration).
