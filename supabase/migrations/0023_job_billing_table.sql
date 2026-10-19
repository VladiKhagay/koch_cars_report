-- ===========================================================================
-- 0023 — billing_code / manager_note move to a manager-only table (step 1 of 2)
--
-- RLS decides which ROWS a caller sees, and a worker legitimately sees their own
-- job rows, so every column on `jobs` — billing_code and manager_note included —
-- was readable by that worker with a plain SELECT. Postgres column privileges
-- cannot fix it: managers and workers arrive on the same `authenticated` role.
-- The only real boundary is a different table.
--
--   job_billing   one row per job, readable and writable by the job's site
--                 manager and by admins only.
--   jobs_manager  jobs + its billing columns, joined. Managers read this
--                 instead of `jobs`, so filters, search and embeds keep
--                 working unchanged. security_invoker: a worker querying it
--                 gets job_billing's RLS, i.e. no billing rows at all.
--
-- The old columns stay until 0024 and are mirrored into job_billing, so a
-- phone still running the previous web build keeps working in between.
--
-- Deploy order:  0023  ->  deploy the web app  ->  0024.
-- ===========================================================================

begin;

create table job_billing (
  job_id        uuid primary key references jobs (id) on delete cascade,
  billing_code  text,
  manager_note  text,
  updated_at    timestamptz not null default now()
);

create trigger job_billing_set_updated_at
  before update on job_billing
  for each row execute function set_updated_at();

alter table job_billing enable row level security;

create policy job_billing_manager on job_billing for all
  using (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = job_billing.job_id
      and (u.role = 'admin' or (u.role = 'manager' and u.site_id = j.site_id))
  ))
  with check (exists (
    select 1 from jobs j
    join current_app_user() u on true
    where j.id = job_billing.job_id
      and (u.role = 'admin' or (u.role = 'manager' and u.site_id = j.site_id))
  ));

insert into job_billing (job_id, billing_code, manager_note)
select id, billing_code, manager_note
from jobs
where billing_code is not null or manager_note is not null;

-- Columns listed out, not `j.*`: until 0024 the old billing_code / manager_note
-- still exist on jobs and would collide with the joined ones. Add any future
-- jobs column here too.
create view jobs_manager as
  select j.id, j.site_id, j.worker_id, j.created_at, j.updated_at, j.plate, j.vin,
         j.vin_valid_checksum, j.brand, j.worker_note, j.locked_at,
         j.duplicate_of_job_id, j.deleted_at, j.service_id, j.worker_price,
         j.coworker_ids, j.coworker_share, j.submitter_share,
         b.billing_code, b.manager_note
  from jobs j
  left join job_billing b on b.job_id = j.id;

alter view jobs_manager set (security_invoker = true);

-- Bridge for the previous web build, dropped in 0024.
create or replace function jobs_mirror_billing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into job_billing (job_id, billing_code, manager_note)
  values (new.id, new.billing_code, new.manager_note)
  on conflict (job_id) do update
    set billing_code = excluded.billing_code, manager_note = excluded.manager_note;
  return null;
end;
$$;

create trigger jobs_mirror_billing
  after update of billing_code, manager_note on jobs
  for each row
  when (new.billing_code is distinct from old.billing_code
        or new.manager_note is distinct from old.manager_note)
  execute function jobs_mirror_billing();

commit;
