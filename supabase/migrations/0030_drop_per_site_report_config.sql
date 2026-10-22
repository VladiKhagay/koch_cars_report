-- ===========================================================================
-- 0030 — remove the per-site customer report layout (step 5 of 5)
--
-- Run AFTER the web build that reads app_settings.customer_report_config is
-- live: until then the old Export screen still selects this column. The layout
-- is now one global row (0027); a per-site copy would only be a second source
-- of truth.
-- ===========================================================================

begin;

alter table sites drop column customer_report_config;

commit;
