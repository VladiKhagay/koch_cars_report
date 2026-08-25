-- ===========================================================================
-- 0015 — job_health_check: a read-only view for finding stuck jobs
--
-- The single maintainer here has no server-side visibility into the offline
-- queue (it lives in each worker's browser IndexedDB) or into which jobs the
-- 0014 fix is actually covering for. This view gives a manager/admin one
-- place to look instead of hand-rolling the query every time (as
-- diagnose_missing_photos.sql already had to).
--
-- security_invoker = true: the view runs with the querying user's own RLS,
-- not the view owner's — so a manager sees only their site's jobs, same as
-- querying `jobs` directly. No new privilege is granted here.
-- ===========================================================================

create view job_health_check as
  select
    j.id,
    j.site_id,
    j.worker_id,
    j.plate,
    j.created_at,
    j.locked_at,
    j.deleted_at,
    coalesce(p.photo_count, 0) as photo_count,
    (coalesce(p.photo_count, 0) = 0)                          as no_photos,
    (j.locked_at <= now() and coalesce(p.photo_count, 0) = 0) as lock_expired
  from jobs j
    left join lateral (
      select count(*) as photo_count from photos ph where ph.job_id = j.id
    ) p on true
  where j.deleted_at is null;

alter view job_health_check set (security_invoker = true);
