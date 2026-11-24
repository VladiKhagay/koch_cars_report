-- 0041: admins rename, disable and delete sites.
--
-- Rename needs nothing here: everything refers to a site by id, so history
-- follows the new name, and sites.name stays UNIQUE (23505 on a duplicate).
--
-- Rules (database, never only the UI):
--   * only admins write sites: sites_write (0001) is admin-only and no other
--     policy, grant or definer function writes the table (0005's manager RPC
--     writes app_settings since 0027).
--   * a disabled site (`active = false`) takes no new job: jobs_insert checks
--     it, so create_job (security invoker) and a direct insert are both
--     refused with 42501. Existing jobs, edits, stats, exports and users'
--     access are unchanged.
--   * a site is deleted only while nothing refers to it: the FKs from
--     users.site_id and user_sites.site_id become NO ACTION (were SET NULL /
--     CASCADE), like jobs.site_id already was, so deleting a site with jobs,
--     users or viewer links fails with 23503 and the admin is told to disable
--     it instead.
--
-- Deploy order: 0041, THEN the web build. The new web selects sites.active,
-- which the old schema does not have. The old web keeps working on 0041 (it
-- never reads the column; a job at a disabled site is refused by the DB).
--
-- Rollback: web first, then the DOWN at the bottom.
--
-- Base: jobs_insert 0040 (body copied unchanged inside the new check).

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Disabled sites
-- ---------------------------------------------------------------------------

alter table sites add column active boolean not null default true;
comment on column sites.active is
  'false = disabled by an admin: no new jobs (jobs_insert), hidden from new-job, user and invite pickers; history unchanged (0041).';

-- ---------------------------------------------------------------------------
-- 2. Delete only an unused site: NO ACTION on every FK to sites
--    (jobs.site_id is NO ACTION since 0001). Names looked up, not assumed.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.sites'::regclass
      and c.conrelid in ('public.users'::regclass, 'public.user_sites'::regclass)
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table users
  add constraint users_site_id_fkey foreign key (site_id) references sites (id);
alter table user_sites
  add constraint user_sites_site_id_fkey foreign key (site_id) references sites (id);

-- ---------------------------------------------------------------------------
-- 3. Who may insert a job: as 0040, and only at an active site.
--    sites is readable by every staff role (sites_select, 0028).
-- ---------------------------------------------------------------------------

drop policy jobs_insert on jobs;
create policy jobs_insert on jobs for insert
  with check (
    exists (select 1 from sites s where s.id = jobs.site_id and s.active)
    and exists (
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

commit;

-- ---------------------------------------------------------------------------
-- DOWN (manual; run the web build without sites.active first). Disabled sites
-- take jobs again; deleting a site again clears users.site_id and drops its
-- viewer links.
-- ---------------------------------------------------------------------------
-- begin;
-- set local lock_timeout = '5s';
--
-- drop policy jobs_insert on jobs;
-- create policy jobs_insert on jobs for insert
--   with check (
--     exists (
--       select 1 from current_app_user() u
--       where u.role in ('worker', 'manager', 'admin')
--         and (
--           (u.id = jobs.worker_id
--            and (jobs.worker_label is null or u.role in ('manager', 'admin'))
--            and (u.role <> 'manager' or jobs.worker_label is null or jobs.site_id = u.site_id))
--           or
--           (jobs.worker_label is null
--            and u.role in ('manager', 'admin')
--            and exists (
--              select 1 from users w
--              where w.id = jobs.worker_id
--                and w.role = 'worker'
--                and w.active
--                and (u.role = 'admin'
--                     or (w.site_id = u.site_id and jobs.site_id = u.site_id))))
--         )
--     )
--   );
--
-- alter table users drop constraint users_site_id_fkey;
-- alter table users
--   add constraint users_site_id_fkey foreign key (site_id) references sites (id) on delete set null;
-- alter table user_sites drop constraint user_sites_site_id_fkey;
-- alter table user_sites
--   add constraint user_sites_site_id_fkey foreign key (site_id) references sites (id) on delete cascade;
--
-- alter table sites drop column active;
--
-- commit;
