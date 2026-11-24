# ADR-0006: Design language: monochrome brand, computed contrast, one UI vocabulary

- **Status:** accepted
- **Date:** recorded 2026-11-24 (decision predates the record)
- **Source:** former `CONTEXT.md` §5
- **Supersedes / superseded by:** none

## Decision and rationale

**Binding:** the monochrome brand, computed (never eyeballed) contrast, and using the `ui.tsx` vocabulary instead of per-screen styling. Specific colours, tokens and component details below are context; follow the current code and `DESIGN.md` where they differ.

The brand is monochrome: `#1E1E1E` text, `#FFFFFF` background, `#919396` grey.
(Note: the logo SVG's grey is `#919396`; a transposed `#919936` — olive green —
has been mistyped before. The grey is correct.)

Two rounds of feedback shaped the current UI:

1. **"The design looks old fashioned, I want modern SaaS."** Two causes were
   found: the entire UI palette had been derived literally from the three brand
   colors, producing a dead flat grey; and the redesign had only been
   *half-applied* — 8 screens still used the old classes, so part of what was
   being judged was the old design. Tokens were retuned (real ink scale, clean
   status colors, tighter tracking, softer shadows) and the redesign completed.
2. Brand grey is for brand moments, **not UI borders**.

**Contrast is computed, never eyeballed.** White on brand grey is 3.08:1 — it
fails WCAG AA for body text and is only safe at ≥24px. Dark on grey is 5.41:1
and passes. `--color-ink-500` (5.01:1) is the lightest token allowed for text;
`ink-400` is never text.

`web/src/components/ui.tsx` is the shared control vocabulary — `Page`, `Card`,
`Button`, `Badge`, `Field`, `Select`, `ConfirmAction`, `EmptyState`, and so on.
Use it rather than restyling per screen. Notable rules baked in:
- Every interactive element clears a 44px tap target. The primary user is
  holding a phone next to a car.
- `Badge` is read-only and never wired to an action. The old UI used one element
  as both the "Active" label and the deactivate control — that is how a manager
  locks a worker out mid-shift by tapping what looks like a label.
- `ConfirmAction` is the single destructive pattern; nothing destructive fires
  on first tap.
- `Select` disables the native arrow and draws its own chevron. Sharing
  `fieldClass` between inputs and selects leaves the OS arrow misplaced and lets
  long option text slide under it.
