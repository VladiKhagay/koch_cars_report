-- ===========================================================================
-- 0011 — the VIN is optional, and it is never used to infer the vehicle
--
-- Two related corrections to what 0001 assumed.
--
-- 1. `jobs.vin` was NOT NULL, which made the VIN a gate on logging a car at
--    all. A VIN plate under a windscreen is routinely unreadable — glare, a
--    sticker peeled off, a car whose plate sits somewhere this fleet does not
--    photograph. The worker's choice was then between blocking on it and
--    typing something in to get past the field, and the second one is what
--    actually happens. A missing VIN must be recorded as missing: NULL, never
--    a placeholder, so every reader can tell "not known" from "known to be X".
--
-- 2. The `brand` column was documented as "decoded from VIN WMI". That
--    decoding is removed from the client in this change — the WMI is a
--    manufacturer prefix, not a model, and a table of guesses presented as a
--    read of the car is wrong more often than the yard can afford. Brand is
--    now what somebody typed, and nothing else.
--
-- Existing rows are untouched: every job that has a VIN keeps it.
-- ===========================================================================

begin;

alter table jobs alter column vin drop not null;

comment on column jobs.vin is
  'User-provided VIN, or NULL when it was not readable. Never inferred, never defaulted.';

comment on column jobs.brand is
  'Vehicle brand as entered by a person. Never derived from the VIN.';

-- ---------------------------------------------------------------------------
-- Duplicate detection with no VIN to compare
--
-- `vin = upper(trim(null))` is already NULL rather than a match, so this
-- cannot have flagged a false duplicate. It is guarded explicitly anyway: the
-- function's contract becomes "no VIN, no duplicate claim" instead of leaving
-- it to three-valued logic that a future rewrite could quietly lose. An empty
-- string is treated the same way — the client sends NULL, but the RPC is
-- reachable directly.
--
-- Body is otherwise unchanged from 0003.
-- ---------------------------------------------------------------------------

create or replace function find_recent_duplicate(p_site_id uuid, p_vin text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result uuid;
  caller users;
begin
  if p_vin is null or trim(p_vin) = '' then
    return null;
  end if;

  select * into caller from current_app_user();
  if caller is null or (caller.role <> 'admin' and caller.site_id is distinct from p_site_id) then
    return null;
  end if;

  select id into result
  from jobs
  where site_id = p_site_id
    and vin = upper(trim(p_vin))
    and deleted_at is null
    and created_at >= now() - interval '7 days'
  order by created_at desc
  limit 1;
  return result;
end;
$$;

commit;
