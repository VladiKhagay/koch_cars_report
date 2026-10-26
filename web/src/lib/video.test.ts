import { describe, expect, it } from 'vitest';
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  VIDEO_BITRATE,
  discardProblem,
  isTooLong,
  pickVideoMimeType,
  targetFrameRate,
  targetSize,
  videoExtension,
} from './video';

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

describe('targetSize', () => {
  it('brings 4K down to 1080p either way up', () => {
    expect(targetSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(targetSize(2160, 3840)).toEqual({ width: 1080, height: 1920 });
  });

  it('leaves 1080p and smaller alone, never upscaling', () => {
    expect(targetSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(targetSize(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it('keeps both sides even for H.264', () => {
    expect(targetSize(641, 481)).toEqual({ width: 640, height: 480 });
    const { width, height } = targetSize(1081, 1921);
    expect(width % 2).toBe(0);
    expect(height % 2).toBe(0);
    expect(Math.min(width, height)).toBeLessThanOrEqual(1080);
  });
});

describe('isTooLong', () => {
  it('counts whole seconds against the 2-minute limit', () => {
    expect(isTooLong(119)).toBe(false);
    expect(isTooLong(120.4)).toBe(false);
    expect(isTooLong(121)).toBe(true);
  });
});

describe('targetFrameRate', () => {
  it('halves 60fps clips and keeps the rest', () => {
    expect(targetFrameRate(60)).toBe(30);
    expect(targetFrameRate(30)).toBeUndefined();
    expect(targetFrameRate(null)).toBeUndefined();
  });
});

describe('discardProblem', () => {
  it('calls codec trouble unsupported and anything else a failure', () => {
    expect(discardProblem(['undecodable_source_codec'])).toBe('unsupported');
    expect(discardProblem(['no_encodable_target_codec'])).toBe('unsupported');
    expect(discardProblem(['unknown_source_codec'])).toBe('unsupported');
    expect(discardProblem(['discarded_by_user', 'max_track_count_reached'])).toBe('failed');
    expect(discardProblem([])).toBe('failed');
  });
});

it('a full-length clip at the target bitrate fits under the upload cap with 25% headroom', () => {
  expect(((VIDEO_BITRATE * MAX_VIDEO_SECONDS) / 8) * 1.25).toBeLessThan(MAX_VIDEO_BYTES);
});

describe('limits at the boundary', () => {
  it('lets exactly 2:00 (and anything under 2:01) through, refuses longer or endless', () => {
    expect(isTooLong(120)).toBe(false);
    expect(isTooLong(120.999)).toBe(false);
    expect(isTooLong(0)).toBe(false);
    expect(isTooLong(Infinity)).toBe(true);
  });

  it('never returns a dimension the encoder would reject', () => {
    for (const [w, h] of [
      [1, 1],
      [3, 3],
      [1079, 1081],
      [1080, 1080],
      [7680, 4320],
      [4320, 7680],
      [1440, 1080],
    ]) {
      const s = targetSize(w, h);
      expect(s.width % 2, `${w}x${h}`).toBe(0);
      expect(s.height % 2, `${w}x${h}`).toBe(0);
      expect(s.width).toBeGreaterThanOrEqual(2);
      expect(s.height).toBeGreaterThanOrEqual(2);
      expect(Math.min(s.width, s.height)).toBeLessThanOrEqual(1080);
    }
    expect(targetSize(7680, 4320)).toEqual({ width: 1920, height: 1080 });
  });

  it('treats a measured 60fps that reads slightly off as 60, but leaves 30-ish alone', () => {
    expect(targetFrameRate(59.94)).toBe(30);
    expect(targetFrameRate(31)).toBeUndefined();
    expect(targetFrameRate(29.97)).toBeUndefined();
  });
});
