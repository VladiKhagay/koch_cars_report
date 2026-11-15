import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { settingsFrom } from './carasso';

describe('settingsFrom', () => {
  it('a failed read hides names and prices', () => {
    const s = settingsFrom(null, { message: 'boom' });
    expect(s.ok).toBe(false);
    expect(s.hideWorkerNames).toBe(true);
    expect(s.hideClientPrices).toBe(true);
  });

  it('a missing key row means visible (the default before 0038)', () => {
    const s = settingsFrom([{ key: 'hide_worker_names', value: false }], null);
    expect(s.ok).toBe(true);
    expect(s.hideClientPrices).toBe(false);
  });

  it('reads each switch on its own', () => {
    const s = settingsFrom(
      [
        { key: 'hide_worker_names', value: false },
        { key: 'hide_client_prices', value: true },
      ],
      null,
    );
    expect(s.hideClientPrices).toBe(true);
    expect(s.hideWorkerNames).toBe(false);
    expect(settingsFrom([{ key: 'hide_client_prices', value: false }], null).hideClientPrices).toBe(false);
  });

  it('hiding names does not hide prices', () => {
    const s = settingsFrom(
      [
        { key: 'hide_worker_names', value: true },
        { key: 'hide_client_prices', value: false },
      ],
      null,
    );
    expect(s.hideWorkerNames).toBe(true);
    expect(s.hideClientPrices).toBe(false);
  });

  it('an error wins over any rows that came back', () => {
    const s = settingsFrom([{ key: 'hide_client_prices', value: false }], { message: 'boom' });
    expect(s.hideClientPrices).toBe(true);
  });

  it('no rows and no error (empty table) means visible', () => {
    expect(settingsFrom([], null).hideClientPrices).toBe(false);
    expect(settingsFrom(null, null).hideClientPrices).toBe(false);
  });

  // Strict `=== true`, matching the database (`value = 'true'::jsonb`): only the
  // JSON boolean hides. The RPC only ever writes to_jsonb(boolean).
  it('only a JSON boolean true hides; malformed values read as not hidden', () => {
    for (const value of ['true', 1, 'yes', null, {}, [true]]) {
      expect(settingsFrom([{ key: 'hide_client_prices', value }], null).hideClientPrices).toBe(false);
    }
  });
});
