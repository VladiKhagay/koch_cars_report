---
name: Vehicle Prep Tracker
description: A calibrated instrument for recording vehicle prep work outdoors, on a phone, hundreds of times a day.
colors:
  paper: "#ffffff"
  canvas: "#f7f8fa"
  canvas-deep: "#f1f3f6"
  hairline: "#e7eaef"
  hairline-strong: "#d3d8e0"
  slate-mute: "#9aa1ae"
  slate-quiet: "#67707e"
  slate-secondary: "#525a67"
  slate-strong: "#3b424d"
  graphite-soft: "#282d35"
  brand-graphite: "#1e1e1e"
  graphite-deep: "#141414"
  lockup-grey: "#919396"
  confirm-wash: "#ecfdf5"
  confirm-edge: "#a7e3c6"
  confirm: "#047857"
  confirm-deep: "#036b4e"
  caution-wash: "#fffbeb"
  caution-edge: "#f5dfa6"
  caution: "#8a5a0b"
  alarm-wash: "#fef2f2"
  alarm-edge: "#f4c4bd"
  alarm: "#c0271d"
  alarm-deep: "#a52219"
typography:
  display:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, Liberation Sans, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: "2.5rem"
    letterSpacing: "-0.022em"
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, Liberation Sans, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: "2.125rem"
    letterSpacing: "-0.022em"
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, Liberation Sans, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.5rem"
    letterSpacing: "-0.014em"
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, Liberation Sans, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5rem"
    letterSpacing: "normal"
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, Liberation Sans, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.25rem"
    letterSpacing: "normal"
  micro:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, Liberation Sans, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: "1.125rem"
    letterSpacing: "normal"
  identifier:
    fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.25rem"
    letterSpacing: "normal"
rounded:
  sm: "6px"
  lg: "12px"
  xl: "16px"
  2xl: "20px"
spacing:
  tap: "44px"
  control: "48px"
  control-lg: "56px"
  page: "16px"
  page-md: "24px"
  page-lg: "32px"
components:
  button-primary:
    backgroundColor: "{colors.brand-graphite}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "{spacing.control}"
  button-primary-hover:
    backgroundColor: "{colors.graphite-soft}"
    textColor: "{colors.paper}"
  button-primary-active:
    backgroundColor: "{colors.graphite-deep}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.brand-graphite}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "{spacing.control}"
  button-secondary-hover:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.brand-graphite}"
  button-danger:
    backgroundColor: "{colors.alarm}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "{spacing.control}"
  button-primary-lg:
    backgroundColor: "{colors.brand-graphite}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 20px"
    height: "{spacing.control-lg}"
  chip-selected:
    backgroundColor: "{colors.brand-graphite}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 14px"
    height: "{spacing.control}"
  chip-unselected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.brand-graphite}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 14px"
    height: "{spacing.control}"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.brand-graphite}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 14px"
    height: "{spacing.control}"
  field-error:
    backgroundColor: "{colors.alarm-wash}"
    textColor: "{colors.brand-graphite}"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.brand-graphite}"
    rounded: "{rounded.xl}"
    padding: "16px"
  badge-ok:
    backgroundColor: "{colors.confirm-wash}"
    textColor: "{colors.confirm-deep}"
    typography: "{typography.micro}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  badge-warn:
    backgroundColor: "{colors.caution-wash}"
    textColor: "{colors.caution}"
    typography: "{typography.micro}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  badge-danger:
    backgroundColor: "{colors.alarm-wash}"
    textColor: "{colors.alarm-deep}"
    typography: "{typography.micro}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  nav-item-active:
    backgroundColor: "{colors.brand-graphite}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "{spacing.tap}"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.slate-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "{spacing.tap}"
---

# Design System: Vehicle Prep Tracker

## Overview

**Creative North Star: "The Calibrated Instrument"**

This is a measuring tool that happens to run in a browser. A worker holds it in one hand, next to a car, in direct sunlight, and uses it to record a fact — plate, VIN, service, photo — that a customer will later be billed against. Every visual decision answers to that scene. The body of the instrument is monochrome and quiet, because an instrument that decorates itself is competing with the reading it is supposed to give. Colour is the reading: it appears only where a state must register instantly, and it never appears alone.

The identity is inherited, not invented. Koch-Chemie supplies three values — a near-black (#1e1e1e), a grey (#919396), and white — and those are brand *moments*, not an interface. Building whole surfaces out of three monochrome values produced flat, dated grey; so the working ramp carries a slight cool cast that stays visually neutral beside the brand near-black while reading crisp rather than photocopier-grey. The exact brand near-black survives untouched as the darkest working step, where it does the most work: body text, the primary action, the selected chip, the active nav item.

Depth is structural, not decorative. Hairlines are deliberately light and carry only the edge of a thing; separation comes from a small, cool-tinted elevation vocabulary. Density is generous by mandate rather than by taste — nothing tappable is under 44px, and the spacing scale names that floor (`tap`, `control`, `control-lg`) so it is legible in the markup instead of buried in a padding value. The product is light-mode only by client decision, but every surface, line, and text value is a semantic alias over the ramp, so a future dark theme redefines aliases rather than components.

**Key Characteristics:**
- Monochrome body, one high-contrast action, status colour used sparingly and always doubled with an icon and a word
- A cool-cast neutral ramp anchored on the exact brand near-black
- One system font stack, no webfont — full Cyrillic and Hebrew coverage without shipping a file over mobile data
- Touch floors named in the token set, not implied by padding
- Elevation carries depth; hairlines only define edges
- Sentence case everywhere; no letterspaced all-caps micro-labels
- Latin-script identifiers (plate, VIN, catalog number) are pinned LTR and bidi-isolated inside any script

## Colors

A monochrome instrument with a cool cast, and three status hues held at restrained saturation so they register on a sunlit phone without competing with the brand.

### Primary

- **Brand Graphite** (#1e1e1e): The exact value supplied by the brand, and the only near-black in the system. It is body text, the primary button, the selected service chip, the active nav item, the pending-sync indicator, and the focus ring. Its ubiquity is the point — in a monochrome palette the highest-contrast pairing is also the most sunlight-legible one.
- **Graphite Deep** (#141414): The pressed state of anything Brand Graphite. Never used at rest.
- **Graphite Soft** (#282d35): The hover state of the primary action, and the voice for emphatic body copy that is not a heading.

### Secondary

- **Lockup Grey** (#919396): The brand's second value, kept addressable strictly for wordmark lockups. It is the secondary path of the Koch-Chemie mark and nothing else.

### Neutral

- **Paper** (#ffffff): The brand's white. Every card, field, sheet, header, sidebar, and tab bar. The app's default reading surface.
- **Canvas** (#f7f8fa): The page behind the paper. What makes a card read as a card.
- **Canvas Deep** (#f1f3f6): Pressed ghost buttons and skeleton fills — one step further into the page.
- **Hairline** (#e7eaef): The default border. Deliberately light: it defines an edge and then gets out of the way.
- **Hairline Strong** (#d3d8e0): The border of anything a finger is meant to find — fields, secondary buttons, unselected chips.
- **Slate Mute** (#9aa1ae): 2.9:1 on paper. Disabled controls and the glyph in an empty state. **Never text.**
- **Slate Quiet** (#67707e): 5.01:1 — the lightest value in the system that passes AA. Placeholders, inline field icons, inactive tab labels.
- **Slate Secondary** (#525a67): 6.96:1. Secondary body copy, the lead line under a page heading, definition-list terms.
- **Slate Strong** (#3b424d): Ghost button text and resting nav labels.

### Tertiary — status

Every status colour ships as a wash, an edge, and a text/fill value so a state can be expressed as a whole surface without ever relying on hue alone.

- **Confirm** (#047857 fill, 5.5:1 with white on it; #036b4e text, 6.5:1 on paper; wash #ecfdf5, edge #a7e3c6): a submission landed, a job is complete, a worker is active.
- **Caution** (#8a5a0b text, 5.9:1 on paper; wash #fffbeb, edge #f5dfa6): advisory and never blocking — a VIN checksum warning, a duplicate-plate flag, an OCR read that failed and needs typing in.
- **Alarm** (#c0271d fill, 5.9:1 with white on it; #a52219 text, 7.4:1 on paper; wash #fef2f2, edge #f4c4bd): destructive confirmation and blocking validation only.

### Named Rules

**The Lockup-Only Rule.** #919396 is a brand value, not a UI value. At 3.08:1 it is too heavy for a hairline and unusable for body copy. It appears in the wordmark and nowhere else. Borders come from Hairline / Hairline Strong; muted text comes from the Slate steps.

**The Never-Alone Rule.** Colour never carries meaning by itself. Every status surface pairs its hue with an icon *and* a word. A phone screen in direct sun loses hue long before it loses shape, and "which service did I tap" is not a question the worker can afford to get wrong.

**The One Dark Rule.** There is exactly one near-black. If a surface needs to be dark, it is Brand Graphite — not a second, softer black chosen for a particular screen.

## Typography

**Display / Body / Label Font:** system-ui stack (`-apple-system`, `Segoe UI`, `Roboto`, `Helvetica Neue`, `Arial`, `Noto Sans`, `Liberation Sans`)
**Identifier Font:** `ui-monospace` stack (`SF Mono`, `Menlo`, `Consolas`, `Liberation Mono`)

**Character:** One family, the platform's own. In Operate mode the tool should disappear into the task, and a system stack is the only way to get full Latin, Cyrillic, and Hebrew coverage without shipping a font file to a phone on yard wifi. The personality comes from the scale and the tracking, not from the face: headings are set slightly tight (-0.014em to -0.022em), because default system-stack tracking at display sizes reads loose and web-1.0.

### Hierarchy

- **Display** (600, 2.25rem / 2.5rem, tracking -0.022em): Reserved for the largest stat readouts and the signed-out headings. Rare.
- **Headline** (600, 1.75rem / 2.125rem, tracking -0.022em): The page title. One per screen.
- **Title** (600, 1rem / 1.5rem, tracking -0.014em): Card-level section headings, empty-state titles. Sentence case, optionally preceded by an 18px icon.
- **Body** (400, 1rem / 1.5rem): Field input text and reading copy. Field text stays at 1rem specifically — anything smaller triggers iOS zoom-on-focus, which is a broken form on a phone.
- **Label** (500–600, 0.875rem / 1.25rem): Field labels, button text, nav items, table cells, secondary copy. The workhorse.
- **Micro** (600, 0.8125rem / 1.125rem): Badges and dense metadata. Deliberately raised from the conventional 12px so that a stray micro label in a low-traffic screen still clears the legibility floor on a phone in sunlight.
- **Identifier** (500, monospace): Plates, VINs, catalog numbers, stat values.

### Named Rules

**The Sentence-Case Rule.** Every label, heading, and button is sentence case. Letterspaced all-caps micro-labels are banned outright: they read as a database column header rather than as the heading of the thing beneath them, and they are the single most dated treatment a modern product interface can wear.

**The Identifier Isolation Rule.** `font-mono` in this app marks exactly one thing: a Latin-script identifier. Those runs are pinned `direction: ltr` with `unicode-bidi: isolate` at the base layer, because inside a Hebrew paragraph the bidi algorithm treats a VIN's letters, digits, and separators as one mixed run and can reorder it. A VIN is not a sentence and must never be re-sequenced by the text around it. This also gives the correct caret direction when a worker types one.

**The 16px Field Rule.** Never set an input below 1rem. This is why the phone
never gets a smaller field: type is not the axis available for compacting a
form. Height is.

**The One-Step-Down Rule.** Exactly one role changes with the viewport, and it
changes by exactly one step of the scale: the largest heading on a screen sits
one step lower below `sm` and reaches its stated size from `sm` up. Page title
1.375 → 1.75rem; the signed-out heading and the job's plate 1.75 → 2.25rem.
Nothing else moves — labels, body, badges and table text are the same size on a
phone as on a laptop, because they are already at the legibility floor for a
sunlit screen and because a role that resizes twice is two roles.

The step exists because these headings are set in the largest sizes the system
has, and Russian runs 2–2.7× longer in short strings: at 28px "Моя статистика"
takes two lines above the first row of content on a 360px screen. The breakpoint
is `sm`, not `md` — this responds to the phone, not to the sidebar, so the
md-Not-lg Rule does not apply.

## Layout

Fixed rem scale at roughly a 1.2 ratio, no fluid clamps — product UI should not resize under the reader.

The shell is a single responsive frame one viewport tall (`dvh`), inside which only the content pane scrolls: below `md` a header plus a bottom tab bar; at `md` and above a persistent 240px sidebar and no tab bar. The bars are flex siblings of the scroller rather than `position: fixed` — that is what keeps the tab bar on the bottom edge whether a screen has three rows or three hundred, with no content padding to reserve space and nothing to re-measure when a label wraps to two lines. Because the sidebar arrives at `md`, page columns must widen at `md` too — widening at `lg` instead leaves a dead zone between 768 and 1023px where the content column is squeezed by a sidebar it hasn't made room for. All page widths therefore route through one container with three settings: `form` (28rem → 36rem), `list` (42rem → 48rem → 64rem), `wide` (42rem → 56rem → 72rem). No screen declares its own max-width.

Page padding steps 16 / 24 / 32px across the same breakpoints. Vertical rhythm gives a section heading more space above than below. iOS safe-area insets are applied as their own utility classes on their own elements, never combined with page padding on the same node — `padding-top: env(...)` would otherwise zero out the page's own top padding on every device without a notch.

The signed-out shell changes composition rather than scaling: on a phone the page *is* the form, full-bleed paper anchored near the top where a thumb and the keyboard both expect it; at 640px and up it becomes an elevated panel on the canvas.

Directional properties are logical throughout (`start` / `end`, `ps` / `pe`, `border-e`), so Hebrew mirrors without a second rule. Only `chevronLeft` and `chevronRight` flip in RTL; no other glyph does.

### Named Rules

**The One Container Rule.** A page never sets its own max-width. If a width is wrong, the container's three settings are wrong.

**The md-Not-lg Rule.** Any layout change that responds to the sidebar happens at `md`, because that is where the sidebar appears.

## Elevation & Depth

Layered, not flat, and deliberately not heavy. The system's hairlines are light enough that they cannot carry separation on their own; depth comes from a small elevation vocabulary instead, which is what lets a light border recede. Shadows are tinted cool (`rgb(16 24 40)`) rather than neutral black — a black shadow at low opacity reads as a grey smudge.

### Shadow Vocabulary

- **Card** (`0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.06)`): every resting card, list row, skeleton, and empty state. Barely there by design.
- **Raised** (`0 4px 8px -2px rgb(16 24 40 / 0.06), 0 12px 24px -6px rgb(16 24 40 / 0.1)`): surfaces that float above the canvas — the sign-in panel at ≥640px, sheets, large panels.
- **Bar** (`0 -1px 2px 0 rgb(16 24 40 / 0.04), 0 -8px 24px -8px rgb(16 24 40 / 0.1)`): upward-cast, exclusively for the bottom tab bar.

### Named Rules

**The Border-Plus-Elevation Rule.** A card carries both a hairline and the Card shadow. The hairline defines where the surface ends; the shadow says it is above the page. Neither alone is enough at this contrast level.

## Shapes

Soft, generous corners on a strict three-step scale: 12px for anything a finger operates (buttons, fields, chips, nav items), 16px for cards and photo tiles, 20px for sheets, large panels, and the elevated sign-in surface. Badges sit below the scale at 6px because they are read, not tapped, and a full-radius pill would read as a button.

Borders are 1px, always. Every interactive surface is bordered — including filled ones, where the border matches the fill — so that a control's silhouette is identical whether or not it is selected and nothing shifts by a pixel on state change. Icon-only controls are square (48×48), never circular.

One focus treatment exists for the entire app: a 2px Brand Graphite outline at 2px offset. The offset is what keeps it visible on the near-black primary button.

### Named Rules

**The No-Shift Rule.** State changes swap colour, never geometry. A selected chip and an unselected chip occupy exactly the same box.

## Components

### Buttons

- **Shape:** 12px radius, 1px border always present.
- **Sizes:** default 48px tall with 16px inline padding and label type; large 56px with 20px padding and body type, for primary actions and the tab bar.
- **Primary:** Brand Graphite fill, Paper text, matching border. Hover Graphite Soft, active Graphite Deep.
- **Secondary:** Paper fill, Brand Graphite text, Hairline Strong border. Hover Canvas, active Canvas Deep.
- **Ghost:** transparent, Slate Strong text, transparent border. Hover Canvas Deep.
- **Danger:** Alarm fill, Paper text. Reserved for the confirming half of a destructive action.
- **Busy:** renders a spinner in place of the icon, sets `aria-busy`, and blocks repeat taps. Disabled sits at 45% opacity.
- **Icon-only:** always square (48×48) and always takes a label, which becomes both the accessible name and the tooltip. An icon never stands alone unnamed.

### Chips

The service selector — the most-tapped control in the product, one tap per car, hundreds of times a day.

- **Style:** 48px tall, 12px radius, label type.
- **Unselected:** Paper fill, Brand Graphite text, Hairline Strong border, a `plus` glyph.
- **Selected:** Brand Graphite fill, Paper text, matching border, a `check` glyph.
- **Behavior:** a true radio group with roving tabindex, so a screen reader announces "3 of 7" and arrow keys move between options. Horizontal arrows follow reading direction — in Hebrew, ArrowLeft is "next". Selection is marked by the glyph *and* the fill, never by colour alone.

### Cards / Containers

- **Corner:** 16px (20px for sheets and large panels).
- **Background:** Paper on Canvas.
- **Border:** 1px Hairline. **Shadow:** Card.
- **Padding:** 16px, stepping to 24px on larger surfaces.

### Inputs / Fields

- **Style:** 48px tall, Paper fill, 1px Hairline Strong border, 12px radius, 14px inline padding, body type at 1rem.
- **Focus:** border shifts to Brand Graphite, plus the global focus ring.
- **Error:** Alarm border and Alarm Wash fill, with the message below the field in Alarm Deep, led by an `alertCircle` glyph.
- **Advisory:** a separate non-blocking notice in Caution with an `alertTriangle` glyph — used for checksum warnings and duplicate flags, which inform without stopping the submission.
- **Label:** sentence case, label type, Slate Strong, 8px above the field; an optional marker and hint sit inline beside it in Slate Quiet.
- **Select:** the native arrow is switched off and one chevron is drawn at a known inline-end offset with reserved padding, so long option text cannot slide under it and the arrow lands on the correct side in Hebrew. The chevron is pointer-transparent so the whole control still opens the native picker. The one control that is shorter on a phone: 44px below `sm`, 48px from `sm` up. A select is tapped once and hands off to the platform picker — nothing is typed into it and no keyboard is open while it is aimed at — so it can sit on the tap floor where a text field cannot, and a filter panel stacking four of them gets its height back. A select that carries a free-text name (a site, a worker) takes the full row width on a phone rather than sharing it; a dropdown you have to open to find out what it says is not a filter.
- **Search:** the magnifier sits inside the field at the inline start with matching padding. One search control for every filtered list in the app.

### Navigation

- **Sidebar (≥md):** 240px, Paper, inline-end hairline, wordmark at the top. Items are 44px minimum, label type, 12px radius; active is a Brand Graphite fill with Paper text, resting is Slate Strong with a Slate Quiet glyph and a Canvas Deep hover.
- **Tab bar (<md):** pinned to the bottom edge of the shell, Paper, top hairline, Bar shadow, 56px minimum per tab, icon above an 11px label. The active tab is marked by a 2px Brand Graphite rule across the top of the slot *plus* a heavier icon stroke *plus* colour — position and weight, not colour alone. A fifth slot is spent on a single "More" entry rather than crowding in two more tabs.
- **Header (<md):** pinned to the top edge of the shell, Paper, bottom hairline, wordmark at the inline start, account and sync indicator at the end.

### Badges

Read-only status markers, deliberately not buttons and never wired to an action. 6px radius, micro type, 1px border, icon plus word. Five tones: neutral (Canvas fill, Hairline edge), info (Brand Graphite fill, Paper text), ok, warn, danger.

### Confirm Action

The app's one destructive pattern. The trigger is a secondary button; tapping it swaps the control in place for an explicit question panel with a confirm and a cancel. Nothing destructive fires on first tap, and job delete, service delete, user deactivation, and sign-out all route through it — so the interaction is identical wherever it appears. Only genuinely destructive confirmations wear Alarm; sign-out uses the same panel in neutral, because an alarm colour on a routine action is how people learn to ignore it.

### Photo Capture

Three explicit states, each distinguished by glyph and border weight as well as colour: empty (camera glyph, field name, both supply routes), processing (spinner, "Reading photo…"), success (real thumbnail plus Retake, with a Caution hint when OCR could not read the value). OCR failure is never a dead end — "Type it in" is always one tap away and focuses the matching field.

### Loading and Empty States

Loading renders a skeleton shaped like the list it replaces, never a spinner, wrapped in a polite live region with a screen-reader-only label. Empty states say what the screen is for and what to do next; on a flaky yard connection, "nothing here" is indistinguishable from "this is broken."

## Do's and Don'ts

### Do:

- **Do** resolve every brand-carrying value from the `@theme` block in `web/src/index.css`. It is the single source of truth; swapping the ramp should re-skin the product, charts, and install splash with no component edits.
- **Do** pair every status colour with an icon and a word.
- **Do** keep anything tappable at 44px minimum, and use the named `tap` / `control` / `control-lg` tokens so the floor is visible in the markup.
- **Do** set inputs at 1rem or larger, always.
- **Do** use logical directional properties (`start`/`end`, `ps`/`pe`, `border-e`) so Hebrew mirrors for free.
- **Do** mark Latin-script identifiers with the monospace role, which pins them LTR and bidi-isolates them.
- **Do** paint charts with token-bound fill/stroke utilities so they swap with the palette.
- **Do** give a card both a hairline and the Card shadow.
- **Do** route every page's width through the one container, widening at `md`.
- **Do** name an icon-only control; the label is both its accessible name and its tooltip.

### Don't:

- **Don't** build surfaces out of the three brand values alone (#1e1e1e / #919396 / #ffffff). That combination produced the flat, dated grey this system was built to replace. The brand values are moments; the cool-cast ramp is the interface.
- **Don't** use Lockup Grey (#919396) for hairlines, borders, or body text. At 3.08:1 it fails both.
- **Don't** mute the status hues toward sepia. Muddied status colour was the main reason the earlier pass read as dated; they are held at restrained saturation, not desaturated.
- **Don't** use letterspaced all-caps micro-labels anywhere.
- **Don't** use Slate Mute (#9aa1ae) as text. It is 2.9:1 — disabled states and empty-state glyphs only.
- **Don't** introduce a second near-black, a second accent, or a webfont.
- **Don't** let a state change alter geometry; swap colour, keep the box.
- **Don't** write a hex value, a `slate-*` utility, or a raw pixel radius into a component.
- **Don't** wire a badge to an action, or let anything destructive fire on first tap.
- **Don't** ship a dark theme. Light mode is a client decision; the structure is dark-ready, but the decision is not ours to reverse.
- **Don't** add a decorative icon, or an icon tile above a heading.
