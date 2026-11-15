-- Behaviour scenarios for 0038 (hide client prices from viewers).
-- MANUAL script, for a local or branch database ONLY — never production:
-- it inserts a fixture job, flips the switch and impersonates users.
-- Everything runs in one transaction that ends in ROLLBACK, so nothing is
-- kept (the switch included). Each check raises on failure; reaching the
-- final notice means every scenario passed.
--
-- Needs one active admin, one active manager, one active 'carasso' (viewer)
-- user linked to a site in user_sites, and one service. Run as the SQL-editor
-- (postgres) user: fixtures are written in that trusted context, then each
-- block switches to `authenticated` with that user's JWT `sub`.

begin;

-- ---------------------------------------------------------------- fixtures
do $$
declare
  a  users;
  m  users;
  c  users;
  s  uuid;
  sv uuid;
  j  uuid;
begin
  select * into a from users where role = 'admin' and active order by created_at limit 1;
  select * into m from users where role = 'manager' and active order by created_at limit 1;
  select u.* into c from users u
  where u.role = 'carasso' and u.active and exists (select 1 from user_sites us where us.user_id = u.id)
  order by u.created_at limit 1;
  if a.id is null or m.id is null or c.id is null then
    raise exception 'scenarios_0038 needs an active admin, manager and site-linked viewer';
  end if;
  s  := (select us.site_id from user_sites us where us.user_id = c.id order by us.site_id limit 1);
  sv := (select id from services where deleted_at is null order by sort_order, id limit 1);
  if sv is null then raise exception 'scenarios_0038 needs a service'; end if;

  -- The seed trigger adds the line and snapshots its client price row.
  insert into jobs (site_id, worker_id, service_id, plate, vin)
  values (s, a.id, sv, '9990381', 'SCN00380000000001') returning id into j;
  update job_service_client_prices set unit_price = 11, total_price = 22 where job_id = j;

  -- Start from the default whatever this database has.
  update app_settings set value = 'false'::jsonb where key = 'hide_client_prices';
  if not found then raise exception 'hide_client_prices row missing: run 0038'; end if;

  perform set_config('s38.admin', a.auth_id::text, true);
  perform set_config('s38.manager', m.auth_id::text, true);
  perform set_config('s38.viewer', c.auth_id::text, true);
  perform set_config('s38.job', j::text, true);
end $$;

set local role authenticated;

-- ---------------------------------------------------------------- viewer, switch off
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s38.viewer'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s38.viewer'), true);

do $$
declare
  j uuid := current_setting('s38.job')::uuid;
  v record;
  n int;
begin
  select client_unit_price, client_total_price, services into v from jobs_carasso where id = j;
  if not found then raise exception 'viewer cannot see the fixture job'; end if;
  if v.client_unit_price is distinct from 11 or v.client_total_price is distinct from 22 then
    raise exception 'off: viewer job prices % / %, expected 11 / 22', v.client_unit_price, v.client_total_price;
  end if;
  if (v.services->0->>'client_unit_price')::numeric is distinct from 11
     or (v.services->0->>'client_total_price')::numeric is distinct from 22 then
    raise exception 'off: viewer line prices wrong: %', v.services->0;
  end if;
  select count(*) into n from job_client_prices where job_id = j;
  if n <> 1 then raise exception 'off: viewer reads % job_client_prices rows, expected 1', n; end if;
  select count(*) into n from job_service_client_prices where job_id = j;
  if n <> 1 then raise exception 'off: viewer reads % job_service_client_prices rows, expected 1', n; end if;

  begin
    perform set_hide_client_prices(true);
    raise exception 'LEAK: viewer flipped the switch';
  exception when raise_exception then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------- manager
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s38.manager'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s38.manager'), true);

do $$
begin
  begin
    perform set_hide_client_prices(true);
    raise exception 'LEAK: manager flipped the switch';
  exception when raise_exception then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------- admin turns it on
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s38.admin'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s38.admin'), true);

do $$
declare
  j uuid := current_setting('s38.job')::uuid;
  v record;
begin
  begin
    perform set_hide_client_prices(null);
    raise exception 'null accepted';
  exception when raise_exception then
    if sqlerrm <> 'invalid value' then raise; end if;
  end;

  perform set_hide_client_prices(true);

  -- The admin still sees every price while viewers are blocked.
  select client_unit_price, client_total_price, services into v from jobs_carasso where id = j;
  if v.client_unit_price is distinct from 11 or v.client_total_price is distinct from 22
     or (v.services->0->>'client_unit_price')::numeric is distinct from 11 then
    raise exception 'on: admin lost prices: % / % / %', v.client_unit_price, v.client_total_price, v.services->0;
  end if;
end $$;

-- ---------------------------------------------------------------- viewer, switch on
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s38.viewer'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s38.viewer'), true);

do $$
declare
  j uuid := current_setting('s38.job')::uuid;
  v record;
  n int;
begin
  select client_unit_price, client_total_price, services into v from jobs_carasso where id = j;
  if not found then raise exception 'on: viewer lost the job itself'; end if;
  if v.client_unit_price is not null or v.client_total_price is not null then
    raise exception 'LEAK: on: viewer job prices % / %', v.client_unit_price, v.client_total_price;
  end if;
  -- Keys stay (same shape), values are JSON null.
  if not (v.services->0 ? 'client_unit_price') or not (v.services->0 ? 'client_total_price') then
    raise exception 'on: services[] lost its price keys: %', v.services->0;
  end if;
  if jsonb_typeof(v.services->0->'client_unit_price') <> 'null'
     or jsonb_typeof(v.services->0->'client_total_price') <> 'null' then
    raise exception 'LEAK: on: viewer line prices %', v.services->0;
  end if;
  select count(*) into n from job_client_prices where job_id = j;
  if n <> 0 then raise exception 'LEAK: on: viewer reads % job_client_prices rows', n; end if;
  select count(*) into n from job_service_client_prices where job_id = j;
  if n <> 0 then raise exception 'LEAK: on: viewer reads % job_service_client_prices rows', n; end if;
end $$;

-- ---------------------------------------------------------------- admin turns it off again
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s38.admin'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s38.admin'), true);

do $$
begin
  perform set_hide_client_prices(false);
end $$;

select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s38.viewer'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s38.viewer'), true);

do $$
declare
  j uuid := current_setting('s38.job')::uuid;
  v record;
begin
  select client_unit_price, client_total_price into v from jobs_carasso where id = j;
  if v.client_unit_price is distinct from 11 or v.client_total_price is distinct from 22 then
    raise exception 'off again: viewer job prices % / %', v.client_unit_price, v.client_total_price;
  end if;
  raise notice 'scenarios_0038: all passed';
end $$;

rollback;
