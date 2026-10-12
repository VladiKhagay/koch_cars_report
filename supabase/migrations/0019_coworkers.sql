-- ===========================================================================
-- 0019 — co-workers on a job, cross-site jobs, and split pay
--
-- Some cars are prepped by more than one person. The submitter can now name up
-- to two co-workers, and the job's pay (`worker_price`) is split evenly across
-- everyone on it. A worker who helps at another yard can also log the job at
-- that yard rather than their own.
--
-- Rules agreed with the yard:
--   - Pay: each person gets worker_price / crew size, rounded down to the cent.
--     The submitter takes the leftover cent(s), so the shares always add up to
--     exactly the job price. 100 over 3 is 33.34 / 33.33 / 33.33.
--   - Counts: a shared job counts as ONE job for each person on it. Site-level
--     totals still count the car once (`car_count` below).
--   - Co-workers come from any site, must be active when added, at most two,
--     and never the submitter.
--   - Only the submitter edits during the 15-minute window (co-workers, site,
--     service, note). Co-workers can see the job and their share, nothing more.
--   - Managers edit jobs at their own site, admins any job — including the
--     crew, the submitter and the site. Shares are always recomputed from the
--     current crew, so a correction changes a re-run payment sheet.
--
-- The crew is an array on `jobs`, not a link table, on purpose: the job and its
-- crew are written in ONE insert, which keeps the offline retry path (submitJob
-- re-sends the same payload) exactly as idempotent as it already is, and the
-- existing jobs_update policy already governs who may change it. With a cap of
-- two there is nothing a join table would buy.
--
-- Apply after 0018.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The crew, and each person's share of the pay
--
-- The shares are generated columns so there is exactly ONE definition of the
-- split — the stats views, the payment sheet and the worker's own screens all
-- read these rather than each re-deriving the rounding.
-- (A generated column can't reference another, hence the repeated expression.)
-- ---------------------------------------------------------------------------

alter table jobs
  add column coworker_ids uuid[] not null default '{}';

alter table jobs
  add column coworker_share numeric generated always as (
    floor(worker_price * 100 / (1 + cardinality(coworker_ids))) / 100
  ) stored,
  add column submitter_share numeric generated always as (
    worker_price
      - floor(worker_price * 100 / (1 + cardinality(coworker_ids))) / 100 * cardinality(coworker_ids)
  ) stored;

comment on column jobs.coworker_ids is
  'Up to two users who worked the car with the submitter (worker_id). Pay is split evenly — see submitter_share / coworker_share.';

-- "Jobs I worked on" is worker_id = me OR me = any(coworker_ids).
create index jobs_coworker_ids_idx on jobs using gin (coworker_ids);

-- ---------------------------------------------------------------------------
-- 2. Crew integrity
--
-- The client enforces all of this too, but the column is reachable straight
-- through PostgREST. Duplicates and the submitter are dropped silently rather
-- than rejected: a manager who reassigns the job TO one of its co-workers
-- means "this person is now the submitter", not "error".
--
-- Only NEWLY added ids must be active: a co-worker deactivated after the job
-- was logged stays on it — Job Detail re-sends the crew on every save, and a
-- billing-code edit must not fail because a colleague has since left.
-- ---------------------------------------------------------------------------

create or replace function jobs_guard_coworkers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous uuid[] := '{}';
begin
  if tg_op = 'UPDATE' then
    previous := old.coworker_ids;
  end if;

  new.coworker_ids := array(
    select distinct x from unnest(coalesce(new.coworker_ids, '{}')) x
    where x is not null and x <> new.worker_id
  );

  if cardinality(new.coworker_ids) > 2 then
    raise exception 'a job can have at most 2 co-workers';
  end if;

  if exists (
    select 1 from unnest(new.coworker_ids) x
    where x <> all (previous)
      and not exists (select 1 from users u where u.id = x and u.active)
  ) then
    raise exception 'co-worker must be an active user';
  end if;

  return new;
end;
$$;

create trigger jobs_guard_coworkers
  before insert or update of coworker_ids, worker_id on jobs
  for each row execute function jobs_guard_coworkers();

-- ---------------------------------------------------------------------------
-- 3. Who may see a job
--
-- Adds: anyone on the crew. A co-worker sees the job in My Jobs and their
-- share in My Stats; photos follow (the Worker's /photo probe selects the job
-- with the caller's JWT). Also covers a worker who logged a job at another
-- site — the old worker branch already keyed on worker_id, not site.
-- ---------------------------------------------------------------------------

drop policy jobs_select on jobs;

create policy jobs_select on jobs for select
  using (
    exists (
      select 1 from current_app_user() u
      where u.role = 'admin'
         or (u.role = 'manager' and u.site_id = jobs.site_id)
         or u.id = jobs.worker_id
         or u.id = any (jobs.coworker_ids)
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Logging a job at any site
--
-- The submitter picks the site on the form; it defaults to their own. The only
-- rule left is that you submit as yourself.
-- ---------------------------------------------------------------------------

drop policy jobs_insert on jobs;

create policy jobs_insert on jobs for insert
  with check (
    exists (select 1 from current_app_user() u where u.id = jobs.worker_id)
  );

-- ---------------------------------------------------------------------------
-- 5. Moving a job to another site
--
-- USING is unchanged: a manager may only touch rows at their own site. The
-- manager's WITH CHECK drops the site match, so they can move one of their
-- jobs to the site it actually belongs to — which then takes it out of their
-- view, as intended. The worker branch already allowed any site.
-- ---------------------------------------------------------------------------

drop policy jobs_update on jobs;

create policy jobs_update on jobs for update
  using (
    exists (
      select 1 from current_app_user() u
      where u.role = 'admin'
         or (u.role = 'manager' and u.site_id = jobs.site_id)
         or (u.role = 'worker' and u.id = jobs.worker_id and jobs.locked_at > now() and jobs.deleted_at is null)
    )
  )
  with check (
    exists (
      select 1 from current_app_user() u
      where u.role in ('admin', 'manager')
         or (u.role = 'worker' and u.id = jobs.worker_id and jobs.locked_at > now())
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Photo rows follow job visibility
-- ---------------------------------------------------------------------------

drop policy photos_select on photos;

create policy photos_select on photos for select
  using (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = photos.job_id
      and (u.role = 'admin'
           or u.site_id = j.site_id
           or u.id = j.worker_id
           or u.id = any (j.coworker_ids))
  ));

-- ---------------------------------------------------------------------------
-- 7. Names across sites
--
-- A manager's grid now holds jobs logged by — or shared with — people from
-- other sites, and the `worker:users(...)` embed came back null for them. Staff
-- are one business (see the tenancy note in 0001), so managers read every user
-- row. Writes stay admin-only.
-- ---------------------------------------------------------------------------

drop policy users_select on users;

create policy users_select on users for select
  using (
    auth_id = auth.uid()
    or exists (select 1 from current_app_user() u where u.role in ('admin', 'manager'))
  );

-- Workers still can't read `users`. The co-worker picker and the "with Dana"
-- label get names through this instead: id, name, site and active — never
-- auth_id or role.
create or replace function list_staff()
returns table (id uuid, name text, site_id uuid, active boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select u.id from current_app_user() u) is null then
    raise exception 'forbidden';
  end if;

  return query
  select u.id, u.name, u.site_id, u.active from users u order by u.name;
end;
$$;

revoke all on function list_staff() from public, anon;
grant execute on function list_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Duplicate check at the site picked on the form
--
-- Returns only a job id, never the row, so any signed-in user may ask about
-- any site. Otherwise unchanged from 0011.
-- ---------------------------------------------------------------------------

create or replace function find_recent_duplicate(p_site_id uuid, p_vin text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result uuid;
begin
  if p_vin is null or trim(p_vin) = '' then
    return null;
  end if;

  if (select u.id from current_app_user() u) is null then
    return null;
  end if;

  select id into result
  from jobs
  where site_id = p_site_id
    and vin = upper(trim(p_vin))
    and deleted_at is null
    and created_at >= now() - interval '7 days'
  order by created_at desc
  limit 1;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Worker view: the crew and the shares (appended, so `select *` callers
--    keep their column order). Still no billing_code / manager_note.
-- ---------------------------------------------------------------------------

create or replace view jobs_worker_view as
  select id, site_id, worker_id, created_at, updated_at, plate, vin,
         vin_valid_checksum, brand, worker_note, locked_at,
         duplicate_of_job_id, deleted_at,
         service_id, worker_price,
         coworker_ids, submitter_share, coworker_share
  from jobs;

alter view jobs_worker_view set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 10. Stats per PERSON, not per submitter
--
-- One row per person on the crew: ord 1 is the submitter, the rest co-workers.
-- job_count counts the job once for each of them; worker_cost is each person's
-- own share. `car_count` counts the car once (submitter rows only) — that is
-- what a site total must add up, since job_count summed across a site counts a
-- shared car once per person.
--
-- job_service_stats (0005) is per site, not per person, and sum(worker_price)
-- is still the right total there — left alone.
-- ---------------------------------------------------------------------------

drop view job_daily_stats;

create view job_daily_stats as
  select
    j.site_id,
    c.person as worker_id,
    j.service_id,
    date_trunc('day', j.created_at)::date as day,
    count(*) as job_count,
    sum(case when c.ord = 1 then j.submitter_share else j.coworker_share end) as worker_cost,
    count(*) filter (where c.ord = 1) as car_count
  from jobs j
  cross join lateral unnest(array[j.worker_id] || j.coworker_ids) with ordinality as c(person, ord)
  where j.deleted_at is null
    and j.service_id is not null
  group by j.site_id, c.person, j.service_id, date_trunc('day', j.created_at);

alter view job_daily_stats set (security_invoker = true);

drop view job_monthly_stats;

create view job_monthly_stats as
  select
    j.site_id,
    c.person as worker_id,
    date_trunc('month', j.created_at)::date as month,
    count(*) as job_count
  from jobs j
  cross join lateral unnest(array[j.worker_id] || j.coworker_ids) as c(person)
  where j.deleted_at is null
  group by j.site_id, c.person, date_trunc('month', j.created_at);

alter view job_monthly_stats set (security_invoker = true);

commit;
