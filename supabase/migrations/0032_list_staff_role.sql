-- list_staff() also returns the role, so the co-worker picker can offer workers only.
-- The return type changes, so the function is dropped and recreated (body and grants as 0019).
drop function if exists list_staff();

create function list_staff()
returns table (id uuid, name text, site_id uuid, active boolean, role user_role)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select u.id from current_app_user() u) is null then
    raise exception 'forbidden';
  end if;

  return query
  select u.id, u.name, u.site_id, u.active, u.role from users u order by u.name;
end;
$$;

revoke all on function list_staff() from public, anon;
grant execute on function list_staff() to authenticated;
