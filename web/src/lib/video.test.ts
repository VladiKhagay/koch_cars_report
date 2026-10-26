import { describe, expect, it } from 'vitest';
import { pickVideoMimeType, videoExtension } from './video';

describe('pickVideoMimeType', () => {
  it('prefers MP4 when the browser can record it', () => {
    expect(pickVideoMimeType(() => true)).toBe('video/mp4;codecs=avc1');
  });

  it('falls back to WebM on a WebM-only Chrome', () => {
    expect(pickVideoMimeType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9');
  });

  it('lets the browser choose when it lists none of ours', () => {
    expect(pickVideoMimeType(() => false)).toBe('');
  });

  it('reports no recorder at all', () => {
    expect(pickVideoMimeType(undefined)).toBeNull();
  });
});

describe('videoExtension', () => {
  it('names downloads after the real format', () => {
    expect(videoExtension('video/mp4;codecs=avc1')).toBe('mp4');
    expect(videoExtension('video/webm;codecs=vp9')).toBe('webm');
    expect(videoExtension('video/quicktime')).toBe('mov');
  });
});
