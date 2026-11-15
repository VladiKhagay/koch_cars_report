-- ===========================================================================
-- 0037 — partial plate / VIN in the vehicle lookup
--
-- 0018 kept lookup_vehicle exact-match only, so nobody could page through every
-- job one prefix at a time. Workers at the car often have only part of the
-- number (a dirty plate, the VIN's last digits), so the product decision is
-- now "contains, at least 4 characters". The enumeration trade-off is accepted
-- and bounded by:
--
--   * staff only (worker, manager, admin), same guard as 0033; the read-only
--     role and anon still cannot call it;
--   * at least 4 characters after normalisation, at most 17 (a VIN's length);
--   * at most 100 rows per call, newest first (as 0018/0033). 100 is the same
--     cap as before: a 4-character fragment can legitimately hit tens of
--     cars, and a lower cap does not slow an enumerator (more fragments do
--     the same), it only hides real matches from the worker;
--   * the same columns as before: date, site, plate, VIN, brand, service
--     names. Never the worker, notes, billing code or price.
--
-- Input handling (defense in depth; plpgsql with parameters only, no dynamic
-- SQL, so the query text never contains user input):
--
--   * raw input longer than 64 characters returns no rows (before any regex);
--   * upper-cased, everything but [A-Z0-9] removed (spaces, hyphens, quotes,
--     % and _ are gone), then 4..17 characters or no rows;
--   * digits only -> plate contains OR VIN contains; any letter -> VIN only
--     (plates are digits only, 0008);
--   * the LIKE pattern is built from that value (data, not SQL) with \, % and
--     _ escaped, so even a future change to the allowlist cannot widen a
--     match into a wildcard.
--
-- Speed: trigram GIN indexes on jobs.vin and jobs.plate, partial on
-- `deleted_at is null` (the lookup never returns deleted jobs), so a contains
-- search is an index scan, not a table scan. The VIN uses ILIKE: trigrams are
-- case-folded anyway, so it costs nothing and still matches a VIN that was
-- stored in lower case some other way than the web form.
--
-- Precondition: pg_trgm is either absent or installed in schema `extensions`
-- (Supabase's convention). If it already lives in `public`, the
-- `create extension if not exists` is a no-op and `extensions.gin_trgm_ops`
-- does not resolve; the migration then fails and changes nothing. Check with:
--   select extnamespace::regnamespace from pg_extension where extname = 'pg_trgm';
--
-- Deploy order: 0037 -> web. Rollback: web -> down below. The down keeps
-- pg_trgm installed (harmless, and other objects may come to depend on it).
--
-- Down-migration (restores the 0033 body):
--   begin;
--   drop index if exists jobs_vin_trgm_idx;
--   drop index if exists jobs_plate_trgm_idx;
--   create or replace function lookup_vehicle(p_query text)
--   returns table (created_at timestamptz, site_name text, plate text, vin text,
--                  brand text, service_name_en text, service_name_ru text,
--                  service_name_he text)
--   language plpgsql stable security definer set search_path = public
--   as $$
--   declare
--     q_vin   text := upper(trim(coalesce(p_query, '')));
--     q_plate text := case when q_vin ~ '[A-Z]' then ''
--                          else regexp_replace(q_vin, '[^0-9]', '', 'g') end;
--   begin
--     if not exists (select 1 from current_app_user() u where u.role in ('worker', 'manager', 'admin')) then
--       raise exception 'forbidden';
--     end if;
--     return query
--     select j.created_at, s.name, j.plate, j.vin, j.brand, x.name_en, x.name_ru, x.name_he
--     from jobs j
--     join sites s on s.id = j.site_id
--     left join lateral (
--       select string_agg(sv.name_en, ', ' order by sv.sort_order, sv.id) as name_en,
--              string_agg(coalesce(sv.name_ru, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_ru,
--              string_agg(coalesce(sv.name_he, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_he
--       from job_services js join services sv on sv.id = js.service_id
--       where js.job_id = j.id
--     ) x on true
--     where j.deleted_at is null
--       and ((q_plate <> '' and j.plate = q_plate) or (q_vin <> '' and j.vin = q_vin))
--     order by j.created_at desc
--     limit 100;
--   end;
--   $$;
--   revoke all on function lookup_vehicle(text) from public, anon;
--   grant execute on function lookup_vehicle(text) to authenticated;
--   commit;
-- ===========================================================================

begin;

create extension if not exists pg_trgm with schema extensions;

create index if not exists jobs_vin_trgm_idx
  on jobs using gin (vin extensions.gin_trgm_ops) where deleted_at is null;
create index if not exists jobs_plate_trgm_idx
  on jobs using gin (plate extensions.gin_trgm_ops) where deleted_at is null;

create or replace function lookup_vehicle(p_query text)
returns table (
  created_at timestamptz,
  site_name  text,
  plate      text,
  vin        text,
  brand      text,
  service_name_en text,
  service_name_ru text,
  service_name_he text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  q   text;
  pat text;
begin
  if not exists (select 1 from current_app_user() u where u.role in ('worker', 'manager', 'admin')) then
    raise exception 'forbidden';
  end if;

  -- Cap before the regex runs, so a pasted megabyte costs nothing.
  if length(coalesce(p_query, '')) > 64 then
    return;
  end if;

  q := regexp_replace(upper(coalesce(p_query, '')), '[^A-Z0-9]', '', 'g');
  if length(q) < 4 or length(q) > 17 then
    return;
  end if;

  -- q is [A-Z0-9] only, so this escape changes nothing today; it is kept so a
  -- wider allowlist later can never turn \, % or _ into a wildcard. The
  -- pattern is a value bound into the query, never SQL text.
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- Two branches rather than one WHERE with a constant-guarded OR: each gets
  -- its own plan, and both can use the trigram indexes (deleted_at is null is
  -- written out so the partial indexes apply).
  if q ~ '^[0-9]+$' then
    return query
    select j.created_at, s.name, j.plate, j.vin, j.brand,
           x.name_en, x.name_ru, x.name_he
    from jobs j
    join sites s on s.id = j.site_id
    left join lateral (
      select string_agg(sv.name_en, ', ' order by sv.sort_order, sv.id) as name_en,
             string_agg(coalesce(sv.name_ru, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_ru,
             string_agg(coalesce(sv.name_he, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_he
      from job_services js join services sv on sv.id = js.service_id
      where js.job_id = j.id
    ) x on true
    where j.deleted_at is null
      and (j.plate like pat escape '\' or j.vin ilike pat escape '\')
    order by j.created_at desc
    limit 100;
  else
    return query
    select j.created_at, s.name, j.plate, j.vin, j.brand,
           x.name_en, x.name_ru, x.name_he
    from jobs j
    join sites s on s.id = j.site_id
    left join lateral (
      select string_agg(sv.name_en, ', ' order by sv.sort_order, sv.id) as name_en,
             string_agg(coalesce(sv.name_ru, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_ru,
             string_agg(coalesce(sv.name_he, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_he
      from job_services js join services sv on sv.id = js.service_id
      where js.job_id = j.id
    ) x on true
    where j.deleted_at is null
      and j.vin ilike pat escape '\'
    order by j.created_at desc
    limit 100;
  end if;
end;
$$;

revoke all on function lookup_vehicle(text) from public, anon;
grant execute on function lookup_vehicle(text) to authenticated;

commit;
