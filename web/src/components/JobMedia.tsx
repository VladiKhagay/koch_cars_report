import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { mediaRefused, removeMedia, setMedia, slotExists, slotRemovable, type SlotRow } from '../lib/jobs';
import { MAX_UPLOAD_BYTES, UNDECODABLE_IMAGE, downscaleImage } from '../lib/image';
import { MAX_VIDEO_BYTES } from '../lib/video';
import type { PhotoKind } from '../lib/types';
import PhotoViewer from './PhotoViewer';
import VideoViewer from './VideoViewer';
import VideoRecorder from './VideoRecorder';
import StatusBanner from './StatusBanner';
import Icon from './Icon';
import { Button, ConfirmAction, Skeleton, Spinner } from './ui';

const PHOTO_SLOTS: PhotoKind[] = ['plate', 'vin', 'extra_1', 'extra_2', 'extra_3'];
const NO_SLOTS: PhotoKind[] = [];

type MediaProblem = 'error' | 'windowClosed' | 'photoTooLarge' | 'photoUnsupported' | 'videoTooLarge';

/**
 * A job's photos and video. Read-only: only the slots that hold something.
 * `editable` (managers/admins) adds a "Manage photos & video" toggle; while it
 * is open, all six slots show, each with Add, or Replace and Remove. Those take
 * effect at once, separate from the job's Save button.
 * Reads `photos` (RLS covers Carasso for jobs on its sites).
 *
 * `alwaysManage` is the worker's own job inside its 15-minute window (MyJobs,
 * 0035): no toggle, the slots are manageable while `editable`, the hint says
 * Save/Cancel don't undo media, and a refusal reads as "the window closed".
 * `keepSlots` can be replaced but never removed (a worker's plate/VIN).
 */
export default function JobMedia({
  jobId,
  downloadName,
  editable = false,
  alwaysManage = false,
  keepSlots = NO_SLOTS,
  onChanged,
  onBusyChange,
}: {
  jobId: string;
  downloadName: string;
  editable?: boolean;
  alwaysManage?: boolean;
  keepSlots?: PhotoKind[];
  /** After a slot changed, so the page can refresh the edit history. */
  onChanged?: () => void;
  /** A change started (true) or settled (false), so the page can hold its own Save/Cancel. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SlotRow[] | null>(null);
  /** Bumped per slot after a change: re-mounts its tile and fetches past the HTTP cache. */
  const [versions, setVersions] = useState<Partial<Record<PhotoKind, number>>>({});
  const [busy, setBusy] = useState<PhotoKind | null>(null);
  const [problem, setProblem] = useState<{ kind: PhotoKind; problem: MediaProblem } | null>(null);
  const [managing, setManaging] = useState(alwaysManage);
  /* Kept open while a change is in flight, even if `editable` drops (the window closed mid-upload). */
  const edit = managing && (editable || busy !== null);
  const fileInputs = useRef<Partial<Record<PhotoKind, HTMLInputElement | null>>>({});

  /** The read failed: rows kept as they were (null before the first read), banner shown. */
  const [loadFailed, setLoadFailed] = useState(false);

  /** null = the read failed; an error is not "no media". */
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('photos').select('kind, removed_at').eq('job_id', jobId);
    return error ? null : ((data ?? []) as SlotRow[]);
  }, [jobId]);
  const apply = (r: SlotRow[] | null) => {
    setLoadFailed(r === null);
    if (r) setRows(r);
  };

  useEffect(() => {
    let live = true;
    void load().then((r) => {
      if (!live) return;
      setLoadFailed(r === null);
      if (r) setRows(r);
    });
    return () => {
      live = false;
    };
  }, [load]);

  async function change(kind: PhotoKind, run: () => Promise<void>) {
    setBusy(kind);
    onBusyChange?.(true);
    setProblem(null);
    try {
      await run();
    } catch (err) {
      console.error('Media change failed', err);
      setProblem({ kind, problem: alwaysManage && mediaRefused(err) ? 'windowClosed' : 'error' });
    }
    // Re-read either way: a failed video may still have landed its row.
    apply(await load());
    setVersions((v) => ({ ...v, [kind]: (v[kind] ?? 0) + 1 }));
    setBusy(null);
    onBusyChange?.(false);
    onChanged?.();
  }

  async function photoPicked(kind: PhotoKind, file: File | undefined) {
    if (!file) return;
    // Busy from the pick, not from the upload: the downscale takes seconds on a phone.
    setBusy(kind);
    onBusyChange?.(true);
    const refuse = (problem: MediaProblem) => {
      setBusy(null);
      onBusyChange?.(false);
      setProblem({ kind, problem });
    };
    let blob: Blob;
    try {
      blob = await downscaleImage(file);
    } catch (err) {
      // Same rules as PhotoCapture: an undecodable file is refused; a canvas
      // quirk falls back to the original if the Worker would take it.
      if (err instanceof Error && err.name === UNDECODABLE_IMAGE) return refuse('photoUnsupported');
      if (file.size > MAX_UPLOAD_BYTES) return refuse('photoTooLarge');
      blob = file;
    }
    await change(kind, () => setMedia(jobId, kind, blob));
  }

  function videoPicked(blob: Blob | undefined) {
    if (!blob) return;
    if (blob.size > MAX_VIDEO_BYTES) return setProblem({ kind: 'video', problem: 'videoTooLarge' });
    void change('video', () => setMedia(jobId, 'video', blob));
  }

  const shown = (kind: PhotoKind) => rows !== null && slotExists(rows, kind);
  const removable = (kind: PhotoKind) => rows !== null && slotRemovable(rows, kind, keepSlots);
  const photoLabel = (kind: PhotoKind, extraIndex: number) =>
    kind === 'plate' ? t('newJob.platePhoto') : kind === 'vin' ? t('newJob.vinPhoto') : t('newJob.extraPhoto', { n: extraIndex });

  const loadBanner = loadFailed && (
    <StatusBanner tone="error" live>
      {t('jobDetail.media.loadFailed')}
    </StatusBanner>
  );

  /* Read-only waits for the rows, so a removed plate never flashes a "can't open" tile. */
  if (rows === null) {
    if (loadFailed) return loadBanner;
    return (
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
      </div>
    );
  }

  const visible = PHOTO_SLOTS.filter((k) => edit || shown(k));
  let extraIndex = 0;

  const problemFor = (kind: PhotoKind) =>
    problem?.kind === kind && (
      <p role="alert" className="mt-1 flex items-start gap-1.5 text-xs font-semibold text-danger-700">
        <Icon name="alertTriangle" size={14} className="mt-px shrink-0" />
        {t(`jobDetail.media.${problem.problem}`)}
      </p>
    );

  const controls = (kind: PhotoKind, exists: boolean, label: string) => (
    <div className="mt-1 space-y-1">
      {busy === kind ? (
        <span role="status" className="inline-flex min-h-tap items-center gap-2 text-sm text-ink-700">
          <Spinner />
          {t('jobDetail.media.saving')}
        </span>
      ) : (
        <>
          {kind !== 'video' && (
            <>
              <input
                ref={(el) => {
                  fileInputs.current[kind] = el;
                }}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label={label}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  void photoPicked(kind, file);
                }}
              />
              <Button
                variant="secondary"
                block
                icon={exists ? 'sync' : 'plus'}
                disabled={busy !== null}
                onClick={() => fileInputs.current[kind]?.click()}
              >
                {exists ? t('jobDetail.media.replace') : t('jobDetail.media.add')}
              </Button>
            </>
          )}
          {removable(kind) && (
            <ConfirmAction
              block
              trigger={t('jobDetail.media.remove')}
              question={t('jobDetail.media.removeConfirm', { slot: label })}
              confirmLabel={t('jobDetail.media.remove')}
              onConfirm={() => void change(kind, () => removeMedia(jobId, kind))}
            />
          )}
        </>
      )}
      {problemFor(kind)}
    </div>
  );

  const videoExists = shown('video');

  return (
    <>
      {loadBanner}
      {/* The controls (and their per-slot message) are gone once editing closes,
          e.g. the window shut mid-upload: the refusal must still be said. */}
      {!edit && problem && (
        <StatusBanner tone="error" live>
          {t(`jobDetail.media.${problem.problem}`)}
        </StatusBanner>
      )}
      <div id={`media-${jobId}`} className="grid grid-cols-2 gap-3">
        {visible.map((kind) => {
          if (kind.startsWith('extra')) extraIndex++;
          const label = photoLabel(kind, extraIndex);
          const exists = shown(kind);
          const v = versions[kind] ?? 0;
          return (
            <div key={kind}>
              {exists ? (
                <PhotoViewer key={v} jobId={jobId} kind={kind} label={label} downloadName={downloadName} fresh={v > 0} />
              ) : (
                <figure className="m-0">
                  <figcaption className="mb-1.5 text-sm font-medium text-ink-700">{label}</figcaption>
                  <div className="flex h-44 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface px-4 text-center">
                    <Icon name="imageOff" size={26} className="text-ink-500" />
                    <span className="text-sm font-semibold text-ink-700">{t('jobDetail.media.empty')}</span>
                  </div>
                </figure>
              )}
              {edit && controls(kind, exists, label)}
            </div>
          );
        })}
      </div>
      {videoExists && <VideoViewer key={versions.video ?? 0} jobId={jobId} downloadName={downloadName} fresh={(versions.video ?? 0) > 0} />}
      {edit && <StatusBanner tone="info">{t(alwaysManage ? 'jobDetail.media.hintWorker' : 'jobDetail.media.hint')}</StatusBanner>}
      {edit && (
        <section aria-label={t('newJob.video')} className="space-y-2">
          {!videoExists && <p className="text-sm font-medium text-ink-700">{t('newJob.video')}</p>}
          {busy === 'video' ? (
            <span role="status" className="inline-flex min-h-tap items-center gap-2 text-sm text-ink-700">
              <Spinner />
              {t('jobDetail.media.savingVideo')}
            </span>
          ) : (
            <>
              <VideoRecorder video={null} onRecorded={videoPicked} onRemove={() => {}} />
              <input
                ref={(el) => {
                  fileInputs.current.video = el;
                }}
                type="file"
                accept="video/*"
                className="hidden"
                aria-label={t('jobDetail.media.chooseVideo')}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  videoPicked(file);
                }}
              />
              <Button
                variant="secondary"
                block
                icon="upload"
                disabled={busy !== null}
                onClick={() => fileInputs.current.video?.click()}
              >
                {videoExists ? t('jobDetail.media.replaceVideoFile') : t('jobDetail.media.chooseVideo')}
              </Button>
              {removable('video') && (
                <ConfirmAction
                  block
                  trigger={t('jobDetail.media.remove')}
                  question={t('jobDetail.media.removeConfirm', { slot: t('newJob.video') })}
                  confirmLabel={t('jobDetail.media.remove')}
                  onConfirm={() => void change('video', () => removeMedia(jobId, 'video'))}
                />
              )}
            </>
          )}
          {problemFor('video')}
        </section>
      )}
      {/* Held open while a change is uploading, so it can't be folded mid-save. */}
      {editable && !alwaysManage && (
        <Button
          variant="secondary"
          block
          icon={managing ? 'check' : 'pencil'}
          aria-expanded={managing}
          aria-controls={`media-${jobId}`}
          disabled={busy !== null}
          onClick={() => {
            setManaging((m) => !m);
            setProblem(null);
          }}
        >
          {managing ? t('jobDetail.media.doneManaging') : t('jobDetail.media.manage')}
        </Button>
      )}
    </>
  );
}

