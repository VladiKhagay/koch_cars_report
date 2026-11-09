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
let rpcFails = false;
/* What set_job_services answers; null = success. */
let setServicesError: { message: string; code?: string } | null = null;
const uploads: string[] = [];
/* Rows the stub claims already exist when submitVideo looks for the video row. */
let existingVideoRows: unknown[] = [];
/* Every .eq(column, value) on a photos select, and every upsert call (an empty upsert pushes no rows). */
const selectEqs: [string, unknown][] = [];
let upsertCalls = 0;
const upsertOpts: unknown[] = [];
/* What an upsert(...).select('id') answers: [] is RLS quietly refusing the write. */
let selectRows: unknown[] = [{ id: 'p1' }];
/* What that .select('id') errors with (PostgREST / RLS error); null = none. */
let selectError: { message: string } | null = null;
/* Every photos update (removeMedia), with its filters. */
const updates: { fields: Record<string, unknown>; eqs: [string, unknown][] }[] = [];

vi.mock('./supabase', () => {
  return {
    supabase: {
      from: (table: string) => ({
        insert: (rows: unknown) => {
          if (table === 'jobs') throw new Error('jobs are created through create_job, never inserted directly');
          insertedPhotos.push(...(rows as unknown[]));
          return Promise.resolve({ error: null });
        },
        upsert: (rows: unknown, opts?: unknown) => {
          upsertCalls++;
          upsertOpts.push(opts);
          insertedPhotos.push(...(Array.isArray(rows) ? rows : [rows]));
          // Awaitable as-is (submitJob) or with .select('id') (media edits, which count the rows back).
          return Object.assign(Promise.resolve({ error: null }), {
            select: () => Promise.resolve({ data: selectError ? null : selectRows, error: selectError }),
          });
        },
        update: (fields: Record<string, unknown>) => {
          const call = { fields, eqs: [] as [string, unknown][] };
          updates.push(call);
          const chain = {
            eq: (c: string, v: unknown) => {
              call.eqs.push([c, v]);
              return chain;
            },
            select: () => Promise.resolve({ data: selectError ? null : selectRows, error: selectError }),
          };
          return chain;
        },
        select: () => ({
          eq: (c1: string, v1: unknown) => ({
            eq: (c2: string, v2: unknown) => {
              selectEqs.push([c1, v1], [c2, v2]);
              return Promise.resolve({ data: existingVideoRows, error: null });
            },
          }),
        }),
      }),
      /* Always claims an earlier job, so the "never asked" assertions are real
         rather than passing because the stub returns nothing. */
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, ...args });
        // create_job (0033) is the job insert: it returns the new id as a scalar.
        if (fn === 'create_job') {
          insertedJobs.push(args);
          return Promise.resolve({ data: `job-${++jobIdSeq}`, error: null });
        }
        if (fn === 'set_job_services') return Promise.resolve({ data: null, error: setServicesError });
        if (fn === 'find_previous_job' && rpcFails) return Promise.reject(new Error('offline'));
        return Promise.resolve({ data: [{ created_at: '2026-01-01T00:00:00Z', site_name: 'North', service_name_en: 'Wash' }], error: null });
      },
    },
  };
});

/* The resumable video calls. Each logs what it was sent; tests override with mockImplementationOnce/mockRejectedValueOnce. */
const w = vi.hoisted(() => {
  class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    HttpError,
    calls: [] as string[],
    /* The timeout each uploadPhoto call was given (photos: none). */
    photoTimeouts: [] as unknown[],
    start: vi.fn(),
    part: vi.fn(),
    complete: vi.fn(),
  };
});
const piece = async (b: Blob) => await b.text();

vi.mock('./workerApi', () => ({
  HttpError: w.HttpError,
  PIECE_TIMEOUT_MS: 1000,
  uploadPhoto: (jobId: string, kind: string, _blob: Blob, timeoutMs?: number) => {
    if (uploadFails) return Promise.reject(new Error('offline'));
    uploads.push(kind);
    w.photoTimeouts.push(timeoutMs);
    return Promise.resolve(`${jobId}/${kind}.jpg`);
  },
  startVideoUpload: w.start,
  uploadVideoPart: w.part,
  completeVideoUpload: w.complete,
}));

/* 4-byte pieces, so a 10-byte "video" is three pieces: '0123' '4567' '89'. */
vi.mock('./video', async (importOriginal) => ({ ...(await importOriginal<object>()), VIDEO_PART_BYTES: 4 }));

const { submitJob, submitVideo, applyJobFilters, shareFor, lineShareFor, findPreviousJob, setJobServices, serviceTotal, setMedia, removeMedia, slotExists } =
  await import('./jobs');
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
    serviceIds: ['svc-1'],
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
  uploads.length = 0;
  existingVideoRows = [];
  selectEqs.length = 0;
  upsertCalls = 0;
  upsertOpts.length = 0;
  selectRows = [{ id: 'p1' }];
  selectError = null;
  updates.length = 0;
  setServicesError = null;
  w.calls.length = 0;
  w.photoTimeouts.length = 0;
  w.start.mockReset().mockImplementation(async (_jobId: string, b: Blob) => {
    w.calls.push(`start:${await piece(b)}`);
    return { uploadId: 'up-1', etag: 'e1' };
  });
  w.part.mockReset().mockImplementation(async (_jobId: string, uploadId: string, n: number, b: Blob) => {
    w.calls.push(`part${n}@${uploadId}:${await piece(b)}`);
    return { etag: `e${n}` };
  });
  w.complete.mockReset().mockImplementation(async (jobId: string, uploadId: string, parts: unknown[]) => {
    w.calls.push(`complete@${uploadId}:${parts.length}`);
    return { key: `video/${jobId}` };
  });
});

/*
 * The video no longer rides with the job: Submit returns once the job and its
 * photos are in, and the clip follows from its own queue entry (offlineQueue).
 */
describe('submitJob / submitVideo — the video follows the job', () => {
  const video = () => new Blob(['0123456789'], { type: 'video/mp4' });

  it('submitJob uploads no video and writes no video row, even when the payload has one', async () => {
    await submitJob({ ...payload(), videoBlob: video() });
    expect(uploads).toEqual(['plate', 'vin']);
    expect(insertedPhotos.map((p) => (p as { kind: string }).kind)).not.toContain('video');
  });

  it('submitVideo sends it in pieces (start, parts, complete), then records the row once', async () => {
    const saved: unknown[] = [];
    await submitVideo('job-9', video(), { save: (u) => void saved.push(structuredClone(u)) });
    expect(selectEqs).toEqual([
      ['job_id', 'job-9'],
      ['kind', 'video'],
    ]);
    // Each piece is exactly its byte range.
    expect(w.calls).toEqual(['start:0123', 'part2@up-1:4567', 'part3@up-1:89', 'complete@up-1:3']);
    expect(w.complete).toHaveBeenCalledWith('job-9', 'up-1', [
      { partNumber: 1, etag: 'e1' },
      { partNumber: 2, etag: 'e2' },
      { partNumber: 3, etag: 'e3' },
    ], undefined);
    // Saved after every piece, so a cut-off run resumes from the last one.
    expect(saved.map((u) => (u as { parts: unknown[] }).parts.length)).toEqual([1, 2, 3]);
    expect(saved[0]).toEqual({ uploadId: 'up-1', partSize: 4, parts: [{ partNumber: 1, etag: 'e1' }] });
    expect(uploads).toEqual([]);
    expect(upsertCalls).toBe(1);
    expect(insertedPhotos).toEqual([{ job_id: 'job-9', kind: 'video', r2_key: 'video/job-9' }]);
  });

  it('resumes: sends only the pieces that had not landed', async () => {
    const upload = { uploadId: 'up-old', partSize: 4, parts: [{ partNumber: 1, etag: 'e1' }, { partNumber: 2, etag: 'e2' }] };
    await submitVideo('job-9', video(), { upload });
    expect(w.calls).toEqual(['part3@up-old:89', 'complete@up-old:3']);
  });

  /* Every piece landed but the row write failed last time: just complete again (idempotent on the Worker). */
  it('resumes with every piece in by going straight to complete', async () => {
    const parts = [1, 2, 3].map((n) => ({ partNumber: n, etag: `e${n}` }));
    await submitVideo('job-9', video(), { upload: { uploadId: 'up-old', partSize: 4, parts } });
    expect(w.calls).toEqual(['complete@up-old:3']);
    expect(insertedPhotos).toHaveLength(1);
  });

  /* Cleared first (save(null)), so the queue's progress and attempt rule never read the stale state. */
  it.each([
    ['another piece size', { uploadId: 'up-old', partSize: 8, parts: [{ partNumber: 1, etag: 'x' }] }],
    ['a gap', { uploadId: 'up-old', partSize: 4, parts: [{ partNumber: 2, etag: 'x' }] }],
    ['more parts than the clip has', { uploadId: 'up-old', partSize: 4, parts: [1, 2, 3, 4].map((n) => ({ partNumber: n, etag: 'x' })) }],
  ])('starts over, clearing the saved state first, when it has %s', async (_why, upload) => {
    const saved: unknown[] = [];
    await submitVideo('job-9', video(), { upload, save: (u) => void saved.push(u) });
    expect(saved[0]).toBeNull();
    expect(w.calls).toEqual(['start:0123', 'part2@up-1:4567', 'part3@up-1:89', 'complete@up-1:3']);
  });

  it('a valid saved state is not cleared', async () => {
    const saved: unknown[] = [];
    const upload = { uploadId: 'up-old', partSize: 4, parts: [{ partNumber: 1, etag: 'e1' }] };
    await submitVideo('job-9', video(), { upload, save: (u) => void saved.push(u) });
    expect(saved).not.toContain(null);
  });

  it('a clip that is an exact multiple of the piece size has no empty last piece', async () => {
    await submitVideo('job-9', new Blob(['01234567']));
    expect(w.calls).toEqual(['start:0123', 'part2@up-1:4567', 'complete@up-1:2']);
  });

  it.each(['012', '0123'])('a clip of one piece or less (%j) is start then complete', async (bytes) => {
    await submitVideo('job-9', new Blob([bytes]));
    expect(w.calls).toEqual([`start:${bytes}`, 'complete@up-1:1']);
    expect(w.part).not.toHaveBeenCalled();
  });

  /* The piece landed but its response was lost (a later failure ends the run): the next run re-sends that same piece. */
  it('a lost response re-sends the same piece number', async () => {
    let state: unknown = null;
    const save = (u: unknown) => void (state = structuredClone(u));
    w.part.mockRejectedValueOnce(new w.HttpError(403, 'lost')); // permanent here only so the run ends without backoff
    await expect(submitVideo('job-9', video(), { save })).rejects.toThrow();
    expect((state as { parts: unknown[] }).parts).toHaveLength(1);

    w.calls.length = 0;
    await submitVideo('job-9', video(), { upload: state as never, save });
    expect(w.calls).toEqual(['part2@up-1:4567', 'part3@up-1:89', 'complete@up-1:3']);
  });

  it('retries a transient piece failure within the run', async () => {
    vi.useFakeTimers();
    try {
      w.part.mockRejectedValueOnce(new TypeError('network')).mockRejectedValueOnce(new TypeError('network'));
      const run = submitVideo('job-9', video());
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(6_000);
      await run;
      expect(w.part).toHaveBeenCalledTimes(4); // part 2 three times, part 3 once
      expect(w.calls).toEqual(['start:0123', 'part2@up-1:4567', 'part3@up-1:89', 'complete@up-1:3']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a piece after three tries', async () => {
    vi.useFakeTimers();
    try {
      w.part.mockRejectedValue(new TypeError('network'));
      const run = expect(submitVideo('job-9', video())).rejects.toBeInstanceOf(TypeError);
      await vi.advanceTimersByTimeAsync(8_000);
      await run;
      expect(w.part).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  /* The start limiter's window is 60 s; the 2 s / 6 s backoffs would only spend more start tokens. */
  it.each(['start', 'part', 'complete'] as const)('a 429 from %s is not retried within the run', async (step) => {
    w[step].mockRejectedValueOnce(new w.HttpError(429, 'rate_limited'));
    await expect(submitVideo('job-9', video())).rejects.toMatchObject({ status: 429 });
    expect(w[step]).toHaveBeenCalledTimes(1);
    expect(insertedPhotos).toEqual([]);
  });

  /* R2 dropped the upload (expired after days in the queue): start that video over, once. */
  it('restarts from zero once when the upload is gone (410)', async () => {
    const saved: unknown[] = [];
    const upload = { uploadId: 'up-old', partSize: 4, parts: [{ partNumber: 1, etag: 'e1' }] };
    w.part.mockRejectedValueOnce(new w.HttpError(410, 'gone'));
    await submitVideo('job-9', video(), { upload, save: (u) => void saved.push(u) });
    expect(w.part).toHaveBeenCalledTimes(3); // no in-run retry of a 410
    expect(w.calls).toEqual(['start:0123', 'part2@up-1:4567', 'part3@up-1:89', 'complete@up-1:3']);
    expect(saved[0]).toBeNull();
    expect(insertedPhotos).toHaveLength(1);
  });

  it('a second 410 in the same run is thrown, not looped on', async () => {
    w.part.mockRejectedValue(new w.HttpError(410, 'gone'));
    await expect(submitVideo('job-9', video())).rejects.toMatchObject({ status: 410 });
    expect(w.start).toHaveBeenCalledTimes(2);
    expect(insertedPhotos).toEqual([]);
  });

  /* The web app deployed before the Worker had /video/*: send it the old way. */
  it('falls back to the single-request upload when start answers 404', async () => {
    w.start.mockRejectedValueOnce(new w.HttpError(404, 'Not Found'));
    await submitVideo('job-9', video());
    expect(uploads).toEqual(['video']);
    expect(w.part).not.toHaveBeenCalled();
    expect(insertedPhotos).toEqual([{ job_id: 'job-9', kind: 'video', r2_key: 'job-9/video.jpg' }]);
    // A bounded single request: as long as its 3 pieces would have had.
    expect(w.photoTimeouts).toEqual([3000]);
  });

  /* The Worker was rolled back after this clip's state was saved: not permanent, send it the old way. */
  it.each([
    ['part', () => w.part.mockRejectedValueOnce(new w.HttpError(404, 'Not Found'))],
    ['complete', () => w.complete.mockRejectedValueOnce(new w.HttpError(404, 'Not Found'))],
  ])('a 404 from %s clears the state and falls back to the single-request upload', async (_route, fail) => {
    fail();
    const saved: unknown[] = [];
    const upload = { uploadId: 'up-old', partSize: 4, parts: [{ partNumber: 1, etag: 'e1' }] };
    await submitVideo('job-9', video(), { upload, save: (u) => void saved.push(u) });
    expect(saved.at(-1)).toBeNull();
    expect(uploads).toEqual(['video']);
    expect(w.start).not.toHaveBeenCalled();
    expect(insertedPhotos).toEqual([{ job_id: 'job-9', kind: 'video', r2_key: 'job-9/video.jpg' }]);
  });

  /* A rerun after the row landed (the phone locked before the queue entry was
     deleted) must not send 75MB again. */
  it('skips the upload when the video row already exists', async () => {
    existingVideoRows = [{ id: 'p-1' }];
    await submitVideo('job-9', video(), { upload: { uploadId: 'up-1', partSize: 4, parts: [{ partNumber: 1, etag: 'e1' }] } });
    expect(uploads).toEqual([]);
    expect(w.calls).toEqual([]);
    expect(insertedPhotos).toEqual([]);
  });

  /* Plate/VIN photos are optional: a car with neither writes no photos at all, not an empty upsert. */
  it('submitJob makes no photos call for a car with no photos', async () => {
    await submitJob({ ...payload(), plateBlob: null, vinBlob: null, videoBlob: video() });
    expect(insertedJobs).toHaveLength(1);
    expect(uploads).toEqual([]);
    expect(upsertCalls).toBe(0);
  });

  it('writes no row when the upload fails', async () => {
    w.complete.mockRejectedValueOnce(new w.HttpError(403, 'Forbidden'));
    await expect(submitVideo('job-9', video())).rejects.toThrow();
    expect(insertedPhotos).toEqual([]);
  });
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

describe('submitJob — crew', () => {
  it('writes the co-workers in the same insert as the job', async () => {
    await submitJob({ ...payload(), coworkerIds: ['w-2', 'w-3'] });
    expect(insertedJobs[0]).toMatchObject({ p_coworker_ids: ['w-2', 'w-3'] });
  });

  /* Payloads queued offline before the crew existed have no coworkerIds. */
  it('lands an old queued payload with an empty crew', async () => {
    await submitJob(payload());
    expect(insertedJobs[0]).toMatchObject({ p_coworker_ids: [] });
  });
});

describe('lineShareFor', () => {
  const line = { submitter_share: 20.01, coworker_share: 20 };
  it('gives the submitter the submitter share of the line, a co-worker the even share', () => {
    expect(lineShareFor({ worker_id: 'dana' }, line, 'dana')).toBe(20.01);
    expect(lineShareFor({ worker_id: 'dana' }, line, 'avi')).toBe(20);
  });
});

/* ---------------------------------------------------------- services (0033) */

describe('submitJob — services', () => {
  const row = () => insertedJobs[0] as Record<string, unknown>;

  it('sends every picked service in the one create_job call', async () => {
    await submitJob({ ...payload(), serviceIds: ['svc-1', 'svc-2'] });
    expect(rpcCalls).toHaveLength(1);
    expect(row().p_service_ids).toEqual(['svc-1', 'svc-2']);
  });

  /* The price is the database's to stamp: nothing the phone sends can set pay. */
  it('sends no price', async () => {
    await submitJob(payload());
    expect(Object.keys(row()).some((k) => /price|share/.test(k))).toBe(false);
  });

  it('drops a service picked twice', async () => {
    await submitJob({ ...payload(), serviceIds: ['svc-1', 'svc-2', 'svc-1'] });
    expect(row().p_service_ids).toEqual(['svc-1', 'svc-2']);
  });

  /* A car queued offline before 0033 sits in IndexedDB with one serviceId and no list. */
  it('lands a pre-0033 queued payload with its single service', async () => {
    const old = { ...payload(), serviceIds: undefined, serviceId: 'svc-9' } as unknown as NewJobPayload;
    await submitJob(old);
    expect(row().p_service_ids).toEqual(['svc-9']);
  });

  it('refuses a job with no service, before asking the database', async () => {
    await expect(submitJob({ ...payload(), serviceIds: [] })).rejects.toThrow();
    expect(rpcCalls).toEqual([]);
  });

  /* The row (and its services) already exists: a retry only finishes the photos. */
  it('a retry with the job id set does not create the job again', async () => {
    await submitJob({ ...payload(), jobId: 'job-7', serviceIds: [] });
    expect(rpcCalls).toEqual([]);
    expect(uploads).toEqual(['plate', 'vin']);
  });
});

describe('setJobServices', () => {
  it('replaces the set in one call, without duplicates', async () => {
    const { error } = await setJobServices('job-1', ['svc-1', 'svc-2', 'svc-1']);
    expect(error).toBeNull();
    expect(rpcCalls).toEqual([{ fn: 'set_job_services', p_job_id: 'job-1', p_service_ids: ['svc-1', 'svc-2'] }]);
  });

  it('refuses an empty list without asking the database', async () => {
    const { error } = await setJobServices('job-1', []);
    expect(error).not.toBeNull();
    expect(rpcCalls).toEqual([]);
  });
});

describe('serviceTotal', () => {
  const catalog = [
    { id: 'a', worker_price: 0.1 },
    { id: 'b', worker_price: 0.2 },
    { id: 'c', worker_price: 25 },
  ];
  it('adds up the picked services in whole cents', () => {
    expect(serviceTotal(catalog, ['a', 'b'])).toBe(0.3);
    expect(serviceTotal(catalog, ['a', 'b', 'c'])).toBe(25.3);
  });
  it('counts a service once and ignores ids not in the catalog', () => {
    expect(serviceTotal(catalog, ['c', 'c', 'gone'])).toBe(25);
    expect(serviceTotal(catalog, [])).toBe(0);
  });
});

describe('shareFor', () => {
  const job = { worker_id: 'dana', submitter_share: 33.34, coworker_share: 33.33 };
  it('gives the submitter their share, leftover cent included', () => {
    expect(shareFor(job, 'dana')).toBe(33.34);
  });
  it('gives a co-worker the even share', () => {
    expect(shareFor(job, 'avi')).toBe(33.33);
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
    expect(row().p_vin).toBeNull();
    expect(row().p_vin_valid_checksum).toBeNull();
  });

  it('treats a blank typed VIN the same as no VIN at all', async () => {
    await submitJob({ ...payload(), vin: '   ' });
    expect(row().p_vin).toBeNull();
  });

  /* The flag is the database's job (0029 insert trigger): the client sends none,
     so an offline-queued job is flagged exactly like an online one. */
  it('does not send a duplicate flag or ask the duplicate check on submit', async () => {
    await submitJob({ ...payload(), vin: null });
    expect(row()).not.toHaveProperty('p_duplicate_of_job_id');
    expect(rpcCalls.map((c) => (c as { fn: string }).fn)).toEqual(['create_job']);
  });

  it('still records everything else about the car', async () => {
    await submitJob({ ...payload(), vin: null });
    expect(row()).toMatchObject({ p_plate: '12-345-67', p_brand: 'VW', p_service_ids: ['svc-1'] });
    expect(insertedPhotos).toHaveLength(2);
  });

  it('leaves a job that does have a VIN untouched', async () => {
    await submitJob(payload());
    expect(row().p_vin).toBe('WVWZZZ1JZXW000001');
    expect(row().p_vin_valid_checksum).toBe(false); // real VIN, non-ISO check digit
  });
});

/*
 * Same treatment as the VIN, in the other direction: some cars arrive with no
 * physical plate at all. A job still needs SOMETHING to identify it by, so
 * plate and VIN can each go missing on their own, just not both at once.
 */
describe('submitJob — a car with no plate', () => {
  const row = () => insertedJobs[0] as Record<string, unknown>;

  it('stores NULL, not an empty string or a placeholder', async () => {
    await submitJob({ ...payload(), plate: null, plateBlob: null });
    expect(row().p_plate).toBeNull();
  });

  it('treats a blank typed plate the same as no plate at all', async () => {
    await submitJob({ ...payload(), plate: '   ', plateBlob: null });
    expect(row().p_plate).toBeNull();
  });

  it('still submits with no plate to compare', async () => {
    await submitJob({ ...payload(), plate: null, plateBlob: null });
    expect(row()).not.toHaveProperty('p_duplicate_of_job_id');
  });

  it('skips the plate photo slot entirely when no plate photo was taken', async () => {
    await submitJob({ ...payload(), plate: null, plateBlob: null });
    expect(insertedPhotos.map((p) => (p as { kind: string }).kind)).toEqual(['vin']);
  });

  it('rejects a job with neither a plate nor a VIN', async () => {
    await expect(
      submitJob({ ...payload(), plate: null, plateBlob: null, vin: null, vinBlob: null }),
    ).rejects.toThrow();
    expect(insertedJobs).toHaveLength(0);
  });
});

/* ---------------------------------------------------------- duplicate check */

describe('findPreviousJob', () => {
  it('asks by plate and VIN together and returns the earlier job', async () => {
    rpcCalls.length = 0;
    const prev = await findPreviousJob({ plate: '1234567', vin: 'WVWZZZ1JZXW000001' });
    expect(rpcCalls).toEqual([{ fn: 'find_previous_job', p_plate: '1234567', p_vin: 'WVWZZZ1JZXW000001' }]);
    expect(prev).toMatchObject({ site_name: 'North', service_name_en: 'Wash' });
  });

  it('works from the plate alone, and from the VIN alone', async () => {
    rpcCalls.length = 0;
    await findPreviousJob({ plate: '1234567', vin: null });
    await findPreviousJob({ plate: '  ', vin: 'WVWZZZ1JZXW000001' });
    expect(rpcCalls).toEqual([
      { fn: 'find_previous_job', p_plate: '1234567', p_vin: null },
      { fn: 'find_previous_job', p_plate: null, p_vin: 'WVWZZZ1JZXW000001' },
    ]);
  });

  it('never asks with nothing to match on', async () => {
    rpcCalls.length = 0;
    expect(await findPreviousJob({ plate: ' ', vin: null })).toBeNull();
    expect(rpcCalls).toEqual([]);
  });

  /* Offline: the warning is a courtesy, so failing to ask must not stop a submit. */
  it('treats a failed lookup as "no warning" instead of throwing', async () => {
    rpcFails = true;
    expect(await findPreviousJob({ vin: 'WVWZZZ1JZXW000001' })).toBeNull();
    rpcFails = false;
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
    overlaps: (c: string, v: string[]) => (calls.push(['overlaps', c, v.join('|')]), q),
    gte: (c: string, v: string) => (calls.push(['gte', c, v]), q),
    lte: (c: string, v: string) => (calls.push(['lte', c, v]), q),
    or: (f: string) => (calls.push(['or', f]), q),
  };
  return q;
}

describe('applyJobFilters', () => {
  it('asks the database for jobs with no reservation number', () => {
    const q = applyJobFilters(recorder(), { missingBilling: true });
    expect(q.calls).toEqual([['or', 'billing_code.is.null']]);
  });

  it('narrows by service in the query, not afterwards', () => {
    const q = applyJobFilters(recorder(), { serviceIds: ['svc-7'] });
    expect(q.calls).toEqual([['overlaps', 'service_ids', 'svc-7']]);
  });

  /* The worker screen lets several services be ticked at once. Several ids have
     to reach the database as one any-match (`ov`) over every service on the job,
     not just its first (0033) — narrowing to the first of them would
     quietly show a subset of the month and look like missing work. */
  it('sends every ticked service, not just the first', () => {
    const q = applyJobFilters(recorder(), { serviceIds: ['svc-7', 'svc-9'] });
    expect(q.calls).toEqual([['overlaps', 'service_ids', 'svc-7|svc-9']]);
  });

  it('combines the service filter with the others', () => {
    const q = applyJobFilters(recorder(), {
      siteId: 'site-1',
      workerId: 'aaaaaaaa-bbbb-cccc-dddd-000000000002',
      serviceIds: ['svc-7'],
      search: '12345',
    });
    expect(q.calls).toEqual([
      ['eq', 'site_id', 'site-1'],
      ['or', 'worker_id.eq.aaaaaaaa-bbbb-cccc-dddd-000000000002,coworker_ids.cs.{aaaaaaaa-bbbb-cccc-dddd-000000000002}'],
      ['overlaps', 'service_ids', 'svc-7'],
      ['or', 'plate.ilike.%12345%,vin.ilike.%12345%,billing_code.ilike.%12345%'],
    ]);
  });

  /* jobs_worker_view has no billing_code column, and PostgREST rejects the
     whole query — not just the offending clause — when asked to filter one that
     isn't there. A worker searching a plate would get an empty screen. */
  it('searches only the columns the caller names', () => {
    const q = applyJobFilters(recorder(), { search: '12345', searchColumns: ['plate'] });
    expect(q.calls).toEqual([['or', 'plate.ilike.%12345%']]);
  });

  /* A co-worker's own grid, a manager filtering by person and the payment
     sheet all mean "jobs this person worked on" — submitted or not. Matching
     only worker_id would hide every shared car from the co-worker. */
  it('matches a person as submitter or co-worker', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const q = applyJobFilters(recorder(), { workerId: id });
    expect(q.calls).toEqual([['or', `worker_id.eq.${id},coworker_ids.cs.{${id}}`]]);
  });

  it('ignores a worker id that is not a UUID rather than putting it in the filter string', () => {
    expect(applyJobFilters(recorder(), { workerId: 'x),deleted_at.is.null' }).calls).toEqual([]);
  });

  it('adds nothing at all when no filter is set', () => {
    expect(applyJobFilters(recorder(), {}).calls).toEqual([]);
    expect(applyJobFilters(recorder(), { serviceIds: [], siteId: null, search: '  ' }).calls).toEqual([]);
  });

  it('widens each date to its full local day, both ends inclusive', () => {
    const q = applyJobFilters(recorder(), { from: '2026-03-01', to: '2026-03-31' });
    expect(q.calls.map((c) => c[0])).toEqual(['gte', 'lte']);
    expect(q.calls[0][2]).toBe(new Date('2026-03-01T00:00:00').toISOString());
    expect(q.calls[1][2]).toBe(new Date('2026-03-31T23:59:59.999').toISOString());
  });
});

/* ------------------------------------------- services: edge cases (0033 QA) */

describe('submitJob — service ids, edge cases', () => {
  const row = () => insertedJobs[0] as Record<string, unknown>;

  /* An empty list is not "absent": a pre-0033 queued payload may carry serviceIds: [] next to its serviceId. */
  it('falls back to the legacy serviceId when serviceIds is an empty list', async () => {
    await submitJob({ ...payload(), serviceIds: [], serviceId: 'svc-9' });
    expect(row().p_service_ids).toEqual(['svc-9']);
  });

  it('prefers the serviceIds list over a stale legacy serviceId', async () => {
    await submitJob({ ...payload(), serviceIds: ['svc-1', 'svc-2'], serviceId: 'svc-9' });
    expect(row().p_service_ids).toEqual(['svc-1', 'svc-2']);
  });

  it('keeps the order the worker picked while dropping repeats', async () => {
    await submitJob({ ...payload(), serviceIds: ['svc-3', 'svc-1', 'svc-3', 'svc-2', 'svc-1'] });
    expect(row().p_service_ids).toEqual(['svc-3', 'svc-1', 'svc-2']);
  });

  /* A queued payload from before 0005 with neither field must not reach the database as a service-less job. */
  it('refuses a payload with neither serviceIds nor serviceId, before asking the database', async () => {
    const bare = { ...payload(), serviceIds: undefined } as unknown as NewJobPayload;
    await expect(submitJob(bare)).rejects.toThrow();
    expect(rpcCalls).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it('sends no price or share for a multi-service legacy-shaped payload either', async () => {
    await submitJob({ ...payload(), serviceIds: ['svc-1', 'svc-2'], serviceId: 'svc-1' });
    expect(Object.keys(row()).filter((k) => /price|share|duplicate/.test(k))).toEqual([]);
  });
});

describe('setJobServices — errors', () => {
  /* The edit window closed: the database says 42501, and the caller must see that code (MyJobs shows it). */
  it('passes the database error through unchanged', async () => {
    setServicesError = { message: 'job not found or not editable', code: '42501' };
    const { error } = await setJobServices('job-1', ['svc-1']);
    expect(error).toEqual({ message: 'job not found or not editable', code: '42501' });
  });

  it('sends ids only, never a price', async () => {
    await setJobServices('job-1', ['svc-1']);
    expect(Object.keys(rpcCalls[0] as object).sort()).toEqual(['fn', 'p_job_id', 'p_service_ids']);
  });
});

describe('serviceTotal — rounding', () => {
  it('sums cents exactly across many small prices', () => {
    const catalog = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, worker_price: 0.1 }));
    expect(serviceTotal(catalog, catalog.map((s) => s.id))).toBe(1);
    expect(serviceTotal([{ id: 'a', worker_price: 19.99 }, { id: 'b', worker_price: 0.01 }], ['a', 'b'])).toBe(20);
  });
});

describe('setMedia / removeMedia — manager edits of a slot', () => {
  it('uploads a photo and marks its row live, overwriting rather than ignoring a duplicate', async () => {
    await setMedia('job-9', 'extra_2', blob());
    expect(uploads).toEqual(['extra_2']);
    expect(insertedPhotos).toEqual([{ job_id: 'job-9', kind: 'extra_2', r2_key: 'job-9/extra_2.jpg', removed_at: null }]);
    expect(upsertOpts).toEqual([{ onConflict: 'job_id,kind' }]);
  });

  it('treats zero rows back as a failed write', async () => {
    selectRows = [];
    await expect(setMedia('job-9', 'plate', blob())).rejects.toThrow();
    await expect(removeMedia('job-9', 'plate')).rejects.toThrow();
  });

  it('removes by tombstoning the existing row, never uploading or inserting', async () => {
    await removeMedia('job-9', 'vin');
    expect(uploads).toEqual([]);
    expect(upsertCalls).toBe(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].eqs).toEqual([['job_id', 'job-9'], ['kind', 'vin']]);
    expect(Number.isNaN(Date.parse(String(updates[0].fields.removed_at)))).toBe(false);
  });

  it('replaces a video even when its row already exists', async () => {
    existingVideoRows = [{ id: 'old' }];
    await setMedia('job-9', 'video', new Blob(['0123456789'], { type: 'video/mp4' }));
    expect(selectEqs).toEqual([]);
    expect(w.calls).toContain('complete@up-1:3');
    expect(insertedPhotos).toEqual([{ job_id: 'job-9', kind: 'video', r2_key: 'video/job-9', removed_at: null }]);
    expect(upsertOpts).toEqual([{ onConflict: 'job_id,kind' }]);
  });

  it('leaves the worker path alone: an existing video row still means already sent', async () => {
    existingVideoRows = [{ id: 'old' }];
    await submitVideo('job-9', new Blob(['0123456789'], { type: 'video/mp4' }));
    expect(w.calls).toEqual([]);
    expect(upsertCalls).toBe(0);
  });
});

describe('setMedia / removeMedia — failure paths (test-engineer)', () => {
  it('a failed upload writes no row, so the slot is not marked live over the old object', async () => {
    uploadFails = true;
    await expect(setMedia('job-9', 'extra_1', blob())).rejects.toThrow('offline');
    expect(upsertCalls).toBe(0);
    expect(insertedPhotos).toEqual([]);
  });

  it('a PostgREST error on the row write or the tombstone rejects (never a silent success)', async () => {
    selectError = { message: 'new row violates row-level security policy' };
    await expect(setMedia('job-9', 'vin', blob())).rejects.toMatchObject({ message: selectError.message });
    await expect(removeMedia('job-9', 'extra_3')).rejects.toMatchObject({ message: selectError.message });
  });

  it('removing a slot that has no row (a legacy plate, an empty extra) throws instead of claiming success', async () => {
    selectRows = [];
    await expect(removeMedia('job-9', 'extra_1')).rejects.toThrow(/extra_1/);
    expect(updates[0].eqs).toEqual([['job_id', 'job-9'], ['kind', 'extra_1']]);
  });

  it('a video replace whose upload fails permanently writes no row', async () => {
    w.start.mockRejectedValueOnce(new w.HttpError(403, 'Forbidden'));
    await expect(setMedia('job-9', 'video', new Blob(['0123456789'], { type: 'video/mp4' }))).rejects.toThrow('Forbidden');
    expect(upsertCalls).toBe(0);
  });

  it('a video replace against an old Worker (404) falls back to /upload and still overwrites the row live', async () => {
    w.start.mockRejectedValueOnce(new w.HttpError(404, 'Not Found'));
    await setMedia('job-9', 'video', new Blob(['0123456789'], { type: 'video/mp4' }));
    expect(uploads).toEqual(['video']);
    expect(insertedPhotos).toEqual([{ job_id: 'job-9', kind: 'video', r2_key: 'job-9/video.jpg', removed_at: null }]);
    expect(upsertOpts).toEqual([{ onConflict: 'job_id,kind' }]);
  });

  it('a video replace that RLS refuses (zero rows back) rejects', async () => {
    selectRows = [];
    await expect(setMedia('job-9', 'video', new Blob(['0123456789'], { type: 'video/mp4' }))).rejects.toThrow(/video/);
  });
});

describe('slotExists — other slots never leak (test-engineer)', () => {
  const gone = '2026-01-01T00:00:00Z';
  it('a tombstone on one slot does not hide another', () => {
    const rows = [{ kind: 'vin' as const, removed_at: gone }, { kind: 'extra_1' as const, removed_at: gone }];
    expect(slotExists(rows, 'plate')).toBe(true);
    expect(slotExists(rows, 'extra_2')).toBe(false);
    expect(slotExists(rows, 'vin')).toBe(false);
  });
  it('a live plate/VIN/extra row reads as present; a re-added (un-tombstoned) slot too', () => {
    expect(slotExists([{ kind: 'plate', removed_at: null }], 'plate')).toBe(true);
    expect(slotExists([{ kind: 'extra_3', removed_at: null }], 'extra_3')).toBe(true);
  });
});

describe('slotExists', () => {
  const gone = '2026-01-01T00:00:00Z';
  it('plate and VIN with no row are legacy: still probed', () => {
    expect(slotExists([], 'plate')).toBe(true);
    expect(slotExists([], 'vin')).toBe(true);
  });
  it('extras and video need a live row', () => {
    expect(slotExists([], 'extra_1')).toBe(false);
    expect(slotExists([], 'video')).toBe(false);
    expect(slotExists([{ kind: 'video', removed_at: null }], 'video')).toBe(true);
  });
  it('a removed slot is empty, plate included', () => {
    expect(slotExists([{ kind: 'plate', removed_at: gone }], 'plate')).toBe(false);
    expect(slotExists([{ kind: 'extra_2', removed_at: gone }], 'extra_2')).toBe(false);
  });
});
