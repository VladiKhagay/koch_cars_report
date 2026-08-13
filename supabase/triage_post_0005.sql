-- Find the damage from running the pre-0005 frontend against the post-0005
-- schema. Read-only — nothing here changes a row.
--
-- The deployed build inserted the job, then inserted into job_services, which
-- no longer exists. It threw before uploading photos and re-queued itself, so
-- each affected car left one or more rows with: no service, no photos.

-- 1. How bad is it, and since when?
select count(*)                       as broken_jobs,
       count(distinct vin)            as distinct_cars,
       min(created_at)                as first_seen,
       max(created_at)                as last_seen
from jobs j
where j.deleted_at is null
  and j.service_id is null
  and not exists (select 1 from photos p where p.job_id = j.id);

-- 2. The rows themselves, newest first. Repeats of the same VIN within minutes
--    are the retry loop, not a worker logging the same car twice.
select j.created_at,
       j.plate,
       j.vin,
       u.name as worker,
       s.name as site,
       j.duplicate_of_job_id is not null as already_flagged
from jobs j
  left join users u on u.id = j.worker_id
  left join sites s on s.id = j.site_id
where j.deleted_at is null
  and j.service_id is null
  and not exists (select 1 from photos p where p.job_id = j.id)
order by j.created_at desc;

-- 3. Which of these are duplicates of each other — i.e. safe to delete down to
--    one row per car. `keep` is the earliest attempt for that VIN.
select vin,
       count(*)          as rows_for_this_vin,
       min(created_at)   as keep,
       max(created_at)   as newest
from jobs j
where j.deleted_at is null
  and j.service_id is null
  and not exists (select 1 from photos p where p.job_id = j.id)
group by vin
having count(*) > 1
order by count(*) desc;

-- ---------------------------------------------------------------------------
-- Cleanup, when you have looked at the above and want it gone.
--
-- Soft delete only: these rows leave exports and the day's list but stay
-- restorable, which is the same treatment a manager's own delete gets. Run it
-- AFTER the new frontend is deployed, so nothing is still creating more.
--
-- Deliberately not wrapped in a transaction you might run by accident —
-- uncomment when you mean it.
-- ---------------------------------------------------------------------------

-- update jobs j
-- set deleted_at = now()
-- where j.deleted_at is null
--   and j.service_id is null
--   and not exists (select 1 from photos p where p.job_id = j.id);
