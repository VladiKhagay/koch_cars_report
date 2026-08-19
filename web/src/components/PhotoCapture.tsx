import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_UPLOAD_BYTES, UNDECODABLE_IMAGE, downscaleImage } from '../lib/image';
import Icon from './Icon';
import { Spinner } from './ui';

/**
 * Photo capture tile with three explicit states:
 *  - empty:      camera glyph, the field name, and the two ways to supply one
 *  - processing: spinner, "Reading photo…"
 *  - success:    the real thumbnail and Retake, plus an amber "type it in"
 *                hint when OCR could not read the value
 *
 * Each state is distinguished by glyph and border weight as well as by colour,
 * because this is the first thing a worker looks at outdoors and the last
 * thing that should depend on hue discrimination.
 *
 * OCR failure is never a dead end: "Type it in" is always one tap away, and it
 * focuses the matching field. Assistance never becomes a gate.
 */
interface Props {
  label: string;
  photo: Blob | null;
  busy?: boolean;
  /** Set when OCR could not read the value; shows a hint, never blocks. */
  error?: string | null;
  /**
   * `blob` is the downscaled copy to store and upload. `original` is the
   * untouched capture, passed on so OCR can read from the full-resolution
   * pixels — a plate is small enough in a whole-car shot that the downscale
   * alone can cost the read.
   */
  onCapture: (blob: Blob, original: Blob) => void;
  /** Says so on the empty tile, so a skippable photo doesn't read as a demand. */
  optional?: boolean;
  /** "Type it in" pressed — parent should focus the manual input. */
  onTypeItIn?: () => void;
  /** Offered only where a photo is optional, so a required slot can't be emptied. */
  onRemove?: () => void;
}

export default function PhotoCapture({
  label,
  photo,
  busy,
  error,
  optional,
  onCapture,
  onTypeItIn,
  onRemove,
}: Props) {
  const { t } = useTranslation();
  /*
   * Two inputs rather than one whose `capture` attribute is toggled. Browsers
   * read `capture` when the picker opens, and removing the attribute between a
   * click and the dialog is unreliable — Safari in particular has shipped
   * versions that keep the camera. Two elements have no such race, and the
   * cost is one extra hidden node.
   */
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [rejected, setRejected] = useState<'tooLarge' | 'unsupported' | null>(null);

  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    setErrorDismissed(false);
  }, [error]);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRejected(null);
    try {
      const downscaled = await downscaleImage(file);
      onCapture(downscaled, file);
    } catch (err) {
      // A file this browser cannot decode is not a capture at all. It used to
      // be carried forward anyway: stored to R2 in a format the viewer cannot
      // show, and posted to OCR labelled image/jpeg, where the model returns
      // "couldn't read it" and the worker retakes the same unreadable photo.
      // An iPhone HEIC in desktop Chrome is the everyday case. Say so instead.
      if (err instanceof Error && err.name === UNDECODABLE_IMAGE) {
        console.error('Photo could not be decoded', err);
        setRejected('unsupported');
        return;
      }
      // Canvas *encoding* has known WebKit quirks on some camera-captured
      // photos. There the original decoded fine, so rather than silently drop
      // the capture, fall back to it and let the flow keep working.
      console.error('Photo downscale failed, using original', err);
      // ...but only if the Worker would actually accept it. An oversized
      // original is not a slow upload, it is a permanent one: /upload answers
      // 413, submitJob throws, and the payload goes into the offline queue,
      // which retries it on every reconnect forever without ever succeeding.
      // Refusing here keeps that out of the queue and tells the worker to
      // retake, which is the only thing that actually resolves it.
      if (file.size > MAX_UPLOAD_BYTES) {
        setRejected('tooLarge');
        return;
      }
      onCapture(file, file);
    }
  }

  const openCamera = () => cameraRef.current?.click();
  const openGallery = () => galleryRef.current?.click();

  // A failed read never blocks: the photo is still captured and the worker
  // types the value in. Retaking rarely helps (the plate is small in a
  // whole-car shot), so this is a hint on the captured tile, not an error gate.
  const state: 'empty' | 'processing' | 'success' = !photo ? 'empty' : busy ? 'processing' : 'success';
  const hint = error && !errorDismissed ? error : null;

  const shell = 'flex min-h-44 w-full flex-col rounded-xl border-2 p-3 text-start';
  const textAction = 'inline-flex min-h-tap items-center gap-1.5 text-sm font-bold underline underline-offset-2';

  return (
    <div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void handleChange(e)}
      />
      {/* No `capture`, so the OS offers the gallery / file picker instead. */}
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleChange(e)}
      />

      {state === 'empty' && (
        /* Not one big button any more: there are two ways in, and nesting them
           inside a tappable tile would put controls inside a control. The
           camera keeps the visual weight — it is the path for almost every
           car, and the gallery exists for the one photographed earlier. */
        <div
          className={`${shell} items-center justify-center gap-2 border-dashed border-line-strong bg-surface text-ink-900`}
        >
          <Icon name="camera" size={28} />
          <span className="text-center text-sm font-semibold">
            {label}
            {optional && <span className="ms-1.5 font-medium text-ink-500">{t('common.optional')}</span>}
          </span>
          <button
            type="button"
            onClick={openCamera}
            className="mt-1 inline-flex min-h-tap w-full items-center justify-center gap-1.5 rounded-lg bg-ink-900 px-3 text-sm font-semibold text-surface"
          >
            <Icon name="camera" size={16} />
            {t('newJob.takePhoto')}
          </button>
          <button type="button" onClick={openGallery} className={`${textAction} text-ink-700`}>
            <Icon name="upload" size={16} />
            {t('newJob.uploadFromDevice')}
          </button>
        </div>
      )}

      {state === 'processing' && (
        <div className={`${shell} items-center justify-center gap-2 border-ink-900 bg-surface text-ink-900`}>
          <Spinner size={26} />
          <span className="text-center text-sm font-semibold">{label}</span>
          <span className="text-center text-xs font-medium text-ink-600">{t('newJob.reading')}</span>
        </div>
      )}

      {state === 'success' && (
        <div
          className={
            hint
              ? `${shell} gap-2 border-warn-700 bg-warn-50 text-warn-700`
              : `${shell} gap-2 border-ok-600 bg-ok-50 text-ok-700`
          }
        >
          <span className="flex items-start gap-1.5 text-sm font-bold">
            <Icon name={hint ? 'alertTriangle' : 'checkCircle'} size={18} className="mt-px shrink-0" />
            <span>{t('newJob.captured', { label })}</span>
          </span>
          {hint && <span className="text-xs font-medium">{t('newJob.typeItInHint')}</span>}
          {previewUrl && (
            <img src={previewUrl} alt={label} className="min-h-0 w-full flex-1 rounded-lg object-cover" />
          )}
          <div className="mt-auto flex flex-wrap items-center gap-x-3 pt-1">
            <button type="button" onClick={openCamera} className={textAction}>
              <Icon name="camera" size={16} />
              {t('newJob.retake')}
            </button>
            <button type="button" onClick={openGallery} className={textAction}>
              <Icon name="upload" size={16} />
              {t('newJob.uploadFromDevice')}
            </button>
            {hint && (
              <button
                type="button"
                onClick={() => {
                  setErrorDismissed(true);
                  onTypeItIn?.();
                }}
                className={textAction}
              >
                {t('newJob.typeItIn')}
              </button>
            )}
            {onRemove && (
              <button type="button" onClick={onRemove} className={`${textAction} text-danger-700`}>
                <Icon name="trash" size={16} />
                {t('newJob.removePhoto')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sits outside the state blocks because a rejected file leaves the tile
          in whatever state it was already in — empty for a first capture,
          still-successful for a retake that was too big. */}
      {rejected && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-danger-700">
          <Icon name="alertTriangle" size={14} className="mt-px shrink-0" />
          {t(rejected === 'tooLarge' ? 'newJob.photoTooLarge' : 'newJob.photoUnsupported')}
        </p>
      )}
    </div>
  );
}
