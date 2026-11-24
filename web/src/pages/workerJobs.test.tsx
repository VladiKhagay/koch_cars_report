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

const { cleanWorkerLabel, crewOthers, editableServices, isStaffSubmitter, jobOwnership, jobSiteId, mediaEditState, migrateDraft, nextBusyJob, pickableWorkers, saveWorkerEdit, siteAcceptsJobs, siteRules, toggleId, vehicleProblems, workerNamed } =
  await import('./workerJobs');
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

describe('New Job on behalf of a worker (0040)', () => {
  const worker = { id: 'w1', role: 'worker' as const, site_id: 's1' };
  const manager = { id: 'm1', role: 'manager' as const, site_id: 's1' };
  const admin = { id: 'a1', role: 'admin' as const, site_id: null };

  it('gives a picked worker the job, with no label', () => {
    expect(jobOwnership(manager, { workerId: 'w2', workerLabel: 'stale' })).toEqual({
      workerId: 'w2',
      workerLabel: null,
      submittedBy: 'm1',
    });
  });

  it('keeps a typed-name job with the submitter, trimmed', () => {
    expect(jobOwnership(admin, { workerId: '', workerLabel: '  Moshe ' })).toEqual({
      workerId: 'a1',
      workerLabel: 'Moshe',
      submittedBy: 'a1',
    });
  });

  /* A draft on a shared phone may carry a manager's pick: a worker never inherits it. */
  it('ignores any pick or name for a worker', () => {
    expect(jobOwnership(worker, { workerId: 'w2', workerLabel: 'Moshe' })).toEqual({
      workerId: 'w1',
      workerLabel: null,
      submittedBy: 'w1',
    });
  });

  /* A blank name is no name: never a whitespace label (the DB would store NULL anyway). New Job blocks this case as "worker required". */
  it('reads a blank typed name as none', () => {
    expect(jobOwnership(manager, { workerId: '', workerLabel: '   ' })).toEqual({
      workerId: 'm1',
      workerLabel: null,
      submittedBy: 'm1',
    });
  });

  it('pins a manager to their own site, even over a restored pick', () => {
    expect(jobSiteId(manager, 's2', 's3')).toBe('s1');
  });

  it("falls back for an admin from the pick to home to the scope's site", () => {
    expect(jobSiteId(admin, 's2', 's3')).toBe('s2');
    expect(jobSiteId(admin, null, 's3')).toBe('s3');
    expect(jobSiteId({ ...admin, site_id: 's9' }, null, 's3')).toBe('s9');
    expect(jobSiteId(admin, null, null)).toBeNull();
  });

  /* The car was done where the worker works, not at the admin's home site. */
  it("defaults an admin's site to the picked worker's, below an explicit pick", () => {
    expect(jobSiteId({ ...admin, site_id: 's9' }, null, 's3', 's4')).toBe('s4');
    expect(jobSiteId(admin, 's2', 's3', 's4')).toBe('s2');
    expect(jobSiteId(manager, null, null, 's4')).toBe('s1');
  });

  it("skips an admin's disabled fallback sites, never an explicit pick (0041)", () => {
    const sites = [
      { id: 's3', active: true },
      { id: 's4', active: false },
      { id: 's9', active: false },
    ];
    expect(jobSiteId({ ...admin, site_id: 's9' }, null, 's3', 's4', sites)).toBe('s3');
    expect(jobSiteId(admin, 's4', 's3', null, sites)).toBe('s4');
    // All disabled: the first, so the form reports it as disabled.
    expect(jobSiteId({ ...admin, site_id: 's9' }, null, null, 's4', sites)).toBe('s4');
    // Sites not loaded yet: unchanged.
    expect(jobSiteId({ ...admin, site_id: 's9' }, null, 's3', 's4')).toBe('s4');
  });

  it('lets a worker log at another yard', () => {
    expect(jobSiteId(worker, 's2', null)).toBe('s2');
    expect(jobSiteId(worker, null, null)).toBe('s1');
  });

  it('offers active workers only; a manager only their own site', () => {
    const staff = [
      { id: 'w1', name: 'A', site_id: 's1', active: true, role: 'worker' as const },
      { id: 'w2', name: 'B', site_id: 's2', active: true, role: 'worker' as const },
      { id: 'w3', name: 'C', site_id: 's1', active: false, role: 'worker' as const },
      { id: 'm2', name: 'D', site_id: 's1', active: true, role: 'manager' as const },
    ];
    expect(pickableWorkers(staff, manager).map((s) => s.id)).toEqual(['w1']);
    expect(pickableWorkers(staff, admin).map((s) => s.id)).toEqual(['w1', 'w2']);
  });

  it('offers a manager with no site nobody, not the site-less workers', () => {
    const staff = [{ id: 'w9', name: 'X', site_id: null, active: true, role: 'worker' as const }];
    expect(pickableWorkers(staff, { role: 'manager', site_id: null })).toEqual([]);
  });

  it('spots a typed name that is really a worker with an account', () => {
    const staff = [{ id: 'w1', name: 'Moshe Levi', site_id: 's1', active: true, role: 'worker' as const }];
    expect(workerNamed(staff, '  moshe levi ')?.id).toBe('w1');
    expect(workerNamed(staff, 'Moshe')).toBeUndefined();
    expect(workerNamed(staff, '  ')).toBeUndefined();
  });

  /* A co-worker on a typed-name job sees the typed name, not the manager who logged it. */
  it("names a typed-name job's submitter by the typed name in a co-worker's list", () => {
    const staff = [
      { id: 'm1', name: 'Manager', site_id: 's1', active: true, role: 'manager' as const },
      { id: 'w1', name: 'Dana', site_id: 's1', active: true, role: 'worker' as const },
      { id: 'w2', name: 'Avi', site_id: 's1', active: true, role: 'worker' as const },
    ];
    const job = { worker_id: 'm1', coworker_ids: ['w1', 'w2'], worker_label: 'Moshe' };
    expect(crewOthers(job, 'w1', staff)).toEqual(['Moshe', 'Avi']);
    expect(crewOthers({ ...job, worker_label: null }, 'w1', staff)).toEqual(['Manager', 'Avi']);
    expect(crewOthers({ worker_id: 'w1', coworker_ids: [] }, 'w1', staff)).toEqual([]);
  });

  /* AC-2: the Worker field is for managers and admins only. */
  it('shows the Worker field to managers and admins only', () => {
    expect(isStaffSubmitter('manager')).toBe(true);
    expect(isStaffSubmitter('admin')).toBe(true);
    expect(isStaffSubmitter('worker')).toBe(false);
    expect(isStaffSubmitter('carasso')).toBe(false);
    expect(isStaffSubmitter(undefined)).toBe(false);
  });

  it('gives an admin\'s picked worker the job, wherever that worker is', () => {
    expect(jobOwnership(admin, { workerId: 'w9', workerLabel: '' })).toEqual({
      workerId: 'w9',
      workerLabel: null,
      submittedBy: 'a1',
    });
  });

  /* Defensive only: any non-staff role is read as a worker (own id, no label). Carasso's real block is ROUTE_ROLES + RLS. */
  it('reads a non-staff role as a worker: own id, no pick, no label', () => {
    const viewer = { id: 'c1', role: 'carasso' as const };
    expect(jobOwnership(viewer, { workerId: 'w1', workerLabel: 'Moshe' })).toEqual({
      workerId: 'c1',
      workerLabel: null,
      submittedBy: 'c1',
    });
  });
});

describe('cleanWorkerLabel (0040 CHECK)', () => {
  it('strips every character the database refuses, and nothing else', () => {
    const refused =
      '\u0001\u001F\u007F\u009F\u00AD\u061C\u200B\u200F\u2028\u202E\u2060\u2069\uFEFF';
    expect(cleanWorkerLabel(`\u200FMo${refused}she`)).toBe('Moshe');
    // Neighbours of the refused ranges survive: ordinary spaces, Hebrew, accents, emoji.
    expect(cleanWorkerLabel('משה כהן \u00A0é \u2030 😀')).toBe('משה כהן \u00A0é \u2030 😀');
  });

  it('trims and caps at 60 for storage; keeps outer spaces while typing', () => {
    expect(cleanWorkerLabel('  Moshe  ')).toBe('Moshe');
    expect(cleanWorkerLabel('Moshe ', { typing: true })).toBe('Moshe ');
    expect(cleanWorkerLabel('x'.repeat(70))).toHaveLength(60);
    expect(cleanWorkerLabel('x'.repeat(70), { typing: true })).toHaveLength(60);
  });

  it('sends the cleaned name, and none when only invisible marks were typed', () => {
    const admin = { id: 'a1', role: 'admin' as const };
    expect(jobOwnership(admin, { workerId: '', workerLabel: '\u200F Moshe\u200B ' }).workerLabel).toBe('Moshe');
    expect(jobOwnership(admin, { workerId: '', workerLabel: '\u200F\u200B' }).workerLabel).toBeNull();
  });
});

describe('siteAcceptsJobs (0041 disabled sites)', () => {
  const sites = [
    { id: 'on', active: true },
    { id: 'off', active: false },
  ];

  it('refuses a disabled site', () => {
    expect(siteAcceptsJobs(sites, 'off')).toBe(false);
  });

  it('accepts an enabled site', () => {
    expect(siteAcceptsJobs(sites, 'on')).toBe(true);
  });

  it('does not block while sites are loading or the site is unknown', () => {
    expect(siteAcceptsJobs([], 'off')).toBe(true);
    expect(siteAcceptsJobs(sites, null)).toBe(true);
  });
});

describe('siteRules (0042 per-site VIN / plate rules)', () => {
  const sites = [
    { id: 'def', vin_rule: 'required', plate_rule: 'optional' },
    { id: 'plate', vin_rule: 'optional', plate_rule: 'required' },
    { id: 'both', vin_rule: 'required', plate_rule: 'required' },
    { id: 'none', vin_rule: 'optional', plate_rule: 'optional' },
  ] as const;

  it('reads the selected site', () => {
    expect(siteRules([...sites], 'def')).toEqual({ vinRequired: true, plateRequired: false });
    expect(siteRules([...sites], 'plate')).toEqual({ vinRequired: false, plateRequired: true });
    expect(siteRules([...sites], 'both')).toEqual({ vinRequired: true, plateRequired: true });
    expect(siteRules([...sites], 'none')).toEqual({ vinRequired: false, plateRequired: false });
  });

  it('falls back to the defaults (VIN required, plate optional) while loading or unknown', () => {
    expect(siteRules([], 'plate')).toEqual({ vinRequired: true, plateRequired: false });
    expect(siteRules([...sites], null)).toEqual({ vinRequired: true, plateRequired: false });
  });
});

/* New Job follows the site the job will go to: for an admin that can be the
   picked worker's site, so picking another worker re-reads the rules. */
describe('siteRules follows the job site (0042)', () => {
  const sites = [
    { id: 's1', active: true, vin_rule: 'required', plate_rule: 'optional' },
    { id: 's2', active: true, vin_rule: 'optional', plate_rule: 'required' },
  ] as const;
  const admin = { role: 'admin', site_id: null } as const;

  it('switches with the picked worker, and with an explicit site pick', () => {
    const rulesFor = (picked: string | null, workerSite: string | null) =>
      siteRules([...sites], jobSiteId(admin, picked, null, workerSite, [...sites]));
    expect(rulesFor(null, 's1')).toEqual({ vinRequired: true, plateRequired: false });
    expect(rulesFor(null, 's2')).toEqual({ vinRequired: false, plateRequired: true });
    expect(rulesFor('s1', 's2')).toEqual({ vinRequired: true, plateRequired: false });
  });

  it('never goes looser than the defaults for a site cached before 0042 (no rule fields)', () => {
    const stale = [{ id: 's1' }] as unknown as Parameters<typeof siteRules>[0];
    expect(siteRules(stale, 's1')).toEqual({ vinRequired: true, plateRequired: false });
  });
});

/* New Job's identity checks under each of the four rule combinations (0042). */
describe('vehicleProblems (0042)', () => {
  const PLATE = '12345678';
  const VIN = '1HGCM82633A004352';
  const DEF = { vinRequired: true, plateRequired: false };
  const PLATE_ONLY = { vinRequired: false, plateRequired: true };
  const BOTH = { vinRequired: true, plateRequired: true };
  const NONE = { vinRequired: false, plateRequired: false };
  const p = (plate: string, vin: string, vinPhoto: boolean, rules: typeof DEF) => vehicleProblems({ plate, vin, vinPhoto }, rules);

  it('defaults (VIN required, plate optional): VIN and its photo needed, plate not', () => {
    expect(p('', VIN, true, DEF)).toEqual([]);
    expect(p('', '', false, DEF)).toEqual(['vinPhotoRequired', 'vinRequired']);
    expect(p(PLATE, '   ', true, DEF)).toEqual(['vinRequired']);
  });

  it('plate required, VIN optional: plate needed, VIN and VIN photo not', () => {
    expect(p(PLATE, '', false, PLATE_ONLY)).toEqual([]);
    expect(p('', VIN, false, PLATE_ONLY)).toEqual(['plateRequired']);
    expect(p('', '', false, PLATE_ONLY)).toEqual(['plateRequired']);
  });

  it('both required: all three, in on-screen order', () => {
    expect(p('', '', false, BOTH)).toEqual(['vinPhotoRequired', 'plateRequired', 'vinRequired']);
    expect(p(PLATE, VIN, true, BOTH)).toEqual([]);
  });

  it('both optional: either one is enough, neither (or blanks) is not', () => {
    expect(p(PLATE, '', false, NONE)).toEqual([]);
    expect(p('', VIN, false, NONE)).toEqual([]);
    expect(p('', '', false, NONE)).toEqual(['plateOrVinRequired']);
    expect(p('  ', '\t ', false, NONE)).toEqual(['plateOrVinRequired']);
  });

  it('a malformed typed value blocks under every rule; a bad check digit does not', () => {
    for (const rules of [DEF, PLATE_ONLY, BOTH, NONE]) {
      expect(p('1234', VIN, true, rules)).toContain('plateInvalid');
      expect(p(PLATE, '1HGCM82633A00435', true, rules)).toContain('vinInvalid');
      expect(p(PLATE, '1HGCM82633A0O4352', true, rules)).toContain('vinInvalid');
      expect(p(PLATE, 'WVWZZZ1JZXW000001', true, rules)).toEqual([]);
    }
  });
});
