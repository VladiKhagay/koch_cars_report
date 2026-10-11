-- ===========================================================================
-- 0017 — catalog numbers are not unique
--
-- 0002 made services.catalog_number UNIQUE on the assumption it identified a
-- service. It doesn't: the importer's accounting key can legitimately be
-- shared by several services. Services are identified by id everywhere
-- (jobs.service_id, exports, analytics), so nothing depends on uniqueness.
-- Still required (NOT NULL) — it is the accounting column in exports.
-- ===========================================================================

begin;

alter table services drop constraint services_catalog_number_key;

commit;
