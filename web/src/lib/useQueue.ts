import { useSyncExternalStore } from 'react';
import { getQueueSnapshot, subscribeQueue, type QueuedJob } from './offlineQueue';

/** Reads the offline submission queue from anywhere: pending work must be visible on every worker screen (PRODUCT.md, principle 3). */
export function useQueuedJobs(): QueuedJob[] {
  return useSyncExternalStore(subscribeQueue, getQueueSnapshot, getQueueSnapshot);
}

export function useQueuedCount(): number {
  return useQueuedJobs().length;
}
