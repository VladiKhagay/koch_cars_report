# ADR-0002: Rejected platform alternatives (do not re-propose)

- **Status:** accepted
- **Date:** recorded 2026-11-24 (decision predates the record)
- **Source:** former `CONTEXT.md` §5
- **Supersedes / superseded by:** none

## Decision and rationale

| Rejected | Why |
|---|---|
| Parsing WhatsApp | Official Business API is paid and cannot read an existing group. Unofficial bridges violate ToS and break silently — the worst possible property for an unattended system. |
| Google Sheets as the database | No row-level security for 20 users, no photo handling, write races, API quotas. Fine as an export *target*; wrong as a system of record. |
| Airtable | Free tier caps at 1,000 records/base — exceeded in ~10 days. |
| Self-hosted NocoDB / Pocketbase | Adds a VPS to babysit, and the worker UX still needs a custom form. |
| Native app | App-store accounts, review delays, two codebases. No benefit over a PWA here. |
| Firebase | NoSQL makes the reporting and Excel export harder, which is the whole point. |
| Supabase Storage for photos | 1 GB free < the ~6 GB rolling photo window. R2 gives 10 GB + free egress + native lifecycle expiry. |
