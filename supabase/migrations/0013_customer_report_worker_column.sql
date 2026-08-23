-- ===========================================================================
-- 0013 — the customer report may name the worker
--
-- 0007 closed the customer report to seven columns and banned `worker` and
-- `worker_price` outright, on the reasoning that neither who did the work nor
-- what the yard pays them belongs in a document that goes to the importer.
--
-- Half of that still holds. The yard has decided the importer SHOULD see who
-- did the work — it is how a query about one treatment reaches the person who
-- performed it — so `worker` becomes an eighth allowed column, visible by
-- default. `worker_price` does not move: what the yard pays its staff stays
-- inside the building, and the RPC below still rejects it.
--
-- Apply after 0012.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. New sites get the worker column switched on
-- ---------------------------------------------------------------------------

alter table sites
  alter column customer_report_config set default '{
    "columns": [
      {"key": "date",           "visible": true},
      {"key": "brand",          "visible": true},
      {"key": "plate",          "visible": true},
      {"key": "vin",            "visible": true},
      {"key": "service",        "visible": true},
      {"key": "catalog_number", "visible": false},
      {"key": "billing_code",   "visible": true},
      {"key": "worker",         "visible": true}
    ]
  }'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Existing sites gain the column without losing their layout
--
-- 0007 could reset every row outright because no UI existed to configure this,
-- so no row held a manager's intent. That is no longer true — the export screen
-- has been configuring these for real since — so the column is APPENDED to
-- whatever each site has rather than the config being rewritten. Order and
-- every existing toggle survive; the manager can move `worker` wherever they
-- want it, or switch it off.
--
-- Rows whose config is missing or malformed are left alone: resolveCustomerColumns
-- falls back to the full list for those anyway, and concatenating onto a
-- non-array would error the whole migration out.
-- ---------------------------------------------------------------------------

update sites
set customer_report_config = jsonb_set(
      customer_report_config,
      '{columns}',
      (customer_report_config -> 'columns') || '[{"key": "worker", "visible": true}]'::jsonb
    )
where jsonb_typeof(customer_report_config -> 'columns') = 'array'
  and not exists (
    select 1
    from jsonb_array_elements(customer_report_config -> 'columns') as entry
    where entry ->> 'key' = 'worker'
  );

-- ---------------------------------------------------------------------------
-- 3. The allowlist gains `worker` — and only `worker`
-- ---------------------------------------------------------------------------

create or replace function update_customer_report_config(new_config jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller users;
begin
  select * into caller from current_app_user();

  if caller is null or caller.role not in ('manager', 'admin') then
    raise exception 'forbidden';
  end if;

  if caller.site_id is null then
    raise exception 'no site assigned';
  end if;

  if jsonb_typeof(new_config) <> 'object'
     or jsonb_typeof(new_config -> 'columns') <> 'array' then
    raise exception 'invalid config: expected { "columns": [...] }';
  end if;

  -- `worker_price` is absent on purpose and must stay absent: this configures
  -- a document that leaves the building, and the yard's payroll does not.
  if exists (
    select 1
    from jsonb_array_elements(new_config -> 'columns') AS entry
    where entry ->> 'key' is null
       or entry ->> 'key' not in (
            'date', 'brand', 'plate', 'vin', 'service', 'catalog_number',
            'billing_code', 'worker'
          )
  ) then
    raise exception 'invalid config: unknown or forbidden column key';
  end if;

  update sites
  set customer_report_config = new_config
  where id = caller.site_id;
end;
$$;

revoke all on function update_customer_report_config(jsonb) from public;
grant execute on function update_customer_report_config(jsonb) to authenticated;

commit;
