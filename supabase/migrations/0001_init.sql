-- Vehicle Prep Job-Tracking System — initial schema
-- Roles are stored in auth.users.raw_app_meta_data->>'role' is NOT used;
-- instead we keep a public.users table linked 1:1 to auth.users so we can
-- join site/role cheaply and enforce RLS against real columns.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Reference tables
-- ---------------------------------------------------------------------------

create table sites (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table services (
  id          uuid primary key default gen_random_uuid(),
  name_en     text not null,
  name_ru     text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Users (1:1 with auth.users, extends it with role + site)
-- ---------------------------------------------------------------------------

create type user_role as enum ('worker', 'manager', 'admin');

create table users (
  id          uuid primary key default gen_random_uuid(),
  auth_id     uuid not null unique references auth.users (id) on delete cascade,
  name        text not null,
  role        user_role not null default 'worker',
  site_id     uuid references sites (id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index users_auth_id_idx on users (auth_id);
create index users_site_id_idx on users (site_id);

-- Helper: current app user row for the logged-in auth session.
create or replace function current_app_user()
returns users
language sql
stable
security definer
set search_path = public
as $$
  select * from users where auth_id = auth.uid() and active = true limit 1;
$$;

-- Admin-only helper: resolves an email to its auth.users id, so the Admin >
-- Users screen can link a public.users profile to an account WITHOUT ever
-- handling a service-role key in the browser. The account itself must
-- already exist (created via Supabase Studio > Authentication > "Invite
-- user", or the user signing up) — this function only looks it up.
create or replace function admin_lookup_auth_id(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  result uuid;
begin
  if not exists (select 1 from current_app_user() u where u.role = 'admin') then
    raise exception 'forbidden';
  end if;
  select id into result from auth.users where email = p_email;
  return result;
end;
$$;

revoke all on function admin_lookup_auth_id(text) from public;
grant execute on function admin_lookup_auth_id(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Jobs (the core record — one per finished vehicle)
-- ---------------------------------------------------------------------------

create table jobs (
  id                uuid primary key default gen_random_uuid(),
  site_id           uuid not null references sites (id),
  worker_id         uuid not null references users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  plate             text not null,
  vin               text not null,
  vin_valid_checksum boolean,           -- soft flag; not all countries use ISO 3779
  brand             text,               -- decoded from VIN WMI, editable

  worker_note       text,
  manager_note      text,
  billing_code      text,

  locked_at         timestamptz not null default (now() + interval '15 minutes'),
  duplicate_of_job_id uuid references jobs (id),

  deleted_at        timestamptz         -- soft delete only
);

create index jobs_site_created_idx on jobs (site_id, created_at desc);
create index jobs_vin_idx on jobs (vin);
create index jobs_plate_idx on jobs (plate);
create index jobs_worker_idx on jobs (worker_id);

create table job_services (
  job_id      uuid not null references jobs (id) on delete cascade,
  service_id  uuid not null references services (id),
  primary key (job_id, service_id)
);

create table photos (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs (id) on delete cascade,
  kind        text not null check (kind in ('plate', 'vin')),
  r2_key      text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '90 days')
);

create index photos_job_id_idx on photos (job_id);
create index photos_expires_at_idx on photos (expires_at);

create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references jobs (id) on delete set null,
  user_id     uuid references users (id),
  action      text not null,          -- 'create' | 'update' | 'soft_delete' | 'restore'
  changes     jsonb,
  at          timestamptz not null default now()
);

create index audit_log_job_id_idx on audit_log (job_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger jobs_set_updated_at
  before update on jobs
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table sites enable row level security;
alter table services enable row level security;
alter table users enable row level security;
alter table jobs enable row level security;
alter table job_services enable row level security;
alter table photos enable row level security;
alter table audit_log enable row level security;

-- sites: everyone authenticated can read (needed for login/site pickers);
-- only admins write.
create policy sites_select on sites for select
  using (auth.uid() is not null);
create policy sites_write on sites for all
  using (exists (select 1 from current_app_user() u where u.role = 'admin'))
  with check (exists (select 1 from current_app_user() u where u.role = 'admin'));

-- services: everyone authenticated can read active services; admins manage.
create policy services_select on services for select
  using (auth.uid() is not null);
create policy services_write on services for all
  using (exists (select 1 from current_app_user() u where u.role = 'admin'))
  with check (exists (select 1 from current_app_user() u where u.role = 'admin'));

-- users: a user can read their own row; managers/admins can read their site
-- (admins: all sites). Only admins write.
create policy users_select on users for select
  using (
    auth_id = auth.uid()
    or exists (
      select 1 from current_app_user() u
      where u.role = 'admin'
         or (u.role = 'manager' and u.site_id = users.site_id)
    )
  );
create policy users_write on users for all
  using (exists (select 1 from current_app_user() u where u.role = 'admin'))
  with check (exists (select 1 from current_app_user() u where u.role = 'admin'));

-- jobs:
--  - workers: select/insert/update their own jobs at their own site,
--    update only while not locked (locked_at in the future) and not deleted.
--    workers never see billing_code/manager_note (enforced at the API/view
--    layer — see jobs_worker_view below — RLS alone can't hide columns).
--  - managers/admins: full read/write within their site (admins: all sites).
create policy jobs_select on jobs for select
  using (
    exists (
      select 1 from current_app_user() u
      where u.role = 'admin'
         or (u.role in ('manager','worker') and u.site_id = jobs.site_id)
    )
  );

create policy jobs_insert on jobs for insert
  with check (
    exists (
      select 1 from current_app_user() u
      where u.id = jobs.worker_id
        and u.site_id = jobs.site_id
        and (u.role = 'admin' or u.site_id = jobs.site_id)
    )
  );

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
      where u.role = 'admin'
         or (u.role = 'manager' and u.site_id = jobs.site_id)
         or (u.role = 'worker' and u.id = jobs.worker_id and jobs.locked_at > now())
    )
  );

-- job_services: follow the parent job's visibility/edit rules.
create policy job_services_select on job_services for select
  using (exists (select 1 from jobs j where j.id = job_services.job_id));
create policy job_services_write on job_services for all
  using (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = job_services.job_id
      and (u.role = 'admin'
           or (u.role = 'manager' and u.site_id = j.site_id)
           or (u.role = 'worker' and u.id = j.worker_id and j.locked_at > now()))
  ))
  with check (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = job_services.job_id
      and (u.role = 'admin'
           or (u.role = 'manager' and u.site_id = j.site_id)
           or (u.role = 'worker' and u.id = j.worker_id and j.locked_at > now()))
  ));

-- photos: readable/writable by anyone who can see the parent job.
create policy photos_select on photos for select
  using (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = photos.job_id
      and (u.role = 'admin' or u.site_id = j.site_id)
  ));
create policy photos_insert on photos for insert
  with check (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = photos.job_id
      and (u.role = 'admin'
           or (u.role = 'manager' and u.site_id = j.site_id)
           or (u.role = 'worker' and u.id = j.worker_id and j.locked_at > now()))
  ));

-- audit_log: managers/admins of the relevant site can read.
-- Inserts are allowed from the frontend (with the user's own JWT, no
-- service-role key involved) for exactly the same set of jobs that user is
-- allowed to update — see web/src/lib/audit.ts, called right after every
-- jobs/job_services mutation in JobDetail and MyJobs.
create policy audit_log_select on audit_log for select
  using (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = audit_log.job_id
      and (u.role = 'admin' or (u.role = 'manager' and u.site_id = j.site_id))
  ));

create policy audit_log_insert on audit_log for insert
  with check (
    user_id = (select id from current_app_user())
    and exists (
      select 1 from jobs j
      join current_app_user() u on true
      where j.id = audit_log.job_id
        and (u.role = 'admin'
             or (u.role = 'manager' and u.site_id = j.site_id)
             or (u.role = 'worker' and u.id = j.worker_id and j.locked_at > now()))
    )
  );

-- ---------------------------------------------------------------------------
-- Worker-safe view: hides billing_code / manager_note from the worker role.
-- The frontend queries this view for the worker "my recent jobs" screen.
-- ---------------------------------------------------------------------------

create view jobs_worker_view as
  select id, site_id, worker_id, created_at, updated_at, plate, vin,
         vin_valid_checksum, brand, worker_note, locked_at,
         duplicate_of_job_id, deleted_at
  from jobs;

alter view jobs_worker_view set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- Seed data (adjust before first deploy)
-- ---------------------------------------------------------------------------

insert into services (name_en, name_ru, sort_order) values
  ('Exterior wash', 'Мойка кузова', 1),
  ('Interior vacuum', 'Уборка салона', 2),
  ('Full detail', 'Полная детейлинг-обработка', 3),
  ('Polish', 'Полировка', 4),
  ('Engine bay clean', 'Мойка моторного отсека', 5);
