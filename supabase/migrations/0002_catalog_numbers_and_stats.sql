-- Service catalog numbers + analytics views.

-- ---------------------------------------------------------------------------
-- Catalog numbers: unique, admin-assigned per service.
-- ---------------------------------------------------------------------------

alter table services add column catalog_number text;

-- Backfill existing seed rows so the NOT NULL/UNIQUE constraints below can land.
update services
set catalog_number = 'SVC-' || lpad(row_number() over (order by sort_order)::text, 3, '0')
where catalog_number is null;

alter table services alter column catalog_number set not null;
alter table services add constraint services_catalog_number_key unique (catalog_number);

-- ---------------------------------------------------------------------------
-- Analytics views.
--
-- These are plain views with security_invoker so they inherit the exact same
-- RLS the frontend already relies on for the `jobs` table (jobs_select) —
-- there's no separate authorization story to maintain for analytics. They
-- aggregate in Postgres rather than shipping raw rows to the client, which
-- is the part that actually matters as the data grows past a few months.
-- ---------------------------------------------------------------------------

create view job_monthly_stats as
  select
    site_id,
    worker_id,
    date_trunc('month', created_at)::date as month,
    count(*) as job_count
  from jobs
  where deleted_at is null
  group by site_id, worker_id, date_trunc('month', created_at);

alter view job_monthly_stats set (security_invoker = true);

create view job_service_stats as
  select
    j.site_id,
    js.service_id,
    date_trunc('month', j.created_at)::date as month,
    count(*) as job_count
  from jobs j
  join job_services js on js.job_id = j.id
  where j.deleted_at is null
  group by j.site_id, js.service_id, date_trunc('month', j.created_at);

alter view job_service_stats set (security_invoker = true);
