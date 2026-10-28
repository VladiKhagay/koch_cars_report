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
- R2 write-once TOCTOU: the "no video row" check runs before the up-to-75MB R2
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
  complete the stored size is checked against 75 MB and an oversized object is
  deleted (413). Pieces are buffered in the isolate (~16 MiB peak per request:
  the body plus the copy handed to R2), accepted.
- Complete is idempotent: a retry after a lost or timed-out response answers
  200 only if the object at the key looks like that complete's result
  (multipart etag ending `-N`, `(N-1) x 8 MiB < size <= N x 8 MiB`, size <=
  75 MB; the etag format is an assumption until the live check).
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
