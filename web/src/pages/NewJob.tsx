import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { Service } from '../lib/types';
import { isValidPlate, isValidVinFormat, vinChecksumValid, guessBrandFromVin } from '../lib/vin';
import { ocrPhoto, type OcrReason } from '../lib/workerApi';
import { submitJob, findRecentDuplicate } from '../lib/jobs';
import { enqueueForRetry, listQueued, watchConnectivity } from '../lib/offlineQueue';
import PhotoCapture from '../components/PhotoCapture';
import ServiceChips from '../components/ServiceChips';
import StatusBanner from '../components/StatusBanner';

const emptyForm = {
  plate: '',
  vin: '',
  brand: '',
  note: '',
  selectedServices: [] as string[],
  platePhoto: null as Blob | null,
  vinPhoto: null as Blob | null,
};

function FieldLabel({ text, autoFilled, autoFilledText }: { text: string; autoFilled?: boolean; autoFilledText?: string }) {
  return (
    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
      {text}
      {autoFilled && <span className="ml-2 normal-case tracking-normal text-emerald-700">✓ {autoFilledText}</span>}
    </span>
  );
}

export default function NewJob() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [ocrBusy, setOcrBusy] = useState<{ plate: boolean; vin: boolean }>({ plate: false, vin: false });
  const [ocrIssue, setOcrIssue] = useState<{ plate: OcrReason | null; vin: OcrReason | null }>({ plate: null, vin: null });
  const [autoFilled, setAutoFilled] = useState<{ plate: boolean; vin: boolean }>({ plate: false, vin: false });
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'queued' | 'error'>('idle');
  const [touched, setTouched] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const plateInputRef = useRef<HTMLInputElement>(null);
  const vinInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase
      .from('services')
      .select('*')
      .eq('active', true)
      .order('sort_order')
      .then(({ data }) => setServices(data ?? []));
  }, []);

  useEffect(() => {
    const stop = watchConnectivity(() => refreshQueuedCount());
    refreshQueuedCount();
    return stop;
  }, []);

  function refreshQueuedCount() {
    listQueued().then((jobs) => setQueuedCount(jobs.length));
  }

  async function handlePlateCapture(blob: Blob) {
    setForm((f) => ({ ...f, platePhoto: blob }));
    setOcrBusy((b) => ({ ...b, plate: true }));
    setOcrIssue((i) => ({ ...i, plate: null }));
    setAutoFilled((a) => ({ ...a, plate: false }));
    const { text, reason } = await ocrPhoto(blob, 'plate');
    setOcrBusy((b) => ({ ...b, plate: false }));
    if (text) {
      setForm((f) => ({ ...f, plate: text }));
      setAutoFilled((a) => ({ ...a, plate: true }));
    } else if (reason) {
      setOcrIssue((i) => ({ ...i, plate: reason }));
    }
  }

  async function handleVinCapture(blob: Blob) {
    setForm((f) => ({ ...f, vinPhoto: blob }));
    setOcrBusy((b) => ({ ...b, vin: true }));
    setOcrIssue((i) => ({ ...i, vin: null }));
    setAutoFilled((a) => ({ ...a, vin: false }));
    const { text, reason } = await ocrPhoto(blob, 'vin');
    setOcrBusy((b) => ({ ...b, vin: false }));
    if (text) {
      const brand = guessBrandFromVin(text);
      setForm((f) => ({ ...f, vin: text, brand: f.brand || brand || '' }));
      setAutoFilled((a) => ({ ...a, vin: true }));
      if (appUser?.site_id && isValidVinFormat(text)) {
        const dup = await findRecentDuplicate(appUser.site_id, text);
        setDuplicateWarning(Boolean(dup));
      }
    } else if (reason) {
      setOcrIssue((i) => ({ ...i, vin: reason }));
    }
  }

  function toggleService(id: string) {
    setForm((f) => ({
      ...f,
      selectedServices: f.selectedServices.includes(id)
        ? f.selectedServices.filter((s) => s !== id)
        : [...f.selectedServices, id],
    }));
  }

  const plateValid = form.plate.length > 0 && isValidPlate(form.plate);
  const vinFormatValid = isValidVinFormat(form.vin);
  const vinChecksumOk = form.vin ? vinChecksumValid(form.vin) : true;
  const canSubmit =
    form.platePhoto &&
    form.vinPhoto &&
    plateValid &&
    vinFormatValid &&
    form.selectedServices.length > 0 &&
    !submitting;

  async function handleSubmit() {
    setTouched(true);
    if (!canSubmit || !appUser?.site_id) return;

    setSubmitting(true);
    setStatus('idle');
    const payload = {
      siteId: appUser.site_id,
      workerId: appUser.id,
      plate: form.plate,
      vin: form.vin,
      brand: form.brand || null,
      workerNote: form.note || null,
      serviceIds: form.selectedServices,
      plateBlob: form.platePhoto!,
      vinBlob: form.vinPhoto!,
    };

    const resetForm = () => {
      setForm(emptyForm);
      setTouched(false);
      setDuplicateWarning(false);
      setAutoFilled({ plate: false, vin: false });
      setOcrIssue({ plate: null, vin: null });
    };

    try {
      await submitJob(payload);
      setStatus('success');
      resetForm();
    } catch {
      await enqueueForRetry(payload);
      setStatus('queued');
      resetForm();
      refreshQueuedCount();
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    'h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base';

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-bold text-slate-900">{t('newJob.title')}</h1>

      {queuedCount > 0 && <StatusBanner tone="warning">{t('newJob.queuedCount', { count: queuedCount })}</StatusBanner>}

      <div className="grid grid-cols-2 gap-3">
        <PhotoCapture
          label={t('newJob.platePhoto')}
          photo={form.platePhoto}
          busy={ocrBusy.plate}
          error={ocrIssue.plate ? t(`newJob.ocrReasons.${ocrIssue.plate}`) : null}
          onCapture={(b) => void handlePlateCapture(b)}
          onTypeItIn={() => plateInputRef.current?.focus()}
        />
        <PhotoCapture
          label={t('newJob.vinPhoto')}
          photo={form.vinPhoto}
          busy={ocrBusy.vin}
          error={ocrIssue.vin ? t(`newJob.ocrReasons.${ocrIssue.vin}`) : null}
          onCapture={(b) => void handleVinCapture(b)}
          onTypeItIn={() => vinInputRef.current?.focus()}
        />
      </div>

      <div>
        <FieldLabel text={t('newJob.plate')} autoFilled={autoFilled.plate} autoFilledText={t('newJob.autoFilled')} />
        <input
          ref={plateInputRef}
          value={form.plate}
          onChange={(e) => {
            setForm((f) => ({ ...f, plate: e.target.value.toUpperCase() }));
            setAutoFilled((a) => ({ ...a, plate: false }));
          }}
          className={`${inputClass} uppercase`}
        />
        {touched && form.plate && !plateValid && <p className="mt-1 text-xs text-amber-700">{t('newJob.plateInvalid')}</p>}
      </div>

      <div>
        <FieldLabel text={t('newJob.vin')} autoFilled={autoFilled.vin} autoFilledText={t('newJob.autoFilled')} />
        <input
          ref={vinInputRef}
          value={form.vin}
          maxLength={17}
          onChange={(e) => {
            setForm((f) => ({ ...f, vin: e.target.value.toUpperCase() }));
            setAutoFilled((a) => ({ ...a, vin: false }));
          }}
          className={`${inputClass} uppercase`}
        />
        {touched && form.vin && !vinFormatValid && <p className="mt-1 text-xs text-red-600">{t('newJob.vinInvalid')}</p>}
        {vinFormatValid && !vinChecksumOk && <p className="mt-1 text-xs text-amber-700">{t('newJob.vinChecksumWarning')}</p>}
        {duplicateWarning && <p className="mt-1 text-xs text-amber-700">{t('newJob.duplicateWarning')}</p>}
      </div>

      <div>
        <FieldLabel text={t('newJob.brand')} />
        <input
          value={form.brand}
          onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
          className={inputClass}
        />
      </div>

      <div>
        <FieldLabel text={t('newJob.services')} />
        <ServiceChips services={services} selected={form.selectedServices} onToggle={toggleService} />
        {touched && form.selectedServices.length === 0 && (
          <p className="mt-1 text-xs text-red-600">{t('newJob.serviceRequired')}</p>
        )}
      </div>

      <div>
        <FieldLabel text={t('newJob.note')} />
        <textarea
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          rows={3}
          className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-base"
        />
      </div>

      {touched && (!form.platePhoto || !form.vinPhoto) && (
        <StatusBanner tone="error">{t('newJob.photosRequired')}</StatusBanner>
      )}
      {status === 'success' && (
        <StatusBanner tone="success">
          {t('newJob.submitted')} — {t('newJob.editWindow')}
        </StatusBanner>
      )}
      {status === 'queued' && <StatusBanner tone="warning">{t('newJob.queuedOffline')}</StatusBanner>}

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={submitting}
        className="w-full rounded-xl bg-brand-600 py-4 text-lg font-semibold text-white disabled:opacity-60"
      >
        {submitting ? t('newJob.submitting') : t('newJob.submit')}
      </button>
    </div>
  );
}
