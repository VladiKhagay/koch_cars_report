-- Read-only check that 0035 (worker media edit inside the 15-minute window) is
-- in place. Paste into the Supabase SQL editor. Every row should read 'ok'.
-- Nothing here writes.
--
-- Catalog checks only (no app user in the SQL editor). Policy text is
-- deparsed: `IS NULL` upper case, `not in (...)` reads `<> ALL (ARRAY[...])`.
-- For behaviour, run supabase/scenarios_0035.sql on a non-production copy.

select 'photos_update worker branch: own job, window open, job not deleted' as check,
       case when exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'photos' and policyname = 'photos_update'
           and cmd = 'UPDATE'
           and coalesce(qual, '') like '%admin%' and coalesce(with_check, '') like '%admin%'
           and coalesce(qual, '') like '%manager%' and coalesce(with_check, '') like '%manager%'
           and coalesce(qual, '') like '%worker_id%' and coalesce(with_check, '') like '%worker_id%'
           and coalesce(qual, '') like '%locked_at > now()%' and coalesce(with_check, '') like '%locked_at > now()%'
           and coalesce(qual, '') like '%deleted_at IS NULL%' and coalesce(with_check, '') like '%deleted_at IS NULL%'
       ) then 'ok' else 'MISSING/STALE — run 0035 (worker branch absent or unbounded)' end as status

union all
select 'photos_update never lets a worker remove plate/VIN',
       case when exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'photos' and policyname = 'photos_update'
           and coalesce(with_check, '') like '%removed_at IS NULL%'
           and coalesce(with_check, '') like '%''plate''%'
           and coalesce(with_check, '') like '%''vin''%'
       ) then 'ok' else 'LEAK — a worker can tombstone plate/VIN' end

union all
select 'photos_update never grants co-workers',
       case when not exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'photos' and policyname = 'photos_update'
           and coalesce(qual, '') || coalesce(with_check, '') like '%coworker_ids%'
       ) then 'ok' else 'LEAK — co-workers can edit media' end

union all
select 'exactly one UPDATE policy on photos',
       case when (select count(*) from pg_policies
                  where schemaname = 'public' and tablename = 'photos' and cmd = 'UPDATE') = 1
       then 'ok' else 'CHECK — another UPDATE policy widens photos_update (policies OR together)' end

union all
select 'no DELETE/ALL policy on photos (removal is the tombstone)',
       case when not exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'photos' and cmd in ('DELETE', 'ALL')
       ) then 'ok' else 'LEAK — photo rows can be deleted' end

union all
select 'photos_insert refuses an already-removed row',
       case when exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'photos' and policyname = 'photos_insert'
           and cmd = 'INSERT'
           and coalesce(with_check, '') like '%can_write_photo%'
           and coalesce(with_check, '') like '%removed_at IS NULL%'
       ) then 'ok' else 'STALE — photos_insert lets a tombstoned row in' end

union all
select 'can_write_photo window branch needs a live job',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'can_write_photo' and p.prosecdef
           and pg_get_functiondef(p.oid) like '%(j.locked_at > now() and j.deleted_at is null)%'
       ) then 'ok' else 'STALE — 0031 can_write_photo (uploads to a deleted job in its window)' end

union all
select 'can_write_photo "no photo rows yet" branch needs a live job',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'can_write_photo' and p.prosecdef
           and pg_get_functiondef(p.oid) ~ 'p_kind <> ''video''\s+and j\.deleted_at is null'
       ) then 'ok' else 'STALE — first photos still writable to a deleted job' end

union all
select 'authenticated (not anon) can execute can_write_photo',
       case when has_function_privilege('authenticated', 'public.can_write_photo(uuid, text)', 'execute')
             and not has_function_privilege('anon', 'public.can_write_photo(uuid, text)', 'execute')
       then 'ok' else 'BROKEN — uploads 403, or anon can probe jobs' end

union all
select 'photos_guard_update still pins identity (0034)',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'photos_guard_update'
           and pg_get_functiondef(p.oid) like '%new.id := old.id%'
           and pg_get_functiondef(p.oid) like '%new.job_id := old.job_id%'
           and pg_get_functiondef(p.oid) like '%new.kind := old.kind%'
           and pg_get_functiondef(p.oid) like '%new.r2_key := old.r2_key%'
       ) and exists (select 1 from pg_trigger where tgname = 'photos_guard_update' and not tgisinternal)
       then 'ok' else 'BROKEN — a worker could repoint a photo row' end;
