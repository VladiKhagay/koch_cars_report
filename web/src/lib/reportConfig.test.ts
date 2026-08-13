import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_COLUMNS,
  moveColumn,
  resolveCustomerColumns,
  toStoredConfig,
  type ColumnConfig,
} from './reportConfig';

const keys = (cols: ColumnConfig[]) => cols.map((c) => c.key);
const visible = (cols: ColumnConfig[]) => cols.filter((c) => c.visible).map((c) => c.key);

describe('resolveCustomerColumns — privacy', () => {
  /*
   * The one test that matters. The 0005 default shipped `worker` visible and
   * `worker_price` present, and any backup taken before 0007 still holds them.
   * This report goes to the importer.
   */
  it('drops worker and worker_price however they arrive', () => {
    const leaky = {
      columns: [
        { key: 'date', visible: true },
        { key: 'worker', visible: true },
        { key: 'worker_price', visible: true },
        { key: 'plate', visible: true },
      ],
    };
    expect(keys(resolveCustomerColumns(leaky))).not.toContain('worker');
    expect(keys(resolveCustomerColumns(leaky))).not.toContain('worker_price');
    expect(visible(resolveCustomerColumns(leaky))).toEqual(['date', 'plate']);
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
