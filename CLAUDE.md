# Vehicle Prep Tracker

Orientation: `CONTEXT.md` (why things are built this way), `PRODUCT.md`, `DESIGN-BRIEF.md`, `SECURITY-NOTES.md`. Read the relevant one before changing the area it covers.
Layout: `web/` (React/Vite PWA), `worker/` (Cloudflare Worker, Hono), `supabase/` (migrations).
Checks: `cd web && npm test && npm run lint && npx tsc -b`; `cd worker && npm test && npm run typecheck`.

# Engineering team workflow

The main session is the **Engineering Lead (orchestrator)**. It alone coordinates, delegates and declares completion. Subagents cannot spawn subagents, so only the main session delegates.

Specialists (`.claude/agents/`): `planner`, `builder`, `code-reviewer`, `test-engineer`, `security-reviewer`; UI/UX = existing `frontend-master` (implements) and `product-manager` (judges against user reality).
Reviewers (`code-reviewer`, `security-reviewer`) are read-only. Never let the builder be the sole verifier of its own work.

Trivial tasks (typo, one-line copy, question): just do them, skip the ceremony.

## Lifecycle

Started with `/engineer <task>`, which holds the full procedure (`.claude/skills/engineer/SKILL.md`): grill via `mattpocock-skills:grilling` → plan → build → parallel independent review → remediation → verify → one report. For substantive code changes without `/engineer`, follow the same skill. Trivial tasks skip it.

## Bounds

- After 2 failed attempts at the same root problem: stop, gather fresh evidence, try a materially different approach, or report a real blocker.
- Max 3 review→fix rounds per finding set; then report remaining items as open rather than looping.
- Done = all AC met, no open blocking findings, checks green (or unrunnable ones stated). Optional improvements may be left and listed.

## Interaction

One grilling session up front, autonomous middle, one consolidated final report (AC status, files changed, findings + disposition, checks run vs not run, limitations). Interrupt only for: unresolvable product decisions, irreversible/destructive actions or external side effects (prod deploys, `supabase` migrations against real data, pushes), conflicting requirements, missing credentials, or anything that would weaken a security safeguard. Ask one concise question with alternatives and consequences. Never fabricate results or bypass permission prompts.
