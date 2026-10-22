-- ===========================================================================
-- 0028 — what Carasso can read, and what it inherits by accident (step 3 of 5)
--
-- Apply after 0027.
--
-- Carasso gets NO access to `jobs`, `job_billing` or `jobs_manager` (pay, the
-- crew shares and the manager note live there). It reads through:
--   * jobs_carasso      a column whitelist, filtered to the caller's sites
--   * services_carasso  service names only (services.worker_price is pay)
--   * carasso_crew()    the people on its jobs, for the worker filter
--   * can_view_job()    "may I see this job's media / prices?"
--
-- The second half closes every existing "any signed-in user" path that a new
-- role would otherwise inherit. Carasso is strictly read-only: it has no write
-- policy on any table, and the guards below are default-deny rather than
-- `role <> 'worker'`.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. can_view_job — mirrors jobs_select (below), plus Carasso's sites
--
-- Security definer on purpose: policy subqueries on `jobs` run under the
-- CALLER's jobs RLS, which for Carasso is empty (same shape of fix as
-- can_write_job in 0009/0022). Carasso never sees a deleted job.
-- ---------------------------------------------------------------------------

create or replace function can_view_job(p_job_id uuid)
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
           or (u.role in ('worker', 'manager')
               and (u.id = j.worker_id or u.id = any (j.coworker_ids)))
           or (u.role = 'carasso'
               and j.deleted_at is null
               and exists (select 1 from user_sites us
                           where us.user_id = u.id and us.site_id = j.site_id)))
  );
$$;

revoke all on function can_view_job(uuid) from public, anon;
grant execute on function can_view_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. jobs: roles named explicitly (default-deny)
-- ---------------------------------------------------------------------------

-- 0019's select keyed the crew branches on identity alone, so a Carasso user
-- named as a co-worker would have read the whole row, pay included.
drop policy jobs_select on jobs;
create policy jobs_select on jobs for select
  using (
    exists (
      select 1 from current_app_user() u
      where u.role = 'admin'
         or (u.role = 'manager' and u.site_id = jobs.site_id)
         or (u.role in ('worker', 'manager')
             and (u.id = jobs.worker_id or u.id = any (jobs.coworker_ids)))
    )
  );

-- 0019's insert allowed ANY app user to log a job as themselves.
drop policy jobs_insert on jobs;
create policy jobs_insert on jobs for insert
  with check (
    exists (
      select 1 from current_app_user() u
      where u.id = jobs.worker_id and u.role in ('worker', 'manager', 'admin')
    )
  );

-- A Carasso user can never be put on a crew (that would also leak the crew
-- list through list_staff and the worker filter). Body otherwise as 0019.
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

  if not exists (
    select 1 from users u where u.id = new.worker_id and u.role in ('worker', 'manager', 'admin')
  ) then
    raise exception 'the submitter must be a staff user';
  end if;

  if cardinality(new.coworker_ids) > 2 then
    raise exception 'a job can have at most 2 co-workers';
  end if;

  if exists (
    select 1 from unnest(new.coworker_ids) x
    where x <> all (previous)
      and not exists (
        select 1 from users u
        where u.id = x and u.active and u.role in ('worker', 'manager', 'admin')
      )
  ) then
    raise exception 'co-worker must be an active staff user';
  end if;

  return new;
end;
$$;

-- 0021/0024 passed through every role except 'worker'. Default-deny instead:
-- only a trusted context or a manager/admin skips the worker restrictions,
-- anything that is not a worker (Carasso, a future role) is refused.
-- Also reverts duplicate_of_job_id on update: it is set by the insert trigger
-- in 0029 and a worker has no business repointing it.
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

  if caller is null or caller.role in ('manager', 'admin') then
    return new;
  end if;

  if caller.role <> 'worker' then
    raise exception 'forbidden';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.locked_at := now() + interval '15 minutes';
    new.deleted_at := null;
  else
    new.created_at := old.created_at;
    new.locked_at := old.locked_at;
    new.deleted_at := old.deleted_at;
    new.duplicate_of_job_id := old.duplicate_of_job_id;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Other tables and functions open to "any signed-in user"
-- ---------------------------------------------------------------------------

-- photos: rows follow job visibility, Carasso included (the Worker's /photo
-- also asks can_view_job). Equivalent to the old policy for the other roles:
-- its subquery ran under jobs_select, so it could only ever return what
-- jobs_select already allowed.
drop policy photos_select on photos;
create policy photos_select on photos for select
  using (can_view_job(photos.job_id));

-- job_client_prices: Carasso reads the prices of jobs it can view.
create policy job_client_prices_carasso on job_client_prices for select
  using (
    exists (select 1 from current_app_user() u where u.role = 'carasso')
    and can_view_job(job_client_prices.job_id)
  );

-- services: the catalog carries worker_price (pay). Carasso gets names from
-- services_carasso instead.
drop policy services_select on services;
create policy services_select on services for select
  using (exists (
    select 1 from current_app_user() u where u.role in ('worker', 'manager', 'admin')
  ));

-- sites: staff read every site name (login/site pickers, 0001); Carasso only
-- its own.
drop policy sites_select on sites;
create policy sites_select on sites for select
  using (
    exists (select 1 from current_app_user() u where u.role in ('worker', 'manager', 'admin'))
    or exists (
      select 1 from user_sites us
      join current_app_user() u on u.id = us.user_id
      where us.site_id = sites.id and u.role = 'carasso'
    )
  );

-- list_staff (0019): staff only, and Carasso accounts are not listed.
create or replace function list_staff()
returns table (id uuid, name text, site_id uuid, active boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from current_app_user() u where u.role in ('worker', 'manager', 'admin')) then
    raise exception 'forbidden';
  end if;

  return query
  select u.id, u.name, u.site_id, u.active
  from users u
  where u.role <> 'carasso'
  order by u.name;
end;
$$;

-- lookup_vehicle (0018): not for Carasso. Body otherwise unchanged.
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
         sv.name_en, sv.name_ru, sv.name_he
  from jobs j
  join sites s on s.id = j.site_id
  left join services sv on sv.id = j.service_id
  where j.deleted_at is null
    and ((q_plate <> '' and j.plate = q_plate) or (q_vin <> '' and j.vin = q_vin))
  order by j.created_at desc
  limit 100;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Carasso's read surface
--
-- jobs_carasso is a plain (owner-rights) view, so it can read tables the
-- caller cannot. Its WHERE is the whole access check: the caller must be an
-- active carasso user (their user_sites only) or an admin (every site), and a
-- signed-out or other-role caller gets no rows. Columns are listed, never
-- `j.*`. Deliberately absent: worker_price, coworker_share, submitter_share,
-- manager_note, duplicate_of_job_id, locked_at, deleted_at, updated_at.
--
-- When the admin setting hides worker names, a Carasso caller gets NULL for
-- `crew`, `worker_id` and an empty `coworker_ids` (the ids would otherwise
-- leave the names recoverable). Admins always see the crew.
-- The view's filters, ordering, paging and counts work through PostgREST like
-- any table, so the jobs grid can reuse applyJobFilters unchanged.
-- ---------------------------------------------------------------------------

create view jobs_carasso as
  select j.id,
         j.site_id,
         s.name as site_name,
         j.created_at,
         j.plate,
         j.vin,
         j.brand,
         j.worker_note,
         j.service_id,
         sv.name_en as service_name_en,
         sv.name_ru as service_name_ru,
         sv.name_he as service_name_he,
         sv.catalog_number,
         b.billing_code,
         case when h.hide then null else j.worker_id end as worker_id,
         case when h.hide then '{}'::uuid[] else j.coworker_ids end as coworker_ids,
         case when h.hide then null else (
           select string_agg(cu.name, ', ' order by c.ord)
           from unnest(array[j.worker_id] || j.coworker_ids) with ordinality as c(person, ord)
           join users cu on cu.id = c.person
         ) end as crew,
         cp.unit_price  as client_unit_price,
         cp.total_price as client_total_price
  from jobs j
  join current_app_user() me on true
  join sites s on s.id = j.site_id
  left join services sv on sv.id = j.service_id
  left join job_billing b on b.job_id = j.id
  left join job_client_prices cp on cp.job_id = j.id
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

-- Service names for Carasso's service filter. Never worker_price.
create view services_carasso as
  select sv.id, sv.name_en, sv.name_ru, sv.name_he, sv.catalog_number,
         sv.active, sv.sort_order, sv.deleted_at
  from services sv
  join current_app_user() me on true
  where me.role in ('carasso', 'admin');

revoke all on services_carasso from public, anon, authenticated;
grant select on services_carasso to authenticated;

-- The worker filter's options: people on the caller's jobs. Empty while names
-- are hidden (the view blanks the ids).
create or replace function carasso_crew()
returns table (id uuid, name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from current_app_user() u where u.role in ('carasso', 'admin')) then
    raise exception 'forbidden';
  end if;

  return query
  select distinct u.id, u.name
  from jobs_carasso v
  cross join lateral unnest(array[v.worker_id] || v.coworker_ids) as p(person)
  join users u on u.id = p.person
  order by u.name;
end;
$$;

revoke all on function carasso_crew() from public, anon;
grant execute on function carasso_crew() to authenticated;

commit;
