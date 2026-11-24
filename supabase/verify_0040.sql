-- Read-only check that 0040 (managers/admins submit jobs for workers or under
-- a typed name) is in place. Paste into the Supabase SQL editor. Every row
-- should read 'ok'. Nothing here writes.
--
-- Catalog checks only (no app user in the SQL editor). Policy and view text is
-- deparsed. For behaviour, run supabase/scenarios_0040.sql on a non-production
-- copy.

select 'jobs.worker_label exists (text)' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'jobs'
           and column_name = 'worker_label' and data_type = 'text' and is_nullable = 'YES'
       ) then 'ok' else 'MISSING — run 0040' end as status

union all
select 'jobs_worker_label_check limits the label to 1..60 chars',
       case when exists (
         select 1 from pg_constraint
         where conrelid = 'public.jobs'::regclass and contype = 'c'
           and conname = 'jobs_worker_label_check'
           and pg_get_constraintdef(oid) like '%char_length(worker_label)%'
           and pg_get_constraintdef(oid) like '%60%'
       ) then 'ok' else 'MISSING — overlong labels accepted' end

union all
select 'jobs_worker_label_check refuses control / zero-width / bidi chars',
       case when exists (
         select 1 from pg_constraint
         where conrelid = 'public.jobs'::regclass and contype = 'c'
           and conname = 'jobs_worker_label_check'
           and position('!~' in pg_get_constraintdef(oid)) > 0
           and position('u202E' in pg_get_constraintdef(oid)) > 0
       ) then 'ok' else 'MISSING — labels can hide or reorder text' end

union all
select 'jobs_insert knows worker_label and the manager site',
       case when exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'jobs'
           and policyname = 'jobs_insert' and cmd = 'INSERT'
           and coalesce(with_check, '') like '%worker_label%'
           and coalesce(with_check, '') like '%site_id%'
           and coalesce(with_check, '') like '%active%'
       ) then 'ok' else 'STALE — jobs_insert is the 0028 one (anyone logs only as self, no label rule)' end

union all
select 'jobs_guard_worker_label trigger is on jobs',
       case when exists (
         select 1 from pg_trigger
         where tgrelid = 'public.jobs'::regclass
           and tgname = 'jobs_guard_worker_label' and not tgisinternal
       ) then 'ok' else 'MISSING — labels can be set or changed after insert' end

union all
select 'jobs_guard_worker_label is security definer with search_path',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'jobs_guard_worker_label'
           and p.prosecdef
           and p.proconfig @> array['search_path=public']
       ) then 'ok' else 'MISSING/STALE — run 0040' end

union all
select 'jobs_audit logs worker_label changes',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'jobs_audit'
           and p.prosrc like '%''worker_label''%'
       ) then 'ok' else 'STALE — jobs_audit is the 0034 one (label clears not logged)' end

union all
select 'jobs_audit_on_behalf trigger logs on-behalf inserts',
       case when exists (
         select 1 from pg_trigger t
         join pg_proc p on p.oid = t.tgfoid
         where t.tgrelid = 'public.jobs'::regclass
           and t.tgname = 'jobs_audit_on_behalf' and not t.tgisinternal
           and p.prosecdef
           and p.proconfig @> array['search_path=public']
           and p.prosrc like '%create_on_behalf%'
       ) then 'ok' else 'MISSING — on-behalf submits leave no trail of the submitter' end

union all
select 'exactly one create_job, with 10 args',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'create_job') = 1
             and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = 'create_job' and p.pronargs = 10)
       then 'ok' else 'BROKEN — create_job missing, stale (9 args) or overloaded' end

union all
select 'authenticated (not anon) can execute create_job',
       case when has_function_privilege('authenticated',
                   'public.create_job(uuid, uuid, text, text, boolean, text, text, uuid[], uuid[], text)', 'execute')
             and not has_function_privilege('anon',
                   'public.create_job(uuid, uuid, text, text, boolean, text, text, uuid[], uuid[], text)', 'execute')
       then 'ok' else 'BROKEN — staff cannot submit, or anon can call it' end

union all
select 'create_job writes worker_label',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'create_job'
           and p.prosrc like '%worker_label%'
       ) then 'ok' else 'STALE — create_job ignores p_worker_label' end

union all
select 'job_daily_stats: labelled jobs not paid to the submitter',
       case when pg_get_viewdef('public.job_daily_stats'::regclass) like '%worker_label%'
             and exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'job_daily_stats'
                           and column_name = 'worker_label')
       then 'ok' else 'STALE — submitter paid for labelled jobs' end

union all
select 'job_daily_totals: labelled jobs not paid to the submitter',
       case when pg_get_viewdef('public.job_daily_totals'::regclass) like '%worker_label%'
             and exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'job_daily_totals'
                           and column_name = 'worker_label')
       then 'ok' else 'STALE — submitter paid for labelled jobs' end

union all
select 'job_monthly_stats: labelled jobs not counted for the submitter',
       case when pg_get_viewdef('public.job_monthly_stats'::regclass) like '%worker_label%'
       then 'ok' else 'STALE — submitter credited with labelled jobs' end

union all
select 'stats views stay security_invoker',
       case when (select count(*) from pg_class
                  where oid in ('public.job_daily_stats'::regclass, 'public.job_daily_totals'::regclass,
                                'public.job_monthly_stats'::regclass, 'public.jobs_manager'::regclass,
                                'public.jobs_worker_view'::regclass)
                    and 'security_invoker=true' = any (coalesce(reloptions, '{}'))) = 5
       then 'ok' else 'LEAK — a stats/manager view runs with owner rights' end

union all
select 'jobs_manager exposes worker_label',
       case when exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'jobs_manager'
                           and column_name = 'worker_label')
       then 'ok' else 'STALE — run 0040' end

union all
select 'jobs_worker_view exposes worker_label (co-workers see the name)',
       case when exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'jobs_worker_view'
                           and column_name = 'worker_label')
       then 'ok' else 'STALE — co-workers see the submitter instead of the label' end

union all
select 'jobs_carasso shows the label in crew',
       case when pg_get_viewdef('public.jobs_carasso'::regclass) like '%worker_label%'
             and pg_get_viewdef('public.jobs_carasso'::regclass) like '%hide_client_prices%'
       then 'ok' else 'STALE — jobs_carasso is the 0038 one (or 0038 lost)' end

union all
select 'jobs_carasso stays owner-rights',
       case when not ('security_invoker=true' = any (coalesce(
              (select reloptions from pg_class where oid = 'public.jobs_carasso'::regclass), '{}')))
       then 'ok' else 'BROKEN — invoker jobs_carasso returns nothing to viewers' end

union all
select 'jobs_carasso keeps its 21 columns, order and types',
       case when (select string_agg(column_name || ':' || udt_name, ',' order by ordinal_position)
                  from information_schema.columns
                  where table_schema = 'public' and table_name = 'jobs_carasso')
                 = 'id:uuid,site_id:uuid,site_name:text,created_at:timestamptz,plate:text,vin:text,'
                   'brand:text,worker_note:text,service_id:uuid,service_name_en:text,'
                   'service_name_ru:text,service_name_he:text,catalog_number:text,billing_code:text,'
                   'worker_id:uuid,coworker_ids:_uuid,crew:text,client_unit_price:numeric,'
                   'client_total_price:numeric,service_ids:_uuid,services:jsonb'
       then 'ok' else 'BROKEN — jobs_carasso shape changed (web select list no longer matches)' end

union all
select 'list_staff refuses and hides carasso',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'list_staff'
           and p.prosecdef
           and p.prosrc like '%carasso%'
           and p.prosrc like '%''worker'', ''manager'', ''admin''%'
       ) then 'ok' else 'LEAK — list_staff is the 0032 one (carasso calls it, carasso users listed)' end

union all
select 'list_staff still returns the role (0032)',
       case when pg_get_function_result('public.list_staff()'::regprocedure) like '%role user_role%'
       then 'ok' else 'BROKEN — co-worker picker loses the role column' end;
