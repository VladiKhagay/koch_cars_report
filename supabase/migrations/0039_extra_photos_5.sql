-- ===========================================================================
-- 0039 — five extra photos per job (extra_1..extra_5)
--
-- Widens photos_kind_check from extra_1..3 to extra_1..5. plate, vin and video
-- are unchanged. No other object names a kind: RLS and can_write_photo (0035)
-- only special-case 'plate', 'vin' and 'video', so extra_4/5 inherit the same
-- rules as extra_1..3.
--
-- Apply after 0038 and BEFORE deploying the web / Worker that send extra_4 or
-- extra_5 — the other order leaves those photos stuck in the offline queue on a
-- constraint rejection.
--
-- Rollback: re-adding the 0020 constraint (extra_1..3) FAILS while any extra_4 /
-- extra_5 row exists. Soft-removing is NOT enough: a removed row keeps its kind
-- and still fails the CHECK. Roll back web and Worker first, then DELETE every
-- extra_4 / extra_5 row (soft-removed ones included) and their R2 objects, then
-- re-add the 0020 constraint.
-- Caveat: deleting a row whose R2 object is not deleted makes that object
-- viewable again via /photo until the 60-day lifecycle removes it
-- (can_view_photo only hides slots that have a removed row). Prefer keeping the
-- wide constraint until those photos expire.
-- ===========================================================================

begin;

alter table photos drop constraint if exists photos_kind_check;

alter table photos add constraint photos_kind_check
  check (kind in ('plate', 'vin', 'extra_1', 'extra_2', 'extra_3', 'extra_4', 'extra_5', 'video'));

commit;
