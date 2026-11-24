# ADR-0003: OCR on Cloudflare Workers AI; OCR is an accelerator, never a dependency

- **Status:** accepted
- **Date:** recorded 2026-11-24 (decision predates the record)
- **Source:** former `CONTEXT.md` §5
- **Supersedes / superseded by:** none

## Decision and rationale

Originally Gemini 2.5 Flash. It broke **twice in one session** in production:
first `gemini-2.5-flash` became unavailable to new users (404), then the
thinking-budget parameter moved between API versions (`thinkingBudget` is
2.5-series; 3.x uses `thinkingLevel`). Migrated to Workers AI
(`@cf/moondream/moondream3.1-9B-A2B`, task=query, 10,000 neurons/day free).

Two wins beyond stability: it removed the last external API key from the
system, and it put OCR on the same platform as the rest of the infrastructure.

**OCR is an accelerator, never a dependency.** Every failure path — network,
quota, unreadable photo — resolves to a null result and the worker types the
value manually. The client deliberately swallows `/ocr` errors. A consequence
worth knowing: *when OCR silently stops working, nothing visibly breaks*, which
is exactly how the Gemini 404 went unnoticed. Check `wrangler tail` when
autofill "just stops".

`worker/src/ocr.ts` keeps its answer parsing in a **pure, unit-tested**
`parseOcrAnswer(raw, kind)` so the fiddly text-recovery logic is testable
without calling a model.
