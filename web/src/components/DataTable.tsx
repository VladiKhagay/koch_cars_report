/**
 * The management tables (users, services, sites): edited in bulk at a desk, so
 * a table beats cards for scanning. Below `md` it scrolls sideways rather than
 * reflowing; `hideBelow` drops columns on a narrow screen. Rows are compact, but
 * at a coarse pointer `.table-dense` (index.css) restores the 44px tap floor.
 */
import type { CSSProperties, ReactNode } from 'react';

export function TableCard({
  toolbar,
  children,
  className = '',
  stickyHeader,
}: {
  /** Desktop only: the table scrolls inside the card and its header row stays put. */
  stickyHeader?: boolean;
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
      <div
        className={`overflow-x-auto ${
          stickyHeader
            ? 'md:max-h-[calc(100dvh-15rem)] md:overflow-y-auto md:[&_thead_th]:sticky md:[&_thead_th]:top-0 md:[&_thead_th]:z-10 md:[&_thead_th]:bg-sunken'
            : ''
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** `minWidth` is the full column set's width, applied from `sm` up where `hideBelow` columns return; a phone gets no sideways scroll for hidden columns. */
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
  ariaSort,
}: {
  children?: ReactNode;
  align?: Align;
  hideBelow?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Set on every sortable column of a sortable table — including the ones
   *  currently unsorted (`none`), which is how a screen reader learns they can
   *  be sorted at all. Belongs on the cell, not on the button inside it. */
  ariaSort?: 'ascending' | 'descending' | 'none';
}) {
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
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

/** A full-width panel under its row (edit forms, confirmations), kept inside the table so columns don't shift. */
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

/** `mono` marks a Latin-script identifier: the base layer pins it `direction: ltr; unicode-bidi: isolate` so a Hebrew page can't re-sequence it. */
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
