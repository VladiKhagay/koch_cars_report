-- Behaviour scenarios for 0042 (per-site VIN / plate rules).
-- MANUAL script, for a local or branch database ONLY — never production:
-- it inserts fixture sites and jobs, changes a site's rules and impersonates
-- users. Everything runs in one transaction that ends in ROLLBACK, so nothing
-- is kept. Each check raises on failure; reaching the final notice means every
-- scenario passed.
--
-- Needs: one active admin; one active manager with an active site that also
-- has an active worker; one service. Run as the SQL-editor (postgres) user:
-- fixtures are written in that trusted context, then each block switches to
-- `authenticated` with that user's JWT `sub`.
--
-- A job with neither plate nor VIN is refused by jobs_insert (42501) before
-- the CHECK runs, so on insert either code counts as refused; on update it is
-- jobs_plate_or_vin_chk (23514).

begin;

-- ---------------------------------------------------------------- fixtures
do $$
declare
  a  users;
  m  users;
  w  users;
  sv uuid;
  s_req uuid;  -- defaults: VIN required, plate optional
  s_opt uuid;  -- both optional
begin
  select * into a from users where role = 'admin' and active order by created_at limit 1;
  select mu.* into m from users mu
  join sites ms on ms.id = mu.site_id and ms.active
  where mu.role = 'manager' and mu.active
    and exists (select 1 from users wu where wu.role = 'worker' and wu.active and wu.site_id = mu.site_id)
  order by mu.created_at limit 1;
  select * into w from users where role = 'worker' and active and site_id = m.site_id order by created_at limit 1;
  sv := (select id from services where deleted_at is null order by sort_order, id limit 1);
  if a.id is null or m.id is null or w.id is null or sv is null then
    raise exception 'scenarios_0042 missing fixtures: admin=% manager_with_worker_at_active_site=% service=%',
      a.id is not null, (m.id is not null and w.id is not null), sv is not null;
  end if;

  insert into sites (name) values ('scn0042 req ' || gen_random_uuid()) returning id into s_req;
  if (select (vin_rule, plate_rule) from sites where id = s_req) is distinct from ('required'::text, 'optional'::text) then
    raise exception 'a new site does not default to VIN required, plate optional';
  end if;
  insert into sites (name, vin_rule, plate_rule)
  values ('scn0042 opt ' || gen_random_uuid(), 'optional', 'optional') returning id into s_opt;

  -- The manager's (and worker's) site: VIN optional, plate required.
  update sites set vin_rule = 'optional', plate_rule = 'required' where id = m.site_id;

  perform set_config('s42.admin', a.auth_id::text, true);
  perform set_config('s42.manager', m.auth_id::text, true);
  perform set_config('s42.worker', w.auth_id::text, true);
  perform set_config('s42.admin_id', a.id::text, true);
  perform set_config('s42.manager_id', m.id::text, true);
  perform set_config('s42.worker_id', w.id::text, true);
  perform set_config('s42.site', m.site_id::text, true);
  perform set_config('s42.service', sv::text, true);
  perform set_config('s42.s_req', s_req::text, true);
  perform set_config('s42.s_opt', s_opt::text, true);
end $$;

set local role authenticated;

-- ---------------------------------------------------------------- worker (site: VIN optional, plate required)
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s42.worker'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s42.worker'), true);

do $$
declare
  me   uuid := current_setting('s42.worker_id')::uuid;
  site uuid := current_setting('s42.site')::uuid;
  sv   uuid := current_setting('s42.service')::uuid;
  j    uuid;
  n    int;
begin
  j := create_job(site, me, '99904201', null, null, null, null, '{}', array[sv]);
  if j is null then raise exception 'worker could not log a VIN-less job at a VIN-optional site'; end if;
  if (select vin from jobs where id = j) is not null then raise exception 'VIN-less job stored a VIN'; end if;

  begin
    perform create_job(site, me, null, 'SCN00420000000001', true, null, null, '{}', array[sv]);
    raise exception 'LEAK: worker logged a plate-less job at a plate-required site';
  exception when insufficient_privilege then null;
  end;
  begin
    perform create_job(site, me, '   ', 'SCN00420000000002', true, null, null, '{}', array[sv]);
    raise exception 'LEAK: worker logged a blank plate at a plate-required site';
  exception when insufficient_privilege then null;
  end;

  -- The worker can still edit their VIN-less job (rules bind new jobs only).
  update jobs set worker_note = 'scn0042 edit' where id = j;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'worker could not edit a VIN-less job (% rows)', n; end if;

  -- A worker cannot change the rules.
  update sites set plate_rule = 'optional' where id = site;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEAK: worker changed a site rule'; end if;
end $$;

-- ---------------------------------------------------------------- manager (own site: VIN optional, plate required)
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s42.manager'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s42.manager'), true);

do $$
declare
  me   uuid := current_setting('s42.manager_id')::uuid;
  wk   uuid := current_setting('s42.worker_id')::uuid;
  site uuid := current_setting('s42.site')::uuid;
  sv   uuid := current_setting('s42.service')::uuid;
  j    uuid;
  n    int;
begin
  -- For a worker: the site's rules apply.
  j := create_job(site, wk, '99904202', null, null, null, null, '{}', array[sv]);
  if j is null then raise exception 'manager could not log a VIN-less job for a worker at a VIN-optional site'; end if;
  begin
    perform create_job(site, wk, null, 'SCN00420000000003', true, null, null, '{}', array[sv]);
    raise exception 'LEAK: manager logged a plate-less job for a worker at a plate-required site';
  exception when insufficient_privilege then null;
  end;
  begin
    perform create_job(site, me, null, 'SCN00420000000004', true, null, null, '{}', array[sv]);
    raise exception 'LEAK: manager logged a plate-less job at a plate-required site';
  exception when insufficient_privilege then null;
  end;

  -- Managers cannot change the rules.
  update sites set vin_rule = 'required', plate_rule = 'optional' where id = site;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEAK: manager changed a site rule'; end if;
  update sites set vin_rule = 'required' where id = current_setting('s42.s_opt')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEAK: manager changed another site''s rule'; end if;
end $$;

-- ---------------------------------------------------------------- admin
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s42.admin'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s42.admin'), true);

do $$
declare
  me    uuid := current_setting('s42.admin_id')::uuid;
  s_req uuid := current_setting('s42.s_req')::uuid;
  s_opt uuid := current_setting('s42.s_opt')::uuid;
  sv    uuid := current_setting('s42.service')::uuid;
  j     uuid;
  n     int;
begin
  -- VIN required (defaults): NULL and blank VINs refused, a VIN alone accepted.
  begin
    perform create_job(s_req, me, '99904203', null, null, null, null, '{}', array[sv]);
    raise exception 'LEAK: VIN-less job at a VIN-required site';
  exception when insufficient_privilege then null;
  end;
  begin
    perform create_job(s_req, me, '99904204', '   ', null, null, null, '{}', array[sv]);
    raise exception 'LEAK: blank VIN at a VIN-required site';
  exception when insufficient_privilege then null;
  end;
  -- Any whitespace is blank, not only spaces: tab, newline, NBSP.
  begin
    perform create_job(s_req, me, '99904209', E'\t', null, null, null, '{}', array[sv]);
    raise exception 'LEAK: tab-only VIN at a VIN-required site';
  exception when insufficient_privilege then null;
  end;
  begin
    perform create_job(s_req, me, '99904210', E' \n\r ', null, null, null, '{}', array[sv]);
    raise exception 'LEAK: newline-only VIN at a VIN-required site';
  exception when insufficient_privilege then null;
  end;
  begin
    perform create_job(s_req, me, '99904211', U&'\00A0\3000', null, null, null, '{}', array[sv]);
    raise exception 'LEAK: NBSP / ideographic-space VIN at a VIN-required site';
  exception when insufficient_privilege then null;
  end;
  j := create_job(s_req, me, null, 'SCN00420000000005', true, null, null, '{}', array[sv]);
  if j is null then raise exception 'no job with a VIN and no plate at a default site'; end if;

  -- Direct insert is bound the same way.
  begin
    insert into jobs (site_id, worker_id, service_id, plate, vin) values (s_req, me, sv, '99904205', null);
    raise exception 'LEAK: direct VIN-less insert at a VIN-required site';
  exception when insufficient_privilege then null;
  end;

  -- Both optional: either one is enough, neither (or only blanks) is refused.
  j := create_job(s_opt, me, '99904206', null, null, null, null, '{}', array[sv]);
  if j is null then raise exception 'no plate-only job at an all-optional site'; end if;
  j := create_job(s_opt, me, null, 'SCN00420000000006', true, null, null, '{}', array[sv]);
  if j is null then raise exception 'no VIN-only job at an all-optional site'; end if;
  begin
    perform create_job(s_opt, me, null, null, null, null, null, '{}', array[sv]);
    raise exception 'LEAK: job with neither plate nor VIN';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    perform create_job(s_opt, me, E' \t', U&'\00A0', null, null, null, '{}', array[sv]);
    raise exception 'LEAK: job with only blank plate and VIN';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- An edit cannot clear both either (jobs_plate_or_vin_chk).
  begin
    update jobs set plate = null, vin = null where id = j;
    raise exception 'LEAK: edit cleared both plate and VIN';
  exception when check_violation then null;
  end;
  -- Clearing one is an edit like any other.
  update jobs set plate = '99904207', vin = null where id = j;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin could not clear a VIN on edit (% rows)', n; end if;

  -- Admin changes the rules; a value outside the two is refused.
  update sites set vin_rule = 'optional', plate_rule = 'required' where id = s_req;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin could not change a site''s rules (% rows)', n; end if;
  begin
    update sites set vin_rule = 'sometimes' where id = s_req;
    raise exception 'unknown vin_rule accepted';
  exception when check_violation then null;
  end;
  begin
    update sites set plate_rule = null where id = s_req;
    raise exception 'NULL plate_rule accepted';
  exception when not_null_violation then null;
  end;

  -- The new rules take effect at once.
  j := create_job(s_req, me, '99904208', null, null, null, null, '{}', array[sv]);
  if j is null then raise exception 'no VIN-less job after making the VIN optional'; end if;
  begin
    perform create_job(s_req, me, null, 'SCN00420000000007', true, null, null, '{}', array[sv]);
    raise exception 'LEAK: plate-less job after making the plate required';
  exception when insufficient_privilege then null;
  end;

  raise notice 'scenarios_0042: all passed';
end $$;

rollback;
