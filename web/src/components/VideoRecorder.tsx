import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  VIDEO_BITRATE,
  type VideoProblem,
  pickVideoMimeType,
  seekableDuration,
} from '../lib/video';
import Icon from './Icon';

/**
 * Condition-video slot on New Job: empty, recording (full screen), compressing
 * a gallery pick, ready. Records in-app so the bitrate is ours to choose
 * (lib/video.ts), without audio; a gallery clip is re-encoded on the phone to
 * the same target (lib/videoCompress.ts). Every failure leaves the job
 * submittable: the video is optional.
 */
interface Props {
  video: Blob | null;
  onRecorded: (blob: Blob) => void;
  onRemove: () => void;
  /** True while a gallery clip is being compressed: New Job holds Submit until it settles. */
  onBusyChange?: (busy: boolean) => void;
  /** True while the job is being submitted: nothing may start, or its clip would land on the next car. */
  disabled?: boolean;
}

/** Same wording as video_unsupported, but about converting a picked clip, not recording. */
type Problem = VideoProblem | 'pickUnsupported';

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function VideoRecorder({ video, onRecorded, onRemove, onBusyChange, disabled = false }: Props) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const liveRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** 0..100 while compressing a gallery pick, null otherwise. */
  const [percent, setPercent] = useState<number | null>(null);
  /* Read after awaits (camera permission, file picker), where the prop in the closure is stale. */
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  function releaseCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  // Leaving the page mid-recording must not leave the camera light on.
  useEffect(() => releaseCamera, []);
  // Leaving the page mid-compression stops the encoder rather than burning battery for nothing.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!video) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(video);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [video]);

  useEffect(() => {
    if (!recording) return;
    if (liveRef.current) liveRef.current.srcObject = streamRef.current;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(Math.min(seconds, MAX_VIDEO_SECONDS));
      if (seconds >= MAX_VIDEO_SECONDS) stop();
    }, 250);
    return () => clearInterval(timer);
  }, [recording]);

  async function start() {
    setProblem(null);
    const mimeType = pickVideoMimeType(
      typeof MediaRecorder === 'undefined' ? undefined : (type) => MediaRecorder.isTypeSupported(type),
    );
    if (mimeType === null || !navigator.mediaDevices?.getUserMedia) {
      setProblem('unsupported');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch {
      setProblem('denied');
      return;
    }
    if (disabledRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;

    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: VIDEO_BITRATE,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      releaseCamera();
      setRecording(false);
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/mp4' });
      if (blob.size === 0) return;
      // A clip the Worker is certain to refuse would sit in the offline queue
      // retrying forever; say so now, while the car is still in front of them.
      if (blob.size > MAX_VIDEO_BYTES) {
        setProblem('tooLarge');
        return;
      }
      onRecorded(blob);
    };
    recorderRef.current = recorder;
    // A timeslice, so a recording cut short by the OS (screen lock, incoming
    // call) still has everything up to the last second.
    recorder.start(1000);
    setElapsed(0);
    setRecording(true);
  }

  /* The picked File is only ever a local here: never in state, so a 1GB
     original is released as soon as compression is done with it. */
  async function compress(file: File) {
    setProblem(null);
    if (typeof VideoEncoder === 'undefined') {
      setProblem('pickUnsupported');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setPercent(0);
    onBusyChange?.(true);

    // Best effort: a screen that sleeps mid-encode suspends the page. Lost again
    // whenever the tab is hidden, so it is re-requested on return.
    let lock: WakeLockSentinel | null = null;
    const lockScreen = () => {
      if (document.visibilityState !== 'visible' || controller.signal.aborted) return;
      navigator.wakeLock
        ?.request('screen')
        .then((l) => {
          // Rapid hidden/visible flips can have two requests in flight: keep only the newest.
          void (lock as WakeLockSentinel | null)?.release().catch(() => {});
          if (controller.signal.aborted) void l.release();
          else lock = l;
        })
        .catch(() => {});
    };
    lockScreen();
    document.addEventListener('visibilitychange', lockScreen);

    try {
      const { compressVideo } = await import('../lib/videoCompress');
      const result = await compressVideo(file, {
        signal: controller.signal,
        onProgress: (p) => setPercent(Math.round(p * 100)),
      });
      if (result.ok) onRecorded(result.blob);
      else if (result.problem !== 'canceled') setProblem(result.problem === 'unsupported' ? 'pickUnsupported' : result.problem);
    } catch (err) {
      // The chunk itself failed to load (offline before it was ever cached).
      console.warn('video compressor unavailable', err);
      if (!controller.signal.aborted) setProblem('failed');
    } finally {
      document.removeEventListener('visibilitychange', lockScreen);
      void (lock as WakeLockSentinel | null)?.release().catch(() => {});
      controller.abort(); // also drops a wake lock still being granted
      if (abortRef.current === controller) abortRef.current = null;
      setPercent(null);
      onBusyChange?.(false);
    }
  }

  function pickFromGallery() {
    setProblem(null);
    fileRef.current?.click();
  }

  function stop() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  const shell = 'flex min-h-44 w-full flex-col rounded-xl border-2 p-3 text-start';
  const textAction =
    'inline-flex min-h-tap items-center gap-1.5 text-sm font-bold underline underline-offset-2 disabled:opacity-50';

  return (
    <div>
      {recording && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('newJob.recording')}
          className="fixed inset-0 z-50 flex flex-col bg-black"
        >
          <video ref={liveRef} autoPlay muted playsInline className="min-h-0 w-full flex-1 object-cover" />
          {/* viewport-fit=cover puts this under the notch / Dynamic Island; the inset keeps the timer below it. */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-center p-4 pt-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))]">
            <span className="inline-flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 font-mono text-base font-bold text-white">
              <span aria-hidden className="h-3 w-3 rounded-full bg-danger-600" />
              {clock(elapsed)} / {clock(MAX_VIDEO_SECONDS)}
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex justify-center p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={stop}
              className="inline-flex min-h-tap items-center justify-center rounded-full bg-white px-8 py-4 text-base font-bold text-black"
            >
              {t('newJob.stopRecording')}
            </button>
          </div>
        </div>
      )}

      {/* No capture attribute: that would open the camera instead of the gallery. */}
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = ''; // picking the same clip again must fire onChange
          if (file && !disabledRef.current) void compress(file);
        }}
      />

      {percent !== null && (
        <div className={`${shell} justify-center gap-2 border-ink-900 bg-surface text-ink-900`}>
          <span aria-live="polite" className="text-sm font-bold">
            {t('newJob.compressingVideo', { percent })}
          </span>
          <progress max={100} value={percent} aria-label={t('newJob.videoSection')} className="w-full" />
          <span className="text-pretty text-xs text-ink-600">{t('newJob.compressKeepOpen')}</span>
          <div className="pt-1">
            <button type="button" onClick={() => abortRef.current?.abort()} className={`${textAction} text-danger-700`}>
              <Icon name="x" size={16} />
              {t('newJob.cancelCompress')}
            </button>
          </div>
        </div>
      )}

      {!video && percent === null && (
        /* One full-width row, the whole thing a button: recording the finished
           car is a step on every job, so it must be a single big tap right under
           the photos, not a 176px tile to scroll past. */
        <button
          type="button"
          onClick={() => void start()}
          disabled={disabled}
          className="flex min-h-control-lg w-full items-center gap-3 rounded-xl border-2 border-ink-900 bg-surface px-4 py-3 text-start text-ink-900 active:bg-ink-50 disabled:opacity-50"
        >
          <Icon name="video" size={28} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold">{t('newJob.recordVideo')}</span>
            <span className="block text-pretty text-xs text-ink-600">{t('newJob.videoHint')}</span>
          </span>
          <Icon name="chevronRight" size={18} className="shrink-0 text-ink-500 rtl:-scale-x-100" />
        </button>
      )}
      {!video && percent === null && (
        <button type="button" onClick={pickFromGallery} disabled={disabled} className={`${textAction} mt-1 text-ink-900`}>
          <Icon name="upload" size={16} />
          {t('newJob.chooseVideo')}
        </button>
      )}

      {video && percent === null && (
        <div className={`${shell} gap-2 border-ok-600 bg-ok-50 text-ok-700`}>
          <span className="flex items-start gap-1.5 text-sm font-bold">
            <Icon name="checkCircle" size={18} className="mt-px shrink-0" />
            <span>{t('newJob.videoReady')}</span>
          </span>
          {previewUrl && (
            <video
              src={previewUrl}
              controls
              playsInline
              onLoadedMetadata={seekableDuration}
              className="w-full rounded-lg bg-black"
            />
          )}
          <div className="mt-auto flex flex-wrap items-center gap-x-3 pt-1">
            <button type="button" onClick={() => void start()} disabled={disabled} className={textAction}>
              <Icon name="video" size={16} />
              {t('newJob.recordAgain')}
            </button>
            <button type="button" onClick={pickFromGallery} disabled={disabled} className={textAction}>
              <Icon name="upload" size={16} />
              {t('newJob.chooseAnother')}
            </button>
            <button type="button" onClick={onRemove} disabled={disabled} className={`${textAction} text-danger-700`}>
              <Icon name="trash" size={16} />
              {t('newJob.removeVideo')}
            </button>
          </div>
        </div>
      )}

      {problem && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-danger-700">
          <Icon name="alertTriangle" size={14} className="mt-px shrink-0" />
          {t(`newJob.video_${problem}`)}
        </p>
      )}
    </div>
  );
}
