import { submitJob, submitVideo, isPermanentError, type NewJobPayload } from './jobs';

const DB_NAME = 'car-prep-tracker';
const STORE = 'pending-jobs';

/** Stop auto-retrying — and flag for a human — after this many failed attempts... */
const MAX_ATTEMPTS = 5;
/** ...or this long since the job was first queued, whichever comes first. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface QueuedJob extends NewJobPayload {
  queuedId: string;
  queuedAt: string;
  /** Failed submit attempts so far. Missing on jobs queued before this field existed — treat as 0. */
  attempts?: number;
    /** Set once retrying stopped making sense (permanent error, or the attempts/age bound); flushQueue skips it. */
  needsAttention?: boolean;
  /**
   * 'video': the job and its photos are in; only the condition video (videoBlob)
   * is left to send, for `jobId`. Missing = a job entry, which is every entry
   * queued before deferred video existed. Same store, so no IndexedDB version bump.
   */
  stage?: 'video';
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'queuedId' });
    };
    req.onsuccess = () => {
      req.result.onclose = () => (dbPromise = null);
      resolve(req.result);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    // Settled by the transaction, not the request: a put can succeed and the
    // commit still abort (quota), and then nothing is on disk.
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? req.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

/**
 * The only three persistence calls the queue makes. An object, not imports, so
 * tests can swap in an in-memory store (vitest runs in node, without IndexedDB).
 */
export const queueStore = {
  getAll: (): Promise<QueuedJob[]> => withStore('readonly', (store) => store.getAll()),
  put: (entry: QueuedJob): Promise<unknown> => withStore('readwrite', (store) => store.put(entry)),
  delete: (queuedId: string): Promise<unknown> => withStore('readwrite', (store) => store.delete(queuedId)),
};

/* Shared queue state: a plain external store so every screen reads the same pending snapshot. */

let snapshot: QueuedJob[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Referentially stable between refreshes — safe for useSyncExternalStore. */
export function getQueueSnapshot(): QueuedJob[] {
  return snapshot;
}

/** Re-reads IndexedDB and notifies every subscriber. */
export async function refreshQueue(): Promise<QueuedJob[]> {
  try {
    snapshot = await listQueued();
  } catch {
    snapshot = [];
  }
  emit();
  return snapshot;
}

/**
 * Called when a submission fails. The payload is persisted locally so a
 * captured photo is never dropped. `needsAttention` skips auto-retry for a
 * failure already known to be permanent (see isPermanentError).
 */
export async function enqueueForRetry(payload: NewJobPayload, opts?: { needsAttention?: boolean }): Promise<void> {
  const queued: QueuedJob = {
    ...payload,
    queuedId: crypto.randomUUID(),
    queuedAt: new Date().toISOString(),
    attempts: opts?.needsAttention ? 1 : 0,
    needsAttention: opts?.needsAttention,
  };
  await queueStore.put(queued);
  await refreshQueue();
}

/**
 * A video-only entry: the clip and what MyJobs shows about the car, without the
 * photos (they are already in). Also the shape a job entry is rewritten into.
 */
function asVideoEntry(entry: QueuedJob, jobId: string): QueuedJob {
  return {
    ...entry,
    stage: 'video',
    jobId,
    plateBlob: null,
    vinBlob: null,
    extraBlobs: [],
    attempts: 0,
    needsAttention: undefined,
    queuedAt: new Date().toISOString(),
  };
}

/** Queues a just-submitted job's video for background upload. Resolves once it is on disk. */
export async function enqueueVideo(payload: NewJobPayload & { videoBlob: Blob }, jobId: string): Promise<void> {
  await queueStore.put(asVideoEntry({ ...payload, queuedId: crypto.randomUUID(), queuedAt: '' }, jobId));
  await refreshQueue();
}

/** Failed video entry: send it again with a fresh attempts and age budget. */
export async function retryQueued(queuedId: string): Promise<void> {
  const entry = (await queueStore.getAll()).find((e) => e.queuedId === queuedId);
  if (!entry) return;
  await queueStore.put({ ...entry, attempts: 0, needsAttention: undefined, queuedAt: new Date().toISOString() });
  await refreshQueue();
  await flushQueue();
}

/** Drops a video entry for good (the clip exists only here). Job entries are never discarded. */
export async function discardQueued(queuedId: string): Promise<void> {
  const entry = (await queueStore.getAll()).find((e) => e.queuedId === queuedId);
  if (entry?.stage !== 'video') return;
  await queueStore.delete(queuedId);
  await refreshQueue();
}

/**
 * The signed-in user's app id. On a shared phone the queue can hold another
 * person's jobs; those are neither shown nor submitted, and wait for their owner.
 */
let owner: string | null = null;

export function setQueueOwner(id: string | null): void {
  if (owner === id) return;
  owner = id;
  void flushQueue().catch(() => {}).then(refreshQueue);
}

/** Job entries first, then videos; each oldest first (getAll returns random-UUID order). */
export async function listQueued(): Promise<QueuedJob[]> {
  const all = await queueStore.getAll();
  return all
    .filter((job) => job.workerId === owner)
    .sort((a, b) => Number(a.stage === 'video') - Number(b.stage === 'video') || a.queuedAt.localeCompare(b.queuedAt));
}

/* The video entry being uploaded right now, for the "uploading" label. */
let uploadingId: string | null = null;

export function getUploadingId(): string | null {
  return uploadingId;
}

/*
 * Screen wake lock while a video uploads: a phone that locks mid-upload kills
 * the request. Not every browser has it (older iOS); then this does nothing.
 */
let wakeLock: WakeLockSentinel | null = null;
/* The request in flight: a second caller waits on it instead of asking again (and leaking a sentinel). */
let wakeLockRequest: Promise<void> | null = null;

function holdWakeLock(): Promise<void> {
  if ((wakeLock && !wakeLock.released) || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
    return Promise.resolve();
  }
  wakeLockRequest ??= (async () => {
    try {
      const sentinel = await navigator.wakeLock.request('screen').catch(() => null);
      // The upload may have ended while the request was pending.
      if (sentinel && !uploadingId) void sentinel.release().catch(() => {});
      else wakeLock = sentinel;
    } catch {
      // never let a missing wake lock stop an upload
    } finally {
      wakeLockRequest = null;
    }
  })();
  return wakeLockRequest;
}

function releaseWakeLock(): void {
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
}

/*
 * Set whenever the page goes hidden, reset as each video upload starts (to
 * true if it starts while hidden). A
 * failure after the page was hidden at any point during the attempt does not
 * count: a locked screen is not the upload's fault. Checking visibilityState at
 * failure time is not enough: iOS delivers the rejection after resume, when the
 * page is already visible again.
 */
let hiddenDuringAttempt = false;

/** Records a failed attempt. Returns true when the entry is now flagged for a human. */
async function recordFailure(entry: QueuedJob, err: unknown, countAttempt: boolean): Promise<boolean> {
  const attempts = (entry.attempts ?? 0) + (countAttempt ? 1 : 0);
  const age = Date.now() - new Date(entry.queuedAt).getTime();
  const exhausted = isPermanentError(err) || attempts >= MAX_ATTEMPTS || age >= MAX_AGE_MS;
  await queueStore.put({ ...entry, attempts, needsAttention: exhausted || undefined });
  return exhausted;
}

let flushing = false;
/** Set when flushQueue is called mid-run (or a job hands its video over), so the run goes round again. */
let again = false;

/**
 * Retries every queued entry: job entries first, in order, then videos.
 *
 * A job that lands with a video is rewritten in place (same queuedId, one put)
 * into a video entry, so the clip is never off disk. A transient failure stops
 * its own pass only, so a stuck video never holds up a job. A permanent failure,
 * or one past its attempts/age budget, is flagged `needsAttention` and skipped.
 */
export async function flushQueue(): Promise<void> {
  if (!navigator.onLine) return;
  if (flushing) {
    again = true;
    return;
  }
  flushing = true;
  let changed = false;
  // A job that failed transiently is not retried by this run's own reruns (that would burn its attempts).
  let jobsStalled = false;
  // Same for a video whose failure counted: one counted attempt per video per call.
  let videosStalled = false;
  try {
    do {
      again = false;
      const pending = (await listQueued()).filter((e) => !e.needsAttention);

      for (const entry of jobsStalled ? [] : pending.filter((e) => e.stage !== 'video')) {
        try {
          const jobId = await submitJob(entry);
          if (entry.videoBlob) {
            await queueStore.put(asVideoEntry(entry, jobId));
            again = true;
          } else {
            await queueStore.delete(entry.queuedId);
          }
          changed = true;
        } catch (err) {
          changed = true;
          if (!(await recordFailure(entry, err, true))) {
            jobsStalled = true; // transient — retry the job pass on the next run
            break;
          }
        }
      }

      for (const entry of videosStalled ? [] : pending.filter((e) => e.stage === 'video')) {
        if (!entry.jobId || !entry.videoBlob) {
          await queueStore.delete(entry.queuedId); // nothing left to send
          changed = true;
          continue;
        }
        uploadingId = entry.queuedId;
        // Re-read, not just emit: a job handed off this run must show as its video now, not as an unsent car.
        await refreshQueue();
        // Not awaited: a wake-lock request that never settles must not stall the upload.
        void holdWakeLock();
        // Whoever was signed in when it started: a failure after a sign-out/switch is not theirs to count.
        const startedBy = owner;
        // Starting while hidden counts as hidden: no event will fire to set it.
        hiddenDuringAttempt = typeof document !== 'undefined' && document.visibilityState === 'hidden';
        try {
          await submitVideo(entry.jobId, entry.videoBlob);
          await queueStore.delete(entry.queuedId);
          changed = true;
        } catch (err) {
          changed = true;
          if (owner !== startedBy) break;
          const counted = !hiddenDuringAttempt;
          if (!(await recordFailure(entry, err, counted))) {
            // transient: a counted one is not retried by this call's reruns; an uncounted one cost nothing
            if (counted) videosStalled = true;
            break;
          }
        } finally {
          uploadingId = null;
          releaseWakeLock();
          // From the store, not the old snapshot: that one still lists the clip that just landed.
          await refreshQueue();
        }
      }
    } while (again && navigator.onLine);
  } finally {
    flushing = false;
    again = false;
    if (changed) await refreshQueue();
  }
}

export function watchConnectivity(onFlushed?: () => void): () => void {
  // Errors swallowed: the entry is still on disk for the next trigger.
  const handler = () => void flushQueue().catch(() => {}).then(onFlushed);
  window.addEventListener('online', handler);
  // Also try on load in case we came back online while the tab was closed.
  void flushQueue().catch(() => {}).then(onFlushed);
  return () => window.removeEventListener('online', handler);
}

/** Mounted once by the app shell: keeps the snapshot current and retries when back online. */
export function startQueueSync(): () => void {
  void refreshQueue();
  const stop = watchConnectivity(() => void refreshQueue());
  const onOnline = () => void refreshQueue();
  const onOffline = () => void refreshQueue();
  // Back in the foreground: iOS dropped the wake lock and may have killed the upload.
  const onVisible = () => {
    if (document.visibilityState === 'hidden') hiddenDuringAttempt = true;
    if (document.visibilityState !== 'visible') return;
    if (uploadingId) void holdWakeLock();
    void flushQueue().catch(() => {}).then(refreshQueue);
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stop();
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
