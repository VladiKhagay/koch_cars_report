import { useTranslation } from 'react-i18next';
import { useQueuedJobs, useUploadingId, useUploadProgress } from '../lib/useQueue';
import { discardQueued, retryQueued } from '../lib/offlineQueue';
import { SITE_REFUSALS, type SiteRefusal } from '../lib/jobs';
import { Badge, Button, Card, ConfirmAction, SectionHeading } from './ui';

/**
 * This phone's unsent jobs and waiting videos, as cards: My Jobs for a worker,
 * New Job for a manager/admin (who has no My Jobs). Nothing when the queue is empty.
 */
export default function QueuedJobs() {
  const { t } = useTranslation();
  const queued = useQueuedJobs();
  const uploadingId = useUploadingId();
  const uploadPercent = useUploadProgress();
  if (queued.length === 0) return null;

  return (
    <section className="space-y-2">
      <SectionHeading icon="sync">{t('queue.title')}</SectionHeading>
      {/* "They submit automatically" is about unsent jobs; a video card has its own hint. */}
      {queued.some((e) => e.stage !== 'video') && <p className="text-sm text-ink-600">{t('queue.body')}</p>}
      {queued.map((job) => {
        const video = job.stage === 'video';
        const failed = Boolean(job.needsAttention);
        // A refusal the site explains (submitJob's reason code) is said in words, not as a raw error.
        const refusal = SITE_REFUSALS.find((r): r is SiteRefusal => r === job.lastError);
        return (
          <Card key={job.queuedId} className={failed ? 'border-danger-600' : 'border-ink-900'}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-base font-semibold tracking-wide text-ink-900">
                  {job.plate ?? job.vin ?? '—'}
                </p>
                <p className="truncate font-mono text-xs text-ink-600">
                  {(job.plate ? job.vin : null) ?? '—'} · {job.brand ?? '—'}
                </p>
                <p className="mt-1 text-xs text-ink-600">
                  {video
                    ? failed
                      ? t('myJobs.videoFailedHint')
                      : t('myJobs.videoPendingHint')
                    : failed
                      ? refusal
                        ? t(`myJobs.refused.${refusal}`)
                        : t('myJobs.needsAttentionHint')
                      : t('myJobs.queuedHint')}
                </p>
              </div>
              {failed ? (
                <Badge tone="danger" icon="alertTriangle">
                  {video ? t('myJobs.videoFailed') : t('myJobs.needsAttention')}
                </Badge>
              ) : (
                <Badge tone="info" icon="sync">
                  {video
                    ? uploadingId === job.queuedId
                      ? uploadPercent
                        ? t('myJobs.videoUploadingPercent', { percent: uploadPercent })
                        : t('myJobs.videoUploading')
                      : t('myJobs.videoWaiting')
                    : t('queue.title')}
                </Badge>
              )}
            </div>
            {failed && job.lastError && !refusal && <p className="mt-2 break-words font-mono text-xs text-ink-600">{job.lastError}</p>}
            {/* A video can be given up on; a job only once it has failed for good, with a louder warning. */}
            {failed && (
              <div className="mt-3 flex flex-wrap gap-2">
                {video && (
                  <Button variant="secondary" icon="sync" onClick={() => void retryQueued(job.queuedId)}>
                    {t('common.retry')}
                  </Button>
                )}
                <ConfirmAction
                  trigger={video ? t('myJobs.discard') : t('myJobs.discardJob')}
                  question={video ? t('myJobs.discardConfirm') : t('myJobs.discardJobConfirm')}
                  confirmLabel={video ? t('myJobs.discard') : t('myJobs.discardJob')}
                  onConfirm={() => void discardQueued(job.queuedId)}
                />
              </div>
            )}
          </Card>
        );
      })}
    </section>
  );
}
