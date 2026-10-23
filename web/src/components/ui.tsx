/**
 * The app's shared controls: one button, field, badge and confirmation shape on
 * every screen. Interactive elements default to at least `min-h-tap` (44px)
 * because the primary user holds a phone in one hand next to a car.
 */
import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage, type Lang } from '../lib/i18n';
import Icon, { type IconName } from './Icon';
import { PAGE_WIDTH, type PageWidth } from '../lib/pageWidth';

/* ------------------------------------------------------------------ layout */

/**
 * The single page container: one max-width source (lib/pageWidth) and the
 * page's vertical rhythm. Three intervals only: section (24/32px, between
 * subjects, this container), group (16px, {@link Group}) and tight (8px,
 * `space-y-2`, rows of one list).
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

/** Blocks that answer the same question, held closer together than the sections around them. */
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
        {/* Steps down on a phone. 28px is a page title on a laptop; on a 360px
            screen it is two wrapped lines of "Моя статистика" before the first
            row of content, and the title's job is orientation, not spectacle. */}
        <h1 className="text-2xl font-semibold tracking-tighter text-ink-900 sm:text-3xl">{children}</h1>
        {lead && <p className="mt-1.5 max-w-prose text-base text-ink-600">{lead}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * The card owns its padding (16px) so screens don't each invent one.
 * `padding={false}` is for cards whose children own the edges (a table, a list).
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

/** Heading for a card-level section: more space above than below, sentence case. */
export function SectionHeading({ icon, children }: { icon?: IconName; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight text-ink-900">
      {icon && <Icon name={icon} size={18} className="text-ink-500" />}
      {children}
    </h2>
  );
}

/**
 * The signed-out shell (sign-in and invite landing). Phone: the page is the
 * form, anchored near the top. 640px and up: an elevated panel on the canvas.
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
 * Language switch, the only way to change language. Both options are always
 * shown in their own language, and it appears on signed-out screens too.
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

/** One label-over-value row of a read-only detail card (a `dl` child). */
export function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-b border-line pb-3 last:border-0 last:pb-0">
      <dt className="text-sm font-medium text-ink-600">{label}</dt>
      <dd className={`mt-0.5 break-words text-ink-900 ${mono ? 'font-mono tracking-wide' : ''}`}>{value}</dd>
    </div>
  );
}

/** Label + value pairs that are read, not edited. A real `dl` for screen readers. */
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

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'incomplete';
type Size = 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  // Near-black on white. The brand palette is monochrome, so the highest-
  // contrast pairing in it is also the most sunlight-legible primary action.
  primary: 'bg-accent text-surface hover:bg-accent-hover active:bg-ink-950 border border-accent',
  secondary: 'bg-surface text-ink-900 border border-line-strong hover:bg-ink-50 active:bg-ink-100',
  ghost: 'bg-transparent text-ink-700 border border-transparent hover:bg-ink-100 active:bg-ink-200',
  // Still tappable (a tap lists what is missing), but visibly not ready.
  incomplete: 'bg-ink-200 text-ink-600 border border-line-strong hover:bg-ink-200',
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

/** Square icon-only control. `label` is both the accessible name and the tooltip. */
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
      /* `icon-btn` is the hook the dense-table rules compact against. It marks
         "this control is a square glyph, safe to shrink to 30px in a table
         row" — which a button carrying a text label is not. */
      className={`icon-btn inline-flex size-control shrink-0 items-center justify-center rounded-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT[variant]} ${className}`}
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
 * The app's one destructive pattern: the trigger swaps for an explicit
 * "are you sure" row, so nothing destructive fires on first tap.
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

/** The armed half of {@link ConfirmAction}, for table rows that ask in a panel beneath the row. */
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

/** Search box with the magnifier inside the field; used by every filtered list. */
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

/**
 * Everything a field looks like except height (two competing `h-*` classes
 * resolve by stylesheet order). Type stays 1rem at every width: smaller
 * triggers iOS zoom-on-focus.
 */
const fieldBase =
  'w-full rounded-lg border border-line-strong bg-surface px-3.5 text-base text-ink-900 transition-colors duration-150 focus:border-ink-900';

export const fieldClass = `h-control ${fieldBase}`;

export const fieldErrorClass = 'border-danger-600 bg-danger-50';

/**
 * Native <select> with the platform arrow replaced by one chevron at a known
 * offset (inline-end padding, so it flips in Hebrew). `pointer-events-none` on
 * the chevron keeps the whole control opening the native picker. Sits at the
 * 44px tap floor on a phone and 48px from `sm` up; text fields stay 48px.
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
        className={`h-tap sm:h-control ${fieldBase} ${
          invalid ? fieldErrorClass : ''
        } appearance-none pe-11 ${className}`}
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
 * A read-only status marker, deliberately not a button. Always an icon and a
 * word, so state survives colour-blindness and direct sun.
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

/** Empty states say what the screen is for and what to do next: "nothing here" reads as broken on a flaky connection. */
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
