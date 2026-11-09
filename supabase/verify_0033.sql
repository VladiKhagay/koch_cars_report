-- Read-only check that 0033 (multi-service jobs) is fully in place and the
-- data agrees with itself. Paste into the Supabase SQL editor. Every row
-- should read 'ok'. Nothing here writes.
--
-- Run as the SQL-editor user: there is no app user in context, so
-- jobs_carasso returns no rows here. Its "no pay" check therefore reads the
-- view DEFINITION, not its data.

select 'table job_services (0033)' as check,
       case when to_regclass('public.job_services') is not null
       then 'ok' else 'MISSING — run 0033' end as status

union all
select 'RLS on job_services and job_service_client_prices',
       case when (select count(*) from pg_class
                  where oid in ('public.job_services'::regclass, 'public.job_service_client_prices'::regclass)
                    and relrowsecurity) = 2
       then 'ok' else 'LEAK — RLS is off, every signed-in user reads/writes lines' end

union all
select 'every job with a service has its line',
       case when not exists (
         select 1 from jobs j
         where j.service_id is not null
           and not exists (select 1 from job_services js where js.job_id = j.id)
       ) then 'ok' else 'BROKEN — jobs with service_id but no job_services row' end

union all
select 'jobs.worker_price = sum of its lines',
       case when not exists (
         select 1 from jobs j
         join (select job_id, sum(worker_price) as s from job_services group by job_id) l on l.job_id = j.id
         where j.worker_price is distinct from l.s
       ) then 'ok' else 'MISMATCH — job pay differs from its lines' end

union all
select 'job_client_prices = sum of line client prices',
       case when not exists (
         select 1
         from jobs j
         left join job_client_prices cp on cp.job_id = j.id
         cross join lateral (
           select case when count(*) > 0 and count(*) = count(lp.unit_price)  then sum(lp.unit_price)  end as unit_price,
                  case when count(*) > 0 and count(*) = count(lp.total_price) then sum(lp.total_price) end as total_price
           from job_services js
           left join job_service_client_prices lp on lp.job_id = js.job_id and lp.service_id = js.service_id
           where js.job_id = j.id
         ) d
         where exists (select 1 from job_services js where js.job_id = j.id)
           and (cp.unit_price is distinct from d.unit_price or cp.total_price is distinct from d.total_price)
       ) then 'ok' else 'MISMATCH — a job client price differs from its lines' end

union all
select 'line shares add up to the job shares',
       case when not exists (
         select 1 from jobs j
         join (select job_id, sum(submitter_share) as sub, sum(coworker_share) as co
               from job_service_lines group by job_id) l on l.job_id = j.id
         where l.sub <> j.submitter_share or l.co <> j.coworker_share
       ) then 'ok' else 'MISMATCH — per-service split loses or invents cents' end

union all
select 'policies on job_services (select/insert/delete/update)',
       case when (select count(*) from pg_policies
                  where schemaname = 'public' and tablename = 'job_services'
                    and policyname in ('job_services_select', 'job_services_insert',
                                       'job_services_delete', 'job_services_update')) = 4
       then 'ok' else 'MISSING — job_services policies' end

union all
-- Co-workers may see a job but never change its services.
select 'job_services writes exclude co-workers',
       case when not exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'job_services'
           and cmd in ('INSERT', 'DELETE', 'UPDATE', 'ALL')
           and coalesce(qual, '') || coalesce(with_check, '') like '%coworker_ids%'
       ) then 'ok' else 'LEAK — a co-worker can change the services' end

union all
select 'line pay is admin-only to update',
       case when exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'job_services'
           and policyname = 'job_services_update'
           and qual like '%admin%' and qual not like '%manager%' and qual not like '%worker%'
       ) and exists (select 1 from pg_trigger where tgname = 'job_services_guard' and not tgisinternal)
       then 'ok' else 'LEAK — non-admins can set line pay' end

union all
-- `caller is [not] null` on a users row is false for a user with any NULL
-- column (no site_id), which would pass them off as the trusted context.
select 'guards test caller.id, not the whole row',
       case when not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('job_services_guard', 'jobs_guard_worker_columns')
           and (pg_get_functiondef(p.oid) like '%caller is not null%'
                or pg_get_functiondef(p.oid) like '%caller is null%')
       ) and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('job_services_guard', 'jobs_guard_worker_columns')
                and pg_get_functiondef(p.oid) like '%caller.id is%') = 2
       then 'ok' else 'LEAK — a siteless user can set their own line pay' end

union all
select 'manager inserts get server-stamped locked_at (0033)',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'jobs_guard_worker_columns'
           and pg_get_functiondef(p.oid) like '%''worker'', ''manager''%'
       ) then 'ok' else 'STALE — 0028 guard, managers pick their own edit window' end

union all
select 'triggers 0033 in place',
       case when (select count(*) from pg_trigger
                  where not tgisinternal and tgname in (
                    'jobs_seed_service_ins', 'jobs_seed_service_upd',
                    'job_services_guard', 'job_services_snapshot_client_prices',
                    'job_services_touch_job', 'job_services_keep_one',
                    'job_service_client_prices_sum', 'jobs_apply_worker_price')) = 8
       then 'ok' else 'MISSING — a 0033 trigger' end

union all
select 'old per-job client price snapshot removed',
       case when not exists (select 1 from pg_trigger
                             where tgname like 'jobs_snapshot_client_prices%' and not tgisinternal)
       then 'ok' else 'STALE — 0027 snapshot still overwrites the summed client price' end

union all
select 'jobs_apply_worker_price sums the lines',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'jobs_apply_worker_price'
           and pg_get_functiondef(p.oid) like '%job_services%'
       ) then 'ok' else 'STALE — still the 0005 single-service body' end

union all
select 'anon cannot execute create_job / set_job_services',
       case when not has_function_privilege('anon',
                   'public.create_job(uuid, uuid, text, text, boolean, text, text, uuid[], uuid[])', 'execute')
             and not has_function_privilege('anon', 'public.set_job_services(uuid, uuid[])', 'execute')
       then 'ok' else 'LEAK — anon can call a 0033 write RPC' end

union all
select 'authenticated can execute create_job / set_job_services',
       case when has_function_privilege('authenticated',
                   'public.create_job(uuid, uuid, text, text, boolean, text, text, uuid[], uuid[])', 'execute')
             and has_function_privilege('authenticated', 'public.set_job_services(uuid, uuid[])', 'execute')
       then 'ok' else 'MISSING — grant execute to authenticated' end

union all
select 'job_client_prices_refresh is not an RPC',
       case when not has_function_privilege('authenticated', 'public.job_client_prices_refresh(uuid)', 'execute')
             and not has_function_privilege('anon', 'public.job_client_prices_refresh(uuid)', 'execute')
       then 'ok' else 'LEAK — any caller can rewrite a job client price' end

union all
select 'create_job / set_job_services run as the caller',
       case when not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('create_job', 'set_job_services') and p.prosecdef
       ) then 'ok' else 'LEAK — a write RPC is security definer and skips RLS' end

union all
select 'security_invoker on job views and stats',
       case when (select count(*) from pg_class
                  where oid in ('public.jobs_worker_view'::regclass, 'public.jobs_manager'::regclass,
                                'public.job_service_lines'::regclass, 'public.job_daily_stats'::regclass,
                                'public.job_daily_totals'::regclass)
                    and 'security_invoker=true' = any (coalesce(reloptions, '{}'))) = 5
       then 'ok' else 'LEAK — a view runs with owner rights and skips jobs RLS' end

union all
-- jobs_carasso is owner-rights BY DESIGN (0028): its WHERE is the access check.
select 'jobs_carasso stays owner-rights',
       case when not ('security_invoker=true' = any (coalesce(
              (select reloptions from pg_class where oid = 'public.jobs_carasso'::regclass), '{}')))
       then 'ok' else 'BROKEN — invoker jobs_carasso returns nothing to Carasso' end

union all
select 'jobs_carasso carries no worker pay',
       case when pg_get_viewdef('public.jobs_carasso'::regclass) not like '%worker_price%'
             and pg_get_viewdef('public.jobs_carasso'::regclass) not like '%_share%'
       then 'ok' else 'LEAK — jobs_carasso exposes pay' end

union all
select 'jobs views expose service_ids and services',
       case when (select count(*) from information_schema.columns
                  where table_schema = 'public'
                    and table_name in ('jobs_worker_view', 'jobs_manager', 'jobs_carasso')
                    and column_name in ('service_ids', 'services')) = 6
       then 'ok' else 'MISSING — rerun 0033 section 10' end

union all
select 'job_service_stats dropped (no readers)',
       case when to_regclass('public.job_service_stats') is null
       then 'ok' else 'STALE — 0005 view still present' end;
