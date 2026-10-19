-- ===========================================================================
-- 0021 — workers cannot write the columns that are not theirs
--
-- jobs_insert / jobs_update decide whether a ROW may be written, not which of
-- its columns. A worker holding their own JWT could therefore PATCH their job
-- and set locked_at into the future (the 15-minute edit window never closes),
-- backdate created_at, or edit billing_code / manager_note / deleted_at.
--
-- Same remedy as jobs_apply_worker_price (0005) and services_guard_worker_price
-- (0006): the table defends itself with a trigger. Worker writes to these
-- columns are silently reverted rather than raising, so a client that sends the
-- whole row back does not fail on fields it never changed.
--
-- Managers and admins, and callers with no app user (service role, SQL editor),
-- are untouched.
-- ===========================================================================

begin;

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
    new.billing_code := null;
    new.manager_note := null;
  else
    new.created_at := old.created_at;
    new.locked_at := old.locked_at;
    new.deleted_at := old.deleted_at;
    new.billing_code := old.billing_code;
    new.manager_note := old.manager_note;
  end if;

  return new;
end;
$$;

drop trigger if exists jobs_guard_worker_columns on jobs;
create trigger jobs_guard_worker_columns
  before insert or update on jobs
  for each row execute function jobs_guard_worker_columns();

commit;
