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
      rpc: () => Promise.resolve({ data: null }),
    },
  };
});

vi.mock('./workerApi', () => ({
  uploadPhoto: (jobId: string, kind: string) => {
    if (uploadFails) return Promise.reject(new Error('offline'));
    return Promise.resolve(`${jobId}/${kind}.jpg`);
  },
}));

const { submitJob } = await import('./jobs');
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
  it('always uploads plate and vin', async () => {
    await submitJob(payload());
    expect(insertedPhotos.map((p) => (p as { kind: string }).kind)).toEqual(['plate', 'vin']);
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
