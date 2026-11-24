# Vehicle Prep Tracker

Job-tracking PWA for vehicle prep at 3 sites. $0/month budget, one maintainer, en/ru.
Layout: `web/` (React/Vite PWA), `worker/` (Cloudflare Worker, Hono), `supabase/` (migrations), `docs/` (context).
Checks: `cd web && npm test && npm run lint && npx tsc -b`; `cd worker && npm test && npm run typecheck`.

## Where context lives (read the relevant file before changing its area)

| Need | File |
|---|---|
| What the system is, architecture, stack, repo layout, routes | `docs/architecture/overview.md` |
| Tables, roles, per-migration behaviour, deploy/rollback order | `docs/architecture/data-model.md` |
| Deploy gotchas, open threads | `docs/architecture/operations.md` |
| Why things are built this way (binding if `accepted`) | `docs/decisions/` (ADRs, index in README) |
| Threat model, per-migration security, accepted risks | `docs/security/SECURITY-NOTES.md`, `SECURITY-AUDIT.md` |
| Product spec and users | `PRODUCT.md`, `docs/product/` |
| Design system and brief | `DESIGN.md`, `docs/design/DESIGN-BRIEF.md` |
| Past tasks and lessons | `docs/journal/` (`LESSONS.md` first) |
| Area rules (auto-load when touching the area) | `.claude/rules/` (worker, migrations, web-ui) |

`PRODUCT.md` and `DESIGN.md` stay at the repo root: the impeccable design skill looks for them there.

An **accepted** ADR is binding. If a task needs to contradict one, stop and propose a superseding ADR; don't work around it.

## Knowledge graph (graphify)

`graphify-out/GRAPH_REPORT.md` maps the codebase: god nodes, communities, surprising connections. For architecture or "what touches X" questions, read it or run `graphify query "<question>"` from `car-prep-tracker/` first; fall back to grep/Read for exact lines. It's a map, not truth: confirm against the source before editing. It is refreshed in the `/engineer` Compound phase. If it is more than a few shipped tasks behind, say so before relying on it.

## Auth & Security Defaults

- Every auth flow (reset password, magic link, invite, sign-up) must be limited to invited, active users by default. Check this server-side in the Worker, not only in the UI.
- Never trigger Supabase auth emails for arbitrary addresses. Verify the user exists and is active before calling any auth email API.

## Story Definition of Done

A story (FLT-xx, PLT-xx, etc.) is done only when all of these are true:
1. Unit and end-to-end tests pass locally, including new e2e files.
2. The security audit is complete and its findings are resolved or explicitly listed.
3. CI is green.

Only then merge. If any step is still open at the end of a turn, list it under 'Open items' in the wrap-up.

# Engineering team workflow

The main session is the **Engineering Lead (orchestrator)**. It alone coordinates, delegates and declares completion. Subagents cannot spawn subagents, so only the main session delegates.

Specialists (`.claude/agents/`): `planner`, `advocate`, `builder`, `code-reviewer`, `test-engineer`, `security-reviewer`; UI/UX = `frontend-master` (implements) and `product-manager` (judges against user reality).
Reviewers (`advocate`, `code-reviewer`, `security-reviewer`) are read-only. Never let the builder be the sole verifier of its own work.

Trivial tasks (typo, one-line copy, question): just do them, skip the ceremony.

## Lifecycle

Started with `/engineer <task>`, which holds the full procedure (`.claude/skills/engineer/SKILL.md`): grill → plan → advocate challenge → build → parallel independent review → remediation → verify → report → **Compound** after it ships (journal entry, promote lessons, graphify update). For substantive code changes without `/engineer`, follow the same skill.

## Bounds

- After 2 failed attempts at the same root problem: stop, gather fresh evidence, try a materially different approach, or report a real blocker.
- Max 3 review→fix rounds per finding set; then report remaining items as open rather than looping.
- Done = all AC met, no open blocking findings, checks green (or unrunnable ones stated). Optional improvements may be left and listed.

## Interaction

One grilling session up front, autonomous middle, one consolidated final report (AC status, files changed, findings + disposition, checks run vs not run, limitations). Interrupt only for: unresolvable product decisions, irreversible/destructive actions or external side effects (prod deploys, `supabase` migrations against real data, pushes), conflicting requirements, missing credentials, or anything that would weaken a security safeguard. Ask one concise question with alternatives and consequences. Never fabricate results or bypass permission prompts.
