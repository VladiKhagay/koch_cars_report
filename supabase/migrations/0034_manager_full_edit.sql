-- ===========================================================================
-- 0034 — managers and admins edit every field and every media slot, audited
--
-- Managers (their own site) and admins can now correct plate, VIN, brand,
-- worker note and the job date, and add, replace or remove each media slot at
-- any age. Workers are unchanged: the 15-minute window, the column guard
-- (0021/0028/0033) and can_write_photo (0031) all stay as they are.
--
-- What changes:
--
--   * photos.removed_at   a tombstone. "Remove" clears the slot without
--                         deleting the row or the R2 object: the object is left
--                         to the 60-day lifecycle (0025), and the row keeps the
--                         slot's unique (job_id, kind) so a re-add is an update.
--   * photos_update       admin, or a manager at the job's site. No worker
--                         branch and still no DELETE policy at all.
--   * photos_guard_update a row's identity (id, job, kind, R2 key, created_at)
--                         never moves; a live row's expiry restarts with the
--                         new object (an overwrite restarts the R2 lifecycle).
--   * can_view_photo()    what the Worker's GET /photo asks now: can_view_job
--                         AND the slot is not tombstoned. Otherwise a removed
--                         photo would keep streaming from R2 for 60 days.
--   * jobs_flag_duplicate re-runs when plate, VIN or the date changes.
--   * jobs_guard_date     a manager/admin may not move the job date into the
--                         future (it would hold the worker's 7-day video
--                         window, 0031, open).
--   * audit triggers      the database writes audit_log itself, from the real
--                         OLD/NEW rows, for every manager/admin change. The
--                         client insert (audit_log_insert, 0001) is dropped:
--                         a best-effort client write was silently lost on any
--                         failure, could be skipped or forged, and could not
--                         be written at all after a manager moved a job off
--                         their site.
--
-- Contract for the web (the statements these triggers expect):
--
--   add      INSERT into photos (or an upsert on a tombstoned slot)
--   replace  upsert on (job_id, kind) WITHOUT ignoreDuplicates — i.e. an
--            UPDATE of a live row (removed_at stays null)
--   remove   UPDATE photos SET removed_at = now()  (stamped by the server)
--   re-add   UPDATE of a tombstoned row with removed_at = null
--   readers  filter `removed_at is null`; a tombstoned row is not a photo
--
--   audit_log.changes is always {field: {from, to}}, every value an object:
--     jobs                      the changed columns among plate, vin,
--                               vin_valid_checksum, brand, worker_note,
--                               created_at, worker_id, coworker_ids, site_id,
--                               deleted_at. action soft_delete / restore when
--                               deleted_at flips, else update. Updates that
--                               change none of these (updated_at, the pay sum)
--                               write nothing.
--     job_billing               billing_code, manager_note           (update)
--     job_services              add:    {service_id: {null -> id}, worker_price: {null -> p}}
--                               remove: {service_id: {id -> null}, worker_price: {p -> null}}
--                               pay:    {service_id: {id -> id},   worker_price: {a -> b}}
--                                                                    (update)
--     job_service_client_prices {service_id: {id -> id}, unit_price, total_price}
--                                                       (client_price_update)
--   audit_log_select (0001) is redefined: admins read every row; a manager
--   at the job's site reads every row except client prices — never action
--   client_price_update, and never a legacy (client-written) row whose
--   changes mention a unit_price / total_price key (e.g. inside service_lines).
--     photos                    {kind: {null -> k}}  media_add
--                               {kind: {k -> k}}     media_replace
--                               {kind: {k -> null}}  media_remove
--   Only manager/admin callers are audited (`caller.id is not null`, never
--   `caller is null` — see job_services_guard, 0033). Worker edits and the
--   trusted context (SQL editor, service role) write no rows.
--   The web must stop calling recordAudit: the insert is refused from here on.
--
-- Deploy order: 0034 -> Worker (asks can_view_photo) -> web. Until the new
-- web is live the old one keeps working: its recordAudit inserts fail
-- silently (best-effort by design), while the triggers already log. A Worker
-- deployed before 0034 403s every photo view (function missing).
-- Rollback in reverse: web -> Worker -> migration. Never drop can_view_photo
-- while the new Worker is live. Rolling back the migration loses nothing but
-- the tombstones: restore audit_log_insert before an old web is redeployed.
--
-- Apply after 0033. One transaction.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The tombstone
-- ---------------------------------------------------------------------------

alter table photos add column removed_at timestamptz;

comment on column photos.removed_at is
  'Set when a manager/admin removes the slot (0034). The R2 object is left to the 60-day lifecycle; readers must treat the row as absent.';

-- ---------------------------------------------------------------------------
-- 2. Who may change a photo row: admin, or a manager at the job's site.
--    Same rule as can_write_photo's manager/admin branches (0031), which the
--    Worker's /upload asks before the R2 put, so the object and the row agree.
--    Workers keep insert-only (photos_insert, ignoreDuplicates in submitJob).
--    No DELETE policy: removal is the tombstone.
-- ---------------------------------------------------------------------------

drop policy if exists photos_update on photos;
create policy photos_update on photos for update
  using (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = photos.job_id
      and (u.role = 'admin' or (u.role = 'manager' and u.site_id = j.site_id))
  ))
  with check (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = photos.job_id
      and (u.role = 'admin' or (u.role = 'manager' and u.site_id = j.site_id))
  ));

-- ---------------------------------------------------------------------------
-- 3. A photo row's identity never moves; expiry mirrors the bucket
--
-- Reverted silently (0005/0006/0021 style), so an upsert re-sending the row
-- does not fail. The id is pinned too: no FK points at it today, but a row
-- that keeps its slot must keep its identity. The R2 key is derived from
-- job + kind, so letting either move
-- would point the row at another slot's object.
-- removed_at is the server's clock: set now() when a slot is removed, kept as
-- is while it stays removed.
-- A live row's expires_at restarts: a replace (or re-add) overwrote the R2
-- object, whose lifecycle restarts with it. A removed row keeps its expiry.
--
-- Runs before photos_stamp_video_expiry (0020/0025; triggers fire in name
-- order), which still applies when kind/expires_at are in the SET list and
-- stamps a video now() + 60 days — the same value this sets on a live row.
-- ---------------------------------------------------------------------------

create or replace function photos_guard_update()
returns trigger
language plpgsql
as $$
begin
  new.id := old.id;
  new.job_id := old.job_id;
  new.kind := old.kind;
  new.r2_key := old.r2_key;
  new.created_at := old.created_at;

  if new.removed_at is not null then
    new.removed_at := coalesce(old.removed_at, now());
    new.expires_at := old.expires_at;
  else
    new.expires_at := now() + interval '60 days';
  end if;

  return new;
end;
$$;

drop trigger if exists photos_guard_update on photos;
create trigger photos_guard_update
  before update on photos
  for each row execute function photos_guard_update();

-- ---------------------------------------------------------------------------
-- 4. "May this caller see this slot?" — the Worker's GET /photo
--
-- Not "a live row exists": objects written before their row (the deferred
-- video, an upload whose row insert is still retrying) must keep streaming.
-- Only an explicit removal hides the object.
-- ---------------------------------------------------------------------------

create or replace function can_view_photo(p_job_id uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select can_view_job(p_job_id)
     and not exists (
       select 1 from photos p
       where p.job_id = p_job_id and p.kind = p_kind and p.removed_at is not null
     );
$$;

revoke all on function can_view_photo(uuid, text) from public, anon;
grant execute on function can_view_photo(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Duplicate flag: also on a plate / VIN / date correction
--
-- Body as 0029 for INSERT. On UPDATE:
--   * JobDetail sends plate/vin/created_at only when they changed, but any
--     client may re-send them unchanged (the trigger fires on the column
--     being in the SET list); nothing changed -> the flag is kept.
--   * only EARLIER jobs match: the flag means "this car was done before", and
--     a corrected old job must not point at a later visit.
-- Fires before jobs_guard_worker_columns (name order), which reverts
-- duplicate_of_job_id on a worker's update — so a worker's own plate edit in
-- the 15-minute window still never recomputes the flag (unchanged from 0028).
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
  if tg_op = 'UPDATE'
     and new.plate is not distinct from old.plate
     and new.vin is not distinct from old.vin
     and new.created_at is not distinct from old.created_at then
    return new;
  end if;

  new.duplicate_of_job_id := null;

  if q_vin is not null or q_plate is not null then
    select j.id into new.duplicate_of_job_id
    from jobs j
    where j.deleted_at is null
      and j.id <> new.id
      and (tg_op = 'INSERT' or j.created_at < new.created_at)
      and ((q_vin is not null and j.vin = q_vin)
           or (q_plate is not null and j.plate = q_plate))
    order by j.created_at desc
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists jobs_flag_duplicate on jobs;
create trigger jobs_flag_duplicate
  before insert or update of plate, vin, created_at on jobs
  for each row execute function jobs_flag_duplicate();

-- ---------------------------------------------------------------------------
-- 6. Audit, written by the database
--
-- audit_diff: {col: {from, to}} for each listed column whose value differs;
-- '{}' when none. A missing row (INSERT's OLD, DELETE's NEW) reads as null.
-- Not an RPC: only the triggers below (running as the owner) call it.
-- ---------------------------------------------------------------------------

create or replace function audit_diff(o jsonb, n jsonb, cols text[])
returns jsonb
language sql
immutable
as $$
  select coalesce(
    jsonb_object_agg(c, jsonb_build_object('from', coalesce(o -> c, 'null'::jsonb),
                                           'to',   coalesce(n -> c, 'null'::jsonb))),
    '{}'::jsonb)
  from unnest(cols) as c
  where coalesce(o -> c, 'null'::jsonb) is distinct from coalesce(n -> c, 'null'::jsonb);
$$;

revoke all on function audit_diff(jsonb, jsonb, text[]) from public, anon, authenticated;

-- The client insert goes: rows come only from the triggers below.
drop policy if exists audit_log_insert on audit_log;

-- Read: admins everything; a manager at the job's site everything but client
-- prices (admin-only since 0012/0033). client_price_update rows are the
-- trigger's; the text match catches legacy client-written rows that carried
-- unit_price / total_price (JobDetail's service_lines). coalesce: a null
-- `changes` (legacy delete/restore) must stay visible, and `null !~ x` is null.
-- ponytail: changes::text per row; fine for one job's history (indexed by
-- job_id). A generated "has_client_price" column if the log is ever scanned.
drop policy if exists audit_log_select on audit_log;
create policy audit_log_select on audit_log for select
  using (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = audit_log.job_id
      and (u.role = 'admin'
           or (u.role = 'manager' and u.site_id = j.site_id
               and audit_log.action <> 'client_price_update'
               and coalesce(audit_log.changes::text, '') !~ '"(unit|total)_price"'))
  ));

-- jobs. Updates only: creation is the job row itself.
create or replace function jobs_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
  diff   jsonb;
begin
  select * into caller from current_app_user();
  if caller.id is null or caller.role not in ('manager', 'admin') then
    return null;
  end if;

  diff := audit_diff(to_jsonb(old), to_jsonb(new), array[
    'plate', 'vin', 'vin_valid_checksum', 'brand', 'worker_note', 'created_at',
    'worker_id', 'coworker_ids', 'site_id', 'deleted_at']);
  if diff = '{}'::jsonb then
    return null;
  end if;

  insert into audit_log (job_id, user_id, action, changes)
  values (new.id, caller.id,
          case when old.deleted_at is null and new.deleted_at is not null then 'soft_delete'
               when old.deleted_at is not null and new.deleted_at is null then 'restore'
               else 'update' end,
          diff);
  return null;
end;
$$;

drop trigger if exists jobs_audit on jobs;
create trigger jobs_audit
  after update on jobs
  for each row execute function jobs_audit();

-- job_billing: insert (first billing code) or update. A delete only happens
-- by cascade from a hard-deleted job, which has nowhere to log to.
create or replace function job_billing_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
  diff   jsonb;
begin
  select * into caller from current_app_user();
  if caller.id is null or caller.role not in ('manager', 'admin') then
    return null;
  end if;

  diff := audit_diff(to_jsonb(old), to_jsonb(new), array['billing_code', 'manager_note']);
  if diff = '{}'::jsonb then
    return null;
  end if;

  insert into audit_log (job_id, user_id, action, changes)
  values (new.job_id, caller.id, 'update', diff);
  return null;
end;
$$;

drop trigger if exists job_billing_audit on job_billing;
create trigger job_billing_audit
  after insert or update on job_billing
  for each row execute function job_billing_audit();

-- job_services: a line added, removed, or re-priced (admin).
create or replace function job_services_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller  users;
  jid     uuid := coalesce(new.job_id, old.job_id);
  created timestamptz;
  diff    jsonb;
begin
  select * into caller from current_app_user();
  if caller.id is null or caller.role not in ('manager', 'admin') then
    return null;
  end if;

  -- A hard-deleted job cascades through here: nothing to log against.
  select j.created_at into created from jobs j where j.id = jid;
  if not found then
    return null;
  end if;

  -- ponytail: "created in this transaction" is jobs.created_at = now() (both
  -- are the transaction start; create_job inserts the job and its lines in
  -- one call). A manager's created_at edit can only land in a later
  -- transaction, so it never matches. Upgrade path if a flow ever creates a
  -- job and edits its services in one transaction: an explicit marker
  -- (set_config) from create_job.
  if tg_op in ('INSERT', 'DELETE') and created = now() then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    diff := audit_diff(to_jsonb(old), to_jsonb(new), array['worker_price']);
    if diff = '{}'::jsonb then
      return null;
    end if;
    diff := diff || jsonb_build_object('service_id',
                      jsonb_build_object('from', old.service_id, 'to', new.service_id));
  else
    diff := audit_diff(to_jsonb(old), to_jsonb(new), array['service_id', 'worker_price']);
  end if;

  insert into audit_log (job_id, user_id, action, changes)
  values (jid, caller.id, 'update', diff);
  return null;
end;
$$;

drop trigger if exists job_services_audit on job_services;
create trigger job_services_audit
  after insert or delete or update of worker_price on job_services
  for each row execute function job_services_audit();

-- job_service_client_prices: an admin's line price edit. The snapshot row
-- written with a new line (job_services_snapshot_client_prices, same
-- transaction, so the line's created_at = now()) is part of that line's
-- audit row and not logged again. Deletes only cascade from a removed line.
create or replace function job_service_client_prices_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
  diff   jsonb;
begin
  select * into caller from current_app_user();
  if caller.id is null or caller.role not in ('manager', 'admin') then
    return null;
  end if;

  if tg_op = 'INSERT' and not exists (
    select 1 from job_services js
    where js.job_id = new.job_id and js.service_id = new.service_id
      and js.created_at <> now()
  ) then
    return null;
  end if;

  diff := audit_diff(to_jsonb(old), to_jsonb(new), array['unit_price', 'total_price']);
  if diff = '{}'::jsonb then
    return null;
  end if;

  -- Its own action, so audit_log_select can hide it from managers (client
  -- prices are admin-only).
  insert into audit_log (job_id, user_id, action, changes)
  values (new.job_id, caller.id, 'client_price_update',
          jsonb_build_object('service_id', jsonb_build_object(
            'from', case when tg_op = 'UPDATE' then old.service_id end,
            'to', new.service_id)) || diff);
  return null;
end;
$$;

drop trigger if exists job_service_client_prices_audit on job_service_client_prices;
create trigger job_service_client_prices_audit
  after insert or update on job_service_client_prices
  for each row execute function job_service_client_prices_audit();

-- photos: add / replace / remove (contract in the header). Rows never move
-- between slots (photos_guard_update), so old.kind = new.kind on update.
create or replace function photos_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
  act    text;
  diff   jsonb;
begin
  select * into caller from current_app_user();
  if caller.id is null or caller.role not in ('manager', 'admin') then
    return null;
  end if;

  if tg_op = 'INSERT' then
    act := 'media_add';
    diff := jsonb_build_object('kind', jsonb_build_object('from', null, 'to', new.kind));
  elsif old.removed_at is null and new.removed_at is not null then
    act := 'media_remove';
    diff := jsonb_build_object('kind', jsonb_build_object('from', old.kind, 'to', null));
  elsif old.removed_at is not null and new.removed_at is null then
    act := 'media_add';
    diff := jsonb_build_object('kind', jsonb_build_object('from', null, 'to', new.kind));
  elsif new.removed_at is null then
    act := 'media_replace';
    diff := jsonb_build_object('kind', jsonb_build_object('from', old.kind, 'to', new.kind));
  else
    return null;  -- still removed
  end if;

  insert into audit_log (job_id, user_id, action, changes)
  values (new.job_id, caller.id, act, diff);
  return null;
end;
$$;

drop trigger if exists photos_audit on photos;
create trigger photos_audit
  after insert or update on photos
  for each row execute function photos_audit();

-- ---------------------------------------------------------------------------
-- 6b. The job date cannot move into the future (manager/admin)
--
-- can_write_photo's bounded video branch (0031) gives a worker 7 days from
-- jobs.created_at. Workers cannot set created_at (0021 guard reverts it), but
-- a manager/admin now can: a future date would hold that window open. Five
-- minutes of slack for a phone clock ahead of the server. Only a changed date
-- is checked; the trusted context (no app user) is not limited.
-- ---------------------------------------------------------------------------

create or replace function jobs_guard_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_at is distinct from old.created_at
     and new.created_at > now() + interval '5 minutes'
     and (select u.role from current_app_user() u) in ('manager', 'admin') then
    raise exception 'job date cannot be in the future' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_guard_date on jobs;
create trigger jobs_guard_date
  before update of created_at on jobs
  for each row execute function jobs_guard_date();

revoke all on function jobs_guard_date() from public, anon;
revoke all on function photos_guard_update() from public, anon;
revoke all on function jobs_flag_duplicate() from public, anon;
revoke all on function jobs_audit() from public, anon;
revoke all on function job_billing_audit() from public, anon;
revoke all on function job_services_audit() from public, anon;
revoke all on function job_service_client_prices_audit() from public, anon;
revoke all on function photos_audit() from public, anon;

-- ---------------------------------------------------------------------------
-- 7. job_health_check (0015): a removed slot is not a photo. Same columns.
-- ---------------------------------------------------------------------------

create or replace view job_health_check as
  select
    j.id,
    j.site_id,
    j.worker_id,
    j.plate,
    j.created_at,
    j.locked_at,
    j.deleted_at,
    coalesce(p.photo_count, 0) as photo_count,
    (coalesce(p.photo_count, 0) = 0)                          as no_photos,
    (j.locked_at <= now() and coalesce(p.photo_count, 0) = 0) as lock_expired
  from jobs j
    left join lateral (
      select count(*) as photo_count from photos ph
      where ph.job_id = j.id and ph.removed_at is null
    ) p on true
  where j.deleted_at is null;

alter view job_health_check set (security_invoker = true);

commit;
