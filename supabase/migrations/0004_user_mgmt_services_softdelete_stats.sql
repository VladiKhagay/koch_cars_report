-- User management RPCs, service soft-delete + manager write access, and a
-- daily stats view for filtered analytics/exports.

-- ---------------------------------------------------------------------------
-- Services: soft delete + manager write access.
-- Hard DELETE is not granted to anyone through the API: the old catch-all
-- write policy is replaced by insert/update-only policies, so "delete" can
-- only ever mean setting deleted_at.
-- ---------------------------------------------------------------------------

alter table services add column deleted_at timestamptz;

drop policy services_write on services;

create policy services_insert on services for insert
  with check (exists (select 1 from current_app_user() u where u.role in ('admin', 'manager')));

create policy services_update on services for update
  using (exists (select 1 from current_app_user() u where u.role in ('admin', 'manager')))
  with check (exists (select 1 from current_app_user() u where u.role in ('admin', 'manager')));

-- ---------------------------------------------------------------------------
-- Self-service profile: any user may rename themselves — and nothing else.
-- Done as a security definer function instead of an UPDATE policy because a
-- row-level policy can't stop the user from also changing role/site_id.
-- ---------------------------------------------------------------------------

create or replace function update_my_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_name is null or length(trim(p_name)) = 0 or length(p_name) > 100 then
    raise exception 'invalid name';
  end if;
  update users set name = trim(p_name) where auth_id = auth.uid();
end;
$$;

revoke all on function update_my_name(text) from public;
grant execute on function update_my_name(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Activate/deactivate users.
--  - admins: any user except themselves (can't lock yourself out).
--  - managers: worker-role users at their own site only — a manager can't
--    deactivate another manager or an admin.
-- ---------------------------------------------------------------------------

create or replace function set_user_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
  target users;
begin
  select * into caller from current_app_user();
  select * into target from users where id = p_user_id;
  if caller is null or target is null then
    raise exception 'forbidden';
  end if;
  if caller.id = target.id then
    raise exception 'cannot change your own active status';
  end if;
  if caller.role = 'admin'
     or (caller.role = 'manager' and target.role = 'worker' and target.site_id = caller.site_id) then
    update users set active = p_active where id = p_user_id;
  else
    raise exception 'forbidden';
  end if;
end;
$$;

revoke all on function set_user_active(uuid, boolean) from public;
grant execute on function set_user_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Daily stats view: one row per (site, worker, service, day). Backs the
-- filtered analytics (date range / worker / service) and the stats export.
-- security_invoker so it inherits jobs RLS: workers see only their own
-- rows, managers their site, admins everything.
-- ---------------------------------------------------------------------------

create view job_daily_stats as
  select
    j.site_id,
    j.worker_id,
    js.service_id,
    date_trunc('day', j.created_at)::date as day,
    count(*) as job_count
  from jobs j
  join job_services js on js.job_id = j.id
  where j.deleted_at is null
  group by j.site_id, j.worker_id, js.service_id, date_trunc('day', j.created_at);

alter view job_daily_stats set (security_invoker = true);
