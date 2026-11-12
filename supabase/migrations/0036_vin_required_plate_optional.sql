-- ===========================================================================
-- 0036 — the VIN is required, the plate is optional
--
-- 0011 made the VIN optional and 0016 made the plate optional too, with
-- jobs_plate_or_vin_chk requiring at least one of them. The product rule
-- is now "VIN always, plate when the car has one" (PRODUCT.md).
--
-- What changes:
--
--   * jobs.vin            NOT NULL. The New Job form refuses an empty or
--                         malformed VIN (17 chars, no I/O/Q); a failed check
--                         digit stays a warning (vin_valid_checksum false).
--                         No placeholder VIN, ever: a missing VIN blocks the
--                         form instead of being typed around.
--   * jobs.plate          nullable (already so since 0016; restated so this
--                         migration states the whole rule). NULL = no plate,
--                         never '' or a placeholder. A typed plate must still
--                         be 8 digits (web).
--   * jobs_plate_or_vin_chk   dropped: NOT NULL on vin implies it.
--
-- No blank-VIN check constraint: the web sends a trimmed VIN (lib/jobs.ts,
-- lib/vin.ts) and refuses an empty one before create_job. A '' written some
-- other way is not refused by the database.
--
-- Precondition: no job, soft-deleted ones included, has a NULL or blank
-- (empty / whitespace-only) vin. If any does, this migration raises with the
-- count and changes nothing; fill those VINs in (or decide what to do with the
-- rows) first. Find them with:
--   select id, created_at, plate, deleted_at from jobs
--   where vin is null or btrim(vin) = '';
--
-- Idempotent: safe to run again once applied.
--
-- Deploy order: 0036 -> web. The old web can still try to create a VIN-less
-- job; the database refuses it with 23502 (not_null_violation).
-- Rollback: web only. Down (below) is commented; run it only if the
-- plate-or-VIN rule really has to come back.
--
-- Down (run in one transaction):
--
--   begin;
--   alter table jobs alter column vin drop not null;
--   alter table jobs drop constraint if exists jobs_plate_or_vin_chk;
--   alter table jobs add constraint jobs_plate_or_vin_chk
--     check (plate is not null or vin is not null);
--   comment on column jobs.vin is
--     'User-provided VIN, or NULL when it was not readable. Never inferred, never defaulted.';
--   comment on column jobs.plate is
--     'User-provided plate, or NULL when the car has no physical plate. Never inferred, never defaulted.';
--   commit;
-- ===========================================================================

begin;

do $$
declare
  missing bigint;
begin
  select count(*) into missing from jobs where vin is null or btrim(vin) = '';
  if missing > 0 then
    raise exception '0036: % job(s) have a NULL or blank VIN (soft-deleted included); fill them in before making jobs.vin NOT NULL', missing;
  end if;
end;
$$;

alter table jobs drop constraint if exists jobs_plate_or_vin_chk;
alter table jobs alter column vin set not null;
alter table jobs alter column plate drop not null;

comment on column jobs.vin is
  'User-provided VIN, required (17 chars, no I/O/Q). Never inferred, never defaulted, never a placeholder.';
comment on column jobs.plate is
  'User-provided plate, or NULL when the car has no physical plate. Never inferred, never defaulted.';

commit;
