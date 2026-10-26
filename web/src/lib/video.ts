/**
 * Condition video, recorded in-app via MediaRecorder with a capped bitrate, or
 * picked from the gallery and re-encoded on the phone (videoCompress.ts) to the
 * same target: the phone's own app writes 60-170MB a minute, while this keeps a
 * two-minute clip near 60MB (R2 is ~$0.015/GB-month, so storage is not the
 * limit; yard upload signal is).
 */

/** Hard stop. The recorder ends the clip itself at this length. */
export const MAX_VIDEO_SECONDS = 120;

/** Requested bitrate: 1080p at 4 Mbps (~60MB for 2 min) keeps scratches and panel gaps readable. Safari may treat it as a suggestion; tune per phone model here. */
export const VIDEO_BITRATE = 4_000_000;

/** Must match MAX_VIDEO_BYTES in worker/src/upload.ts. Refusing on the phone keeps a certain 413 out of the retry queue. */
export const MAX_VIDEO_BYTES = 75 * 1024 * 1024;

/** Why a video couldn't be attached; each has a newJob.video_* message. */
export type VideoProblem = 'unsupported' | 'denied' | 'tooLarge' | 'tooLong' | 'unreadable' | 'failed';

/** Gallery clips over the limit are refused before any encoding. Whole seconds, so a 120.4s clip still counts as 2:00. */
export function isTooLong(seconds: number): boolean {
  return Math.floor(seconds) > MAX_VIDEO_SECONDS;
}

/** Shorter side capped at 1080 (never upscaled), aspect kept, both sides even (H.264 needs it). */
export function targetSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, 1080 / Math.min(width, height));
  const even = (n: number) => Math.max(2, 2 * Math.floor((n * scale) / 2 + 1e-9));
  return { width: even(width), height: even(height) };
}

/** 60fps phone clips are halved to 30: same bitrate, sharper frames. Undefined keeps the source rate. */
export function targetFrameRate(fps: number | null): number | undefined {
  return fps !== null && fps > 31 ? 30 : undefined;
}

/** Maps mediabunny's discard reasons: a codec the phone can't handle is "unsupported", anything else a plain failure. */
export function discardProblem(reasons: string[]): 'unsupported' | 'failed' {
  const codec = ['undecodable_source_codec', 'no_encodable_target_codec', 'unknown_source_codec'];
  return reasons.some((r) => codec.includes(r)) ? 'unsupported' : 'failed';
}

/** MP4 first (plays everywhere); WebM is the fallback for Androids whose Chrome can only record that. */
const PREFERRED_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

/** The recording format to ask for, '' to let the browser choose, or null if it can't record. */
export function pickVideoMimeType(isSupported: ((type: string) => boolean) | undefined): string | null {
  if (!isSupported) return null;
  return PREFERRED_TYPES.find((t) => isSupported(t)) ?? '';
}

/**
 * onLoadedMetadata handler for every <video> showing a recording. Chrome writes
 * WebM without a duration; seeking far past the end makes the browser scan for
 * it, and the first timeupdate resets to 0. A no-op for MP4.
 */
export function seekableDuration(e: { currentTarget: HTMLVideoElement }): void {
  const v = e.currentTarget;
  if (v.duration !== Infinity) return;
  v.addEventListener('timeupdate', () => (v.currentTime = 0), { once: true });
  v.currentTime = Number.MAX_SAFE_INTEGER;
}

/** Extension for a download, from the recorded or served type. */
export function videoExtension(type: string): string {
  if (type.startsWith('video/webm')) return 'webm';
  if (type.startsWith('video/quicktime')) return 'mov';
  return 'mp4';
}
