-- ===========================================================================
-- 0020 — a condition video per job
--
-- Workers record up to a minute of walkaround video when they finish a car, so
-- there is a record of its condition at handover. The clip is one more slot in
-- `photos` rather than a table of its own: it has exactly the same shape (job,
-- kind, R2 key, expiry), the same write rule (`photos_insert` /
-- `can_write_job`) and the same read rule, so a new table would only be a
-- second copy of all three.
--
-- Retention is 30 days, not the photos' 90. A walkaround films people and the
-- yard as well as the car, and video is ~20x the bytes of a photo, so it is
-- kept only as long as a handover dispute realistically takes to surface. The
-- R2 lifecycle rule on the `video/` prefix is what actually deletes the
-- object; `expires_at` here mirrors it so the database never claims a video
-- still exists after the bucket has dropped it. Stamped by a trigger rather
-- than sent by the client, for the same reason worker_price is (0005): the
-- client could otherwise write any expiry it liked.
--
-- Apply BEFORE deploying the Worker that accepts kind=video — the other order
-- leaves every video stuck in the offline queue on a constraint rejection.
--
-- Apply after 0019.
-- ===========================================================================

begin;

alter table photos drop constraint if exists photos_kind_check;

alter table photos add constraint photos_kind_check
  check (kind in ('plate', 'vin', 'extra_1', 'extra_2', 'extra_3', 'video'));

create or replace function photos_stamp_video_expiry()
returns trigger
language plpgsql
as $$
begin
  if new.kind = 'video' then
    new.expires_at := now() + interval '30 days';
  end if;
  return new;
end;
$$;

drop trigger if exists photos_stamp_video_expiry on photos;
create trigger photos_stamp_video_expiry
  before insert or update of kind, expires_at on photos
  for each row execute function photos_stamp_video_expiry();

commit;
