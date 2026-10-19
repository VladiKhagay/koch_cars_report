import { submitJob, isPermanentError, type NewJobPayload } from './jobs';

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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

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
  await withStore('readwrite', (store) => store.put(queued));
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
  void flushQueue().then(refreshQueue);
}

export async function listQueued(): Promise<QueuedJob[]> {
  const all = await withStore('readonly', (store) => store.getAll());
  return all.filter((job) => job.workerId === owner);
}

async function removeQueued(queuedId: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(queuedId));
}

let flushing = false;

/**
 * Retries every queued submission in order. A transient failure stops the run
 * so ordering is kept. A permanent failure, or one past its attempts/age budget,
 * is flagged `needsAttention` and skipped without blocking the rest.
 */
export async function flushQueue(onProgress?: (remaining: number) => void): Promise<void> {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  let changed = false;
  try {
    const pending = await listQueued();
    let remaining = pending.length;
    for (const job of pending) {
      if (job.needsAttention) continue;
      try {
        await submitJob(job);
        await removeQueued(job.queuedId);
        changed = true;
        remaining -= 1;
        onProgress?.(remaining);
      } catch (err) {
        const attempts = (job.attempts ?? 0) + 1;
        const age = Date.now() - new Date(job.queuedAt).getTime();
        const exhausted = isPermanentError(err) || attempts >= MAX_ATTEMPTS || age >= MAX_AGE_MS;
        await withStore('readwrite', (store) =>
          store.put({ ...job, attempts, needsAttention: exhausted || undefined }),
        );
        changed = true;
        if (!exhausted) break; // still transient — stop here, retry the whole run later
      }
    }
  } finally {
    flushing = false;
    if (changed) await refreshQueue();
  }
}

export function watchConnectivity(onFlushed?: () => void): () => void {
  const handler = () => void flushQueue().then(onFlushed);
  window.addEventListener('online', handler);
  // Also try on load in case we came back online while the tab was closed.
  void flushQueue().then(onFlushed);
  return () => window.removeEventListener('online', handler);
}

/** Mounted once by the app shell: keeps the snapshot current and retries when back online. */
export function startQueueSync(): () => void {
  void refreshQueue();
  const stop = watchConnectivity(() => void refreshQueue());
  const onOnline = () => void refreshQueue();
  const onOffline = () => void refreshQueue();
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    stop();
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
