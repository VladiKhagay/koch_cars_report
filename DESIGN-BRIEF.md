# Design Brief — Vehicle Prep Tracker redesign

Read `PRODUCT.md` first. That file is the product truth; this file is the
problem statement, the priorities, and the bar for "this works." It is not a
style guide and it does not pick colors, type, or components — those are the
designer's decisions, made inside the constraints below.

---

## 0. Approved direction and hard constraints

These came from the client this session. They are constraints, not suggestions.

- **"Clean and utilitarian."** Calm, high-contrast, restraint over decoration.
  This is a tool used at speed by people who are not looking at it — it is not
  a product that needs to impress anyone.
- **Light mode only.** Dark mode is deferred by the client. Do not build it,
  do not half-build it, do not ship a toggle.
- **Brand is PENDING.** The client will supply a real logo and brand colors
  later. Everything brand-carrying must resolve from one token source so the
  real identity drops in as a token swap, with no component edits and no
  hunting for hardcoded hex. Reserve a logo slot in the sign-in screen, the app
  shell, and the PWA icon. Do not invent a logo, wordmark, or company name.
- **The stack is fixed:** React 19 + Vite + Tailwind v4 + Supabase + Cloudflare
  Workers, installable PWA. This is a redesign of an existing working app, not
  a greenfield build.

---

## 1. Screen ranking by real usage volume

**Spend effort in proportion to this list, not evenly across it.** The
operation runs ~125 cars/day across 3 sites (~3,000/month) with roughly 20
workers, 3 managers, and a small number of admins. The client separately cites
~250 New Job submissions/day; either figure leaves New Job one to two orders of
magnitude ahead of everything else. Every other screen is seen a handful of
times a day by a handful of people who are sitting down.

### Tier 1 — where most of the work goes

| # | Surface | Est. daily use | Who | Why it dominates |
|---|---------|----------------|-----|------------------|
| 1 | **New Job** (`pages/NewJob.tsx`) | ~125–250 submissions | ~20 workers | This *is* the product. Every other screen shows data this screen created. It is the only screen used under time pressure, one-handed, in direct sunlight. A 10-second regression here costs ~35 minutes of labour a day and pushes workers back to WhatsApp. |
| 2 | **App shell** (`components/Layout.tsx`) | every view, all roles | everyone | Not a page, but it frames all ~150+ screen-views/day. It also holds the two most dangerous controls in the app (sign out, language) as 12px text links. |

### Tier 2 — real volume, no time pressure

| # | Surface | Est. daily use | Who | Why |
|---|---------|----------------|-----|-----|
| 3 | **Job Detail** (`pages/JobDetail.tsx`) | up to ~125 opens | 3 managers | Every job eventually needs a billing code entered here, so its volume tracks New Job's. But the manager is unhurried and often indoors, so the bar is *throughput and correctness*, not raw speed. This is the highest-volume screen nobody thinks about. |
| 4 | **Dashboard** (`pages/Dashboard.tsx`) | ~10–30 views | 3 managers + admins | Low view count, but it is the launchpad for every Job Detail visit and the only place duplicate/missing-code flags surface. Its job is triage, not browsing. |

### Tier 3 — low volume, high cost when it fails

| # | Surface | Est. use | Who | Why |
|---|---------|----------|-----|-----|
| 5 | **My Jobs** (`pages/MyJobs.tsx`) | tens/day | workers | The only recovery path from a mis-tap, and the only place a worker can confirm a car actually went through. Directly protects data quality. |
| 6 | **Login** (`pages/Login.tsx`) | a few/day | everyone | PWA sessions persist, so it is rarely seen — but when it fails, that worker logs zero cars all day. Also the app's only unauthenticated surface and the primary logo slot. |

### Tier 4 — correctness and legibility, not craft

Fix what is broken, make it consistent with the system, then stop. Do not
invent new patterns here.

| # | Surface | Est. use | Who |
|---|---------|----------|-----|
| 7 | **Export** (`pages/Export.tsx`) | a few/day | 3 managers + admins |
| 8 | **Analytics** (`pages/Analytics.tsx`) | a few/day–week | managers + admins |
| 9 | **Services** (`pages/Services.tsx`) | a few/week | managers + admins |
| 10 | **Team** (`pages/Team.tsx`) | a few/week | 3 managers |
| 11 | **My Stats** (`pages/MyStats.tsx`) | a few/week per worker | workers |
| 12 | **Profile** (`pages/Profile.tsx`) | a few/month | everyone |
| 13 | **Admin → Users** (`pages/admin/Users.tsx`) | a few/month | admins |
| 14 | **Welcome / set password** (`pages/Welcome.tsx`) | once per person, ever | everyone |
| 15 | **Admin → Sites** (`pages/admin/Sites.tsx`) | ~never (3 sites exist) | admins |

**Rule of thumb:** if a decision would improve Tier 4 but cost anything at all
in Tier 1, it is the wrong decision.

---

## 2. Per-screen job and field failure mode

One line on what the user is accomplishing; one line on what "this went wrong
in the field" concretely looks like.

**New Job** — `pages/NewJob.tsx`
- *Job:* photograph plate and VIN, confirm the two auto-filled fields, tap the
  services performed, submit, and move to the next car in under a minute.
- *Failure:* the worker taps Submit, nothing visibly changes because the
  validation error is off-screen above them, so they tap Submit four more times
  and then walk away — that car is never logged and nobody finds out until the
  importer queries a missing invoice.

**App shell** — `components/Layout.tsx`
- *Job:* get between the two or three screens this role uses, and know at a
  glance whether anything is pending.
- *Failure:* a worker reaching for the language toggle hits "Sign out" (they
  are adjacent 12px text links), and now has to remember a password while
  standing in a yard holding a phone in one hand.

**Job Detail** — `pages/JobDetail.tsx`
- *Job:* look at the two photos, confirm the plate/VIN match, type the billing
  code the importer sent, save, next.
- *Failure:* the manager taps "Delete" instead of "Save" on a 44px-tall
  full-width button stack with no confirmation step, and the job vanishes from
  the day's list with no undo affordance on screen.

**Dashboard** — `pages/Dashboard.tsx`
- *Job:* see today's jobs at my site, spot the ones flagged as duplicates or
  missing a billing code, and jump into them.
- *Failure:* a manager searches for a plate the office asked about, gets "No
  jobs match your search," and reports back that the car was never logged —
  because the search only covers today, and the car was done yesterday.

**My Jobs** — `pages/MyJobs.tsx`
- *Job:* check that the last car actually submitted, and fix a wrong service
  tap within the 15-minute window.
- *Failure:* the worker opens it to fix a service, sees only "Locked" with no
  indication that they had 40 seconds left when they started walking over, and
  now needs a manager to fix it — which is exactly the WhatsApp-era workflow
  this product exists to delete.

**Login** — `pages/Login.tsx`
- *Job:* get into the app.
- *Failure:* a worker mistypes their password twice, sees "Couldn't sign in,"
  and finds no recovery path anywhere on the screen — there is no forgot-
  password link in the app at all. They log nothing until someone with admin
  access is reachable.

**Export** — `pages/Export.tsx`
- *Job:* pick a date range and hand the office an XLSX.
- *Failure:* the manager picks the range, taps Download, and cannot tell
  whether the file was produced, is still being produced, or the range was
  empty — so they tap again and end up with three copies in Downloads, or
  assume it worked when it didn't.

**Analytics** — `pages/Analytics.tsx`
- *Job:* see how many jobs a site, worker, or service produced over a period,
  and export it.
- *Failure:* an admin sets a worker filter, then narrows the date range; the
  selected worker no longer exists in the rebuilt options list, the select goes
  blank, and the numbers on screen silently become all-workers numbers that the
  admin reads as one worker's output.

**Services** — `pages/Services.tsx`
- *Job:* add a service the site now offers, fix a name, or reorder the catalog
  so the most common services sit first in the worker's chip list.
- *Failure:* the manager tries to move a service up using a 20px `↑` glyph on a
  phone, hits the neighbouring `↓` instead, and reorders the catalog the wrong
  way — which then slows down every worker's submission until someone notices.

**Team** — `pages/Team.tsx`
- *Job:* see who is on my site's roster and deactivate someone who left.
- *Failure:* the manager taps the green "Active" pill expecting to open the
  person's record — it is actually the deactivate button, with no confirmation
  — and a worker mid-shift is instantly locked out of the app.

**My Stats** — `pages/MyStats.tsx`
- *Job:* see how many cars I've done this month.
- *Failure:* a new worker sees three zeroes and an empty chart with no
  explanation, and concludes the app isn't recording their work.

**Profile** — `pages/Profile.tsx`
- *Job:* change my name or my password.
- *Failure:* two visually identical stacked forms with two identical primary
  buttons; the user edits their name, taps the lower button, and changes
  nothing — or gets a "Saved" confirmation from the other form and believes the
  wrong thing was saved.

**Admin → Users** — `pages/admin/Users.tsx`
- *Job:* invite a new worker to a site, or change someone's role or site.
- *Failure:* the admin sends the invite, sees a small green banner, and has no
  way to tell later whether that person ever accepted it — the list shows the
  same row for an invited-but-never-activated user as for an active one.

**Admin → Sites** — `pages/admin/Sites.tsx`
- *Job:* add a site. Realistically done three times, ever.
- *Failure:* an admin adds a duplicate or misspelled site because there is no
  validation, no confirmation, and no edit or delete — site names then appear
  wrong on every export and analytics screen permanently.

**Welcome / set password** — `pages/Welcome.tsx`
- *Job:* finish account setup from an emailed invite link, once.
- *Failure:* the invite link's token has expired, and the person gets one line
  of grey 14px text on an otherwise blank screen with no button, no support
  contact, and no way forward.

---

## 3. Must not regress

Treat these as acceptance gates, not aspirations.

1. **Worker submission speed.** The number of taps, screens, and decisions
   between "standing at a finished car" and "submitted" must not increase.
   No added steps, no added confirmations, no added fields, no interstitials,
   no onboarding, no animation that must complete before the next action.
2. **≥44px touch targets** for every interactive element in the worker and
   manager phone flows — including chips, tab bar items, sort controls,
   dismissals, and the header controls. Text-only 12px links are not targets.
3. **Outdoor contrast.** The worker flow must be readable on a phone at full
   brightness in direct sun. No low-contrast grey-on-white for anything a
   worker must read or act on. Status must never be encoded by hue alone —
   sunlight is exactly what destroys hue discrimination.
4. **i18n / Cyrillic length tolerance.** Russian averages ~25% longer and short
   UI labels run 2–2.7× longer ("Save" → "Сохранить", "My Stats" → "Моя
   статистика", "Add" → "Добавить"). Nothing may be laid out to English string
   widths. **Check every screen in Russian before calling it done** — that is a
   language toggle in the app, so there is no excuse for not looking.
5. **Offline-queue visibility.** The worker must always be able to tell that
   submissions are queued and how many, from wherever they are in the app — not
   only from a banner at the top of New Job. Queued work must be as visible as
   submitted work.
6. **PWA feel.** Standalone display, safe-area insets honoured (notch and home
   indicator), no browser-chrome assumptions, no layout that breaks when the
   address bar is absent, no horizontal page scroll.
7. **No heavy assets on mobile data.** Inline SVG or system glyphs only. No
   icon fonts, no web font families beyond what is already loaded, no raster
   imagery, no chart or animation library added for decoration. The XLSX
   library is already lazy-loaded and must stay that way.
8. **Every capability listed in PRODUCT.md still reachable.** The redesign may
   move things; it may not quietly drop a control.

---

## 4. Known weaknesses in the current UI

Real, specific, cited. This is the work list, not a list of vibes.

### Blocking the brand swap (fix first — it is a precondition, not polish)

- `components/BarChart.tsx:55,70,79,90,98` — chart bars, gridlines, axis
  labels and tooltip are hardcoded hex (`#2563eb`, `#1d4ed8`, `#e1e0d9`,
  `#898781`, `#0b0b0b`). A brand token swap would leave every chart on the old
  blue and would not touch the greys at all.
- `vite.config.ts:18-19` and `index.html:8` — PWA `theme_color` and
  `background_color` are hardcoded `#0f172a` (near-black) while the app is a
  light slate/white surface. The install splash flashes dark, then the app
  appears white. Both values are also outside the token system.
- `src/index.css:3-10` — the `brand` scale defines only steps 50/100/500/600/
  700/900. `web/.design-sync/NOTES.md` records that any other step silently
  compiles to nothing. Whatever token structure you land on must be complete
  enough that the client's palette maps into it without gaps.
- There is no logo slot anywhere. `Layout.tsx:61` and `Layout.tsx:87` and
  `Login.tsx:29` all render the app name as a text `<span>`/`<h1>`.

### New Job — Tier 1, fix all of these

- `NewJob.tsx:259-266` — the Submit button is only disabled while `submitting`.
  With an invalid plate or VIN, tapping Submit sets `touched` and then returns
  silently (`:123-125`). The resulting errors are `text-xs` messages under the
  fields at `:202,217` — potentially off-screen. **Net effect: tapping the
  primary button does nothing observable.** No scroll-to-error, no summary, no
  disabled state, no message near the button.
- `NewJob.tsx:128,151-152` — after a successful submit, `status` stays
  `'success'` until the *next* submit begins. The "Job submitted" banner is
  therefore still on screen while the worker photographs and fills in the next
  car, so the confirmation no longer means anything. This is the single most
  direct cause of duplicate or skipped submissions.
- `NewJob.tsx:141-147` — the form resets in place with no scroll to top and no
  transition, so the visual difference between "submitted successfully" and
  "the page reloaded / I lost my work" is one small banner.
- `NewJob.tsx:170` + `:58-66` — the offline queue count appears only as a
  banner at the top of this one screen, refreshed on mount and on `online`
  events. A worker on My Jobs or My Stats has no idea anything is pending.
  Worse: queued jobs do not appear in My Jobs at all (`MyJobs.tsx:33-38` reads
  Supabase only), so the worker's own record is missing exactly the cars that
  are at risk.
- `ServiceChips.tsx:23` — chips are `px-4 py-2 text-sm` ≈ 36px tall, below the
  44px floor, on the most-tapped control in the app. Selection is encoded by
  fill colour alone with no mark or icon — the one distinction that must
  survive direct sunlight.
- `ServiceChips.tsx:14` — unbounded `flex-wrap` list. The catalog is
  manager-editable with no cap, so as it grows the chip field pushes Submit
  further and further off-screen.
- `NewJob.tsx:222-229` — the optional Brand field is visually identical to the
  required Plate and VIN fields. Nothing distinguishes required from optional
  except the word "(optional)" in the Note label.
- `NewJob.tsx:172-189` — the two photo tiles are a fixed `grid-cols-2`, so each
  tile is under half the screen width. These are the first and most important
  actions on the screen and they are the smallest.

### App shell

- `Layout.tsx:86-101` — Profile, the RU/EN toggle, and **Sign out** are three
  adjacent `text-xs` underlined links with no padding, in the header, on every
  screen. Far below 44px, and a mis-tap on the highest-consequence control in
  the app.
- `Layout.tsx:40-43,108-114` — the mobile tab bar is text-only at
  `text-[11px]`, `flex-1`, `truncate`, `py-2.5` (≈36px tall). The manager role
  has **five** tabs; at 375px that is ~75px per tab. In Russian, "Моя
  статистика" (14 chars) and "Новая работа" (12 chars) truncate. No icons means
  no fallback once the text is cut.
- `Layout.tsx` — the `md:` sidebar appears at 768px, but Analytics, Job Detail,
  Services and Export keep `max-w-md`/`max-w-2xl` until `lg:`. Between 768 and
  1023px an admin gets a full sidebar next to a 448px phone-width column and a
  large dead area. See `Analytics.tsx:194`, `JobDetail.tsx:78`,
  `Services.tsx:108`, `Export.tsx:90`.
- `JobDetail.tsx:78` is `max-w-md` with no `lg:` variant at all, so an admin
  reviewing a job on a 1440px screen reads it in a 448px column.

### Dashboard

- `Dashboard.tsx:128` — the literal string `no code` is hardcoded English, not
  routed through i18n, and appears in the Russian UI.
- `Dashboard.tsx:127` — the duplicate flag is a bare `⚠` glyph at `text-xs`
  with no label and no accessible name.
- `Dashboard.tsx:38-49` + `:100-105` — the query is scoped to today, but the
  search box is presented as a general search ("Search plate, VIN, or worker…")
  and returns "No jobs match your search" for anything older. The copy asserts
  a capability the screen does not have.
- `Dashboard.tsx:85-97` — flags are `text-xs` pills that only render when
  non-zero, so "zero problems today" and "flags haven't loaded" look identical.
- `Dashboard.tsx:107` — the loading state is the word "Loading…" in
  `text-sm text-slate-500`; on flaky yard wifi this reads as an empty day.

### Job Detail

- `JobDetail.tsx:59-64,132` — Delete fires immediately on tap with no
  confirmation, directly below the Save button in the same full-width stack.
  Compare `Services.tsx:169-183`, which *does* have an inline confirm step —
  the app has two different destructive patterns.
- `JobDetail.tsx:44` — service names always render `name_en`, ignoring
  `name_ru`, even though `ServiceChips.tsx:17` honours it. Russian-speaking
  managers see English service names here and only here.
- `JobDetail.tsx:142-148` — the `Row` component is `flex justify-between` with
  a right-aligned value. A 17-character VIN and a comma-joined service list
  collide with the label, and Russian labels (~2× longer) squeeze the value
  column further.
- `PhotoViewer.tsx:28-29` — the loading state is the character `…` and the
  failed state is the character `—`, both `text-sm text-slate-400`, inside a
  grey box. A manager cannot distinguish "still loading" from "this photo is
  gone" (photos expire after 90 days, so this state is real and will recur).

### My Jobs

- `MyJobs.tsx:89-97` — the 15-minute edit window is shown as a binary Edit /
  "Locked". The component re-renders every 20 seconds (`:27`) purely to flip
  that state, but never shows remaining time. The worker gets no warning.
- `en.json` `myJobs.empty` says "No jobs submitted yet today", but the query
  (`MyJobs.tsx:33-38`) has no date filter — it loads the last 50 jobs of all
  time. The copy and the data disagree.
- `MyJobs.tsx` has no loading state; the list renders empty, then pops.

### Analytics

- `Analytics.tsx:71-85` + `:217-232` — the worker and service filter options
  are built from whatever rows the current date range returned. Change the
  range and the options list is rebuilt; a previously selected filter can
  become an option that no longer exists, leaving a blank select while the
  numbers on screen quietly revert to unfiltered.
- `Analytics.tsx:235-238` — the tile grid is `grid-cols-2 lg:grid-cols-4` but
  contains only two tiles, so on desktop half the row is empty.
- `Analytics.tsx:191,208-233` — the date inputs and both selects are `py-1.5
  text-sm` ≈ 30px tall, in a `flex-wrap` row. This screen is manager-accessible
  on a phone.
- `BarChart.tsx:30-33,50` — charts have a computed pixel width inside
  `overflow-x-auto`. "Jobs by worker" at Site B (~10 workers) scrolls
  horizontally inside a card with no visible affordance that it does.
- `BarChart.tsx:79` — bar labels are `fontSize={10}` in `#898781` on white.
  That is roughly 3:1 contrast at 10px, on a screen a manager may read outdoors.
- `StatTile.tsx:4` — tile labels are `text-xs text-slate-500`; the number is
  legible, the thing it counts is not.

### Services / Team / Users

- `Services.tsx:136-141` — the reorder controls are bare `↑` / `↓` text glyphs
  with `px-1`, roughly 20×20px, adjacent to each other. They control the order
  workers see chips in, so a mis-tap here has downstream cost.
- `Services.tsx:117-118,160` — the placeholders "Name (English)" and "Name
  (Russian, optional)" are hardcoded English strings outside i18n.
- `Services.tsx:142-147` and `Team.tsx:44-52` and `admin/Users.tsx:130-135` —
  the Active/Inactive pill is simultaneously the status badge and the toggle
  button. It reads as a label and behaves as a destructive action, with no
  confirmation. `Team.tsx:49` disables it with `opacity-50` only, which reads
  as "loading" rather than "not permitted".
- `Team.tsx:42` and `admin/Users.tsx:121` — role is rendered as the raw
  lowercase enum (`worker`, `manager`, `admin`), untranslated. The role
  `<option>` values at `admin/Users.tsx:93-97,144-151` are the same raw strings.
- `admin/Sites.tsx:21-26` — Add has no validation, no feedback, no duplicate
  check, and there is no edit or delete. A typo in a site name is permanent and
  propagates to every export and analytics screen.

### Profile / Welcome / Login

- `Profile.tsx:66-94` — two visually identical card-forms with two identical
  full-width primary buttons and separately-tracked status banners. Nothing
  signals which button belongs to which form.
- `Welcome.tsx:58-64` — the expired/invalid invite state is a single line of
  `text-sm text-slate-600` on a blank page. No heading, no action, no contact.
- `Login.tsx` — there is no password-recovery affordance anywhere in the app.
  Flag this to the client (see §7); adding the flow is out of scope for the
  redesign, but the dead end is worth naming.

---

## 5. Explicitly out of scope

Do not do these. If you believe one is necessary, stop and raise it with the
product manager rather than doing it.

- **Backend or schema changes.** No new tables, columns, views, RPCs, RLS
  policies, or migrations. `supabase/migrations/` is frozen for this work.
- **Auth flow changes.** No new sign-in methods, no self-signup, no
  password-recovery flow, no session-handling changes. Restyle `Login.tsx` and
  `Welcome.tsx`; do not rewire them.
- **Adding libraries without justification.** No UI kit, icon font, animation
  library, chart library, or state manager. If something is genuinely
  unavoidable, justify it against payload size on mobile data and get it
  approved first. Inline SVG covers the icon need.
- **Dark mode.** Deferred by the client. Light mode only.
- **Changing what data is captured.** No new fields, no removed fields, no
  changed validation rules, no changed required/optional status, no changes to
  the XLSX export column names (the office depends on them).
- **Inventing brand.** No company name, no logo, no wordmark, no chosen brand
  palette presented as final. Placeholder tokens only, structured for swap.
- **New features.** This is a redesign of 14 existing screens. Reorganising
  information on a screen is in scope; adding a screen or a capability is not.

---

## 6. Definition of done

Checkable. Every item is either true or false.

**Brand-swap readiness**
- [ ] Zero hardcoded colour literals in `web/src/components/` and
      `web/src/pages/` — verified by grepping for hex values and for raw
      Tailwind palette classes that carry brand meaning.
- [ ] All brand-carrying values, including chart colours and the PWA
      `theme_color` / `background_color`, resolve from one token source.
- [ ] Swapping that token source changes the entire app, charts and install
      splash included, with no component edits. Demonstrate it once with a
      throwaway palette.
- [ ] A logo slot exists and is sized in the sign-in screen, the app shell
      (mobile header and desktop sidebar), and the PWA icon, and the app looks
      correct with the slot empty.

**Worker flow (Tier 1)**
- [ ] Submitting a job takes no more taps or screens than it does today —
      counted, on the current build vs. the new one.
- [ ] Tapping Submit with an invalid or incomplete form always produces an
      immediately visible response without scrolling.
- [ ] The success confirmation is unmistakable and does not persist into the
      next car's entry.
- [ ] Submitted / queued-offline / failed / editable / locked are each
      distinguishable at a glance and without relying on hue.
- [ ] Pending queued submissions are visible from every worker screen, and
      queued jobs appear in My Jobs.
- [ ] The remaining edit window is shown as time, not as a binary.

**Accessibility and environment**
- [ ] Every interactive element in the worker and manager phone flows measures
      ≥44×44px, verified in the browser, including chips, tab items, header
      controls, and reorder controls.
- [ ] All text meets WCAG AA contrast; anything a worker must read or act on
      exceeds it. No 10px chart labels in low-contrast grey.
- [ ] No status is communicated by colour alone anywhere in the app.
- [ ] Every screen has been viewed in **Russian** at 375px with no truncation,
      overflow, or horizontal page scroll — including the 5-tab manager bar.
- [ ] Every screen has been viewed at 375px, 768px, and 1440px, with no dead
      column between 768 and 1023px.
- [ ] Safe-area insets are honoured top and bottom in standalone PWA mode.

**Correctness fixes from §4**
- [ ] Every hardcoded English string is routed through i18n (`no code`, the
      Services placeholders, role names) and has a Russian translation.
- [ ] Job Detail renders `name_ru` for service names when the locale is Russian.
- [ ] Destructive actions (job delete, service delete, user deactivate) use one
      consistent confirmation pattern across the app.
- [ ] Status badges and action buttons are visually distinct; nothing is both.
- [ ] Loading, empty, and error states are distinguishable from each other on
      every screen that fetches — specifically Dashboard, My Jobs, Job Detail
      photos, Team, Services, Users, Analytics.
- [ ] Dashboard's search copy matches its actual scope.
- [ ] My Jobs' empty-state copy matches what it actually queries.
- [ ] Analytics filters cannot end up in a blank/undefined state when the date
      range changes.

**Non-regression**
- [ ] Every capability listed in PRODUCT.md § Capabilities is still reachable.
- [ ] No new runtime dependency in `web/package.json` without written approval.
- [ ] No file under `supabase/migrations/` or `worker/` was modified.
- [ ] `npm run build`, `npm run lint`, and `npm test` pass in `web/`.
- [ ] No raster images or font files added to `web/public/` beyond PWA icons.
- [ ] No dark-mode styles shipped.

---

## 7. Product risks and open questions

Raise these with the client; do not resolve them by choosing.

1. **Volume figures don't reconcile.** ~125 cars/day vs. ~250 New Job
   submissions/day. Confirm which is real before anyone sizes anything against
   it. The ranking in §1 holds either way.
2. **Company name and brand are unknown.** The repo/deploy name
   `koch_cars_report` is suggestive, not confirmation. The in-app name is
   currently the generic "Vehicle Prep Tracker". Do not treat either as the
   brand.
3. **No password recovery exists.** A worker who forgets their password is
   blocked until an admin intervenes. Out of scope here, but a real operational
   gap worth the client's decision.
4. **The manager tab bar has five items on a phone**, and Russian labels do not
   fit. If restructuring the navigation is unacceptable to the client, say so
   now — otherwise the designer needs latitude to change it.
5. **Nothing has been validated with a real worker in a real yard.** Every
   claim in §2 about field failure is reasoned from the code and the operating
   context, not observed. The pilot at the 2-worker site is the moment to check
   them.
