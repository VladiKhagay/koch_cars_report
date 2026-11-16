-- Read-only check that 0039 (five extra photos) is in place. Paste into the
-- Supabase SQL editor. Every row should read 'ok'. Nothing here writes.

select 'photos_kind_check allows extra_4, extra_5 and video' as check,
       case when exists (
         select 1 from pg_constraint
         where conname = 'photos_kind_check'
           and conrelid = 'public.photos'::regclass
           and pg_get_constraintdef(oid) like '%extra_4%'
           and pg_get_constraintdef(oid) like '%extra_5%'
           and pg_get_constraintdef(oid) like '%video%'
       ) then 'ok' else 'STALE — run 0039' end as status;
