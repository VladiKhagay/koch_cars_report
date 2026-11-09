-- Read-only check that 0034 (manager/admin full edit, audit triggers, photo
-- tombstones) is fully in place. Paste into the Supabase SQL editor. Every row
-- should read 'ok'. Nothing here writes.
--
-- Run as the SQL-editor user: there is no app user in context, so these checks
-- read catalog definitions and privileges, not role behaviour.

select 'photos.removed_at (0034)' as check,
       case when exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'photos'
                           and column_name = 'removed_at')
       then 'ok' else 'MISSING — run 0034' end as status

union all
select 'photos_update exists, manager/admin only',
       case when exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'photos' and policyname = 'photos_update'
           and cmd = 'UPDATE'
           and coalesce(qual, '') like '%admin%' and coalesce(with_check, '') like '%admin%'
           and coalesce(qual, '') || coalesce(with_check, '') not like '%worker%'
           and coalesce(qual, '') || coalesce(with_check, '') not like '%coworker_ids%'
       ) then 'ok' else 'MISSING/LEAK — photos_update absent or open to workers' end

union all
select 'no DELETE policy on photos (removal is the tombstone)',
       case when not exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'photos' and cmd in ('DELETE', 'ALL')
       ) then 'ok' else 'LEAK — photo rows can be deleted' end

union all
select 'audit_log_insert dropped (rows come from triggers only)',
       case when not exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'audit_log' and cmd in ('INSERT', 'ALL')
       ) then 'ok' else 'LEAK — clients can still write (or forge) audit rows' end

union all
-- Client prices are admin-only: a manager must not read them through the log.
select 'audit_log_select hides client prices from managers',
       case when exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_select'
           and cmd = 'SELECT'
           and coalesce(qual, '') like '%client_price_update%'
           and coalesce(qual, '') like '%(unit|total)_price%'
           and coalesce(qual, '') ilike '%coalesce(%changes%'
       ) and (select count(*) from pg_policies
              where schemaname = 'public' and tablename = 'audit_log' and cmd in ('SELECT', 'ALL')) = 1
       and exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'job_service_client_prices_audit'
           and pg_get_functiondef(p.oid) like '%''client_price_update''%'
       ) then 'ok' else 'LEAK — managers can read client prices in audit_log' end

union all
select 'manager/admin cannot move a job date into the future',
       case when exists (select 1 from pg_trigger
                         where tgname = 'jobs_guard_date' and not tgisinternal)
             and exists (
               select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'jobs_guard_date'
                 and pg_get_functiondef(p.oid) like '%5 minutes%'
             )
       then 'ok' else 'MISSING — a future date holds the worker video window open' end

union all
select 'photos_guard_update pins the row id',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'photos_guard_update'
           and pg_get_functiondef(p.oid) like '%new.id := old.id%'
       ) then 'ok' else 'STALE — photo row id can be rewritten' end

union all
select 'authenticated (not anon) can execute can_view_photo',
       case when has_function_privilege('authenticated', 'public.can_view_photo(uuid, text)', 'execute')
             and not has_function_privilege('anon', 'public.can_view_photo(uuid, text)', 'execute')
       then 'ok' else 'BROKEN — Worker /photo 403s, or anon can probe jobs' end

union all
select 'can_view_photo honours the tombstone and can_view_job',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'can_view_photo' and p.prosecdef
           and pg_get_functiondef(p.oid) like '%can_view_job%'
           and pg_get_functiondef(p.oid) like '%removed_at is not null%'
       ) then 'ok' else 'STALE — removed photos still stream' end

union all
select 'audit_diff is not an RPC',
       case when not has_function_privilege('authenticated', 'public.audit_diff(jsonb, jsonb, text[])', 'execute')
             and not has_function_privilege('anon', 'public.audit_diff(jsonb, jsonb, text[])', 'execute')
       then 'ok' else 'LEAK — audit_diff callable by clients' end

union all
select 'triggers 0034 in place',
       case when (select count(*) from pg_trigger
                  where not tgisinternal and tgname in (
                    'photos_guard_update', 'jobs_flag_duplicate', 'jobs_audit',
                    'job_billing_audit', 'job_services_audit',
                    'job_service_client_prices_audit', 'photos_audit')) = 7
       then 'ok' else 'MISSING — a 0034 trigger' end

union all
select 'photos_stamp_video_expiry still in place (0020/0025)',
       case when exists (select 1 from pg_trigger
                         where tgname = 'photos_stamp_video_expiry' and not tgisinternal)
       then 'ok' else 'MISSING — video expiry no longer stamped on insert' end

union all
select 'jobs_flag_duplicate re-runs on plate/VIN/date updates',
       case when exists (
         select 1 from pg_trigger
         where tgname = 'jobs_flag_duplicate' and not tgisinternal
           and pg_get_triggerdef(oid) like '%INSERT OR UPDATE OF plate, vin, created_at%'
       ) and exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'jobs_flag_duplicate'
           and pg_get_functiondef(p.oid) like '%j.created_at < new.created_at%'
       ) then 'ok' else 'STALE — 0029 insert-only flag' end

union all
select 'audit triggers are security definer',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.prosecdef
                    and p.proname in ('jobs_audit', 'job_billing_audit', 'job_services_audit',
                                      'job_service_client_prices_audit', 'photos_audit')) = 5
       then 'ok' else 'BROKEN — audit inserts hit RLS (no insert policy) and fail the save' end

union all
-- Same rule as verify_0033: `caller is [not] null` on a users row is false for
-- a user with any NULL column (no site_id), which would skip their audit row.
select 'audit triggers test caller.id, not the whole row',
       case when not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('jobs_audit', 'job_billing_audit', 'job_services_audit',
                             'job_service_client_prices_audit', 'photos_audit')
           and (pg_get_functiondef(p.oid) like '%caller is not null%'
                or pg_get_functiondef(p.oid) like '%caller is null%')
       ) and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('jobs_audit', 'job_billing_audit', 'job_services_audit',
                                  'job_service_client_prices_audit', 'photos_audit')
                and pg_get_functiondef(p.oid) like '%caller.id is null%') = 5
       then 'ok' else 'BROKEN — a siteless manager/admin edit goes unaudited' end

union all
select 'job_health_check counts live photos only, security_invoker',
       case when pg_get_viewdef('public.job_health_check'::regclass) like '%removed_at IS NULL%'
             and 'security_invoker=true' = any (coalesce(
                   (select reloptions from pg_class where oid = 'public.job_health_check'::regclass), '{}'))
       then 'ok' else 'STALE — removed photos still count, or view skips RLS' end

union all
select 'no photo row expires more than 60 days out',
       case when not exists (
         select 1 from photos where expires_at > now() + interval '60 days'
       ) then 'ok' else 'MISMATCH — expires_at claims media past the bucket lifecycle' end;
