# ADR-0001: The database (RLS) is the authorization layer

- **Status:** accepted
- **Date:** recorded 2026-11-24 (decision predates the record)
- **Source:** former `CONTEXT.md` §2 (now architecture/overview.md)
- **Supersedes / superseded by:** none

## Decision and rationale

**The load-bearing idea: the database is the authorization layer.** Row Level
Security policies in Postgres decide what every role can see and do. The
frontend talks to Supabase directly; there is no REST API of our own to
maintain, and no application-layer permission checks to keep in sync with the
database. A missing UI guard is a cosmetic bug, not a security hole.

Consequence for every change: new data access gets an RLS policy or a `security definer` RPC; the Worker forwards the caller's JWT instead of re-implementing checks. See [overview §2](../architecture/overview.md).
