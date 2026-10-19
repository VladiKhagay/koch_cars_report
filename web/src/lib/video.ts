/**
 * Condition video, recorded in-app via MediaRecorder with a capped bitrate: the
 * phone's own app writes 60-170MB a minute, while this keeps a one-minute clip
 * near 7.5MB (R2 free tier, bearable over yard signal).
 */

/** Hard stop. The recorder ends the clip itself at this length. */
export const MAX_VIDEO_SECONDS = 60;

/** Requested bitrate: 720p at 1 Mbps shows a scratch at walkaround distance. Safari may treat it as a suggestion; tune per phone model here. */
export const VIDEO_BITRATE = 1_000_000;

/** Must match MAX_VIDEO_BYTES in worker/src/upload.ts. Refusing on the phone keeps a certain 413 out of the retry queue. */
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

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
