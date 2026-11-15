-- Read-only check that 0037 (partial plate / VIN lookup) is in place. Paste into
-- the Supabase SQL editor. Every row should read 'ok'. Nothing here writes.
-- For behaviour, run supabase/scenarios_0037.sql on a non-production copy.

select 'pg_trgm installed' as check,
       case when exists (select 1 from pg_extension where extname = 'pg_trgm')
            then 'ok' else 'MISSING — run 0037' end as status

union all
select 'trigram indexes on jobs.vin / jobs.plate (live jobs only), valid',
       case when (select count(*) from pg_indexes i
                  join pg_class c on c.relname = i.indexname
                  join pg_index x on x.indexrelid = c.oid
                  where i.schemaname = 'public' and i.tablename = 'jobs'
                    and i.indexname in ('jobs_vin_trgm_idx', 'jobs_plate_trgm_idx')
                    and i.indexdef like '%gin_trgm_ops%'
                    and i.indexdef like '%deleted_at IS NULL%'
                    and x.indisvalid) = 2
            then 'ok' else 'MISSING/INVALID — run 0037' end

union all
select 'lookup_vehicle: 0037 body (contains, escaped, staff guard), security definer',
       case when exists (
         select 1 from pg_proc p
         where p.oid = 'public.lookup_vehicle(text)'::regprocedure
           and p.prosecdef
           and p.prosrc like '%ilike pat escape%'
           and p.prosrc like '%''worker'', ''manager'', ''admin''%'
           and p.prosrc like '%length(q) < 4%'
       ) then 'ok' else 'STALE — run 0037' end

union all
select 'lookup_vehicle: authenticated may execute, anon may not',
       case when has_function_privilege('authenticated', 'public.lookup_vehicle(text)', 'execute')
             and not has_function_privilege('anon', 'public.lookup_vehicle(text)', 'execute')
            then 'ok' else 'GRANTS WRONG — re-run the grant/revoke in 0037' end;
