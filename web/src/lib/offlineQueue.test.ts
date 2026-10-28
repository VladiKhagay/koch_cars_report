import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedJob } from './offlineQueue';
import type { NewJobPayload } from './jobs';

/*
 * The video now follows its job as its own queue entry. What must hold, on a
 * phone in a yard with one bar of signal:
 *   - the clip is never off disk until it is uploaded or the worker discards it;
 *   - a stuck video never holds up a job (the job is the record of the car);
 *   - a locked screen does not burn the retry budget;
 *   - entries queued by the previous version (video inside the job) still land.
 * Runs in node: IndexedDB is swapped for a Map through `queueStore`.
 */

vi.mock('./supabase', () => ({ supabase: {} }));

const mocks = vi.hoisted(() => ({ submitJob: vi.fn(), submitVideo: vi.fn() }));
vi.mock('./jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./jobs')>()),
  submitJob: mocks.submitJob,
  submitVideo: mocks.submitVideo,
}));

const { HttpError } = await import('./workerApi');
/* One module instance for the whole file (isPermanentError checks instanceof HttpError);
   every test leaves it idle — no run in flight, no upload, no wake lock. */
const q = await import('./offlineQueue');
/* The real IndexedDB-backed calls, before beforeEach swaps them for the Map. */
const realStore = { ...q.queueStore };
let db: Map<string, QueuedJob>;
let docListeners: Record<string, () => void>;
const doc = { visibilityState: 'visible' as DocumentVisibilityState };

const blob = (s = 'x') => new Blob([s]);
const video = blob('video');
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

function base(over: Partial<QueuedJob> = {}): QueuedJob {
  return {
    queuedId: crypto.randomUUID(),
    queuedAt: new Date().toISOString(),
    siteId: 's',
    workerId: 'w1',
    plate: '1234567',
    vin: null,
    brand: 'VW',
    workerNote: null,
    serviceId: 'svc',
    plateBlob: blob('plate'),
    vinBlob: blob('vin'),
    extraBlobs: [blob('extra')],
    ...over,
  };
}

const videoEntry = (over: Partial<QueuedJob> = {}) =>
  base({ stage: 'video', jobId: 'job-v', plateBlob: null, vinBlob: null, extraBlobs: [], videoBlob: video, ...over });

const seed = (...entries: QueuedJob[]) => entries.forEach((e) => db.set(e.queuedId, structuredClone(e)));
const stored = () => [...db.values()];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  vi.unstubAllGlobals();
  mocks.submitJob.mockReset().mockImplementation(async (p: NewJobPayload) => p.jobId ?? 'job-1');
  mocks.submitVideo.mockReset().mockResolvedValue(undefined);
  doc.visibilityState = 'visible';
  docListeners = {};
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('document', {
    get visibilityState() {
      return doc.visibilityState;
    },
    addEventListener: (type: string, fn: () => void) => (docListeners[type] = fn),
    removeEventListener: (type: string) => delete docListeners[type],
  });
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });

  db = new Map();
  // Copies both ways, like IndexedDB's structured clone, so nothing passes by aliasing.
  q.queueStore.getAll = async () => [...db.values()].map((e) => structuredClone(e));
  q.queueStore.put = async (e) => db.set(e.queuedId, structuredClone(e));
  q.queueStore.delete = async (id) => db.delete(id);
  q.setQueueOwner('w1');
  await q.flushQueue(); // let setQueueOwner's own flush finish on the empty store
});

describe('handoff: a landed job becomes its video entry', () => {
  it('rewrites the same entry in place, keeping the clip and dropping the photos', async () => {
    const job = base({ videoBlob: video, attempts: 2 });
    seed(job);
    let duringUpload: QueuedJob[] = [];
    mocks.submitVideo.mockImplementation(async () => {
      duringUpload = stored();
    });

    await q.flushQueue();

    expect(duringUpload).toHaveLength(1);
    expect(duringUpload[0]).toMatchObject({
      queuedId: job.queuedId,
      stage: 'video',
      jobId: 'job-1',
      plateBlob: null,
      vinBlob: null,
      extraBlobs: [],
      attempts: 0,
    });
    expect(duringUpload[0].videoBlob).toBeInstanceOf(Blob);
    expect(mocks.submitVideo).toHaveBeenCalledWith('job-1', expect.any(Blob));
    expect(stored()).toEqual([]);
  });

  /* Otherwise My Jobs still shows the car as "not submitted" for the whole upload, inviting a re-entry. */
  it('shows the handed-off entry as a video while it uploads', async () => {
    const job = base({ videoBlob: video });
    seed(job);
    let shown: QueuedJob[] = [];
    mocks.submitVideo.mockImplementation(async () => {
      shown = q.getQueueSnapshot();
    });
    await q.flushQueue();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ queuedId: job.queuedId, stage: 'video' });
    expect(q.getQueueSnapshot()).toEqual([]);
  });

  /* Otherwise the card flashes back to "waiting" for a clip that just landed. */
  it('never republishes a landed video to subscribers', async () => {
    seed(videoEntry());
    let landed = false;
    const seenAfter: number[] = [];
    mocks.submitVideo.mockImplementation(async () => {
      landed = true;
    });
    const off = q.subscribeQueue(() => landed && seenAfter.push(q.getQueueSnapshot().length));
    await q.flushQueue();
    off();
    expect(seenAfter.length).toBeGreaterThan(0);
    expect(seenAfter.every((n) => n === 0)).toBe(true);
  });

  it('deletes a job entry with no video', async () => {
    seed(base());
    await q.flushQueue();
    expect(stored()).toEqual([]);
    expect(mocks.submitVideo).not.toHaveBeenCalled();
  });

  /* Queued by the previous version, after the job row was made but before the uploads finished. */
  it('lands a legacy {jobId, videoBlob} entry through the same handoff', async () => {
    seed(base({ jobId: 'job-7', videoBlob: video }));
    await q.flushQueue();
    expect(mocks.submitJob).toHaveBeenCalledTimes(1);
    expect(mocks.submitVideo).toHaveBeenCalledWith('job-7', expect.any(Blob));
    expect(stored()).toEqual([]);
  });

  it('keeps the clip on disk when the video then fails', async () => {
    seed(base({ videoBlob: video }));
    mocks.submitVideo.mockRejectedValue(new TypeError('network'));
    await q.flushQueue();
    const [entry] = stored();
    expect(entry).toMatchObject({ stage: 'video', jobId: 'job-1', attempts: 1 });
    expect(entry.videoBlob).toBeInstanceOf(Blob);
  });
});

describe('a video never blocks a job', () => {
  it('sends a later job even though an older video keeps failing', async () => {
    seed(videoEntry({ queuedAt: hoursAgo(2) }), base({ plate: '7654321' }));
    mocks.submitVideo.mockRejectedValue(new TypeError('network'));

    await q.flushQueue();

    expect(mocks.submitJob).toHaveBeenCalledTimes(1);
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ stage: 'video', attempts: 1 });
  });

  it('still tries videos when a job fails transiently', async () => {
    seed(base(), videoEntry());
    mocks.submitJob.mockRejectedValue(new TypeError('network'));
    await q.flushQueue();
    expect(mocks.submitVideo).toHaveBeenCalledTimes(1);
  });

  /* The handoff reruns the queue; that rerun must not spend a stuck job's attempts. */
  it('a handoff rerun does not retry a job that just failed', async () => {
    seed(base({ videoBlob: video, queuedAt: hoursAgo(2) }), base({ queuedAt: hoursAgo(1) }));
    mocks.submitJob.mockResolvedValueOnce('job-1').mockRejectedValue(new TypeError('network'));
    await q.flushQueue();
    expect(mocks.submitJob).toHaveBeenCalledTimes(2);
    expect(mocks.submitVideo).toHaveBeenCalledWith('job-1', expect.any(Blob));
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ attempts: 1 });
  });

  it('lists jobs before videos, each oldest first', async () => {
    const v1 = videoEntry({ queuedAt: hoursAgo(3) });
    const j1 = base({ queuedAt: hoursAgo(1) });
    const j2 = base({ queuedAt: hoursAgo(2) });
    seed(v1, j1, j2);
    expect((await q.listQueued()).map((e) => e.queuedId)).toEqual([j2.queuedId, j1.queuedId, v1.queuedId]);
  });
});

describe('video failures', () => {
  it('a transient failure counts an attempt and stops the video pass', async () => {
    seed(videoEntry({ queuedAt: hoursAgo(2) }), videoEntry({ queuedAt: hoursAgo(1) }));
    mocks.submitVideo.mockRejectedValue(new TypeError('network'));
    await q.flushQueue();
    expect(mocks.submitVideo).toHaveBeenCalledTimes(1);
    expect(stored().map((e) => e.attempts ?? 0).sort()).toEqual([0, 1]);
    expect(stored().every((e) => !e.needsAttention)).toBe(true);
  });

  it('a permanent failure flags it for the worker at once', async () => {
    seed(videoEntry());
    mocks.submitVideo.mockRejectedValue(new HttpError(403, 'Forbidden'));
    await q.flushQueue();
    expect(stored()[0].needsAttention).toBe(true);
  });

  it('the fifth failed attempt flags it', async () => {
    seed(videoEntry({ attempts: 4 }));
    mocks.submitVideo.mockRejectedValue(new TypeError('network'));
    await q.flushQueue();
    expect(stored()[0]).toMatchObject({ attempts: 5, needsAttention: true });
  });

  it('a failure past 24 hours flags it', async () => {
    seed(videoEntry({ queuedAt: hoursAgo(25) }));
    mocks.submitVideo.mockRejectedValue(new TypeError('network'));
    await q.flushQueue();
    expect(stored()[0].needsAttention).toBe(true);
  });

  /* The screen locked mid-upload: not the upload's fault, so it must not use up the 5 attempts.
     On iOS the rejection arrives after resume, when the page is visible again. */
  it('a failure after the page was hidden mid-upload does not count an attempt', async () => {
    const stop = q.startQueueSync();
    await vi.waitFor(() => expect(docListeners.visibilitychange).toBeTypeOf('function'));
    await settle(); // startQueueSync's own flush of the empty store
    seed(videoEntry({ attempts: 4 }));
    let atRetry: QueuedJob | undefined;
    mocks.submitVideo
      .mockImplementationOnce(async () => {
        doc.visibilityState = 'hidden';
        docListeners.visibilitychange();
        doc.visibilityState = 'visible';
        docListeners.visibilitychange(); // resume: also asks for a rerun
        throw new TypeError('network');
      })
      .mockImplementationOnce(async () => {
        atRetry = stored()[0];
      });

    await q.flushQueue();

    // Counted, it would have been the 5th: flagged, and the rerun would skip it.
    expect(mocks.submitVideo).toHaveBeenCalledTimes(2);
    expect(atRetry).toMatchObject({ attempts: 4 });
    expect(atRetry?.needsAttention).toBeUndefined();
    stop();
  });

  it('a failure with the page visible throughout counts, even right after a hidden one', async () => {
    const stop = q.startQueueSync();
    await vi.waitFor(() => expect(docListeners.visibilitychange).toBeTypeOf('function'));
    await settle(); // startQueueSync's own flush of the empty store
    seed(videoEntry());
    mocks.submitVideo
      .mockImplementationOnce(async () => {
        doc.visibilityState = 'hidden';
        docListeners.visibilitychange();
        doc.visibilityState = 'visible';
        docListeners.visibilitychange();
        throw new TypeError('network');
      })
      .mockRejectedValueOnce(new TypeError('network'));

    await q.flushQueue();

    expect(mocks.submitVideo).toHaveBeenCalledTimes(2);
    expect(stored()[0]).toMatchObject({ attempts: 1 });
    stop();
  });

  /* Started while already hidden (no visibilitychange during the attempt): still not the upload's fault. */
  it('a failure of an upload started while the page was hidden does not count an attempt', async () => {
    seed(videoEntry({ attempts: 4 }));
    mocks.submitVideo.mockRejectedValue(new TypeError('network'));
    doc.visibilityState = 'hidden';
    await q.flushQueue();
    expect(mocks.submitVideo).toHaveBeenCalledTimes(1);
    expect(stored()[0]).toMatchObject({ attempts: 4 });
    expect(stored()[0].needsAttention).toBeUndefined();
  });

  /* A handoff reruns the queue; that rerun must not spend a second attempt on a video that just failed. */
  it('a handoff rerun does not retry a video that just failed', async () => {
    const older = videoEntry({ queuedAt: hoursAgo(2) });
    const job = base({ videoBlob: video, queuedAt: hoursAgo(1) });
    seed(older, job);
    mocks.submitVideo.mockRejectedValue(new TypeError('network'));
    await q.flushQueue();
    expect(mocks.submitVideo).toHaveBeenCalledTimes(1);
    expect(db.get(older.queuedId)).toMatchObject({ attempts: 1 });
    expect(db.get(job.queuedId)).toMatchObject({ stage: 'video', attempts: 0 });
  });

  /* Shared phone: the worker signed out (or someone else signed in) while it uploaded. */
  it('a failure after the owner changed neither counts nor flags', async () => {
    seed(videoEntry({ attempts: 2 }));
    mocks.submitVideo.mockImplementationOnce(async () => {
      q.setQueueOwner('w2');
      throw new HttpError(403, 'Forbidden'); // permanent: would flag at once if recorded
    });
    await q.flushQueue();
    expect(stored()[0]).toMatchObject({ attempts: 2 });
    expect(stored()[0].needsAttention).toBeUndefined();
  });

  it('skips a flagged video', async () => {
    seed(videoEntry({ needsAttention: true }));
    await q.flushQueue();
    expect(mocks.submitVideo).not.toHaveBeenCalled();
  });
});

describe('retry and discard', () => {
  it('retry resets attempts and the age clock, then sends it', async () => {
    const entry = videoEntry({ attempts: 5, needsAttention: true, queuedAt: hoursAgo(30) });
    seed(entry);
    mocks.submitVideo.mockRejectedValue(new TypeError('network'));

    await q.retryQueued(entry.queuedId);

    expect(mocks.submitVideo).toHaveBeenCalledTimes(1);
    const after = stored()[0];
    // One fresh attempt, not flagged: the 24h clock restarted at the retry.
    expect(after).toMatchObject({ attempts: 1 });
    expect(after.needsAttention).toBeUndefined();
    expect(Date.now() - new Date(after.queuedAt).getTime()).toBeLessThan(60_000);
  });

  it('retry that succeeds removes the entry', async () => {
    const entry = videoEntry({ needsAttention: true });
    seed(entry);
    await q.retryQueued(entry.queuedId);
    expect(stored()).toEqual([]);
  });

  it('discard removes a video entry', async () => {
    const entry = videoEntry({ needsAttention: true });
    seed(entry);
    await q.discardQueued(entry.queuedId);
    expect(stored()).toEqual([]);
  });

  /* A job entry is the only record of the car: it can never be thrown away from here. */
  it('discard leaves a job entry alone', async () => {
    const job = base({ needsAttention: true });
    seed(job);
    await q.discardQueued(job.queuedId);
    expect(stored()).toHaveLength(1);
  });
});

describe('queue mechanics', () => {
  it("neither lists nor sends another person's entries", async () => {
    seed(base({ workerId: 'w2' }), videoEntry({ workerId: 'w2' }));
    expect(await q.listQueued()).toEqual([]);
    await q.flushQueue();
    expect(mocks.submitJob).not.toHaveBeenCalled();
    expect(mocks.submitVideo).not.toHaveBeenCalled();
  });

  it('a video queued during a run is sent in the same run, not stranded', async () => {
    seed(base());
    let release!: () => void;
    mocks.submitJob.mockImplementationOnce(
      () => new Promise<string>((resolve) => (release = () => resolve('job-1'))),
    );
    const run = q.flushQueue();
    await vi.waitFor(() => expect(mocks.submitJob).toHaveBeenCalled());

    await q.enqueueVideo({ ...base(), videoBlob: video }, 'job-2');
    await q.flushQueue(); // returns at once: a run is in progress
    expect(mocks.submitVideo).not.toHaveBeenCalled();

    release();
    await run;
    expect(mocks.submitVideo).toHaveBeenCalledWith('job-2', expect.any(Blob));
    expect(stored()).toEqual([]);
  });

  /* A put can succeed while its transaction still aborts on commit (quota): nothing is on disk then. */
  it('enqueueVideo rejects when the IndexedDB transaction aborts after the put succeeded', async () => {
    const quota = new DOMException('Quota exceeded', 'QuotaExceededError');
    const fakeDb = {
      onclose: null,
      transaction: () => {
        const tx: Record<string, unknown> = { error: null };
        tx.objectStore = () => ({
          put: () => {
            const req: Record<string, unknown> = { result: 'key', error: null };
            setTimeout(() => {
              (req.onsuccess as () => void)?.();
              tx.error = quota;
              (tx.onabort as () => void)?.();
            });
            return req;
          },
        });
        return tx;
      },
    };
    vi.stubGlobal('indexedDB', {
      open: () => {
        const req: Record<string, unknown> = { result: fakeDb };
        setTimeout(() => (req.onsuccess as () => void)());
        return req;
      },
    });
    q.queueStore.put = realStore.put;

    await expect(q.enqueueVideo({ ...base(), videoBlob: video }, 'job-2')).rejects.toBe(quota);
  });

  it('enqueueVideo stores the clip without the photos', async () => {
    await q.enqueueVideo({ ...base(), videoBlob: video }, 'job-2');
    expect(stored()[0]).toMatchObject({ stage: 'video', jobId: 'job-2', plateBlob: null, vinBlob: null, extraBlobs: [] });
  });

  it('does nothing offline', async () => {
    seed(videoEntry());
    vi.stubGlobal('navigator', { onLine: false });
    await q.flushQueue();
    expect(mocks.submitVideo).not.toHaveBeenCalled();
  });
});

describe('wake lock', () => {
  it('holds the screen awake while a video uploads, and lets go after', async () => {
    const sentinel = { released: false, release: vi.fn(async () => {}) };
    const request = vi.fn(async () => sentinel);
    vi.stubGlobal('navigator', { onLine: true, wakeLock: { request } });
    seed(videoEntry());
    mocks.submitVideo.mockImplementation(async () => {
      expect(request).toHaveBeenCalledWith('screen');
      expect(sentinel.release).not.toHaveBeenCalled();
      expect(q.getUploadingId()).not.toBeNull();
    });

    await q.flushQueue();

    expect(sentinel.release).toHaveBeenCalledTimes(1);
    expect(q.getUploadingId()).toBeNull();
  });

  /* Coming back to the foreground mid-request must not ask twice and leak a sentinel. */
  it('a second hold while the request is pending reuses it', async () => {
    const sentinel = { released: false, release: vi.fn(async () => {}) };
    let grant!: () => void;
    const request = vi.fn(() => new Promise<typeof sentinel>((resolve) => (grant = () => resolve(sentinel))));
    vi.stubGlobal('navigator', { onLine: true, wakeLock: { request } });
    const stop = q.startQueueSync();
    await vi.waitFor(() => expect(docListeners.visibilitychange).toBeTypeOf('function'));
    await settle(); // startQueueSync's own flush of the empty store
    seed(videoEntry());
    let finishUpload!: () => void;
    mocks.submitVideo.mockImplementation(() => new Promise<void>((resolve) => (finishUpload = resolve)));

    const run = q.flushQueue();
    await vi.waitFor(() => expect(mocks.submitVideo).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledTimes(1);
    expect(q.getUploadingId()).not.toBeNull();
    docListeners.visibilitychange(); // visible again mid-upload, while the request is pending
    expect(request).toHaveBeenCalledTimes(1);

    grant();
    await settle();
    finishUpload();
    await run;
    expect(request).toHaveBeenCalledTimes(1);
    expect(sentinel.release).toHaveBeenCalledTimes(1);
    stop();
  });

  it('uploads anyway when the wake-lock request never settles', async () => {
    const sentinel = { released: false, release: vi.fn(async () => {}) };
    let grant!: () => void;
    const request = vi.fn(() => new Promise<typeof sentinel>((resolve) => (grant = () => resolve(sentinel))));
    vi.stubGlobal('navigator', { onLine: true, wakeLock: { request } });
    seed(videoEntry());
    await q.flushQueue(); // the request is still pending throughout
    expect(mocks.submitVideo).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual([]);
    // Granted late (leave the module idle for the next test): released at once, the upload is over.
    grant();
    await vi.waitFor(() => expect(sentinel.release).toHaveBeenCalledTimes(1));
  });

  it('uploads anyway when the browser has no wake lock, or refuses it', async () => {
    seed(videoEntry());
    await q.flushQueue();
    expect(stored()).toEqual([]);

    vi.stubGlobal('navigator', { onLine: true, wakeLock: { request: () => Promise.reject(new Error('denied')) } });
    seed(videoEntry());
    await q.flushQueue();
    expect(stored()).toEqual([]);
  });
});

describe('foreground', () => {
  it('retries the queue when the app becomes visible again', async () => {
    const stop = q.startQueueSync();
    await vi.waitFor(() => expect(docListeners.visibilitychange).toBeTypeOf('function'));
    await settle(); // startQueueSync's own flush of the empty store
    seed(videoEntry());

    docListeners.visibilitychange();
    await vi.waitFor(() => expect(mocks.submitVideo).toHaveBeenCalledTimes(1));

    stop();
    expect(docListeners.visibilitychange).toBeUndefined();
  });

  it('ignores the page going hidden', async () => {
    const stop = q.startQueueSync();
    await q.flushQueue();
    seed(videoEntry());
    doc.visibilityState = 'hidden';
    docListeners.visibilitychange();
    await Promise.resolve();
    expect(mocks.submitVideo).not.toHaveBeenCalled();
    stop();
  });
});
