---
paths:
  - "web/src/**"
  - "car-prep-tracker/web/src/**"
---

# Web UI rules

Loaded when touching `web/src/`. Background: [ADR-0006](../../docs/decisions/0006-design-language.md), [ADR-0007](../../docs/decisions/0007-offline-queue-deferred-video.md), `DESIGN.md`, `PRODUCT.md`, [design brief](../../docs/design/DESIGN-BRIEF.md).

- **Tailwind v4: no config file.** Tokens live in the `@theme` block of `web/src/index.css`. An unknown utility compiles to nothing, silently: check the token exists.
- Use the `web/src/components/ui.tsx` vocabulary (`Page`, `Card`, `Button`, `Field`, `Select`, `ConfirmAction`, …). Don't restyle per screen.
- Icons only through `components/Icon.tsx`. Pages never import `lucide-react` directly.
- Every interactive element clears a 44px tap target. `Badge` is never an action. Destructive actions go through `ConfirmAction`.
- Contrast is computed: `ink-500` is the lightest text token; `ink-400` is never text. Brand grey is not a UI border.
- Every string goes through i18n in **both** `locales/en.json` and `locales/ru.json`; Russian uses `_one/_few/_many/_other` plurals. Leave room for longer Russian copy.
- OCR is an accelerator: every failure path resolves to manual entry, never a blocked form.
- Offline queue: job entries go first; a video failure never blocks a job.
- `xlsx` is pinned to the SheetJS CDN tarball 0.20.3. Don't move it back to the npm registry.
- Missing UI guards are cosmetic; real permission checks are RLS (don't add client-only "security").
