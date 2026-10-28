import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewJobPayload } from './jobs';

/*
 * What NewJob does after Submit. The invariants: the worker is always told
 * something (never an escaped rejection, which would leave the form filled and
 * invite a second Submit), and every retry carries the job id once the row
 * exists, so the car is never inserted twice.
 */

vi.mock('./supabase', () => ({ supabase: {} }));

const { sendJob } = await import('./sendJob');
type Deps = NonNullable<Parameters<typeof sendJob>[2]>;

const quota = () => new DOMException('Quota exceeded', 'QuotaExceededError');
const video = new Blob(['video']);
let deps: { [K in keyof Deps]: ReturnType<typeof vi.fn> };

function payload(): NewJobPayload {
  return {
    siteId: 's',
    workerId: 'w1',
    plate: '1234567',
    vin: null,
    brand: null,
    workerNote: null,
    serviceId: 'svc',
    plateBlob: new Blob(['p']),
    vinBlob: null,
  };
}

/* submitJob records the id on the payload as soon as the row exists, then an upload fails. */
const rowThenFail = (err: unknown) => async (p: NewJobPayload) => {
  p.jobId = 'job-1';
  throw err;
};

const send = (p: NewJobPayload, v: Blob | null) => sendJob(p, v, deps as unknown as Deps);

beforeEach(() => {
  deps = {
    submitJob: vi.fn(async () => 'job-1'),
    submitVideo: vi.fn(async () => {}),
    enqueueVideo: vi.fn(async () => {}),
    enqueueForRetry: vi.fn(async () => {}),
    flushQueue: vi.fn(async () => {}),
    isPermanentError: vi.fn(() => false),
  };
});

describe('sendJob: the job lands', () => {
  it('without a video: success, nothing queued', async () => {
    expect(await send(payload(), null)).toBe('success');
    expect(deps.enqueueVideo).not.toHaveBeenCalled();
    expect(deps.enqueueForRetry).not.toHaveBeenCalled();
  });

  it('with a video: queues it for its job and starts the queue', async () => {
    expect(await send(payload(), video)).toBe('success-video-queued');
    expect(deps.enqueueVideo).toHaveBeenCalledWith(expect.objectContaining({ videoBlob: video, jobId: 'job-1' }), 'job-1');
    expect(deps.flushQueue).toHaveBeenCalled();
    expect(deps.submitVideo).not.toHaveBeenCalled();
  });

  /* AC-1: Submit must not wait on the upload itself, only on the clip being on disk. */
  it('with a video: returns while the queue is still uploading', async () => {
    deps.flushQueue.mockImplementation(() => new Promise<void>(() => {}));
    expect(await send(payload(), video)).toBe('success-video-queued');
  });

  it('no room to queue the video: sends it inline', async () => {
    deps.enqueueVideo.mockRejectedValue(quota());
    expect(await send(payload(), video)).toBe('success');
    expect(deps.submitVideo).toHaveBeenCalledWith('job-1', video);
  });

  it('no room and the inline send fails: video-not-saved, never a second job', async () => {
    deps.enqueueVideo.mockRejectedValue(quota());
    deps.submitVideo.mockRejectedValue(new TypeError('network'));
    expect(await send(payload(), video)).toBe('video-not-saved');
    expect(deps.submitJob).toHaveBeenCalledTimes(1);
    expect(deps.enqueueForRetry).not.toHaveBeenCalled();
  });
});

describe('sendJob: the job does not land', () => {
  it('transient: queued for retry with the video and the job id', async () => {
    deps.submitJob.mockImplementation(rowThenFail(new TypeError('network')));
    expect(await send(payload(), video)).toBe('queued-for-retry');
    expect(deps.enqueueForRetry).toHaveBeenCalledTimes(1);
    expect(deps.enqueueForRetry).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1', videoBlob: video }),
      { needsAttention: false },
    );
  });

  it('transient without a video: queued with the job id', async () => {
    deps.submitJob.mockImplementation(rowThenFail(new TypeError('network')));
    expect(await send(payload(), null)).toBe('queued-for-retry');
    expect(deps.enqueueForRetry).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1' }), {
      needsAttention: false,
    });
  });

  it('permanent: queued flagged for a human', async () => {
    deps.submitJob.mockRejectedValue(new Error('denied'));
    deps.isPermanentError.mockReturnValue(true);
    expect(await send(payload(), null)).toBe('failed');
    expect(deps.enqueueForRetry).toHaveBeenCalledWith(expect.anything(), { needsAttention: true });
  });

  /* 75MB attached and the phone is full: the rejection must not escape (no reset, a second Submit duplicates the job). */
  it('no room for the video: keeps the job without it, same job id', async () => {
    deps.submitJob.mockImplementation(rowThenFail(new TypeError('network')));
    deps.enqueueForRetry.mockRejectedValueOnce(quota());
    expect(await send(payload(), video)).toBe('queued-video-not-saved');
    expect(deps.enqueueForRetry).toHaveBeenCalledTimes(2);
    const [[withVideo], [without]] = deps.enqueueForRetry.mock.calls as [NewJobPayload, unknown][];
    expect(withVideo).toMatchObject({ jobId: 'job-1', videoBlob: video });
    expect(without).toMatchObject({ jobId: 'job-1' });
    expect(without.videoBlob).toBeNull();
  });

  it('permanent and no room for the video: flagged job without it, and says so', async () => {
    deps.submitJob.mockImplementation(rowThenFail(new Error('denied')));
    deps.isPermanentError.mockReturnValue(true);
    deps.enqueueForRetry.mockRejectedValueOnce(quota());
    expect(await send(payload(), video)).toBe('failed-video-not-saved');
    expect(deps.enqueueForRetry).toHaveBeenLastCalledWith(
      expect.objectContaining({ jobId: 'job-1', videoBlob: null }),
      { needsAttention: true },
    );
  });

  it('no room even for the job: rejects, as before deferred video', async () => {
    deps.submitJob.mockRejectedValue(new TypeError('network'));
    deps.enqueueForRetry.mockRejectedValue(quota());
    await expect(send(payload(), video)).rejects.toThrow();
  });
});
