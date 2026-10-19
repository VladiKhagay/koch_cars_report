-- ===========================================================================
-- 0022 — one photo row per (job, kind)
--
-- The R2 key is derived from job id + kind, so a second row for the same slot
-- always points at the same object. A retry that got past the uploads and then
-- failed on the photos insert wrote the rows twice (see submitJob). Make the
-- database refuse the duplicate; the client now upserts and ignores it.
--
-- Also here: 0014's photos_insert policy queried `photos` from inside a policy
-- ON photos. Postgres rejects that ("infinite recursion detected in policy"),
-- so on a database built from the migrations every photo insert fails. It now
-- calls can_write_job() (security definer, so it reads photos without the
-- policy), which is what 0009 / 0014 already say the two must agree on.
--
-- Apply this BEFORE deploying the web change that upserts on (job_id, kind).
-- ===========================================================================

begin;

-- Keep the oldest row of each duplicated slot.
delete from photos a
using photos b
where a.job_id = b.job_id
  and a.kind = b.kind
  and (a.created_at, a.id) > (b.created_at, b.id);

alter table photos add constraint photos_job_kind_unique unique (job_id, kind);

drop policy if exists photos_insert on photos;
create policy photos_insert on photos for insert
  with check (can_write_job(photos.job_id));

commit;
