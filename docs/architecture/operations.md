# Operations

Deploy gotchas and open threads. Former `CONTEXT.md` §8–9. Setup and deploy runbook: [`README.md`](../../README.md).

## 8. Operational gotchas

- **The frontend Cloudflare project was originally a one-time upload, not
  Git-connected**, so pushing to `main` did not deploy it. That is what
  `web/wrangler.toml` + `deploy-web.yml` fix. If the production site "remains as
  it was" after a push, check the workflow ran.
- **Build-time env vars go under Settings → Build → Build variables and
  secrets**, not the runtime "Variables & Secrets" section. A static-assets
  Workers project rejects runtime variables outright ("Variables cannot be added
  to a Worker that only has static assets").
- `VITE_*` variables are baked in at build time: `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_WORKER_URL`.
- R2 requires a one-time enablement in the Cloudflare dashboard (error 10042
  until then).
- Migrations are applied by hand in the Supabase SQL editor. There is no
  migration runner — check what is actually applied before assuming.

---

## 9. Known open threads

- Moondream OCR has returned empty answers in production; `workerApi.ts`
  currently does a two-step detect → crop → query flow (workers photograph the
  whole car, so the plate is a small patch of the frame). Temporary debug
  logging may still be present in `ocr.ts`.
- Migration `0004` has not been confirmed as applied to the live database.
- The redesign has not been visually verified by the assistant — browser tooling
  against localhost is blocked in this environment. Visual confirmation is the
  user's.
