-- 0043: who may move a job to another site, and where to.
--
-- Gap closed: jobs_update (0019 §5) dropped the site match from the manager's
-- WITH CHECK on purpose, "so they can move one of their jobs to the site it
-- actually belongs to", and its worker branch never had one. No trigger
-- compared new.site_id with old.site_id. So a manager could move any job of
-- their site to ANY site, and a worker their own job (My Jobs edit panel)
-- inside the 15-minute window, to any site. A moved job also skipped what only
-- jobs_insert checks: the disabled-site block (0041) and the destination's
-- VIN/plate rules (0042).
--
-- Decision (owner, 2026-11-24), supersedes 0019 §5's "a manager may move a job":
--   * admin: may move any job to any site, any time (deliberately unrestricted,
--     a disabled or stricter-rules destination included).
--   * worker: may move their own job while its 15-minute window is open and it
--     is not deleted (the same rows jobs_update lets them edit), only to an
--     ACTIVE site whose VIN/plate rules the job meets: what logging it there
--     fresh would require (0041, 0042). This is "I picked the wrong site".
--   * manager (and anyone else signed in): may not move a job. A manager who
--     finds a job at the wrong site asks an admin.
--
-- Rules (database, never only the UI):
--   * jobs_guard_site (BEFORE UPDATE, every row, any column list) raises 42501
--     when site_id is distinct from the old value and the caller is not
--     allowed by the rules above. It raises rather than silently reverting
--     (the 0021 style): the old web's manager-move save sends no RETURNING and
--     would report a revert as "saved".
--   * the worker check reads old.worker_id / old.locked_at / old.deleted_at
--     (jobs_guard_worker_columns, which pins them, runs after this trigger by
--     name) and the NEW plate/VIN (a change in the same update counts). "Blank"
--     is 0042's pattern: no character outside POSIX whitespace and the Unicode
--     spaces JS trim() strips. Needs standard_conforming_strings on (default).
--   * an update that sends site_id unchanged (both web forms always send it)
--     passes: the check is IS DISTINCT FROM, not "column present".
--   * no JWT at all (auth.uid() is null: service role, SQL editor, migrations)
--     is not restricted, as in 0021. A deactivated user and a carasso viewer
--     are refused (current_app_user() is active users only).
--   * logging a NEW job at any active site is unchanged (jobs_insert, 0019 §4,
--     0040-0042). jobs_update itself is unchanged: WITH CHECK cannot see the
--     old row, so the trigger is the enforcement point.
--
-- Deploy order: 0043, THEN the web build. The new web shows the Job Detail site
-- picker to admins only (My Jobs keeps the worker's). The old web still offers
-- it to managers; on 0043 a manager's move fails at the final jobs update with
-- a save error, AFTER billing, services and per-line edits in the same save
-- have been written (separate requests). Nothing is moved; the manager can
-- re-save without the site change. Ship the web soon after.
--
-- Rollback: the DOWN at the bottom (the web needs no rollback: an admin-only
-- picker is valid either way).

begin;
set local lock_timeout = '5s';

create or replace function jobs_guard_site()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
begin
  if new.site_id is not distinct from old.site_id or auth.uid() is null then
    return new;
  end if;

  select * into caller from current_app_user();

  if caller.role = 'admin' then
    return new;
  end if;

  if caller.role = 'worker'
     and old.worker_id = caller.id
     and old.locked_at > now()
     and old.deleted_at is null then
    -- Same test as jobs_insert (0041, 0042), against the destination.
    if exists (
      select 1 from sites s
      where s.id = new.site_id
        and s.active
        and (s.vin_rule = 'optional'
             or coalesce(new.vin, '') ~ '[^[:space:]   -     　﻿]')
        and (s.plate_rule = 'optional'
             or coalesce(new.plate, '') ~ '[^[:space:]   -     　﻿]')
        and (coalesce(new.plate, '') ~ '[^[:space:]   -     　﻿]'
             or coalesce(new.vin, '') ~ '[^[:space:]   -     　﻿]')
    ) then
      return new;
    end if;
    raise exception 'a job can only move to an active site whose VIN/plate rules it meets'
      using errcode = '42501';
  end if;

  raise exception 'only an admin, or the worker within their edit window, can move a job to another site'
    using errcode = '42501';
end;
$$;

revoke all on function jobs_guard_site() from public, anon;

drop trigger if exists jobs_guard_site on jobs;
create trigger jobs_guard_site
  before update on jobs
  for each row execute function jobs_guard_site();

commit;

-- ---------------------------------------------------------------------------
-- DOWN (manual). Managers and workers can move jobs to any site again.
-- ---------------------------------------------------------------------------
-- begin;
-- drop trigger if exists jobs_guard_site on jobs;
-- drop function if exists jobs_guard_site();
-- commit;
