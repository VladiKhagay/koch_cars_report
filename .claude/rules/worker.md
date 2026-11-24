---
paths:
  - "worker/**"
  - "car-prep-tracker/worker/**"
---

# Worker (Cloudflare Worker, Hono) rules

Loaded when touching `worker/`. Background: [ADR-0001](../../docs/decisions/0001-database-is-the-authorization-layer.md), [ADR-0004](../../docs/decisions/0004-asymmetric-jwt.md), [ADR-0005](../../docs/decisions/0005-invite-only-registration.md), [SECURITY-NOTES](../../docs/security/SECURITY-NOTES.md).

- **Auth flows are invite-only by default.** Reset password, magic link, invite, sign-up: limit to invited, active users, checked server-side in the Worker, not only in the UI.
- **Never trigger Supabase auth emails for arbitrary addresses.** Verify the user exists and is active before calling any auth email API.
- Every endpoint verifies the caller's Supabase JWT (JWKS, ES256). No `SUPABASE_JWT_SECRET`.
- Storage endpoints forward the **caller's own JWT** to Supabase so R2 access inherits RLS (`can_write_photo`, `can_view_photo`). Don't re-implement permission checks in the Worker.
- The service-role key lives only in `src/invite.ts`, reachable only after verifying an active admin. Don't add a second use.
- Content types are sniffed/pinned server-side, never echoed from the client.
- New routes get a rate limiter (see `UPLOAD_LIMITER`, `VIDEO_START_LIMITER`).
- `ALLOWED_ORIGINS` is pinned to the app origin, never `*`.
- Keep parsing logic pure and unit-tested (pattern: `parseOcrAnswer`).
- A change here also gets `security-reviewer` in `/engineer`.
