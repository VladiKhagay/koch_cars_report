import { describe, expect, it } from 'vitest';
import {
  availableColumns,
  CUSTOMER_COLUMNS,
  SHEET_HEADERS_BY_LANG,
  moveColumn,
  resolveCustomerColumns,
  toStoredConfig,
  type ColumnConfig,
} from './reportConfig';

const keys = (cols: ColumnConfig[]) => cols.map((c) => c.key);
const visible = (cols: ColumnConfig[]) => cols.filter((c) => c.visible).map((c) => c.key);

describe('resolveCustomerColumns — privacy', () => {
  /*
   * The one test that matters. The 0005 default shipped `worker_price`
   * present, and any backup taken before 0007 still holds it. This report goes
   * to the importer, and what the yard pays its staff is not for them.
   *
   * `worker` is deliberately NOT asserted against here: 0013 made the name an
   * allowed column. The pay never was one and is not now.
   */
  it('drops worker_price however it arrives', () => {
    const leaky = {
      columns: [
        { key: 'date', visible: true },
        { key: 'worker_price', visible: true },
        { key: 'plate', visible: true },
      ],
    };
    expect(keys(resolveCustomerColumns(leaky))).not.toContain('worker_price');
    expect(visible(resolveCustomerColumns(leaky))).toEqual(['date', 'plate']);
  });

  it('keeps worker where the config asks for it', () => {
    const cols = resolveCustomerColumns({
      columns: [
        { key: 'worker', visible: true },
        { key: 'date', visible: true },
      ],
    });
    expect(keys(cols).slice(0, 2)).toEqual(['worker', 'date']);
    expect(visible(cols)).toEqual(['worker', 'date']);
  });

  it('never returns a key outside the allowlist', () => {
    const junk = { columns: [{ key: 'salary' }, { key: '__proto__' }, { key: 42 }, null, 'date'] };
    for (const col of resolveCustomerColumns(junk)) {
      expect(CUSTOMER_COLUMNS).toContain(col.key);
    }
  });
});

describe('resolveCustomerColumns — resilience', () => {
  it('survives a config that is missing, malformed, or the wrong type', () => {
    for (const bad of [null, undefined, {}, { columns: 'nope' }, { columns: null }, 7]) {
      const cols = resolveCustomerColumns(bad);
      expect(keys(cols)).toEqual([...CUSTOMER_COLUMNS]);
      // Nothing configured means nothing disclosed.
      expect(visible(cols)).toEqual([]);
    }
  });

  it('keeps the stored order and appends unconfigured columns hidden', () => {
    const cols = resolveCustomerColumns({
      columns: [
        { key: 'plate', visible: true },
        { key: 'date', visible: true },
      ],
    });
    expect(keys(cols).slice(0, 2)).toEqual(['plate', 'date']);
    // A column the product gained later must not switch itself on.
    expect(visible(cols)).toEqual(['plate', 'date']);
  });

  it('treats a missing visible flag as visible but an explicit false as hidden', () => {
    const cols = resolveCustomerColumns({
      columns: [{ key: 'date' }, { key: 'plate', visible: false }],
    });
    expect(visible(cols)).toEqual(['date']);
  });

  it('ignores a duplicated key rather than rendering the column twice', () => {
    const cols = resolveCustomerColumns({
      columns: [
        { key: 'date', visible: true },
        { key: 'date', visible: false },
      ],
    });
    expect(keys(cols).filter((k) => k === 'date')).toHaveLength(1);
    expect(visible(cols)).toEqual(['date']);
  });
});

describe('round trip', () => {
  it('stores only key and visibility, and survives a reload unchanged', () => {
    const start = resolveCustomerColumns({
      columns: [
        { key: 'vin', visible: true },
        { key: 'date', visible: false },
      ],
    });
    const stored = toStoredConfig(start);
    expect(stored.columns[0]).toEqual({ key: 'vin', visible: true });
    expect(resolveCustomerColumns(stored)).toEqual(start);
  });
});

describe('moveColumn', () => {
  const cols = resolveCustomerColumns({
    columns: [{ key: 'date' }, { key: 'plate' }, { key: 'vin' }],
  });

  it('swaps with the neighbour', () => {
    expect(keys(moveColumn(cols, 0, 1)).slice(0, 2)).toEqual(['plate', 'date']);
    expect(keys(moveColumn(cols, 2, -1)).slice(0, 3)).toEqual(['date', 'vin', 'plate']);
  });

  it('is a no-op at either end rather than wrapping or dropping a column', () => {
    expect(moveColumn(cols, 0, -1)).toBe(cols);
    expect(moveColumn(cols, cols.length - 1, 1)).toBe(cols);
  });

  it('does not mutate the input', () => {
    const before = keys(cols);
    moveColumn(cols, 0, 1);
    expect(keys(cols)).toEqual(before);
  });
});

describe('availableColumns', () => {
  const all = resolveCustomerColumns({
    columns: CUSTOMER_COLUMNS.map((key) => ({ key, visible: true })),
  });
  const offered = (role: Parameters<typeof availableColumns>[1]['role'], over = {}) =>
    availableColumns(all, { role, hideWorkerNames: false, multiSite: true, ...over }).map((c) => c.key);

  it('never offers client prices to a manager or a worker', () => {
    for (const role of ['manager', 'worker', undefined] as const) {
      expect(offered(role)).not.toContain('client_unit_price');
      expect(offered(role)).not.toContain('client_total_price');
    }
  });

  it('offers client prices to admin and Carasso', () => {
    for (const role of ['admin', 'carasso'] as const) {
      expect(offered(role)).toEqual(expect.arrayContaining(['client_unit_price', 'client_total_price']));
    }
  });

  it('drops the Worker column for Carasso while names are hidden — and only for Carasso', () => {
    expect(offered('carasso', { hideWorkerNames: true })).not.toContain('worker');
    expect(offered('admin', { hideWorkerNames: true })).toContain('worker');
    expect(offered('manager', { hideWorkerNames: true })).toContain('worker');
    expect(offered('carasso')).toContain('worker');
  });

  it('offers the Site column only for a multi-site file', () => {
    expect(offered('carasso', { multiSite: false })).not.toContain('site');
    expect(offered('carasso')).toContain('site');
  });

  it('keeps the stored order of what remains', () => {
    expect(offered('manager').slice(0, 3)).toEqual(['date', 'site', 'brand']);
  });
});

describe('headers', () => {
  it('has a Hebrew and an English header for every column', () => {
    for (const lang of ['he', 'en'] as const) {
      for (const key of CUSTOMER_COLUMNS) expect(SHEET_HEADERS_BY_LANG[lang][key]).toBeTruthy();
    }
  });
});
