/**
 * The page column widths, the only place they are written down. Columns widen at
 * `md` with the shell's sidebar. NewJob's sticky submit bar reads `form` so it
 * can't drift from its column. Lives outside `ui.tsx` because an exported object
 * literal breaks React Fast Refresh for every page importing that file.
 */
export type PageWidth = 'form' | 'list' | 'wide' | 'full';

export const PAGE_WIDTH: Record<PageWidth, string> = {
  form: 'max-w-md md:max-w-xl',
  list: 'max-w-2xl md:max-w-3xl lg:max-w-5xl',
  wide: 'max-w-2xl md:max-w-4xl lg:max-w-6xl',
  /** The jobs grid: a spreadsheet replacement should use the screen it is on. */
  full: 'max-w-2xl md:max-w-4xl lg:max-w-6xl 2xl:max-w-[110rem]',
};
