import type { Cell } from './exports';
import type { ExportLang } from './reportConfig';

/**
 * A one-sheet workbook from a cell grid. Hebrew files open right to left (the
 * first column on the right, as the reader's eye starts); SheetJS writes
 * `wb.Workbook.Views[0].RTL` as the sheet view's `rightToLeft`.
 *
 * SheetJS is imported here, on demand, because it is a sizeable library that
 * only the export screens need.
 */
export async function buildWorkbook(rows: Cell[][], sheetName: string, lang: ExportLang) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), sheetName);
  if (lang === 'he') workbook.Workbook = { Views: [{ RTL: true }] };
  return { XLSX, workbook };
}

/** Builds the workbook and downloads it. */
export async function downloadWorkbook(rows: Cell[][], sheetName: string, fileName: string, lang: ExportLang) {
  const { XLSX, workbook } = await buildWorkbook(rows, sheetName, lang);
  XLSX.writeFile(workbook, fileName);
  return fileName;
}

/* ------------------------------------------------- remembered language */

const DEFAULT_EXPORT_LANG: ExportLang = 'he';

const exportLangKey = (userId: string) => `exportLang:${userId}`;

/** Hebrew unless this person chose otherwise. Keyed by user id so a shared device keeps each person's choice. */
export function getExportLang(userId: string | undefined): ExportLang {
  if (!userId) return DEFAULT_EXPORT_LANG;
  try {
    const stored = localStorage.getItem(exportLangKey(userId));
    return stored === 'en' || stored === 'he' ? stored : DEFAULT_EXPORT_LANG;
  } catch {
    return DEFAULT_EXPORT_LANG;
  }
}

export function setExportLang(userId: string | undefined, lang: ExportLang) {
  if (!userId) return;
  try {
    localStorage.setItem(exportLangKey(userId), lang);
  } catch {
    /* storage blocked: the choice just does not persist */
  }
}
