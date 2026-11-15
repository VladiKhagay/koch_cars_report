-- Behaviour scenarios for 0037 (partial plate / VIN in lookup_vehicle).
-- MANUAL script, for a local or branch database ONLY — never production:
-- it inserts fixture jobs and impersonates users. Everything runs in one
-- transaction that ends in ROLLBACK, so nothing is kept. Each check raises on
-- failure; reaching the final notice means every scenario passed.
--
-- Needs one active user with role 'worker', one site and one service. Run as
-- the SQL-editor (postgres) user: fixtures are written in that trusted
-- context, then each block switches to `authenticated` with a JWT `sub`.
--
-- Fixture VINs use letters (Z, Y, K) that random hex test data never holds and
-- plates 3701xxxx; assertions only look at fixture rows (`vin like 'Z37%'`),
-- so other jobs matching a short fragment do not break them.

begin;

-- ---------------------------------------------------------------- fixtures
do $$
declare
  w  users;
  s  uuid;
  sv uuid;
  j1 uuid;
begin
  select * into w from users where role = 'worker' and active order by created_at limit 1;
  if w.id is null then raise exception 'scenarios_0037 needs an active worker'; end if;
  s  := coalesce(w.site_id, (select id from sites order by created_at limit 1));
  sv := (select id from services order by sort_order, id limit 1);

  insert into jobs (site_id, worker_id, plate, vin, brand) values (s, w.id, '37011234', 'Z37KYWZZZ1JZ00001', 'Fixture') returning id into j1;
  insert into jobs (site_id, worker_id, plate, vin, brand) values (s, w.id, null,       'Z37KYTDKB20U98765', 'Fixture');
  -- A plate-less job whose VIN holds the digits 37019999: a digits query must find it via the VIN.
  insert into jobs (site_id, worker_id, plate, vin, brand) values (s, w.id, null,       'Z37KY370199990000', 'Fixture');
  insert into jobs (site_id, worker_id, plate, vin, brand, deleted_at) values (s, w.id, '37015555', 'Z37KYDELETED00001', 'Fixture', now());
  if sv is not null then
    insert into job_services (job_id, service_id, worker_price) values (j1, sv, 0);
  end if;

  perform set_config('s37.sub', w.auth_id::text, true);
end $$;

-- ---------------------------------------------------------------- as the worker
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s37.sub'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s37.sub'), true);
set local role authenticated;

-- Hit count among fixture rows for a query, as the current caller
-- (created after the role switch, so it owns and can run them).
create function pg_temp.hits(q text) returns int language sql as $$
  select count(*)::int from lookup_vehicle(q) r where r.vin like 'Z37KY%' $$;
create function pg_temp.total(q text) returns int language sql as $$
  select count(*)::int from lookup_vehicle(q) $$;

do $$
declare
  n int;
  r record;
begin
  -- Exact VIN still matches, with services and site.
  select * into r from lookup_vehicle('Z37KYWZZZ1JZ00001');
  if r.vin is distinct from 'Z37KYWZZZ1JZ00001' or r.site_name is null then
    raise exception 'exact VIN: got %', r;
  end if;
  if exists (select 1 from services) and r.service_name_en is null then
    raise exception 'exact VIN: service names missing';
  end if;

  -- Partial VIN: start, middle, end.
  if pg_temp.hits('Z37KYW') <> 1 then raise exception 'VIN start'; end if;
  if pg_temp.hits('ZZZ1JZ') <> 1 then raise exception 'VIN middle'; end if;
  if pg_temp.hits('U98765') <> 1 then raise exception 'VIN end'; end if;
  if pg_temp.hits('Z37KY') <> 3 then raise exception 'VIN prefix shared by 3 live fixtures: %', pg_temp.hits('Z37KY'); end if;

  -- Lowercase, spaces, hyphens are normalised away.
  if pg_temp.hits(' z37k-yw zzz ') <> 1 then raise exception 'lowercase/space/hyphen VIN'; end if;
  if pg_temp.hits('370-11-234') <> 1 then raise exception 'hyphenated plate'; end if;

  -- Partial plate, and a digits query also matches inside a VIN.
  if pg_temp.hits('7011234') <> 1 then raise exception 'partial plate'; end if;
  if pg_temp.hits('37019999') <> 1 then raise exception 'digits query matching a VIN (plate-less job)'; end if;
  if pg_temp.hits('3701') < 2 then raise exception 'digits: plate OR VIN'; end if;

  -- A query with a letter is VIN-only: a letter plus a fixture plate matches
  -- nothing, though the digits alone would.
  if pg_temp.hits('X37011234') <> 0 then raise exception 'letters must not search plates'; end if;

  -- Soft-deleted jobs are excluded (exact VIN and plate of the deleted one).
  if pg_temp.hits('Z37KYDELETED00001') <> 0 then raise exception 'deleted job by VIN'; end if;
  if pg_temp.hits('37015555') <> 0 then raise exception 'deleted job by plate'; end if;

  -- Fewer than 4 characters after normalisation: nothing.
  if pg_temp.total('Z37') <> 0 then raise exception '<4 chars'; end if;
  if pg_temp.total('37-0') <> 0 then raise exception '<4 digits after stripping'; end if;
  if pg_temp.total('') <> 0 or pg_temp.total(null) <> 0 or pg_temp.total('    ') <> 0 then raise exception 'empty'; end if;

  -- LIKE metacharacters are data, never wildcards.
  if pg_temp.total('%') <> 0 or pg_temp.total('%%%%') <> 0 or pg_temp.total('____') <> 0 or pg_temp.total('\\\\') <> 0 then
    raise exception 'metacharacters widened the match';
  end if;
  if pg_temp.total('%Z37KYW%') <> pg_temp.total('Z37KYW') or pg_temp.total('Z3_KYW') <> pg_temp.total('Z3KYW') then
    raise exception 'metacharacters changed the result';
  end if;

  -- SQL-looking strings are just characters ('DROPTABLEJOBS', 'OR11', ...):
  -- harmless, and no VIN holds an O.
  if pg_temp.total('''; drop table jobs;--') <> 0 then raise exception 'drop-table string'; end if;
  if pg_temp.total(''' or ''1''=''1') <> 0 then raise exception 'or-1=1 string'; end if;
  if pg_temp.total('"; select 1; --') <> 0 then raise exception 'select string'; end if;
  if pg_temp.hits('Z37KYWZZZ1JZ00001') <> 1 then raise exception 'jobs table damaged'; end if;

  -- Length caps: over 17 normalised, or over 64 raw, returns nothing.
  if pg_temp.total('Z37KYWZZZ1JZ000011') <> 0 then raise exception '>17 chars'; end if;
  if pg_temp.total(repeat(' ', 61) || 'Z37KYW') <> 0 then raise exception '>64 raw chars'; end if;
  if pg_temp.total(repeat('Z37KYW', 100000)) <> 0 then raise exception 'huge input'; end if;
end $$;

-- ---------------------------------------------------------------- not staff
-- A sub with no app user row: forbidden.
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
do $$
begin
  perform lookup_vehicle('Z37KYW');
  raise exception 'unknown user was not refused';
exception when raise_exception then
  if sqlerrm <> 'forbidden' then raise; end if;
end $$;

-- The read-only role (carasso), if one exists: forbidden.
reset role;
select set_config('request.jwt.claim.sub',
                  coalesce((select auth_id::text from users where role = 'carasso' and active limit 1), ''), true);
set local role authenticated;
do $$
begin
  if current_setting('request.jwt.claim.sub') = '' then
    raise notice 'scenarios_0037: no active carasso user, read-only role check skipped';
    return;
  end if;
  perform lookup_vehicle('Z37KYW');
  raise exception 'read-only role was not refused';
exception when raise_exception then
  if sqlerrm <> 'forbidden' then raise; end if;
end $$;

-- anon has no EXECUTE at all.
reset role;
set local role anon;
do $$
begin
  perform lookup_vehicle('Z37KYW');
  raise exception 'anon could execute lookup_vehicle';
exception when insufficient_privilege then
  null;
end $$;

reset role;
do $$ begin raise notice 'scenarios_0037: all scenarios passed'; end $$;

rollback;
