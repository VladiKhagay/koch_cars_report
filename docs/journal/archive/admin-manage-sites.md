# Brief: admin can rename / disable / delete sites

Goal: admins can fix a site entered wrongly (today `web/src/pages/admin/Sites.tsx` only adds).

Requirements
- Rename (admin). Id-keyed, history follows. Name stays unique (23505 -> duplicate message).
- Disable / re-enable (new `sites.active boolean not null default true`, migration 0041).
  - Disabled site accepts no new jobs: enforced in DB (jobs_insert RLS / create_job), not only UI.
  - Hidden from pickers for new jobs, user/invite site dropdowns, default site scope (useSiteScope default, NewJob site select).
  - Jobs history, Jobs filter, stats, exports still include it. Users assigned keep access.
  - Admin Sites list shows disabled state clearly (badge, toggle).
- Delete (admin) only if no jobs, no users, no user_sites (Carasso) links; confirmation dialog; else tell admin to disable. Enforce in DB too (FK or checked function), friendly error in UI.
- Admin only, via RLS (sites_write already admin-only; check manager column carve-out in 0005 line ~198).
- Migration 0041 + verify_0041.sql (+ scenarios if useful), house style header with deploy order (0041 -> web) and commented DOWN.
- i18n en/ru/he. Docs: CONTEXT.md, PRODUCT.md, SECURITY-NOTES.md as relevant.
Out of scope: moving jobs between sites, merging sites.

ACs
1 Admin can rename a site; duplicate name rejected with message.
2 Admin can disable and re-enable; disabled site cannot receive a new job (DB rejects), existing data unchanged.
3 Disabled site hidden from new-job/user/invite pickers and default scope; still visible in history/filters/stats/exports.
4 Delete works only for an unreferenced site, with confirm; referenced site refuses in DB and UI guides to disable.
5 Non-admins cannot change sites (RLS).
6 Tests pass (web, worker), lint, tsc; docs updated; migration verify file.
Do not apply migrations to any real DB. Do not commit/push. Work in an isolated git worktree off origin/main (local main is behind and has unrelated uncommitted video work).
