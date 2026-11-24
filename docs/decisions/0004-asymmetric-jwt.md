# ADR-0004: Auth uses asymmetric JWTs (ES256 via JWKS)

- **Status:** accepted
- **Date:** recorded 2026-11-24 (decision predates the record)
- **Source:** former `CONTEXT.md` §5
- **Supersedes / superseded by:** none

## Decision and rationale

The Supabase project uses **JWT Signing Keys (ES256)**, not the legacy HS256
shared secret. The Worker therefore verifies against the public JWKS endpoint
and stores **no** `SUPABASE_JWT_SECRET`. If a project only has a "Legacy JWT
Secret" and no signing key, this Worker's auth will not validate — visiting the
dashboard's JWT Keys page once provisions one; no code change needed.
