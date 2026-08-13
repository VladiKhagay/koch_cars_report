-- Why a job shows no photos. Read-only.
--
-- There are two very different causes and they need different answers, so this
-- splits today's jobs at the moment the fixed frontend went live
-- (2026-08-13 05:59:38 UTC — the Deploy Web run that shipped it).
--
--   BEFORE that: the deployed build still wrote to job_services, which 0005
--   dropped. It threw on that insert, which happens BEFORE the photo upload —
--   so those jobs never had photos. Nothing to recover; the images were never
--   sent anywhere. Expected, and these rows are what triage_post_0005.sql
--   cleans up.
--
--   AFTER that: a job with no photo rows is a live bug and worth chasing.

with boundary as (select timestamptz '2026-08-13 05:59:38+00' as deployed_at)
select
  case when j.created_at < b.deployed_at then 'before fix' else 'AFTER fix' end as window,
  count(*)                                                as jobs,
  count(*) filter (where j.service_id is null)            as no_service,
  count(*) filter (where p.n is null or p.n = 0)          as no_photo_rows,
  count(*) filter (where p.n > 0)                         as with_photo_rows
from jobs j
  cross join boundary b
  left join lateral (select count(*) as n from photos ph where ph.job_id = j.id) p on true
where j.created_at >= current_date - 1
  and j.deleted_at is null
group by 1
order by 1;

-- The individual jobs from today, newest first. `photo_kinds` is what actually
-- reached the database; an empty cell means the upload never ran.
select j.created_at,
       j.plate,
       u.name as worker,
       j.service_id is not null              as has_service,
       coalesce(
         (select string_agg(ph.kind, ', ' order by ph.kind) from photos ph where ph.job_id = j.id),
         '(none)'
       )                                     as photo_kinds,
       case when j.created_at < timestamptz '2026-08-13 05:59:38+00'
            then 'before fix' else 'AFTER fix' end as window
from jobs j
  left join users u on u.id = j.worker_id
where j.created_at >= current_date - 1
  and j.deleted_at is null
order by j.created_at desc
limit 50;

-- If anything shows up as 'AFTER fix' with '(none)', the upload is failing now.
-- Run this next to see whether the row exists but the object does not:
--   the r2_key column tells you exactly which object the Worker will look for.
select j.created_at, j.plate, ph.kind, ph.r2_key
from jobs j join photos ph on ph.job_id = j.id
where j.created_at >= timestamptz '2026-08-13 05:59:38+00'
order by j.created_at desc, ph.kind
limit 30;
