# Early video upload (brief, confirmed by user)

**Goal:** cut the time workers must keep the app open after recording a condition video, and make resume-on-reopen faster, without lowering video quality.

## Decisions (grilled)
- Upload starts **while recording**, once the first full piece is buffered (retake waste accepted).
- Applies to **New Job form and existing-job media screen** (JobMedia).
- **Draft persistence:** pre-assigned job ID + upload progress saved with the form draft; upload continues on other app screens while the app is open.
- **App dies mid-recording:** clip lost as today; orphan pieces expire (R2 7-day rule). No salvage.
- **Pre-job authorization, light rule:** active worker may start/send pieces for a job id that does not exist yet; complete still needs `can_write_photo` on a real job. No reservation table. Security-reviewer must check.
- **UI:** status line under the clip ("Uploading… N%" / "Uploaded"); Submit never waits.
- **Measurement:** Worker-side logging per piece (size, speed) and Stop→complete time. No new table.

## Requirements
1. Early upload during recording (New Job + existing-job screen).
2. New Job: client pre-assigns job ID; `create_job` accepts it (new p_id). Use a SEPARATE payload field: `payload.jobId` already means "row exists" in submitJob.
3. ID + progress saved with the draft; resumes after reload / screen switch.
4. On Submit, in-progress upload state handed to the existing queue (`submitVideo(jobId, blob, {upload})`); Submit never waits on video.
5. Retake / discard / cleared form aborts the upload best-effort; leftovers expire.
6. App death mid-recording: clip lost (as today).
7. Worker: /video/start and /video/part allowed for active worker when no job row with that id exists; /video/complete keeps can_write_photo.
8. Resume fixes: progress-based stall timeout (replace fixed 180s PIECE_TIMEOUT_MS), 5 MiB parts, 2–3 parallel parts, move the "video row exists" check to just before complete.
9. Status line UI under the clip.
10. Worker logs: piece size/speed (client timing header) and Stop→complete seconds, via existing Workers Logs.
11. Offline or old Worker → fall back to today's behaviour with no error.

## Out of scope
Native app, lower quality/codec changes, salvaging partial recordings, Background Fetch, reservation table.

## Acceptance criteria
- AC-1: Connection >= recording bitrate: video finished within ~15 s of tapping Stop (manual phone test).
- AC-2: New Job after early upload = exactly one job + one playable video under the same key as today.
- AC-3: Retake/discard/cleared form aborts the open upload; no video row for an abandoned draft.
- AC-4: Reload mid-upload resumes from last finished piece, not zero.
- AC-5: Worker cannot start/send pieces for an existing job it cannot write to, and cannot complete without its own real job (Worker tests).
- AC-6: create_job with client id is idempotent: retry with same id never creates a second job.
- AC-7: Stalled piece retried within ~30 s of upload progress stopping.
- AC-8: Old queued uploads (8 MiB pieces) still finish after deploy.
- AC-9: Offline recording or old Worker falls back to today's queue behaviour, no error shown.
- AC-10: Worker logs show piece throughput and Stop→complete time.
- AC-11: All web + worker checks pass; CONTEXT.md and SECURITY-NOTES.md updated.

## Reserved for user approval
Applying the migration to the real Supabase DB; deploying Worker/web.

## Facts found in research
- NewJob draft saves form incl. video blob to IndexedDB every 400 ms (draft.ts, 12 h TTL).
- create_job (0033) is `security invoker`, id comes from DB default; returns uuid.
- can_write_photo (0035) needs an existing jobs row. objectKey(video) = `video/${jobId}`.
- R2: parts >= 5 MiB, all but last equal size, parallel/any-order OK, incomplete uploads abort after 7 days by default.
- Resume state lives in localStorage (queueStore.putUpload/getUpload), keyed by queuedId.
- sendVideoPieces is strictly sequential; PIECE_TIMEOUT_MS = 180_000 (workerApi.ts:240); VIDEO_PART_BYTES = 8 MiB mirrored in web/src/lib/video.ts and worker/src/upload.ts.
- UPLOAD_LIMITER 150/min, VIDEO_START_LIMITER 10/min (wrangler.toml).
- Deploy order matters (web and Worker deploy separately; 404 fallback exists for old Worker).
