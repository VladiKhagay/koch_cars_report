import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWorkbook, getExportLang, setExportLang } from './excelFile';
import { customerReportFileName, REPORT_SHEET_NAME } from './exports';

/** The raw bytes as text: SheetJS writes the zip uncompressed, so the sheet XML is readable. */
async function xlsxText(lang: 'he' | 'en') {
  const { XLSX, workbook } = await buildWorkbook([['a', 'b']], REPORT_SHEET_NAME, lang);
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return { XLSX, text: new TextDecoder('latin1').decode(new Uint8Array(bytes)) };
}

describe('workbook', () => {
  /* A round-trip through SheetJS only proves it parses its own output; what
     Excel acts on is `rightToLeft` in the sheet XML. */
  it('writes a Hebrew file as a right-to-left sheet', async () => {
    const { text } = await xlsxText('he');
    expect(text).toContain('rightToLeft="1"');
  });

  it('leaves an English file left to right', async () => {
    const { text } = await xlsxText('en');
    expect(text).not.toContain('rightToLeft');
  });

  it('names the sheet "Koch - Report" in both languages', async () => {
    for (const lang of ['he', 'en'] as const) {
      const { XLSX, workbook } = await buildWorkbook([['a']], REPORT_SHEET_NAME, lang);
      const back = XLSX.read(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
      expect(back.SheetNames).toEqual(['Koch - Report']);
    }
  });

  it('keeps Hebrew text intact through a write and read', async () => {
    const { XLSX, workbook } = await buildWorkbook([['שירות'], ['שטיפה']], 'תשלומים', 'he');
    const back = XLSX.read(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    expect(back.SheetNames).toEqual(['תשלומים']);
    expect(XLSX.utils.sheet_to_json(back.Sheets['תשלומים'], { header: 1 })).toEqual([['שירות'], ['שטיפה']]);
  });
});

describe('customerReportFileName', () => {
  it('is Latin, carries the period and no site name', () => {
    expect(customerReportFileName('2026-03-01', '2026-03-31')).toBe('Koch-Report-2026-03-01-to-2026-03-31.xlsx');
  });
});

describe('export language memory', () => {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it('defaults to Hebrew', () => {
    vi.stubGlobal('localStorage', fake);
    expect(getExportLang('u1')).toBe('he');
    expect(getExportLang(undefined)).toBe('he');
  });

  it('remembers the choice per person, not per device', () => {
    vi.stubGlobal('localStorage', fake);
    setExportLang('u1', 'en');
    expect(getExportLang('u1')).toBe('en');
    expect(getExportLang('u2')).toBe('he');
  });

  it('ignores a junk stored value', () => {
    vi.stubGlobal('localStorage', fake);
    store.set('exportLang:u1', 'ru');
    expect(getExportLang('u1')).toBe('he');
  });

  it('survives storage being unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(getExportLang('u1')).toBe('he');
    expect(() => setExportLang('u1', 'en')).not.toThrow();
  });
});
