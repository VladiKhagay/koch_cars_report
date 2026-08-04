import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downscaleImage } from '../lib/image';

interface Props {
  label: string;
  photo: Blob | null;
  busy?: boolean;
  onCapture: (blob: Blob) => void;
}

export default function PhotoCapture({ label, photo, busy, onCapture }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const downscaled = await downscaleImage(file);
    onCapture(downscaled);
  }

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">{label}</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void handleChange(e)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative flex h-40 w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-white"
      >
        {previewUrl ? (
          <img src={previewUrl} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-slate-400">
            <CameraIcon />
            <span className="text-sm">{t('newJob.takePhoto')}</span>
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white">
            {t('newJob.reading')}
          </span>
        )}
        {previewUrl && !busy && (
          <span className="absolute bottom-1 right-1 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
            {t('newJob.retake')}
          </span>
        )}
      </button>
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
