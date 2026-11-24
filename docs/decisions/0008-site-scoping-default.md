# ADR-0008: Site-aware screens open on the user's own site

- **Status:** accepted
- **Date:** recorded 2026-11-24 (decision predates the record)
- **Source:** former `CONTEXT.md` §5
- **Supersedes / superseded by:** none

## Decision and rationale

Every role opens site-aware screens on **their own site**. Admins previously
landed on whichever site sorted first alphabetically. `web/src/lib/useSiteScope.ts`
centralizes this: admins may switch sites, managers and workers are pinned (RLS
would reject anything else anyway, so no picker is offered). A switching admin
opens on their remembered pick or home site only while it is enabled; a
disabled site (0041) is skipped for the starting site but still listed.
