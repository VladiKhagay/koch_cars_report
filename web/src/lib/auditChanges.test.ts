import { describe, expect, it } from 'vitest';
import { describeChanges, type ChangeFormatters } from './auditChanges';

const f: ChangeFormatters = {
  person: (id) => `P:${id}`,
  site: (id) => `S:${id}`,
  service: (id) => `V:${id}`,
  date: (iso) => `D:${iso}`,
  slot: (kind) => `K:${kind}`,
  bool: (b) => (b ? 'YES' : 'NO'),
  money: (n) => `M:${n}`,
};

describe('describeChanges', () => {
  it('reads the trigger shape {field: {from, to}} and resolves ids', () => {
    expect(
      describeChanges(
        {
          plate: { from: '12345678', to: '87654321' },
          worker_id: { from: 'a', to: 'b' },
          site_id: { from: 's1', to: 's2' },
          coworker_ids: { from: [], to: ['c', 'd'] },
          created_at: { from: '2026-01-01T08:00:00Z', to: '2026-01-02T08:00:00Z' },
        },
        f,
      ),
    ).toEqual([
      { field: 'plate', from: '12345678', to: '87654321' },
      { field: 'worker_id', from: 'P:a', to: 'P:b' },
      { field: 'site_id', from: 'S:s1', to: 'S:s2' },
      { field: 'coworker_ids', from: null, to: 'P:c, P:d' },
      { field: 'created_at', from: 'D:2026-01-01T08:00:00Z', to: 'D:2026-01-02T08:00:00Z' },
    ]);
  });

  it('treats empty strings and nulls as empty', () => {
    expect(describeChanges({ vin: { from: null, to: 'X' }, brand: { from: 'VW', to: '' } }, f)).toEqual([
      { field: 'vin', from: null, to: 'X' },
      { field: 'brand', from: 'VW', to: null },
    ]);
  });

  it('reads the legacy flat shape, marking the old value as not recorded', () => {
    expect(describeChanges({ billing_code: 'R-1', reason: 'duplicate', service_ids: ['x', 'y'] }, f)).toEqual([
      { field: 'billing_code', from: undefined, to: 'R-1' },
      { field: 'reason', from: undefined, to: 'duplicate' },
      { field: 'service_ids', from: undefined, to: 'V:x, V:y' },
    ]);
  });

  it('reads legacy admin line edits', () => {
    expect(describeChanges({ service_lines: [{ service_id: 'x', worker_price: 50 }] }, f)).toEqual([
      { field: 'service_lines', from: undefined, to: 'V:x (worker_price=M:50)' },
    ]);
  });

  it('labels a media slot and skips bookkeeping columns', () => {
    expect(describeChanges({ kind: 'extra_2', updated_at: { from: 'a', to: 'b' } }, f)).toEqual([
      { field: 'kind', from: undefined, to: 'K:extra_2' },
    ]);
  });

  it('names the media slot once for add, replace and remove', () => {
    for (const kind of [{ from: null, to: 'vin' }, { from: 'vin', to: 'vin' }, { from: 'vin', to: null }]) {
      expect(describeChanges({ kind }, f)).toEqual([{ field: 'kind', from: undefined, to: 'K:vin' }]);
    }
  });

  it('reads a service line change: added, removed, repriced', () => {
    expect(
      describeChanges({ service_id: { from: null, to: 'x' }, worker_price: { from: null, to: 40 } }, f),
    ).toEqual([
      { field: 'service_id', from: null, to: 'V:x' },
      { field: 'worker_price', from: null, to: 'M:40' },
    ]);
    expect(describeChanges({ service_id: 'x', unit_price: { from: 10, to: 12 } }, f)).toEqual([
      { field: 'service_id', from: undefined, to: 'V:x' },
      { field: 'unit_price', from: 'M:10', to: 'M:12' },
    ]);
  });

  it('returns nothing for a missing or non-object payload', () => {
    expect(describeChanges(null, f)).toEqual([]);
    expect(describeChanges('x', f)).toEqual([]);
    expect(describeChanges([1], f)).toEqual([]);
  });

  it('keeps zero and false: a price set to 0 or a failed check digit is a value, not "empty"', () => {
    expect(
      describeChanges({ worker_price: { from: 0, to: 10 }, total_price: { from: 5, to: 0 }, vin_valid_checksum: { from: true, to: false } }, f),
    ).toEqual([
      { field: 'worker_price', from: 'M:0', to: 'M:10' },
      { field: 'total_price', from: 'M:5', to: 'M:0' },
      { field: 'vin_valid_checksum', from: 'YES', to: 'NO' },
    ]);
  });

  it('formats soft delete / restore and removal timestamps as dates', () => {
    expect(describeChanges({ deleted_at: { from: null, to: '2026-03-01T10:00:00Z' } }, f)).toEqual([
      { field: 'deleted_at', from: null, to: 'D:2026-03-01T10:00:00Z' },
    ]);
    expect(describeChanges({ removed_at: '2026-03-01T10:00:00Z' }, f)).toEqual([
      { field: 'removed_at', from: undefined, to: 'D:2026-03-01T10:00:00Z' },
    ]);
  });

  it('a co-worker removed: the old crew is named, the new one is empty', () => {
    expect(describeChanges({ coworker_ids: { from: ['a'], to: [] } }, f)).toEqual([
      { field: 'coworker_ids', from: 'P:a', to: null },
    ]);
  });

  it('a one-sided diff entry ({from} only / {to} only) reads the missing side as empty', () => {
    expect(describeChanges({ brand: { from: 'VW' }, plate: { to: '1234567' } }, f)).toEqual([
      { field: 'brand', from: 'VW', to: null },
      { field: 'plate', from: null, to: '1234567' },
    ]);
  });

  it('a legacy line edit without a service id still renders', () => {
    expect(describeChanges({ service_lines: [{ unit_price: 12 }] }, f)).toEqual([
      { field: 'service_lines', from: undefined, to: '— (unit_price=M:12)' },
    ]);
  });

  it('skips every bookkeeping column, in either shape', () => {
    expect(
      describeChanges(
        { id: 'x', job_id: 'j', r2_key: { from: 'a', to: 'b' }, expires_at: 'z', locked_at: { from: null, to: 'y' }, brand: { from: null, to: 'Kia' } },
        f,
      ),
    ).toEqual([{ field: 'brand', from: null, to: 'Kia' }]);
  });

  it('an empty media diff ({kind: {from: null, to: null}}) names no slot rather than crashing', () => {
    expect(describeChanges({ kind: { from: null, to: null } }, f)).toEqual([{ field: 'kind', from: undefined, to: null }]);
  });

  it('formats money stored as a numeric string (legacy rows) and leaves non-numbers as typed', () => {
    expect(describeChanges({ worker_price: '50', unit_price: { from: 'n/a', to: 7.5 } }, f)).toEqual([
      { field: 'worker_price', from: undefined, to: 'M:50' },
      { field: 'unit_price', from: 'n/a', to: 'M:7.5' },
    ]);
  });

  it('a non-diff object value is shown as JSON, not "[object Object]"', () => {
    expect(describeChanges({ extra: { a: 1 } }, f)).toEqual([{ field: 'extra', from: undefined, to: '{"a":1}' }]);
  });
});
