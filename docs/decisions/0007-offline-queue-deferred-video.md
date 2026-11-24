# ADR-0007: Offline queue with a deferred, resumable condition video

- **Status:** accepted
- **Date:** recorded 2026-11-24 (decision predates the record)
- **Source:** former `CONTEXT.md` §5
- **Supersedes / superseded by:** none

## Decision and rationale

**Binding:** failed submissions queue offline and retry; jobs always go before videos and a video failure never blocks a job; the video is a separate, resumable queue entry; the `photos` row lands only after the upload succeeds. Piece sizes, timeouts, attempt budgets and fallbacks below are implementation context that may change without a new ADR.

Every submission that fails is kept in IndexedDB (`web/src/lib/offlineQueue.ts`,
store `pending-jobs`) and retried on `online`, on app start and when the app
returns to the foreground (`visibilitychange`). Submit waits for the job and its
photos only. The condition video (up to 90MB) follows as its own queue entry
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
