-- Per-service worker pricing, one-service-per-job, configurable customer
-- report columns, and extra photo slots.
--
-- READ BEFORE RUNNING — this migration is destructive.
--
-- `job_services` is a many-to-many table: a job can currently carry several
-- services. Collapsing to one service per job means every job that has more
-- than one KEEPS ONLY ONE and loses the rest. The pick is deterministic
-- (lowest sort_order) but it is still a lossy, irreversible change to billing
-- history. Check the damage first:
--
--   select count(*) from (
--     select job_id from job_services group by job_id having count(*) > 1
--   ) x;
--
-- The old rows are copied to job_services_archive_0005 (RLS on, no policies,
-- so it is unreachable through the API) before the table is dropped. Drop
-- that archive once the exports have been verified against real data.

begin;

-- ---------------------------------------------------------------------------
-- 1. Pricing on the service catalog
-- ---------------------------------------------------------------------------

alter table services
  add column worker_price numeric not null default 0
    check (worker_price >= 0);

-- ---------------------------------------------------------------------------
-- 2. One service per job, with the price snapshotted onto the job
--
-- The price is duplicated onto `jobs` on purpose: it is what the worker was
-- owed for THAT job. Re-pricing a service next month must not silently rewrite
-- what last month's exports said.
-- ---------------------------------------------------------------------------

alter table jobs
  add column service_id uuid references services (id),
  add column worker_price numeric not null default 0
    check (worker_price >= 0);

-- Left nullable: jobs logged before this migration may have had no service at
-- all, and a NOT NULL here would fail on them.
create index jobs_service_id_idx on jobs (service_id);

-- ---------------------------------------------------------------------------
-- 3. Backfill from job_services before it goes away
--
-- Lowest sort_order wins — that is the order the service list is presented in,
-- so it is the closest thing to "the main job" the old data records.
-- ---------------------------------------------------------------------------

update jobs j
set service_id = pick.service_id
from (
  select distinct on (js.job_id) js.job_id, js.service_id
  from job_services js
  join services s on s.id = js.service_id
  order by js.job_id, s.sort_order, s.id
) pick
where pick.job_id = j.id;

update jobs j
set worker_price = s.worker_price
from services s
where s.id = j.service_id;

-- Keep the discarded links out of reach but not destroyed. RLS is enabled with
-- NO policies, which is what makes it invisible to PostgREST: a table without
-- RLS in the public schema is readable by every authenticated user.
create table job_services_archive_0005 as select * from job_services;
alter table job_services_archive_0005 enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Drop the dependent views, then the table
--
-- Explicit drops rather than `drop table ... cascade`: cascade would take the
-- views with it silently and leave the analytics screens querying relations
-- that no longer exist.
-- ---------------------------------------------------------------------------

drop view if exists job_service_stats;
drop view if exists job_daily_stats;

drop table job_services;   -- its RLS policies go with it

-- ---------------------------------------------------------------------------
-- 5. Recreate the views against jobs.service_id
--
-- Same column names and order as before, so existing `select *` callers keep
-- working; `worker_cost` is appended, not inserted.
--
-- Note the join is gone, so `job_count` now means what its name says. Under
-- job_services a job with three services counted three times in these views —
-- Analytics.tsx works around that by fetching a separate exact total. That
-- workaround is now unnecessary but harmless.
-- ---------------------------------------------------------------------------

create view job_service_stats as
  select
    site_id,
    service_id,
    date_trunc('month', created_at)::date as month,
    count(*) as job_count,
    sum(worker_price) as worker_cost
  from jobs
  where deleted_at is null
    and service_id is not null
  group by site_id, service_id, date_trunc('month', created_at);

alter view job_service_stats set (security_invoker = true);

create view job_daily_stats as
  select
    site_id,
    worker_id,
    service_id,
    date_trunc('day', created_at)::date as day,
    count(*) as job_count,
    sum(worker_price) as worker_cost
  from jobs
  where deleted_at is null
    and service_id is not null
  group by site_id, worker_id, service_id, date_trunc('day', created_at);

alter view job_daily_stats set (security_invoker = true);

-- job_monthly_stats (0002) never touched job_services and is left alone.

-- ---------------------------------------------------------------------------
-- 6. Worker view: expose the new columns
--
-- Still hides billing_code and manager_note. worker_price IS shown: it is the
-- worker's own pay for their own job. Remove it from this list if pay is meant
-- to be manager-only.
-- ---------------------------------------------------------------------------

drop view if exists jobs_worker_view;

create view jobs_worker_view as
  select id, site_id, worker_id, created_at, updated_at, plate, vin,
         vin_valid_checksum, brand, worker_note, locked_at,
         duplicate_of_job_id, deleted_at,
         service_id, worker_price
  from jobs;

alter view jobs_worker_view set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 7. Price integrity
--
-- RLS is row-level and cannot stop a worker from PATCHing worker_price on
-- their own job during the 15-minute edit window — without this trigger the
-- column is a self-service payroll form. Workers always get the catalog price;
-- managers and admins may override it (rework, disputes, agreed extras).
--
-- A null caller means there is no app user in context (service role, SQL
-- editor, the backfill above) — trusted, passed through untouched.
-- ---------------------------------------------------------------------------

create or replace function jobs_apply_worker_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
begin
  select * into caller from current_app_user();

  if caller is null or caller.role in ('manager', 'admin') then
    return new;
  end if;

  new.worker_price := coalesce(
    (select worker_price from services where id = new.service_id), 0
  );
  return new;
end;
$$;

create trigger jobs_apply_worker_price
  before insert or update of service_id, worker_price on jobs
  for each row execute function jobs_apply_worker_price();

-- ---------------------------------------------------------------------------
-- 8. Per-site customer report layout
--
-- Array order IS column order; `visible` toggles a column without losing its
-- position. Keys match the fields the export builds, not database columns, so
-- renaming a column later doesn't invalidate every site's saved config.
--
-- worker_price defaults to hidden: this is the sheet the customer sees, and
-- what the yard pays its own staff is not part of it.
--
-- `sites_write` (0001) stays admin-only. Managers reach this one column
-- through the RPC below instead — see the note there.
-- ---------------------------------------------------------------------------

alter table sites
  add column customer_report_config jsonb not null default '{
    "columns": [
      {"key": "date",         "label": "Date",                       "visible": true},
      {"key": "plate",        "label": "Vehicle registration number", "visible": true},
      {"key": "brand",        "label": "Vehicle brand",              "visible": true},
      {"key": "worker",       "label": "Employee name",              "visible": true},
      {"key": "service",      "label": "Work performed",             "visible": true},
      {"key": "worker_price", "label": "Price",                      "visible": false},
      {"key": "notes",        "label": "Notes",                      "visible": true},
      {"key": "billing_code", "label": "Customer billing code",      "visible": true}
    ]
  }'::jsonb;

-- ---------------------------------------------------------------------------
-- 8b. Report layout RPC
--
-- Managers must configure their own site's report without being able to touch
-- anything else on the row. A row-level UPDATE policy cannot express that —
-- it would also let a manager rename the site, and a site name is written into
-- every export and analytics screen. Same reasoning as update_my_name (0004):
-- when the rule is "this column, this row, nothing else", it belongs in a
-- security definer function.
--
-- Scope is the CALLER'S OWN site, admins included. An admin editing another
-- site's layout needs a separate admin path — deliberately not added here.
-- ---------------------------------------------------------------------------

create or replace function update_customer_report_config(new_config jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
begin
  select * into caller from current_app_user();

  if caller is null or caller.role not in ('manager', 'admin') then
    raise exception 'forbidden';
  end if;

  if caller.site_id is null then
    raise exception 'no site assigned';
  end if;

  -- The export renderer iterates columns[]. Anything without it would produce
  -- an empty spreadsheet at the far end of the month, so it is rejected here
  -- rather than discovered there.
  if jsonb_typeof(new_config) <> 'object'
     or jsonb_typeof(new_config -> 'columns') <> 'array' then
    raise exception 'invalid config: expected { "columns": [...] }';
  end if;

  update sites
  set customer_report_config = new_config
  where id = caller.site_id;
end;
$$;

revoke all on function update_customer_report_config(jsonb) from public;
grant execute on function update_customer_report_config(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Extra photo slots
--
-- The constraint was written inline in 0001, so Postgres named it
-- photos_kind_check. `if exists` keeps this re-runnable on a database where it
-- was already renamed or dropped by hand.
-- ---------------------------------------------------------------------------

alter table photos drop constraint if exists photos_kind_check;

alter table photos add constraint photos_kind_check
  check (kind in ('plate', 'vin', 'extra_1', 'extra_2', 'extra_3'));

commit;
