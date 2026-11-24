# ADR-0005: Registration is invite-only

- **Status:** accepted
- **Date:** recorded 2026-11-24 (decision predates the record)
- **Source:** former `CONTEXT.md` §5
- **Supersedes / superseded by:** none

## Decision and rationale

There is no public sign-up. An admin invites by email via `POST /invite`, which
verifies the caller is an active admin *using their own JWT* before touching the
service-role key, then sends the Supabase auth invitation and pre-creates the
profile row. The invitee lands on `/welcome` and chooses a password.
