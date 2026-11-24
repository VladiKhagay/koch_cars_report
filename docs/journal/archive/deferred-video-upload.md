# Deferred video upload (recorder-only)

Goal: Submit no longer waits for the video. Job + photos go up as today; the video uploads afterwards in the background (own queue entry) so the worker can start the next car.

Decisions: job visible to managers before video arrives; if video never arrives the job stays without it, worker sees "failed" with Retry/Discard, clip stays on phone until uploaded or discarded; Submit still waits for job+photos exactly as today; video status shown via existing queue indicator (every worker screen) + queued section of My Jobs.
Defaults: recorder stays 1080p/4 Mbps, no compression/gallery; video is its own queue entry linked to its job, existing limits (5 attempts / 24h) then "failed"; wake lock while a video upload runs + queue retries on foreground (visibilitychange), not only 'online'; old queue entries (video inside the job payload) must still flush; mobile data allowed; no DB/Worker change expected (confirm in plan).
Out of scope: compression, gallery pick, true background upload (iOS impossible), retention change.

AC-1 After Submit with a video: "submitted" once job+photos are in; form ready for next car without waiting for video.
AC-2 Video uploads as its own queued item; the photos row for it is written only when the upload succeeds.
AC-3 While pending, queue indicator + My Jobs show its state (uploading / waiting / failed). Managers see the job without a video until it lands.
AC-4 Failed video shows Retry and Discard; Retry re-sends, Discard removes it from the phone.
AC-5 Wake lock held during video uploads; queue retries when the app returns to foreground.
AC-6 Upload interrupted by a locked screen recovers without a duplicate job or duplicate video row.
AC-7 Queue entries from the current version (video inside the job) still flush correctly.
AC-8 Tests cover new queue behaviour + failure/retry paths; web and worker checks pass.

## Update after planning (user-approved)
- DB change IS needed (planner finding, verified): can_write_job (0014) lets a worker add photos only within 15 min of job creation or while the job has no photos. A deferred video would be refused after 15 min. User APPROVED migration 0031: new `can_write_photo(p_job_id, p_kind)`; for workers additionally allows kind='video' on their own, non-deleted job, only while no video row exists, and only within 7 DAYS of job creation. `photos_insert` calls it; `can_write_job` stays unchanged. Worker /upload calls can_write_photo with p_kind. DO NOT apply the migration to production (or any real DB) without asking the user. Deploy order when approved: migration -> Worker -> web.
- Extra ACs: AC-1a quota failure on queueing the video -> upload inline, else `newJob.videoNotSaved` and job not duplicated; AC-3a a video never blocks a queued job; AC-4a Retry on >24h-old entry resets the age clock, Discard asks for confirmation; AC-5a a failure while page hidden does not count toward the 5 attempts; AC-6a rerun after photos row exists finishes without re-uploading; AC-7a legacy entry {jobId, videoBlob} becomes a video entry and lands; AC-9 Worker sends p_kind and policy/Worker agree through can_write_photo.
- No new dependencies (fake-indexeddb NOT approved): keep the persistence calls behind a small replaceable seam so vitest can substitute an in-memory store.
