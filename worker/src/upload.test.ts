import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES, objectKey, sniffImageType, sniffVideoType } from './upload';

/** Builds a body from leading bytes, padded so length is never what's tested. */
function body(...head: number[]): ArrayBuffer {
  const bytes = new Uint8Array(64);
  bytes.set(head);
  return bytes.buffer;
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

describe('sniffImageType', () => {
  it('accepts the format the app actually sends', () => {
    expect(sniffImageType(body(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
  });

  it('accepts the formats the downscale-failure fallback can send', () => {
    expect(sniffImageType(body(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffImageType(body(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')))).toBe('image/webp');
    expect(sniffImageType(body(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('heic')))).toBe('image/heic');
    expect(sniffImageType(body(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('mif1')))).toBe('image/heic');
  });

  /* The point of the whole function: arbitrary bytes used to be stored under an
     image content type and served back from the Worker's own origin. */
  it('rejects non-images', () => {
    expect(sniffImageType(body(...ascii('<!doctype html><script>')))).toBeNull();
    expect(sniffImageType(body(...ascii('<svg xmlns="http://')))).toBeNull(); // script-bearing
    expect(sniffImageType(body(...ascii('%PDF-1.7')))).toBeNull();
    expect(sniffImageType(body(0x00, 0x61, 0x73, 0x6d))).toBeNull(); // wasm
  });

  it('does not mistake a video for a photo', () => {
    // Same ftyp container as HEIC, non-image brand.
    expect(sniffImageType(body(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('isom')))).toBeNull();
    expect(sniffImageType(body(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('mp42')))).toBeNull();
  });

  it('rejects a body too short to carry a signature', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff]).buffer)).toBeNull();
    expect(sniffImageType(new ArrayBuffer(0))).toBeNull();
  });

  it('does not read past the end of a short RIFF body', () => {
    // 'RIFF' with nothing after it — must not throw on the WEBP subarray.
    expect(() => sniffImageType(new Uint8Array(ascii('RIFF')).buffer)).not.toThrow();
  });
});

describe('MAX_UPLOAD_BYTES', () => {
  it('is 8MB — large enough for a phone photo, small enough to bound a retry loop', () => {
    expect(MAX_UPLOAD_BYTES).toBe(8 * 1024 * 1024);
  });

  it('allows 50MB for video — ~3x the recorder target of a 2-minute clip', () => {
    expect(MAX_VIDEO_BYTES).toBe(75 * 1024 * 1024);
  });
});

describe('sniffVideoType', () => {
  it('accepts what phone recorders write', () => {
    expect(sniffVideoType(body(0, 0, 0, 0x1c, ...ascii('ftyp'), ...ascii('isom')))).toBe('video/mp4');
    expect(sniffVideoType(body(0, 0, 0, 0x1c, ...ascii('ftyp'), ...ascii('mp42')))).toBe('video/mp4');
    expect(sniffVideoType(body(0, 0, 0, 0x14, ...ascii('ftyp'), ...ascii('qt  ')))).toBe('video/quicktime');
    expect(sniffVideoType(body(0x1a, 0x45, 0xdf, 0xa3))).toBe('video/webm');
  });

  /* Each slot takes only its own kind of bytes, so a photo can't stand in for
     the condition video and a video can't land in a photo slot. */
  it('rejects photos, and photos reject video', () => {
    expect(sniffVideoType(body(0xff, 0xd8, 0xff, 0xe0))).toBeNull();
    expect(sniffVideoType(body(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('heic')))).toBeNull();
    expect(sniffImageType(body(0x1a, 0x45, 0xdf, 0xa3))).toBeNull();
  });

  it('rejects documents and short bodies', () => {
    expect(sniffVideoType(body(...ascii('<!doctype html><script>')))).toBeNull();
    expect(sniffVideoType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]).buffer)).toBeNull();
  });
});

describe('objectKey', () => {
  it('puts videos under their own prefix so they can expire separately', () => {
    expect(objectKey('job-1', 'video')).toBe('video/job-1');
    expect(objectKey('job-1', 'plate')).toBe('job-1/plate.jpg');
  });
});
