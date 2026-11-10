-- ===========================================================================
-- 0035 — a worker edits their own job's media while the 15-minute window is open
--
-- Inside the window (jobs.locked_at > now(), job not soft-deleted, the caller
-- is the job's submitter — never a co-worker) a worker may now add, replace
-- and remove extra_1..3 and the video, and replace (never remove) the plate
-- and VIN photos. After the window, worker rules are as 0031 (first photos
-- while the job has none, the deferred video within 7 days while it has
-- none), except that a deleted job is now refused in every worker branch.
-- Managers/admins: unchanged (0034).
--
-- What changes:
--
--   * photos_update     a third branch: the worker, own job, window open, job
--                       not deleted. WITH CHECK additionally refuses a plate or
--                       VIN row that ends up tombstoned, so "remove" (removed_at
--                       set) is refused for those two kinds at the database.
--                       photos_guard_update (0034, BEFORE trigger) still pins
--                       id/job/kind/R2 key/created_at and server-stamps
--                       removed_at; WITH CHECK sees the row after it. Still no
--                       DELETE policy: removal is the tombstone.
--   * photos_insert     also requires removed_at is null: nobody inserts an
--                       already-removed row (a worker could otherwise insert a
--                       tombstoned plate/VIN, which reads as "removed").
--   * can_write_photo   the worker's window branch (locked_at > now()) and its
--                       "no photo rows yet" branch also require the job not
--                       to be soft-deleted (the bounded video branch already
--                       did), so the Worker's /upload and /video/* refuse R2
--                       writes to a deleted job in every worker branch.
--                       Workers cannot soft-delete (jobs_guard_worker_columns
--                       pins deleted_at): this covers a manager deleting the
--                       job while the worker's window is still open.
--                       Managers/admins: unchanged (they may restore).
--
-- Not changed: photos_guard_update, photos_audit (worker callers write no
-- audit rows, as in 0034), can_view_photo, photos_select.
--
-- Contract for the web (same statements as 0034):
--
--   replace / add / re-add   upsert on (job_id, kind) without ignoreDuplicates,
--                            removed_at: null. Postgres checks photos_insert's
--                            WITH CHECK on the proposed row even when the
--                            ON CONFLICT update path is taken, so a worker's
--                            upsert must pass can_write_photo (true inside the
--                            window) and removed_at is null (the web sends null).
--                            The update path then needs photos_update.
--   remove                   UPDATE photos SET removed_at = now(); zero rows
--                            back means refused (window closed, plate/VIN make
--                            it a 42501 error instead).
--
-- Deploy order: 0035 -> web. No Worker change (/upload and /video/* already ask
-- can_write_photo with the slot's kind). The old web never sends a worker
-- update, so 0035 alone changes nothing visible except that a worker's upload
-- to a soft-deleted job (deleted by a manager) is now refused.
-- Rollback in reverse: web -> 0035 down (below), which restores the 0034
-- photos_update, the 0031 photos_insert and the 0031 can_write_photo.
--
-- Down (run in one transaction):
--
--   begin;
--   drop policy if exists photos_update on photos;
--   create policy photos_update on photos for update
--     using (exists (
--       select 1 from jobs j
--       join current_app_user() u on true
--       where j.id = photos.job_id
--         and (u.role = 'admin' or (u.role = 'manager' and u.site_id = j.site_id))
--     ))
--     with check (exists (
--       select 1 from jobs j
--       join current_app_user() u on true
--       where j.id = photos.job_id
--         and (u.role = 'admin' or (u.role = 'manager' and u.site_id = j.site_id))
--     ));
--   drop policy if exists photos_insert on photos;
--   create policy photos_insert on photos for insert
--     with check (can_write_photo(photos.job_id, photos.kind));
--   -- can_write_photo exactly as 0031 left it:
--   create or replace function can_write_photo(p_job_id uuid, p_kind text)
--   returns boolean
--   language sql
--   stable
--   security definer
--   set search_path = public
--   as $$
--     select exists (
--       select 1
--       from jobs j
--       join current_app_user() u on true
--       where j.id = p_job_id
--         and (u.role = 'admin'
--              or (u.role = 'manager' and u.site_id = j.site_id)
--              or (u.role = 'worker' and u.id = j.worker_id
--                  and (j.locked_at > now()
--                       or (p_kind <> 'video'
--                           and not exists (select 1 from photos p where p.job_id = j.id))
--                       or (p_kind = 'video'
--                           and j.deleted_at is null
--                           and j.created_at > now() - interval '7 days'
--                           and not exists (select 1 from photos p
--                                           where p.job_id = j.id and p.kind = 'video')))))
--     );
--   $$;
--   revoke all on function can_write_photo(uuid, text) from public;
--   revoke execute on function can_write_photo(uuid, text) from anon;
--   grant execute on function can_write_photo(uuid, text) to authenticated;
--   commit;
--
-- Apply after 0034. One transaction. Check with supabase/verify_0035.sql.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. photos_update: admin, manager at the job's site, or the job's own worker
--    while its window is open. worker_id only: a co-worker never edits.
-- ---------------------------------------------------------------------------

drop policy if exists photos_update on photos;
create policy photos_update on photos for update
  using (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = photos.job_id
      and (u.role = 'admin'
           or (u.role = 'manager' and u.site_id = j.site_id)
           or (u.role = 'worker' and u.id = j.worker_id
               and j.locked_at > now() and j.deleted_at is null))
  ))
  with check (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = photos.job_id
      and (u.role = 'admin'
           or (u.role = 'manager' and u.site_id = j.site_id)
           or (u.role = 'worker' and u.id = j.worker_id
               and j.locked_at > now() and j.deleted_at is null
               -- plate and VIN are evidence: a worker replaces them, never removes.
               and (photos.removed_at is null or photos.kind not in ('plate', 'vin'))))
  ));

-- ---------------------------------------------------------------------------
-- 2. photos_insert: never an already-removed row
-- ---------------------------------------------------------------------------

drop policy if exists photos_insert on photos;
create policy photos_insert on photos for insert
  with check (can_write_photo(photos.job_id, photos.kind) and photos.removed_at is null);

-- ---------------------------------------------------------------------------
-- 3. can_write_photo: as 0031, every worker branch needs a live job
-- ---------------------------------------------------------------------------

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
               and ((j.locked_at > now() and j.deleted_at is null)
                    or (p_kind <> 'video'
                        and j.deleted_at is null
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

commit;
