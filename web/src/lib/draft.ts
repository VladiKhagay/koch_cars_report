/**
 * The New Job form, kept across tab switches and page reloads.
 *
 * Opening the camera can make a low-memory phone reload the page, and switching
 * to My Jobs and back unmounts the form — either way the photos taken so far
 * (and the video) used to be gone. Blobs survive IndexedDB's structured clone,
 * so the whole form is stored as it stands and put back on the next visit.
 *
 * Everything here is best-effort: private windows and full disks make IndexedDB
 * throw, and a draft that can't be saved must never get in the way of a job
 * that can still be submitted.
 */
const DB_NAME = 'car-prep-draft';
const STORE = 'draft';
const KEY = 'new-job';
/** An unsent draft older than this is more likely a forgotten car than a live one. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDraft<T extends object>(form: T): Promise<void> {
  try {
    await run('readwrite', (s) => s.put({ form, savedAt: Date.now() }, KEY));
  } catch {
    /* best-effort */
  }
}

export async function loadDraft<T>(): Promise<T | null> {
  try {
    const row = (await run('readonly', (s) => s.get(KEY))) as { form: T; savedAt: number } | undefined;
    return row && Date.now() - row.savedAt < MAX_AGE_MS ? row.form : null;
  } catch {
    return null;
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    /* best-effort */
  }
}
