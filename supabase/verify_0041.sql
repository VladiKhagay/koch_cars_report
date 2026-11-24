-- Read-only check that 0041 (admins rename / disable / delete sites) is in
-- place. Paste into the Supabase SQL editor. Every row should read 'ok'.
-- Nothing here writes.
--
-- Catalog checks only. For behaviour, run supabase/scenarios_0041.sql on a
-- non-production copy.

select 'sites.active exists (boolean, not null, default true)' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'sites'
           and column_name = 'active' and data_type = 'boolean'
           and is_nullable = 'NO' and column_default = 'true'
       ) then 'ok' else 'MISSING — run 0041' end as status

union all
select 'jobs_insert refuses a disabled site and keeps the 0040 rules',
       case when exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'jobs'
           and policyname = 'jobs_insert' and cmd = 'INSERT'
           and coalesce(with_check, '') like '%sites%'
           and coalesce(with_check, '') like '%s.active%'
           and coalesce(with_check, '') like '%worker_label%'
           and coalesce(with_check, '') like '%w.active%'
       ) then 'ok' else 'STALE — a disabled site still takes new jobs' end

union all
select 'every FK to sites is NO ACTION (delete only an unused site)',
       case when (
         select count(*) from pg_constraint
         where contype = 'f' and confrelid = 'public.sites'::regclass
           and conrelid in ('public.jobs'::regclass, 'public.users'::regclass, 'public.user_sites'::regclass)
           and confdeltype = 'a'
       ) = 3
       and not exists (
         select 1 from pg_constraint
         where contype = 'f' and confrelid = 'public.sites'::regclass and confdeltype <> 'a'
       ) then 'ok' else 'STALE — deleting a site clears users or drops viewer links' end

union all
select 'sites writes are admin-only (sites_write the only write policy)',
       case when (
         select count(*) from pg_policies
         where schemaname = 'public' and tablename = 'sites' and cmd <> 'SELECT'
       ) = 1
       and exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'sites'
           and policyname = 'sites_write' and cmd = 'ALL'
           and coalesce(qual, '') like '%''admin''%'
           and coalesce(with_check, '') like '%''admin''%'
           and coalesce(qual, '') not like '%manager%'
       ) then 'ok' else 'CHECK — a non-admin may write sites' end

union all
select 'sites RLS is on',
       case when (select relrowsecurity from pg_class where oid = 'public.sites'::regclass)
            then 'ok' else 'OFF — anyone with a grant writes sites' end;
