import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS } from './video';

/* No WebCodecs under node: mediabunny is replaced wholesale, and each test sets
   what the "file" looks like through `mb`. */
const mb = vi.hoisted(() => ({
  metaDuration: 30 as number | null,
  metaThrows: false,
  computedDuration: 30,
  track: { type: 'video', displayWidth: 3840, displayHeight: 2160 } as Record<string, unknown> | null,
  fps: 60,
  canEncode: true,
  isValid: true,
  discarded: [] as { track: { type: string }; reason: string }[],
  outputBytes: 1000,
  executeImpl: null as null | (() => Promise<void>),
  init: vi.fn(),
  execute: vi.fn(),
  cancel: vi.fn(),
  computeDuration: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('mediabunny', () => {
  class ConversionCanceledError extends Error {}
  class UnsupportedInputFormatError extends Error {}
  class BufferTarget {
    buffer: ArrayBuffer | null = null;
  }
  return {
    MP4: {},
    QTFF: {},
    WEBM: {},
    MATROSKA: {},
    ConversionCanceledError,
    UnsupportedInputFormatError,
    BufferTarget,
    BlobSource: class {},
    Mp4OutputFormat: class {},
    Output: class {
      target: BufferTarget;
      constructor(o: { target: BufferTarget }) {
        this.target = o.target;
      }
    },
    Quality: class {
      options: unknown;
      constructor(options: unknown) {
        this.options = options;
      }
    },
    canEncodeVideo: async () => mb.canEncode,
    Input: class {
      getDurationFromMetadata = async () => {
        if (mb.metaThrows) throw new UnsupportedInputFormatError();
        return mb.metaDuration;
      };
      computeDuration = mb.computeDuration.mockImplementation(async () => mb.computedDuration);
      getPrimaryVideoTrack = async () =>
        mb.track && { ...mb.track, computePacketStats: async () => ({ averagePacketRate: mb.fps }) };
      dispose = mb.dispose;
    },
    Conversion: {
      init: mb.init.mockImplementation(async (opts: { output: { target: BufferTarget } }) => ({
        isValid: mb.isValid,
        discardedTracks: mb.discarded,
        onProgress: undefined,
        cancel: mb.cancel,
        execute: mb.execute.mockImplementation(async () => {
          if (mb.executeImpl) return mb.executeImpl();
          opts.output.target.buffer = new ArrayBuffer(mb.outputBytes);
        }),
      })),
    },
  };
});

const { compressVideo } = await import('./videoCompress');
const { ConversionCanceledError } = await import('mediabunny');

const file = new Blob(['x'], { type: 'video/quicktime' });

beforeEach(() => {
  Object.assign(mb, {
    metaDuration: 30,
    metaThrows: false,
    computedDuration: 30,
    track: { type: 'video', displayWidth: 3840, displayHeight: 2160 },
    fps: 60,
    canEncode: true,
    isValid: true,
    discarded: [],
    outputBytes: 1000,
    executeImpl: null,
  });
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('compressVideo', () => {
  it('refuses a clip over 2 minutes before encoding anything', async () => {
    mb.metaDuration = 150;
    expect(await compressVideo(file)).toEqual({ ok: false, problem: 'tooLong' });
    expect(mb.init).not.toHaveBeenCalled();
    expect(mb.dispose).toHaveBeenCalled();
  });

  it('measures the duration when the container does not state it', async () => {
    mb.metaDuration = null;
    mb.computedDuration = 150;
    expect(await compressVideo(file)).toEqual({ ok: false, problem: 'tooLong' });
    expect(mb.computeDuration).toHaveBeenCalled();
  });

  it('reports an undecodable source as unsupported without executing', async () => {
    mb.isValid = false;
    mb.discarded = [{ track: { type: 'video' }, reason: 'undecodable_source_codec' }];
    expect(await compressVideo(file)).toEqual({ ok: false, problem: 'unsupported' });
    expect(mb.execute).not.toHaveBeenCalled();
  });

  it('reports a phone that cannot encode H.264 as unsupported', async () => {
    mb.canEncode = false;
    expect(await compressVideo(file)).toEqual({ ok: false, problem: 'unsupported' });
    expect(mb.init).not.toHaveBeenCalled();
  });

  it('reports a file with no video track as unreadable', async () => {
    mb.track = null;
    expect(await compressVideo(file)).toEqual({ ok: false, problem: 'unreadable' });
  });

  it('reports a file mediabunny cannot parse as unreadable', async () => {
    mb.metaThrows = true;
    expect(await compressVideo(file)).toEqual({ ok: false, problem: 'unreadable' });
    expect(mb.init).not.toHaveBeenCalled();
    expect(mb.dispose).toHaveBeenCalled();
  });

  it.each([0, -1, NaN, Infinity])('reports a stated duration of %s as unreadable', async (d) => {
    mb.metaDuration = d;
    expect(await compressVideo(file)).toEqual({ ok: false, problem: 'unreadable' });
    expect(mb.init).not.toHaveBeenCalled();
  });

  it('caps the encode length even if the header understates it', async () => {
    mb.metaDuration = 10;
    await compressVideo(file);
    expect(mb.init.mock.calls[0][0].trim).toEqual({ end: MAX_VIDEO_SECONDS + 1 });
  });

  it('turns an unexpected throw into a plain failure', async () => {
    mb.executeImpl = async () => {
      throw new Error('encoder crashed');
    };
    expect(await compressVideo(file)).toEqual({ ok: false, problem: 'failed' });
    expect(mb.dispose).toHaveBeenCalled();
  });

  it('treats a canceled conversion as canceled, not as an error', async () => {
    mb.executeImpl = async () => {
      throw new ConversionCanceledError();
    };
    expect(await compressVideo(file)).toEqual({ ok: false, problem: 'canceled' });
  });

  it('wires the abort signal to conversion.cancel', async () => {
    const controller = new AbortController();
    mb.executeImpl = async () => {
      controller.abort();
      throw new ConversionCanceledError();
    };
    expect(await compressVideo(file, { signal: controller.signal })).toEqual({ ok: false, problem: 'canceled' });
    expect(mb.cancel).toHaveBeenCalled();
  });

  it('does no work for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await compressVideo(file, { signal: controller.signal })).toEqual({ ok: false, problem: 'canceled' });
    expect(mb.init).not.toHaveBeenCalled();
    expect(mb.execute).not.toHaveBeenCalled();
  });

  it('refuses an output the Worker would reject', async () => {
    mb.outputBytes = MAX_VIDEO_BYTES + 1;
    expect(await compressVideo(file)).toEqual({ ok: false, problem: 'tooLarge' });
  });

  it('produces an H.264 MP4 at 1080p, 30fps, without audio or tags', async () => {
    const result = await compressVideo(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blob.type).toBe('video/mp4');
    expect(result.blob.size).toBe(1000);

    const opts = mb.init.mock.calls[0][0];
    expect(opts.audio).toEqual({ discard: true });
    expect(opts.tags).toEqual({});
    expect(opts.video).toMatchObject({ codec: 'avc', forceTranscode: true, width: 1920, height: 1080, frameRate: 30 });
    expect(opts.video.width % 2).toBe(0);
    expect(opts.video.height % 2).toBe(0);
    expect(opts.video.quality.options).toEqual({ bitrate: 4_000_000 });
  });
});

describe('compressVideo edges', () => {
  it('accepts an output of exactly the upload cap', async () => {
    mb.outputBytes = MAX_VIDEO_BYTES;
    const result = await compressVideo(file);
    expect(result.ok).toBe(true);
  });

  it('refuses a conversion that would silently drop the video track', async () => {
    mb.isValid = true; // only audio left would still be "valid" to mediabunny
    mb.discarded = [{ track: { type: 'video' }, reason: 'no_encodable_target_codec' }];
    expect(await compressVideo(file)).toEqual({ ok: false, problem: 'unsupported' });
    expect(mb.execute).not.toHaveBeenCalled();
  });

  it('does not fail over a discarded audio track', async () => {
    mb.discarded = [{ track: { type: 'audio' }, reason: 'discarded_by_user' }];
    expect((await compressVideo(file)).ok).toBe(true);
  });

  it('reports canceled when Cancel lands just as encoding finishes', async () => {
    const controller = new AbortController();
    mb.executeImpl = async () => {
      mb.init.mock.calls[0][0].output.target.buffer = new ArrayBuffer(10);
      controller.abort();
    };
    expect(await compressVideo(file, { signal: controller.signal })).toEqual({ ok: false, problem: 'canceled' });
  });

  it('forwards encoder progress to the caller', async () => {
    const onProgress = vi.fn();
    mb.executeImpl = async () => {
      const conversion = await mb.init.mock.results[0].value;
      conversion.onProgress?.(0.5);
      mb.init.mock.calls[0][0].output.target.buffer = new ArrayBuffer(10);
    };
    expect((await compressVideo(file, { onProgress })).ok).toBe(true);
    expect(onProgress).toHaveBeenCalledWith(0.5);
  });

  it('keeps the source frame rate for a 30fps clip', async () => {
    mb.fps = 30;
    await compressVideo(file);
    expect(mb.init.mock.calls[0][0].video.frameRate).toBeUndefined();
  });
});
