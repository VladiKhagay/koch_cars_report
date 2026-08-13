import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * The photo viewer tells a manager what to do about a missing image, and it can
 * only be as right as this mapping. Getting it wrong is not cosmetic: the state
 * this replaces blamed the 90-day expiry for everything, which sent someone
 * hunting for a deleted file when the photo had never been uploaded — the exact
 * confusion this suite exists to prevent recurring.
 */

let session: { access_token: string } | null = { access_token: 'jwt' };

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session } }) } },
}));

const { fetchPhotoUrl } = await import('./workerApi');

afterEach(() => {
  session = { access_token: 'jwt' };
  vi.unstubAllGlobals();
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
    await expect(fetchPhotoUrl('job-1', 'plate')).resolves.toEqual({ url: 'blob:photo' });
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
