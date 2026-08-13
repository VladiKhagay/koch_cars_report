import { useEffect, useState } from 'react';
import { fetchPhotoUrl } from '../lib/workerApi';
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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoke: string | null = null;
    fetchPhotoUrl(jobId, kind).then((u) => {
      if (u) {
        setUrl(u);
        revoke = u;
      } else {
        setFailed(true);
      }
    });
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [jobId, kind]);

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

      {!url && !failed && (
        <div className="relative h-44 w-full overflow-hidden rounded-xl border border-line" role="status">
          <Skeleton className="h-full w-full rounded-none" />
          <span className="sr-only">{t('photo.loading')}</span>
        </div>
      )}

      {failed && (
        <div className="flex h-44 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface px-4 text-center">
          <Icon name="imageOff" size={26} className="text-ink-500" />
          <span className="text-sm font-semibold text-ink-900">{t('photo.unavailable')}</span>
          <span className="text-xs text-ink-600">{t('photo.expiredHint')}</span>
        </div>
      )}
    </figure>
  );
}
