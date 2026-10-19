-- ===========================================================================
-- 0024 — drop billing_code / manager_note from jobs (step 2 of 2)
--
-- Run after 0023 AND after the web build that reads jobs_manager / writes
-- job_billing is live. From here the only copy is job_billing, which workers
-- cannot read.
-- ===========================================================================

begin;

drop trigger if exists jobs_mirror_billing on jobs;
drop function if exists jobs_mirror_billing();

-- 0021's guard minus the two columns that no longer exist on jobs.
create or replace function jobs_guard_worker_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
begin
  select * into caller from current_app_user();

  if caller is null or caller.role <> 'worker' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.locked_at := now() + interval '15 minutes';
    new.deleted_at := null;
  else
    new.created_at := old.created_at;
    new.locked_at := old.locked_at;
    new.deleted_at := old.deleted_at;
  end if;

  return new;
end;
$$;

alter table jobs drop column billing_code, drop column manager_note;

commit;
