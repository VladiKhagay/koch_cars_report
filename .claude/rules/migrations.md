---
paths:
  - "supabase/**"
  - "car-prep-tracker/supabase/**"
---

# Supabase migration rules

Loaded when touching `supabase/`. Background: [ADR-0001](../../docs/decisions/0001-database-is-the-authorization-layer.md), [data model](../../docs/architecture/data-model.md), [SECURITY-NOTES](../../docs/security/SECURITY-NOTES.md).

- **RLS is the authorization layer.** New data access = an RLS policy or a `security invoker`/`security definer` RPC. A UI-only guard is not a control.
- Plain SQL, next number (`00NN_<slug>.sql`). **Never edit a migration that may already be applied**; write a new one.
- **Write, never apply.** Migrations are applied by hand in the Supabase SQL editor by the user. Never run one against real data.
- Every migration header states **deploy order** (e.g. `00NN -> Worker -> web`) and **rollback**, with the `down` commented in the file when one exists.
- Ship a read-only `supabase/verify_00NN.sql`; behaviour scenarios go in `scenarios_00NN.sql` (branch DB only).
- Never drop or collapse a table that can hold several rows per parent without a lossless backfill and a verify script (0005 lost `job_services`).
- Deletion is soft (`deleted_at`, photo tombstones `removed_at`). No hard `DELETE` on `services`.
- Prices are **snapshots** stamped by triggers, never taken from the client.
- Manager/admin changes are audited by triggers in the same transaction; keep that true for new tables.
- New functions: revoke `EXECUTE` from `anon` explicitly. Revoking from `public` is not enough (SECURITY-AUDIT N-1).
- Update `docs/architecture/data-model.md` (migration table + section) and `docs/security/SECURITY-NOTES.md` (new numbered section) in the same change.
