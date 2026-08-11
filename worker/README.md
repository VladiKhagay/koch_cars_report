# car-prep-tracker-worker

Cloudflare Worker: the only custom backend in the system. It does two things
that the browser can't do safely on its own:

1. **`/ocr`** — runs photo OCR on Cloudflare Workers AI (Moondream), so there is
   no external OCR vendor, API key, or model-deprecation cycle to manage.
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

OCR runs on the Workers AI binding (`[ai]` in `wrangler.toml`) using
Moondream, a vision model built for OCR-style extraction. History note: this
originally used the Gemini API, which broke twice in one day (a model-name
deprecation, then a generation-incompatible request field) — Workers AI was
adopted specifically to remove that external-vendor churn, and it also
removed the last external API key from the system.

Moondream returns free text, so the prompt pins a strict answer format
("the characters, or `UNREADABLE <reason>`") and `parseOcrAnswer()` handles
the small deviations compact models produce (quotes, preambles). The reason
is a fixed enum (`blurry`, `glare`, `dark`, `angle`, `obstructed`,
`not_in_frame`) that the frontend translates, instead of showing raw English
model output to Russian-speaking workers. The parser is a pure function with
unit tests in `src/ocr.test.ts` (`npm test`).

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
```

OCR needs no secret — it uses the Workers AI binding declared in
`wrangler.toml` (`[ai]`), which works automatically once deployed.

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
