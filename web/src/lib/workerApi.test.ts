import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * The photo viewer tells a manager what to do about a missing image, and it can
 * only be as right as this mapping. Getting it wrong is not cosmetic: the state
 * this replaces blamed the 60-day expiry for everything, which sent someone
 * hunting for a deleted file when the photo had never been uploaded — the exact
 * confusion this suite exists to prevent recurring.
 */

let session: { access_token: string } | null = { access_token: 'jwt' };

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session } }) } },
}));

/*
 * The image helpers all need canvas/createImageBitmap, which the node test
 * environment has none of. Stubbed to identity so the OCR flow below can be
 * driven by the Worker's responses alone — the transforms themselves are not
 * what this suite is about.
 */
const image = vi.hoisted(() => ({
  MAX_UPLOAD_BYTES: 8 * 1024 * 1024,
  downscaleImage: vi.fn(async (blob: Blob) => blob),
  blobToBase64: vi.fn(async () => 'base64'),
  enhanceForOcr: vi.fn(async (blob: Blob) => blob),
  // A distinct Blob on purpose: the crop must not be identical to the original,
  // or the full-frame fallback would be re-reading the very same pixels.
  cropToBox: vi.fn(async () => new Blob(['crop'])),
  imageSize: vi.fn(async () => ({ width: 1024, height: 768 })),
  normalizeBox: vi.fn((box: unknown) => box),
}));
vi.mock('./image', () => image);

const { fetchPhotoUrl, ocrPhoto, completeVideoUpload, uploadPhoto, HttpError, PIECE_TIMEOUT_MS } = await import('./workerApi');

afterEach(() => {
  session = { access_token: 'jwt' };
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function respondWith(status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        blob: () => Promise.resolve(new Blob(['x'])),
      }),
    ),
  );
}

describe('fetchPhotoUrl', () => {
  it('returns an object url when the Worker serves the photo', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:photo' });
    respondWith(200);
    await expect(fetchPhotoUrl('job-1', 'plate')).resolves.toEqual({ url: 'blob:photo', type: '' });
  });

  it('reports 404 as missing, not as a connection problem', async () => {
    respondWith(404);
    await expect(fetchPhotoUrl('job-1', 'plate')).resolves.toEqual({ failure: 'missing' });
  });

  it.each([401, 403])('reports %i as denied so the copy can say "sign in again"', async (status) => {
    respondWith(status);
    await expect(fetchPhotoUrl('job-1', 'vin')).resolves.toEqual({ failure: 'denied' });
  });

  it('reports a Worker fault as failed, which is the only retryable one', async () => {
    respondWith(500);
    await expect(fetchPhotoUrl('job-1', 'plate')).resolves.toEqual({ failure: 'failed' });
  });

  it('reports a network error as failed', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    await expect(fetchPhotoUrl('job-1', 'plate')).resolves.toEqual({ failure: 'failed' });
  });

  /*
   * Regression: no session used to fall through the same catch as a network
   * error, so a lapsed login was reported as "check your connection".
   */
  it('reports a missing session as denied, not as a network error', async () => {
    session = null;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(fetchPhotoUrl('job-1', 'plate')).resolves.toEqual({ failure: 'denied' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ OCR read */

/*
 * A read that never reaches the model is the failure this suite exists for.
 * The plate is photographed filling the frame, so detection has nothing useful
 * to crop to and the multi-megabyte camera original is what gets posted — which
 * the Worker answers 413. That used to come back as no text AND no reason, and
 * the capture tile draws exactly that as a plain green success: a tick over an
 * empty plate field, with nothing prompting the worker to type it in. The VIN
 * never showed it, because a VIN sticker IS croppable and its read went out at
 * ~1024px.
 */

const photo = new Blob(['photo']);
/** Only `size` is read once the image helpers are stubbed. */
const hugePhoto = { size: 6 * 1024 * 1024 } as Blob;

/** Answers /ocr by task: a detect box, then the read outcome(s) in order. */
function ocrServer(options: { box?: unknown; reads: ({ status: number } | unknown)[] }) {
  const reads = [...options.reads];
  const fetchSpy = vi.fn((_url: string, init: { body: string }) => {
    const { task } = JSON.parse(init.body) as { task: string };
    const body = task === 'detect' ? { box: options.box ?? null } : (reads.shift() ?? {});
    const status = (body as { status?: number }).status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

describe('ocrPhoto', () => {
  it('returns a successfully read plate, so the field can be filled', async () => {
    ocrServer({ reads: [{ text: '81707504', reason: null }] });
    await expect(ocrPhoto(photo, 'plate')).resolves.toEqual({ text: '81707504', reason: null });
  });

  it('returns a successfully read VIN', async () => {
    ocrServer({ reads: [{ text: 'WBA3A5C55DF123456', reason: null }] });
    await expect(ocrPhoto(photo, 'vin')).resolves.toEqual({ text: 'WBA3A5C55DF123456', reason: null });
  });

  it('reads plate and VIN independently, so one photo never costs the other', async () => {
    ocrServer({ reads: [{ text: '81707504', reason: null }, { text: 'WBA3A5C55DF123456', reason: null }] });
    const [plate, vin] = await Promise.all([ocrPhoto(photo, 'plate'), ocrPhoto(photo, 'vin')]);
    expect(plate.text).toBe('81707504');
    expect(vin.text).toBe('WBA3A5C55DF123456');
  });

  it('passes an unreadable photo through as a reason, which is what prompts "type it in"', async () => {
    // Both reads decline: the enhanced retry is stubbed to the same blob, so
    // only one goes out — either way the reason must survive.
    ocrServer({ reads: [{ text: null, reason: 'not_in_frame' }, { text: null, reason: 'not_in_frame' }] });
    await expect(ocrPhoto(photo, 'plate')).resolves.toEqual({ text: null, reason: 'not_in_frame' });
  });

  it('survives a response carrying neither value', async () => {
    ocrServer({ reads: [{}, {}] });
    await expect(ocrPhoto(photo, 'plate')).resolves.toEqual({ text: undefined, reason: undefined });
  });

  /* Regression: the bug itself. */
  it('reports a rejected read as unreadable instead of a silent empty success', async () => {
    ocrServer({ reads: [{ status: 413, error: 'Image too large' }] });
    await expect(ocrPhoto(photo, 'plate')).resolves.toEqual({ text: null, reason: 'not_in_frame' });
  });

  it('reports a dropped connection the same way', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    await expect(ocrPhoto(photo, 'plate')).resolves.toEqual({ text: null, reason: 'not_in_frame' });
  });

  /* Regression: the cause of the 413. */
  it('shrinks an original the Worker would refuse, rather than posting it', async () => {
    ocrServer({ reads: [{ text: '81707504', reason: null }] });
    await expect(ocrPhoto(hugePhoto, 'plate')).resolves.toEqual({ text: '81707504', reason: null });
    // 1024px for detection, then the read copy the Worker will actually accept.
    expect(image.downscaleImage).toHaveBeenCalledWith(hugePhoto, 1024, 0.9);
    expect(image.downscaleImage).toHaveBeenCalledWith(hugePhoto, 2560, 0.85);
  });

  it('leaves an image already within the limit untouched', async () => {
    ocrServer({ reads: [{ text: '81707504', reason: null }] });
    await ocrPhoto(photo, 'plate');
    expect(image.downscaleImage).toHaveBeenCalledTimes(1); // detection only
  });

  /*
   * Production: a crop that loses a digit loses it twice, because the enhance
   * retry is a levels stretch of the SAME crop. 344-48-104 came back as
   * "34-48-104" and the worker was sent to type it in, while the uncropped
   * frame — already on the phone, already paid for — reads on its own strengths.
   */
  it('falls back to the uncropped frame when the crop cannot be read', async () => {
    ocrServer({
      box: { x0: 0.4, y0: 0.5, x1: 0.7, y1: 0.6 },
      reads: [{ text: null, reason: 'not_in_frame' }, { text: '34448104', reason: null }],
    });
    await expect(ocrPhoto(photo, 'plate')).resolves.toEqual({ text: '34448104', reason: null });
  });

  it('does not re-read the same pixels when no crop was taken', async () => {
    // No box, so target IS the original: a third read would be the same image.
    const fetchSpy = ocrServer({ reads: [{ text: null, reason: 'not_in_frame' }] });
    await expect(ocrPhoto(photo, 'plate')).resolves.toEqual({ text: null, reason: 'not_in_frame' });
    const reads = fetchSpy.mock.calls.filter((c) => JSON.parse(c[1].body).task === 'query');
    expect(reads).toHaveLength(1);
  });

  it('keeps the first outcome when every rung fails', async () => {
    ocrServer({
      box: { x0: 0.4, y0: 0.5, x1: 0.7, y1: 0.6 },
      reads: [{ text: null, reason: 'not_in_frame' }, { text: null, reason: 'not_in_frame' }],
    });
    await expect(ocrPhoto(photo, 'plate')).resolves.toEqual({ text: null, reason: 'not_in_frame' });
  });

  it('still reads from the crop when detection finds one', async () => {
    ocrServer({ box: { x0: 0.4, y0: 0.5, x1: 0.7, y1: 0.6 }, reads: [{ text: '81707504', reason: null }] });
    await expect(ocrPhoto(photo, 'plate')).resolves.toEqual({ text: '81707504', reason: null });
    expect(image.cropToBox).toHaveBeenCalled();
  });
});


/* ---------------------------------------------------------- video complete */

/*
 * A locked screen can leave /video/complete hanging forever, and with it the
 * queue's whole flush. Complete is idempotent on the Worker (head() check), so
 * aborting and retrying it is safe.
 */
describe('completeVideoUpload', () => {
  const parts = [{ partNumber: 1, etag: 'e1' }];

  afterEach(() => vi.useRealTimers());

  it('aborts a hanging request after the timeout, as a transient (non-HTTP) failure', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );
    const run = completeVideoUpload('job-1', 'up-1', parts);
    const settled = run.then(
      () => 'resolved',
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(PIECE_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1); // still waiting
    await vi.advanceTimersByTimeAsync(1);
    const err = await settled;
    expect(err).toBeInstanceOf(DOMException);
    expect(err).not.toBeInstanceOf(HttpError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer on success', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ key: 'video/job-1' }) })));
    await expect(completeVideoUpload('job-1', 'up-1', parts)).resolves.toEqual({ key: 'video/job-1' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer on an HTTP failure', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 410, json: async () => ({}) })));
    await expect(completeVideoUpload('job-1', 'up-1', parts)).rejects.toMatchObject({ status: 410 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer on a network failure', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    await expect(completeVideoUpload('job-1', 'up-1', parts)).rejects.toBeInstanceOf(TypeError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('encodes the ids it puts in the URL', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200, json: async () => ({ key: 'k' }) }));
    vi.stubGlobal('fetch', fetchSpy);
    await completeVideoUpload('a b&c=d/e', 'u/p=1&x y', parts);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/video/complete?jobId=a%20b%26c%3Dd%2Fe&uploadId=u%2Fp%3D1%26x%20y');
    expect(JSON.parse(init.body as string)).toEqual({ parts });
  });
});

/* A piece a locked screen left hanging must reject as transient, or the run never ends (AC-2/AC-8). */
describe('startVideoUpload / uploadVideoPart timeout', () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ['start', () => import('./workerApi').then((m) => m.startVideoUpload('job-1', new Blob(['x'])))],
    ['part', () => import('./workerApi').then((m) => m.uploadVideoPart('job-1', 'up-1', 2, new Blob(['x'])))],
  ])('%s aborts a hanging request after PIECE_TIMEOUT_MS as a non-HTTP failure', async (_name, send) => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );
    const settled = send().then(
      () => 'resolved',
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(PIECE_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    const err = await settled;
    expect(err).toBeInstanceOf(DOMException);
    expect(err).not.toBeInstanceOf(HttpError);
    expect(vi.getTimerCount()).toBe(0);
  });
});

/* Only the video's 404 fallback passes a timeout; photo uploads must stay exactly as they were. */
describe('uploadPhoto timeout', () => {
  afterEach(() => vi.useRealTimers());

  it('a photo upload has no signal and no timer', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200, json: async () => ({ key: 'k' }) }));
    vi.stubGlobal('fetch', fetchSpy);
    const run = uploadPhoto('job-1', 'plate', new Blob(['x']));
    expect(vi.getTimerCount()).toBe(0);
    await run;
    expect(fetchSpy.mock.calls[0][1].signal).toBeUndefined();
  });

  it('with a timeout, a hanging upload rejects as a non-HTTP failure and leaves no timer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );
    const settled = uploadPhoto('job-1', 'video', new Blob(['x']), 5_000).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(5_000);
    const err = await settled;
    expect(err).toBeInstanceOf(DOMException);
    expect(err).not.toBeInstanceOf(HttpError);
    expect(vi.getTimerCount()).toBe(0);
  });
});
