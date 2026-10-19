import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, VIDEO_BITRATE, pickVideoMimeType, seekableDuration } from '../lib/video';
import Icon from './Icon';

/**
 * Condition-video slot on New Job: empty → recording (full screen) → recorded.
 *
 * Records in-app with MediaRecorder rather than handing off to the phone's
 * camera app, because only an in-app recording has a bitrate we choose — see
 * lib/video.ts. No audio: smaller files, no yard conversations on record, and
 * the app's Permissions-Policy keeps the microphone off entirely.
 *
 * Every failure leaves the job submittable: the video is optional, and a
 * phone that cannot record must not cost the worker the car.
 */
interface Props {
  video: Blob | null;
  onRecorded: (blob: Blob) => void;
  onRemove: () => void;
}

type Problem = 'unsupported' | 'denied' | 'tooLarge';

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function VideoRecorder({ video, onRecorded, onRemove }: Props) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const liveRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  function releaseCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  // Leaving the page mid-recording must not leave the camera light on.
  useEffect(() => releaseCamera, []);

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
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch {
      setProblem('denied');
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

  function stop() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  const shell = 'flex min-h-44 w-full flex-col rounded-xl border-2 p-3 text-start';
  const textAction = 'inline-flex min-h-tap items-center gap-1.5 text-sm font-bold underline underline-offset-2';

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
          <div className="absolute inset-x-0 top-0 flex items-center justify-center p-4">
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

      {!video && (
        /* One full-width row, the whole thing a button: recording the finished
           car is a step on every job, so it must be a single big tap right under
           the photos, not a 176px tile to scroll past. */
        <button
          type="button"
          onClick={() => void start()}
          className="flex min-h-control-lg w-full items-center gap-3 rounded-xl border-2 border-ink-900 bg-surface px-4 py-3 text-start text-ink-900 active:bg-ink-50"
        >
          <Icon name="video" size={28} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold">{t('newJob.recordVideo')}</span>
            <span className="block text-xs text-ink-600">{t('newJob.videoHint')}</span>
          </span>
          <Icon name="chevronRight" size={18} className="shrink-0 text-ink-500 rtl:-scale-x-100" />
        </button>
      )}

      {video && (
        <div className={`${shell} gap-2 border-ok-600 bg-ok-50 text-ok-700`}>
          <span className="flex items-start gap-1.5 text-sm font-bold">
            <Icon name="checkCircle" size={18} className="mt-px shrink-0" />
            <span>{t('newJob.videoRecorded')}</span>
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
            <button type="button" onClick={() => void start()} className={textAction}>
              <Icon name="video" size={16} />
              {t('newJob.recordAgain')}
            </button>
            <button type="button" onClick={onRemove} className={`${textAction} text-danger-700`}>
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
