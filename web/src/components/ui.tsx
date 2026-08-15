/**
 * The app's shared control vocabulary.
 *
 * One button shape, one field shape, one badge shape, one confirmation
 * pattern — used on every screen. In Operate mode consistency is the feature:
 * a manager who learned "Save" on Job Detail should not have to re-learn it on
 * Services.
 *
 * Sizing is not decoration here. Every interactive element defaults to at
 * least `min-h-tap` (44px) because the primary user is holding a phone in one
 * hand next to a car; the `tap` / `control` spacing tokens make that floor
 * visible in the markup instead of buried in a padding value.
 */
import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage, type Lang } from '../lib/i18n';
import Icon, { type IconName } from './Icon';
import { PAGE_WIDTH, type PageWidth } from '../lib/pageWidth';

/* ------------------------------------------------------------------ layout */

/**
 * The single page container: one max-width source (see lib/pageWidth) and the
 * page's vertical rhythm, which it owns so no screen has to repeat a spacing
 * class.
 *
 * There are exactly three intervals in this app, and the contrast between them
 * is what makes a screen scannable at a glance:
 *
 *   section  24 / 32px   the gap between subjects — this container. A page's
 *                        direct children are the questions the screen answers,
 *                        and the title is one of them, so it gets the same
 *                        generous break and finally reads as owning what
 *                        follows rather than as another slab in the stack.
 *   group    16px        {@link Group}: blocks that answer the SAME question —
 *                        a day stepper and the flags for that day, a stat trio
 *                        and its chart, a table and its pager.
 *   tight     8px        `space-y-2`: rows of one list.
 *
 * Everything used to be 20px, which is none of these: with one interval
 * repeated, proximity carried no meaning and grouping fell to drawing a card
 * around things.
 */
export function Page({
  width = 'form',
  children,
  className = '',
}: {
  width?: PageWidth;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full space-y-6 p-4 md:space-y-8 md:p-6 lg:p-8 ${PAGE_WIDTH[width]} ${className}`}>
      {children}
    </div>
  );
}

/**
 * Blocks that answer the same question as each other, held closer together
 * than the sections around them. Proximity does the grouping, so the parts
 * don't each need a container to look related.
 */
export function Group({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`space-y-4 ${className}`}>{children}</div>;
}

export function PageHeading({
  children,
  lead,
  action,
}: {
  children: ReactNode;
  /** One line of orientation under the title. Kept optional — most screens don't need it. */
  lead?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tighter text-ink-900">{children}</h1>
        {lead && <p className="mt-1.5 max-w-prose text-sm text-ink-600">{lead}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * The card owns its own padding.
 *
 * It used to ship with none, so all eleven call sites invented one: six chose
 * 16px and five chose 20px — a value that is not on the spacing scale at all.
 * A shared primitive that leaves its most-used decision to the caller is how a
 * system drifts one screen at a time, so the default is now the documented
 * 16px. `padding={false}` is for the cards whose children own the edges (a
 * table, a list that draws its own dividers).
 */
export function Card({
  children,
  className = '',
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-line bg-surface shadow-card ${padding ? 'p-4' : ''} ${className}`}>
      {children}
    </div>
  );
}

/**
 * Heading for a card-level section. More space above than below, per house
 * rhythm. Sentence case rather than the letterspaced all-caps micro-label the
 * first pass used — that treatment is the single most dated thing a modern
 * product interface can wear, and it reads as a system label rather than as
 * the heading of the thing beneath it.
 */
export function SectionHeading({ icon, children }: { icon?: IconName; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-base font-semibold tracking-tight text-ink-900">
      {icon && <Icon name={icon} size={18} className="text-ink-500" />}
      {children}
    </h2>
  );
}

/**
 * The signed-out shell: sign-in and the invite landing page.
 *
 * These are the first two screens anyone sees, and a small form floating in
 * the middle of an empty viewport is what makes a product read as unfinished.
 * So the composition changes with the device rather than scaling one box:
 *  - phone: the page IS the form. Full-bleed paper, real page padding, content
 *    anchored near the top where a thumb and the keyboard both expect it.
 *  - ≥640px: the form becomes an elevated panel on the sunken canvas, which is
 *    where the depth in the token set finally has something to do.
 */
export function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    /* The inset padding lives on its own element: `.safe-top` sets padding-top
       outright, so putting it on the same node as `py-10` would zero the page's
       own top padding on every device without a notch. */
    <div className="safe-top safe-bottom flex min-h-full flex-col bg-surface sm:bg-sunken">
      <div className="flex flex-1 flex-col px-5 py-10 sm:px-6 sm:py-12">
        {/* Centred with auto margins rather than `justify-center`. Centring on
            the main axis pushes the overflow of a too-tall panel off BOTH ends,
            and you cannot scroll above the top of a document — so on a phone in
            landscape the heading became unreachable. Auto margins centre only
            while there is room to spare. */}
        <div className="mx-auto w-full max-w-md sm:my-auto">
          <div className="sm:rounded-2xl sm:border sm:border-line sm:bg-surface sm:p-8 sm:shadow-raised">
            {children}
          </div>
          {footer && <div className="mt-8 flex justify-center sm:mt-6">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * Language switch. Both options are always visible and labelled in their own
 * language — a single toggle showing the *other* language is a coin flip for
 * someone who can't read the current one.
 *
 * This is the only way to change language in the app, so it is not decoration:
 * it appears on the signed-out screens (a Russian-speaking worker meets the
 * sign-in form before they have an account to carry a preference) and in
 * Profile.
 */
function currentLang(resolved: string): Lang {
  return (LANGUAGES.find((l) => resolved.startsWith(l.code))?.code ?? 'en') as Lang;
}

export function LanguageToggle({ compact, block }: { compact?: boolean; block?: boolean }) {
  const { t, i18n } = useTranslation();
  const current = currentLang(i18n.language);

  return (
    <div
      role="group"
      aria-label={t('common.language')}
      className={`${block ? 'flex' : 'inline-flex'} gap-1 rounded-xl border border-line bg-sunken p-1`}
    >
      {LANGUAGES.map((lang) => {
        const active = current === lang.code;
        return (
          <button
            key={lang.code}
            type="button"
            lang={lang.code}
            aria-pressed={active}
            onClick={() => setLanguage(lang.code)}
            className={`inline-flex min-h-tap flex-1 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors duration-150 ${
              active ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-600 hover:text-ink-900'
            }`}
          >
            {compact ? lang.short : lang.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Label + value pairs that are read, not edited (account email, role, site).
 * A real `dl` so a screen reader announces the pairing.
 */
export function DataList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line">
      {items.map((item, i) => (
        <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
          <dt className="text-sm text-ink-600">{item.label}</dt>
          <dd className="min-w-0 break-words text-end text-sm font-medium text-ink-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ----------------------------------------------------------------- buttons */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  // Near-black on white. The brand palette is monochrome, so the highest-
  // contrast pairing in it is also the most sunlight-legible primary action.
  primary: 'bg-ink-900 text-surface hover:bg-ink-800 active:bg-ink-950 border border-ink-900',
  secondary: 'bg-surface text-ink-900 border border-line-strong hover:bg-ink-50 active:bg-ink-100',
  ghost: 'bg-transparent text-ink-700 border border-transparent hover:bg-ink-100 active:bg-ink-200',
  danger: 'bg-danger-600 text-surface border border-danger-600 hover:bg-danger-700 active:bg-danger-700',
};

const SIZE: Record<Size, string> = {
  md: 'min-h-control px-4 text-sm',
  lg: 'min-h-control-lg px-5 text-base',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  /** Renders a spinner and the busy label, and blocks repeat taps. */
  busy?: boolean;
  block?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  busy,
  block,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${
        VARIANT[variant]
      } ${SIZE[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {busy ? <Spinner /> : icon && <Icon name={icon} size={size === 'lg' ? 20 : 18} />}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/**
 * Square icon-only control. Always takes an `label`, which becomes both the
 * accessible name and the tooltip — an icon never stands alone unnamed.
 */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  className = '',
  ...rest
}: { icon: IconName; label: string; variant?: Variant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-control shrink-0 items-center justify-center rounded-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      <Icon name={icon} size={20} />
    </button>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
      style={{ width: size, height: size, opacity: 0.75 }}
    />
  );
}

/* ------------------------------------------------------------ destructive */

/**
 * The app's ONE destructive pattern. Tapping the trigger swaps it for an
 * explicit "are you sure" row; nothing destructive ever fires on first tap.
 * Job delete, service delete and user deactivation all route through this, so
 * the interaction is identical wherever a manager meets it.
 */
export function ConfirmAction({
  trigger,
  question,
  confirmLabel,
  icon = 'trash',
  onConfirm,
  variant = 'danger',
  block,
}: {
  trigger: string;
  question: string;
  confirmLabel: string;
  icon?: IconName;
  onConfirm: () => void;
  variant?: 'danger' | 'secondary';
  block?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  const destructive = variant === 'danger';

  if (!armed) {
    return (
      <Button
        variant="secondary"
        icon={icon}
        block={block}
        onClick={() => setArmed(true)}
        className={destructive ? 'border-danger-200 text-danger-700 hover:bg-danger-50' : ''}
      >
        {trigger}
      </Button>
    );
  }

  return (
    <ConfirmPanel
      question={question}
      confirmLabel={confirmLabel}
      icon={icon}
      variant={variant}
      onConfirm={() => {
        setArmed(false);
        onConfirm();
      }}
      onCancel={() => setArmed(false)}
    />
  );
}

/**
 * The armed half of {@link ConfirmAction}, on its own.
 *
 * The table rows arm from an icon button in the actions column and ask the
 * question in a panel beneath the row, so the trigger and the question can't
 * live in the same component — but the question itself must look and behave
 * identically wherever it appears.
 */
export function ConfirmPanel({
  question,
  confirmLabel,
  icon = 'trash',
  onConfirm,
  onCancel,
  variant = 'danger',
}: {
  question: string;
  confirmLabel: string;
  icon?: IconName;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'secondary';
}) {
  const { t } = useTranslation();
  const destructive = variant === 'danger';

  /* Same interaction either way; only the temperature changes. Signing out and
     deleting a job both deserve a second tap, but only one of them deserves
     red — an alarm colour on a routine action is how people learn to ignore it. */
  return (
    <div
      className={`rounded-xl border p-4 ${
        destructive ? 'border-danger-200 bg-danger-50' : 'border-line bg-surface'
      }`}
    >
      <p
        className={`mb-3 flex items-start gap-2 text-sm font-medium ${
          destructive ? 'text-danger-700' : 'text-ink-800'
        }`}
      >
        <Icon name={destructive ? 'alertTriangle' : 'info'} size={18} className="mt-0.5 shrink-0" />
        <span>{question}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant={destructive ? 'danger' : 'primary'} icon={icon} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Search box with the magnifier inside the field. Used by every screen that
 * filters a list, so the control a manager learns on the dashboard is the same
 * one they meet on the user table.
 */
export function SearchField({
  value,
  onChange,
  label,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  /** Placeholder and accessible name — the field carries no visible label. */
  label: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Icon
        name="search"
        size={20}
        className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-500"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        className={`${fieldClass} ps-11`}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ fields */

export const fieldClass =
  'h-control w-full rounded-lg border border-line-strong bg-surface px-3.5 text-base text-ink-900 transition-colors duration-150 focus:border-ink-900';

export const fieldErrorClass = 'border-danger-600 bg-danger-50';

/**
 * Native <select> with the platform arrow replaced.
 *
 * `fieldClass` alone is wrong for a select: the browser draws its own arrow
 * at a position we don't control and the symmetric padding lets long option
 * text slide underneath it. So the native affordance is switched off and one
 * chevron is drawn at a known offset, with inline-end padding reserved for it —
 * logical, so it lands on the left of the field in Hebrew without a second rule.
 *
 * The chevron is `pointer-events-none` so the whole control still opens the
 * native picker — which is what we want on a phone.
 */
export function Select({
  className = '',
  invalid,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <div className="relative">
      <select
        {...props}
        className={`${fieldClass} ${invalid ? fieldErrorClass : ''} appearance-none pe-11 ${className}`}
      >
        {children}
      </select>
      <Icon
        name="chevronDown"
        size={18}
        className="pointer-events-none absolute end-3.5 top-1/2 -translate-y-1/2 text-ink-500"
      />
    </div>
  );
}

export function Field({
  label,
  hint,
  optional,
  error,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  optional?: boolean;
  error?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      {/* Sentence case, not letterspaced caps. The all-caps micro-label reads as
          a database column header; a field label should read as a question. */}
      <label
        htmlFor={htmlFor}
        className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-ink-700"
      >
        <span>{label}</span>
        {optional && <span className="text-ink-500">{t('common.optional')}</span>}
        {hint}
      </label>
      {children}
      {error && (
        <p className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-danger-700">
          <Icon name="alertCircle" size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/** Advisory, not blocking — checksum warnings and duplicate flags use this. */
export function FieldNotice({ children, icon = 'alertTriangle' }: { children: ReactNode; icon?: IconName }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-warn-700">
      <Icon name={icon} size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ status */

export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger';

const BADGE_TONE: Record<Tone, string> = {
  neutral: 'border-line bg-ink-50 text-ink-700',
  info: 'border-ink-900 bg-ink-900 text-surface',
  ok: 'border-ok-200 bg-ok-50 text-ok-700',
  warn: 'border-warn-200 bg-warn-50 text-warn-700',
  danger: 'border-danger-200 bg-danger-50 text-danger-700',
};

/**
 * A read-only status marker. Deliberately NOT a button and never wired to an
 * action — the old UI used one element as both the "Active" badge and the
 * deactivate control, which is how a manager locks out a worker mid-shift by
 * tapping what looks like a label.
 *
 * Always renders an icon AND a word, so state survives both colour-blindness
 * and a phone screen in direct sun.
 */
export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold ${BADGE_TONE[tone]}`}
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

/* --------------------------------------------------------- loading / empty */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-ink-100 ${className}`} />;
}

/** Loading placeholder shaped like the list it replaces, not a spinner. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="mt-2.5 h-3 w-3/5" />
          <Skeleton className="mt-2 h-3 w-1/4" />
        </div>
      ))}
    </div>
  );
}

export function LoadingRegion({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <SkeletonList rows={rows} />
    </div>
  );
}

/**
 * Empty states say what the screen is for and what to do next — "nothing here"
 * is indistinguishable from "this is broken" on a flaky yard connection.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-6 py-14 text-center shadow-card">
      <Icon name={icon} size={24} className="mx-auto mb-4 text-ink-400" />
      <p className="text-base font-semibold tracking-tight text-ink-900">{title}</p>
      {body && <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-600">{body}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

/** sr-only helper for live regions that must not be visible. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
