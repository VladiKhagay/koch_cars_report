/**
 * Condition video: recorded in-app so the file size is ours to choose.
 *
 * The phone's own camera app records 60–170MB a minute and a browser cannot
 * re-encode that, so MediaRecorder with a capped bitrate is the only way to
 * keep a one-minute walkaround near 7.5MB — which is what keeps R2 on the free
 * tier and the upload bearable over yard signal.
 */

/** Hard stop. The recorder ends the clip itself at this length. */
export const MAX_VIDEO_SECONDS = 60;

/**
 * Requested bitrate. 720p at 1 Mbps is enough to see a scratch on a panel at
 * walkaround distance. Calibration knob: Safari has shipped versions that treat
 * this as a suggestion, so measure real clips per phone model and tune here.
 */
export const VIDEO_BITRATE = 1_000_000;

/**
 * Must match MAX_VIDEO_BYTES in worker/src/upload.ts — see MAX_UPLOAD_BYTES in
 * image.ts for why it is written twice. Refusing an oversized clip on the phone
 * keeps it out of the offline queue, where a certain 413 would retry forever.
 */
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

/**
 * MP4 first: it plays everywhere, including on an older iPhone and in a
 * desktop's built-in player once downloaded. WebM is the fallback for the
 * Androids whose Chrome can only record that.
 */
const PREFERRED_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

/**
 * The recording format to ask for, '' to let the browser choose, or null when
 * this browser cannot record at all.
 */
export function pickVideoMimeType(isSupported: ((type: string) => boolean) | undefined): string | null {
  if (!isSupported) return null;
  return PREFERRED_TYPES.find((t) => isSupported(t)) ?? '';
}

/**
 * onLoadedMetadata handler for every <video> showing a recording.
 *
 * Chrome's MediaRecorder writes WebM without a duration, so the player shows
 * no length and the seek bar does nothing. Seeking far past the end makes the
 * browser scan for the real duration; the first timeupdate puts it back at 0.
 * A no-op for MP4, which always carries its duration.
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
