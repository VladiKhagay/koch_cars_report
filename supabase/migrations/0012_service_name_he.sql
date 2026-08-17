-- ===========================================================================
-- 0012 — Hebrew service names
--
-- The catalog has carried `name_en` and `name_ru` since 0001, and Hebrew
-- shipped as a full UI locale afterwards — so a Hebrew-reading worker got a
-- Hebrew interface and English service names, on the most-tapped control in
-- the product. `serviceName()` (web/src/lib/serviceName.ts) has read an
-- optional `name_he` since it was written, waiting for this column; it falls
-- back to English until a name is actually filled in, so nothing changes for
-- services that never get one.
--
-- Nullable and no default, exactly like name_ru: a translation is optional,
-- and an empty string is stored as NULL rather than as a name that renders as
-- nothing. No backfill is possible — these are words somebody has to choose.
-- ===========================================================================

begin;

alter table services add column name_he text;

comment on column services.name_he is
  'Optional Hebrew catalog name. NULL falls back to name_en at render time.';

commit;
