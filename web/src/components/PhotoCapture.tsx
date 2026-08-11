import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downscaleImage } from '../lib/image';

/**
 * Photo capture tile with four explicit states, per the "Vehicle Prep
 * Tracker UI" design system (components/PhotoTile):
 *  - empty:      dashed border, camera icon, "Tap to capture"
 *  - processing: blue border, spinner, "Reading photo…"
 *  - error:      red, OCR failure reason, Retake / "Type it in" actions
 *  - success:    green, photo thumbnail (real photo, not the design's
 *                placeholder swatch), Retake link
 */
interface Props {
  label: string;
  photo: Blob | null;
  busy?: boolean;
  /** Translated OCR failure reason; puts the tile in the error state. */
  error?: string | null;
  onCapture: (blob: Blob) => void;
  /** "Type it in" pressed — parent should focus the manual input. */
  onTypeItIn?: () => void;
}

export default function PhotoCapture({ label, photo, busy, error, onCapture, onTypeItIn }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);

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
    try {
      const downscaled = await downscaleImage(file);
      onCapture(downscaled);
    } catch (err) {
      // createImageBitmap/canvas encoding has known WebKit quirks on some
      // camera-captured photos. Rather than silently drop the capture,
      // fall back to the un-downscaled original so the flow keeps working.
      console.error('Photo downscale failed, using original', err);
      onCapture(file);
    }
  }

  const openCamera = () => inputRef.current?.click();

  const state: 'empty' | 'processing' | 'error' | 'success' = !photo
    ? 'empty'
    : busy
      ? 'processing'
      : error && !errorDismissed
        ? 'error'
        : 'success';

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void handleChange(e)}
      />

      {state === 'empty' && (
        <button
          type="button"
          onClick={openCamera}
          className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-4 text-slate-500"
        >
          <CameraIcon />
          <span className="text-sm font-semibold">{label}</span>
          <span className="text-xs text-slate-400">{t('newJob.tapToCapture')}</span>
        </button>
      )}

      {state === 'processing' && (
        <div className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-brand-600 bg-white p-4 text-brand-700">
          <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand-600" />
          <span className="text-sm font-semibold">{label}</span>
          <span className="text-xs">{t('newJob.reading')}</span>
        </div>
      )}

      {state === 'error' && (
        <div className="flex min-h-40 w-full flex-col gap-2 rounded-2xl border-2 border-red-600 bg-red-50 p-4 text-red-800">
          <span className="text-sm font-bold">{t('newJob.retakeNeeded', { label })}</span>
          <span className="text-xs">{error}</span>
          <div className="mt-auto flex gap-2">
            <button
              type="button"
              onClick={openCamera}
              className="min-h-11 flex-1 rounded-lg bg-red-600 text-sm font-bold text-white"
            >
              {t('newJob.retake')}
            </button>
            <button
              type="button"
              onClick={() => {
                setErrorDismissed(true);
                onTypeItIn?.();
              }}
              className="min-h-11 flex-1 rounded-lg border border-red-700 text-sm font-bold text-red-800"
            >
              {t('newJob.typeItIn')}
            </button>
          </div>
        </div>
      )}

      {state === 'success' && (
        <div className="flex min-h-40 w-full flex-col gap-2 rounded-2xl border-2 border-emerald-600 bg-emerald-50 p-3 text-emerald-800">
          <span className="text-sm font-bold">{t('newJob.captured', { label })}</span>
          {previewUrl && (
            <img src={previewUrl} alt={label} className="min-h-0 w-full flex-1 rounded-lg object-cover" />
          )}
          <button
            type="button"
            onClick={openCamera}
            className="min-h-11 self-start text-sm font-bold underline underline-offset-2"
          >
            {t('newJob.retake')}
          </button>
        </div>
      )}
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
