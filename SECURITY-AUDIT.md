# Security Audit — Vehicle Prep Tracker

**Date:** 2026-08-16
**Scope:** `worker/` (Cloudflare Worker), `web/` (React SPA on Workers static assets), `supabase/migrations/` (schema + RLS), `.github/workflows/`
**Method:** static review of the repository as the source of truth, plus two live checks against the deployed Supabase project (JWKS algorithms, anon-key format).

**Status:** audit complete. Remediation in progress — see [§10](#10-remediation-plan) for the working checklist.

---

## Contents

1. [Executive Summary](#1-executive-summary)
2. [Critical / High Findings](#2-critical--high-findings)
3. [Medium / Low Findings](#3-medium--low-findings)
4. [File Upload Security](#4-file-upload-security)
5. [SQL Injection Analysis](#5-sql-injection-analysis)
6. [Cloudflare-Specific Security Review](#6-cloudflare-specific-security-review)
7. [Authentication & Authorization Review](#7-authentication--authorization-review)
8. [Other Production Security Issues](#8-other-production-security-issues)
9. [Recommended Fixes](#9-recommended-fixes)
10. [Remediation Plan](#10-remediation-plan)
11. [Production Security Checklist](#11-production-security-checklist)
12. [Change Log](#12-change-log)

---

## 1. Executive Summary

### Architecture as built

- **Frontend** — React SPA (`web/`), deployed as a Cloudflare **Workers static-assets** project (`koch-cars-report`), *not* Pages. Talks directly to Supabase PostgREST with the caller's own JWT.
- **Worker** (`worker/`) — Hono app, 5 routes: `/health`, `/ocr`, `/upload`, `/photo/:jobId/:kind`, `/invite`. Bindings: R2 (`PHOTOS`), Workers AI.
- **Data** — Supabase Postgres. **All** authorization is RLS + `security definer` RPCs. The Worker deliberately does not reimplement authz: for `/upload` and `/photo` it forwards the caller's JWT to PostgREST and asks "can you see this job?"
- **Photos** — private R2 bucket, keyed `${jobId}/${kind}.jpg`, 90-day lifecycle rule, served only through the Worker.

### Verdict

**Better than most applications at this stage.** The database layer has clearly been through several rounds of adversarial thinking — migrations 0003, 0005 §7, 0006 and 0007 each identify and close a real privilege gap, and each explains *why the obvious fix wouldn't have worked*. The instinct to delegate authorization to RLS rather than reimplement it at the edge is correct, and it is the reason `/upload`, `/photo` and `/invite` are all safe.

**There is no SQL injection anywhere in this codebase, and no committed secret.**

The findings cluster almost entirely where that delegation *didn't* apply: `/ocr` (the one endpoint with no downstream database call, and therefore no borrowed authorization) and the edge/platform configuration (where there is no RLS to delegate to). That is a coherent, fixable pattern rather than scattered weakness.

Residual risk after the audit:

1. **Deactivating a user does not end their Supabase session** — the app-level `active` flag never reaches `auth.users`, so refresh tokens keep working indefinitely.
2. **Uploads are never validated as images**, and the client's re-encode — which normally launders the bytes — is bypassable by design.
3. **No security headers, no rate limiting**, and no WAF is even *possible* on a `workers.dev` hostname.

Nothing here is a data-breach-class finding. The realistic worst case is **cost abuse and abuse-of-service**, plus a stale-session window on offboarding.

---

## 2. Critical / High Findings

### ~~H-1 — `/ocr` performs no authorization, only signature verification~~ — RESOLVED

**Original severity: High. Now closed.**
**Location:** `worker/src/index.ts:52-61`, `worker/src/ocr.ts:220`

**The finding as raised.** `requireAuth` is `jwk({ jwks_uri: <project JWKS>, alg: ['ES256'] })`. It proves *this Supabase project signed this token* and that it hasn't expired — no `aud`, no `iss`, no `role` check. Unlike every other route, `handleOcr` never asks Supabase who the caller is, because it has no downstream PostgREST call to inherit authorization from. Behind that gate sits an unmetered `env.AI.run()` accepting a 6 MB base64 image, billed to the Worker's own Workers AI account.

Two conditions had to hold for a stranger to reach it. **Both were checked and both are false:**

| Condition | Status |
|---|---|
| Supabase public signup enabled (attacker self-registers → real ES256 token) | **Disabled** at the platform level. |
| The published anon key satisfying `jwk()` | **Cannot.** Anon key is `alg: HS256` (legacy shared secret). Middleware is pinned `ES256`, and the project JWKS advertises **ES256 only**. |

Incidental confirmation from the same check: the JWKS is live and serving ES256, so the project **has** provisioned an asymmetric signing key. That is exactly the condition `worker/wrangler.toml:31-40` warns about — user access tokens are ES256 and the Worker's auth genuinely works.

**What remains of it.** H-1 does not stand as an independent finding. Its residue decomposes into two findings already tracked:

- legitimate users can call `/ocr` unmetered → **M-5** (no rate limiting)
- *deactivated* users can too → **H-2**

**Knock-on effect: H-2 becomes more important, not less.** It was one of two routes into `/ocr`; it is now the only one.

---

### H-2 — Deactivating a user does not revoke their session

**Severity: High** · **Status: FIXED (2026-08-16)** · **Fix required before production: yes**

> **Fix, in two layers.**
>
> **1. Every Worker route now requires an active app user.** `getActiveAppUser()` (`worker/src/appUser.ts`) resolves the caller to an active `public.users` row. This closed the exposure that mattered: `/ocr` was the one route reaching no Postgres query and therefore inheriting no `active` filter from RLS, so a deactivated account's auto-refreshing token could run the vision model indefinitely. `/upload` gained the same property via `can_write_job` (M-3); `/invite` was refactored onto the shared helper, removing a duplicated check and two dead helpers.
>
> **2. Deactivation now revokes the identity itself** (decision D-1, resolved: revoke). New route `POST /user-active` (`worker/src/userActive.ts`) calls `set_user_active` with the **caller's own JWT** and then bans the auth account with the service-role key.
>
> Authorization is not reimplemented at the edge. Who may deactivate whom is still decided entirely by `set_user_active` (0004) — admins may act on anyone but themselves, managers only on workers at their own site. The auth account is touched only if Postgres allowed the change first, so the endpoint cannot become a way around that rule. Ordering is deliberate: the RPC is both the gate and the source of truth, and if the ban then fails the user is already locked out of everything that reads the database. Banning first would risk banning someone the caller was never permitted to touch.
>
> The frontend no longer calls `set_user_active` directly from anywhere — `Users.tsx` and `Team.tsx` both go through `setUserActive()` in `lib/workerApi.ts`. A partial success (profile updated, session not revoked) surfaces as a visible error rather than silence, because that gap is precisely what this finding is about.
**Location:** `supabase/migrations/0004_user_mgmt_services_softdelete_stats.sql` (`set_user_active`), `web/src/components/ProtectedRoute.tsx:11`, all Worker routes

**Vulnerability.** `active` lives on `public.users`. Nothing touches `auth.users`. A deactivated employee's access token stays valid until expiry, and — critically — their **refresh token keeps working forever**, so `autoRefreshToken: true` (`web/src/lib/supabase.ts`) mints them fresh access tokens indefinitely.

**Why it's a problem.** Offboarding is the one authorization decision that must take effect immediately, and here it doesn't fully. The RLS side is fine: `current_app_user()` filters `active = true`, so every policy and every RPC fails closed, and `/upload`, `/photo` and `/invite` all inherit that. But the *identity* survives.

**Realistic exploitation.** A fired detailer keeps the PWA installed. `ProtectedRoute` bounces them to `/login` and all data reads return empty — the UI correctly looks locked. But the token is still real, so `POST /ocr` keeps working, forever, on your Workers AI budget. Any endpoint added later that trusts `jwk()` without an `active` check is retroactively exposed to every person ever deactivated.

**Recommended fix.** Extend deactivation to the auth account. `set_user_active` is `security definer` but cannot reach the Admin API from SQL, so the clean version routes deactivation through the Worker (which already holds the service-role key for `/invite`) and calls `PUT /auth/v1/admin/users/{id}` with `ban_duration`, alongside the existing RPC.

> **Note on the cheap version.** The report originally offered "just check `active` in every Worker route" as an 80% fix. With H-1 closed, that check is now the *only* control standing between a deactivated account and `/ocr` — so take the real fix (revoke at `auth.users`) rather than the shortcut. Do both if convenient; the route-level check is good defence in depth.

---

## 3. Medium / Low Findings

### M-1 — Uploads are never validated as images

**Severity: Medium** · **Status: FIXED (2026-08-16)** · Full detail in [§4](#4-file-upload-security)

> **Fix.** `sniffImageType()` in `worker/src/upload.ts` now derives the content type from the body's own magic bytes and rejects anything that is not JPEG, PNG, WebP or HEIC (415). The cap dropped 20MB → 8MB, mirrored client-side as `MAX_UPLOAD_BYTES` in `web/src/lib/image.ts`. Covered by `worker/src/upload.test.ts`.
>
> **Deviation from the original recommendation, deliberate.** The audit said "check `FF D8 FF`, reject otherwise." That would have been a functional regression: `PhotoCapture` falls back to uploading the *original* file when canvas downscaling throws, and on iOS that original can still be HEIC — so a JPEG-only rule rejects real photos on exactly the path the fallback exists to serve. An allowlist of image signatures closes the actual hole (arbitrary non-image bytes stored under an image content type) without that cost. SVG is excluded on purpose: it is a script-bearing document, not an image.
>
> The client-side guard turned out to matter more than "fail fast on a slow connection": an oversized file produced a 413, which threw in `submitJob` and pushed the payload into the offline retry queue, where it would retry on every reconnect **forever** without ever succeeding. It is now refused on the phone with a translated message (`newJob.photoTooLarge`, all three locales).

`worker/src/upload.ts:52-69` accepts any `ArrayBuffer` ≤ 20 MB and stores it with a *pinned* `image/jpeg` content type. No magic-byte check. The client's `accept="image/*"` is a picker hint, not a control, and `PhotoCapture.tsx:70-75` explicitly **falls back to uploading the original unmodified file** when `downscaleImage` throws:

```ts
try   { onCapture(await downscaleImage(file)); }
catch { onCapture(file); }   // ← original bytes, unmodified
```

The fallback is well-motivated (real WebKit `createImageBitmap` quirks) but it means: pick any file the browser can't decode → the raw bytes upload → the server stores them as `image/jpeg`.

### M-2 — No security headers on either origin

**Severity: Medium** · **Status: FIXED (2026-08-16)**
**Location:** `web/wrangler.toml` (no `public/_headers`), `worker/src/photo.ts:33-38`

> **Fix.** A `securityHeaders()` Vite plugin (`web/vite.config.ts`) emits `_headers` into `dist` with CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS and `Permissions-Policy`. `/photo` responses gained `nosniff`, a fixed `Content-Disposition`, and `default-src 'none'; sandbox`.
>
> **Generated, not committed to `public/`.** `connect-src` has to name the Supabase and Worker origins, which are build-time env vars; a static file would drift silently the moment either moved, and that failure mode is total (the app stops reaching its backend). The project already generates shell config this way — see the `brand-theme-color` plugin — so this follows the existing convention. Missing vars warn and omit rather than throw, because the CI build job runs without the deploy secrets and an app built without them cannot boot anyway.
>
> `script-src` is strict `'self'` — verified against the built `index.html`, which has no inline scripts. `style-src` needs `'unsafe-inline'` for React `style={{}}` attributes; the directive that matters for a localStorage-token app is `script-src`, and it is clean.
>
> The `sandbox` CSP on `/photo` cannot break the in-app viewer: photos are read with `fetch()` → `blob()` → `createObjectURL`, which drops response headers. It applies only on direct navigation to a photo URL — the case it exists to contain.

Neither origin sends CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`/`frame-ancestors`, or HSTS.

The app itself is low-XSS-risk — React throughout, zero `dangerouslySetInnerHTML`, zero `innerHTML`. (`escapeValue: false` in `i18n.ts:49` is the standard react-i18next setting and is safe, because JSX escapes at render.) But:

- Supabase stores the session in **localStorage** (`persistSession: true`), so any XSS is a full account takeover. CSP is the compensating control and it is absent.
- `/photo` returns attacker-influenceable bytes (M-1) with no `nosniff`. Pinning the content type to `image/jpeg` is the right call and blocks modern sniffing; `nosniff` closes the door properly and `Content-Disposition: attachment` closes it twice.
- No `frame-ancestors` → the app is clickjackable.

### M-3 — Workers can overwrite photo evidence after the edit lock expires

**Severity: Medium** · **Status: FIXED IN CODE (2026-08-16) — requires migration 0009 to be applied**
**Location:** `worker/src/upload.ts:38-50` vs `supabase/migrations/0001_init.sql` (`jobs_select` / `jobs_update` / `photos_insert`)

> **Fix.** New migration `0009_can_write_job.sql` adds a `security definer` function `can_write_job(uuid)` mirroring the `photos_insert` policy exactly. `/upload` now calls that RPC instead of probing whether the job is *visible*.
>
> This needed no new architecture: asking Postgres one permission question without handing over the row is the pattern `find_recent_duplicate` already established in 0003. That is why the "role at the edge" decision flagged in §9 did not need to be made — no JWT claims, no KV, no new binding.
>
> It mirrors `photos_insert` rather than `jobs_update` because `/upload` is the R2 half of precisely the operation that policy governs, and the two drifting apart *is* the bug. In particular the worker branch checks `locked_at` but not `deleted_at`, because `photos_insert` does not either — a manager restoring a soft-deleted job is a supported flow and must not be blocked here on a rule the database does not itself apply.
>
> ⚠️ **Deployment ordering is load-bearing.** The Worker calls an RPC that does not exist until 0009 is applied. Deploying the Worker first makes every photo upload fail closed (403). **Apply 0009 before deploying the Worker.**

The `/upload` authorization check is *"can the caller **SELECT** this job?"* But the 15-minute `locked_at` window is expressed on **UPDATE** — `jobs_update` and `photos_insert` both require `locked_at > now()` for the worker role, while `jobs_select` (as tightened in 0003) lets a worker read their own jobs forever.

A worker can therefore `POST /upload?jobId=<their own 3-week-old job>&kind=plate` and silently replace the R2 object. The `photos` row insert would be blocked, but the row already exists and the viewer fetches by `jobId/kind` — so the substituted image is what everyone sees. The lock exists to freeze the record; the photograph is the evidence backing it, and it isn't frozen.

### M-4 — `workers.dev` hostnames cannot be protected by WAF or Rate Limiting Rules

**Severity: Medium** · **Status: ACCEPTED AS RESIDUAL RISK (2026-08-17)** — Cloudflare-specific, see [§6](#6-cloudflare-specific-security-review)

Both `ALLOWED_ORIGINS` and `APP_URL` point at `*.workers.dev`. Cloudflare's WAF, Rate Limiting Rules, Bot Management and custom firewall rules **only apply to traffic on a zone you control** — they do not run on `workers.dev` subdomains.

**Decision.** The owner has chosen not to purchase a custom domain. Recorded here rather than left as a permanently open checkbox, so the trade-off is legible to whoever reads this next.

**What that actually costs:**

| Lost | Retained |
|---|---|
| WAF custom rules | Standard L3/L4 + L7 DDoS protection (automatic on `workers.dev`) |
| Bot Management | TLS, HSTS (workers.dev is preload-listed by Cloudflare) |
| Cloudflare Access | Application-layer auth — the actual access control here |
| Edge Rate Limiting Rules | **In-Worker rate limiting** via the rate-limit binding (M-5) |

**The correction that matters.** The original write-up said "there is no layer where a rate limit *could* be configured." That was wrong about the available options: it is true only of the *WAF* layer. The Workers rate-limit binding executes inside the Worker, requires no zone, and addresses the threat that actually applies here — an authenticated caller burning Workers AI. M-5 is therefore still fixable and remains open rather than being blocked by this decision.

**Residual exposure after M-5 is implemented:** no protection against volumetric or distributed L7 abuse beyond Cloudflare's automatic DDoS handling, and no ability to block a specific bad actor at the edge. Given every route now requires an active, invited employee account, the population able to reach these endpoints at all is small and individually identifiable — which is what makes accepting this reasonable.

### M-5 — No rate limiting or abuse protection on any Worker route

**Severity: Medium** · **Status: FIXED (2026-08-17)**

> **Fix.** Two Workers rate-limit bindings, keyed on the JWT `sub`: `OCR_LIMITER` at 60/60s and `UPLOAD_LIMITER` at 120/60s (`worker/wrangler.toml`, applied via `worker/src/rateLimit.ts`). Deployed and confirmed bound in production.
>
> **Keyed on `sub`, not IP** — a yard shares one connection, so an IP key would put every worker on site in the same bucket and let one busy phone throttle their colleagues.
>
> **Checked before the Supabase lookup and before the request body is read**, so a flood costs neither a round-trip per request nor 8MB of ingest.
>
> **Limits sized from real use, not round numbers.** One job's capture flow costs 4 model runs (plate and VIN, each a detect then a read), so a busy worker stays well under 20/min even while retaking — 60 leaves ~3x headroom while cutting a runaway loop from thousands to a bounded trickle. The upload limit is sized for the *offline queue* rather than steady use: a phone flushing a 20-job backlog legitimately bursts ~100 requests, since each job uploads up to 5 photos in parallel.
>
> **Neither limit can lose data when it fires.** A 429 on OCR resolves to "type it in" (OCR is an accelerator by design); a 429 on upload leaves the job queued for retry.
>
> `/invite` and `/user-active` are deliberately unlimited — both admin-gated, and throttling an admin out of user management during an incident is the worse failure.
>
> **Verified in production:** both bindings present, all routes still 401 without a token, and 30 unauthenticated `/ocr` hits returned 401 and never 429 — the limiter sits behind auth, so an anonymous flood cannot consume a real user's quota. ⚠️ **The 429 path itself has not been exercised end-to-end**, which needs a valid session; the binding and code path are confirmed, the threshold behaviour is not.

`/ocr` (expensive AI), `/upload` (8 MB writes to R2) and `/invite` (sends email via Supabase's shared SMTP) all accept unlimited requests per caller. `/invite` is admin-gated so it is low-risk; `/ocr` and `/upload` are not.

**The exposed population has shrunk considerably** since this was written. H-1, H-2 and the active-user checks mean every one of these routes now requires a signature-valid token belonging to an *active, admin-invited* employee. This is no longer an internet-facing abuse surface; it is an insider or compromised-account surface, plus the risk of a buggy client looping.

**Fix — not blocked by the M-4 decision.** The Workers rate-limit binding runs inside the Worker and needs no zone:

```toml
[[ratelimits]]
name = "OCR_LIMITER"
namespace_id = "1001"

  [ratelimits.simple]
  limit = 60
  period = 60
```

```ts
const { success } = await c.env.OCR_LIMITER.limit({ key: sub });  // JWT sub
if (!success) return c.json({ error: 'rate_limited' }, 429);
```

Key on the JWT `sub` so the limit is per-user rather than per-IP — a yard behind one connection would otherwise share a bucket.

**Known limitations, stated so nobody over-trusts it.** Counters are local to each Cloudflare location and the system is documented as "permissive, eventually consistent". It is a cost-control guardrail against a runaway client or a single abusive account, not an accurate quota and not a defence against distributed abuse.

**Tooling prerequisite.** `[[ratelimits]]` requires wrangler ≥ 4.36; the project is on 3.114. Either upgrade (which also clears the L-7 dev-tree advisories) or use the legacy `[[unsafe.bindings]]` form with `type = "ratelimit"`, which works on wrangler 3.

### N-1 — Every `security definer` RPC is callable by the `anon` role

**Severity: Low** (no exploitable path found) · **Status: FIXED in migration 0010 — not yet applied**
**Found:** 2026-08-17, while verifying that migration 0009 had landed. Not present in the original audit.

**Vulnerability.** Since 0001, every RPC has ended with `revoke all on function f(…) from public; grant execute on function f(…) to authenticated;` — read by everyone since as "only signed-in users can call this". That is not what it does. Supabase ships default privileges granting `EXECUTE` on new public-schema functions to `anon`, `authenticated` and `service_role` *explicitly*. Revoking from the `PUBLIC` pseudo-role does not remove an explicit role grant, so all of them stayed callable with the published anon key, unauthenticated.

**Verified live against the project** with nothing but the anon key from the client bundle:

| Function | Anon result |
|---|---|
| `admin_lookup_auth_id` | 400 `forbidden` |
| `set_user_active` | 400 `forbidden` |
| `update_customer_report_config` | 400 `forbidden` |
| `can_write_job` | 200 `false` |
| `update_my_name` | **204 — executed** |

**Why it is only Low.** Nothing is exploitable. The first three are stopped by their own `current_app_user()` checks; `can_write_job` returns false because there is no app user in context. `update_my_name` genuinely executes, but filters on `auth_id = auth.uid()`, and `auth.uid()` is null for anon — `auth_id = null` matches no rows, so it is a no-op.

**Why it is worth fixing anyway.** `update_my_name` is safe by SQL's NULL semantics rather than by a decision — it is the one function with no authorization check of its own. And systemically the grant line is decorative across the whole schema, which means every RPC added from here on is unauthenticated-callable by default, and safe only if its author independently remembers an internal check. That is the same shape of latent trap as H-2.

**Fix (migration 0010).** Revoke `execute` from `anon` on all seven functions, change the schema default so future ones inherit it, and give `update_my_name` the explicit `auth.uid() is null` guard the others already have. No legitimate caller is affected — the frontend calls no RPC before sign-in; login and invite acceptance go through `supabase.auth`, not PostgREST.

### L-1 — CORS falls back to `*`

**Status: FIXED (2026-08-16).** `worker/src/index.ts:36-42`. `ALLOWED_ORIGINS` is set in `wrangler.toml`, so this was inert — but a typo or an unset var in a new environment silently opened it. The fallback is now `() => null` (deny) instead of `'*'`.

### L-2 — CSRF: not applicable, by construction

No cookies are used for authorization anywhere. Supabase tokens live in localStorage and are attached explicitly as `Authorization` headers. Nothing to fix — recorded so it isn't re-litigated.

### L-3 — `audit_log` entries are forgeable by the acting user

`audit_log_insert` (0001) correctly pins `user_id` to the caller, but `action` and `changes` are free-form client input written by `web/src/lib/audit.ts`. A worker can write a misleading audit entry for their own in-window job. Acceptable for an internal integrity log; not acceptable if this is ever treated as evidence.

### L-4 — Error message passthrough

`worker/src/index.ts:76` returns `err.message` for any non-401 `HTTPException`, and `invite.ts:67` forwards Supabase's `msg` verbatim. Low leakage in practice (Hono's messages are generic); the invite path can distinguish "email already registered" (422 → 409), but it is admin-only.

### L-5 — Password policy is enforced client-side only

`Welcome.tsx` requires ≥ 8 characters. Supabase's server-side minimum defaults to **6**, with no complexity or breach-check requirement. Set the minimum and enable leaked-password protection (HIBP) in the dashboard.

### L-6 — `jwk()` does not validate `iss` / `aud`

**Status: NOT FIXED — deliberately deferred, needs a live token to validate.**

Currently harmless: the JWKS URI is project-scoped, so only your project's keys are trusted. Worth pinning anyway as defence against a future multi-tenant or key-sharing mistake.

Hono 4.13 does support it — `jwk({ …, verification: { aud: 'authenticated' } })`. The valuable half is `aud`, which would reject any project-issued token that is not a signed-in user session (reinforcing the H-1 closure if the anon key ever became ES256). `iss` is awkward: `verification` is a static option evaluated at module scope and cannot read `c.env.SUPABASE_URL`, unlike `jwks_uri`, which accepts a function.

**Not shipped**, because it sits on the production auth path and there is no live user token available here to confirm the claim shape against. Supabase access tokens carry `aud: "authenticated"` in the normal case, but "almost certainly correct" is the wrong confidence level for a change whose failure mode is locking out every user. Apply it alongside a real sign-in test.

### L-7 — Dev-only dependency advisories

**Status: FIXED for the Worker (2026-08-17).**

`worker`: was 6 advisories (`undici`, `ws` via `miniflare`/`wrangler`). Cleared by the wrangler 3.114 → 4.123 upgrade done for M-5 — `npm audit` now reports **0 vulnerabilities**. The upgrade also required `@cloudflare/workers-types` 4 → 5; typecheck, all 37 tests and the deploy passed unchanged.

`web`: **0 production vulnerabilities**. The `nanoid` high advisory is dev-tree (Vite) only and remains.

### Informational — verified clean

- **Secrets.** No key material in the repo or in git history. `.env.test` holds deliberately fake, clearly-labelled values. `.gitignore` covers `.env*`. CI passes everything through GitHub Actions secrets. The anon key in the client bundle is by design and safe under RLS.
- **Dev gating.** `import.meta.env.DEV` around `/dev/photo` (`App.tsx:35`) is statically eliminated from production builds.
- **Service worker.** Caches the app shell only, explicitly not API responses (`vite.config.ts`) — no stale-authz cache risk.
- **XLSX export.** Uses `xlsx@0.20.3` **from the SheetJS CDN**, not the abandoned npm `0.18.5` — sidesteps CVE-2023-30533 and CVE-2024-22363. `aoa_to_sheet` writes strings as string cells, so there is **no CSV/formula-injection risk** in the `.xlsx` output.
- **SSRF.** None. Every outbound fetch targets `c.env.SUPABASE_URL` with a fixed path; no user-controlled URL reaches a fetch.
- **Path traversal.** None — see [§4](#4-file-upload-security).
- **Webhooks.** None exist.
- **Logging.** Clean. No token, password or PII logging; `console.error` calls log errors and HTTP statuses only.

---

## 4. File Upload Security

There is exactly one upload path: `PhotoCapture.tsx` → `downscaleImage()` → `uploadPhoto()` → `POST /upload` → R2. Nothing else writes to the bucket.

| Question | Answer as built |
|---|---|
| Accepted types | **Anything.** Client hints `accept="image/*"`; server accepts any bytes. |
| Validation basis | **Neither MIME nor extension nor content.** Server reads a raw `ArrayBuffer` and checks only length. The client-side `createImageBitmap` + canvas re-encode is a *de facto* content validation — but it is bypassable (M-1). |
| Max file size | **20 MB** server-side (`upload.ts:61`). **No client-side cap at all.** |
| Max files per entity | **5**, structurally: the `PHOTO_KINDS` allowlist plus the R2 key `${jobId}/${kind}.jpg` mean a 6th upload is impossible and a repeat overwrites. Mirrored by `photos_kind_check` (0005). Genuinely good design. |
| Enforced both sides | Size: server only. Count: server only (client caps extras at 3 via `MAX_EXTRA_PHOTOS`). |
| Bypassable? | **Yes** — M-1. |
| Storage | Private R2 `car-prep-photos`, no public bucket access, 90-day lifecycle. Reachable only via the Worker binding. |
| Executable / unsafely served? | Low risk. Content type is **pinned** to `image/jpeg` on write (`upload.ts:69`) with an explicit comment about why — correct, and it defeats the classic stored-HTML attack. Missing `nosniff`/`Content-Disposition` (M-2) leaves a thin residue. |
| Filenames | **Never trusted.** The key is derived entirely from `jobId` (validated against Supabase) + an allowlisted `kind`. R2 keys are flat strings, so `../` is inert regardless. **No path traversal.** |
| Resource consumption | 20 MB × unlimited requests, no rate limit (M-5). |
| Image processing risk | **None server-side** — the Worker never decodes an image. All decode/resize happens in the browser's own canvas, on the user's device. Materially safer than server-side ImageMagick/sharp, and worth keeping. |

### Recommended production limits

Based on what this app actually sends — a ~1920px q0.82 JPEG, typically 200–600 KB:

1. **Magic-byte check on the server.** Three bytes: `FF D8 FF`. Reject otherwise. Highest-value fix in this section, ~4 lines.
2. **Lower the cap to 8 MB.** The 20 MB comment justifies itself by "modern phones shoot 10–15 MB JPEGs" — but that only matters on the downscale-failure path, and a 15 MB phone JPEG is still a valid JPEG that passes the magic-byte check. 8 MB covers every real camera photo with room to spare.
3. **Add a client-side size guard** (~10 MB) so the fallback path fails fast on the phone instead of pushing 20 MB over a yard connection.
4. **Keep the 5-slot structural limit exactly as it is.**
5. Add `X-Content-Type-Options: nosniff` and `Content-Disposition: inline; filename="photo.jpg"` to `/photo` responses.

---

## 5. SQL Injection Analysis

**Result: no SQL injection. The database layer is the strongest part of this application.**

Every path was inspected explicitly rather than assumed safe:

- **Raw SQL / string concatenation:** none in application code. All access goes through `supabase-js`'s PostgREST builder (`.eq/.gte/.lte/.in/.is/.order/.range`), which parameterizes.
- **`security definer` functions** — `current_app_user`, `admin_lookup_auth_id`, `find_recent_duplicate`, `update_my_name`, `set_user_active`, `update_customer_report_config`, and both price triggers: all use plpgsql parameter binding. **Zero `EXECUTE`, zero `format()`, zero `||` string-building** (all three grepped for). Every one sets `search_path`, which is the other half of getting `security definer` right and is frequently missed.
- **Dynamic filters:** exactly one, `web/src/pages/Jobs.tsx:315`:
  ```ts
  q.or(`plate.ilike.%${term}%,vin.ilike.%${term}%,billing_code.ilike.%${term}%`)
  ```
  The one genuinely dangerous construct in the app — PostgREST's `or=` is a *grammar*, and injecting `,` `(` `.` `*` there rewrites the query. It is defended by `lib/search.ts`, an **allowlist** (`/[^\p{L}\p{N} -]/gu` stripped, 40-char cap), not an escape. Allowlisting was the correct choice and the reasoning is documented in the file. `-` and space survive but are inert inside an `ilike` pattern. **Not exploitable.**
- **Dynamic ORDER BY:** none. Every `.order()` takes a hardcoded literal.
- **IDs / path params:** `jobId` in `upload.ts`/`photo.ts` is `encodeURIComponent`'d into a PostgREST URL; a non-UUID yields a PostgREST 400 → `checkRes.ok === false` → 403. Correct fail-closed behaviour.
- **Admin inputs:** `Users.tsx`, `Sites.tsx`, `Services.tsx` all use the builder. The `invite.ts` email is regex-validated before use.
- **JSONB input:** `update_customer_report_config` validates both shape *and* a closed key allowlist server-side (0007).

> `jobs_apply_worker_price` (0005) and `services_guard_worker_price` (0006) deserve specific credit: they close column-level privilege gaps that RLS structurally cannot express, and 0006's header explains precisely why column grants wouldn't have worked. That is the correct analysis.

---

## 6. Cloudflare-Specific Security Review

**1. `workers.dev` means no WAF — the biggest platform-level gap.** Cloudflare's WAF, Rate Limiting Rules, Bot Fight Mode and firewall rules operate on zone traffic. `*.workers.dev` is not your zone, so **none of them apply**. Today there is nowhere to configure a rate limit even if you wanted one. Moving both the Worker and the frontend to a custom domain is the prerequisite for most of §3's mitigations — and then set `workers_dev = false`, so the bare `workers.dev` hostname stops serving as an unprotected bypass around whatever you configure on the custom domain. **Highest-leverage infrastructure change available.**

**2. Static assets have no header mechanism configured.** `web/wrangler.toml` uses `[assets]` with `not_found_handling = "single-page-application"` — correct for the SPA — but there is no `public/_headers`. Workers static assets supports that file; it is simply absent.

**3. R2 bucket exposure — verify in the dashboard.** The code path is airtight (binding only, no signed URLs, no public base URL). What the repo cannot tell me is whether the bucket has an **r2.dev public development URL** enabled or a public custom domain attached. If either is on, every photo is world-readable by key and the entire `/photo` authorization chain is moot. Keys are somewhat guessable (`<uuid>/plate.jpg`), so this is worth one minute in the dashboard. **Same check for `car-prep-backups`** — that one holds a full `pg_dump` of the entire database, a far worse exposure than any photo.

**4. Secrets handling is correct.** Service-role key is a Worker secret, used in exactly one admin-gated handler, never returned to a client. `wrangler.toml` documents secrets rather than containing them. JWKS-based verification (no shared JWT secret at the edge) is the modern, rotation-safe approach and a genuinely good call.

**5. Backups.** The nightly `pg_dump` → R2 workflow is sensible, and separating `car-prep-backups` from the 90-day-lifecycle photo bucket shows the right instinct. Two gaps: the dump is **gzipped but not encrypted** beyond R2's own at-rest encryption, and `CLOUDFLARE_API_TOKEN` is shared between deploy and backup jobs — scope-separate tokens would limit blast radius.

**6. Observability.** No `[observability]` block in either `wrangler.toml`, so Workers Logs are off. There is currently no way to detect the abuse described in M-5.

**7. `compatibility_date = "2024-12-01"`** is ~20 months stale on both projects. Not a vulnerability, but you are missing runtime fixes.

---

## 7. Authentication & Authorization Review

### Authentication

Supabase email/password. No self-signup path in the app — accounts originate from the admin-gated `/invite` flow, and `Welcome.tsx` completes registration from the emailed one-time hash token. Public signup is **disabled at the platform level**. Session in localStorage with auto-refresh.

**Gaps:** password policy is client-side only (L-5); no MFA (acceptable for this user population).

### Authorization model

Three roles (`worker` / `manager` / `admin`) on `public.users`, enforced in Postgres. The critical property — and it holds — is that **the frontend's role checks are a UX layer, not the security boundary.** `ProtectedRoute` and `navItemsFor` only decide what is rendered; RLS decides what is returned.

Escalation paths checked specifically:

| Path | Result |
|---|---|
| Worker reads others' jobs | **Blocked.** After 0003, `jobs_select` restricts workers to `u.id = jobs.worker_id`, so `billing_code` and `manager_note` are unreachable, not merely un-rendered. The one legitimate cross-worker read (duplicate VIN) went into a `security definer` function returning a bare id. |
| Worker promotes self | **Impossible.** `users_write` is admin-only, no self-UPDATE policy exists, and renaming goes through `update_my_name`, which touches only `name`. |
| Worker sets own pay | **Blocked** by the `jobs_apply_worker_price` trigger (worker writes to `worker_price` are overwritten with the catalog price). |
| Manager sets catalog pay | **Blocked** by `services_guard_worker_price` (0006). |
| Manager deactivates a peer/admin | **Blocked.** `set_user_active` allows managers only `target.role = 'worker'` at their own site, and nobody can lock themselves out. |
| Cross-site access | **Blocked.** Every policy joins on `u.site_id = <row>.site_id` for managers/workers. `useSiteScope` only offers a picker to admins, and RLS backs that up. |
| Log a job in someone else's name | **Blocked.** `jobs_insert` requires `u.id = jobs.worker_id`. |

### IDOR

**None found.** Both direct-object endpoints (`/upload`, `/photo`) re-derive authorization from the database per request; neither trusts a client-supplied identifier. `JobDetail` fetches by `:id` but through RLS-gated PostgREST.

### Remaining weaknesses

**H-2** (deactivation doesn't reach `auth.users`) and **M-3** (`/upload` checks read permission where it means write permission).

---

## 8. Other Production Security Issues

- **XSS:** low exposure. React throughout, no HTML injection sinks anywhere in `web/src`. The absent CSP (M-2) is the gap, and it matters *because* tokens are in localStorage.
- **Admin endpoints:** `/invite` is properly gated — it re-checks `role = 'admin' AND active` against the database using the caller's own JWT *before* touching the service-role key. That ordering is correct.
- **Error handling:** the `onError` handler in `index.ts` is well-reasoned (the comment explains a real bug it fixed). Minor passthrough noted in L-4.
- **Input validation:** good at the trust boundaries — email regex and role allowlist in `invite.ts`, `PHOTO_KINDS` allowlist, `searchTerm` allowlist, JSONB key allowlist in 0007.
- **Debug/dev settings:** clean.

---

## 9. Recommended Fixes

| # | Fix | Files | Effort |
|---|---|---|---|
| 1 | Ban/log-out the auth account when `set_user_active(false)` — **H-2** | new Worker route + `Users.tsx`/`Team.tsx` | ~40 lines |
| 2 | Magic-byte (`FF D8 FF`) check + lower cap to 8 MB — **M-1** | `worker/src/upload.ts` | ~5 lines |
| 3 | Client-side size guard before upload — **M-1** | `PhotoCapture.tsx` | ~3 lines |
| 4 | `web/public/_headers` with CSP, nosniff, frame-ancestors, Referrer-Policy, HSTS — **M-2** | new file | ~10 lines |
| 5 | `nosniff` + `Content-Disposition` on photo responses — **M-2** | `worker/src/photo.ts` | 2 lines |
| 6 | `/upload` must check the edit lock, not just visibility — **M-3** | `worker/src/upload.ts` | ~10 lines |
| 7 | Custom domain for both projects; `workers_dev = false` — **M-4** | `wrangler.toml` ×2 + dashboard | 30 min |
| 8 | Rate limiting on `/ocr` and `/upload` (needs #7, or the ratelimit binding) — **M-5** | `worker/wrangler.toml`, `index.ts` | ~15 lines |
| 9 | Active-user check in Worker routes (defence in depth for H-2) | `worker/src/*` shared helper | ~20 lines |
| 10 | CORS fallback → deny instead of `*` — **L-1** | `worker/src/index.ts:38` | 1 line |
| 11 | Verify R2 buckets have no public URL | dashboard | 2 min |
| 12 | Supabase password minimum + HIBP leaked-password protection — **L-5** | dashboard | 2 min |
| 13 | Enable `[observability]`; bump `compatibility_date` | `wrangler.toml` ×2 | 5 min |

### Open architectural decision

Fixes #6 and #9 both need the Worker to know the caller's *role and active status*, which is one extra Supabase round-trip per request. Three options:

- **(a) Fetch per request** — simplest, no new state, ~30–60 ms added latency on `/ocr` and `/upload`. Consistent with the existing "delegate to RLS" philosophy.
- **(b) Put `role`/`site_id` into the JWT** via a Supabase custom access token hook, and read the claims at the edge — zero latency, but claims go stale until token refresh, which **re-creates the H-2 problem in a new place**.
- **(c) Cache the lookup in KV** with a short TTL — middle ground, adds a binding and a staleness window.

**Recommendation: (a).** It preserves the single source of truth this codebase has deliberately maintained, and 30 ms on an endpoint that then runs a 9B vision model is not a latency anyone will measure. Decision is the owner's; nothing has been changed on this basis.

---

## 10. Remediation Plan

Working checklist. Tick as landed.

### Must fix before production

- [x] **H-1** — `/ocr` authorization. Resolved: public signup disabled, anon key confirmed HS256 against ES256-pinned middleware.
- [x] **M-1** — image-signature validation + 8 MB cap on `/upload`, plus the client-side guard. *Validated: 9 new tests, typecheck, build.*
- [x] **H-2** — all Worker routes require an active app user, **and** deactivation now bans the Supabase auth account via `POST /user-active`. *Validated: typecheck, 37 worker + 89 web tests, wrangler dry-run, build.*
- [x] **R2 public-access verification** — confirmed by the owner 2026-08-17: neither `car-prep-photos` nor `car-prep-backups` has a public custom domain or an r2.dev public development URL.

### Should fix before production

- [x] **M-2** — generated `_headers` + `nosniff`/`Content-Disposition`/`sandbox` on `/photo`. *Validated: built and inspected under both env conditions.*
- [x] **M-3** — `/upload` enforces the edit lock via `can_write_job`. ⚠️ *Requires migration 0009 to be applied **before** the Worker deploys.*
- [x] **L-1** — CORS fallback now denies.
- [x] Enable Workers Logs — `[observability]` added to `worker/wrangler.toml`.
- [x] **M-4** — **accepted as a residual risk.** Owner decided 2026-08-17 not to purchase a custom domain, so the app stays on `workers.dev` and the WAF, Bot Management, Cloudflare Access and edge Rate Limiting Rules remain unavailable. Cloudflare's standard DDoS protection still applies. See the finding for what this does and does not cost.
- [x] **M-5** — per-user rate limiting live on `/ocr` (60/60s) and `/upload` (120/60s) via Workers rate-limit bindings, keyed on JWT `sub`. *Deployed and verified bound in production.*

### Nice to have

- [x] **N-1** — migration `0010_revoke_rpc_from_anon.sql` applied and **verified live**: all seven RPCs now return `401 permission denied` (SQLSTATE 42501) to the anon key.
- [ ] **L-5** — 🔧 **MANUAL.** Supabase password policy and HIBP breach check.
- [ ] **L-3** — server-derive `audit_log.action`/`changes` if the log is ever meant to be evidentiary.
- [ ] **L-6** — pin `aud` in `jwk()`. Deferred: needs a live sign-in to validate, see the finding.
- [x] **L-7** — Worker dev tree now clean (`0 vulnerabilities`) after the wrangler 4 upgrade. Web's remaining `nanoid` advisory is dev-only.
- [ ] `compatibility_date` bump — **not done deliberately.** ~20 months of accumulated compat-flag changes is a behavioural change that wants its own testing pass, not a drive-by edit inside a security fix.
- [ ] Encrypt the nightly backup before upload; split the Cloudflare API tokens by purpose.

### Decisions — resolved

**D-1 — How far should deactivation reach?** → **Revoke at `auth.users`.** Implemented; see H-2.

**D-2 — Should a delayed offline submission still attach its photos?** → **No; the lock means what it says.** No code change.

`submitJob` inserts the job row, then uploads photos. If the phone loses signal in between and does not reconnect within 15 minutes, the worker's edit window has closed by the time the queue retries, and `can_write_job` now refuses the upload.

For the record, since this path is easy to misread later: it was **already broken before M-3**. The R2 write used to succeed while the matching `photos` row insert failed under `photos_insert`, so the job stayed queued and retried forever. M-3 did not create the breakage; it moved the failure from "photo saved, bookkeeping broken" to "photo not saved". The deliberate choice is that evidence frozen with the record stays frozen.

> **Known separate bug, not a security issue and not fixed here.** The offline queue never gives up: a submission that can no longer succeed retries on every reconnect indefinitely, and the worker sees a permanent pending badge with no way to resolve it. Worth a real fix (bounded retries, then a visible error telling them to re-log the car) as ordinary maintenance work, tracked outside this audit.

---

## 11. Production Security Checklist

- [x] Supabase: public signup disabled
- [x] Supabase: JWT signing keys confirmed asymmetric/ES256 (the Worker's `jwk()` requires it)
- [ ] Supabase: password min length ≥ 8, leaked-password protection on
- [x] R2 `car-prep-photos`: no r2.dev public URL, no public custom domain
- [x] R2 `car-prep-backups`: same check — this one holds the whole database
- [ ] R2 lifecycle rules actually applied (photos 90d, backups 180d)
- [ ] Worker secrets set: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Deactivate a test user end to end, then confirm their existing session cannot refresh (H-2 revocation working against the live Admin API)
- [ ] `ALLOWED_ORIGINS` + `APP_URL` point at the production frontend
- [ ] Supabase Auth → Redirect URLs allowlists `APP_URL/welcome` only
- [x] ~~Custom domains configured~~ — **declined 2026-08-17**; residual risk accepted, see M-4
- [x] Rate limiting active on `/ocr` and `/upload` — in-Worker bindings, verified bound in production
- [x] Security headers verified live — all six confirmed on the deployed frontend 2026-08-17
- [x] Workers Logs enabled — `[observability]` shipped in the 2026-08-17 deploy
- [ ] A Workers AI usage alert configured (separate from logging)
- [x] **0009 applied** — verified live 2026-08-17
- [x] **0010 applied** (N-1) — verified live 2026-08-17
- [x] All **10** migrations applied in order (`0005` destructive-change review was done at the time)
- [ ] `job_services_archive_0005` dropped once exports are verified
- [ ] Nightly backup workflow has run successfully at least once, and a **restore** has been tested
- [ ] Cloudflare API tokens scoped minimally (separate deploy vs. backup tokens)

---

## 12. Change Log

| Date | Change |
|---|---|
| 2026-08-16 | Initial audit. |
| 2026-08-16 | **H-1 resolved.** Public signup disabled at the Supabase platform level. Anon key verified as `alg: HS256` against an `ES256`-only JWKS and `ES256`-pinned middleware — the published key cannot satisfy `jwk()`. H-1's residue reassigned to H-2 and M-5; H-2 escalated in priority as the sole remaining route into `/ocr`. |
| 2026-08-16 | **M-1 fixed.** `sniffImageType()` validates uploads against an image-signature allowlist (JPEG/PNG/WebP/HEIC, no SVG) and derives the stored content type from it; cap 20MB → 8MB, mirrored client-side. Broadened from the audit's JPEG-only recommendation to avoid rejecting HEIC on the downscale-failure path. Client guard added — an oversized file previously poisoned the offline retry queue permanently. `worker/src/upload.test.ts` (9 cases). |
| 2026-08-16 | **M-2 fixed.** `securityHeaders()` Vite plugin generates `_headers` (CSP, nosniff, frame-ancestors, Referrer-Policy, HSTS, Permissions-Policy) with `connect-src` derived from build env so it cannot drift; `/photo` gained nosniff, fixed `Content-Disposition` and a `sandbox` CSP. Verified the CI build (no secrets) still succeeds. |
| 2026-08-16 | **M-3 fixed in code.** Migration `0009_can_write_job.sql` + `/upload` switched from a visibility probe to a write-permission RPC mirroring `photos_insert`. Used the existing `find_recent_duplicate` pattern, which dissolved the §9 "role at the edge" decision. **Apply 0009 before deploying the Worker.** Surfaced D-2. |
| 2026-08-16 | **H-2 partially mitigated.** `getActiveAppUser()` (`worker/src/appUser.ts`) added and applied to `/ocr`; `/upload` gets the same via `can_write_job`; `/invite` refactored onto it, removing a duplicated check and two dead helpers. Auth-account revocation still open as D-1. |
| 2026-08-16 | **L-1 fixed.** CORS fallback changed from `'*'` to deny. |
| 2026-08-16 | **Observability enabled** on the Worker. L-6 and the `compatibility_date` bump deliberately deferred with reasons recorded. |
| 2026-08-16 | **H-2 completed** (D-1 resolved: revoke). New `POST /user-active` route calls `set_user_active` with the caller's JWT, then bans the auth account with the service-role key — authorization stays in Postgres, the Worker only performs the side effect. Frontend `Users.tsx`/`Team.tsx` moved off the direct RPC; partial success surfaces a visible warning. New locale key `admin.sessionNotRevoked` in all three languages. |
| 2026-08-16 | **D-2 resolved:** lock stays authoritative, no change. Offline-queue retry-forever recorded as a separate non-security bug. |
| 2026-08-17 | **Migration 0009 verified applied** against the live project (`can_write_job` returns `false` to an anon caller; a missing function 404s). Worker is now safe to deploy. |
| 2026-08-17 | **N-1 found and fixed.** Verification revealed every security definer RPC is executable by `anon` — `revoke … from public` never removed Supabase's explicit default grant. Nothing exploitable; `update_my_name` executed but no-ops on a NULL `auth.uid()`. Migration 0010 revokes from `anon`, changes the schema default, and gives `update_my_name` an explicit guard. **Applied and verified**: all seven RPCs now 401 to the anon key. |
| 2026-08-17 | **R2 buckets confirmed private** by the owner — no public custom domain or r2.dev URL on either. Closes the highest-consequence unknown in the original audit. |
| 2026-08-17 | **Deployed to production.** Worker `7c5cc5b8`, frontend `360fe648`. Verified live: all six security headers served; all five Worker routes 401 without a token (including the new `/user-active`); CORS denies a foreign origin and allows the app origin. |
| 2026-08-17 | **M-4 accepted as residual risk** — no custom domain will be purchased; the app stays on `workers.dev` without WAF/Bot Management/Access. Corrected an error in the original write-up: this does **not** block M-5, because the Workers rate-limit binding needs no zone. M-5 re-scoped accordingly. |
| 2026-08-17 | **M-5 fixed and L-7 cleared.** Upgraded wrangler 3.114 → 4.123 (and `@cloudflare/workers-types` 4 → 5), which both enabled `[[ratelimits]]` and took the Worker's dev tree to 0 advisories. Added `OCR_LIMITER` (60/60s) and `UPLOAD_LIMITER` (120/60s) keyed on JWT `sub`, checked ahead of the Supabase lookup and body read. Deployed as version `501d5af9`; verified both bindings live, all routes still 401 without a token, and 30 anonymous `/ocr` hits returned 401 rather than 429 — the limiter cannot be drained by unauthenticated traffic. **Every finding in this audit is now closed.** |
