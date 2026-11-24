import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedJob } from '../lib/offlineQueue';
import en from '../locales/en.json';
import ru from '../locales/ru.json';
import he from '../locales/he.json';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => `t:${key}` }) }));
// ui.tsx pulls in the i18n bootstrap (language switcher); not needed here.
vi.mock('../lib/i18n', () => ({ LANGUAGES: [], setLanguage: () => {} }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../lib/offlineQueue', () => ({ discardQueued: vi.fn(), retryQueued: vi.fn() }));
const queue = vi.hoisted(() => ({ jobs: [] as unknown[] }));
vi.mock('../lib/useQueue', () => ({
  useQueuedJobs: () => queue.jobs,
  useUploadingId: () => null,
  useUploadProgress: () => null,
}));

const { default: QueuedJobs } = await import('./QueuedJobs');
const { SITE_REFUSALS } = await import('../lib/jobs');

const job = (over: Partial<QueuedJob> = {}): QueuedJob => ({
  queuedId: 'q1',
  queuedAt: '2026-11-24T08:00:00Z',
  siteId: 'site-1',
  workerId: 'w1',
  plate: '12-345-67',
  vin: null,
  brand: null,
  workerNote: null,
  serviceIds: ['svc-1'],
  plateBlob: null,
  vinBlob: null,
  extraBlobs: [],
  ...over,
});
const render = () => renderToStaticMarkup(<QueuedJobs />);

beforeEach(() => {
  queue.jobs = [];
});

/*
 * A queued job the site refuses (0042: submitJob's reason code in lastError)
 * is explained in the worker's language instead of the raw error, and is
 * flagged, not retried (no retry button for a job).
 */
describe('QueuedJobs — a job the site refused', () => {
  it.each(SITE_REFUSALS)('says %s in words, not as the raw code', (reason) => {
    queue.jobs = [job({ needsAttention: true, lastError: reason })];
    const html = render();
    expect(html).toContain(`t:myJobs.refused.${reason}`);
    expect(html).not.toContain('t:myJobs.needsAttentionHint');
    expect(html).not.toContain(`>${reason}<`);
    expect(html).not.toContain('t:common.retry');
    expect(html).toContain('t:myJobs.discardJob');
  });

  it('shows any other failure raw, with the generic hint', () => {
    queue.jobs = [job({ needsAttention: true, lastError: 'new row violates row-level security policy' })];
    const html = render();
    expect(html).toContain('t:myJobs.needsAttentionHint');
    expect(html).toContain('new row violates row-level security policy');
    expect(html).not.toContain('t:myJobs.refused.');
  });

  it('does not treat a code embedded in a longer error as a refusal', () => {
    queue.jobs = [job({ needsAttention: true, lastError: '400: site-needs-vin' })];
    const html = render();
    expect(html).toContain('t:myJobs.needsAttentionHint');
    expect(html).toContain('400: site-needs-vin');
  });

  it('identifies a VIN-less car by its plate (0042)', () => {
    queue.jobs = [job({ plate: '12-345-67', vin: null })];
    expect(render()).toContain('12-345-67');
  });

  it('identifies a plate-less car by its VIN', () => {
    queue.jobs = [job({ plate: null, vin: 'WVWZZZ1JZXW000001' })];
    expect(render()).toContain('WVWZZZ1JZXW000001');
  });
});

/* A missing key renders as the raw key path to the worker (i18next falls back silently). */
describe('refusal translations', () => {
  it.each([
    ['en', en],
    ['ru', ru],
    ['he', he],
  ])('%s has a message for every site refusal code', (_name, locale) => {
    const refused = (locale as { myJobs: { refused?: Record<string, string> } }).myJobs.refused ?? {};
    for (const reason of SITE_REFUSALS) expect(refused[reason], reason).toBeTruthy();
  });
});
