import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { InvalidJobError, isPermanentError, submitJob, type NewJobPayload } from './jobs';
import { HttpError } from './workerApi';

describe('isPermanentError', () => {
  it.each([400, 403, 404, 413, 415])('treats %i as permanent', (status) => {
    expect(isPermanentError(new HttpError(status, 'x'))).toBe(true);
  });

  it.each([401, 408, 429, 500, 502, 503])('keeps %i retryable', (status) => {
    expect(isPermanentError(new HttpError(status, 'x'))).toBe(false);
  });

  it('treats an RLS rejection as permanent and anything else as transient', () => {
    expect(isPermanentError({ code: '42501' })).toBe(true);
    expect(isPermanentError(new TypeError('network'))).toBe(false);
  });

  it('treats a check violation and a payload submitJob refuses as permanent', async () => {
    expect(isPermanentError({ code: '23514' })).toBe(true);
    expect(isPermanentError(new InvalidJobError('x'))).toBe(true);
    expect(isPermanentError(new Error('Job creation failed'))).toBe(false);
    const noService = { plate: '1234567', vin: null, serviceIds: [] } as unknown as NewJobPayload;
    const err = await submitJob(noService).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidJobError);
    expect(isPermanentError(err)).toBe(true);
  });
});
