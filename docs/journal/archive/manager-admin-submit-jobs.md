# Admins/managers submit jobs (confirmed brief)

Goal: manager/admin can submit a job via the worker flow; never their landing page.

Requirements
1. /new open to worker, manager, admin. Landing unchanged. Entry points: "New job" in secondary nav (sidebar / More on phone) + button at top of Jobs list. Bottom tab bar unchanged.
2. Same flow as workers (photos, OCR, services, coworkers, offline queue, duplicate warning, site choice).
3. Extra Worker field for manager/admin, two modes:
   - pick real worker: worker_id = that worker (manager: own-site workers; admin: any). Pay/stats/edit window are theirs.
   - type a name: worker_id = submitter, jobs.worker_label = name. Last 5 labels per device in localStorage (like brands, lib/recent.ts) as chips.
4. Labelled jobs: count in site stats, car counts, billing, Jobs list, exports, customer report (label shown where worker name is; hidden from Carasso when hide_worker_names). NOT counted in submitter's personal pay, My Stats, payroll share.
5. DB: nullable worker_label (length-limited); new migration widens jobs_insert + create_job for manager/admin on behalf of permitted workers (RLS-enforced); label valid only when submitter is owner.
6. Security: worker cannot set label or submit for others; manager cannot submit for other-site worker; Carasso cannot submit.

Out of scope: placeholder worker accounts, shared DB label list, new tab-bar tab, changes to worker flow/landing.

AC-1 manager/admin open /new from secondary nav and Jobs button; landing + tab bar unchanged; worker flow unchanged; Carasso blocked.
AC-2 Worker field supports pick/type; manager picker own-site workers, admin all.
AC-3 Pick worker -> that worker owns job; their pay/My Stats/edit window apply; submitter gets no share.
AC-4 Typed name -> owned by submitter + worker_label; shown in Jobs list, Job Detail, exports; hidden from Carasso under hide_worker_names.
AC-5 Labelled jobs count in site stats/cars/billing; excluded from submitter's personal pay, My Stats, payroll share.
AC-6 Last 5 labels as chips per device (case-insensitive dedupe); tap fills field.
AC-7 DB rejects: worker setting label; worker inserting for someone else; manager inserting for other-site worker; label when submitter != owner; overlong label.
AC-8 web+worker tests, lint, tsc, new e2e pass; security review done; CONTEXT.md/PRODUCT.md updated; migration + verify SQL.
