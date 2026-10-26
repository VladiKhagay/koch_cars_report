import {
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  MATROSKA,
  MP4,
  Mp4OutputFormat,
  Output,
  QTFF,
  Quality,
  UnsupportedInputFormatError,
  WEBM,
  canEncodeVideo,
} from 'mediabunny';
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  VIDEO_BITRATE,
  type VideoProblem,
  discardProblem,
  isTooLong,
  targetFrameRate,
  targetSize,
} from './video';

/**
 * Re-encodes a gallery clip on the phone (WebCodecs via mediabunny) to the
 * recorder's target: H.264 MP4, shorter side <= 1080, VIDEO_BITRATE, no audio,
 * no metadata tags (drops GPS). Alpha WebM/MKV is unsupported: its decoder needs
 * a blob: worker that our CSP blocks, so it ends as 'failed'. The only module that imports mediabunny, and
 * loaded lazily (~430 kB chunk, precached by the service worker), so it never weighs on first paint.
 */
export type CompressResult = { ok: true; blob: Blob } | { ok: false; problem: VideoProblem | 'canceled' };

export async function compressVideo(
  file: Blob,
  { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<CompressResult> {
  const input = new Input({ formats: [MP4, QTFF, WEBM, MATROSKA], source: new BlobSource(file) });
  const canceled = { ok: false, problem: 'canceled' } as const;
  try {
    if (signal?.aborted) return canceled;
    const duration = (await input.getDurationFromMetadata()) ?? (await input.computeDuration());
    if (signal?.aborted) return canceled;
    if (!Number.isFinite(duration) || duration <= 0) return { ok: false, problem: 'unreadable' };
    if (isTooLong(duration)) return { ok: false, problem: 'tooLong' };

    const track = await input.getPrimaryVideoTrack();
    if (!track) return { ok: false, problem: 'unreadable' };
    const { width, height } = targetSize(track.displayWidth, track.displayHeight);
    // A short prefix of packets is enough to tell 60fps from 30; a failure just keeps the source rate.
    const fps = await track
      .computePacketStats(100)
      .then((s) => s.averagePacketRate)
      .catch(() => null);
    const frameRate = targetFrameRate(fps);
    if (signal?.aborted) return canceled;

    const quality = new Quality({ bitrate: VIDEO_BITRATE });
    if (!(await canEncodeVideo('avc', { width, height, quality }))) return { ok: false, problem: 'unsupported' };
    if (signal?.aborted) return canceled;

    const target = new BufferTarget();
    const conversion = await Conversion.init({
      input,
      output: new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target }),
      video: { codec: 'avc', width, height, fit: 'fill', frameRate, quality, forceTranscode: true },
      audio: { discard: true },
      // A header that understates the length must not buy an unbounded encode; the cap is enforced again here.
      trim: { end: MAX_VIDEO_SECONDS + 1 },
      tags: {},
      showWarnings: false,
    });
    const videoDropped = conversion.discardedTracks.find((d) => d.track.type === 'video');
    if (!conversion.isValid || videoDropped) {
      return { ok: false, problem: discardProblem(conversion.discardedTracks.map((d) => d.reason)) };
    }
    if (signal?.aborted) return canceled;

    const cancel = () => void conversion.cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    if (onProgress) conversion.onProgress = (p) => onProgress(p);
    try {
      await conversion.execute();
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    if (signal?.aborted) return canceled;

    const blob = new Blob([target.buffer!], { type: 'video/mp4' });
    if (blob.size > MAX_VIDEO_BYTES) return { ok: false, problem: 'tooLarge' };
    return { ok: true, blob };
  } catch (err) {
    if (err instanceof ConversionCanceledError) return canceled;
    if (err instanceof UnsupportedInputFormatError) return { ok: false, problem: 'unreadable' };
    console.warn('video compression failed', err);
    return { ok: false, problem: 'failed' };
  } finally {
    input.dispose();
  }
}
