import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { Service } from '../lib/types';
import { isValidPlate, isValidVinFormat, vinChecksumValid, guessBrandFromVin } from '../lib/vin';
import { ocrPhoto, type OcrReason } from '../lib/workerApi';
import { submitJob, findRecentDuplicate, MAX_EXTRA_PHOTOS } from '../lib/jobs';
import { enqueueForRetry } from '../lib/offlineQueue';
import PhotoCapture from '../components/PhotoCapture';
import ServiceChips from '../components/ServiceChips';
import Icon from '../components/Icon';
import { Button, Field, FieldNotice, Group, Page, Skeleton, fieldClass, fieldErrorClass } from '../components/ui';
import { PAGE_WIDTH } from '../lib/pageWidth';

const emptyForm = {
  plate: '',
  vin: '',
  brand: '',
  note: '',
  serviceId: null as string | null,
  platePhoto: null as Blob | null,
  vinPhoto: null as Blob | null,
  /** Optional, up to MAX_EXTRA_PHOTOS. Order here is the extra_1..3 order. */
  extraPhotos: [] as Blob[],
};

/** How long the "job submitted" confirmation stays up before it self-clears. */
const SUCCESS_TTL_MS = 8000;

type ProblemId = 'platePhoto' | 'vinPhoto' | 'plate' | 'vin' | 'service';

function scrollTo(el: HTMLElement | null) {
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
}

export default function NewJob() {
  const { t } = useTranslation();
  const { appUser } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [ocrBusy, setOcrBusy] = useState<{ plate: boolean; vin: boolean }>({ plate: false, vin: false });
  const [ocrIssue, setOcrIssue] = useState<{ plate: OcrReason | null; vin: OcrReason | null }>({ plate: null, vin: null });
  const [autoFilled, setAutoFilled] = useState<{ plate: boolean; vin: boolean }>({ plate: false, vin: false });
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'queued'>('idle');
  const [lastPlate, setLastPlate] = useState('');
  const [attempted, setAttempted] = useState(false);

  const plateInputRef = useRef<HTMLInputElement>(null);
  const vinInputRef = useRef<HTMLInputElement>(null);
  const platePhotoRef = useRef<HTMLDivElement>(null);
  const vinPhotoRef = useRef<HTMLDivElement>(null);
  const servicesRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase
      .from('services')
      .select('*')
      .eq('active', true)
      .order('sort_order')
      .then(({ data }) => {
        setServices(data ?? []);
        setServicesLoading(false);
      });
  }, []);

  /**
   * The confirmation must never outlive the car it refers to. It clears on a
   * timer AND on the first touch of the next car's form — a stale "Job
   * submitted" banner sitting above a half-filled form is the most direct
   * route to a duplicate or a skipped submission.
   */
  useEffect(() => {
    if (status === 'idle') return;
    const timer = setTimeout(() => setStatus('idle'), SUCCESS_TTL_MS);
    return () => clearTimeout(timer);
  }, [status]);

  function beginNextCar() {
    setStatus((s) => (s === 'idle' ? s : 'idle'));
  }

  async function handlePlateCapture(blob: Blob) {
    beginNextCar();
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
    beginNextCar();
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

  function addExtraPhoto(blob: Blob) {
    beginNextCar();
    setForm((f) =>
      f.extraPhotos.length >= MAX_EXTRA_PHOTOS ? f : { ...f, extraPhotos: [...f.extraPhotos, blob] },
    );
  }

  function replaceExtraPhoto(index: number, blob: Blob) {
    beginNextCar();
    setForm((f) => ({ ...f, extraPhotos: f.extraPhotos.map((b, i) => (i === index ? blob : b)) }));
  }

  /* Removing closes the gap rather than leaving a hole: the slots are numbered
     extra_1..3 by position, so a kept photo must never sit in slot 3 with 1 and
     2 empty. */
  function removeExtraPhoto(index: number) {
    beginNextCar();
    setForm((f) => ({ ...f, extraPhotos: f.extraPhotos.filter((_, i) => i !== index) }));
  }

  function selectService(id: string) {
    beginNextCar();
    setForm((f) => ({ ...f, serviceId: id }));
  }

  const plateValid = form.plate.length > 0 && isValidPlate(form.plate);
  const vinFormatValid = isValidVinFormat(form.vin);
  const vinChecksumOk = form.vin ? vinChecksumValid(form.vin) : true;

  /**
   * Everything standing between this car and a submitted record, in the order
   * the worker meets it on screen. Tapping Submit with any of these open used
   * to set a flag and return silently, leaving the primary button looking live
   * and doing nothing — the single worst failure this screen had.
   */
  const problems: { id: ProblemId; label: string; focus: () => void }[] = [];
  if (!form.platePhoto)
    problems.push({ id: 'platePhoto', label: t('newJob.needPlatePhoto'), focus: () => scrollTo(platePhotoRef.current) });
  if (!form.vinPhoto)
    problems.push({ id: 'vinPhoto', label: t('newJob.needVinPhoto'), focus: () => scrollTo(vinPhotoRef.current) });
  if (!plateValid)
    problems.push({
      id: 'plate',
      label: t('newJob.needPlate'),
      focus: () => {
        scrollTo(plateInputRef.current);
        plateInputRef.current?.focus();
      },
    });
  if (!vinFormatValid)
    problems.push({
      id: 'vin',
      label: t('newJob.needVin'),
      focus: () => {
        scrollTo(vinInputRef.current);
        vinInputRef.current?.focus();
      },
    });
  if (!form.serviceId)
    problems.push({ id: 'service', label: t('newJob.needService'), focus: () => scrollTo(servicesRef.current) });

  const showProblems = attempted && problems.length > 0;

  async function handleSubmit() {
    setAttempted(true);
    if (problems.length > 0) {
      // Never a silent no-op: jump to the first thing that needs fixing. The
      // list itself is pinned to the submit bar, so it is on screen already.
      problems[0].focus();
      return;
    }
    if (!appUser?.site_id || submitting) return;

    setSubmitting(true);
    const plate = form.plate;
    const payload = {
      siteId: appUser.site_id,
      workerId: appUser.id,
      plate: form.plate,
      vin: form.vin,
      brand: form.brand || null,
      workerNote: form.note || null,
      serviceId: form.serviceId!,
      plateBlob: form.platePhoto!,
      vinBlob: form.vinPhoto!,
      extraBlobs: form.extraPhotos,
    };

    const resetForm = () => {
      setForm(emptyForm);
      setAttempted(false);
      setDuplicateWarning(false);
      setAutoFilled({ plate: false, vin: false });
      setOcrIssue({ plate: null, vin: null });
      setLastPlate(plate);
      scrollTo(topRef.current);
    };

    try {
      await submitJob(payload);
      resetForm();
      setStatus('success');
    } catch {
      await enqueueForRetry(payload);
      resetForm();
      setStatus('queued');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Page width="form">
        <div ref={topRef} />

        <h1 className="text-xl font-semibold tracking-tight text-ink-900">{t('newJob.title')}</h1>

        {/* Outcome of the PREVIOUS car. Full-width, named by plate, and gone
            the moment this car's entry starts. */}
        {status !== 'idle' && (
          <div
            role="status"
            aria-live="polite"
            className={`flex items-start gap-3 rounded-xl border-2 p-4 ${
              status === 'success' ? 'border-ok-600 bg-ok-50 text-ok-700' : 'border-ink-900 bg-ink-900 text-surface'
            }`}
          >
            <Icon name={status === 'success' ? 'checkCircle' : 'sync'} size={24} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold">
                {status === 'success' ? t('newJob.submitted') : t('queue.title')}
              </p>
              <p className="mt-0.5 text-sm font-medium">
                {status === 'success'
                  ? `${t('newJob.submittedPlate', { plate: lastPlate })} ${t('newJob.editWindow')}`
                  : t('newJob.queuedOffline')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStatus('idle')}
              aria-label={t('newJob.dismiss')}
              className="-m-1 inline-flex size-tap shrink-0 items-center justify-center rounded-lg"
            >
              <Icon name="x" size={20} />
            </button>
          </div>
        )}

        {/* Group 1 — what you photograph. */}
        <Group>
          <div className="grid grid-cols-2 gap-3">
            <div ref={platePhotoRef}>
              <PhotoCapture
                label={t('newJob.platePhoto')}
                photo={form.platePhoto}
                busy={ocrBusy.plate}
                error={ocrIssue.plate ? t(`newJob.ocrReasons.${ocrIssue.plate}`) : null}
                onCapture={(b) => void handlePlateCapture(b)}
                onTypeItIn={() => plateInputRef.current?.focus()}
              />
            </div>
            <div ref={vinPhotoRef}>
              <PhotoCapture
                label={t('newJob.vinPhoto')}
                photo={form.vinPhoto}
                busy={ocrBusy.vin}
                error={ocrIssue.vin ? t(`newJob.ocrReasons.${ocrIssue.vin}`) : null}
                onCapture={(b) => void handleVinCapture(b)}
                onTypeItIn={() => vinInputRef.current?.focus()}
              />
            </div>
          </div>

          {/* Optional, and stated as such before the required fields below it —
              a worker scanning down the form must not stop here thinking there
              is something else to take. */}
          <section aria-labelledby="extra-photos-heading">
            <h2 id="extra-photos-heading" className="text-sm font-semibold text-ink-900">
              {t('newJob.extraPhotos')}
              <span className="ms-2 font-medium text-ink-500">{t('common.optional')}</span>
            </h2>
            <p className="mt-0.5 text-xs text-ink-600">
              {t('newJob.extraPhotosHint', { count: MAX_EXTRA_PHOTOS })}
            </p>

            <div className="mt-2 grid grid-cols-2 gap-3">
              {form.extraPhotos.map((blob, i) => (
                <PhotoCapture
                  key={i}
                  label={t('newJob.extraPhoto', { n: i + 1 })}
                  photo={blob}
                  onCapture={(b) => replaceExtraPhoto(i, b)}
                  onRemove={() => removeExtraPhoto(i)}
                />
              ))}
              {form.extraPhotos.length < MAX_EXTRA_PHOTOS && (
                <PhotoCapture
                  label={t('newJob.addExtraPhoto')}
                  photo={null}
                  onCapture={addExtraPhoto}
                />
              )}
            </div>
          </section>
        </Group>

        {/* Group 2 — which car it is. */}
        <Group>

          <Field
            htmlFor="job-plate"
            label={t('newJob.plate')}
            hint={
              autoFilled.plate && (
                <span className="inline-flex items-center gap-1 font-medium normal-case tracking-normal text-ok-700">
                  <Icon name="check" size={14} />
                  {t('newJob.autoFilled')}
                </span>
              )
            }
            error={attempted && !plateValid && form.plate ? t('newJob.plateInvalid') : undefined}
          >
            <input
              id="job-plate"
              ref={plateInputRef}
              value={form.plate}
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                beginNextCar();
                setForm((f) => ({ ...f, plate: e.target.value.toUpperCase() }));
                setAutoFilled((a) => ({ ...a, plate: false }));
              }}
              className={`${fieldClass} font-mono tracking-wider uppercase ${
                attempted && !plateValid ? fieldErrorClass : ''
              }`}
            />
          </Field>

          <Field
            htmlFor="job-vin"
            label={t('newJob.vin')}
            hint={
              autoFilled.vin && (
                <span className="inline-flex items-center gap-1 font-medium normal-case tracking-normal text-ok-700">
                  <Icon name="check" size={14} />
                  {t('newJob.autoFilled')}
                </span>
              )
            }
            error={attempted && !vinFormatValid && form.vin ? t('newJob.vinInvalid') : undefined}
          >
            <input
              id="job-vin"
              ref={vinInputRef}
              value={form.vin}
              maxLength={17}
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                beginNextCar();
                setForm((f) => ({ ...f, vin: e.target.value.toUpperCase() }));
                setAutoFilled((a) => ({ ...a, vin: false }));
              }}
              className={`${fieldClass} font-mono tracking-wider uppercase ${
                attempted && !vinFormatValid ? fieldErrorClass : ''
              }`}
            />
            {/* Advisory only. An imported vehicle can legitimately fail the
                checksum, so this warns and never blocks. */}
            {vinFormatValid && !vinChecksumOk && <FieldNotice>{t('newJob.vinChecksumWarning')}</FieldNotice>}
            {duplicateWarning && <FieldNotice icon="alertCircle">{t('newJob.duplicateWarning')}</FieldNotice>}
          </Field>

          <Field htmlFor="job-brand" label={t('newJob.brand')} optional>
            <input
              id="job-brand"
              value={form.brand}
              onChange={(e) => {
                beginNextCar();
                setForm((f) => ({ ...f, brand: e.target.value }));
              }}
              className={fieldClass}
            />
          </Field>
        </Group>

        {/* Group 3 — what was done to it. */}
        <Group>
          <div ref={servicesRef}>
            <Field
              label={t('newJob.service')}
              error={attempted && !form.serviceId ? t('newJob.serviceRequired') : undefined}
            >
              {servicesLoading ? (
                <div className="flex flex-wrap gap-2" aria-hidden>
                  <Skeleton className="h-control w-28" />
                  <Skeleton className="h-control w-36" />
                  <Skeleton className="h-control w-24" />
                </div>
              ) : (
                /* No "n selected" hint any more — with one choice the filled chip
                   already says everything the count used to. */
                <ServiceChips
                  services={services}
                  selected={form.serviceId}
                  onSelect={selectService}
                  label={t('newJob.service')}
                />
              )}
            </Field>
          </div>

          <Field htmlFor="job-note" label={t('newJob.note')} optional>
            <textarea
              id="job-note"
              value={form.note}
              onChange={(e) => {
                beginNextCar();
                setForm((f) => ({ ...f, note: e.target.value }));
              }}
              rows={3}
              className="w-full rounded-lg border border-line-strong bg-surface px-3.5 py-3 text-base text-ink-900 focus:border-ink-900"
            />
          </Field>
        </Group>
      </Page>

      {/*
        Submit is pinned above the tab bar rather than parked at the end of the
        form. Two things follow from that, both of them the point:
          - the service catalog is manager-editable and uncapped, so a growing
            chip list can no longer push the primary action off screen
          - the "what's missing" list rides with the button, so tapping Submit
            can never produce nothing visible.
        No extra tap is introduced: the button is in the same place, only
        always reachable.
      */}
      <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 border-t border-line bg-surface px-4 py-3 shadow-bar md:bottom-0">
        {/* Same source as the page column, so the bar can never drift from it. */}
        <div className={`mx-auto w-full ${PAGE_WIDTH.form}`}>
          {showProblems && (
            <div
              id="submit-problems"
              role="alert"
              className="mb-3 rounded-lg border border-danger-200 bg-danger-50 p-3"
            >
              <p className="flex items-start gap-2 text-sm font-bold text-danger-700">
                <Icon name="alertCircle" size={18} className="mt-px shrink-0" />
                <span>{t('newJob.fixTitle', { count: problems.length })}</span>
              </p>
              <ul className="mt-2 space-y-1">
                {problems.map((problem) => (
                  <li key={problem.id}>
                    <button
                      type="button"
                      onClick={problem.focus}
                      className="flex min-h-tap w-full items-center gap-2 rounded-md px-1 text-start text-sm font-semibold text-danger-700 underline underline-offset-2"
                    >
                      <Icon name="chevronRight" size={16} className="shrink-0" />
                      {problem.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button
            size="lg"
            block
            busy={submitting}
            onClick={() => void handleSubmit()}
            aria-describedby={showProblems ? 'submit-problems' : undefined}
          >
            {submitting ? t('newJob.submitting') : t('newJob.submit')}
          </Button>
        </div>
      </div>
    </>
  );
}
