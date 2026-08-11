-- Security fix: workers could previously SELECT every job at their site
-- directly through the API (RLS cannot hide columns, so that included
-- billing_code and manager_note — fields the worker role is not meant to
-- see; jobs_worker_view only protected the well-behaved frontend path).
--
-- After this migration a worker can only read their OWN jobs. The one
-- legitimate site-wide read a worker needs — "was this VIN logged at my
-- site recently?" for the duplicate flag — moves into a security definer
-- function that returns only a job id, not the row.

drop policy jobs_select on jobs;

create policy jobs_select on jobs for select
  using (
    exists (
      select 1 from current_app_user() u
      where u.role = 'admin'
         or (u.role = 'manager' and u.site_id = jobs.site_id)
         or (u.role = 'worker' and u.id = jobs.worker_id)
    )
  );

create or replace function find_recent_duplicate(p_site_id uuid, p_vin text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result uuid;
  caller users;
begin
  select * into caller from current_app_user();
  -- Same site-membership rule the old policy enforced, minus the row access.
  if caller is null or (caller.role <> 'admin' and caller.site_id is distinct from p_site_id) then
    return null;
  end if;

  select id into result
  from jobs
  where site_id = p_site_id
    and vin = upper(trim(p_vin))
    and deleted_at is null
    and created_at >= now() - interval '7 days'
  order by created_at desc
  limit 1;
  return result;
end;
$$;

revoke all on function find_recent_duplicate(uuid, text) from public;
grant execute on function find_recent_duplicate(uuid, text) to authenticated;
