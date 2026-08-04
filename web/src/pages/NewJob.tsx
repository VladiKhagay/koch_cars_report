import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { Service } from '../lib/types';
import { isValidPlate, isValidVinFormat, vinChecksumValid, guessBrandFromVin } from '../lib/vin';
import { ocrPhoto } from '../lib/workerApi';
import { submitJob, findRecentDuplicate } from '../lib/jobs';
import { enqueueForRetry, listQueued, watchConnectivity } from '../lib/offlineQueue';
import PhotoCapture from '../components/PhotoCapture';
import ServiceChips from '../components/ServiceChips';

const emptyForm = {
  plate: '',
  vin: '',
  brand: '',
  note: '',
  selectedServices: [] as string[],
  platePhoto: null as Blob | null,
  vinPhoto: null as Blob | null,
};

export default function NewJob() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [ocrBusy, setOcrBusy] = useState<{ plate: boolean; vin: boolean }>({ plate: false, vin: false });
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'queued' | 'error'>('idle');
  const [touched, setTouched] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);

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
    const text = await ocrPhoto(blob, 'plate');
    setOcrBusy((b) => ({ ...b, plate: false }));
    if (text) setForm((f) => ({ ...f, plate: text }));
  }

  async function handleVinCapture(blob: Blob) {
    setForm((f) => ({ ...f, vinPhoto: blob }));
    setOcrBusy((b) => ({ ...b, vin: true }));
    const text = await ocrPhoto(blob, 'vin');
    setOcrBusy((b) => ({ ...b, vin: false }));
    if (text) {
      const brand = guessBrandFromVin(text);
      setForm((f) => ({ ...f, vin: text, brand: f.brand || brand || '' }));
      if (appUser?.site_id && isValidVinFormat(text)) {
        const dup = await findRecentDuplicate(appUser.site_id, text);
        setDuplicateWarning(Boolean(dup));
      }
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

    try {
      await submitJob(payload);
      setStatus('success');
      setForm(emptyForm);
      setTouched(false);
      setDuplicateWarning(false);
    } catch {
      await enqueueForRetry(payload);
      setStatus('queued');
      setForm(emptyForm);
      setTouched(false);
      setDuplicateWarning(false);
      refreshQueuedCount();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5 p-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('newJob.title')}</h1>

      {queuedCount > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('newJob.queuedCount', { count: queuedCount })}
        </p>
      )}

      <PhotoCapture label={t('newJob.platePhoto')} photo={form.platePhoto} busy={ocrBusy.plate} onCapture={(b) => void handlePlateCapture(b)} />
      <PhotoCapture label={t('newJob.vinPhoto')} photo={form.vinPhoto} busy={ocrBusy.vin} onCapture={(b) => void handleVinCapture(b)} />

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">{t('newJob.plate')}</label>
        <input
          value={form.plate}
          onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value.toUpperCase() }))}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base uppercase"
        />
        {touched && form.plate && !plateValid && <p className="mt-1 text-xs text-amber-700">{t('newJob.plateInvalid')}</p>}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">{t('newJob.vin')}</label>
        <input
          value={form.vin}
          maxLength={17}
          onChange={(e) => setForm((f) => ({ ...f, vin: e.target.value.toUpperCase() }))}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base uppercase"
        />
        {touched && form.vin && !vinFormatValid && <p className="mt-1 text-xs text-red-600">{t('newJob.vinInvalid')}</p>}
        {vinFormatValid && !vinChecksumOk && <p className="mt-1 text-xs text-amber-700">{t('newJob.vinChecksumWarning')}</p>}
        {duplicateWarning && <p className="mt-1 text-xs text-amber-700">{t('newJob.duplicateWarning')}</p>}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">{t('newJob.brand')}</label>
        <input
          value={form.brand}
          onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
        />
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">{t('newJob.services')}</p>
        <ServiceChips services={services} selected={form.selectedServices} onToggle={toggleService} />
        {touched && form.selectedServices.length === 0 && (
          <p className="mt-1 text-xs text-red-600">{t('newJob.serviceRequired')}</p>
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">{t('newJob.note')}</label>
        <textarea
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          rows={3}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
        />
      </div>

      {touched && !form.platePhoto && !form.vinPhoto && <p className="text-xs text-red-600">{t('newJob.photosRequired')}</p>}
      {status === 'success' && <p className="text-sm font-medium text-emerald-700">{t('newJob.submitted')} — {t('newJob.editWindow')}</p>}
      {status === 'queued' && <p className="text-sm font-medium text-amber-700">{t('newJob.queuedOffline')}</p>}

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={submitting}
        className="w-full rounded-lg bg-brand-600 py-3 font-medium text-white disabled:opacity-60"
      >
        {submitting ? t('newJob.submitting') : t('newJob.submit')}
      </button>
    </div>
  );
}
