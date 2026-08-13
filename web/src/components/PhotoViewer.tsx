import { useEffect, useState } from 'react';
import { fetchPhotoUrl, type PhotoFailure } from '../lib/workerApi';
import type { PhotoKind } from '../lib/types';
import { useTranslation } from 'react-i18next';
import Icon from './Icon';
import { Skeleton } from './ui';

/**
 * Loading and "gone" are now different pictures.
 *
 * Photos expire after 90 days by R2 lifecycle rule, so the failed state is a
 * routine, recurring condition rather than an edge case — and the previous
 * treatment rendered it as the character "—" in grey, one character away from
 * the loading state's "…". A manager could not tell whether to wait or to stop
 * waiting.
 */
export default function PhotoViewer({ jobId, kind, label }: { jobId: string; kind: PhotoKind; label: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<PhotoFailure | null>(null);
  /** Bumped by "Try again" — the only way to re-run the effect for one tile. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    setUrl(null);
    setFailure(null);

    void fetchPhotoUrl(jobId, kind).then((result) => {
      if (cancelled) {
        if ('url' in result) URL.revokeObjectURL(result.url);
        return;
      }
      if ('url' in result) {
        setUrl(result.url);
        revoke = result.url;
      } else {
        setFailure(result.failure);
      }
    });

    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [jobId, kind, attempt]);

  return (
    <figure className="m-0">
      <figcaption className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-600">{label}</figcaption>

      {url && (
        <img
          src={url}
          alt={label}
          className="h-44 w-full rounded-xl border border-line object-cover"
        />
      )}

      {!url && !failure && (
        <div className="relative h-44 w-full overflow-hidden rounded-xl border border-line" role="status">
          <Skeleton className="h-full w-full rounded-none" />
          <span className="sr-only">{t('photo.loading')}</span>
        </div>
      )}

      {/* Three different problems with three different answers. The old state
          asserted the 90-day expiry for all of them, which sent a manager
          looking for a deleted file when the photo had never been uploaded or
          their session had simply run out. */}
      {failure && (
        <div className="flex h-44 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface px-4 text-center">
          <Icon name={failure === 'failed' ? 'offline' : 'imageOff'} size={26} className="text-ink-500" />
          <span className="text-sm font-semibold text-ink-900">{t(`photo.${failure}Title`)}</span>
          <span className="text-xs text-ink-600">{t(`photo.${failure}Body`)}</span>
          {failure === 'failed' && (
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="inline-flex min-h-tap items-center text-xs font-bold text-ink-900 underline underline-offset-2"
            >
              {t('common.retry')}
            </button>
          )}
        </div>
      )}
    </figure>
  );
}
