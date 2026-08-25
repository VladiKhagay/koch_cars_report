# Security Notes — Manual Ops Checklist

Companion to `SECURITY-AUDIT.md`. Everything here is a dashboard/CLI action
the repo cannot perform on its own — tick items off as you do them. See
`SECURITY-AUDIT.md` §11 (Production Security Checklist) for the full list;
this file has the step-by-step for the three items that were still open
after the 2026-08-25 follow-up audit.

## 1. Supabase password policy (L-5)

Supabase Dashboard → your project → **Authentication** → **Policies** (or
**Settings** → **Auth**, label varies by dashboard version) → **Password
Requirements**:

- [ ] Set **Minimum password length** to `8` (currently defaults to 6 —
      the frontend already enforces 8 in `Welcome.tsx`, this closes the
      server-side gap so it can't be bypassed by calling the API directly).
- [ ] Enable **"Prevent use of leaked passwords"** (HIBP breach-database
      check).

No app downtime, no code change. Existing users are unaffected — the
policy only applies at signup/password-change, and there's no self-signup
path (`/invite`-only) so nothing is force-reset.

## 2. Cloudflare API token separation (deploy vs. backup)

**Why:** `deploy-web.yml`, `deploy-worker.yml`, and `backup.yml` all
currently read the *same* GitHub Actions secret, `CLOUDFLARE_API_TOKEN`
(confirmed in all three workflow files). That token deploys both Worker
scripts — i.e. it can overwrite the running application — while the
backup job only ever needs to write one object to one R2 bucket. If the
GitHub secret ever leaks (compromised runner, malicious workflow change in
a PR, leaked log), the blast radius today is "attacker can redeploy the
Worker," not just "attacker can write to the backup bucket." Splitting the
token means a leak scoped to the backup job can only touch backups.

**Steps:**

- [ ] Cloudflare Dashboard → **My Profile** → **API Tokens** → **Create
      Token** → **Custom token**.
- [ ] Name it `car-prep-backup-r2` (or similar). Permissions:
      **Account** → **Workers R2 Storage** → **Edit**. Scope to the
      specific account only (not "All accounts"). No zone permissions
      needed.
- [ ] In the repo: **Settings** → **Secrets and variables** → **Actions**
      → add a new secret `CLOUDFLARE_BACKUP_API_TOKEN` with this token's
      value.
- [ ] Edit `.github/workflows/backup.yml` line 28: change
      `CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}` to
      `CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_BACKUP_API_TOKEN }}`
      (wrangler reads the env var by that fixed name regardless of which
      GitHub secret backs it — only the right-hand side changes).
- [ ] Trigger the backup workflow manually (`workflow_dispatch`) once to
      confirm the new token works before the next scheduled run.
- [ ] Leave `CLOUDFLARE_API_TOKEN` (the existing, broader token) as-is for
      `deploy-web.yml` / `deploy-worker.yml` — those genuinely need
      Workers Scripts:Edit.

*(This edits a workflow YAML file, not application code — flagged here as
documentation per the current task's scope; apply the one-line workflow
change yourself, or ask for it as a separate follow-up.)*

## 3. R2 photo lifecycle rule — verify it's actually applied (not just documented)

The 90-day photo expiry and 180-day backup expiry are **already documented
as CLI commands** in `worker/README.md:47,52` and referenced in
`worker/wrangler.toml`'s trailing comment — they are not dashboard steps,
they're one-time `wrangler` invocations run against the live buckets. The
open item is confirming they were actually run, since a documented command
and an applied rule are two different things.

- [ ] Run (idempotent — re-adding an existing rule with the same `--id`
      is safe):
  ```
  npx wrangler r2 bucket lifecycle list car-prep-photos
  npx wrangler r2 bucket lifecycle list car-prep-backups
  ```
  Confirm `expire-90d` (photos) and `expire-180d` (backups) both appear.
  If either is missing, apply it:
  ```
  npx wrangler r2 bucket lifecycle add car-prep-photos --id expire-90d --expire-days 90 --prefix ""
  npx wrangler r2 bucket lifecycle add car-prep-backups --id expire-180d --expire-days 180 --prefix ""
  ```
- [ ] **Caveat before relying on this:** confirm 90-day photo retention and
      180-day backup retention actually satisfy whatever record-keeping
      obligation applies to vehicle prep/service jobs in your
      jurisdiction (insurance, warranty, or consumer-protection
      recordkeeping periods sometimes exceed 90 days). This is a business/
      legal call, not a technical one — the rule is easy to widen
      (`--expire-days 365`) if 90 turns out to be too short.
