import { submitJob, type NewJobPayload } from './jobs';

const DB_NAME = 'car-prep-tracker';
const STORE = 'pending-jobs';

export interface QueuedJob extends NewJobPayload {
  queuedId: string;
  queuedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'queuedId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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

/* --------------------------------------------------------------------------
 * Shared queue state
 *
 * The queue used to be readable only by New Job, which meant a worker standing
 * on My Jobs had no way to know anything was pending — and the cars at risk
 * were precisely the ones missing from their own record. The store below is a
 * plain external store so the app shell, New Job and My Jobs all read the same
 * snapshot, and it updates the moment a job is enqueued or flushed.
 * -------------------------------------------------------------------------- */

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
 * Called when a submission fails (offline, flaky signal, Worker down).
 * The job is never lost — it's persisted locally and retried automatically
 * the moment connectivity returns.
 */
export async function enqueueForRetry(payload: NewJobPayload): Promise<void> {
  const queued: QueuedJob = {
    ...payload,
    queuedId: crypto.randomUUID(),
    queuedAt: new Date().toISOString(),
  };
  await withStore('readwrite', (store) => store.put(queued));
  await refreshQueue();
}

export async function listQueued(): Promise<QueuedJob[]> {
  return withStore('readonly', (store) => store.getAll());
}

async function removeQueued(queuedId: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(queuedId));
}

let flushing = false;

/** Retries every queued submission in order; stops at the first failure so ordering is preserved. */
export async function flushQueue(onProgress?: (remaining: number) => void): Promise<void> {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  let changed = false;
  try {
    const pending = await listQueued();
    for (const job of pending) {
      try {
        await submitJob(job);
        await removeQueued(job.queuedId);
        changed = true;
        onProgress?.(pending.length - 1);
      } catch {
        // Still failing (still offline, or server issue) — stop and retry later.
        break;
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

/**
 * Mounted once by the app shell. Keeps the shared snapshot current and retries
 * the queue whenever the device comes back online, so the pending count is
 * correct on every screen rather than only where New Job happened to refresh
 * it.
 */
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
