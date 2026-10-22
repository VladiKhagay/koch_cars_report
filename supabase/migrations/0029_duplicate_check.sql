-- ===========================================================================
-- 0029 — duplicate warning: VIN or plate, any site, any time (step 4 of 5)
--
-- Apply after 0028.
--
-- Was: same VIN, same site, last 7 days (find_recent_duplicate, 0003/0011/0019),
-- computed by the client. Now: the same VIN OR the same plate, anywhere, ever,
-- and the FLAG is set by the database on insert, so a job queued offline gets
-- it exactly like an online one. A NULL/blank VIN or plate never matches
-- (both are optional, 0011/0016; plates are bare digits, 0008). Deleted jobs
-- never match. Warn only — nothing here blocks an insert.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The flag. Always computed here; whatever the client sent is overwritten.
-- ---------------------------------------------------------------------------

create or replace function jobs_flag_duplicate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  q_vin   text := nullif(upper(trim(coalesce(new.vin, ''))), '');
  q_plate text := nullif(regexp_replace(coalesce(new.plate, ''), '[^0-9]', '', 'g'), '');
begin
  new.duplicate_of_job_id := null;

  if q_vin is not null or q_plate is not null then
    select j.id into new.duplicate_of_job_id
    from jobs j
    where j.deleted_at is null
      and j.id <> new.id
      and ((q_vin is not null and j.vin = q_vin)
           or (q_plate is not null and j.plate = q_plate))
    order by j.created_at desc
    limit 1;
  end if;

  return new;
end;
$$;

create trigger jobs_flag_duplicate
  before insert on jobs
  for each row execute function jobs_flag_duplicate();

-- ---------------------------------------------------------------------------
-- 2. The warning shown while typing and on Submit. Returns only what the
--    warning says — when, where, which service — never money or people.
--    Workers cannot SELECT other people's jobs (0003), hence security definer.
--    Not for Carasso.
-- ---------------------------------------------------------------------------

create or replace function find_previous_job(p_plate text, p_vin text)
returns table (
  created_at timestamptz,
  site_name  text,
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
  q_vin   text := nullif(upper(trim(coalesce(p_vin, ''))), '');
  q_plate text := nullif(regexp_replace(coalesce(p_plate, ''), '[^0-9]', '', 'g'), '');
begin
  if not exists (select 1 from current_app_user() u where u.role in ('worker', 'manager', 'admin')) then
    raise exception 'forbidden';
  end if;

  if q_vin is null and q_plate is null then
    return;
  end if;

  return query
  select j.created_at, s.name, sv.name_en, sv.name_ru, sv.name_he
  from jobs j
  join sites s on s.id = j.site_id
  left join services sv on sv.id = j.service_id
  where j.deleted_at is null
    and ((q_vin is not null and j.vin = q_vin)
         or (q_plate is not null and j.plate = q_plate))
  order by j.created_at desc
  limit 1;
end;
$$;

revoke all on function find_previous_job(text, text) from public, anon;
grant execute on function find_previous_job(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The flagged job's summary, for managers and admins. The flag can now
--    point at a job on another site, which jobs RLS hides from a manager, so
--    the compare panel reads this instead: same three fields, and only for a
--    job the caller can view.
-- ---------------------------------------------------------------------------

create or replace function duplicate_job_summary(p_job_id uuid)
returns table (
  created_at timestamptz,
  site_name  text,
  service_name_en text,
  service_name_ru text,
  service_name_he text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from current_app_user() u where u.role in ('manager', 'admin')) then
    raise exception 'forbidden';
  end if;
  if not can_view_job(p_job_id) then
    return;
  end if;

  return query
  select d.created_at, s.name, sv.name_en, sv.name_ru, sv.name_he
  from jobs j
  join jobs d on d.id = j.duplicate_of_job_id
  join sites s on s.id = d.site_id
  left join services sv on sv.id = d.service_id
  where j.id = p_job_id;
end;
$$;

revoke all on function duplicate_job_summary(uuid) from public, anon;
grant execute on function duplicate_job_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The old VIN/site/7-day check is replaced; nothing calls it any more.
-- ---------------------------------------------------------------------------

drop function if exists find_recent_duplicate(uuid, text);

commit;
