import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { name?: string }) => (o?.name ? `${key}:${o.name}` : key) }),
}));
// ui.tsx pulls in the i18n bootstrap (language switcher); not needed here.
vi.mock('../lib/i18n', () => ({ LANGUAGES: [], setLanguage: () => {} }));

const { enterPick, workerPickerOptions } = await import('./workerPickerOptions');
const { default: WorkerPicker } = await import('./WorkerPicker');

const workers = [
  { id: 'a', name: 'Avi Cohen' },
  { id: 'd', name: 'Dana Levi' },
  { id: 'm', name: 'Moshe Dana' },
];

describe('workerPickerOptions', () => {
  it('narrows by name, ignoring case and surrounding spaces', () => {
    expect(workerPickerOptions(workers, '', '  dana ').matches.map((w) => w.id)).toEqual(['d', 'm']);
    expect(workerPickerOptions(workers, '', '').matches).toHaveLength(3);
  });

  it('keeps the selected worker even when the search excludes them', () => {
    const o = workerPickerOptions(workers, 'a', 'dana');
    expect(o.selected?.id).toBe('a');
    expect(o.matches.map((w) => w.id)).toEqual(['d', 'm']);
  });

  it('never lists the selected worker twice', () => {
    const o = workerPickerOptions(workers, 'd', 'dana');
    expect(o.selected?.id).toBe('d');
    expect(o.matches.map((w) => w.id)).toEqual(['m']);
  });

  it('finds nobody for a name nobody has', () => {
    expect(workerPickerOptions(workers, '', 'zzz').matches).toEqual([]);
  });
});

describe('workerPickerOptions: no matches', () => {
  it('is not claimed while the picked worker matches the search', () => {
    // Only Dana Levi matches "levi", and she is the one picked.
    expect(workerPickerOptions(workers, 'd', 'levi').noMatches).toBe(false);
  });

  it('is claimed when nobody, the picked worker included, matches', () => {
    expect(workerPickerOptions(workers, 'd', 'zzz').noMatches).toBe(true);
    expect(workerPickerOptions(workers, '', 'zzz').noMatches).toBe(true);
  });

  it('is not claimed for an empty search', () => {
    expect(workerPickerOptions([], '', '  ').noMatches).toBe(false);
  });
});

/* Shared by WorkerPicker and CoworkerPicker: their panels listen for Enter on
   the wrapper, so Enter on a focused row or clear button bubbles up to it. */
describe('enterPick', () => {
  const listed = [{ id: 'd' }, { id: 'm' }];

  it('Enter in the search field takes the top match', () => {
    expect(enterPick('Enter', true, listed)).toBe('d');
  });

  it('Enter on a row or a clear button picks nothing (the button handles its own click)', () => {
    expect(enterPick('Enter', false, listed)).toBeNull();
  });

  it('picks nothing from an empty list or for other keys', () => {
    expect(enterPick('Enter', true, [])).toBeNull();
    expect(enterPick('Escape', true, listed)).toBeNull();
    expect(enterPick('a', true, listed)).toBeNull();
  });
});

describe('WorkerPicker', () => {
  const render = (value: string) =>
    renderToStaticMarkup(<WorkerPicker id="export-worker" workers={workers} value={value} onChange={() => {}} />);

  it('lists everyone under a labelled search field when nobody is picked', () => {
    const html = render('');
    expect(html).toContain('id="export-worker"');
    expect(html).not.toContain('aria-label="export.searchWorkers"');
    for (const w of workers) expect(html).toContain(w.name);
    expect(html).not.toContain('aria-describedby');
  });

  it('shows the picked worker with a way to clear them, and collapses the rest', () => {
    const html = render('d');
    expect(html).toContain('Dana Levi');
    expect(html).toContain('export.clearWorker:Dana Levi');
    expect(html).not.toContain('Avi Cohen');
    expect(html).toContain('aria-describedby="export-worker-selected"');
    expect(html).toMatch(/id="export-worker-selected"[^>]*>Dana Levi</);
  });
});
