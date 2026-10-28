import { useSyncExternalStore } from 'react';
import { getQueueSnapshot, getUploadingId, getUploadProgress, subscribeQueue, type QueuedJob } from './offlineQueue';

/** Reads the offline submission queue from anywhere: pending work must be visible on every worker screen (PRODUCT.md, principle 3). */
export function useQueuedJobs(): QueuedJob[] {
  return useSyncExternalStore(subscribeQueue, getQueueSnapshot, getQueueSnapshot);
}

/** The queued video uploading right now, if any. */
export function useUploadingId(): string | null {
  return useSyncExternalStore(subscribeQueue, getUploadingId, getUploadingId);
}

/** Percent of the uploading video that is in, or null before its first piece lands. */
export function useUploadProgress(): number | null {
  return useSyncExternalStore(subscribeQueue, getUploadProgress, getUploadProgress);
}
