-- Behaviour scenarios for 0043 (who may move a job to another site, and where).
-- MANUAL script, for a local or branch database ONLY — never production:
-- it inserts a fixture site and a job and impersonates users. Everything runs
-- in one transaction that ends in ROLLBACK, so nothing is kept. Each check
-- raises on failure; reaching the final notice means every scenario passed.
--
-- Needs: one active admin; one active manager with a site that also has an
-- active worker; one service. Run as the SQL-editor (postgres) user: fixtures
-- are written in that trusted context, then each block switches to
-- `authenticated` with that user's JWT `sub`.

begin;

-- ---------------------------------------------------------------- fixtures
do $$
declare
  a  users;
  m  users;
  w  users;
  sv uuid;
  s_other uuid;
  s_off uuid;
  s_strict uuid;
  j uuid;
begin
  select * into a from users where role = 'admin' and active order by created_at limit 1;
  select mu.* into m from users mu
  where mu.role = 'manager' and mu.active and mu.site_id is not null
    and exists (select 1 from users wu where wu.role = 'worker' and wu.active and wu.site_id = mu.site_id)
  order by mu.created_at limit 1;
  select * into w from users where role = 'worker' and active and site_id = m.site_id order by created_at limit 1;
  sv := (select id from services where deleted_at is null order by sort_order, id limit 1);
  if a.id is null or m.id is null or w.id is null or sv is null then
    raise exception 'scenarios_0043 missing fixtures: admin=% manager_with_worker=% service=%',
      a.id is not null, (m.id is not null and w.id is not null), sv is not null;
  end if;

  insert into sites (name) values ('scn0043 other ' || gen_random_uuid()) returning id into s_other;
  -- Disabled destination: an admin may still move a job there (rules bind new jobs only).
  insert into sites (name, active) values ('scn0043 off ' || gen_random_uuid(), false) returning id into s_off;
  -- Plate-required destination (0042).
  insert into sites (name, plate_rule) values ('scn0043 strict ' || gen_random_uuid(), 'required') returning id into s_strict;

  -- The worker's own job at the manager's site, 15-minute window open.
  insert into jobs (site_id, worker_id, service_id, plate, vin)
  values (m.site_id, w.id, sv, '9990431', 'SCN00430000000001') returning id into j;

  perform set_config('s43.admin', a.auth_id::text, true);
  perform set_config('s43.manager', m.auth_id::text, true);
  perform set_config('s43.worker', w.auth_id::text, true);
  perform set_config('s43.site', m.site_id::text, true);
  perform set_config('s43.s_other', s_other::text, true);
  perform set_config('s43.s_off', s_off::text, true);
  perform set_config('s43.s_strict', s_strict::text, true);
  perform set_config('s43.job', j::text, true);
end $$;

set local role authenticated;

-- ---------------------------------------------------------------- worker, window open
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s43.worker'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s43.worker'), true);

do $$
declare
  j     uuid := current_setting('s43.job')::uuid;
  site  uuid := current_setting('s43.site')::uuid;
  other uuid := current_setting('s43.s_other')::uuid;
  n     int;
begin
  -- Not to a disabled site (0041).
  begin
    update jobs set site_id = current_setting('s43.s_off')::uuid where id = j;
    raise exception 'LEAK: worker moved their job to a disabled site';
  exception when insufficient_privilege then
    if sqlerrm not like 'a job can only move%' then raise; end if;
  end;

  -- Not to a site whose rules the job (as updated) misses (0042).
  begin
    update jobs set plate = null, site_id = current_setting('s43.s_strict')::uuid where id = j;
    raise exception 'LEAK: worker moved a plate-less job to a plate-required site';
  exception when insufficient_privilege then
    if sqlerrm not like 'a job can only move%' then raise; end if;
  end;

  -- To an active site it meets the rules of: allowed (wrong-site fix), and back.
  update jobs set site_id = other where id = j;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'worker could not move their job in the window (% rows)', n; end if;
  update jobs set site_id = current_setting('s43.s_strict')::uuid where id = j;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'worker could not move a job with a plate to a plate-required site (% rows)', n; end if;
  update jobs set site_id = site where id = j;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'worker could not move their job back (% rows)', n; end if;

  -- Other fields, and site_id sent back unchanged, still save.
  update jobs set worker_note = 'scn0043 worker', site_id = site where id = j;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'worker could not edit their own job (% rows)', n; end if;
end $$;

-- ---------------------------------------------------------------- manager, own site
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s43.manager'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s43.manager'), true);

do $$
declare
  j     uuid := current_setting('s43.job')::uuid;
  site  uuid := current_setting('s43.site')::uuid;
  other uuid := current_setting('s43.s_other')::uuid;
  n     int;
begin
  begin
    update jobs set site_id = other where id = j;
    raise exception 'LEAK: manager moved a job off their site';
  exception when insufficient_privilege then
    if sqlerrm not like 'only an admin%' then raise; end if;
  end;

  update jobs set brand = 'scn0043', site_id = site where id = j;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'manager could not edit a job at their site (% rows)', n; end if;
end $$;

-- ---------------------------------------------------------------- admin
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s43.admin'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s43.admin'), true);

do $$
declare
  j     uuid := current_setting('s43.job')::uuid;
  site  uuid := current_setting('s43.site')::uuid;
  other uuid := current_setting('s43.s_other')::uuid;
  n     int;
begin
  update jobs set site_id = other where id = j;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin could not move a job (% rows)', n; end if;
  if (select site_id from jobs where id = j) is distinct from other then
    raise exception 'admin move did not stick';
  end if;

  update jobs set site_id = current_setting('s43.s_off')::uuid where id = j;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin could not move a job to a disabled site (% rows)', n; end if;

  update jobs set site_id = site where id = j;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin could not move the job back (% rows)', n; end if;
end $$;

-- ---------------------------------------------------------------- no JWT (service role / SQL editor)
-- Back to the trusted role with no claims, so auth.uid() is null and RLS is
-- bypassed: the trigger must let the move through (as 0021).
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);

do $$
declare
  j     uuid := current_setting('s43.job')::uuid;
  other uuid := current_setting('s43.s_other')::uuid;
  n     int;
begin
  if auth.uid() is not null then raise exception 'claims not cleared: auth.uid() = %', auth.uid(); end if;
  update jobs set site_id = other where id = j;
  get diagnostics n = row_count;
  if n <> 1 or (select site_id from jobs where id = j) is distinct from other then
    raise exception 'a no-JWT caller could not move a job (% rows)', n;
  end if;

  raise notice 'scenarios_0043: all passed';
end $$;

rollback;
