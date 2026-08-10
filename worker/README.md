# car-prep-tracker-worker

Cloudflare Worker: the only custom backend in the system. It does two things
that the browser can't do safely on its own:

1. **`/ocr`** — proxies photo OCR to Gemini Flash, keeping the API key off the client.
2. **`/upload`** and **`/photo/:jobId/:kind`** — read/write photos in a private R2
   bucket, authorized by forwarding the caller's own Supabase JWT to Supabase's
   REST API and checking whether the same Row Level Security policies that
   gate the frontend would let them see that job. No service-role key is
   ever used here.

All actual application data (jobs, users, services) lives in Supabase and is
written directly from the frontend — this Worker never touches Postgres.

Every route is authenticated by verifying the caller's Supabase-issued JWT
against Supabase's public JWKS (`SUPABASE_URL` + `/auth/v1/.well-known/jwks.json`),
not a shared secret — see `src/index.ts`. This matches Supabase's current
JWT Signing Keys system (Project Settings -> JWT Keys in the dashboard): if
that page shows an asymmetric "Current Key" (ECC/RSA), this Worker verifies
against it automatically, including after a key rotation, with no redeploy.

### OCR (`src/ocr.ts`)

Gemini is forced into a fixed JSON shape (`responseSchema`) rather than free
text: `{ readable, text, reason }`, where `reason` is a small enum (`blurry`,
`glare`, `dark`, `angle`, `obstructed`, `not_in_frame`) the frontend
translates, instead of showing raw English model output to Russian-speaking
workers. When a photo can't be read, the field now shows why instead of
silently staying blank.

Two gotchas already hit in production, worth knowing before touching this file:

- **The model id (`GEMINI_MODEL` in `wrangler.toml`) will get deprecated.**
  Google has no auto-updating "latest" alias — when OCR starts 404ing with
  "model ... no longer available", check
  [ai.google.dev/gemini-api/docs/latest-model](https://ai.google.dev/gemini-api/docs/latest-model)
  for the current id and update the var (not a secret, no redeploy of code
  needed, just `wrangler deploy` after editing `wrangler.toml`).
- **`thinkingConfig`'s field name depends on the model generation.**
  2.5-series models use `thinkingBudget` (a token count; `0` disables
  thinking). 3.x models use `thinkingLevel` (`"low"` etc.) instead and
  **cannot fully disable thinking** — sending the wrong field for the
  generation you're on gets a 400 "invalid argument". If you bump
  `GEMINI_MODEL` to a new major version, check whether this needs to change
  too, and keep `maxOutputTokens` generous since thinking tokens (even at the
  lowest level) count against that same budget.

## One-time setup

```bash
npm install
npx wrangler login
npx wrangler r2 bucket create car-prep-photos
npx wrangler r2 bucket lifecycle add car-prep-photos --id expire-90d --expire-days 90 --prefix ""

# Separate bucket for nightly DB backups (see ../.github/workflows/backup.yml) —
# kept separate so the 90-day photo lifecycle rule never touches backups.
npx wrangler r2 bucket create car-prep-backups
npx wrangler r2 bucket lifecycle add car-prep-backups --id expire-180d --expire-days 180 --prefix ""

npx wrangler secret put SUPABASE_URL          # https://<project-ref>.supabase.co
npx wrangler secret put SUPABASE_ANON_KEY     # Supabase: Project Settings -> API -> anon/public key
npx wrangler secret put GEMINI_API_KEY        # https://aistudio.google.com/apikey
```

Then set `ALLOWED_ORIGINS` in `wrangler.toml` to your Cloudflare Pages URL(s)
before going live (comma-separated if you have a preview + production URL).

## Local dev

```bash
npm run dev
```

## Deploy

Handled by `.github/workflows/deploy-worker.yml` on push to `main`. To deploy
manually:

```bash
npm run deploy
```
