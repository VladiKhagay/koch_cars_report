-- 0038: admin switch that hides CLIENT prices from the read-only viewer role
-- (`carasso`), the same way 0027/0028 hide worker names.
--
-- Apply BEFORE deploying the web build that reads `hide_client_prices` (the
-- web only reads the key; with the key missing it shows prices, i.e. today's
-- behaviour). Additive: one new app_settings key (default false = prices
-- visible, exactly as now), one admin-only RPC, and both carasso price
-- policies plus jobs_carasso gain a "unless the switch is on" condition.
-- Turn the switch on only after the web build is live.
--
-- Pre-check (must list app_settings_key_check, the inline check from 0027):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'app_settings'::regclass and contype = 'c';
--
-- Both layers are required: the price policies are what a viewer hits reading
-- job_client_prices / job_service_client_prices directly, but jobs_carasso is
-- an owner-rights view (0028) that reads those tables past RLS, so it has to
-- blank the prices itself.
--
-- jobs_carasso was last defined in 0033 (0028 created it); no later migration
-- redefines it. The view below is the 0033 text with only the price columns
-- wrapped and the `h` lateral moved up so the services lateral can see it.

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The setting
-- ---------------------------------------------------------------------------

alter table app_settings drop constraint app_settings_key_check;
alter table app_settings add constraint app_settings_key_check
  check (key in ('hide_worker_names', 'customer_report_config', 'hide_client_prices'));

insert into app_settings (key, value) values ('hide_client_prices', 'false'::jsonb)
on conflict (key) do nothing;

-- Same shape as set_hide_worker_names (0027), plus a loud failure if the row
-- is missing (an update of zero rows would otherwise "succeed").
create or replace function set_hide_client_prices(p_hide boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from current_app_user() u where u.role = 'admin') then
    raise exception 'forbidden';
  end if;
  if p_hide is null then
    raise exception 'invalid value';
  end if;
  update app_settings set value = to_jsonb(p_hide), updated_at = now()
  where key = 'hide_client_prices';
  if not found then
    raise exception 'setting missing';
  end if;
end;
$$;

revoke all on function set_hide_client_prices(boolean) from public, anon;
grant execute on function set_hide_client_prices(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Price tables: the viewer reads them only while the switch is off.
--    (app_settings_select lets carasso read the key; a missing row = off.)
-- ---------------------------------------------------------------------------

drop policy job_client_prices_carasso on job_client_prices;
create policy job_client_prices_carasso on job_client_prices for select
  using (
    exists (select 1 from current_app_user() u where u.role = 'carasso')
    and can_view_job(job_client_prices.job_id)
    and not coalesce((select a.value = 'true'::jsonb
                      from app_settings a where a.key = 'hide_client_prices'), false)
  );

drop policy job_service_client_prices_carasso on job_service_client_prices;
create policy job_service_client_prices_carasso on job_service_client_prices for select
  using (
    exists (select 1 from current_app_user() u where u.role = 'carasso')
    and can_view_job(job_service_client_prices.job_id)
    and not coalesce((select a.value = 'true'::jsonb
                      from app_settings a where a.key = 'hide_client_prices'), false)
  );

-- ---------------------------------------------------------------------------
-- 3. jobs_carasso: prices NULL for a viewer while hidden (keys stay in
--    services[], so the shape never changes). Admin always sees them.
--    Same 21 columns, order and types; still owner-rights.
-- ---------------------------------------------------------------------------

create or replace view jobs_carasso as
  select j.id,
         j.site_id,
         s.name as site_name,
         j.created_at,
         j.plate,
         j.vin,
         j.brand,
         j.worker_note,
         j.service_id,
         x.name_en as service_name_en,
         x.name_ru as service_name_ru,
         x.name_he as service_name_he,
         x.catalog_number,
         b.billing_code,
         case when h.hide then null else j.worker_id end as worker_id,
         case when h.hide then '{}'::uuid[] else j.coworker_ids end as coworker_ids,
         case when h.hide then null else (
           select string_agg(cu.name, ', ' order by c.ord)
           from unnest(array[j.worker_id] || j.coworker_ids) with ordinality as c(person, ord)
           join users cu on cu.id = c.person
         ) end as crew,
         case when h.hide_prices then null else cp.unit_price end  as client_unit_price,
         case when h.hide_prices then null else cp.total_price end as client_total_price,
         coalesce(x.service_ids, '{}') as service_ids,
         coalesce(x.services, '[]'::jsonb) as services
  from jobs j
  join current_app_user() me on true
  cross join lateral (
    select me.role = 'carasso'
           and coalesce((select a.value = 'true'::jsonb
                         from app_settings a where a.key = 'hide_worker_names'), false) as hide,
           me.role = 'carasso'
           and coalesce((select a.value = 'true'::jsonb
                         from app_settings a where a.key = 'hide_client_prices'), false) as hide_prices
  ) h
  join sites s on s.id = j.site_id
  left join job_billing b on b.job_id = j.id
  left join job_client_prices cp on cp.job_id = j.id
  left join lateral (
    select string_agg(sv.name_en, ', ' order by sv.sort_order, sv.id) as name_en,
           string_agg(coalesce(sv.name_ru, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_ru,
           string_agg(coalesce(sv.name_he, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_he,
           string_agg(sv.catalog_number, ', ' order by sv.sort_order, sv.id) as catalog_number,
           array_agg(sv.id order by sv.sort_order, sv.id) as service_ids,
           jsonb_agg(jsonb_build_object(
             'service_id', sv.id,
             'name_en', sv.name_en, 'name_ru', sv.name_ru, 'name_he', sv.name_he,
             'catalog_number', sv.catalog_number,
             'client_unit_price', case when h.hide_prices then null else lp.unit_price end,
             'client_total_price', case when h.hide_prices then null else lp.total_price end
           ) order by sv.sort_order, sv.id) as services
    from job_services js
    join services sv on sv.id = js.service_id
    left join job_service_client_prices lp on lp.job_id = js.job_id and lp.service_id = js.service_id
    where js.job_id = j.id
  ) x on true
  where j.deleted_at is null
    and (me.role = 'admin'
         or (me.role = 'carasso'
             and exists (select 1 from user_sites us
                         where us.user_id = me.id and us.site_id = j.site_id)));

revoke all on jobs_carasso from public, anon, authenticated;
grant select on jobs_carasso to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- DOWN (manual; run the web build without hide_client_prices first)
-- ---------------------------------------------------------------------------
-- begin;
-- set local lock_timeout = '5s';
--
-- create or replace view jobs_carasso as
--   select j.id,
--          j.site_id,
--          s.name as site_name,
--          j.created_at,
--          j.plate,
--          j.vin,
--          j.brand,
--          j.worker_note,
--          j.service_id,
--          x.name_en as service_name_en,
--          x.name_ru as service_name_ru,
--          x.name_he as service_name_he,
--          x.catalog_number,
--          b.billing_code,
--          case when h.hide then null else j.worker_id end as worker_id,
--          case when h.hide then '{}'::uuid[] else j.coworker_ids end as coworker_ids,
--          case when h.hide then null else (
--            select string_agg(cu.name, ', ' order by c.ord)
--            from unnest(array[j.worker_id] || j.coworker_ids) with ordinality as c(person, ord)
--            join users cu on cu.id = c.person
--          ) end as crew,
--          cp.unit_price  as client_unit_price,
--          cp.total_price as client_total_price,
--          coalesce(x.service_ids, '{}') as service_ids,
--          coalesce(x.services, '[]'::jsonb) as services
--   from jobs j
--   join current_app_user() me on true
--   join sites s on s.id = j.site_id
--   left join job_billing b on b.job_id = j.id
--   left join job_client_prices cp on cp.job_id = j.id
--   left join lateral (
--     select string_agg(sv.name_en, ', ' order by sv.sort_order, sv.id) as name_en,
--            string_agg(coalesce(sv.name_ru, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_ru,
--            string_agg(coalesce(sv.name_he, sv.name_en), ', ' order by sv.sort_order, sv.id) as name_he,
--            string_agg(sv.catalog_number, ', ' order by sv.sort_order, sv.id) as catalog_number,
--            array_agg(sv.id order by sv.sort_order, sv.id) as service_ids,
--            jsonb_agg(jsonb_build_object(
--              'service_id', sv.id,
--              'name_en', sv.name_en, 'name_ru', sv.name_ru, 'name_he', sv.name_he,
--              'catalog_number', sv.catalog_number,
--              'client_unit_price', lp.unit_price,
--              'client_total_price', lp.total_price
--            ) order by sv.sort_order, sv.id) as services
--     from job_services js
--     join services sv on sv.id = js.service_id
--     left join job_service_client_prices lp on lp.job_id = js.job_id and lp.service_id = js.service_id
--     where js.job_id = j.id
--   ) x on true
--   cross join lateral (
--     select me.role = 'carasso'
--            and coalesce((select a.value = 'true'::jsonb
--                          from app_settings a where a.key = 'hide_worker_names'), false) as hide
--   ) h
--   where j.deleted_at is null
--     and (me.role = 'admin'
--          or (me.role = 'carasso'
--              and exists (select 1 from user_sites us
--                          where us.user_id = me.id and us.site_id = j.site_id)));
--
-- revoke all on jobs_carasso from public, anon, authenticated;
-- grant select on jobs_carasso to authenticated;
--
-- drop policy job_client_prices_carasso on job_client_prices;
-- create policy job_client_prices_carasso on job_client_prices for select
--   using (
--     exists (select 1 from current_app_user() u where u.role = 'carasso')
--     and can_view_job(job_client_prices.job_id)
--   );
--
-- drop policy job_service_client_prices_carasso on job_service_client_prices;
-- create policy job_service_client_prices_carasso on job_service_client_prices for select
--   using (
--     exists (select 1 from current_app_user() u where u.role = 'carasso')
--     and can_view_job(job_service_client_prices.job_id)
--   );
--
-- drop function set_hide_client_prices(boolean);
--
-- -- The row must go before the narrower check comes back, or the add fails.
-- delete from app_settings where key = 'hide_client_prices';
-- alter table app_settings drop constraint app_settings_key_check;
-- alter table app_settings add constraint app_settings_key_check
--   check (key in ('hide_worker_names', 'customer_report_config'));
--
-- commit;
