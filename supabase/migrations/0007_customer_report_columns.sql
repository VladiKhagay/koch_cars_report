-- ===========================================================================
-- 0007 — the customer report's column set is now a closed list
--
-- 0005 shipped `customer_report_config` with `worker` visible by default and
-- `worker_price` present-but-hidden. The customer treatment report is an
-- external document: it goes to the importer, not to the office. Neither who
-- did the work nor what the yard pays them belongs in it, at any visibility.
--
-- Two changes, both needed:
--
--  1. The stored configs are rewritten to the seven columns the report may
--     contain. Existing rows are reset outright rather than migrated field by
--     field — there was no UI to configure this until now, so every row still
--     holds the 0005 default and there is no manager intent to preserve.
--
--  2. `update_customer_report_config` now validates the column KEYS, not just
--     the shape. Before this, the RPC happily stored {"key": "worker"} and the
--     only thing standing between that and a customer seeing employee names
--     was the renderer. The client-side allowlist in lib/reportConfig.ts stays
--     — a privacy rule this firm should fail closed in two places — but the
--     database should never have accepted the value in the first place.
--
-- Apply after 0006.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The closed list
--
-- Keys are the export's own field names, not database columns, so renaming a
-- column later doesn't invalidate every site's saved layout. Order in the
-- array IS column order in the sheet; `visible` toggles a column without
-- losing its position.
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
      {"key": "billing_code",   "visible": true}
    ]
  }'::jsonb;

-- Labels are deliberately gone from the stored config: the sheet's header text
-- is fixed in code because the office parses on it. A per-site label would let
-- one site silently rename a header their downstream process matches against.
update sites
set customer_report_config = '{
    "columns": [
      {"key": "date",           "visible": true},
      {"key": "brand",          "visible": true},
      {"key": "plate",          "visible": true},
      {"key": "vin",            "visible": true},
      {"key": "service",        "visible": true},
      {"key": "catalog_number", "visible": false},
      {"key": "billing_code",   "visible": true}
    ]
  }'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Validate the contents, not just the envelope
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

  -- The allowlist. `worker` and `worker_price` are absent on purpose and must
  -- stay absent: this configures a document that leaves the building.
  if exists (
    select 1
    from jsonb_array_elements(new_config -> 'columns') AS entry
    where entry ->> 'key' is null
       or entry ->> 'key' not in (
            'date', 'brand', 'plate', 'vin', 'service', 'catalog_number', 'billing_code'
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
