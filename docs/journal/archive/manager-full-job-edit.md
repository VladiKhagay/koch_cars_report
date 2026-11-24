# Manager/admin full job edit

Goal: managers (own site, RLS) and admins can edit every job field and add/replace/remove media, with full edit tracking.

Requirements
- Editable (new): plate, vin, brand, worker_note, created_at (job date). Existing: worker, coworkers, site, services, billing code, manager note, admin line prices.
- Media: add/replace/remove plate, vin, extra_1..3, video. Remove clears the slot (R2 object left to the 60-day lifecycle). Replace overwrites.
- plate/VIN: same validation as worker entry (VIN hard charset/length, check digit soft warning, plate format); duplicate flag re-run (soft, never blocks).
- Tracking: audit_log stores changed fields as {from,to}; media add/replace/remove logged; read-only "Edit history" section on job page (who, when, what) for managers/admins. Audit writes for these edits must not be silently dropped.
- Workers unchanged (15-min window, column guard). DB enforces authz.

Out of scope: worker-facing changes, push notifications, hard-deleting R2 objects.

AC
1. Manager/admin can edit plate, VIN, brand, worker note, date and save; worker cannot (DB-enforced).
2. Invalid plate/VIN rejected; check-digit warns only; duplicate flag recomputed on plate/VIN change.
3. Manager/admin can add, replace, remove each media slot on a job at any age, within their site; worker rules unchanged.
4. Each save/media change writes an audit row with from/to; failure to audit surfaces to the user.
5. Job page shows Edit history (who/when/what), manager/admin only.
6. Tests and checks green; docs (CONTEXT/SECURITY-NOTES) updated; i18n en/ru/he.
