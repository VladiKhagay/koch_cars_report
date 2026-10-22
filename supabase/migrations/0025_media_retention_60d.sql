-- ===========================================================================
-- 0025 — photos and videos both expire after 60 days
--
-- Was 90 days for photos (0001) and 30 for video (0020). The R2 lifecycle
-- rule `expire-60d` (all prefixes) is what actually deletes the objects;
-- `expires_at` mirrors it so the database never claims media exists after the
-- bucket has dropped it.
--
-- Apply after 0024.
-- ===========================================================================

begin;

alter table photos
  alter column expires_at set default (now() + interval '60 days');

create or replace function photos_stamp_video_expiry()
returns trigger
language plpgsql
as $$
begin
  if new.kind = 'video' then
    new.expires_at := now() + interval '60 days';
  end if;
  return new;
end;
$$;

-- Existing rows: re-mirror the bucket. Only ever shortens (90d photos);
-- 30d videos keep their earlier expiry, which the bucket has already applied.
update photos
   set expires_at = created_at + interval '60 days'
 where expires_at > created_at + interval '60 days';

commit;
