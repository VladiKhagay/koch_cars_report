/**
 * The management tables.
 *
 * Users, services and sites are records an owner edits at a desk, in bulk. A
 * stack of cards forces you to scroll to compare two rows that differ in one
 * field; a table puts every row's role, site and status in the same column, so
 * scanning twenty people is one pass down a column instead of twenty reads.
 *
 * Below `md` the table scrolls sideways rather than reflowing into cards. One
 * layout means one set of behaviours to reason about, and a column stays where
 * the manager last saw it. Columns that can be dropped on a narrow screen say
 * so themselves via `hideBelow`.
 *
 * Rows are compact, because a manager scanning fifty of them is at a desk with
 * a mouse. The 44px tap floor is not abandoned, only made conditional: at a
 * coarse pointer `.table-dense` (in index.css) puts every inline control back
 * to full size, since these screens are used on a phone too.
 */
import type { CSSProperties, ReactNode } from 'react';

export function TableCard({
  toolbar,
  children,
  className = '',
}: {
  /** Search, filters, primary action — sits above the header row, inside the frame. */
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`table-dense overflow-hidden rounded-xl border border-line bg-surface shadow-card ${className}`}>
      {toolbar && <div className="border-b border-line p-3">{toolbar}</div>}
      {/* The scroll container is the table's own, so a wide table never makes
          the whole page scroll sideways. */}
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

/**
 * `minWidth` is the width the *full* column set needs, so it only applies from
 * `sm` up — the first breakpoint at which `hideBelow` columns come back. Below
 * it the table is whatever its two or three visible columns actually need, and
 * a phone gets no sideways scroll for columns it isn't being shown.
 */
export function Table({ children, minWidth = 44 }: { children: ReactNode; minWidth?: number }) {
  return (
    <table
      className="w-full border-collapse text-start text-sm sm:min-w-[var(--table-min)]"
      style={{ '--table-min': `${minWidth}rem` } as CSSProperties}
    >
      {children}
    </table>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-sunken">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

/** Logical, not physical: `end` is the right edge in English, the left in Hebrew. */
type Align = 'start' | 'end';
/** Tailwind can't see class names built at runtime, so both are written out. */
const ALIGN: Record<Align, string> = { start: 'text-start', end: 'text-end' };
const HIDE: Record<string, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
};

export function Th({
  children,
  align = 'start',
  hideBelow,
  className = '',
}: {
  children?: ReactNode;
  align?: Align;
  hideBelow?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <th
      scope="col"
      /* Sentence case, not letterspaced caps: a column header should read as a
         word, not as a database field name. */
      className={`border-b border-line px-3 py-[5px] text-xs font-semibold text-ink-500 ${ALIGN[align]} ${
        hideBelow ? HIDE[hideBelow] : ''
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function Tr({
  children,
  active,
  className = '',
}: {
  children: ReactNode;
  /** The row being edited or confirmed — holds its highlight and drops hover. */
  active?: boolean;
  className?: string;
}) {
  return (
    <tr
      className={`border-b border-line last:border-b-0 transition-colors duration-150 ${
        active ? 'bg-ink-50' : 'hover:bg-ink-50'
      } ${className}`}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  align = 'start',
  hideBelow,
  className = '',
  colSpan,
}: {
  children?: ReactNode;
  align?: Align;
  hideBelow?: 'sm' | 'md' | 'lg';
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`px-3 py-[5px] align-middle text-ink-900 ${ALIGN[align]} ${hideBelow ? HIDE[hideBelow] : ''} ${className}`}
    >
      {children}
    </td>
  );
}

/** The trailing action cluster. Pinned to the inline end and never wraps. */
export function TdActions({ children }: { children: ReactNode }) {
  return (
    <td className="w-px whitespace-nowrap py-[5px] pe-3 ps-2 text-end align-middle">
      <div className="flex items-center justify-end gap-0.5">{children}</div>
    </td>
  );
}

/**
 * A full-width panel under its row — edit forms that don't fit a cell,
 * confirmations, danger zones. Kept inside the table so the row it belongs to
 * stays adjacent and the columns don't shift.
 */
export function TrExpanded({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr className="border-b border-line last:border-b-0">
      <td colSpan={colSpan} className="bg-sunken px-4 py-4">
        {children}
      </td>
    </tr>
  );
}

/** The primary cell in a row: the name you scan for. */
export function CellTitle({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <span className={`font-medium text-ink-900 ${mono ? 'font-mono tracking-wide' : ''}`}>{children}</span>
  );
}

/**
 * `mono` is not styling — it is what marks a Latin-script identifier, and the
 * base layer pins those `direction: ltr; unicode-bidi: isolate`. CellTitle has
 * always had it; CellMuted did not, so the VIN column was the one identifier in
 * the app that a Hebrew page could re-sequence.
 */
export function CellMuted({
  children,
  lang,
  dir,
  mono,
}: {
  children: ReactNode;
  lang?: string;
  /** For RTL content sitting in an LTR table — a Hebrew name on an English page. */
  dir?: 'ltr' | 'rtl';
  mono?: boolean;
}) {
  return (
    <span lang={lang} dir={dir} className={`text-ink-600 ${mono ? 'font-mono' : ''}`}>
      {children}
    </span>
  );
}
