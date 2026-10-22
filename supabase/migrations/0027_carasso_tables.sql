-- ===========================================================================
-- 0027 — Carasso: site links, app settings, client prices (step 2 of 5)
--
-- Apply after 0026 (committed). Nothing here changes what an existing role can
-- read; the access changes are in 0028.
--
--   user_sites              which sites a Carasso user may see (admin-managed)
--   app_settings            admin switches + the ONE customer-report layout
--   service_client_prices   catalog client price (what the importer is billed)
--   job_client_prices       that price snapshotted onto each job
--
-- Client prices live in their own tables, not as columns on `services` / `jobs`:
-- workers SELECT their jobs and everybody reads services, and column grants
-- cannot split roles that all arrive as `authenticated` (same reasoning as
-- 0023). The only real boundary is a different table.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. user_sites — a Carasso user's sites (many-to-many, admin-managed)
--    users.site_id stays for the other roles and is NULL for Carasso.
-- ---------------------------------------------------------------------------

create table user_sites (
  user_id  uuid not null references users (id) on delete cascade,
  site_id  uuid not null references sites (id) on delete cascade,
  primary key (user_id, site_id)
);

create index user_sites_site_idx on user_sites (site_id);

alter table user_sites enable row level security;
revoke all on user_sites from anon;

-- A user reads their own links; admins read and write everything. Nobody else.
create policy user_sites_select on user_sites for select
  using (exists (
    select 1 from current_app_user() u
    where u.role = 'admin' or u.id = user_sites.user_id
  ));
create policy user_sites_write on user_sites for all
  using (exists (select 1 from current_app_user() u where u.role = 'admin'))
  with check (exists (select 1 from current_app_user() u where u.role = 'admin'));

-- Backstop for the invite flow and the Users screen: Carasso is scoped by
-- user_sites, never by users.site_id (which the other roles' policies key on).
alter table users
  add constraint users_carasso_no_site_chk check (role <> 'carasso' or site_id is null);

-- ---------------------------------------------------------------------------
-- 2. app_settings — admin switches and the single customer-report layout
--
-- No INSERT/UPDATE/DELETE policy exists, so the API cannot write it directly;
-- the two admin-only RPCs below are the only write path, and they validate.
-- ---------------------------------------------------------------------------

create table app_settings (
  key         text primary key check (key in ('hide_worker_names', 'customer_report_config')),
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table app_settings enable row level security;
revoke all on app_settings from anon;

-- Workers never need either value. Managers read the layout, Carasso reads
-- both (to know whether the Worker column is available).
create policy app_settings_select on app_settings for select
  using (exists (
    select 1 from current_app_user() u where u.role in ('admin', 'manager', 'carasso')
  ));

insert into app_settings (key, value) values
  ('hide_worker_names', 'false'::jsonb),
  ('customer_report_config', '{
    "columns": [
      {"key": "date",               "visible": true},
      {"key": "site",               "visible": true},
      {"key": "brand",              "visible": true},
      {"key": "plate",              "visible": true},
      {"key": "vin",                "visible": true},
      {"key": "service",            "visible": true},
      {"key": "catalog_number",     "visible": false},
      {"key": "billing_code",       "visible": true},
      {"key": "worker",             "visible": true},
      {"key": "client_unit_price",  "visible": true},
      {"key": "client_total_price", "visible": true}
    ]
  }'::jsonb)
on conflict (key) do nothing;

create or replace function set_hide_worker_names(p_hide boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from current_app_user() u where u.role = 'admin') then
    raise exception 'forbidden';
  end if;
  if p_hide is null then
    raise exception 'invalid value';
  end if;
  update app_settings set value = to_jsonb(p_hide), updated_at = now()
  where key = 'hide_worker_names';
end;
$$;

revoke all on function set_hide_worker_names(boolean) from public, anon;
grant execute on function set_hide_worker_names(boolean) to authenticated;

-- Same name and argument as 0005/0007/0013 so the existing call keeps working,
-- but it now writes the ONE global layout and is admin-only. (The old per-site
-- version saved to the caller's own site, so an admin editing another site's
-- layout silently overwrote their own site's.)
create or replace function update_customer_report_config(new_config jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from current_app_user() u where u.role = 'admin') then
    raise exception 'forbidden';
  end if;

  -- coalesce: jsonb_typeof(NULL) is NULL, and `NULL <> 'array'` would let a
  -- config with no "columns" key slip through the check.
  if coalesce(jsonb_typeof(new_config), '') <> 'object'
     or coalesce(jsonb_typeof(new_config -> 'columns'), '') <> 'array' then
    raise exception 'invalid config: expected { "columns": [...] }';
  end if;

  -- The allowlist. Worker PAY (`worker_price`) is absent on purpose and must
  -- stay absent. The client price keys are allowed here because the layout is
  -- one shared document; the web client strips them for managers, who also
  -- cannot read the prices at all.
  if exists (
    select 1
    from jsonb_array_elements(new_config -> 'columns') as entry
    where jsonb_typeof(entry) <> 'object'
       or entry ->> 'key' is null
       or entry ->> 'key' not in (
            'date', 'site', 'brand', 'plate', 'vin', 'service', 'catalog_number',
            'billing_code', 'worker', 'client_unit_price', 'client_total_price'
          )
  ) then
    raise exception 'invalid config: unknown or forbidden column key';
  end if;

  update app_settings set value = new_config, updated_at = now()
  where key = 'customer_report_config';
end;
$$;

revoke all on function update_customer_report_config(jsonb) from public, anon;
grant execute on function update_customer_report_config(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. service_client_prices — the catalog client price (admin only)
--
-- Entered by hand, never calculated, no VAT. Both columns NOT NULL: a row
-- either holds a full price or does not exist.
-- ---------------------------------------------------------------------------

create table service_client_prices (
  service_id   uuid primary key references services (id),
  unit_price   numeric not null check (unit_price >= 0),
  total_price  numeric not null check (total_price >= 0),
  updated_at   timestamptz not null default now()
);

create trigger service_client_prices_set_updated_at
  before update on service_client_prices
  for each row execute function set_updated_at();

alter table service_client_prices enable row level security;
revoke all on service_client_prices from anon;

create policy service_client_prices_admin on service_client_prices for all
  using (exists (select 1 from current_app_user() u where u.role = 'admin'))
  with check (exists (select 1 from current_app_user() u where u.role = 'admin'));

-- "Required for active services" cannot be a CHECK across two tables, and
-- PostgREST runs one statement per request, so the rule is enforced where the
-- state actually changes:
--   * a service may not BECOME active (and not deleted) without a price row;
--   * a price row may not be removed from an active service.
-- Consequence for the catalog screen: a NEW service is created inactive
-- (draft), priced by an admin, then activated. Managers can still insert
-- services (0004) but, never being able to price one, only as drafts.
create or replace function services_require_client_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only a service BECOMING live is checked. Renaming one that already is (a
  -- whole-row update re-sends `active`) must not be blocked on a price.
  -- (nested: OLD does not exist on INSERT, and AND does not short-circuit)
  if tg_op = 'UPDATE' then
    if old.active and old.deleted_at is null then
      return new;
    end if;
  end if;

  if new.active and new.deleted_at is null
     and not exists (select 1 from service_client_prices p where p.service_id = new.id) then
    raise exception 'an active service needs client prices; set them first (a new service starts inactive)';
  end if;
  return new;
end;
$$;

create trigger services_require_client_price
  before insert or update of active, deleted_at on services
  for each row execute function services_require_client_price();

create or replace function service_client_prices_keep_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from services s where s.id = old.service_id and s.active and s.deleted_at is null) then
    raise exception 'cannot remove the client prices of an active service';
  end if;
  return old;
end;
$$;

create trigger service_client_prices_keep_active
  before delete on service_client_prices
  for each row execute function service_client_prices_keep_active();

-- ---------------------------------------------------------------------------
-- 4. job_client_prices — the snapshot, plus the admin's per-job override
--
-- Read: admin, and Carasso for jobs on their sites (can_view_job, 0028 — a
-- policy subquery on `jobs` would run under Carasso's own, empty, jobs RLS).
-- Write: admin only. Managers and workers have no policy, so no access.
-- ---------------------------------------------------------------------------

create table job_client_prices (
  job_id       uuid primary key references jobs (id) on delete cascade,
  unit_price   numeric check (unit_price >= 0),
  total_price  numeric check (total_price >= 0),
  updated_at   timestamptz not null default now()
);

create trigger job_client_prices_set_updated_at
  before update on job_client_prices
  for each row execute function set_updated_at();

alter table job_client_prices enable row level security;
revoke all on job_client_prices from anon;

create policy job_client_prices_admin on job_client_prices for all
  using (exists (select 1 from current_app_user() u where u.role = 'admin'))
  with check (exists (select 1 from current_app_user() u where u.role = 'admin'));

-- Snapshot: same idea as jobs_apply_worker_price (0005), but security definer
-- because the caller (a worker) has no write access to this table at all.
-- AFTER trigger: the row's FK needs the job to exist. A service with no price
-- row (draft / legacy) leaves the prices NULL.
create or replace function jobs_snapshot_client_prices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into job_client_prices (job_id) values (new.id)
  on conflict (job_id) do nothing;

  update job_client_prices
  set unit_price  = (select p.unit_price  from service_client_prices p where p.service_id = new.service_id),
      total_price = (select p.total_price from service_client_prices p where p.service_id = new.service_id)
  where job_id = new.id;

  return null;
end;
$$;

create trigger jobs_snapshot_client_prices_ins
  after insert on jobs
  for each row execute function jobs_snapshot_client_prices();

-- A job whose service is changed afterwards (worker inside the 15-minute
-- window, manager or admin later) is re-priced from the new service. This
-- overwrites an admin's per-job override: change the service first, then
-- override.
create trigger jobs_snapshot_client_prices_upd
  after update of service_id on jobs
  for each row
  when (new.service_id is distinct from old.service_id)
  execute function jobs_snapshot_client_prices();

commit;
