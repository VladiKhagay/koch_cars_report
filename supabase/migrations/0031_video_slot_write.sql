-- ===========================================================================
-- 0031 — the condition video may land after the photos
--
-- 0014 let a worker write photos to their own job while the 15-minute lock is
-- open OR while the job has no photos at all, on the assumption that the
-- client uploads every slot in one batch at the end of submitJob, so "some,
-- but not all, landed" is not a state the client produces. The deferred video
-- upload breaks exactly that assumption on purpose: Submit now finishes once
-- the job and its photos are in, and the video (up to 75MB on yard signal)
-- follows from its own offline-queue entry. After 15 minutes the job has
-- photos and its lock is closed, so can_write_job refuses the video forever
-- and the clip would sit on the phone as "failed" with nowhere to go.
--
-- Fix: `can_write_photo(job, kind)`. For a worker's own job:
--
--   * plate/VIN/extra photos: exactly the 0014 rule (lock open, or the job has
--     no photo rows yet), so a finished job's evidence photographs still
--     cannot be replaced;
--   * the video: ONLY while the 15-minute lock is open, or through the bounded
--     video branch below. The 0014 "no photo rows yet" branch does not apply
--     to the video: without that, a job with zero photos (plate/VIN photos
--     are optional) would stay video-writable at any age, even soft-deleted.
--     A job with no photos and a video still works: its video goes through
--     the bounded branch like any other.
--
-- The bounded video branch:
--   * the job is not soft-deleted;
--   * no video row exists yet — once the row is recorded the slot is closed
--     to the worker (R2 key is job id + kind). Two exceptions, accepted: inside
--     the 15-minute lock the clip can be overwritten (as any photo can), and
--     the check runs before the up-to-75MB R2 put, so a hand-crafted upload
--     racing the real one (before the row lands) can overwrite it;
--   * within 7 days of the job's created_at. created_at is stamped by the
--     server for workers (0021), so the window cannot be stretched. 7 days
--     covers a phone that sits offline over a weekend plus the queue's own
--     retry budget, and stays well inside media retention (0025).
--
-- can_write_job itself is unchanged (jobs.* edits and anything else that
-- calls it keep their meaning), so the old Worker, which calls can_write_job,
-- keeps working exactly as before if it is still live; only photos_insert
-- moves to the new function. In that window the old Worker may store a clip
-- in R2 whose row photos_insert then refuses (video on a deleted or >7-day-old
-- job): at worst an orphan R2 object with no row. No row lands that
-- can_write_photo refuses, so nothing escalates. photos_insert switches to can_write_photo, and
-- the Worker's /upload calls the same function with the slot's kind, so the R2
-- write and the row insert go through the same rule, as 0009 requires,
-- checked at R2-put time and again at row insert.
--
-- Deploy order: this migration -> Worker (calls can_write_photo) -> web
-- (defers the video). A Worker before the migration 403s every upload (the
-- function is missing), and the queue flags those entries needsAttention.
-- Rollback in reverse: web -> Worker -> migration. Never drop can_write_photo
-- while the new Worker is live; can_write_job stays in place throughout.
-- ===========================================================================

begin;

create or replace function can_write_photo(p_job_id uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from jobs j
    join current_app_user() u on true
    where j.id = p_job_id
      and (u.role = 'admin'
           or (u.role = 'manager' and u.site_id = j.site_id)
           or (u.role = 'worker' and u.id = j.worker_id
               and (j.locked_at > now()
                    or (p_kind <> 'video'
                        and not exists (select 1 from photos p where p.job_id = j.id))
                    or (p_kind = 'video'
                        and j.deleted_at is null
                        and j.created_at > now() - interval '7 days'
                        and not exists (select 1 from photos p
                                        where p.job_id = j.id and p.kind = 'video')))))
  );
$$;

revoke all on function can_write_photo(uuid, text) from public;
revoke execute on function can_write_photo(uuid, text) from anon;
grant execute on function can_write_photo(uuid, text) to authenticated;

drop policy if exists photos_insert on photos;
create policy photos_insert on photos for insert
  with check (can_write_photo(photos.job_id, photos.kind));

commit;
