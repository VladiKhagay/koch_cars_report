-- ===========================================================================
-- 0016 — the plate is optional too, same reasoning as 0011's VIN change
--
-- Some cars arrive with no physical plate at all (in transit, dealer
-- transfer, off-road stock). `jobs.plate` was NOT NULL, which made it
-- impossible to log those cars without typing a placeholder. Same fix as
-- 0011: NULL means "no plate", never a placeholder.
--
-- Unlike VIN, plate can't go optional on its own — a job needs *something*
-- to identify the car by, so at least one of plate/VIN is still required.
-- ===========================================================================

begin;

alter table jobs alter column plate drop not null;

alter table jobs add constraint jobs_plate_or_vin_chk
  check (plate is not null or vin is not null);

comment on column jobs.plate is
  'User-provided plate, or NULL when the car has no physical plate. Never inferred, never defaulted.';

commit;
