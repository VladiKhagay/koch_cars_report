-- Read-only check that 0043 (who may move a job to another site) is in
-- place. Paste into the Supabase SQL editor. Every row should read 'ok'.
-- Nothing here writes.
--
-- Catalog checks only. For behaviour, run supabase/scenarios_0043.sql on a
-- non-production copy.

select 'jobs_guard_site trigger is on jobs, enabled, before update' as check,
       case when exists (
         select 1 from pg_trigger t
         where t.tgrelid = 'public.jobs'::regclass
           and t.tgname = 'jobs_guard_site' and not t.tgisinternal
           and t.tgenabled = 'O'
           and pg_get_triggerdef(t.oid) like '%BEFORE UPDATE ON public.jobs%'
           and pg_get_triggerdef(t.oid) like '%FOR EACH ROW%'
       ) then 'ok' else 'MISSING — managers and workers can still move jobs to any site' end as status

union all
select 'jobs_guard_site is security definer, pinned search_path, the 0043 rules',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'jobs_guard_site'
           and p.prosecdef
           and 'search_path=public' = any (coalesce(p.proconfig, '{}'))
           and p.prosrc like '%new.site_id is not distinct from old.site_id%'
           and p.prosrc like '%''admin''%'
           and p.prosrc like '%old.locked_at > now()%'
           and p.prosrc like '%s.active%'
           and p.prosrc like '%vin_rule%'
           and p.prosrc like '%plate_rule%'
           and p.prosrc like '%42501%'
       ) then 'ok' else 'STALE — function body is not the 0043 one' end

union all
select 'jobs_guard_site is not executable by anon',
       case when not has_function_privilege('anon', 'public.jobs_guard_site()', 'EXECUTE')
            then 'ok' else 'CHECK — anon holds EXECUTE (SECURITY-AUDIT N-1)' end;
