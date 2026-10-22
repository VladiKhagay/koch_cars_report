import { describe, expect, it } from 'vitest';
import { carassoRow, gridColumnPlan } from './jobsGrid';
import { mergeColumnSubset } from './exportColumns';
import { describePreviousJob } from '../components/previousJob';
import type { CarassoJob } from '../lib/types';

const job: CarassoJob = {
  id: 'j1',
  site_id: 's1',
  site_name: 'Haifa',
  created_at: '2026-03-02T08:00:00Z',
  plate: '1234567',
  vin: null,
  brand: 'Toyota',
  worker_note: null,
  service_id: 'sv',
  service_name_en: 'Wash',
  service_name_ru: null,
  service_name_he: 'שטיפה',
  catalog_number: 'X1',
  billing_code: 'R-1',
  worker_id: null,
  coworker_ids: [],
  crew: null,
  client_unit_price: 10,
  client_total_price: 50,
};

describe('Carasso jobs grid', () => {
  it('carries no money, duplicate flag or worker through to the row', () => {
    const row = carassoRow(job);
    expect(row.duplicate_of_job_id).toBeNull();
    expect(row.worker).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/price|share/i);
  });

  it('read-only, no flags, and no crew column while names are hidden', () => {
    const hidden = gridColumnPlan({ isCarasso: true, showSite: true, hideNames: true });
    expect(hidden).toEqual({ site: true, worker: false, editBilling: false, flags: false });
    expect(gridColumnPlan({ isCarasso: true, showSite: false, hideNames: false }).worker).toBe(true);
  });

  it('managers and admins keep billing edit, flags and the crew', () => {
    expect(gridColumnPlan({ isCarasso: false, showSite: false, hideNames: true })).toEqual({
      site: false,
      worker: true,
      editBilling: true,
      flags: true,
    });
  });
});

describe('export column subset', () => {
  const full = [
    { key: 'date', visible: true },
    { key: 'site', visible: true },
    { key: 'plate', visible: true },
  ] as const;

  it('keeps columns that were not offered (Site) in place when the rest are reordered', () => {
    const merged = mergeColumnSubset([...full], [full[2], full[0]]);
    expect(merged.map((c) => c.key)).toEqual(['plate', 'site', 'date']);
  });
});

describe('previous job text', () => {
  it('falls back to English and says nothing about money or people', () => {
    const d = describePreviousJob(
      { created_at: '2026-03-02T08:00:00Z', site_name: 'Haifa', service_name_en: 'Wash', service_name_ru: null, service_name_he: null },
      'he',
    );
    expect(d.service).toBe('Wash');
    expect(Object.keys(d)).toEqual(['date', 'site', 'service']);
  });
});
