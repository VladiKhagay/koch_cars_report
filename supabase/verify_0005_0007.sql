-- Read-only check that 0005, 0006 and 0007 are fully in place.
-- Paste into the Supabase SQL editor. Every row should read 'ok'.
-- Nothing here writes.

select 'rpc update_customer_report_config' as check,
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'update_customer_report_config'
       ) then 'ok' else 'MISSING — rerun 0007' end as status

union all
select 'rpc validates column keys (0007)',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'update_customer_report_config'
           and pg_get_functiondef(p.oid) like '%catalog_number%'
       ) then 'ok' else 'STALE — still the 0005 shape-only version' end

union all
select 'trigger jobs_apply_worker_price (0005)',
       case when exists (select 1 from pg_trigger where tgname = 'jobs_apply_worker_price' and not tgisinternal)
       then 'ok' else 'MISSING — workers can set their own pay' end

union all
select 'trigger services_guard_worker_price (0006)',
       case when exists (select 1 from pg_trigger where tgname = 'services_guard_worker_price' and not tgisinternal)
       then 'ok' else 'MISSING — managers can set catalogue pay' end

union all
-- The whole point of 0007: no site may carry these two keys.
select 'no worker/worker_price in any site config',
       case when not exists (
         select 1 from sites s,
                     lateral jsonb_array_elements(s.customer_report_config -> 'columns') c
         where c ->> 'key' in ('worker', 'worker_price')
       ) then 'ok' else 'LEAK — rerun the update in 0007' end

union all
select 'every site config has the 7 allowed columns',
       case when not exists (
         select 1 from sites s
         where (select count(*) from jsonb_array_elements(s.customer_report_config -> 'columns')) <> 7
       ) then 'ok' else 'check — a site has a non-default column set' end

union all
select 'stats views rebuilt on jobs.service_id (0005)',
       case when (select count(*) from pg_views
                  where schemaname = 'public'
                    and viewname in ('job_daily_stats', 'job_service_stats', 'jobs_worker_view')) = 3
       then 'ok' else 'MISSING — a view did not come back' end

union all
select 'photos.kind accepts extra_1..3 (0005)',
       case when exists (
         select 1 from pg_constraint
         where conname = 'photos_kind_check' and pg_get_constraintdef(oid) like '%extra_3%'
       ) then 'ok' else 'MISSING — extra photo kinds rejected' end

union all
-- Not a failure: just tells you whether prices have been entered yet.
select 'services with a price set',
       (select count(*) filter (where worker_price > 0) || ' of ' || count(*) from services where deleted_at is null);
