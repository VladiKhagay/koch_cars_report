import { submitJob, submitVideo, isPermanentError, type NewJobPayload } from './jobs';
import { enqueueForRetry, enqueueVideo, flushQueue } from './offlineQueue';

/**
 * What Submit tells the worker:
 * - success / success-video-queued: the job is in (the video follows from the queue);
 * - video-not-saved: the job is in, the video could be neither queued nor sent;
 * - queued-for-retry / failed: the job is saved on the phone (failed = needs a human);
 * - queued-video-not-saved / failed-video-not-saved: as above, but without its video (no room).
 */
export type SendOutcome =
  | 'success'
  | 'success-video-queued'
  | 'video-not-saved'
  | 'queued-for-retry'
  | 'failed'
  | 'queued-video-not-saved'
  | 'failed-video-not-saved';

const defaultDeps = { submitJob, submitVideo, enqueueVideo, enqueueForRetry, flushQueue, isPermanentError };
export type SendDeps = typeof defaultDeps;

/**
 * Submits a job, then hands its video to the queue so Submit never waits on it.
 * Never rejects once the job row may exist, except when the job itself cannot
 * be kept on the phone at all (unchanged from before deferred video).
 * `payload.jobId` is set by submitJob as soon as the row exists, so every
 * enqueue below resumes that row instead of inserting a second job.
 */
export async function sendJob(
  payload: NewJobPayload,
  video: Blob | null | undefined,
  deps: SendDeps = defaultDeps,
): Promise<SendOutcome> {
  let jobId: string;
  try {
    jobId = await deps.submitJob(payload);
  } catch (err) {
    /* The payload is persisted either way: the photos exist only in memory here
       and a job row may already exist (submitJob's jobId). A permanent failure
       skips auto-retry and is flagged for a human (MyJobs.tsx). The video rides
       along; flushQueue splits it off once the job lands. */
    const permanent = deps.isPermanentError(err);
    const outcome = permanent ? 'failed' : 'queued-for-retry';
    if (!video) {
      await deps.enqueueForRetry(payload, { needsAttention: permanent });
      return outcome;
    }
    try {
      await deps.enqueueForRetry({ ...payload, videoBlob: video }, { needsAttention: permanent });
      return outcome;
    } catch {
      // No room for the clip (up to 75MB): keep the car, which matters more.
      await deps.enqueueForRetry({ ...payload, videoBlob: null }, { needsAttention: permanent });
      return permanent ? 'failed-video-not-saved' : 'queued-video-not-saved';
    }
  }

  if (!video) return 'success';
  try {
    // On disk before the form clears: the clip exists nowhere else.
    await deps.enqueueVideo({ ...payload, jobId, videoBlob: video }, jobId);
    void deps.flushQueue().catch(() => {}); // the clip is on disk either way
    return 'success-video-queued';
  } catch {
    // No room on the phone to keep the clip: send it now, while the form waits.
    try {
      await deps.submitVideo(jobId, video);
      return 'success';
    } catch {
      return 'video-not-saved';
    }
  }
}
