import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import ru from '../locales/ru.json';
import he from '../locales/he.json';
import type { VideoProblem } from './video';

/* VideoRecorder renders t(`newJob.video_${problem}`): a dynamic key no type
   check or grep catches, so a missing one would show the raw key to a worker. */
const problems: Record<VideoProblem | 'pickUnsupported', true> = {
  unsupported: true,
  denied: true,
  tooLarge: true,
  tooLong: true,
  unreadable: true,
  failed: true,
  pickUnsupported: true,
};
const uiKeys = ['videoReady', 'chooseVideo', 'chooseAnother', 'compressingVideo', 'compressKeepOpen', 'cancelCompress', 'videoCompressing'];

describe.each([
  ['en', en],
  ['ru', ru],
  ['he', he],
])('%s video strings', (_, locale) => {
  const newJob = locale.newJob as unknown as Record<string, unknown>;

  it('has a message for every video problem', () => {
    for (const p of Object.keys(problems)) expect(newJob[`video_${p}`], p).toBeTruthy();
  });

  it('has every gallery/compression label, with the progress placeholder', () => {
    for (const k of uiKeys) expect(newJob[k], k).toBeTruthy();
    expect(newJob.compressingVideo).toContain('{{percent}}');
  });

  it('no longer carries the removed videoRecorded key', () => {
    expect(newJob.videoRecorded).toBeUndefined();
  });
});
