# Lessons

Distilled from shipped tasks and past incidents. Read before planning. Each lesson says what it became; "prose only" lessons are candidates to turn into a check.
Seeded 2026-11-24 from incidents recorded in the former `CONTEXT.md` and `SECURITY-AUDIT.md`.

| # | Lesson | Promoted to | Where |
|---|---|---|---|
| 1 | Silent fallbacks hide outages: OCR swallowed errors, so the Gemini 404 went unnoticed. When a "best effort" path stops working, nothing visibly breaks. | ADR | [ADR-0003](../decisions/0003-ocr-on-workers-ai.md); check with `wrangler tail` (prose only: no alert) |
| 2 | Collapsing a one-to-many table loses data (0005 dropped `job_services`; 0033 had to rebuild it). Never drop a table that may hold more than one row per parent. | rule | `.claude/rules/migrations.md`; `verify_0033.sql` |
| 3 | A half-applied redesign gets judged as the old design (8 screens still used old classes). Finish UI migrations across every screen. | ADR | [ADR-0006](../decisions/0006-design-language.md) |
| 4 | A label that is also an action locks people out (Active badge doubled as deactivate). | rule | `.claude/rules/web-ui.md` (`Badge` is never an action) |
| 5 | Revoking a function from `public` does not revoke Supabase's explicit `anon` grant (N-1). | rule | `.claude/rules/migrations.md` |
| 6 | Client-echoed content types let an attacker serve HTML from our origin. Pin or sniff server-side. | rule + check | `.claude/rules/worker.md`; worker upload tests |
| 7 | Pushing to `main` didn't deploy the frontend (one-time upload project). If prod "remains as it was", check the workflow ran. | none (fixed by `deploy-web.yml`) | [operations](../architecture/operations.md) |
| 8 | Migrations are applied by hand; never assume one is live. | rule | `.claude/rules/migrations.md`; [operations](../architecture/operations.md) |
| 9 | Client-sent prices can be PATCHed by a worker inside the edit window; RLS is row-level, not column-level. Stamp prices by trigger. | rule | `.claude/rules/migrations.md` |
