# Resumable chunked video upload to R2

Goal: an interrupted video upload (locked screen, lost signal, closed app) continues from the last finished piece instead of restarting from zero. Builds on the committed deferred-video queue (commit e223b47, branch deferred-video-upload; migration 0031 NOT applied anywhere). Work on branch resumable-video-upload.

Decisions (user): only the video is resumable (photos keep single-request /upload); percentage shown while a video uploads (My Jobs + phone header).
Defaults: Worker runs R2 multipart via the existing PHOTOS binding (no creds/signed URLs to the client); all endpoints POST (CORS allows only GET/POST/OPTIONS); 8 MiB pieces, sequential; queue entry stores uploadId + each finished piece's etag in IndexedDB (survives app close); if R2 dropped the upload, restart that video from zero automatically; Worker derives the R2 key from jobId+kind (client never supplies it); every call (start, piece, complete, abort) checked with can_write_photo; sniff the first piece's head for MP4/MOV/WebM; at complete check the real stored size against 75 MB and delete the object if over; existing UPLOAD_LIMITER; submitVideo semantics kept (skip if row exists; write photos row only after the upload completes); no migration expected; no new dependencies; recorder stays 1080p/4 Mbps.
Out of scope: resumable photos, parallel pieces, native app, background upload with app closed, retention change.

AC-1 video uploads via start/piece/complete endpoints; final object is the same as today (video/{jobId}, sniffed video/mp4).
AC-2 interrupting and resuming (same session or after reopening the app) sends only unfinished pieces.
AC-3 if R2 no longer has the upload, restart that video from zero and still land it with no duplicate job or video row.
AC-4 every Worker call checks can_write_photo; a user without write permission, or using another job's upload id, is refused.
AC-5 oversized or non-video refused (and an oversized stored object deleted).
AC-6 percentage shown in My Jobs and header, advancing as pieces finish.
AC-7 queue entries from the current version (video queued, no upload state) still upload correctly.
AC-8 failure handling unchanged: 5 attempts / 24h, no attempt counted when the page was hidden, Retry and Discard work.
AC-9 tests cover Worker endpoints, piece bookkeeping + resume logic, expiry fallback, authorization failures; web and worker checks pass.

## Plan decisions (lead)
- Start carries piece 1 (Worker sniffs it, createMultipartUpload with sniffed contentType, uploadPart(1)); endpoints POST /video/start, /video/part, /video/complete, /video/abort; key always objectKey(jobId,'video'); 8 MiB pieces (VIDEO_PART_BYTES), MAX_VIDEO_PARTS = ceil(75MiB/8MiB) = 10; pieces buffered on the Worker (readCapped), no FixedLengthStream; R2 errors 10024/10025/10048/10011 -> 410 {error:'upload_gone'}; complete is idempotent via head(); over-size at complete -> delete + 413.
- Client resume state in localStorage `video-upload:<queuedId>` behind the queueStore seam (not on the IDB entry: recordFailure re-puts a stale entry and re-writing 60MB per piece is slow); a failed write only loses resume.
- 404 from /video/start => fall back to the existing single-request uploadPhoto (Worker/web deploy in parallel; ponytail: remove later).
- A run that landed at least one NEW piece does not count as a failed attempt (poor links must not burn the 5 attempts while progressing; still bounded by the 24h age limit and 7-day window). This is a deliberate refinement of AC-8.
- User-side later (NOT for the builder): read-only lifecycle check; one live R2 check for AC-4 (uploadId under another job's key); merge/deploy. Claim AC-4 as unverified-live until then.
