import { submitJob, type NewJobPayload } from './jobs';

const DB_NAME = 'car-prep-tracker';
const STORE = 'pending-jobs';

interface QueuedJob extends NewJobPayload {
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
  try {
    const pending = await listQueued();
    for (const job of pending) {
      try {
        await submitJob(job);
        await removeQueued(job.queuedId);
        onProgress?.(pending.length - 1);
      } catch {
        // Still failing (still offline, or server issue) — stop and retry later.
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

export function watchConnectivity(onFlushed?: () => void): () => void {
  const handler = () => void flushQueue().then(onFlushed);
  window.addEventListener('online', handler);
  // Also try on load in case we came back online while the tab was closed.
  void flushQueue().then(onFlushed);
  return () => window.removeEventListener('online', handler);
}
