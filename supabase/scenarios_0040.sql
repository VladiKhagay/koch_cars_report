-- Behaviour scenarios for 0040 (managers/admins submit jobs for a worker or
-- under a typed name).
-- MANUAL script, for a local or branch database ONLY — never production:
-- it inserts fixture jobs, may deactivate a worker, flips hide_worker_names
-- and impersonates users. Everything runs in one transaction that ends in
-- ROLLBACK, so nothing is kept. Each check raises on failure; reaching the
-- final notice means every scenario passed.
--
-- Needs: one active admin; one active manager with a site that also has an
-- active worker; one active worker at ANOTHER site; one active 'carasso'
-- (viewer) user linked to a site in user_sites; one service. For the
-- "inactive worker" case it uses an inactive worker, or deactivates (inside
-- the transaction) a third worker; with neither, that case is skipped with a
-- notice. Run as the SQL-editor (postgres) user: fixtures are written in that
-- trusted context, then each block switches to `authenticated` with that
-- user's JWT `sub`.

begin;

-- ---------------------------------------------------------------- fixtures
do $$
declare
  a  users;
  m  users;
  w  users;   -- worker at the manager's site
  o  users;   -- worker at another site
  i  users;   -- inactive worker
  c  users;
  cs uuid;    -- a site the viewer is linked to
  os uuid;    -- a site that is not the manager's
  sv uuid;
  j_own   uuid;
  j_label uuid;
begin
  select * into a from users where role = 'admin' and active order by created_at limit 1;
  select mu.* into m from users mu
  where mu.role = 'manager' and mu.active and mu.site_id is not null
    and exists (select 1 from users x where x.role = 'worker' and x.active and x.site_id = mu.site_id)
    and exists (select 1 from users x where x.role = 'worker' and x.active and x.site_id <> mu.site_id)
  order by mu.created_at limit 1;
  select * into w from users where role = 'worker' and active and site_id = m.site_id order by created_at limit 1;
  select * into o from users where role = 'worker' and active and site_id <> m.site_id order by created_at limit 1;
  select u.* into c from users u
  where u.role = 'carasso' and u.active and exists (select 1 from user_sites us where us.user_id = u.id)
  order by u.created_at limit 1;
  if a.id is null or m.id is null or w.id is null or o.id is null or c.id is null then
    raise exception 'scenarios_0040 needs an admin, a manager whose site has a worker, '
                    'a worker at another site and a site-linked viewer';
  end if;
  os := o.site_id;
  cs := (select us.site_id from user_sites us where us.user_id = c.id order by us.site_id limit 1);
  sv := (select id from services where deleted_at is null order by sort_order, id limit 1);
  if sv is null then raise exception 'scenarios_0040 needs a service'; end if;

  select * into i from users where role = 'worker' and not active order by created_at limit 1;
  if i.id is null then
    select * into i from users
    where role = 'worker' and active and id not in (w.id, o.id) order by created_at limit 1;
    if i.id is not null then
      update users set active = false where id = i.id;   -- rolled back with the rest
    end if;
  end if;

  -- w's own job, window open: for the "worker sets a label" update.
  insert into jobs (site_id, worker_id, service_id, plate, vin)
  values (w.site_id, w.id, sv, '9990401', 'SCN00400000000001') returning id into j_own;

  -- A labelled job at the viewer's site, written in the trusted context.
  insert into jobs (site_id, worker_id, service_id, plate, vin, worker_label)
  values (cs, a.id, sv, '9990402', 'SCN00400000000002', '  Dana Scn  ') returning id into j_label;
  if (select worker_label from jobs where id = j_label) is distinct from 'Dana Scn' then
    raise exception 'label not trimmed: %', (select worker_label from jobs where id = j_label);
  end if;
  -- The trusted context writes no on-behalf audit row.
  if exists (select 1 from audit_log where job_id = j_label and action = 'create_on_behalf') then
    raise exception 'trusted-context insert wrote a create_on_behalf row';
  end if;

  update app_settings set value = 'false'::jsonb where key = 'hide_worker_names';

  perform set_config('s40.admin', a.auth_id::text, true);
  perform set_config('s40.manager', m.auth_id::text, true);
  perform set_config('s40.worker', w.auth_id::text, true);
  perform set_config('s40.viewer', c.auth_id::text, true);
  perform set_config('s40.admin_id', a.id::text, true);
  perform set_config('s40.manager_id', m.id::text, true);
  perform set_config('s40.worker_id', w.id::text, true);
  perform set_config('s40.other_id', o.id::text, true);
  perform set_config('s40.inactive_id', coalesce(i.id::text, ''), true);
  perform set_config('s40.msite', m.site_id::text, true);
  perform set_config('s40.osite', os::text, true);
  -- A site that is not the admin's own (admin's site may be null).
  perform set_config('s40.asite',
                     (case when a.site_id is not distinct from m.site_id then os else m.site_id end)::text, true);
  perform set_config('s40.service', sv::text, true);
  perform set_config('s40.j_own', j_own::text, true);
  perform set_config('s40.j_label', j_label::text, true);
end $$;

set local role authenticated;

-- ---------------------------------------------------------------- worker
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s40.worker'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s40.worker'), true);

do $$
declare
  me    uuid := current_setting('s40.worker_id')::uuid;
  other uuid := current_setting('s40.other_id')::uuid;
  site  uuid := current_setting('s40.msite')::uuid;
  sv    uuid := current_setting('s40.service')::uuid;
  j     uuid := current_setting('s40.j_own')::uuid;
  n     int;
begin
  -- A worker never sets a label at insert.
  begin
    perform create_job(site, me, '9990403', 'SCN00400000000003', true, null, null, '{}', array[sv], 'Someone');
    raise exception 'LEAK: worker inserted a labelled job';
  exception when insufficient_privilege then null;
  end;

  -- ... nor submits for another worker.
  begin
    perform create_job(site, other, '9990404', 'SCN00400000000004', true, null, null, '{}', array[sv]);
    raise exception 'LEAK: worker submitted for another worker';
  exception when insufficient_privilege then null;
  end;

  -- ... nor sets one later: the write is silently reverted.
  update jobs set worker_label = 'Someone' where id = j;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'worker could not update own open job (% rows)', n; end if;
  if (select worker_label from jobs where id = j) is not null then
    raise exception 'LEAK: worker set a label on update';
  end if;

  -- The normal flow is unchanged, and a self-submit writes no on-behalf row
  -- (the worker cannot read audit_log; checked by the manager below).
  j := create_job(site, me, '9990405', 'SCN00400000000005', true, null, null, '{}', array[sv]);
  perform set_config('s40.j_self', j::text, true);
end $$;

-- ---------------------------------------------------------------- manager
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s40.manager'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s40.manager'), true);

do $$
declare
  me     uuid := current_setting('s40.manager_id')::uuid;
  wk     uuid := current_setting('s40.worker_id')::uuid;
  other  uuid := current_setting('s40.other_id')::uuid;
  site   uuid := current_setting('s40.msite')::uuid;
  osite  uuid := current_setting('s40.osite')::uuid;
  sv     uuid := current_setting('s40.service')::uuid;
  j      uuid;
  jl     uuid;
  jc     uuid;
  v      record;
  bad    text;
  k      int := 0;
  -- snapshots: m_* the manager's personal rows, w_* the worker's, s_* the site
  m_tot_cost numeric; m_tot_jobs bigint; m_st_cost numeric; m_st_jobs bigint; m_month bigint;
  w_tot_cost numeric; w_tot_jobs bigint; w_st_jobs bigint; w_month bigint;
  s_cars bigint; s_cost numeric;
  m_tot_cost2 numeric; m_tot_jobs2 bigint; m_st_cost2 numeric; m_st_jobs2 bigint; m_month2 bigint;
  w_tot_cost2 numeric; w_tot_jobs2 bigint; w_st_jobs2 bigint; w_month2 bigint;
  s_cars2 bigint; s_cost2 numeric;
  pay numeric;
begin
  -- The self-submit by the worker above left no on-behalf row.
  if exists (select 1 from audit_log
             where job_id = current_setting('s40.j_self')::uuid and action = 'create_on_behalf') then
    raise exception 'self-submit wrote a create_on_behalf row';
  end if;

  -- For a worker at another site: refused (at either site).
  begin
    perform create_job(osite, other, '9990406', 'SCN00400000000006', true, null, null, '{}', array[sv]);
    raise exception 'LEAK: manager submitted for an other-site worker';
  exception when insufficient_privilege then null;
  end;
  begin
    perform create_job(site, other, '9990407', 'SCN00400000000007', true, null, null, '{}', array[sv]);
    raise exception 'LEAK: manager submitted for an other-site worker at own site';
  exception when insufficient_privilege then null;
  end;

  -- For an own-site worker but at another site: refused.
  begin
    perform create_job(osite, wk, '9990418', 'SCN00400000000018', true, null, null, '{}', array[sv]);
    raise exception 'LEAK: manager submitted for own-site worker at another site';
  exception when insufficient_privilege then null;
  end;

  -- As self at another site: unlabelled is OK (0028 behaviour kept) ...
  j := create_job(osite, me, '9990408', 'SCN00400000000008', true, null, null, '{}', array[sv]);
  if (select worker_id from jobs where id = j) is distinct from me then
    raise exception 'manager own job at another site not owned by the manager';
  end if;

  -- ... labelled is refused (the label's job counts for the manager's own site only).
  begin
    perform create_job(osite, me, '9990417', 'SCN00400000000017', true, null, null, '{}', array[sv], 'Dana');
    raise exception 'LEAK: manager logged a labelled job at another site';
  exception when insufficient_privilege then null;
  end;

  -- A label only when the submitter owns the job.
  begin
    perform create_job(site, wk, '9990409', 'SCN00400000000009', true, null, null, '{}', array[sv], 'Dana');
    raise exception 'LEAK: label accepted with worker_id <> submitter';
  exception when insufficient_privilege then null;
  end;

  -- Length: 61 refused, 60 accepted.
  begin
    perform create_job(site, me, '9990410', 'SCN00400000000010', true, null, null, '{}', array[sv], repeat('x', 61));
    raise exception 'overlong label accepted';
  exception when check_violation then null;
  end;
  j := create_job(site, me, '9990419', 'SCN00400000000019', true, null, null, '{}', array[sv], repeat('y', 60));
  if (select char_length(worker_label) from jobs where id = j) is distinct from 60 then
    raise exception '60-char label not stored';
  end if;

  -- Whitespace only = no label.
  j := create_job(site, me, '9990420', 'SCN00400000000020', true, null, null, '{}', array[sv], '    ');
  if (select worker_label from jobs where id = j) is not null then
    raise exception 'whitespace-only label stored as %', (select worker_label from jobs where id = j);
  end if;

  -- Control / zero-width / bidi characters refused.
  foreach bad in array array['Dana' || chr(8203), 'Dana' || chr(8238) || 'x', 'Da' || chr(10) || 'na',
                              'Dana' || chr(7), chr(65279) || 'Dana', 'Dana' || chr(8294)] loop
    k := k + 1;
    begin
      perform create_job(site, me, '99904' || (30 + k)::text, 'SCN004000000000' || (30 + k)::text,
                         true, null, null, '{}', array[sv], bad);
      raise exception 'LEAK: control/invisible label #% accepted', k;
    exception when check_violation then null;
    end;
  end loop;

  -- AC-3: on behalf of an own-site worker. Snapshot first.
  select coalesce(sum(worker_cost), 0), coalesce(sum(job_count), 0) into m_tot_cost, m_tot_jobs
  from job_daily_totals where worker_id = me;
  select coalesce(sum(worker_cost), 0), coalesce(sum(job_count), 0) into m_st_cost, m_st_jobs
  from job_daily_stats where worker_id = me;
  select coalesce(sum(job_count), 0) into m_month from job_monthly_stats where worker_id = me;
  select coalesce(sum(worker_cost), 0), coalesce(sum(job_count), 0) into w_tot_cost, w_tot_jobs
  from job_daily_totals where worker_id = wk;
  select coalesce(sum(job_count), 0) into w_st_jobs from job_daily_stats where worker_id = wk;
  select coalesce(sum(job_count), 0) into w_month from job_monthly_stats where worker_id = wk;

  j := create_job(site, wk, '9990411', 'SCN00400000000011', true, null, null, '{}', array[sv]);
  select worker_id, worker_label, locked_at, worker_price into v from jobs where id = j;
  if v.worker_id <> wk or v.worker_label is not null then
    raise exception 'on-behalf job owned by % label %', v.worker_id, v.worker_label;
  end if;
  if v.locked_at <= now() then raise exception 'on-behalf job has no edit window'; end if;
  pay := v.worker_price;
  perform set_config('s40.j_for_worker', j::text, true);

  select coalesce(sum(worker_cost), 0), coalesce(sum(job_count), 0) into m_tot_cost2, m_tot_jobs2
  from job_daily_totals where worker_id = me;
  select coalesce(sum(worker_cost), 0), coalesce(sum(job_count), 0) into m_st_cost2, m_st_jobs2
  from job_daily_stats where worker_id = me;
  select coalesce(sum(job_count), 0) into m_month2 from job_monthly_stats where worker_id = me;
  select coalesce(sum(worker_cost), 0), coalesce(sum(job_count), 0) into w_tot_cost2, w_tot_jobs2
  from job_daily_totals where worker_id = wk;
  select coalesce(sum(job_count), 0) into w_st_jobs2 from job_daily_stats where worker_id = wk;
  select coalesce(sum(job_count), 0) into w_month2 from job_monthly_stats where worker_id = wk;

  if w_tot_jobs2 is distinct from w_tot_jobs + 1 or w_st_jobs2 is distinct from w_st_jobs + 1
     or w_month2 is distinct from w_month + 1 or pay is null
     or w_tot_cost2 is distinct from w_tot_cost + pay then
    raise exception 'on-behalf job not credited to the worker (totals % -> %, stats % -> %, month % -> %, cost % -> %)',
      w_tot_jobs, w_tot_jobs2, w_st_jobs, w_st_jobs2, w_month, w_month2, w_tot_cost, w_tot_cost2;
  end if;
  if m_tot_cost2 is distinct from m_tot_cost or m_tot_jobs2 is distinct from m_tot_jobs
     or m_st_cost2 is distinct from m_st_cost or m_st_jobs2 is distinct from m_st_jobs
     or m_month2 is distinct from m_month then
    raise exception 'LEAK: on-behalf job credited to the manager';
  end if;

  -- The on-behalf insert is audited with the submitter.
  if not exists (select 1 from audit_log
                 where job_id = j and action = 'create_on_behalf' and user_id = me
                   and changes->'worker_id'->>'to' = wk::text) then
    raise exception 'on-behalf insert not audited';
  end if;

  -- A label can never be put on it afterwards.
  begin
    update jobs set worker_label = 'Dana' where id = j;
    raise exception 'LEAK: manager added a label to a worker''s job';
  exception when insufficient_privilege then null;
  end;

  -- AC-5: labelled job counts for the site, not for the manager.
  select coalesce(sum(car_count), 0), coalesce(sum(worker_cost), 0) into s_cars, s_cost
  from job_daily_totals where site_id = site;
  select coalesce(sum(worker_cost), 0), coalesce(sum(job_count), 0) into m_tot_cost, m_tot_jobs
  from job_daily_totals where worker_id = me;
  select coalesce(sum(worker_cost), 0), coalesce(sum(job_count), 0) into m_st_cost, m_st_jobs
  from job_daily_stats where worker_id = me;
  select coalesce(sum(job_count), 0) into m_month from job_monthly_stats where worker_id = me;

  jl := create_job(site, me, '9990412', 'SCN00400000000012', true, null, null, '{}', array[sv], ' Dana Scn ');
  select worker_label, worker_price into v from jobs where id = jl;
  if v.worker_label is distinct from 'Dana Scn' then raise exception 'label stored as %', v.worker_label; end if;
  pay := v.worker_price;

  select coalesce(sum(car_count), 0), coalesce(sum(worker_cost), 0) into s_cars2, s_cost2
  from job_daily_totals where site_id = site;
  select coalesce(sum(worker_cost), 0), coalesce(sum(job_count), 0) into m_tot_cost2, m_tot_jobs2
  from job_daily_totals where worker_id = me;
  select coalesce(sum(worker_cost), 0), coalesce(sum(job_count), 0) into m_st_cost2, m_st_jobs2
  from job_daily_stats where worker_id = me;
  select coalesce(sum(job_count), 0) into m_month2 from job_monthly_stats where worker_id = me;

  if s_cars2 is distinct from s_cars + 1 then
    raise exception 'site car_count % -> %, expected +1', s_cars, s_cars2;
  end if;
  if pay is null or s_cost2 is distinct from s_cost + pay then
    raise exception 'site worker_cost % -> %, expected +%', s_cost, s_cost2, pay;
  end if;
  if m_tot_cost2 is distinct from m_tot_cost or m_tot_jobs2 is distinct from m_tot_jobs
     or m_st_cost2 is distinct from m_st_cost or m_st_jobs2 is distinct from m_st_jobs
     or m_month2 is distinct from m_month then
    raise exception 'LEAK: labelled job credited to the submitter';
  end if;
  if not exists (select 1 from job_daily_totals
                 where site_id = site and worker_id is null and worker_label = 'Dana Scn') then
    raise exception 'job_daily_totals has no row for the label';
  end if;
  if not exists (select 1 from job_daily_stats
                 where site_id = site and worker_id is null and worker_label = 'Dana Scn') then
    raise exception 'job_daily_stats has no row for the label';
  end if;
  if exists (select 1 from audit_log where job_id = jl and action = 'create_on_behalf') then
    raise exception 'self-submitted labelled job wrote a create_on_behalf row';
  end if;

  -- A billing code on a labelled job works as on any other.
  insert into job_billing (job_id, billing_code) values (jl, 'SCN40');
  select worker_label, billing_code into v from jobs_manager where id = jl;
  if v.worker_label is distinct from 'Dana Scn' or v.billing_code is distinct from 'SCN40' then
    raise exception 'jobs_manager label/billing: % / %', v.worker_label, v.billing_code;
  end if;

  -- The label can be cleared but not changed; the clear is audited.
  begin
    update jobs set worker_label = 'Other' where id = jl;
    raise exception 'LEAK: manager changed a label';
  exception when insufficient_privilege then null;
  end;
  update jobs set worker_label = null where id = jl;
  if (select worker_label from jobs where id = jl) is not null then
    raise exception 'manager could not clear a label';
  end if;
  if not exists (select 1 from audit_log
                 where job_id = jl and changes ? 'worker_label'
                   and changes->'worker_label'->>'from' = 'Dana Scn') then
    raise exception 'clearing the label was not audited';
  end if;

  -- A labelled job with the worker as co-worker (seen below).
  jc := create_job(site, me, '9990421', 'SCN00400000000021', true, null, null, array[wk], array[sv], 'Dana Co');
  perform set_config('s40.j_cowork', jc::text, true);
end $$;

-- ---------------------------------------------------------------- worker sees the jobs
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s40.worker'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s40.worker'), true);

do $$
declare
  j  uuid := current_setting('s40.j_for_worker')::uuid;
  jc uuid := current_setting('s40.j_cowork')::uuid;
  n  int;
begin
  if not exists (select 1 from jobs_worker_view where id = j) then
    raise exception 'worker cannot see the job submitted for them';
  end if;

  -- Their edit window applies: they can actually update it.
  update jobs set worker_note = 'scn0040 edit' where id = j;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'worker could not edit the on-behalf job (% rows)', n; end if;

  -- As co-worker on a labelled job they see the typed name.
  if (select worker_label from jobs_worker_view where id = jc) is distinct from 'Dana Co' then
    raise exception 'co-worker does not see the label';
  end if;
end $$;

-- ---------------------------------------------------------------- admin
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s40.admin'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s40.admin'), true);

do $$
declare
  me    uuid := current_setting('s40.admin_id')::uuid;
  other uuid := current_setting('s40.other_id')::uuid;
  mgr   uuid := current_setting('s40.manager_id')::uuid;
  site  uuid := current_setting('s40.msite')::uuid;
  asite uuid := current_setting('s40.asite')::uuid;
  sv    uuid := current_setting('s40.service')::uuid;
  inact text := current_setting('s40.inactive_id');
  j     uuid;
  v     record;
begin
  -- Any worker, any site; audited.
  j := create_job(site, other, '9990413', 'SCN00400000000013', true, null, null, '{}', array[sv]);
  if (select worker_id from jobs where id = j) <> other then raise exception 'admin on-behalf owner wrong'; end if;
  if not exists (select 1 from audit_log
                 where job_id = j and action = 'create_on_behalf' and user_id = me) then
    raise exception 'admin on-behalf insert not audited';
  end if;

  -- Label as self at a site that is not the admin's own.
  j := create_job(asite, me, '9990414', 'SCN00400000000014', true, null, null, '{}', array[sv], 'Lee');
  if (select worker_label from jobs where id = j) is distinct from 'Lee' then
    raise exception 'admin label at another site not stored';
  end if;

  -- On behalf of a non-worker (a manager): refused.
  begin
    perform create_job(site, mgr, '9990415', 'SCN00400000000015', true, null, null, '{}', array[sv]);
    raise exception 'LEAK: admin submitted for a manager';
  exception when insufficient_privilege then null;
  end;

  -- On behalf of an inactive worker: refused.
  if inact = '' then
    raise notice 'scenarios_0040: no inactive worker fixture, inactive case skipped';
  else
    begin
      perform create_job(site, inact::uuid, '9990422', 'SCN00400000000022', true, null, null, '{}', array[sv]);
      raise exception 'LEAK: admin submitted for an inactive worker';
    exception when insufficient_privilege then null;
    end;
  end if;

  -- Admin cannot add a label to a job owned by another worker.
  begin
    update jobs set worker_label = 'Dana' where id = current_setting('s40.j_for_worker')::uuid;
    raise exception 'LEAK: admin added a label to a worker''s job';
  exception when insufficient_privilege then null;
  end;

  -- AC-4: admin sees the label in jobs_carasso crew.
  select worker_id, crew into v from jobs_carasso where id = current_setting('s40.j_label')::uuid;
  if v.crew is null or v.crew not like 'Dana Scn%' then
    raise exception 'admin jobs_carasso crew % does not start with the label', v.crew;
  end if;
end $$;

-- ---------------------------------------------------------------- viewer, names shown
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s40.viewer'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s40.viewer'), true);

do $$
declare
  v record;
begin
  select worker_id, crew into v from jobs_carasso where id = current_setting('s40.j_label')::uuid;
  if not found then raise exception 'viewer cannot see the labelled fixture job'; end if;
  if v.crew is null or v.crew not like 'Dana Scn%' then
    raise exception 'viewer crew % does not start with the label', v.crew;
  end if;
  -- (carasso_crew reads this column, so the submitter is not listed from it.)
  if v.worker_id is not null then
    raise exception 'LEAK: viewer sees the submitter id of a labelled job';
  end if;

  begin
    perform create_job(current_setting('s40.msite')::uuid, current_setting('s40.worker_id')::uuid,
                       '9990416', 'SCN00400000000016', true, null, null, '{}',
                       array[current_setting('s40.service')::uuid]);
    raise exception 'LEAK: viewer submitted a job';
  exception when insufficient_privilege then null;
            when raise_exception then
              if sqlerrm not in ('forbidden', 'the submitter must be a staff user') then raise; end if;
  end;

  begin
    perform list_staff();
    raise exception 'LEAK: viewer called list_staff';
  exception when raise_exception then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------- admin hides names
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s40.admin'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s40.admin'), true);

do $$
begin
  perform set_hide_worker_names(true);
  if exists (select 1 from list_staff() where role = 'carasso') then
    raise exception 'LEAK: list_staff lists carasso accounts';
  end if;
end $$;

-- ---------------------------------------------------------------- viewer, names hidden
select set_config('request.jwt.claims',
                  json_build_object('sub', current_setting('s40.viewer'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('s40.viewer'), true);

do $$
declare
  v record;
begin
  select worker_id, crew into v from jobs_carasso where id = current_setting('s40.j_label')::uuid;
  if v.crew is not null or v.worker_id is not null then
    raise exception 'LEAK: hidden names: crew % worker_id %', v.crew, v.worker_id;
  end if;
  raise notice 'scenarios_0040: all passed';
end $$;

rollback;
