import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * submitJob inserts the job row and *then* uploads photos, because the Worker
 * authorises an upload by asking whether the caller can see the job. That
 * ordering means a failed upload leaves a real job behind, and the caller
 * queues the payload for retry. Without the job id carried on the payload the
 * retry inserts the car a second time — which inflates the day's count, the
 * customer export and the payroll sheet at once, silently.
 *
 * Three optional photos make that path meaningfully more likely than two
 * required ones did, so it is pinned here.
 */

const insertedJobs: unknown[] = [];
const insertedPhotos: unknown[] = [];
const rpcCalls: unknown[] = [];
let jobIdSeq = 0;
let uploadFails = false;

vi.mock('./supabase', () => {
  const jobsInsert = (row: unknown) => {
    insertedJobs.push(row);
    const id = `job-${++jobIdSeq}`;
    return { select: () => ({ single: () => Promise.resolve({ data: { id }, error: null }) }) };
  };
  return {
    supabase: {
      from: (table: string) => ({
        insert: (rows: unknown) => {
          if (table === 'jobs') return jobsInsert(rows);
          insertedPhotos.push(...(rows as unknown[]));
          return Promise.resolve({ error: null });
        },
      }),
      /* Always claims a duplicate, so "no VIN means no duplicate" is a real
         assertion rather than one that passes because the stub returns null. */
      rpc: (_fn: string, args: { p_vin: string }) => {
        rpcCalls.push(args);
        return Promise.resolve({ data: 'earlier-job' });
      },
    },
  };
});

vi.mock('./workerApi', () => ({
  uploadPhoto: (jobId: string, kind: string) => {
    if (uploadFails) return Promise.reject(new Error('offline'));
    return Promise.resolve(`${jobId}/${kind}.jpg`);
  },
}));

const { submitJob, applyJobFilters } = await import('./jobs');
import type { NewJobPayload } from './jobs';

const blob = () => new Blob(['x'], { type: 'image/jpeg' });

function payload(extras: Blob[] = []): NewJobPayload {
  return {
    siteId: 'site-1',
    workerId: 'worker-1',
    plate: '12-345-67',
    vin: 'WVWZZZ1JZXW000001',
    brand: 'VW',
    workerNote: null,
    serviceId: 'svc-1',
    plateBlob: blob(),
    vinBlob: blob(),
    extraBlobs: extras,
  };
}

beforeEach(() => {
  insertedJobs.length = 0;
  insertedPhotos.length = 0;
  rpcCalls.length = 0;
  jobIdSeq = 0;
  uploadFails = false;
});

describe('submitJob — retry after a failed upload', () => {
  it('does not insert the job twice', async () => {
    const p = payload();

    uploadFails = true;
    await expect(submitJob(p)).rejects.toThrow();
    expect(insertedJobs).toHaveLength(1);
    // The id is recorded on the payload, which is the object that gets queued.
    expect(p.jobId).toBe('job-1');

    uploadFails = false;
    const id = await submitJob(p);
    expect(id).toBe('job-1');
    expect(insertedJobs).toHaveLength(1);
  });
});

describe('submitJob — photo slots', () => {
  it('uploads plate and vin when both were taken', async () => {
    await submitJob(payload());
    expect(insertedPhotos.map((p) => (p as { kind: string }).kind)).toEqual(['plate', 'vin']);
  });

  /* The VIN photo is optional for the same reason the VIN is: a VIN plate is
     routinely unreadable, and requiring a photograph of the unreadable thing
     is a gate on recording the car at all. A job without one carries no row of
     that kind — never a placeholder standing in for a photo nobody took. */
  it('skips the vin slot entirely when no VIN photo was taken', async () => {
    await submitJob({ ...payload(), vinBlob: null });
    expect(insertedPhotos.map((p) => (p as { kind: string }).kind)).toEqual(['plate']);
  });

  it('still numbers the extras from 1 when the vin slot is empty', async () => {
    await submitJob({ ...payload([blob(), blob()]), vinBlob: null });
    expect(insertedPhotos.map((p) => (p as { kind: string }).kind)).toEqual(['plate', 'extra_1', 'extra_2']);
  });

  it('maps extras onto extra_1..3 by position', async () => {
    await submitJob(payload([blob(), blob(), blob()]));
    expect(insertedPhotos.map((p) => (p as { kind: string }).kind)).toEqual([
      'plate',
      'vin',
      'extra_1',
      'extra_2',
      'extra_3',
    ]);
  });

  /* A worker who removes the first of two extras must leave the survivor in
     slot 1 — a gap would put a photo in extra_2 with extra_1 empty. NewJob
     closes the gap in the array; this pins the half that turns it into slots. */
  it('never leaves a hole when fewer than three are supplied', async () => {
    await submitJob(payload([blob()]));
    expect(insertedPhotos.map((p) => (p as { kind: string }).kind)).toEqual(['plate', 'vin', 'extra_1']);
  });

  it('ignores anything past the third extra rather than inventing a slot', async () => {
    await submitJob(payload([blob(), blob(), blob(), blob(), blob()]));
    const kinds = insertedPhotos.map((p) => (p as { kind: string }).kind);
    expect(kinds).toHaveLength(5);
    expect(kinds).not.toContain('extra_4');
  });

  it('records the r2 key the Worker returned for each slot', async () => {
    await submitJob(payload([blob()]));
    expect(insertedPhotos).toContainEqual({ job_id: 'job-1', kind: 'extra_1', r2_key: 'job-1/extra_1.jpg' });
  });
});

/*
 * A VIN plate is regularly unreadable — glare, a peeled sticker, a car whose
 * plate is somewhere this yard does not photograph. The car still has to be
 * logged, and the gap has to survive as a gap: '' would sort into the VIN index
 * like a real value and match every other blank in the duplicate check.
 */
describe('submitJob — a car with no readable VIN', () => {
  const row = () => insertedJobs[0] as Record<string, unknown>;

  it('stores NULL, not an empty string or a placeholder', async () => {
    await submitJob({ ...payload(), vin: null });
    expect(row().vin).toBeNull();
    expect(row().vin_valid_checksum).toBeNull();
  });

  it('treats a blank typed VIN the same as no VIN at all', async () => {
    await submitJob({ ...payload(), vin: '   ' });
    expect(row().vin).toBeNull();
  });

  it('claims no duplicate when there is no VIN to match on', async () => {
    await submitJob({ ...payload(), vin: null });
    expect(row().duplicate_of_job_id).toBeNull();
    // The check is not merely inconclusive — it is never asked.
    expect(rpcCalls).toEqual([]);
  });

  it('still records everything else about the car', async () => {
    await submitJob({ ...payload(), vin: null });
    expect(row()).toMatchObject({ plate: '12-345-67', brand: 'VW', service_id: 'svc-1' });
    expect(insertedPhotos).toHaveLength(2);
  });

  it('leaves a job that does have a VIN untouched', async () => {
    await submitJob(payload());
    expect(row().vin).toBe('WVWZZZ1JZXW000001');
    expect(row().vin_valid_checksum).toBe(false); // real VIN, non-ISO check digit
  });
});

/* --------------------------------------------------------------- filtering */

/**
 * The grid's narrowing has to happen in Postgres — a page of 50 rows filtered
 * in the browser is the wrong 50 rows. This records the calls instead of
 * mocking a database: what matters is that each filter reaches the query, and
 * that an absent one adds nothing.
 */
function recorder() {
  const calls: [string, ...string[]][] = [];
  const q = {
    calls,
    eq: (c: string, v: string) => (calls.push(['eq', c, v]), q),
    gte: (c: string, v: string) => (calls.push(['gte', c, v]), q),
    lte: (c: string, v: string) => (calls.push(['lte', c, v]), q),
    or: (f: string) => (calls.push(['or', f]), q),
  };
  return q;
}

describe('applyJobFilters', () => {
  it('narrows by service in the query, not afterwards', () => {
    const q = applyJobFilters(recorder(), { serviceId: 'svc-7' });
    expect(q.calls).toEqual([['eq', 'service_id', 'svc-7']]);
  });

  it('combines the service filter with the others', () => {
    const q = applyJobFilters(recorder(), {
      siteId: 'site-1',
      workerId: 'worker-2',
      serviceId: 'svc-7',
      search: '12345',
    });
    expect(q.calls).toEqual([
      ['eq', 'site_id', 'site-1'],
      ['eq', 'worker_id', 'worker-2'],
      ['eq', 'service_id', 'svc-7'],
      ['or', 'plate.ilike.%12345%,vin.ilike.%12345%,billing_code.ilike.%12345%'],
    ]);
  });

  it('adds nothing at all when no filter is set', () => {
    expect(applyJobFilters(recorder(), {}).calls).toEqual([]);
    expect(applyJobFilters(recorder(), { serviceId: '', siteId: null, search: '  ' }).calls).toEqual([]);
  });

  it('widens each date to its full local day, both ends inclusive', () => {
    const q = applyJobFilters(recorder(), { from: '2026-03-01', to: '2026-03-31' });
    expect(q.calls.map((c) => c[0])).toEqual(['gte', 'lte']);
    expect(q.calls[0][2]).toBe(new Date('2026-03-01T00:00:00').toISOString());
    expect(q.calls[1][2]).toBe(new Date('2026-03-31T23:59:59.999').toISOString());
  });
});
