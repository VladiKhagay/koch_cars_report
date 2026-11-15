-- Read-only check that 0038 (hide client prices from viewers) is in place.
-- Paste into the Supabase SQL editor. Every row should read 'ok'.
-- Nothing here writes.
--
-- Catalog checks only (no app user in the SQL editor, so jobs_carasso returns
-- no rows here). Policy text is deparsed: the key reads 'hide_client_prices'::text.
-- For behaviour, run supabase/scenarios_0038.sql on a non-production copy.

select 'app_settings has hide_client_prices = false' as check,
       case when exists (select 1 from app_settings
                         where key = 'hide_client_prices' and value = 'false'::jsonb)
            then 'ok'
            when exists (select 1 from app_settings
                         where key = 'hide_client_prices' and value = 'true'::jsonb)
            then 'CHECK — switch is ON (an admin hid prices); fine if intended, not a migration problem'
            else 'MISSING — run 0038 (key row absent: viewers see prices)' end as status

union all
select 'app_settings_key_check allows the three keys',
       case when exists (
         select 1 from pg_constraint
         where conrelid = 'public.app_settings'::regclass and contype = 'c'
           and conname = 'app_settings_key_check'
           and pg_get_constraintdef(oid) like '%hide_worker_names%'
           and pg_get_constraintdef(oid) like '%customer_report_config%'
           and pg_get_constraintdef(oid) like '%hide_client_prices%'
       ) then 'ok' else 'MISSING — run 0038 (check still has two keys)' end

union all
select 'job_client_prices_carasso honours the switch',
       case when exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'job_client_prices'
           and policyname = 'job_client_prices_carasso' and cmd = 'SELECT'
           and coalesce(qual, '') like '%hide_client_prices%'
           and coalesce(qual, '') like '%can_view_job%'
       ) then 'ok' else 'LEAK — viewers read job_client_prices while hidden' end

union all
select 'job_service_client_prices_carasso honours the switch',
       case when exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'job_service_client_prices'
           and policyname = 'job_service_client_prices_carasso' and cmd = 'SELECT'
           and coalesce(qual, '') like '%hide_client_prices%'
           and coalesce(qual, '') like '%can_view_job%'
       ) then 'ok' else 'LEAK — viewers read job_service_client_prices while hidden' end

union all
select 'set_hide_client_prices is security definer with search_path',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'set_hide_client_prices'
           and p.prosecdef
           and p.proconfig @> array['search_path=public']
       ) then 'ok' else 'MISSING/STALE — run 0038 (RPC absent or not definer)' end

union all
select 'authenticated (not anon) can execute set_hide_client_prices',
       case when has_function_privilege('authenticated', 'public.set_hide_client_prices(boolean)', 'execute')
             and not has_function_privilege('anon', 'public.set_hide_client_prices(boolean)', 'execute')
       then 'ok' else 'BROKEN — admin cannot save, or anon can call it' end

union all
select 'jobs_carasso blanks prices for viewers',
       case when pg_get_viewdef('public.jobs_carasso'::regclass) like '%hide_client_prices%'
             and pg_get_viewdef('public.jobs_carasso'::regclass) like '%hide_prices%'
       then 'ok' else 'LEAK — jobs_carasso returns prices while hidden' end

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
       then 'ok' else 'BROKEN — jobs_carasso shape changed (web select list no longer matches)' end;
