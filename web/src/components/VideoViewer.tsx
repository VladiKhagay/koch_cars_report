import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchPhotoUrl, type PhotoFailure } from '../lib/workerApi';
import { seekableDuration, videoExtension } from '../lib/video';
import Icon from './Icon';
import { Spinner } from './ui';

/**
 * The job's condition video, fetched only on request (~15MB vs a few hundred
 * KB for a photo) through the authorised /photo route and played from a blob
 * URL, since <video src> can't send the Authorization header. Download is an
 * explicit link (opens the share sheet on iPhone).
 */
export default function VideoViewer({ jobId, downloadName }: { jobId: string; downloadName: string }) {
  const { t } = useTranslation();
  const [requested, setRequested] = useState(false);
  const [video, setVideo] = useState<{ url: string; type: string } | null>(null);
  const [failure, setFailure] = useState<PhotoFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!requested) return;
    let revoke: string | null = null;
    let cancelled = false;
    setVideo(null);
    setFailure(null);

    void fetchPhotoUrl(jobId, 'video').then((result) => {
      if (cancelled) {
        if ('url' in result) URL.revokeObjectURL(result.url);
        return;
      }
      if ('url' in result) {
        setVideo(result);
        revoke = result.url;
      } else {
        setFailure(result.failure);
      }
    });

    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [jobId, requested, attempt]);

  // Plates and VINs are already [A-Z0-9-], but this lands in a filename on
  // someone's device, so nothing else gets through.
  const safeName = downloadName.replace(/[^A-Za-z0-9_-]/g, '');
  const box = 'flex min-h-44 w-full flex-col items-center justify-center gap-2 rounded-xl border px-4 text-center';
  const textAction = 'inline-flex min-h-tap items-center gap-1.5 text-sm font-bold text-ink-900 underline underline-offset-2';

  return (
    <figure className="m-0">
      <figcaption className="mb-1.5 text-sm font-medium text-ink-700">{t('newJob.video')}</figcaption>

      {!requested && (
        <div className={`${box} border-line bg-surface`}>
          <Icon name="video" size={26} className="text-ink-700" />
          <button
            type="button"
            onClick={() => setRequested(true)}
            className="inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-ink-900 px-4 text-sm font-semibold text-surface"
          >
            {t('video.play')}
          </button>
        </div>
      )}

      {requested && !video && !failure && (
        <div className={`${box} border-line bg-surface`} role="status">
          <Spinner size={24} />
          <span className="text-xs text-ink-600">{t('video.loading')}</span>
        </div>
      )}

      {video && (
        <>
          <video
            src={video.url}
            controls
            autoPlay
            playsInline
            onLoadedMetadata={seekableDuration}
            className="w-full rounded-xl border border-line bg-black"
          />
          <a
            href={video.url}
            download={`${safeName}.${videoExtension(video.type)}`}
            className={`${textAction} mt-1`}
          >
            <Icon name="download" size={16} />
            {t('video.download')}
          </a>
        </>
      )}

      {failure && (
        <div className={`${box} border-dashed border-line-strong bg-surface`}>
          <Icon name={failure === 'failed' ? 'offline' : 'imageOff'} size={26} className="text-ink-500" />
          <span className="text-sm font-semibold text-ink-900">{t(`video.${failure}Title`)}</span>
          <span className="text-xs text-ink-600">{t(`video.${failure}Body`)}</span>
          {failure === 'failed' && (
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`${textAction} text-xs`}>
              {t('common.retry')}
            </button>
          )}
        </div>
      )}
    </figure>
  );
}
