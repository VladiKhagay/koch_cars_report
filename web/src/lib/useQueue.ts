import { useSyncExternalStore } from 'react';
import { getQueueSnapshot, subscribeQueue, type QueuedJob } from './offlineQueue';

/**
 * Reads the offline submission queue from anywhere in the app.
 *
 * PRODUCT.md § principle 3: the worker must always know where their car
 * stands. Pending work therefore has to be visible from every worker screen,
 * not just from the screen that created it.
 */
export function useQueuedJobs(): QueuedJob[] {
  return useSyncExternalStore(subscribeQueue, getQueueSnapshot, getQueueSnapshot);
}

export function useQueuedCount(): number {
  return useQueuedJobs().length;
}
