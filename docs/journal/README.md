# Journal

One entry per task **shipped to prod**, written in the `/engineer` Compound phase. The point is not the record itself: each lesson either becomes something that prevents the mistake next time, or is explicitly marked as not worth it.

- `YYYY-MM-DD-<slug>.md`: one per shipped task (template below).
- `LESSONS.md`: the distilled, deduplicated list. Read it before planning.
- `archive/`: task briefs and plans written before the journal existed (and the working brief of a task in progress, `archive/<slug>.md`, until it ships).

## Promotion order (prefer the top)

1. **check**: a test, lint rule, CI step, hook or `verify_00NN.sql`. A check holds where prose drifts.
2. **rule**: a line in `.claude/rules/<area>.md` (or `CLAUDE.md` if it truly applies everywhere).
3. **ADR**: a decision with alternatives → `docs/decisions/`.
4. **none**: one-off; say why.

## Consolidation

Every ~10 entries (or when `LESSONS.md` passes ~60 lines): merge duplicates, drop lessons that are now enforced by a check, mark ADRs that no longer match the code `superseded`.

## Entry template

```markdown
# <task title>

- **Shipped:** YYYY-MM-DD · PR / commit: <link or sha> · Migration: <00NN or none>
- **Brief:** docs/journal/archive/<slug>.md (if any)

## Goal and AC
Goal in one line. AC-1 … with status (verified / unverified + why).

## What happened
Surprises, wrong turns, rework, anything the next task should know. Short.

## Review findings
Blocking findings and how each was resolved (one line each).

## Lessons
| Lesson | Promoted to | Where |
|---|---|---|
| … | check / rule / ADR / none (why) | file path |
```
