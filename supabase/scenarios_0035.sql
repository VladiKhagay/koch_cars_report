-- Behaviour scenarios for 0035 (worker media edit inside the 15-minute window).
-- MANUAL script, for a local or branch database ONLY — never production:
-- it inserts fixture jobs/photos and impersonates a worker. Everything runs in
-- one transaction that ends in ROLLBACK, so nothing is kept. Each check raises
-- on failure; reaching the final notice means every scenario passed.
--
-- Needs two active users with role 'worker' (any sites). Run as the SQL-editor
-- (postgres) user: fixtures are written in that trusted context, then each
-- scenario block switches to `authenticated` with the worker's JWT `sub`.

begin;

-- ---------------------------------------------------------------- fixtures
do $$
declare
  w  users;
  o  users;
  j_open uuid; j_closed uuid; j_other uuid; j_deleted uuid; j_cowork uuid; j_deleted_empty uuid;
begin
  select * into w from users where role = 'worker' and active order by created_at limit 1;
  select * into o from users where role = 'worker' and active and id <> w.id order by created_at limit 1;
  if w.id is null or o.id is null then
    raise exception 'scenarios_0035 needs two active workers';
  end if;

  insert into jobs (site_id, worker_id, plate, vin) values (coalesce(w.site_id, (select id from sites limit 1)), w.id, '9990001', null) returning id into j_open;
  insert into jobs (site_id, worker_id, plate, vin) values (coalesce(w.site_id, (select id from sites limit 1)), w.id, '9990002', null) returning id into j_closed;
  insert into jobs (site_id, worker_id, plate, vin) values (coalesce(o.site_id, (select id from sites limit 1)), o.id, '9990003', null) returning id into j_other;
  insert into jobs (site_id, worker_id, plate, vin) values (coalesce(w.site_id, (select id from sites limit 1)), w.id, '9990004', null) returning id into j_deleted;
  -- Another worker's job with w as a co-worker: co-workers never edit media.
  insert into jobs (site_id, worker_id, coworker_ids, plate, vin) values (coalesce(o.site_id, (select id from sites limit 1)), o.id, array[w.id], '9990005', null) returning id into j_cowork;
  -- w's own job, deleted by a manager, window closed, no photo rows at all.
  insert into jobs (site_id, worker_id, plate, vin) values (coalesce(w.site_id, (select id from sites limit 1)), w.id, '9990006', null) returning id into j_deleted_empty;

  update jobs set locked_at = now() + interval '10 minutes' where id in (j_open, j_other, j_deleted, j_cowork);
  update jobs set locked_at = now() - interval '1 minute' where id in (j_closed, j_deleted_empty);
  update jobs set deleted_at = now() where id in (j_deleted, j_deleted_empty);

  -- j_closed's plate starts tombstoned (as if a manager removed it), written at
  -- insert so no update/audit trigger fires in this trusted context.
  insert into photos (job_id, kind, r2_key, removed_at)
  select j, k, j::text || '/' || k || '.jpg', case when j = j_closed and k = 'plate' then now() end
  from unnest(array[j_open, j_closed, j_other, j_deleted, j_cowork]) j, unnest(array['plate', 'vin', 'extra_1']) k;

  perform set_config('s35.sub', w.auth_id::text, true);
  perform set_config('s35.open', j_open::text, true);
  perform set_config('s35.closed', j_closed::text, true);
  perform set_config('s35.other', j_other::text, true);
  perform set_config('s35.deleted', j_deleted::text, true);
  perform set_config('s35.cowork', j_cowork::text, true);
  perform set_config('s35.deleted_empty', j_deleted_empty::text, true);
end $$;

-- ---------------------------------------------------------------- as the worker
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s35.sub'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s35.sub'), true);
set local role authenticated;

do $$
declare
  j_open    uuid := current_setting('s35.open')::uuid;
  j_closed  uuid := current_setting('s35.closed')::uuid;
  j_other   uuid := current_setting('s35.other')::uuid;
  j_deleted uuid := current_setting('s35.deleted')::uuid;
  j_cowork  uuid := current_setting('s35.cowork')::uuid;
  j_deleted_empty uuid := current_setting('s35.deleted_empty')::uuid;
  n int;
  r photos;
begin
  -- AC1: replace, remove, re-add an extra in the window.
  update photos set r2_key = r2_key, removed_at = null where job_id = j_open and kind = 'extra_1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'replace extra_1 in window: % rows', n; end if;

  update photos set removed_at = now() where job_id = j_open and kind = 'extra_1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'remove extra_1 in window: % rows', n; end if;

  update photos set removed_at = null where job_id = j_open and kind = 'extra_1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 're-add extra_1 in window: % rows', n; end if;

  -- AC1: add a new slot the way the web does (upsert), and replace plate.
  insert into photos (job_id, kind, r2_key, removed_at) values (j_open, 'extra_2', j_open::text || '/extra_2.jpg', null)
    on conflict (job_id, kind) do update set r2_key = excluded.r2_key, removed_at = excluded.removed_at;
  insert into photos (job_id, kind, r2_key, removed_at) values (j_open, 'plate', j_open::text || '/plate.jpg', null)
    on conflict (job_id, kind) do update set r2_key = excluded.r2_key, removed_at = excluded.removed_at;
  if not can_write_photo(j_open, 'extra_3') then raise exception 'can_write_photo refused the open window'; end if;

  -- AC2: plate/VIN are never removed by a worker.
  begin
    update photos set removed_at = now() where job_id = j_open and kind = 'plate';
    raise exception 'LEAK: worker removed plate';
  exception when insufficient_privilege then null;
  end;
  begin
    update photos set removed_at = now() where job_id = j_open and kind = 'vin';
    raise exception 'LEAK: worker removed vin';
  exception when insufficient_privilege then null;
  end;

  -- AC2: no tombstoned insert.
  begin
    insert into photos (job_id, kind, r2_key, removed_at) values (j_open, 'extra_3', 'x', now());
    raise exception 'LEAK: worker inserted a removed row';
  exception when insufficient_privilege then null;
  end;

  -- AC2: identity never moves (guard reverts silently).
  update photos set job_id = j_other, kind = 'extra_3', r2_key = 'elsewhere' where job_id = j_open and kind = 'extra_1';
  select * into r from photos where job_id = j_open and kind = 'extra_1';
  if r.id is null or r.r2_key <> j_open::text || '/extra_1.jpg' then raise exception 'LEAK: photo identity moved'; end if;

  -- AC2: closed window, another worker's job, a deleted job: zero rows.
  update photos set removed_at = now() where job_id in (j_closed, j_other, j_deleted) and kind = 'extra_1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEAK: % rows updated outside the window / own live job', n; end if;
  if can_write_photo(j_deleted, 'extra_1') then raise exception 'LEAK: can_write_photo on a deleted job'; end if;
  if can_write_photo(j_closed, 'extra_1') then raise exception 'LEAK: can_write_photo after the window'; end if;

  -- AC2: a co-worker on someone else's open job edits nothing.
  update photos set removed_at = now() where job_id = j_cowork and kind = 'extra_1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEAK: co-worker updated % rows', n; end if;
  begin
    insert into photos (job_id, kind, r2_key, removed_at) values (j_cowork, 'extra_1', j_cowork::text || '/extra_1.jpg', null)
      on conflict (job_id, kind) do update set r2_key = excluded.r2_key, removed_at = excluded.removed_at;
    raise exception 'LEAK: co-worker upsert accepted';
  exception when insufficient_privilege then null;
  end;

  -- AC2: the web's upsert on a closed-window job is refused (it has photos,
  -- so the "no photo rows yet" branch cannot let it in).
  begin
    insert into photos (job_id, kind, r2_key, removed_at) values (j_closed, 'extra_1', j_closed::text || '/extra_1.jpg', null)
      on conflict (job_id, kind) do update set r2_key = excluded.r2_key, removed_at = excluded.removed_at;
    raise exception 'LEAK: upsert on a closed-window job accepted';
  exception when insufficient_privilege then null;
  end;

  -- AC2: a manager-removed plate cannot be un-removed after the window.
  update photos set removed_at = null where job_id = j_closed and kind = 'plate';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEAK: plate un-removed after the window (% rows)', n; end if;

  -- 0035: a deleted job with no photo rows takes no first photo either.
  if can_write_photo(j_deleted_empty, 'plate') then raise exception 'LEAK: can_write_photo on a deleted job with no photos'; end if;

  -- No DELETE policy.
  delete from photos where job_id = j_open;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEAK: worker deleted % photo rows', n; end if;

  raise notice 'scenarios_0035: all passed';
end $$;

rollback;
