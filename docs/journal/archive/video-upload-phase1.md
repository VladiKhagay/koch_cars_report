# Video upload speed-up — Phase 1 (brief, user-approved scope)

Phase 2 (early upload during recording, pre-assigned job id, migration 0040, pre-job auth, draft persistence) is explicitly SHELVED. Full plan lives in early-video-upload.md; do NOT build any of it. No migration, no authorization change, no new endpoint, no UI.

**Goal:** shorten the time a worker must keep the app open for the condition-video upload, and make resume after reopen faster, with no quality change. Measure with Worker logs.

## Requirements
1. **Stall timeout based on upload progress**, replacing the fixed 180 s PIECE_TIMEOUT_MS for /video/start and /video/part: send these via XMLHttpRequest, reset a ~30 s idle timer on every `xhr.upload.onprogress`; keep timer through `loadend` so a hung response is caught; external AbortSignal -> `xhr.abort()`; non-2xx -> HttpError (same shape as today so isPermanentError/isRateLimited/410 logic is unchanged); timeout/network error -> plain transient Error. /video/complete and /video/abort stay on fetch (complete gets a fixed 60 s timeout). PIECE_TIMEOUT_MS stays only for the legacy single-request `uploadPhoto` 404 fallback.
2. **5 MiB pieces** for new uploads (R2 minimum). `VIDEO_PART_BYTES` (web) = 5 MiB. Worker keeps accepting up to 8 MiB per piece so old 8 MiB clients still work.
3. **Part limit:** Worker MAX_VIDEO_PARTS must cover 90 MB / 5 MiB = 18 (currently 12 = ceil(90/8)); enforced in part handler and `parseParts`.
4. **Complete's idempotency recovery check** (videoUpload.ts ~199-200) no longer hardcodes 8 MiB: size must be in ((n-1)*5MiB, n*8MiB] (keep the `-n` etag check and MAX_VIDEO_BYTES bound).
5. **AC-8 compat:** saved resume state with partSize 8 MiB (queued before deploy) must still resume, not restart. `resumable` accepts partSize in {5 MiB, 8 MiB}; `sendVideoPieces` slices with `state.partSize`, not the constant.
6. **Parallel pieces:** after start (piece 1), send the remaining pieces with 3 concurrent lanes. `VideoUpload.parts` may become sparse while pieces are in flight: keep it sorted, validate in `resumable` (unique integer partNumbers within 1..ceil(size/partSize), part 1 present, etags strings). Each lane merges its result into ONE live state object and calls `save` (never a stale copy). First error: other lanes finish their current piece, error rethrown. Progress (`setProgress`) must not overstate when parts are sparse (count parts landed).
7. **Move the "video row exists" check:** when resuming with saved state, check just before `complete` (if the row exists, best-effort abort and return without writing a row); when starting from zero (no saved state) keep the check up front.
8. **Worker logging** (existing Workers Logs): per piece `console.log(JSON.stringify({evt:'video_piece', part, bytes, readMs, kbps}))` timed around the body read; on complete `{evt:'video_complete', parts, bytes, uploadMs}` where `uploadMs` is an optional client-supplied query param `/^\d{1,9}$/` (ms from first piece start to complete), only ever logged, otherwise omitted. No uploadId, no JWT, no personal data. Client adds the param.
9. Update the wrangler.toml limiter comment (~15-18 pieces per clip) and docs: CONTEXT.md (piece size / upload flow), SECURITY-NOTES.md §4 (5/8 MiB check, part limit 18, stall timeout).

## Constraints
- Quality, bitrate, recorder, queue semantics, Supabase schema, auth/RLS: untouched.
- Rate limits: UPLOAD_LIMITER 150/min must still be fine (a clip ~19 requests).
- Deploy order: Worker before web (new web with 5 MiB pieces needs Worker limit 18). Not deploying: reserved for user approval.
- Web and Worker packages mirror constants (video.ts <-> upload.ts): keep them consistent and comment it.

## Acceptance criteria
- AC-1: A stalled piece (no upload progress for 30 s) is aborted and retried; a slow-but-progressing piece is NOT aborted (fake-XHR test).
- AC-2: 3 pieces in flight at once; final state lists all parts in order; complete receives them sorted (test).
- AC-3: A 75 MB clip = 15 parts uploads end to end through the Worker tests (parts 2..15 accepted, part 19 rejected 400).
- AC-4: Saved 8 MiB-piece state resumes from the correct next piece and completes (test); saved 5 MiB sparse state sends only missing parts (test).
- AC-5: Resume path: row-exists check happens before complete not before sending; from-zero path unchanged (test).
- AC-6: Worker complete recovery accepts both 5 MiB and 8 MiB totals; rejects sizes outside the range (test).
- AC-7: Worker logs video_piece and video_complete lines with the specified fields; bad `uploadMs` is omitted (test).
- AC-8: Existing error handling intact: 410 restart once, 429 not retried in-run, permanent errors flagged, abort signal respected, save(null) semantics.
- AC-9: All checks pass: `cd web && npm test && npm run lint && npx tsc -b`; `cd worker && npm test && npm run typecheck`. Docs updated.

## Reserved for user approval
Any deploy of Worker or web.
