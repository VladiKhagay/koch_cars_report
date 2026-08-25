-- ===========================================================================
-- 0014 — a worker may always finish an incomplete job's photos
--
-- The 15-minute lock (`locked_at`) exists to stop a worker editing an old,
-- already-finished job — not to cap how long their FIRST upload is allowed to
-- take. But `photos_insert` (0001) and `can_write_job` (0009) both gate every
-- worker photo write on `locked_at > now()`, with no distinction between the
-- two. A job created offline gets `locked_at = created_at + 15min` stamped at
-- insert time; if the device doesn't reconnect within that window (a real
-- case in a yard with weak signal, not an edge case), every retried photo
-- upload comes back 403 forever. The job row exists with zero photos,
-- indistinguishable from "no photo was ever taken" — this already happened in
-- production once (see the 0005-cutover note in diagnose_missing_photos.sql,
-- a different cause but the same symptom).
--
-- Fix: a worker may write photos to their own job when EITHER the lock is
-- still open, OR the job has no photos at all yet. Zero photos is exactly the
-- state a stuck offline job is stuck in — the client always uploads every
-- captured photo in a single batch insert at the end of submitJob (see
-- web/src/lib/jobs.ts), so "some, but not all, photos landed" isn't a state
-- the client itself produces. A job that has any photos is treated as
-- finished and falls back to the ordinary lock.
--
-- This does not reopen editing of jobs.* fields (plate/vin/note/etc) or
-- job_services — those keep the ordinary 15-minute window unchanged. Only the
-- photo-upload path is affected, and only for a job with zero photos.
--
-- Mirrors `photos_insert` <-> `can_write_job` exactly, as 0009 requires: the
-- Worker's /upload endpoint authorizes the R2 write through can_write_job,
-- PostgREST authorizes the `photos` row insert through photos_insert, and the
-- two must never drift from each other.
-- ===========================================================================

begin;

create or replace function can_write_job(p_job_id uuid)
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
                    or not exists (select 1 from photos p where p.job_id = j.id))))
  );
$$;

drop policy photos_insert on photos;
create policy photos_insert on photos for insert
  with check (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = photos.job_id
      and (u.role = 'admin'
           or (u.role = 'manager' and u.site_id = j.site_id)
           or (u.role = 'worker' and u.id = j.worker_id
               and (j.locked_at > now()
                    or not exists (select 1 from photos p2 where p2.job_id = j.id))))
  ));

commit;
