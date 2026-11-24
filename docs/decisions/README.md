# Decision records (ADRs)

One file per decision: why the system is the way it is. Agents read the relevant ADR before changing that area.

## Status rules

- **accepted**: binding. Don't contradict it in code. If a task needs to, stop and propose a new ADR that supersedes it (status `proposed`) and get the user's yes first.
- **proposed**: context only, not binding until the user accepts it.
- **superseded**: history only. Follow the ADR that replaced it. Never enforce a superseded ADR.

Only the **decision** binds. Numbers, limits and implementation notes inside an ADR are context: if the code has moved on, update the note, don't revert the code. ADRs carried over verbatim from the old `CONTEXT.md` (0006, 0007) say which part is binding at the top.

An ADR that no longer matches the code is a bug: mark it superseded (or fix the code) rather than silently working around it.

## Writing one

Copy [`TEMPLATE.md`](TEMPLATE.md), take the next number, keep it under ~60 lines, add it to the index below. Per-migration behaviour belongs in [`data-model.md`](../architecture/data-model.md); an ADR is for choices with alternatives.

## Index

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-database-is-the-authorization-layer.md) | The database (RLS) is the authorization layer | accepted |
| [0002](0002-rejected-alternatives.md) | Rejected platform alternatives (do not re-propose) | accepted |
| [0003](0003-ocr-on-workers-ai.md) | OCR on Cloudflare Workers AI; OCR is an accelerator, never a dependency | accepted |
| [0004](0004-asymmetric-jwt.md) | Auth uses asymmetric JWTs (ES256 via JWKS) | accepted |
| [0005](0005-invite-only-registration.md) | Registration is invite-only | accepted |
| [0006](0006-design-language.md) | Design language: monochrome brand, computed contrast, one UI vocabulary | accepted |
| [0007](0007-offline-queue-deferred-video.md) | Offline queue with a deferred, resumable condition video | accepted |
| [0008](0008-site-scoping-default.md) | Site-aware screens open on the user's own site | accepted |
