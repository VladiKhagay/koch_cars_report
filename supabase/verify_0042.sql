-- Read-only check that 0042 (per-site VIN / plate rules) is in place. Paste
-- into the Supabase SQL editor. Every row should read 'ok'. Nothing here
-- writes.
--
-- Catalog checks only. For behaviour, run supabase/scenarios_0042.sql on a
-- non-production copy.

select 'sites.vin_rule exists (text, not null, default required, checked)' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'sites'
           and column_name = 'vin_rule' and data_type = 'text'
           and is_nullable = 'NO' and column_default like '%''required''%'
       )
       and exists (
         select 1 from pg_constraint
         where conrelid = 'public.sites'::regclass and contype = 'c'
           and conname = 'sites_vin_rule_chk'
           and pg_get_constraintdef(oid) like '%required%'
           and pg_get_constraintdef(oid) like '%optional%'
       ) then 'ok' else 'MISSING — run 0042' end as status

union all
select 'sites.plate_rule exists (text, not null, default optional, checked)',
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'sites'
           and column_name = 'plate_rule' and data_type = 'text'
           and is_nullable = 'NO' and column_default like '%''optional''%'
       )
       and exists (
         select 1 from pg_constraint
         where conrelid = 'public.sites'::regclass and contype = 'c'
           and conname = 'sites_plate_rule_chk'
           and pg_get_constraintdef(oid) like '%required%'
           and pg_get_constraintdef(oid) like '%optional%'
       ) then 'ok' else 'MISSING — run 0042' end

union all
select 'jobs.vin is nullable',
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'jobs'
           and column_name = 'vin' and is_nullable = 'YES'
       ) then 'ok' else 'STALE — jobs.vin is still NOT NULL' end

union all
select 'jobs_plate_or_vin_chk (a plate or a VIN) exists and is validated',
       case when exists (
         select 1 from pg_constraint
         where conrelid = 'public.jobs'::regclass and contype = 'c'
           and conname = 'jobs_plate_or_vin_chk' and convalidated
           and pg_get_constraintdef(oid) like '%plate IS NOT NULL%'
           and pg_get_constraintdef(oid) like '%vin IS NOT NULL%'
       ) then 'ok' else 'MISSING or NOT VALID — run 0042 (or its validate step)' end

union all
select 'jobs_insert checks the site rules and keeps the 0041 rules',
       case when exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'jobs'
           and policyname = 'jobs_insert' and cmd = 'INSERT'
           and coalesce(with_check, '') like '%vin_rule%'
           and coalesce(with_check, '') like '%plate_rule%'
           and coalesce(with_check, '') like '%[:space:]%'
           and coalesce(with_check, '') like '%u00a0%'
           and coalesce(with_check, '') like '%s.active%'
           and coalesce(with_check, '') like '%worker_label%'
           and coalesce(with_check, '') like '%w.active%'
       ) then 'ok' else 'STALE — new jobs ignore the site rules' end

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
       ) then 'ok' else 'CHECK — a non-admin may change the site rules' end

union all
select 'sites RLS is on',
       case when (select relrowsecurity from pg_class where oid = 'public.sites'::regclass)
            then 'ok' else 'OFF — anyone with a grant writes sites' end;
