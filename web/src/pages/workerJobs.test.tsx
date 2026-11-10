import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobServiceLine, Service } from '../lib/types';

const calls: string[] = [];
const result = { services: null as { message: string } | null, job: null as { message: string } | null };
const updates: unknown[] = [];

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (patch: unknown) => {
        updates.push(patch);
        return {
          eq: async () => {
            calls.push('jobs.update');
            return { error: result.job };
          },
        };
      },
    }),
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }));
vi.mock('../lib/jobs', () => ({
  setJobServices: async () => {
    calls.push('setJobServices');
    return { error: result.services };
  },
}));

const { editableServices, mediaEditState, migrateDraft, nextBusyJob, saveWorkerEdit, toggleId } = await import('./workerJobs');
const { default: ServiceChips } = await import('../components/ServiceChips');

const svc = (id: string): Service => ({
  id,
  name_en: id,
  name_ru: null,
  name_he: null,
  catalog_number: id,
  worker_price: 10,
  active: true,
  sort_order: 0,
  deleted_at: null,
});

describe('toggleId', () => {
  it('adds then removes', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('migrateDraft', () => {
  it('turns a pre-0033 single serviceId into serviceIds and drops the old key', () => {
    expect(migrateDraft<{ serviceIds: string[] }>({ serviceId: 's1' })).toEqual({ serviceIds: ['s1'] });
  });
  it('keeps a current draft as is', () => {
    expect(migrateDraft<{ serviceIds: string[]; plate: string }>({ serviceIds: ['a', 'b'], plate: '1' })).toEqual({
      serviceIds: ['a', 'b'],
      plate: '1',
    });
    expect(migrateDraft<{ serviceIds: string[] }>({ serviceId: null })).toEqual({ serviceIds: [] });
  });
});

describe('editableServices', () => {
  it('adds a retired service still on the job, once', () => {
    const line = { service_id: 'old', name_en: 'Old', name_ru: null, name_he: null, catalog_number: 'O', worker_price: 5 } as JobServiceLine;
    const onJob = { ...line, service_id: 'a' };
    const out = editableServices([svc('a')], [onJob, line]);
    expect(out.map((s) => s.id)).toEqual(['a', 'old']);
    expect(out[1]).toMatchObject({ name_en: 'Old', active: false });
  });
});

describe('saveWorkerEdit', () => {
  const draft = { note: '', serviceIds: ['a', 'b'], siteId: 's', coworkerIds: [] };
  beforeEach(() => {
    calls.length = 0;
    updates.length = 0;
    result.services = null;
    result.job = null;
  });

  it('writes services first, then the job without any service or pay field', async () => {
    expect(await saveWorkerEdit({ id: 'j', service_ids: ['a'] }, draft)).toBeNull();
    expect(calls).toEqual(['setJobServices', 'jobs.update']);
    expect(Object.keys(updates[0] as object).sort()).toEqual(['coworker_ids', 'site_id', 'worker_note']);
  });

  it('leaves the services alone when the set is unchanged (order ignored)', async () => {
    await saveWorkerEdit({ id: 'j', service_ids: ['b', 'a'] }, draft);
    expect(calls).toEqual(['jobs.update']);
  });

  it('stops and reports a failed services write', async () => {
    result.services = { message: 'locked' };
    expect(await saveWorkerEdit({ id: 'j', service_ids: [] }, draft)).toBe('services');
    expect(calls).toEqual(['setJobServices']);
  });

  it('reports a failed job write', async () => {
    result.job = { message: 'nope' };
    expect(await saveWorkerEdit({ id: 'j', service_ids: ['a', 'b'] }, draft)).toBe('job');
  });
});

describe('ServiceChips', () => {
  it('is a labelled group of toggle buttons, no radio semantics or roving tabindex', () => {
    const html = renderToStaticMarkup(
      <ServiceChips services={[svc('a'), svc('b')]} selected={['b']} onToggle={() => {}} label="Work" />,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Work"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(1);
    expect(html).not.toMatch(/radio|tabindex/i);
  });
});

/* ------------------------------------------------- edge cases (0033 QA) */

describe('worker edit edge cases', () => {
  beforeEach(() => {
    calls.length = 0;
    updates.length = 0;
    result.services = null;
    result.job = null;
  });

  /* A double tap can leave a repeat in the draft: the same set must not rewrite the lines (and their snapshots). */
  it('treats a draft with repeated ids equal to the job set as unchanged', async () => {
    await saveWorkerEdit({ id: 'j', service_ids: ['a'] }, { note: '', serviceIds: ['a', 'a'], siteId: 's', coworkerIds: [] });
    expect(calls).toEqual(['jobs.update']);
  });

  /* A zero-service legacy job (service_ids absent) gaining a service is a change. */
  it('writes services for a legacy job that had none', async () => {
    await saveWorkerEdit({ id: 'j' } as never, { note: '', serviceIds: ['a'], siteId: 's', coworkerIds: [] });
    expect(calls).toEqual(['setJobServices', 'jobs.update']);
  });

  it('migrateDraft keeps a current list over a stale single serviceId', () => {
    expect(migrateDraft<{ serviceIds: string[] }>({ serviceIds: ['a', 'b'], serviceId: 'z' })).toEqual({ serviceIds: ['a', 'b'] });
  });

  it('migrateDraft reads an empty list next to a legacy serviceId as that service', () => {
    expect(migrateDraft<{ serviceIds: string[] }>({ serviceIds: [], serviceId: 'z' })).toEqual({ serviceIds: ['z'] });
  });

  it('migrateDraft treats a corrupted serviceIds value as empty', () => {
    expect(migrateDraft<{ serviceIds: string[] }>({ serviceIds: 'a' as never })).toEqual({ serviceIds: [] });
  });

  it('editableServices with no lines is just the active catalog', () => {
    expect(editableServices([svc('a')], null).map((s) => s.id)).toEqual(['a']);
    expect(editableServices([svc('a')], undefined).map((s) => s.id)).toEqual(['a']);
  });

  /* A soft-deleted service on the job still shows its own (translated) names from the line. */
  it('editableServices keeps a soft-deleted line with its translations', () => {
    const gone = { service_id: 'gone', name_en: 'Wax', name_ru: 'Воск', name_he: 'ווקס', catalog_number: 'W', worker_price: 7 } as JobServiceLine;
    const [, extra] = editableServices([svc('a')], [gone]);
    expect(extra).toMatchObject({ id: 'gone', name_ru: 'Воск', name_he: 'ווקס', active: false });
  });
});

describe('mediaEditState — the worker panel only manages media in the open window (0035)', () => {
  const now = Date.parse('2026-11-10T10:00:00Z');
  const job = { id: 'j1', worker_id: 'me', locked_at: '2026-11-10T10:05:00Z' };

  it('own job, window open, nothing queued: open', () => {
    expect(mediaEditState(job, 'me', [], now)).toBe('open');
    expect(mediaEditState(job, 'me', [{ jobId: 'other' }, {}], now)).toBe('open');
  });

  it('own job with a queue entry for it (photos or video still sending): queued', () => {
    expect(mediaEditState(job, 'me', [{ jobId: 'j1' }], now)).toBe('queued');
  });

  it('closed window, the exact lock instant, a co-worker or no user: closed', () => {
    expect(mediaEditState({ ...job, locked_at: '2026-11-10T09:59:00Z' }, 'me', [], now)).toBe('closed');
    expect(mediaEditState({ ...job, locked_at: '2026-11-10T10:00:00Z' }, 'me', [], now)).toBe('closed');
    expect(mediaEditState(job, 'coworker', [], now)).toBe('closed');
    expect(mediaEditState(job, undefined, [], now)).toBe('closed');
  });

  it('a failed entry for the job (needsAttention) still holds: a Retry would overwrite a manual change', () => {
    const failed = { jobId: 'j1', needsAttention: true };
    expect(mediaEditState(job, 'me', [failed], now)).toBe('queued');
  });

  it('a closed window wins over a queue entry', () => {
    expect(mediaEditState({ ...job, locked_at: '2026-11-10T09:00:00Z' }, 'me', [{ jobId: 'j1' }], now)).toBe('closed');
  });
});

describe('nextBusyJob — the My Jobs hold is keyed by job', () => {
  it('a start holds that job; its own settle frees it', () => {
    expect(nextBusyJob(null, 'a', true)).toBe('a');
    expect(nextBusyJob('a', 'a', false)).toBeNull();
  });

  it("another job's late settle leaves the current hold alone", () => {
    expect(nextBusyJob('b', 'a', false)).toBe('b');
    expect(nextBusyJob(null, 'a', false)).toBeNull();
  });
});
