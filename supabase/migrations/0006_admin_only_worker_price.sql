-- ===========================================================================
-- 0006 — worker_price is an admin-only column
--
-- The Services screen now shows and edits `services.worker_price`, gated to
-- admins in the UI. That gate is cosmetic on its own: `services_update` (0004)
-- lets any manager UPDATE any column of the row, so a manager with their own
-- JWT can PATCH /rest/v1/services?id=eq.… and set the price the payroll
-- figures are derived from. Hiding an input does not remove a capability.
--
-- Same reasoning as `update_my_name` (0004) and `update_customer_report_config`
-- (0005): when the rule is "this column, this role", a row-level policy can't
-- express it — the policy decides whether the row may be written, not which of
-- its columns. Postgres does have column-level grants, but they apply to the
-- `authenticated` role as a whole, which is the same role admins arrive on, so
-- that would lock everyone out equally.
--
-- So the column defends itself with a trigger, mirroring `jobs_apply_worker_price`
-- from 0005. Non-admin writes are silently reverted to the stored value rather
-- than raising: a manager renaming a service sends the whole row back, and
-- failing their rename because it carried an unchanged price they never saw
-- would be a worse bug than ignoring the field.
--
-- Apply after 0005.
-- ===========================================================================

begin;

create or replace function services_guard_worker_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
begin
  select * into caller from current_app_user();

  if caller is not null and caller.role = 'admin' then
    return new;
  end if;

  -- INSERT has no OLD row, so a non-admin's new service starts unpriced and an
  -- admin sets the price afterwards.
  if tg_op = 'INSERT' then
    new.worker_price := 0;
  else
    new.worker_price := old.worker_price;
  end if;

  return new;
end;
$$;

-- `of worker_price` narrows the UPDATE case: a manager editing only the
-- catalogue number or name never enters this function at all.
drop trigger if exists services_guard_worker_price on services;
create trigger services_guard_worker_price
  before insert or update of worker_price on services
  for each row execute function services_guard_worker_price();

commit;
