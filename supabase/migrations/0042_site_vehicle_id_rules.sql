-- 0042: per-site rules for the VIN and the plate on a new job.
--
-- An admin sets, per site, whether the VIN is required or optional and
-- whether the plate is required or optional. The defaults (VIN required,
-- plate optional) are the 0036 rule, so every existing site behaves exactly
-- as before until an admin changes it.
--
-- Rules (database, never only the UI):
--   * only admins write the rules: they are columns on sites, and sites_write
--     is the only write policy on sites and has been admin-only since 0001.
--   * jobs_insert refuses (42501) a new job missing a field its site requires,
--     blank or whitespace-only counted as missing, and a new job with neither a
--     plate nor a VIN at any site. create_job (security invoker) and a direct
--     insert are both covered. "Blank" is any value with no character outside
--     whitespace: POSIX [:space:] (space, tab, newline, CR, VT, FF) plus the
--     Unicode spaces JavaScript's trim() strips (NBSP U+00A0, U+1680,
--     U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, BOM U+FEFF), so
--     the database and the web (lib/jobs.ts trims) agree on what is empty.
--     The pattern uses regex \u escapes in a plain literal, which needs
--     standard_conforming_strings on (the default, and Supabase's setting).
--   * jobs_plate_or_vin_chk (back from 0016) keeps every row, edits included,
--     with a plate or a VIN. It checks NULL only: a blank VIN was never refused
--     by the database (0036), and rows written that way may exist.
--   * the rules apply to NEW jobs only. Editing a job (jobs_update) is bound by
--     the plate-or-VIN check and the web's format checks, not by the site's
--     current rules, so changing a rule never locks an old job out of editing.
--   * jobs.vin is nullable again: NULL = no VIN, never '' or a placeholder.
--
-- Deploy order: 0042, THEN the web build. The new web selects sites.vin_rule
-- and sites.plate_rule, which the old schema does not have. The old web keeps
-- working on 0042: it always sends a VIN, and at a site an admin made
-- plate-required it gets a plain 42501 (no translated reason) for a car with
-- no plate.
--
-- Rollback: web first, then the DOWN at the bottom. The DOWN refuses while any
-- job (soft-deleted included) has a NULL or blank VIN, as 0036 did.
--
-- Base: jobs_insert 0041 (the users clause copied unchanged; the rule checks
-- join its sites clause).

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The rules, per site
-- ---------------------------------------------------------------------------

alter table sites add column vin_rule text not null default 'required'
  constraint sites_vin_rule_chk check (vin_rule in ('required', 'optional'));
alter table sites add column plate_rule text not null default 'optional'
  constraint sites_plate_rule_chk check (plate_rule in ('required', 'optional'));

comment on column sites.vin_rule is
  'required | optional: whether a new job at this site must have a VIN (jobs_insert, 0042). Admin-only.';
comment on column sites.plate_rule is
  'required | optional: whether a new job at this site must have a plate (jobs_insert, 0042). Admin-only.';

-- ---------------------------------------------------------------------------
-- 2. A job has a plate or a VIN (either may be NULL, not both)
-- ---------------------------------------------------------------------------

alter table jobs alter column vin drop not null;
alter table jobs drop constraint if exists jobs_plate_or_vin_chk;
-- NOT VALID, then validated after the commit below: the scan of existing rows
-- then runs under SHARE UPDATE EXCLUSIVE, not this transaction's ACCESS
-- EXCLUSIVE. New and updated rows are checked from here on either way.
alter table jobs add constraint jobs_plate_or_vin_chk
  check (plate is not null or vin is not null) not valid;

comment on column jobs.vin is
  'User-provided VIN, or NULL where the site allows it (0042). Never inferred, never defaulted, never a placeholder.';

-- ---------------------------------------------------------------------------
-- 3. Who may insert a job: as 0041, and only with what the site requires.
--    sites is readable by every staff role (sites_select, 0028).
-- ---------------------------------------------------------------------------

drop policy jobs_insert on jobs;
create policy jobs_insert on jobs for insert
  with check (
    exists (
      select 1 from sites s
      where s.id = jobs.site_id
        and s.active
        -- Not blank: some character outside whitespace (header).
        and (s.vin_rule = 'optional'
             or coalesce(jobs.vin, '') ~ '[^[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]')
        and (s.plate_rule = 'optional'
             or coalesce(jobs.plate, '') ~ '[^[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]')
        and (coalesce(jobs.plate, '') ~ '[^[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'
             or coalesce(jobs.vin, '') ~ '[^[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]')
    )
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

-- Every existing row has a VIN (NOT NULL until this migration), so this passes.
begin;
set local lock_timeout = '5s';
alter table jobs validate constraint jobs_plate_or_vin_chk;
commit;

-- ---------------------------------------------------------------------------
-- DOWN (manual; run the web build without vin_rule / plate_rule first).
-- Refuses while any job has a NULL or blank VIN: fill those in (or decide what
-- to do with the rows) first. Find them with:
--   select id, created_at, site_id, plate, deleted_at from jobs
--   where vin is null or vin !~ '[^[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]';
-- ---------------------------------------------------------------------------
-- begin;
-- set local lock_timeout = '5s';
--
-- do $$
-- declare
--   missing bigint;
-- begin
--   select count(*) into missing from jobs
--   where vin is null or vin !~ '[^[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]';
--   if missing > 0 then
--     raise exception '0042 down: % job(s) have a NULL or blank VIN (soft-deleted included); fill them in before making jobs.vin NOT NULL', missing;
--   end if;
-- end;
-- $$;
--
-- -- The policy first: it depends on the sites columns dropped below.
-- drop policy jobs_insert on jobs;
-- create policy jobs_insert on jobs for insert
--   with check (
--     exists (select 1 from sites s where s.id = jobs.site_id and s.active)
--     and exists (
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
-- alter table jobs drop constraint if exists jobs_plate_or_vin_chk;
-- alter table jobs alter column vin set not null;
-- comment on column jobs.vin is
--   'User-provided VIN, required (17 chars, no I/O/Q). Never inferred, never defaulted, never a placeholder.';
--
-- alter table sites drop column plate_rule;
-- alter table sites drop column vin_rule;
--
-- commit;
