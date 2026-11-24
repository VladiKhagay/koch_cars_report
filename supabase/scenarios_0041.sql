-- Behaviour scenarios for 0041 (admins rename / disable / delete sites).
-- MANUAL script, for a local or branch database ONLY — never production:
-- it inserts fixture sites and jobs, disables a site, moves a user and
-- impersonates users. Everything runs in one transaction that ends in
-- ROLLBACK, so nothing is kept. Each check raises on failure; reaching the
-- final notice means every scenario passed.
--
-- Needs: one active admin; one active manager with a site that also has an
-- active worker; optionally one more active user of any role (else the admin is used; moved, inside the
-- transaction, onto a fixture site); one service. Run as the SQL-editor
-- (postgres) user: fixtures are written in that trusted context, then each
-- block switches to `authenticated` with that user's JWT `sub`.

begin;

-- ---------------------------------------------------------------- fixtures
do $$
declare
  a  users;
  m  users;
  w  users;
  x  users;   -- any other user, moved onto s_user
  sv uuid;
  s_job  uuid;  -- has a job
  s_user uuid;  -- has a user (home site)
  s_link uuid;  -- has a user_sites link
  s_free uuid;  -- nothing refers to it
  j uuid;
begin
  select * into a from users where role = 'admin' and active order by created_at limit 1;
  select mu.* into m from users mu
  where mu.role = 'manager' and mu.active and mu.site_id is not null
    and exists (select 1 from users wu where wu.role = 'worker' and wu.active and wu.site_id = mu.site_id)
  order by mu.created_at limit 1;
  select * into w from users where role = 'worker' and active and site_id = m.site_id order by created_at limit 1;
  select * into x from users
  where id not in (a.id, coalesce(m.id, a.id), coalesce(w.id, a.id)) and role <> 'carasso'
  order by created_at limit 1;
  if x.id is null then x := a; end if;  -- tiny DB: the admin doubles as the moved user
  sv := (select id from services where deleted_at is null order by sort_order, id limit 1);
  if a.id is null or m.id is null or w.id is null or x.id is null or sv is null then
    raise exception 'scenarios_0041 missing fixtures: admin=% manager_with_worker=% service=%',
      a.id is not null, (m.id is not null and w.id is not null), sv is not null;
  end if;

  insert into sites (name) values ('scn0041 job '  || gen_random_uuid()) returning id into s_job;
  insert into sites (name) values ('scn0041 user ' || gen_random_uuid()) returning id into s_user;
  insert into sites (name) values ('scn0041 link ' || gen_random_uuid()) returning id into s_link;
  insert into sites (name) values ('scn0041 free ' || gen_random_uuid()) returning id into s_free;
  if (select active from sites where id = s_free) is distinct from true then
    raise exception 'a new site is not active by default';
  end if;

  insert into jobs (site_id, worker_id, service_id, plate, vin)
  values (s_job, a.id, sv, '9990411', 'SCN00410000000001');
  update users set site_id = s_user where id = x.id;
  insert into user_sites (user_id, site_id) values (a.id, s_link);

  -- The worker's own job at their site, window open: read/edit after disabling.
  insert into jobs (site_id, worker_id, service_id, plate, vin)
  values (w.site_id, w.id, sv, '9990412', 'SCN00410000000002') returning id into j;

  -- Disable the manager's (and worker's) site.
  update sites set active = false where id = m.site_id;

  perform set_config('s41.admin', a.auth_id::text, true);
  perform set_config('s41.manager', m.auth_id::text, true);
  perform set_config('s41.worker', w.auth_id::text, true);
  perform set_config('s41.admin_id', a.id::text, true);
  perform set_config('s41.manager_id', m.id::text, true);
  perform set_config('s41.worker_id', w.id::text, true);
  perform set_config('s41.site', m.site_id::text, true);
  perform set_config('s41.service', sv::text, true);
  perform set_config('s41.j_own', j::text, true);
  perform set_config('s41.s_job', s_job::text, true);
  perform set_config('s41.s_user', s_user::text, true);
  perform set_config('s41.s_link', s_link::text, true);
  perform set_config('s41.s_free', s_free::text, true);
end $$;

set local role authenticated;

-- ---------------------------------------------------------------- worker, site disabled
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s41.worker'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s41.worker'), true);

do $$
declare
  me   uuid := current_setting('s41.worker_id')::uuid;
  site uuid := current_setting('s41.site')::uuid;
  sv   uuid := current_setting('s41.service')::uuid;
  j    uuid := current_setting('s41.j_own')::uuid;
  n    int;
begin
  begin
    perform create_job(site, me, '9990413', 'SCN00410000000003', true, null, null, '{}', array[sv]);
    raise exception 'LEAK: worker logged a job at a disabled site';
  exception when insufficient_privilege then null;
  end;

  -- History stays readable and editable.
  if not exists (select 1 from jobs_worker_view where id = j) then
    raise exception 'worker lost their job at a disabled site';
  end if;
  update jobs set worker_note = 'scn0041 edit' where id = j;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'worker could not edit a job at a disabled site (% rows)', n; end if;

  -- A worker cannot touch sites.
  update sites set active = true where id = site;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEAK: worker re-enabled a site'; end if;
end $$;

-- ---------------------------------------------------------------- manager, site disabled
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s41.manager'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s41.manager'), true);

do $$
declare
  me   uuid := current_setting('s41.manager_id')::uuid;
  wk   uuid := current_setting('s41.worker_id')::uuid;
  site uuid := current_setting('s41.site')::uuid;
  sv   uuid := current_setting('s41.service')::uuid;
  n    int;
begin
  begin
    perform create_job(site, me, '9990414', 'SCN00410000000004', true, null, null, '{}', array[sv]);
    raise exception 'LEAK: manager logged a job at a disabled site';
  exception when insufficient_privilege then null;
  end;
  begin
    perform create_job(site, wk, '9990415', 'SCN00410000000005', true, null, null, '{}', array[sv]);
    raise exception 'LEAK: manager logged a job for a worker at a disabled site';
  exception when insufficient_privilege then null;
  end;

  -- Managers still see the disabled site (filters, history).
  if not exists (select 1 from sites where id = site and not active) then
    raise exception 'manager cannot read the disabled site';
  end if;

  -- Managers cannot write sites.
  update sites set active = true where id = site;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEAK: manager re-enabled a site'; end if;
  update sites set name = name || ' x' where id = current_setting('s41.s_free')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEAK: manager renamed a site'; end if;
  delete from sites where id = current_setting('s41.s_free')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEAK: manager deleted a site'; end if;
end $$;

-- ---------------------------------------------------------------- admin
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s41.admin'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s41.admin'), true);

do $$
declare
  me   uuid := current_setting('s41.admin_id')::uuid;
  wk   uuid := current_setting('s41.worker_id')::uuid;
  site uuid := current_setting('s41.site')::uuid;
  sv   uuid := current_setting('s41.service')::uuid;
  j    uuid;
  n    int;
  taken text;
begin
  begin
    perform create_job(site, me, '9990416', 'SCN00410000000006', true, null, null, '{}', array[sv]);
    raise exception 'LEAK: admin logged a job at a disabled site';
  exception when insufficient_privilege then null;
  end;
  begin
    perform create_job(site, wk, '9990417', 'SCN00410000000007', true, null, null, '{}', array[sv]);
    raise exception 'LEAK: admin logged a job for a worker at a disabled site';
  exception when insufficient_privilege then null;
  end;

  -- Re-enable: jobs are accepted again.
  update sites set active = true where id = site;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin could not re-enable a site (% rows)', n; end if;
  j := create_job(site, me, '9990418', 'SCN00410000000008', true, null, null, '{}', array[sv]);
  if j is null then raise exception 'no job after re-enabling'; end if;

  -- Rename; a duplicate name is refused.
  update sites set name = 'scn0041 renamed ' || gen_random_uuid() where id = current_setting('s41.s_free')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin could not rename a site (% rows)', n; end if;
  taken := (select name from sites where id = site);
  begin
    update sites set name = taken where id = current_setting('s41.s_free')::uuid;
    raise exception 'duplicate site name accepted';
  exception when unique_violation then null;
  end;

  -- Delete refused while a job, a user or a viewer link refers to the site.
  begin
    delete from sites where id = current_setting('s41.s_job')::uuid;
    raise exception 'LEAK: deleted a site that has jobs';
  exception when foreign_key_violation then null;
  end;
  begin
    delete from sites where id = current_setting('s41.s_user')::uuid;
    raise exception 'LEAK: deleted a site that is a user''s home site';
  exception when foreign_key_violation then null;
  end;
  begin
    delete from sites where id = current_setting('s41.s_link')::uuid;
    raise exception 'LEAK: deleted a site with a viewer link';
  exception when foreign_key_violation then null;
  end;

  -- An unused site deletes.
  delete from sites where id = current_setting('s41.s_free')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin could not delete an unused site (% rows)', n; end if;

  raise notice 'scenarios_0041: all passed';
end $$;

rollback;
