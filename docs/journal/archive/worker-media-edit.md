# Worker media edit (within the 15-minute window)

Goal: a worker can add / replace / remove photos and video on THEIR OWN submitted job while the 15-minute lock is open (jobs.locked_at > now()), in the worker's job view (MyJobs).

Decisions (grilled, confirmed)
- Extra photos 1-3 and video: add, replace, remove.
- Plate and VIN photos: replace only, never removed by a worker (DB-enforced, not just UI).
- Remove = tombstone (photos.removed_at), same as manager (0034). Never a DELETE policy.
- Worker changes are NOT audited / not in Edit history. No audit trigger changes for worker callers.
- Window = locked_at > now() and job not deleted, own job (worker_id = auth user). After the window: worker rules as today (first-photo-if-none, deferred video add within 7 days if none), except can_write_photo now refuses a deleted job in every worker branch (review fix).
- Existing manager/admin behaviour (0034) unchanged.

Constraints
- DB enforces authz (RLS + trigger). photos_update today has NO worker branch; adding one must not let a worker move a row's identity (photos_guard_update pins id/job_id/kind/r2_key/created_at) or touch removed_at on plate/vin, or un-delete outside the window, or edit others' jobs, or deleted jobs.
- Worker upload endpoints (`/upload`, `/video/*`) call can_write_photo; replace of an existing slot within the window already passes (locked_at > now()). Check the Worker's replace path for plate/vin/extra and video.
- can_view_photo (0034) hides tombstoned slots; keep.
- Mixed-version: new migration numbered 0035; deploy order migration -> Worker (if changed) -> web; rollback web -> Worker -> migration.
- Reuse web/src/components/JobMedia.tsx editable mode and lib/jobs.ts setMedia/removeMedia. Workers must not see audit/history UI. i18n en/ru/he parity. UI follows ui-ux-pro-max rules: 44px targets, one primary action, clear state, window countdown already exists in MyJobs.

Out of scope: audit for workers, manager UI, extending the window, hard-deleting R2 objects.

AC
1. Worker, own job, window open: can add/replace/remove extra_1..3 and video; can replace (not remove) plate and VIN. DB-enforced.
2. Worker cannot remove plate/VIN; cannot edit after window closes (beyond today's rules); cannot touch another worker's job, a deleted job, or change a row's identity.
3. MyJobs shows manage-media UI only while the window is open; removed slot shows empty; failures surface to the worker; zero-row RLS no-ops treated as errors.
4. Manager/admin behaviour unchanged.
5. Tests + checks green, CONTEXT.md/SECURITY-NOTES.md updated, i18n en/ru/he.
