import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_UPLOAD_BYTES, UNDECODABLE_IMAGE, downscaleImage } from '../lib/image';
import Icon from './Icon';
import { Spinner } from './ui';

/**
 * Photo capture tile with three states (empty, processing, success), told apart
 * by glyph and border weight as well as colour for outdoor use. OCR failure is
 * never a dead end: "Type it in" is one tap away and focuses the matching field.
 */
interface Props {
  label: string;
  photo: Blob | null;
  busy?: boolean;
  /** Set when OCR could not read the value; shows a hint, never blocks. */
  error?: string | null;
    /** `blob` is the downscaled copy to upload; `original` is the untouched capture, so OCR can read full-resolution pixels. */
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
    /* Two inputs, not one with a toggled `capture` attribute: browsers read it
       when the picker opens and Safari has kept the camera after removal. */
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
            // A file this browser can't decode (an iPhone HEIC in desktop Chrome) is not a capture;
            // carrying it forward stores an unviewable photo and sends OCR a bad image.
      if (err instanceof Error && err.name === UNDECODABLE_IMAGE) {
        console.error('Photo could not be decoded', err);
        setRejected('unsupported');
        return;
      }
      // Canvas *encoding* has known WebKit quirks on some camera-captured
      // photos. There the original decoded fine, so rather than silently drop
      // the capture, fall back to it and let the flow keep working.
      console.error('Photo downscale failed, using original', err);
            // ...but only if the Worker would accept it: an oversized original gets a
            // 413 and then retries from the offline queue forever. Refuse here and retake.
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
                /* Two ways in, not one big button: nesting controls inside a tappable tile
                   would put controls inside a control. The camera keeps the visual weight. */
        <div className={`${shell.replace('min-h-44', 'min-h-36')} relative border-dashed border-line-strong bg-surface p-1 text-ink-900`}>
          {/* The tile itself is the camera button: one big target, no second
              "Take photo" button to aim for. Content starts at the top, not the
              middle, so two tiles side by side line up even when one label
              wraps to two lines and the other doesn't. */}
          <button
            type="button"
            onClick={openCamera}
            className="flex w-full flex-1 flex-col items-center justify-start gap-2 rounded-lg px-2 pb-2 pt-5 active:bg-ink-50"
          >
            <Icon name="camera" size={32} />
            <span className="text-balance text-center text-sm font-semibold">
              {label}
              {optional && <span className="block text-xs font-medium text-ink-500">{t('common.optional')}</span>}
            </span>
          </button>
          {/* Gallery is the rare path, so it is a corner icon rather than a
              second line of text; it can't nest inside the camera button. */}
          <button
            type="button"
            onClick={openGallery}
            aria-label={t('newJob.uploadFromDevice')}
            title={t('newJob.uploadFromDevice')}
            className="absolute end-0 top-0 inline-flex size-tap items-center justify-center rounded-lg text-ink-600 active:bg-ink-100"
          >
            <Icon name="upload" size={18} />
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
