-- 0040: managers and admins submit jobs through the worker flow, either FOR a
-- real worker (the job is that worker's: their pay, stats, edit window) or
-- under a typed name (`worker_label`) when the person has no account.
--
-- A labelled job is owned by its submitter (worker_id = the manager/admin) so
-- every existing RLS path keeps working, but the submitter is NOT paid for it:
-- the stats views put its submitter row under worker_id NULL (carrying the
-- label) instead. Site totals (car_count, worker_cost summed per site) are
-- unchanged; the submitter's personal rows get nothing.
--
-- Rules (RLS + trigger, never only the UI):
--   * worker      submits as themselves, never with a label (as before)
--   * manager     as themselves at any site (as 0028); with a label only at
--                 their own site; for an active worker of their own site,
--                 at their own site
--   * admin       as themselves at any site, with or without a label;
--                 for any active worker, at any site
--   * carasso     never (unchanged)
--   * a label is set only at insert and only when the submitter is the owner;
--     a manager/admin update may clear it (moving the job to someone else
--     clears it) but never set or change it (42501). A WORKER's write to the
--     label on update is silently reverted, not rejected (0021 style: a
--     client resending the whole row must not fail); a worker's label at
--     insert is rejected by jobs_insert.
--
-- jobs_audit (0034) now also logs worker_label changes, and a job inserted
-- by someone other than its owner (on behalf) gets an audit_log row
-- 'create_on_behalf' naming the submitter (user_id) and the owner.
--
-- Co-workers see the label: jobs_worker_view gains worker_label.
--
-- Also fixes a regression: 0032 recreated list_staff() from the 0019 body and
-- dropped 0028's checks, so a carasso user could call it and carasso accounts
-- were listed. Recreated with 0032's signature and 0028's checks.
--
-- Deploy order: 0040, THEN the web build. create_job keeps every old argument
-- and p_worker_label defaults to null, so the previous web build (9 named
-- args) still resolves to it. The new web must NOT ship first: submitJob
-- always sends p_worker_label, which the 9-arg function does not have.
--
-- Rollback: web first, then the DOWN at the bottom. Dropping the column loses
-- every label, and those jobs then count as the submitter's own pay. Keep the
-- list_staff fix (the DOWN leaves it in place).
--
-- Bases: jobs_insert 0028, create_job / job_daily_stats / job_daily_totals /
-- jobs_manager 0033, job_monthly_stats 0019, jobs_carasso 0038, list_staff
-- 0032 (+ 0028 checks), jobs_audit 0034. No later migration redefines any
-- of them.

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The label
-- ---------------------------------------------------------------------------

-- No control, zero-width or bidi-override characters: the label is shown to
-- other users (Jobs list, exports, Carasso) and must not hide or reorder text.
-- \uXXXX are regex escapes (standard_conforming_strings: the backslash reaches
-- the regex engine); listed explicitly rather than [[:cntrl:]] so the result
-- does not depend on the database's ctype. Ranges: C0, DEL + C1, soft hyphen,
-- Arabic letter mark, ZWSP..RLM, line/para separators + LRE..RLO,
-- word joiner..PDI, BOM.
alter table jobs add column worker_label text
  constraint jobs_worker_label_check
  check (worker_label is null
         or (char_length(worker_label) between 1 and 60
             and worker_label !~ '[\u0001-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]'));

comment on column jobs.worker_label is
  'Name typed by a manager/admin for a person with no account. worker_id is then the submitter, who is not paid for the job (stats put it under worker_id NULL).';

-- ---------------------------------------------------------------------------
-- 2. Who may insert a job
--    (a) as yourself: label only for manager/admin; a manager's labelled job
--        only at their own site (unlabelled: any site, as 0028)
--    (b) for an active worker: manager (worker and job at own site) or admin;
--        never with a label (the label means "owner = submitter")
-- users is readable by managers/admins (users_select, 0019).
-- ---------------------------------------------------------------------------

drop policy jobs_insert on jobs;
create policy jobs_insert on jobs for insert
  with check (
    exists (
      select 1 from current_app_user() u
      where u.role in ('worker', 'manager', 'admin')
        and (
          (u.id = jobs.worker_id
           and (jobs.worker_label is null or u.role in ('manager', 'admin'))
           and (u.role <> 'manager' or jobs.worker_label is null or jobs.site_id = u.site_id))
          or
          (jobs.worker_label is null
           and u.role in ('manager', 'admin')
           and exists (
             select 1 from users w
             where w.id = jobs.worker_id
               and w.role = 'worker'
               and w.active
               and (u.role = 'admin'
                    or (w.site_id = u.site_id and jobs.site_id = u.site_id))))
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 3. The label on write
--
-- Always trimmed ('' = none) so RLS and the CHECK see the real value. INSERT
-- is left to jobs_insert (a worker's label must be REFUSED there, not
-- stripped). On UPDATE: a worker's write is silently reverted (0021 style);
-- moving the job to another owner clears it; otherwise it may be cleared but
-- never set or changed. Sorts after jobs_guard_worker_columns.
-- ---------------------------------------------------------------------------

create or replace function jobs_guard_worker_label()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
begin
  new.worker_label := nullif(btrim(new.worker_label), '');

  select * into caller from current_app_user();
  if caller.id is null or tg_op = 'INSERT' then
    return new;
  end if;

  if caller.role = 'worker' then
    new.worker_label := old.worker_label;
  elsif new.worker_id is distinct from old.worker_id then
    new.worker_label := null;
  elsif new.worker_label is distinct from old.worker_label and new.worker_label is not null then
    raise exception 'worker_label can only be set when the job is created' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists jobs_guard_worker_label on jobs;
create trigger jobs_guard_worker_label
  before insert or update on jobs
  for each row execute function jobs_guard_worker_label();

revoke all on function jobs_guard_worker_label() from public, anon;

-- jobs_audit (0034): body unchanged but for worker_label in the column list,
-- so clearing a label (or the clear caused by moving the job) is logged.
create or replace function jobs_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
  diff   jsonb;
begin
  select * into caller from current_app_user();
  if caller.id is null or caller.role not in ('manager', 'admin') then
    return null;
  end if;

  diff := audit_diff(to_jsonb(old), to_jsonb(new), array[
    'plate', 'vin', 'vin_valid_checksum', 'brand', 'worker_note', 'created_at',
    'worker_id', 'coworker_ids', 'site_id', 'deleted_at', 'worker_label']);
  if diff = '{}'::jsonb then
    return null;
  end if;

  insert into audit_log (job_id, user_id, action, changes)
  values (new.id, caller.id,
          case when old.deleted_at is null and new.deleted_at is not null then 'soft_delete'
               when old.deleted_at is not null and new.deleted_at is null then 'restore'
               else 'update' end,
          diff);
  return null;
end;
$$;

revoke all on function jobs_audit() from public, anon;

-- On-behalf inserts leave a trail: the job's worker_id says whose it is, this
-- row says who actually submitted it. Same {field: {from, to}} shape as the
-- 0034 triggers. AFTER, so the job row exists for the FK. A self-submit (and
-- the trusted context) writes nothing. audit_log.action has no CHECK (0001).
create or replace function jobs_audit_on_behalf()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
begin
  select * into caller from current_app_user();
  if caller.id is null or caller.id = new.worker_id then
    return null;
  end if;

  insert into audit_log (job_id, user_id, action, changes)
  values (new.id, caller.id, 'create_on_behalf',
          jsonb_build_object('worker_id', jsonb_build_object('from', 'null'::jsonb, 'to', to_jsonb(new.worker_id))));
  return null;
end;
$$;

drop trigger if exists jobs_audit_on_behalf on jobs;
create trigger jobs_audit_on_behalf
  after insert on jobs
  for each row execute function jobs_audit_on_behalf();

revoke all on function jobs_audit_on_behalf() from public, anon;

-- ---------------------------------------------------------------------------
-- 4. create_job takes the label. Dropped and recreated (a new argument is a
--    new signature); one overload only. Body otherwise as 0033.
-- ---------------------------------------------------------------------------

drop function create_job(uuid, uuid, text, text, boolean, text, text, uuid[], uuid[]);

create function create_job(
  p_site_id            uuid,
  p_worker_id          uuid,
  p_plate              text,
  p_vin                text,
  p_vin_valid_checksum boolean,
  p_brand              text,
  p_worker_note        text,
  p_coworker_ids       uuid[],
  p_service_ids        uuid[],
  p_worker_label       text default null
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
                    worker_note, coworker_ids, service_id, worker_label)
  values (p_site_id, p_worker_id, p_plate, p_vin, p_vin_valid_checksum, p_brand,
          p_worker_note, coalesce(p_coworker_ids, '{}'), ids[1], p_worker_label)
  returning id into new_id;

  insert into job_services (job_id, service_id, worker_price)
  select new_id, x, coalesce((select s.worker_price from services s where s.id = x), 0)
  from unnest(ids[2:]) as x
  on conflict do nothing;

  return new_id;
end;
$$;

revoke all on function create_job(uuid, uuid, text, text, boolean, text, text, uuid[], uuid[], text) from public, anon;
grant execute on function create_job(uuid, uuid, text, text, boolean, text, text, uuid[], uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Stats: a labelled job's submitter row goes to worker_id NULL.
--    The ord-1 row still exists, so car_count and the site's worker_cost are
--    unchanged; only the submitter's personal rows lose it. job_daily_stats /
--    job_daily_totals gain a trailing worker_label (set on that row only).
-- ---------------------------------------------------------------------------

create or replace view job_daily_stats as
  select
    j.site_id,
    c.person as worker_id,
    l.service_id,
    date_trunc('day', j.created_at)::date as day,
    count(*) as job_count,
    sum(case when c.ord = 1 then l.submitter_share else l.coworker_share end) as worker_cost,
    count(*) filter (where c.ord = 1) as car_count,
    case when c.ord = 1 then j.worker_label end as worker_label
  from jobs j
  join job_service_lines l on l.job_id = j.id
  cross join lateral unnest(array[case when j.worker_label is null then j.worker_id end] || j.coworker_ids)
    with ordinality as c(person, ord)
  where j.deleted_at is null
  group by j.site_id, c.person, l.service_id, date_trunc('day', j.created_at),
           case when c.ord = 1 then j.worker_label end;

alter view job_daily_stats set (security_invoker = true);

create or replace view job_daily_totals as
  select
    j.site_id,
    c.person as worker_id,
    date_trunc('day', j.created_at)::date as day,
    count(*) as job_count,
    count(*) filter (where c.ord = 1) as car_count,
    sum(case when c.ord = 1 then j.submitter_share else j.coworker_share end) as worker_cost,
    case when c.ord = 1 then j.worker_label end as worker_label
  from jobs j
  cross join lateral unnest(array[case when j.worker_label is null then j.worker_id end] || j.coworker_ids)
    with ordinality as c(person, ord)
  where j.deleted_at is null
    and exists (select 1 from job_services js where js.job_id = j.id)
  group by j.site_id, c.person, date_trunc('day', j.created_at),
           case when c.ord = 1 then j.worker_label end;

alter view job_daily_totals set (security_invoker = true);
revoke all on job_daily_totals from anon;

create or replace view job_monthly_stats as
  select
    j.site_id,
    c.person as worker_id,
    date_trunc('month', j.created_at)::date as month,
    count(*) as job_count
  from jobs j
  cross join lateral unnest(array[case when j.worker_label is null then j.worker_id end] || j.coworker_ids)
    as c(person)
  where j.deleted_at is null
  group by j.site_id, c.person, date_trunc('month', j.created_at);

alter view job_monthly_stats set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 6. jobs_manager and jobs_worker_view: 0033 text + trailing worker_label.
--    A worker never owns a labelled job, but a co-worker on one must see the
--    typed name rather than the submitter's.
-- ---------------------------------------------------------------------------

create or replace view jobs_worker_view as
  select j.id, j.site_id, j.worker_id, j.created_at, j.updated_at, j.plate, j.vin,
         j.vin_valid_checksum, j.brand, j.worker_note, j.locked_at,
         j.duplicate_of_job_id, j.deleted_at,
         j.service_id, j.worker_price,
         j.coworker_ids, j.submitter_share, j.coworker_share,
         coalesce(x.service_ids, '{}') as service_ids,
         coalesce(x.services, '[]'::jsonb) as services,
         j.worker_label
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
         coalesce(x.services, '[]'::jsonb) as services,
         j.worker_label
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

-- ---------------------------------------------------------------------------
-- 7. jobs_carasso (0038 text): crew starts with the label instead of the
--    submitter's name; worker_id is NULL for a labelled job (so carasso_crew
--    never lists the submitter). Both still blank while names are hidden.
--    Same 21 columns, order and types; still owner-rights.
-- ---------------------------------------------------------------------------

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
         case when h.hide or j.worker_label is not null then null else j.worker_id end as worker_id,
         case when h.hide then '{}'::uuid[] else j.coworker_ids end as coworker_ids,
         case when h.hide then null else (
           select string_agg(coalesce(case when c.ord = 1 then j.worker_label end, cu.name),
                             ', ' order by c.ord)
           from unnest(array[j.worker_id] || j.coworker_ids) with ordinality as c(person, ord)
           left join users cu on cu.id = c.person
         ) end as crew,
         case when h.hide_prices then null else cp.unit_price end  as client_unit_price,
         case when h.hide_prices then null else cp.total_price end as client_total_price,
         coalesce(x.service_ids, '{}') as service_ids,
         coalesce(x.services, '[]'::jsonb) as services
  from jobs j
  join current_app_user() me on true
  cross join lateral (
    select me.role = 'carasso'
           and coalesce((select a.value = 'true'::jsonb
                         from app_settings a where a.key = 'hide_worker_names'), false) as hide,
           me.role = 'carasso'
           and coalesce((select a.value = 'true'::jsonb
                         from app_settings a where a.key = 'hide_client_prices'), false) as hide_prices
  ) h
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
             'client_unit_price', case when h.hide_prices then null else lp.unit_price end,
             'client_total_price', case when h.hide_prices then null else lp.total_price end
           ) order by sv.sort_order, sv.id) as services
    from job_services js
    join services sv on sv.id = js.service_id
    left join job_service_client_prices lp on lp.job_id = js.job_id and lp.service_id = js.service_id
    where js.job_id = j.id
  ) x on true
  where j.deleted_at is null
    and (me.role = 'admin'
         or (me.role = 'carasso'
             and exists (select 1 from user_sites us
                         where us.user_id = me.id and us.site_id = j.site_id)));

revoke all on jobs_carasso from public, anon, authenticated;
grant select on jobs_carasso to authenticated;

-- ---------------------------------------------------------------------------
-- 8. list_staff: 0032's columns, 0028's checks (staff callers only, carasso
--    accounts never listed).
-- ---------------------------------------------------------------------------

create or replace function list_staff()
returns table (id uuid, name text, site_id uuid, active boolean, role user_role)
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
  select u.id, u.name, u.site_id, u.active, u.role
  from users u
  where u.role <> 'carasso'
  order by u.name;
end;
$$;

revoke all on function list_staff() from public, anon;
grant execute on function list_staff() to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- DOWN (manual; run the web build without worker_label first). Labels are
-- lost and labelled jobs count as their submitter's pay again. The list_staff
-- fix stays. Views that gained a column are dropped and recreated
-- (create or replace cannot drop a column).
-- ---------------------------------------------------------------------------
-- begin;
-- set local lock_timeout = '5s';
--
-- drop function create_job(uuid, uuid, text, text, boolean, text, text, uuid[], uuid[], text);
-- create function create_job(
--   p_site_id            uuid,
--   p_worker_id          uuid,
--   p_plate              text,
--   p_vin                text,
--   p_vin_valid_checksum boolean,
--   p_brand              text,
--   p_worker_note        text,
--   p_coworker_ids       uuid[],
--   p_service_ids        uuid[]
-- )
-- returns uuid
-- language plpgsql
-- security invoker
-- set search_path = public
-- as $$
-- declare
--   ids    uuid[];
--   new_id uuid;
-- begin
--   ids := array(
--     select x from unnest(p_service_ids) with ordinality as t(x, n)
--     where x is not null
--     group by x
--     order by min(n)
--   );
--   if cardinality(ids) = 0 then
--     raise exception 'a job needs at least one service' using errcode = 'check_violation';
--   end if;
--
--   insert into jobs (site_id, worker_id, plate, vin, vin_valid_checksum, brand,
--                     worker_note, coworker_ids, service_id)
--   values (p_site_id, p_worker_id, p_plate, p_vin, p_vin_valid_checksum, p_brand,
--           p_worker_note, coalesce(p_coworker_ids, '{}'), ids[1])
--   returning id into new_id;
--
--   insert into job_services (job_id, service_id, worker_price)
--   select new_id, x, coalesce((select s.worker_price from services s where s.id = x), 0)
--   from unnest(ids[2:]) as x
--   on conflict do nothing;
--
--   return new_id;
-- end;
-- $$;
-- revoke all on function create_job(uuid, uuid, text, text, boolean, text, text, uuid[], uuid[]) from public, anon;
-- grant execute on function create_job(uuid, uuid, text, text, boolean, text, text, uuid[], uuid[]) to authenticated;
--
-- drop policy jobs_insert on jobs;
-- create policy jobs_insert on jobs for insert
--   with check (
--     exists (
--       select 1 from current_app_user() u
--       where u.id = jobs.worker_id and u.role in ('worker', 'manager', 'admin')
--     )
--   );
--
-- drop view job_daily_stats;
-- create view job_daily_stats as
--   select
--     j.site_id,
--     c.person as worker_id,
--     l.service_id,
--     date_trunc('day', j.created_at)::date as day,
--     count(*) as job_count,
--     sum(case when c.ord = 1 then l.submitter_share else l.coworker_share end) as worker_cost,
--     count(*) filter (where c.ord = 1) as car_count
--   from jobs j
--   join job_service_lines l on l.job_id = j.id
--   cross join lateral unnest(array[j.worker_id] || j.coworker_ids) with ordinality as c(person, ord)
--   where j.deleted_at is null
--   group by j.site_id, c.person, l.service_id, date_trunc('day', j.created_at);
-- alter view job_daily_stats set (security_invoker = true);
--
-- drop view job_daily_totals;
-- create view job_daily_totals as
--   select
--     j.site_id,
--     c.person as worker_id,
--     date_trunc('day', j.created_at)::date as day,
--     count(*) as job_count,
--     count(*) filter (where c.ord = 1) as car_count,
--     sum(case when c.ord = 1 then j.submitter_share else j.coworker_share end) as worker_cost
--   from jobs j
--   cross join lateral unnest(array[j.worker_id] || j.coworker_ids) with ordinality as c(person, ord)
--   where j.deleted_at is null
--     and exists (select 1 from job_services js where js.job_id = j.id)
--   group by j.site_id, c.person, date_trunc('day', j.created_at);
-- alter view job_daily_totals set (security_invoker = true);
-- revoke all on job_daily_totals from anon;
--
-- create or replace view job_monthly_stats as
--   select
--     j.site_id,
--     c.person as worker_id,
--     date_trunc('month', j.created_at)::date as month,
--     count(*) as job_count
--   from jobs j
--   cross join lateral unnest(array[j.worker_id] || j.coworker_ids) as c(person)
--   where j.deleted_at is null
--   group by j.site_id, c.person, date_trunc('month', j.created_at);
-- alter view job_monthly_stats set (security_invoker = true);
--
-- drop view jobs_worker_view;
-- create view jobs_worker_view as
--   select j.id, j.site_id, j.worker_id, j.created_at, j.updated_at, j.plate, j.vin,
--          j.vin_valid_checksum, j.brand, j.worker_note, j.locked_at,
--          j.duplicate_of_job_id, j.deleted_at,
--          j.service_id, j.worker_price,
--          j.coworker_ids, j.submitter_share, j.coworker_share,
--          coalesce(x.service_ids, '{}') as service_ids,
--          coalesce(x.services, '[]'::jsonb) as services
--   from jobs j
--   left join lateral (
--     select array_agg(l.service_id order by l.sort_order, l.service_id) as service_ids,
--            jsonb_agg(jsonb_build_object(
--              'service_id', l.service_id,
--              'name_en', sv.name_en, 'name_ru', sv.name_ru, 'name_he', sv.name_he,
--              'catalog_number', sv.catalog_number,
--              'worker_price', l.worker_price,
--              'submitter_share', l.submitter_share,
--              'coworker_share', l.coworker_share
--            ) order by l.sort_order, l.service_id) as services
--     from job_service_lines l
--     left join services sv on sv.id = l.service_id
--     where l.job_id = j.id
--   ) x on true;
-- alter view jobs_worker_view set (security_invoker = true);
--
-- drop view jobs_manager;
-- create view jobs_manager as
--   select j.id, j.site_id, j.worker_id, j.created_at, j.updated_at, j.plate, j.vin,
--          j.vin_valid_checksum, j.brand, j.worker_note, j.locked_at,
--          j.duplicate_of_job_id, j.deleted_at, j.service_id, j.worker_price,
--          j.coworker_ids, j.coworker_share, j.submitter_share,
--          b.billing_code, b.manager_note,
--          coalesce(x.service_ids, '{}') as service_ids,
--          coalesce(x.services, '[]'::jsonb) as services
--   from jobs j
--   left join job_billing b on b.job_id = j.id
--   left join lateral (
--     select array_agg(l.service_id order by l.sort_order, l.service_id) as service_ids,
--            jsonb_agg(jsonb_build_object(
--              'service_id', l.service_id,
--              'name_en', sv.name_en, 'name_ru', sv.name_ru, 'name_he', sv.name_he,
--              'catalog_number', sv.catalog_number,
--              'worker_price', l.worker_price,
--              'submitter_share', l.submitter_share,
--              'coworker_share', l.coworker_share
--            ) order by l.sort_order, l.service_id) as services
--     from job_service_lines l
--     left join services sv on sv.id = l.service_id
--     where l.job_id = j.id
--   ) x on true;
-- alter view jobs_manager set (security_invoker = true);
--
-- create or replace view jobs_carasso as
--   select j.id,
--          j.site_id,
--          s.name as site_name,
--          j.created_at,
--          j.plate,
--          j.vin,
--          j.brand,
--          j.worker_note,
--          j.service_id,
--          x.name_en as service_name_en,
--          x.name_ru as service_name_ru,
--          x.name_he as service_name_he,
--          x.catalog_number,
--          b.billing_code,
--          case when h.hide then null else j.worker_id end as worker_id,
--          case when h.hide then '{}'::uuid[] else j.coworker_ids end as coworker_ids,
--          case when h.hide then null else (
--            select string_agg(cu.name, ', ' order by c.ord)
--            from unnest(array[j.worker_id] || j.coworker_ids) with ordinality as c(person, ord)
--            join users cu on cu.id = c.person
--          ) end as crew,
--          case when h.hide_prices then null else cp.unit_price end  as client_unit_price,
--          case when h.hide_prices then null else cp.total_price end as client_total_price,
--          coalesce(x.service_ids, '{}') as service_ids,
--          coalesce(x.services, '[]'::jsonb) as services
--   from jobs j
--   join current_app_user() me on true
--   cross join lateral (
--     select me.role = 'carasso'
--            and coalesce((select a.value = 'true'::jsonb
--                          from app_settings a where a.key = 'hide_worker_names'), false) as hide,
--            me.role = 'carasso'
--            and coalesce((select a.value = 'true'::jsonb
--                          from app_settings a where a.key = 'hide_client_prices'), false) as hide_prices
--   ) h
--   join sites s on s.id = j.site_id
--   left join job_billing b on b.job_id = j.id
--   left join job_client_prices cp on cp.job_id = j.id
--   left join lateral (
--     select string_agg(sv.name_en, ', ' order by sv.sort_order, sv.id) as name_en,
--            string_agg(coalesce(sv.name_ru, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_ru,
--            string_agg(coalesce(sv.name_he, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_he,
--            string_agg(sv.catalog_number, ', ' order by sv.sort_order, sv.id) as catalog_number,
--            array_agg(sv.id order by sv.sort_order, sv.id) as service_ids,
--            jsonb_agg(jsonb_build_object(
--              'service_id', sv.id,
--              'name_en', sv.name_en, 'name_ru', sv.name_ru, 'name_he', sv.name_he,
--              'catalog_number', sv.catalog_number,
--              'client_unit_price', case when h.hide_prices then null else lp.unit_price end,
--              'client_total_price', case when h.hide_prices then null else lp.total_price end
--            ) order by sv.sort_order, sv.id) as services
--     from job_services js
--     join services sv on sv.id = js.service_id
--     left join job_service_client_prices lp on lp.job_id = js.job_id and lp.service_id = js.service_id
--     where js.job_id = j.id
--   ) x on true
--   where j.deleted_at is null
--     and (me.role = 'admin'
--          or (me.role = 'carasso'
--              and exists (select 1 from user_sites us
--                          where us.user_id = me.id and us.site_id = j.site_id)));
-- revoke all on jobs_carasso from public, anon, authenticated;
-- grant select on jobs_carasso to authenticated;
--
-- -- jobs_audit back to 0034 (before the column goes: the body names it).
-- create or replace function jobs_audit()
-- returns trigger
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$
-- declare
--   caller users;
--   diff   jsonb;
-- begin
--   select * into caller from current_app_user();
--   if caller.id is null or caller.role not in ('manager', 'admin') then
--     return null;
--   end if;
--
--   diff := audit_diff(to_jsonb(old), to_jsonb(new), array[
--     'plate', 'vin', 'vin_valid_checksum', 'brand', 'worker_note', 'created_at',
--     'worker_id', 'coworker_ids', 'site_id', 'deleted_at']);
--   if diff = '{}'::jsonb then
--     return null;
--   end if;
--
--   insert into audit_log (job_id, user_id, action, changes)
--   values (new.id, caller.id,
--           case when old.deleted_at is null and new.deleted_at is not null then 'soft_delete'
--                when old.deleted_at is not null and new.deleted_at is null then 'restore'
--                else 'update' end,
--           diff);
--   return null;
-- end;
-- $$;
--
-- -- The 'create_on_behalf' audit rows stay (history); only new ones stop.
-- drop trigger jobs_audit_on_behalf on jobs;
-- drop function jobs_audit_on_behalf();
--
-- drop trigger jobs_guard_worker_label on jobs;
-- drop function jobs_guard_worker_label();
-- alter table jobs drop column worker_label;
--
-- commit;
