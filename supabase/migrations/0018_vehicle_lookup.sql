-- ===========================================================================
-- 0018 — vehicle lookup for workers
--
-- Workers can only SELECT their own jobs (0003), but need to answer "has this
-- car been done before, and with what?" for any car. Same approach as
-- find_recent_duplicate: a security definer function that returns only the
-- columns that question needs — never worker, notes, billing code or price.
--
-- Exact match only (bare-digit plate or upper-cased VIN). A partial match
-- would let anyone page through every job in the system one prefix at a time.
-- Searches all sites: a car prepped at another site is still "registered".
-- ===========================================================================

begin;

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
set search_path = public
as $$
declare
  q_vin   text := upper(trim(coalesce(p_query, '')));
  -- Plates are digits only (0008). A query with letters is a VIN; stripping it
  -- to digits would match whatever plate happened to equal them.
  q_plate text := case when q_vin ~ '[A-Z]' then ''
                       else regexp_replace(q_vin, '[^0-9]', '', 'g') end;
begin
  if (select u.id from current_app_user() u) is null then
    raise exception 'forbidden';
  end if;

  return query
  select j.created_at, s.name, j.plate, j.vin, j.brand,
         sv.name_en, sv.name_ru, sv.name_he
  from jobs j
  join sites s on s.id = j.site_id
  left join services sv on sv.id = j.service_id
  where j.deleted_at is null
    and ((q_plate <> '' and j.plate = q_plate) or (q_vin <> '' and j.vin = q_vin))
  order by j.created_at desc
  limit 100;
end;
$$;

revoke all on function lookup_vehicle(text) from public, anon;
grant execute on function lookup_vehicle(text) to authenticated;

commit;
