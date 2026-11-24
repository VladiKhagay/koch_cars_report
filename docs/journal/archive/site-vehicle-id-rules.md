# Brief: per-site VIN / plate requirements

Goal: some sites need the VIN and not the plate, others the plate and not the VIN. Admin sets this per site; new-job submission follows it.

Today: VIN required everywhere (0036: jobs.vin NOT NULL, plate_or_vin check dropped; NewJob.tsx vinProblem + VIN photo always required). Plate optional, 8 digits when typed.

Requirements
- Migration 0042:
  - `sites.vin_rule text not null default 'required' check in ('required','optional')`
  - `sites.plate_rule text not null default 'optional' check in ('required','optional')`
  - Defaults = today's behaviour; nothing changes until an admin edits a site.
  - `jobs.vin` drop NOT NULL; restore `jobs_plate_or_vin_chk (plate is not null or vin is not null)` (floor for every site).
  - `jobs_insert` RLS (0041 body) AND-ed with: site.vin_rule <> 'required' or jobs.vin is not null (non-blank); same for plate. create_job (security invoker) inherits.
  - House-style header with deploy order (0042 -> web), commented DOWN (DOWN must refuse if NULL-VIN jobs exist), verify_0042.sql.
- Values: only required / optional (no hidden).
- VIN photo follows the site's vin_rule (required iff vin_rule = required, even if a VIN is typed at an optional site). UI-only (photos upload after the job row).
- Plate photo stays optional everywhere.
- Typed values are still format-checked (VIN 17 chars no I/O/Q, plate 8 digits) whether required or optional.
- Admin only (sites_write already admin-only). Sites screen: per-site VIN/plate rule controls.
- NewJob: required fields/markers and problems list come from the selected site; changing site updates them. Staff submit-for-worker (0040) follows the same rules.
- Rules apply to new jobs only; existing jobs never re-checked.
- Offline: a queued job rejected after a rule change fails permanently with a clear message.
- i18n en/ru/he. Docs: PRODUCT.md (VIN-always rule -> per site), CONTEXT.md, SECURITY-NOTES.md as relevant.
Out of scope: hidden fields, other per-site fields, plate photo rules, re-validating old jobs, manager editing rules.

ACs
1 Admin can set VIN required/optional and plate required/optional per site; non-admins cannot (RLS).
2 New sites and existing sites default to VIN required, plate optional; prod behaviour unchanged after migration.
3 DB rejects a new job missing a field its site requires, and any job with neither plate nor VIN.
4 NewJob form shows/enforces the selected site's rules, including VIN photo following vin_rule; switching site updates them.
5 Format validation of typed VIN/plate unchanged.
6 Existing jobs unaffected; exports/history/lookups work with jobs that have no VIN.
7 Tests pass (web, worker), lint, tsc; verify_0042.sql; docs updated.
Do not apply migrations to any real DB. Do not commit/push without asking. Work in an isolated worktree off origin/main.
