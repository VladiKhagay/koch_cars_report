-- ===========================================================================
-- 0009 — "may this caller attach a photo to this job?", as one question
--
-- worker/src/upload.ts authorized a photo upload by asking Supabase whether
-- the caller could SELECT the job. That is the wrong question. Since 0003 a
-- worker can select their own jobs forever, while the 15-minute edit window
-- lives on the WRITE policies — jobs_update and photos_insert both require
-- `locked_at > now()` for the worker role.
--
-- So the two halves of a single operation disagreed. Posting a photo to R2
-- succeeded on a job locked weeks ago; inserting the matching `photos` row
-- did not. Because the object key is derived from job id + kind, and the
-- viewer fetches by kind rather than through the photos table, the write that
-- got through is the one everybody sees: a worker could silently replace the
-- plate or VIN photograph on any of their own past jobs, long after the record
-- it evidences was frozen.
--
-- The lock cannot be expressed in the Worker's existing PostgREST probe — RLS
-- decides whether a row may be *written*, and there is no read-shaped way to
-- ask that. Same shape of problem as find_recent_duplicate (0003): the caller
-- must learn one fact about a row without being handed the row. Same solution.
--
-- Deliberately mirrors `photos_insert` rather than `jobs_update`: this
-- authorizes the R2 half of exactly the operation that policy governs, and the
-- two must not drift. In particular the worker branch checks `locked_at` and
-- not `deleted_at`, because photos_insert does not either — a manager
-- restoring a soft-deleted job is a supported flow and must not be blocked
-- here on a rule the database itself does not apply.
--
-- current_app_user() filters `active = true`, so a deactivated account also
-- fails this check even while its JWT is still signature-valid.
-- ===========================================================================

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
           or (u.role = 'worker' and u.id = j.worker_id and j.locked_at > now()))
  );
$$;

revoke all on function can_write_job(uuid) from public;
grant execute on function can_write_job(uuid) to authenticated;
