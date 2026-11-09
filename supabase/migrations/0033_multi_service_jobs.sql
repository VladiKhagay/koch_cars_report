-- ===========================================================================
-- 0033 — a job carries several services again
--
-- 0005 collapsed jobs to one service (`jobs.service_id`) with the pay
-- snapshotted onto the job. The yard now logs cars that got a wash AND a
-- polish, and both must be paid and billed. This brings `job_services` back,
-- with the snapshot moved onto each line:
--
--   job_services               one row per (job, service): the worker pay of
--                              that service at the time it was added
--   job_service_client_prices  the client price of that line (admin / Carasso)
--
-- What stays put, so existing readers keep their meaning:
--   * jobs.worker_price is now the SUM of the job's lines, kept by trigger.
--     The generated submitter_share / coworker_share (0019) split that sum
--     exactly as before.
--   * job_client_prices is now the per-job SUM of its line client prices
--     (NULL when any line has no price). jobs_carasso's client_* columns read
--     it unchanged.
--   * jobs.service_id is DEPRECATED: the first service at creation. A phone
--     still on the previous build that changes it replaces the job's services
--     with that one service. Dropped in a later migration.
--
-- Price rules (AC-2, AC-8): a line's worker pay is stamped from the catalog
-- for every signed-in caller and only an admin may change it afterwards; a
-- line keeps its price when the catalog is re-priced; adding a service later
-- takes the price of the day. Only the trusted context (no app user: SQL
-- editor, service role) may insert a line at a given price.
--
-- Who may add or remove a job's services mirrors jobs_update: admin; a
-- manager at the job's site; the submitter while the 15-minute window is open
-- and the job is not deleted. Co-workers never.
--
-- Writes go through two RPCs, both security invoker (RLS applies as-is):
--   create_job(...)       the job and ALL its services in one call
--   set_job_services(...) replace a job's set (insert first, then delete)
--
-- Deploy order: 0033 -> web. 0033 alone keeps the previous web build working
-- (it still inserts jobs with service_id; the seed trigger adds the line).
-- Until the web is deployed, two old-build admin actions stop sticking: a
-- per-job pay override on jobs.worker_price (now always the line sum) and a
-- direct job_client_prices edit (recomputed on the next line change).
-- Rollback: web only. 0033 is roll-forward only — do not drop job_services
-- while any job has more than one service; that is the 0005 data loss again.
--
-- Apply after 0032. Runs as one transaction; the backfill checks abort it on
-- any mismatch.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table job_services (
  job_id        uuid not null references jobs (id) on delete cascade,
  service_id    uuid not null references services (id),
  worker_price  numeric not null check (worker_price >= 0),
  created_at    timestamptz not null default now(),
  primary key (job_id, service_id)
);

-- Service filter, retired-service probe, per-service analytics.
create index job_services_service_idx on job_services (service_id);

alter table job_services enable row level security;
revoke all on job_services from anon;

comment on table job_services is
  'Services performed on a job (>= 1 per job). worker_price is the pay snapshot for that line; jobs.worker_price is their sum (0033).';

-- Nullable prices, same as job_client_prices (0027): a line whose service had
-- no catalog client price at the time is unpriced until an admin fills it in.
create table job_service_client_prices (
  job_id       uuid not null,
  service_id   uuid not null,
  unit_price   numeric check (unit_price >= 0),
  total_price  numeric check (total_price >= 0),
  updated_at   timestamptz not null default now(),
  primary key (job_id, service_id),
  foreign key (job_id, service_id) references job_services (job_id, service_id) on delete cascade
);

create trigger job_service_client_prices_set_updated_at
  before update on job_service_client_prices
  for each row execute function set_updated_at();

alter table job_service_client_prices enable row level security;
revoke all on job_service_client_prices from anon;

-- ---------------------------------------------------------------------------
-- 2. Backfill, before any trigger below exists
--
-- Every job with a service gets exactly that line at exactly its current pay
-- (NOT today's catalog price), and its client prices move onto the line. Jobs
-- with no service (pre-0005 leftovers) get no line and keep their row as is.
-- ---------------------------------------------------------------------------

insert into job_services (job_id, service_id, worker_price, created_at)
select j.id, j.service_id, j.worker_price, j.created_at
from jobs j
where j.service_id is not null;

insert into job_service_client_prices (job_id, service_id, unit_price, total_price)
select j.id, j.service_id, cp.unit_price, cp.total_price
from jobs j
join job_client_prices cp on cp.job_id = j.id
where j.service_id is not null;

do $$
declare
  n_jobs  bigint;
  n_lines bigint;
  bad     bigint;
begin
  select count(*) into n_jobs from jobs where service_id is not null;
  select count(*) into n_lines from job_services;
  if n_jobs <> n_lines then
    raise exception '0033 backfill: % jobs with a service but % lines', n_jobs, n_lines;
  end if;

  select count(*) into bad
  from jobs j
  where j.service_id is not null
    and j.worker_price is distinct from (
      select sum(js.worker_price) from job_services js where js.job_id = j.id);
  if bad > 0 then
    raise exception '0033 backfill: % jobs whose pay differs from the sum of their lines', bad;
  end if;

  -- The derived client price (rule of job_client_prices_refresh below) must
  -- equal what each job holds today; a job with no row must derive NULL.
  select count(*) into bad
  from jobs j
  left join job_client_prices cp on cp.job_id = j.id
  cross join lateral (
    select case when count(*) > 0 and count(*) = count(lp.unit_price)  then sum(lp.unit_price)  end as unit_price,
           case when count(*) > 0 and count(*) = count(lp.total_price) then sum(lp.total_price) end as total_price
    from job_services js
    left join job_service_client_prices lp on lp.job_id = js.job_id and lp.service_id = js.service_id
    where js.job_id = j.id
  ) d
  where j.service_id is not null
    and (cp.unit_price is distinct from d.unit_price
         or cp.total_price is distinct from d.total_price);
  if bad > 0 then
    raise exception '0033 backfill: % jobs whose client prices differ from their lines', bad;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Row security on the lines
--
-- Read: whoever can read the job (the subquery runs under jobs_select).
-- Add / remove: the jobs_update USING rule, except that INSERT's submitter
-- branch is not limited to role 'worker': a manager who logs a job at
-- ANOTHER site (allowed by jobs_insert) must still be able to submit it with
-- several services. That window is real: section 4b stamps locked_at on a
-- manager's insert too, so it closes 15 minutes after creation (a manager
-- cannot update an other-site job to reopen it). Never co-workers.
-- Change a line's pay: admin only (the guard below also reverts others).
-- ---------------------------------------------------------------------------

create policy job_services_select on job_services for select
  using (exists (select 1 from jobs j where j.id = job_services.job_id));

create policy job_services_insert on job_services for insert
  with check (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = job_services.job_id
      and (u.role = 'admin'
           or (u.role = 'manager' and u.site_id = j.site_id)
           or (u.role in ('worker', 'manager') and u.id = j.worker_id
               and j.locked_at > now() and j.deleted_at is null))
  ));

-- Delete is exactly the jobs_update USING rule (worker submitter only): the
-- other-site manager branch above exists for create_job, which never deletes.
create policy job_services_delete on job_services for delete
  using (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = job_services.job_id
      and (u.role = 'admin'
           or (u.role = 'manager' and u.site_id = j.site_id)
           or (u.role = 'worker' and u.id = j.worker_id
               and j.locked_at > now() and j.deleted_at is null))
  ));

create policy job_services_update on job_services for update
  using (exists (select 1 from current_app_user() u where u.role = 'admin'))
  with check (exists (select 1 from current_app_user() u where u.role = 'admin'));

-- Same shape as job_client_prices (0027/0028).
create policy job_service_client_prices_admin on job_service_client_prices for all
  using (exists (select 1 from current_app_user() u where u.role = 'admin'))
  with check (exists (select 1 from current_app_user() u where u.role = 'admin'));

create policy job_service_client_prices_carasso on job_service_client_prices for select
  using (
    exists (select 1 from current_app_user() u where u.role = 'carasso')
    and can_view_job(job_service_client_prices.job_id)
  );

-- ---------------------------------------------------------------------------
-- 4. jobs.worker_price is the sum of the lines
--
-- Same trigger as 0005 (before insert or update of service_id, worker_price),
-- new body: no caller can set it, everyone gets the sum. A job with no lines
-- keeps what it had (0 on insert — the seed trigger then adds the first line
-- and the touch below recomputes).
-- ---------------------------------------------------------------------------

create or replace function jobs_apply_worker_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.worker_price := coalesce(
    (select sum(js.worker_price) from job_services js where js.job_id = new.id),
    case when tg_op = 'UPDATE' then old.worker_price else 0 end
  );
  return new;
end;
$$;

-- The client price snapshot moves to the lines (section 6).
drop trigger if exists jobs_snapshot_client_prices_ins on jobs;
drop trigger if exists jobs_snapshot_client_prices_upd on jobs;
drop function if exists jobs_snapshot_client_prices();

-- ---------------------------------------------------------------------------
-- 4b. A manager's new job gets the server's clock too
--
-- 0028's guard let managers through untouched, so a manager inserting a job
-- could pick its locked_at — and with it how long the submitter branch of
-- job_services_insert stays open on a job at another site. On INSERT a
-- manager now gets the same stamps as a worker. Manager UPDATEs are
-- unchanged; admins and the trusted context (no app user) skip all of it.
-- Body otherwise as 0028. `caller.id is null`, not `caller is null` (see
-- job_services_guard).
-- ---------------------------------------------------------------------------

create or replace function jobs_guard_worker_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
begin
  select * into caller from current_app_user();

  if caller.id is null or caller.role = 'admin' then
    return new;
  end if;

  if caller.role not in ('worker', 'manager') then
    raise exception 'forbidden';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.locked_at := now() + interval '15 minutes';
    new.deleted_at := null;
  elsif caller.role = 'worker' then
    new.created_at := old.created_at;
    new.locked_at := old.locked_at;
    new.deleted_at := old.deleted_at;
    new.duplicate_of_job_id := old.duplicate_of_job_id;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. jobs.service_id, the deprecated single service
--
-- Insert: seeds the first line, so the previous web build (a plain insert
-- into jobs) still produces a correct job. A signed-in caller must name a
-- service; the trusted context may create a job without one.
-- Update: a previous build changing the service means "this is now the
-- service" — the set becomes that one service (insert first, then delete, so
-- the job is never empty).
-- Security definer: the jobs insert/update policies already decided the
-- caller may write this job, and a manager logging a job at another site
-- must not trip over job_services RLS on the seed.
-- ---------------------------------------------------------------------------

create or replace function jobs_seed_service()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.service_id is null then
    if (select u.id from current_app_user() u) is not null then
      raise exception 'a job needs at least one service' using errcode = 'check_violation';
    end if;
    return null;
  end if;

  -- Skipped when already on the job: the line guard runs BEFORE `on conflict`
  -- is resolved and would refuse re-attaching a soft-deleted service.
  insert into job_services (job_id, service_id, worker_price)
  select new.id, new.service_id,
         coalesce((select s.worker_price from services s where s.id = new.service_id), 0)
  where not exists (select 1 from job_services js
                    where js.job_id = new.id and js.service_id = new.service_id)
  on conflict do nothing;

  if tg_op = 'UPDATE' then
    delete from job_services where job_id = new.id and service_id <> new.service_id;
  end if;

  return null;
end;
$$;

create trigger jobs_seed_service_ins
  after insert on jobs
  for each row execute function jobs_seed_service();

create trigger jobs_seed_service_upd
  after update of service_id on jobs
  for each row
  when (new.service_id is distinct from old.service_id and new.service_id is not null)
  execute function jobs_seed_service();

-- ---------------------------------------------------------------------------
-- 6. Line integrity
-- ---------------------------------------------------------------------------

-- Pay snapshot. Insert: every signed-in caller gets the catalog price (an
-- admin then overrides with an update); the trusted context keeps what it
-- sent. A non-admin may not add a soft-deleted service (lines already on a
-- job are never re-inserted, so they keep resolving). Update: the line's
-- identity never changes, and only an admin (or the trusted context) may
-- change its pay — others are reverted silently, like 0005/0006, so a client
-- re-sending the row does not fail.
--
-- "Signed-in" is `caller.id is not null`, never `caller is not null`: on a
-- row variable that is true only when EVERY column is non-null, so a user
-- with no site_id (Carasso, a staff member without a site) would pass as the
-- trusted context and keep any price they sent.
create or replace function job_services_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
begin
  select * into caller from current_app_user();

  if tg_op = 'INSERT' then
    if caller.id is not null then
      if caller.role <> 'admin'
         and exists (select 1 from services s
                     where s.id = new.service_id and s.deleted_at is not null) then
        raise exception 'this service has been removed from the catalog'
          using errcode = 'check_violation';
      end if;
      new.worker_price := coalesce(
        (select s.worker_price from services s where s.id = new.service_id), 0);
    end if;
    return new;
  end if;

  if new.job_id <> old.job_id or new.service_id <> old.service_id then
    raise exception 'a job service line cannot be moved; remove it and add another'
      using errcode = 'check_violation';
  end if;

  if caller.id is not null and caller.role <> 'admin' then
    new.worker_price := old.worker_price;
  end if;
  return new;
end;
$$;

create trigger job_services_guard
  before insert or update on job_services
  for each row execute function job_services_guard();

-- Client price snapshot of the new line, from the catalog of the day. Always
-- writes a row (NULL prices for a service with none), like 0027 did per job.
-- Security definer: workers have no access to client prices at all.
create or replace function job_services_snapshot_client_prices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into job_service_client_prices (job_id, service_id, unit_price, total_price)
  select new.job_id, new.service_id, p.unit_price, p.total_price
  from (select 1) one
  left join service_client_prices p on p.service_id = new.service_id
  on conflict do nothing;
  return null;
end;
$$;

create trigger job_services_snapshot_client_prices
  after insert on job_services
  for each row execute function job_services_snapshot_client_prices();

-- The per-job client price: the sum of the lines, NULL per column when any
-- line has no price. Not an RPC: no grants, only called from the triggers
-- below (which run as the owner). Skips a job that no longer exists — a hard
-- delete of a job cascades through here.
create or replace function job_client_prices_refresh(p_job_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from jobs where id = p_job_id) then
    return;
  end if;

  insert into job_client_prices (job_id, unit_price, total_price)
  select p_job_id,
         case when count(*) > 0 and count(*) = count(lp.unit_price)  then sum(lp.unit_price)  end,
         case when count(*) > 0 and count(*) = count(lp.total_price) then sum(lp.total_price) end
  from job_services js
  left join job_service_client_prices lp on lp.job_id = js.job_id and lp.service_id = js.service_id
  where js.job_id = p_job_id
  on conflict (job_id) do update
    set unit_price = excluded.unit_price, total_price = excluded.total_price;
end;
$$;

revoke all on function job_client_prices_refresh(uuid) from public, anon, authenticated;

create or replace function job_service_client_prices_sum()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform job_client_prices_refresh(coalesce(new.job_id, old.job_id));
  return null;
end;
$$;

create trigger job_service_client_prices_sum
  after insert or update or delete on job_service_client_prices
  for each row execute function job_service_client_prices_sum();

-- A line added, removed or re-priced: recompute the job's pay (the update of
-- worker_price fires jobs_apply_worker_price, which writes the sum) and its
-- client price (a removed line that had no price row changes the sum too).
create or replace function job_services_touch_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jid uuid := coalesce(new.job_id, old.job_id);
begin
  update jobs set worker_price = worker_price where id = jid;
  perform job_client_prices_refresh(jid);
  return null;
end;
$$;

create trigger job_services_touch_job
  after insert or delete or update of worker_price on job_services
  for each row execute function job_services_touch_job();

-- At least one service per job. After-row triggers run at the end of the
-- statement, so set_job_services (insert, then delete) never trips it; a hard
-- delete of the job itself does not either (the job is gone by then).
create or replace function job_services_keep_one()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Lock the job first: two concurrent deletes could otherwise each remove
  -- the other's last line and both pass the check.
  perform 1 from jobs where id = old.job_id for update;

  if exists (select 1 from jobs where id = old.job_id)
     and not exists (select 1 from job_services where job_id = old.job_id) then
    raise exception 'a job needs at least one service' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create trigger job_services_keep_one
  after delete on job_services
  for each row execute function job_services_keep_one();

revoke all on function jobs_seed_service() from public, anon;
revoke all on function job_services_guard() from public, anon;
revoke all on function job_services_snapshot_client_prices() from public, anon;
revoke all on function job_service_client_prices_sum() from public, anon;
revoke all on function job_services_touch_job() from public, anon;
revoke all on function job_services_keep_one() from public, anon;

-- ---------------------------------------------------------------------------
-- 7. Write RPCs (security invoker: RLS and every trigger above apply)
-- ---------------------------------------------------------------------------

-- The job and all its services in one call, so an offline retry can never
-- land the car with only some of them. Duplicates are dropped, order kept;
-- the first service is also written to the deprecated jobs.service_id (whose
-- insert trigger adds line 1). Pay comes from the guard, never the caller.
create or replace function create_job(
  p_site_id            uuid,
  p_worker_id          uuid,
  p_plate              text,
  p_vin                text,
  p_vin_valid_checksum boolean,
  p_brand              text,
  p_worker_note        text,
  p_coworker_ids       uuid[],
  p_service_ids        uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  ids    uuid[];
  new_id uuid;
begin
  ids := array(
    select x from unnest(p_service_ids) with ordinality as t(x, n)
    where x is not null
    group by x
    order by min(n)
  );
  if cardinality(ids) = 0 then
    raise exception 'a job needs at least one service' using errcode = 'check_violation';
  end if;

  insert into jobs (site_id, worker_id, plate, vin, vin_valid_checksum, brand,
                    worker_note, coworker_ids, service_id)
  values (p_site_id, p_worker_id, p_plate, p_vin, p_vin_valid_checksum, p_brand,
          p_worker_note, coalesce(p_coworker_ids, '{}'), ids[1])
  returning id into new_id;

  insert into job_services (job_id, service_id, worker_price)
  select new_id, x, coalesce((select s.worker_price from services s where s.id = x), 0)
  from unnest(ids[2:]) as x
  on conflict do nothing;

  return new_id;
end;
$$;

revoke all on function create_job(uuid, uuid, text, text, boolean, text, text, uuid[], uuid[]) from public, anon;
grant execute on function create_job(uuid, uuid, text, text, boolean, text, text, uuid[], uuid[]) to authenticated;

-- Replace a job's services. The jobs update is the permission check: under
-- jobs_update it touches no row once the worker's window has closed, the job
-- is deleted, or the caller is a co-worker — that is a 42501, not a silent
-- no-op. Lines already on the job keep their price; new ones get today's.
-- jobs.service_id is deliberately NOT updated (its trigger would collapse the
-- set to one service).
create or replace function set_job_services(p_job_id uuid, p_service_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  ids     uuid[];
  touched uuid;
begin
  ids := array(select distinct x from unnest(p_service_ids) as x where x is not null);
  if cardinality(ids) = 0 then
    raise exception 'a job needs at least one service' using errcode = 'check_violation';
  end if;

  update jobs set updated_at = now() where id = p_job_id returning id into touched;
  if touched is null then
    raise exception 'job not found or not editable' using errcode = '42501';
  end if;

  -- Only services not yet on the job: an existing line (even of a since
  -- soft-deleted service) is left alone, price and all.
  insert into job_services (job_id, service_id, worker_price)
  select p_job_id, x, coalesce((select s.worker_price from services s where s.id = x), 0)
  from unnest(ids) as x
  where not exists (select 1 from job_services js
                    where js.job_id = p_job_id and js.service_id = x)
  on conflict do nothing;

  delete from job_services where job_id = p_job_id and service_id <> all (ids);
end;
$$;

revoke all on function set_job_services(uuid, uuid[]) from public, anon;
grant execute on function set_job_services(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Lines with each person's share — the ONE definition of the per-service
--    split (stats views and the jobs views read this).
--
-- Lines ordered by catalog sort_order, then id. Every line but the last gets
-- floor(job share * line pay / job pay) to the cent; the last takes the
-- remainder, so a job's line shares always add up to exactly its
-- submitter_share / coworker_share (0019). A job paid 0 splits 0.
-- ---------------------------------------------------------------------------

create view job_service_lines as
  select a.job_id,
         a.service_id,
         a.worker_price,
         a.sort_order,
         case when a.rn = a.n
              then a.job_sub - coalesce(sum(a.sub_part) filter (where a.rn < a.n) over (partition by a.job_id), 0)
              else a.sub_part end as submitter_share,
         case when a.rn = a.n
              then a.job_co - coalesce(sum(a.co_part) filter (where a.rn < a.n) over (partition by a.job_id), 0)
              else a.co_part end as coworker_share,
         a.rn = 1 as is_first
  from (
    select l.*,
           case when l.job_sum = 0 then 0
                else floor(l.job_sub * l.worker_price * 100 / l.job_sum) / 100 end as sub_part,
           case when l.job_sum = 0 then 0
                else floor(l.job_co * l.worker_price * 100 / l.job_sum) / 100 end as co_part
    from (
      select js.job_id,
             js.service_id,
             js.worker_price,
             coalesce(sv.sort_order, 0) as sort_order,
             j.worker_price    as job_sum,
             j.submitter_share as job_sub,
             j.coworker_share  as job_co,
             row_number() over (partition by js.job_id
                                order by coalesce(sv.sort_order, 0), js.service_id) as rn,
             count(*) over (partition by js.job_id) as n
      from job_services js
      join jobs j on j.id = js.job_id
      left join services sv on sv.id = js.service_id
    ) l
  ) a;

alter view job_service_lines set (security_invoker = true);
revoke all on job_service_lines from anon;

-- ---------------------------------------------------------------------------
-- 9. Stats
--
-- job_daily_stats keeps its columns (0019) but is now per SERVICE: a job with
-- two services is a row under each, with that line's share as worker_cost.
-- Summed without a service filter it counts a two-service job twice — read
-- job_daily_totals for job and car counts.
-- job_daily_totals is per JOB: job_count once per person on the crew,
-- car_count once per car, worker_cost each person's share. Both views only
-- count jobs that have a service, as job_daily_stats always did.
-- job_service_stats (0005) has no readers and is dropped.
-- ---------------------------------------------------------------------------

create or replace view job_daily_stats as
  select
    j.site_id,
    c.person as worker_id,
    l.service_id,
    date_trunc('day', j.created_at)::date as day,
    count(*) as job_count,
    sum(case when c.ord = 1 then l.submitter_share else l.coworker_share end) as worker_cost,
    count(*) filter (where c.ord = 1) as car_count
  from jobs j
  join job_service_lines l on l.job_id = j.id
  cross join lateral unnest(array[j.worker_id] || j.coworker_ids) with ordinality as c(person, ord)
  where j.deleted_at is null
  group by j.site_id, c.person, l.service_id, date_trunc('day', j.created_at);

alter view job_daily_stats set (security_invoker = true);

create view job_daily_totals as
  select
    j.site_id,
    c.person as worker_id,
    date_trunc('day', j.created_at)::date as day,
    count(*) as job_count,
    count(*) filter (where c.ord = 1) as car_count,
    sum(case when c.ord = 1 then j.submitter_share else j.coworker_share end) as worker_cost
  from jobs j
  cross join lateral unnest(array[j.worker_id] || j.coworker_ids) with ordinality as c(person, ord)
  where j.deleted_at is null
    and exists (select 1 from job_services js where js.job_id = j.id)
  group by j.site_id, c.person, date_trunc('day', j.created_at);

alter view job_daily_totals set (security_invoker = true);
revoke all on job_daily_totals from anon;

drop view if exists job_service_stats;

-- ---------------------------------------------------------------------------
-- 10. Job views: the services, appended (existing column order unchanged)
--
--   service_ids  every service on the job, for the service filter
--                (PostgREST `ov`, any-match)
--   services     [{service_id, name_*, catalog_number, worker_price,
--                  submitter_share, coworker_share}] in catalog order;
--                soft-deleted services still resolve
-- Both security_invoker, as before: the lines come through
-- job_service_lines under the caller's own RLS.
-- ---------------------------------------------------------------------------

create or replace view jobs_worker_view as
  select j.id, j.site_id, j.worker_id, j.created_at, j.updated_at, j.plate, j.vin,
         j.vin_valid_checksum, j.brand, j.worker_note, j.locked_at,
         j.duplicate_of_job_id, j.deleted_at,
         j.service_id, j.worker_price,
         j.coworker_ids, j.submitter_share, j.coworker_share,
         coalesce(x.service_ids, '{}') as service_ids,
         coalesce(x.services, '[]'::jsonb) as services
  from jobs j
  left join lateral (
    select array_agg(l.service_id order by l.sort_order, l.service_id) as service_ids,
           jsonb_agg(jsonb_build_object(
             'service_id', l.service_id,
             'name_en', sv.name_en, 'name_ru', sv.name_ru, 'name_he', sv.name_he,
             'catalog_number', sv.catalog_number,
             'worker_price', l.worker_price,
             'submitter_share', l.submitter_share,
             'coworker_share', l.coworker_share
           ) order by l.sort_order, l.service_id) as services
    from job_service_lines l
    left join services sv on sv.id = l.service_id
    where l.job_id = j.id
  ) x on true;

alter view jobs_worker_view set (security_invoker = true);

create or replace view jobs_manager as
  select j.id, j.site_id, j.worker_id, j.created_at, j.updated_at, j.plate, j.vin,
         j.vin_valid_checksum, j.brand, j.worker_note, j.locked_at,
         j.duplicate_of_job_id, j.deleted_at, j.service_id, j.worker_price,
         j.coworker_ids, j.coworker_share, j.submitter_share,
         b.billing_code, b.manager_note,
         coalesce(x.service_ids, '{}') as service_ids,
         coalesce(x.services, '[]'::jsonb) as services
  from jobs j
  left join job_billing b on b.job_id = j.id
  left join lateral (
    select array_agg(l.service_id order by l.sort_order, l.service_id) as service_ids,
           jsonb_agg(jsonb_build_object(
             'service_id', l.service_id,
             'name_en', sv.name_en, 'name_ru', sv.name_ru, 'name_he', sv.name_he,
             'catalog_number', sv.catalog_number,
             'worker_price', l.worker_price,
             'submitter_share', l.submitter_share,
             'coworker_share', l.coworker_share
           ) order by l.sort_order, l.service_id) as services
    from job_service_lines l
    left join services sv on sv.id = l.service_id
    where l.job_id = j.id
  ) x on true;

alter view jobs_manager set (security_invoker = true);

-- Carasso: still an owner-rights view whose WHERE is the whole access check
-- (0028), so it reads the tables directly — never job_service_lines, never
-- worker_price. service_name_* / catalog_number are now the job's services
-- joined "A, B" in catalog order, each falling back to its English name so
-- a missing translation drops nothing. services carries the per-line client
-- prices; client_unit_price / client_total_price stay the per-job sums.
create or replace view jobs_carasso as
  select j.id,
         j.site_id,
         s.name as site_name,
         j.created_at,
         j.plate,
         j.vin,
         j.brand,
         j.worker_note,
         j.service_id,
         x.name_en as service_name_en,
         x.name_ru as service_name_ru,
         x.name_he as service_name_he,
         x.catalog_number,
         b.billing_code,
         case when h.hide then null else j.worker_id end as worker_id,
         case when h.hide then '{}'::uuid[] else j.coworker_ids end as coworker_ids,
         case when h.hide then null else (
           select string_agg(cu.name, ', ' order by c.ord)
           from unnest(array[j.worker_id] || j.coworker_ids) with ordinality as c(person, ord)
           join users cu on cu.id = c.person
         ) end as crew,
         cp.unit_price  as client_unit_price,
         cp.total_price as client_total_price,
         coalesce(x.service_ids, '{}') as service_ids,
         coalesce(x.services, '[]'::jsonb) as services
  from jobs j
  join current_app_user() me on true
  join sites s on s.id = j.site_id
  left join job_billing b on b.job_id = j.id
  left join job_client_prices cp on cp.job_id = j.id
  left join lateral (
    select string_agg(sv.name_en, ', ' order by sv.sort_order, sv.id) as name_en,
           string_agg(coalesce(sv.name_ru, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_ru,
           string_agg(coalesce(sv.name_he, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_he,
           string_agg(sv.catalog_number, ', ' order by sv.sort_order, sv.id) as catalog_number,
           array_agg(sv.id order by sv.sort_order, sv.id) as service_ids,
           jsonb_agg(jsonb_build_object(
             'service_id', sv.id,
             'name_en', sv.name_en, 'name_ru', sv.name_ru, 'name_he', sv.name_he,
             'catalog_number', sv.catalog_number,
             'client_unit_price', lp.unit_price,
             'client_total_price', lp.total_price
           ) order by sv.sort_order, sv.id) as services
    from job_services js
    join services sv on sv.id = js.service_id
    left join job_service_client_prices lp on lp.job_id = js.job_id and lp.service_id = js.service_id
    where js.job_id = j.id
  ) x on true
  cross join lateral (
    select me.role = 'carasso'
           and coalesce((select a.value = 'true'::jsonb
                         from app_settings a where a.key = 'hide_worker_names'), false) as hide
  ) h
  where j.deleted_at is null
    and (me.role = 'admin'
         or (me.role = 'carasso'
             and exists (select 1 from user_sites us
                         where us.user_id = me.id and us.site_id = j.site_id)));

revoke all on jobs_carasso from public, anon, authenticated;
grant select on jobs_carasso to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Read RPCs: same signatures, the service names are the job's services
--     joined "A, B" (per-item English fallback, as jobs_carasso).
-- ---------------------------------------------------------------------------

-- lookup_vehicle: body as 0028 (staff only).
create or replace function lookup_vehicle(p_query text)
returns table (
  created_at timestamptz,
  site_name  text,
  plate      text,
  vin        text,
  brand      text,
  service_name_en text,
  service_name_ru text,
  service_name_he text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q_vin   text := upper(trim(coalesce(p_query, '')));
  q_plate text := case when q_vin ~ '[A-Z]' then ''
                       else regexp_replace(q_vin, '[^0-9]', '', 'g') end;
begin
  if not exists (select 1 from current_app_user() u where u.role in ('worker', 'manager', 'admin')) then
    raise exception 'forbidden';
  end if;

  return query
  select j.created_at, s.name, j.plate, j.vin, j.brand,
         x.name_en, x.name_ru, x.name_he
  from jobs j
  join sites s on s.id = j.site_id
  left join lateral (
    select string_agg(sv.name_en, ', ' order by sv.sort_order, sv.id) as name_en,
           string_agg(coalesce(sv.name_ru, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_ru,
           string_agg(coalesce(sv.name_he, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_he
    from job_services js join services sv on sv.id = js.service_id
    where js.job_id = j.id
  ) x on true
  where j.deleted_at is null
    and ((q_plate <> '' and j.plate = q_plate) or (q_vin <> '' and j.vin = q_vin))
  order by j.created_at desc
  limit 100;
end;
$$;

revoke all on function lookup_vehicle(text) from public, anon;
grant execute on function lookup_vehicle(text) to authenticated;

-- find_previous_job: body as 0029.
create or replace function find_previous_job(p_plate text, p_vin text)
returns table (
  created_at timestamptz,
  site_name  text,
  service_name_en text,
  service_name_ru text,
  service_name_he text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q_vin   text := nullif(upper(trim(coalesce(p_vin, ''))), '');
  q_plate text := nullif(regexp_replace(coalesce(p_plate, ''), '[^0-9]', '', 'g'), '');
begin
  if not exists (select 1 from current_app_user() u where u.role in ('worker', 'manager', 'admin')) then
    raise exception 'forbidden';
  end if;

  if q_vin is null and q_plate is null then
    return;
  end if;

  return query
  select j.created_at, s.name, x.name_en, x.name_ru, x.name_he
  from jobs j
  join sites s on s.id = j.site_id
  left join lateral (
    select string_agg(sv.name_en, ', ' order by sv.sort_order, sv.id) as name_en,
           string_agg(coalesce(sv.name_ru, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_ru,
           string_agg(coalesce(sv.name_he, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_he
    from job_services js join services sv on sv.id = js.service_id
    where js.job_id = j.id
  ) x on true
  where j.deleted_at is null
    and ((q_vin is not null and j.vin = q_vin)
         or (q_plate is not null and j.plate = q_plate))
  order by j.created_at desc
  limit 1;
end;
$$;

revoke all on function find_previous_job(text, text) from public, anon;
grant execute on function find_previous_job(text, text) to authenticated;

-- duplicate_job_summary: body as 0029.
create or replace function duplicate_job_summary(p_job_id uuid)
returns table (
  created_at timestamptz,
  site_name  text,
  service_name_en text,
  service_name_ru text,
  service_name_he text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from current_app_user() u where u.role in ('manager', 'admin')) then
    raise exception 'forbidden';
  end if;
  if not can_view_job(p_job_id) then
    return;
  end if;

  return query
  select d.created_at, s.name, x.name_en, x.name_ru, x.name_he
  from jobs j
  join jobs d on d.id = j.duplicate_of_job_id
  join sites s on s.id = d.site_id
  left join lateral (
    select string_agg(sv.name_en, ', ' order by sv.sort_order, sv.id) as name_en,
           string_agg(coalesce(sv.name_ru, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_ru,
           string_agg(coalesce(sv.name_he, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_he
    from job_services js join services sv on sv.id = js.service_id
    where js.job_id = d.id
  ) x on true
  where j.id = p_job_id;
end;
$$;

revoke all on function duplicate_job_summary(uuid) from public, anon;
grant execute on function duplicate_job_summary(uuid) to authenticated;

commit;
