import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import type { PreviousJob, Service } from '../lib/types';
import { describePreviousJob } from '../components/previousJob';
import { isValidPlate, stripPlate, isValidVinFormat, vinChecksumValid } from '../lib/vin';
import { ocrPhoto, type OcrReason } from '../lib/workerApi';
import { findPreviousJob, InvalidJobError, MAX_EXTRA_PHOTOS, serviceTotal, type NewJobPayload } from '../lib/jobs';
import { formatMoney } from '../components/money';
import { cleanWorkerLabel, MAX_WORKER_LABEL, isStaffSubmitter, jobOwnership, jobSiteId, migrateDraft, pickableWorkers, siteAcceptsJobs, siteRules, toggleId, vehicleProblems, workerNamed } from './workerJobs';
import { sendJob as sendJobAndVideo } from '../lib/sendJob';
import { pickableSites, useSiteScope } from '../lib/useSiteScope';
import { useStaff } from '../lib/useStaff';
import { clearDraft, loadDraft, saveDraft } from '../lib/draft';
import { bumpService, pushBrand, pushWorkerLabel, recentBrands, recentWorkerLabels, serviceUseCounts } from '../lib/recent';
import PhotoCapture from '../components/PhotoCapture';
import VideoRecorder from '../components/VideoRecorder';
import ServiceChips from '../components/ServiceChips';
import CoworkerPicker from '../components/CoworkerPicker';
import WorkerPicker from '../components/WorkerPicker';
import QueuedJobs from '../components/QueuedJobs';
import Icon from '../components/Icon';
import {
  Button,
  ConfirmPanel,
  Field,
  FieldNotice,
  Group,
  Page,
  PageHeading,
  Select,
  Skeleton,
  fieldClass,
  fieldErrorClass,
} from '../components/ui';
import { PAGE_WIDTH } from '../lib/pageWidth';

const emptyForm = {
  plate: '',
  vin: '',
  brand: '',
  note: '',
  /** At least one is required (0033). */
  serviceIds: [] as string[],
  platePhoto: null as Blob | null,
  vinPhoto: null as Blob | null,
  /** Optional, up to MAX_EXTRA_PHOTOS. Order here is the extra_1..5 order. */
  extraPhotos: [] as Blob[],
  /** Optional walkaround of the finished car — see VideoRecorder. */
  video: null as Blob | null,
  /** `null` = the submitter's own site. Reset after every car, so a worker who
      helped at another yard once doesn't keep logging there by accident. */
  siteId: null as string | null,
  coworkerIds: [] as string[],
  /** Manager/admin only (0040): the worker picked, or else `workerLabel`, a typed name. Never both. */
  workerId: '',
  workerLabel: '',
};



/** How long the "job submitted" confirmation stays up before it self-clears. */
const SUCCESS_TTL_MS = 8000;

type ProblemId = 'worker' | 'vinPhoto' | 'plate' | 'vin' | 'service' | 'site';

function formIsEmpty(f: typeof emptyForm) {
  return (
    !f.plate && !f.vin && !f.brand && !f.note && f.serviceIds.length === 0 && !f.platePhoto && !f.vinPhoto &&
    !f.video && f.extraPhotos.length === 0 && f.coworkerIds.length === 0 && !f.workerId && !f.workerLabel
  );
}

function scrollTo(el: HTMLElement | null) {
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
}

export default function NewJob() {
  const { t, i18n } = useTranslation();
  const { appUser } = useAuth();
  const { sites, siteId: scopeSiteId } = useSiteScope();
  const staff = useStaff();
  const isStaff = isStaffSubmitter(appUser?.role);
  const isManager = appUser?.role === 'manager';
  const [services, setServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [ocrBusy, setOcrBusy] = useState<{ plate: boolean; vin: boolean }>({ plate: false, vin: false });
  const [ocrIssue, setOcrIssue] = useState<{ plate: OcrReason | null; vin: OcrReason | null }>({ plate: null, vin: null });
  const [autoFilled, setAutoFilled] = useState<{ plate: boolean; vin: boolean }>({ plate: false, vin: false });
  /* The most recent earlier job for this plate or VIN (any site, any time, any
     service): date, site and service only. Warn-only, never blocks. */
  const [previous, setPrevious] = useState<PreviousJob | null>(null);
  /* Set while the Submit confirmation is up (the same earlier job, re-checked at submit). */
  const [confirming, setConfirming] = useState<PreviousJob | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'queued' | 'failed'>('idle');
  const [lastIdentifier, setLastIdentifier] = useState('');
  /* The last car's id when it went in, for a manager/admin's "Open job" link (they have no My Jobs). */
  const [lastJobId, setLastJobId] = useState<string | null>(null);
  /* Who a manager/admin's last car was logged for, named on the banner. */
  const [lastFor, setLastFor] = useState('');
  /* The last car's video went to the background queue: one more line on the success banner. */
  const [videoQueued, setVideoQueued] = useState(false);
  /* The video could be neither kept nor sent: 'sent' = the job is in ('failed' banner, own message);
     'queued' = the job is saved on the phone without it. */
  const [videoLost, setVideoLost] = useState<'sent' | 'queued' | null>(null);
  const [attempted, setAttempted] = useState(false);

  const plateInputRef = useRef<HTMLInputElement>(null);
  const vinInputRef = useRef<HTMLInputElement>(null);
  const platePhotoRef = useRef<HTMLDivElement>(null);
  const vinPhotoRef = useRef<HTMLDivElement>(null);
  const servicesRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  /* Put back whatever was in the form when the page last went away (a camera
     round-trip that reloaded the tab, or a visit to another screen). Saving
     waits for this, or the empty first render would overwrite the draft. */
  const [draftReady, setDraftReady] = useState(false);
  useEffect(() => {
    void loadDraft<typeof emptyForm>().then((d) => {
      if (d) setForm({ ...emptyForm, ...migrateDraft<typeof emptyForm>(d) });
      setDraftReady(true);
    });
  }, []);
  useEffect(() => {
    if (!draftReady) return;
    const id = setTimeout(() => void (formIsEmpty(form) ? clearDraft() : saveDraft(form)), 400);
    return () => clearTimeout(id);
  }, [form, draftReady]);

  /* Most-used first, but never pre-selected: a silent default is how a wrong
     service gets submitted. Ties keep the catalog's own order (sort is stable). */
  const orderedServices = useMemo(() => {
    const counts = serviceUseCounts();
    return [...services].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
  }, [services]);
  const brandSuggestions = recentBrands();
  const labelSuggestions = isStaff ? recentWorkerLabels() : [];
  const workers = appUser && isStaff ? pickableWorkers(staff, appUser) : [];
  /* A restored draft can name someone no longer offered (deactivated, moved
     site): dropped once the staff list is in, like a retired service below. */
  const workerId = staff.length > 0 && !workers.some((w) => w.id === form.workerId) ? '' : form.workerId;
  const pickedWorker = workers.find((w) => w.id === workerId);
  /* A typed name that is really someone with an account: offer to pick them, so their pay lands. */
  const typedMatch = !workerId ? workerNamed(workers, form.workerLabel) : undefined;
  /* An admin picks from every site, so each name carries its site; a manager's are all one site. */
  const pickerWorkers = appUser?.role === 'admin'
    ? workers.map((w) => ({ id: w.id, name: [w.name, sites.find((x) => x.id === w.site_id)?.name].filter(Boolean).join(' · ') }))
    : workers;

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

    /** The confirmation clears on a timer and on the next car's first touch, so a stale banner never sits above a half-filled form. */
  useEffect(() => {
    if (status === 'idle') return;
    const timer = setTimeout(() => setStatus('idle'), SUCCESS_TTL_MS);
    return () => clearTimeout(timer);
  }, [status]);

  function beginNextCar() {
    setStatus((s) => (s === 'idle' ? s : 'idle'));
  }

  // `original` is the un-downscaled capture: only the stored/uploaded photo is
  // shrunk, OCR reads the full-resolution pixels.
  async function handlePlateCapture(blob: Blob, original: Blob) {
    beginNextCar();
    setForm((f) => ({ ...f, platePhoto: blob }));
    setOcrBusy((b) => ({ ...b, plate: true }));
    setOcrIssue((i) => ({ ...i, plate: null }));
    setAutoFilled((a) => ({ ...a, plate: false }));
    const { text, reason } = await ocrPhoto(original, 'plate');
    setOcrBusy((b) => ({ ...b, plate: false }));
    if (text) {
      setForm((f) => ({ ...f, plate: text }));
      setAutoFilled((a) => ({ ...a, plate: true }));
    } else if (reason) {
      setOcrIssue((i) => ({ ...i, plate: reason }));
    }
  }

  async function handleVinCapture(blob: Blob, original: Blob) {
    beginNextCar();
    setForm((f) => ({ ...f, vinPhoto: blob }));
    setOcrBusy((b) => ({ ...b, vin: true }));
    setOcrIssue((i) => ({ ...i, vin: null }));
    setAutoFilled((a) => ({ ...a, vin: false }));
    const { text, reason } = await ocrPhoto(original, 'vin');
    setOcrBusy((b) => ({ ...b, vin: false }));
    if (text) {
            /* Only the VIN is filled in. The brand is not derived from it: a WMI prefix
               names a manufacturer, not the car, and a guess looks like a real read. */
      setForm((f) => ({ ...f, vin: text }));
      setAutoFilled((a) => ({ ...a, vin: true }));
    } else if (reason) {
      setOcrIssue((i) => ({ ...i, vin: reason }));
    }
  }

  /* Clears the OCR state with it: a "couldn't read it" hint left standing over
     an empty slot describes a photo that is no longer there. */
  function removeVinPhoto() {
    beginNextCar();
    setForm((f) => ({ ...f, vinPhoto: null }));
    setOcrIssue((i) => ({ ...i, vin: null }));
  }

  function removePlatePhoto() {
    beginNextCar();
    setForm((f) => ({ ...f, platePhoto: null }));
    setOcrIssue((i) => ({ ...i, plate: null }));
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
     extra_1..5 by position, so a kept photo must never sit in slot 3 with 1 and
     2 empty. */
  function removeExtraPhoto(index: number) {
    beginNextCar();
    setForm((f) => ({ ...f, extraPhotos: f.extraPhotos.filter((_, i) => i !== index) }));
  }

  function selectSite(id: string) {
    beginNextCar();
    setForm((f) => ({ ...f, siteId: id }));
  }

  /* Picking a worker drops a typed name and vice versa: the job has one or the other.
     The picked worker can't also be their own co-worker. */
  function pickWorker(id: string) {
    beginNextCar();
    setForm((f) => ({
      ...f,
      workerId: id,
      workerLabel: id ? '' : f.workerLabel,
      coworkerIds: f.coworkerIds.filter((c) => c !== id),
    }));
  }

  /* Every way a name gets in (typing, pasting, a chip, the picker's "use" row)
     comes through here, so the field never holds what the database refuses. */
  function typeWorkerLabel(raw: string) {
    beginNextCar();
    const label = cleanWorkerLabel(raw, { typing: true });
    setForm((f) => ({ ...f, workerLabel: label, workerId: label ? '' : f.workerId }));
  }

  function toggleService(id: string) {
    beginNextCar();
    setForm((f) => ({ ...f, serviceIds: toggleId(f.serviceIds, id) }));
  }

  const siteId = appUser ? jobSiteId(appUser, form.siteId, scopeSiteId, pickedWorker?.site_id ?? null, sites) : null;

  /* A restored draft can name a service retired since: no chip to untick it, so
     it is dropped here. Not before the catalog loads, nor if it came back empty
     (offline), or every pick would vanish with the signal. */
  const serviceIds = services.length
    ? form.serviceIds.filter((id) => services.some((s) => s.id === id))
    : form.serviceIds;

  /* Look for an earlier job as soon as the plate or VIN is complete enough to be
     one, typed or read from a photo. Debounced; offline or any failure is simply
     "no warning" (the database flags the job on insert regardless). */
  const lookupPlate = isValidPlate(form.plate) ? form.plate : '';
  const lookupVin = isValidVinFormat(form.vin) ? form.vin : '';
  useEffect(() => {
    setConfirming(null); // a pending confirmation described the car as it was
    if (!lookupPlate && !lookupVin) {
      setPrevious(null);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      void findPreviousJob({ plate: lookupPlate, vin: lookupVin }).then((found) => live && setPrevious(found));
    }, 400);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [lookupPlate, lookupVin]);

  /* What the job's site requires (0042), from the site the job will go to:
     switching site or worker re-reads it. Defaults: VIN required, plate optional. */
  const rules = siteRules(sites, siteId);
  const { vinRequired, plateRequired } = rules;
  /* The car's identity under those rules (vehicleProblems): a required field
     left empty or a typed one malformed blocks; a failed check digit only
     warns (vinChecksumOk). */
  const vehicle = vehicleProblems({ plate: form.plate, vin: form.vin, vinPhoto: Boolean(form.vinPhoto) }, rules);
  const plateIssue = vehicle.find((p) => p === 'plateRequired' || p === 'plateInvalid');
  const vinIssue = vehicle.find((p) => p === 'vinRequired' || p === 'vinInvalid');
  const neitherId = vehicle.includes('plateOrVinRequired');
  const vinPhotoMissing = vehicle.includes('vinPhotoRequired');
  const vinChecksumOk = form.vin ? vinChecksumValid(form.vin) : true;

    /** Everything blocking submission, in on-screen order, so Submit never silently does nothing. */
  const problems: { id: ProblemId; label: string; focus: () => void }[] = [];
  const workerMissing = isStaff && !workerId && !cleanWorkerLabel(form.workerLabel);
  if (workerMissing)
    problems.push({
      id: 'worker',
      label: t('newJob.workerRequired'),
      focus: () => {
        scrollTo(workerRef.current);
        workerRef.current?.querySelector('input')?.focus();
      },
    });
  // The VIN photo is the record of what was read: required wherever the VIN is. Plate photo stays optional.
  if (vinPhotoMissing)
    problems.push({
      id: 'vinPhoto',
      label: t('newJob.vinPhotoRequired'),
      focus: () => {
        scrollTo(vinPhotoRef.current);
        vinPhotoRef.current?.querySelector('button')?.focus();
      },
    });
  if (plateIssue)
    problems.push({
      id: 'plate',
      label: t(`newJob.${plateIssue}`),
      focus: () => {
        scrollTo(plateInputRef.current);
        plateInputRef.current?.focus();
      },
    });
  if (vinIssue)
    problems.push({
      id: 'vin',
      label: t(`newJob.${vinIssue}`),
      focus: () => {
        scrollTo(vinInputRef.current);
        vinInputRef.current?.focus();
      },
    });
  // Both optional here: still one of them (jobs_plate_or_vin_chk).
  if (neitherId)
    problems.push({
      id: 'vin',
      label: t('newJob.plateOrVinRequired'),
      focus: () => {
        scrollTo(plateInputRef.current);
        plateInputRef.current?.focus();
      },
    });
  if (serviceIds.length === 0)
    problems.push({ id: 'service', label: t('newJob.needService'), focus: () => scrollTo(servicesRef.current) });
  /* An admin with no home site and nothing picked yet: say so rather than doing nothing.
     A site an admin has disabled (0041) is refused by the database; say so here. */
  const siteOk = siteAcceptsJobs(sites, siteId);
  if (!siteId || !siteOk)
    problems.push({
      id: 'site',
      label: t(siteId ? 'newJob.siteDisabled' : 'newJob.siteRequired'),
      focus: () => {
        if (detailsRef.current) detailsRef.current.open = true;
        const select = document.getElementById('job-site');
        scrollTo(select);
        select?.focus();
      },
    });

  const showProblems = attempted && problems.length > 0;

  async function handleSubmit() {
    setAttempted(true);
    if (problems.length > 0) {
      // Never a silent no-op: jump to the first thing that needs fixing. The
      // list itself is pinned to the submit bar, so it is on screen already.
      problems[0].focus();
      return;
    }
    if (!appUser || !siteId || submitting) return;

    /* One more look at submit, so a car logged since the notice appeared is still
       caught. Found: ask once and let the worker decide; never refuse. */
    setSubmitting(true);
    // Never let a weak signal hold the submit: after 3s, treat it as no warning.
    const earlier = await Promise.race([
      findPreviousJob({ plate: form.plate, vin: form.vin }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    setSubmitting(false);
    if (earlier) {
      setConfirming(earlier);
      requestAnimationFrame(() => confirmRef.current?.focus());
      return;
    }
    await sendJob();
  }

  async function sendJob() {
    if (!appUser || !siteId || submitting) return;
    setConfirming(null);
    /* Re-checked here: the form stays editable while the duplicate notice is
       up, so "Submit anyway" may come after the VIN or its photo was cleared. */
    if (problems.length > 0) {
      setAttempted(true);
      problems[0].focus();
      return;
    }
    setSubmitting(true);
    // The plate if there is one, else the VIN (one of them is always set: the
    // form requires it), identifies the car in the confirmation message below.
    const identifier = form.plate || form.vin;
    const owner = jobOwnership(appUser, { workerId, workerLabel: form.workerLabel });
    const payload: NewJobPayload = {
      siteId,
      ...owner,
      coworkerIds: form.coworkerIds,
      // An empty plate means "no plate" and is stored as NULL, never ''.
      plate: form.plate || null,
      // Likewise an empty VIN (where the site allows it) is NULL.
      vin: form.vin.trim() || null,
      brand: form.brand.trim() || null,
      workerNote: form.note.trim() || null,
      serviceIds,
      plateBlob: form.platePhoto,
      vinBlob: form.vinPhoto,
      extraBlobs: form.extraPhotos,
    };
    // Sent after the job, from the queue, so Submit never waits on the video.
    const video = form.video;

    serviceIds.forEach((id) => bumpService(id));
    pushBrand(form.brand);
    if (owner.workerLabel) pushWorkerLabel(owner.workerLabel);
    const loggedFor = owner.workerLabel ?? pickedWorker?.name ?? '';

    const resetForm = () => {
      void clearDraft();
      setForm(emptyForm);
      setAttempted(false);
      setPrevious(null);
      setConfirming(null);
      setAutoFilled({ plate: false, vin: false });
      setOcrIssue({ plate: null, vin: null });
      setLastIdentifier(identifier);
      setLastFor(loggedFor);
      scrollTo(topRef.current);
    };

    try {
      const outcome = await sendJobAndVideo(payload, video);
      // The job is in, or on the phone, either way: keeping the form would submit the car twice.
      setVideoQueued(outcome === 'success-video-queued');
      setVideoLost(
        outcome === 'video-not-saved'
          ? 'sent'
          : outcome === 'queued-video-not-saved' || outcome === 'failed-video-not-saved'
            ? 'queued'
            : null,
      );
      resetForm();
      // Set by submitJob once the row exists; a queued job has none yet.
      setLastJobId(outcome === 'success' || outcome === 'success-video-queued' ? payload.jobId ?? null : null);
      setStatus(
        outcome === 'success' || outcome === 'success-video-queued'
          ? 'success'
          : outcome === 'queued-for-retry' || outcome === 'queued-video-not-saved'
            ? 'queued'
            : 'failed',
      );
    } catch (err) {
      // Refused before anything was sent or queued (no plate and no VIN): keep the form and show why.
      if (!(err instanceof InvalidJobError)) throw err;
      setAttempted(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Page width="form">
        <div ref={topRef} />

        {/* This screen used to hand-roll its title one step below every other
            page's, to buy back vertical space on the highest-volume form. The
            page title now steps down on a phone everywhere, so the exception
            has nothing left to do and the shared heading can own it. */}
        <PageHeading>{t('newJob.title')}</PageHeading>

        {/* A manager/admin has no My Jobs: their unsent cars are listed here. */}
        {isStaff && <QueuedJobs />}

        {/* Manager/admin only (0040): whose car this is. A real worker owns it
            (their pay, stats and edit window); a typed name stays with the
            submitter and is shown where the worker's name would be. */}
        {isStaff && (
          <Group>
            <div ref={workerRef}>
              <Field
                htmlFor="job-worker"
                label={t('newJob.worker')}
                required
                hint={<span className="text-ink-500">{t('newJob.workerPickHint')}</span>}
                error={attempted && workerMissing ? t('newJob.workerRequired') : undefined}
              >
                <WorkerPicker
                  id="job-worker"
                  workers={pickerWorkers}
                  value={workerId}
                  onChange={pickWorker}
                  // Nobody by that name: one tap makes it the typed name below.
                  useTerm={{
                    label: (term) => t('newJob.useTypedName', { term }),
                    onUse: (term) => typeWorkerLabel(term),
                  }}
                />
              </Field>
            </div>
            <Field htmlFor="job-worker-label" label={t('newJob.workerTypeName')}>
              <input
                id="job-worker-label"
                value={form.workerLabel}
                maxLength={MAX_WORKER_LABEL}
                autoComplete="off"
                onChange={(e) => typeWorkerLabel(e.target.value)}
                className={`${fieldClass} ${attempted && workerMissing ? fieldErrorClass : ''}`}
              />
              {typedMatch && (
                <button
                  type="button"
                  onClick={() => pickWorker(typedMatch.id)}
                  className="mt-1.5 inline-flex min-h-tap items-center gap-1.5 text-start text-sm font-semibold text-ink-900 underline underline-offset-2"
                >
                  <Icon name="user" size={16} className="shrink-0" />
                  {t('newJob.workerHasAccount', { name: typedMatch.name })}
                </button>
              )}
              {/* Names typed lately on this phone, one tap each. Gone once a worker or name is set. */}
              {!workerId && !form.workerLabel && labelSuggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {labelSuggestions.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => typeWorkerLabel(name)}
                      className="inline-flex min-h-tap items-center rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-ink-900 active:bg-ink-50"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </Field>
          </Group>
        )}

        {/* Group 1 — what you photograph. */}
        <Group>
          <div className="grid grid-cols-2 gap-3">
            <div ref={platePhotoRef}>
              <PhotoCapture
                label={t('newJob.platePhoto')}
                photo={form.platePhoto}
                busy={ocrBusy.plate}
                optional
                error={ocrIssue.plate ? t(`newJob.ocrReasons.${ocrIssue.plate}`) : null}
                onCapture={(b, original) => void handlePlateCapture(b, original)}
                onTypeItIn={() => plateInputRef.current?.focus()}
                onRemove={removePlatePhoto}
              />
            </div>
            <div ref={vinPhotoRef}>
              <PhotoCapture
                label={t('newJob.vinPhoto')}
                photo={form.vinPhoto}
                busy={ocrBusy.vin}
                required={vinRequired}
                optional={!vinRequired}
                missing={attempted && vinPhotoMissing ? t('newJob.vinPhotoRequired') : null}
                error={ocrIssue.vin ? t(`newJob.ocrReasons.${ocrIssue.vin}`) : null}
                onCapture={(b, original) => void handleVinCapture(b, original)}
                onTypeItIn={() => vinInputRef.current?.focus()}
                onRemove={removeVinPhoto}
              />
            </div>
          </div>

          <section aria-label={t('newJob.videoSection')}>
            <div>
              <VideoRecorder
                video={form.video}
                onRecorded={(blob) => {
                  beginNextCar();
                  setForm((f) => ({ ...f, video: blob }));
                }}
                onRemove={() => {
                  beginNextCar();
                  setForm((f) => ({ ...f, video: null }));
                }}
              />
            </div>
          </section>
        </Group>

        {/* Group 2 — which car it is. */}
        <Group>

          <Field
            htmlFor="job-plate"
            label={t('newJob.plate')}
            required={plateRequired}
            optional={!plateRequired}
            hint={
              autoFilled.plate && (
                <span className="inline-flex items-center gap-1 font-medium normal-case tracking-normal text-ok-700">
                  <Icon name="check" size={14} />
                  {t('newJob.autoFilled')}
                </span>
              )
            }
            error={
              !attempted
                ? undefined
                : plateIssue
                  ? t(`newJob.${plateIssue}`)
                  : neitherId
                    ? t('newJob.plateOrVinRequired')
                    : undefined
            }
          >
            <input
              id="job-plate"
              ref={plateInputRef}
              value={form.plate}
              inputMode="numeric"
              maxLength={8}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                beginNextCar();
                // The plate is printed 123-45-678 but stored bare, so the
                // separators are dropped as they are typed or pasted.
                setForm((f) => ({ ...f, plate: stripPlate(e.target.value).slice(0, 8) }));
                setAutoFilled((a) => ({ ...a, plate: false }));
              }}
              className={`${fieldClass} font-mono tracking-wider uppercase ${
                attempted && (plateIssue || neitherId) ? fieldErrorClass : ''
              }`}
            />
          </Field>

          <Field
            htmlFor="job-vin"
            label={t('newJob.vin')}
            required={vinRequired}
            optional={!vinRequired}
            hint={
              autoFilled.vin && (
                <span className="inline-flex items-center gap-1 font-medium normal-case tracking-normal text-ok-700">
                  <Icon name="check" size={14} />
                  {t('newJob.autoFilled')}
                </span>
              )
            }
            error={attempted && vinIssue ? t(`newJob.${vinIssue}`) : undefined}
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
                attempted && vinIssue ? fieldErrorClass : ''
              }`}
            />
            {/* Advisory only. An imported vehicle can legitimately fail the
                checksum, so this warns and never blocks. */}
            {!vinIssue && !vinChecksumOk && <FieldNotice>{t('newJob.vinChecksumWarning')}</FieldNotice>}
          </Field>

          {/* Same plate or VIN seen before, at any site: a heads-up with the date,
              site and service of the latest one. No money, no names. */}
          {previous && (
            <div role="status">
              <FieldNotice icon="alertCircle">{t('newJob.previousJob', describePreviousJob(previous, i18n.language))}</FieldNotice>
            </div>
          )}
        </Group>

        {/* Group 3 — what was done to it. */}
        <Group>
          <div ref={servicesRef}>
            <Field
              label={t('newJob.services')}
              hint={<span className="text-ink-500">{t('newJob.servicesHint')}</span>}
              error={attempted && serviceIds.length === 0 ? t('newJob.serviceRequired') : undefined}
            >
              {servicesLoading ? (
                <div className="flex flex-wrap gap-2" aria-hidden>
                  <Skeleton className="h-control w-28" />
                  <Skeleton className="h-control w-36" />
                  <Skeleton className="h-control w-24" />
                </div>
              ) : (
                <ServiceChips
                  services={orderedServices}
                  selected={serviceIds}
                  onToggle={toggleService}
                  label={t('newJob.services')}
                />
              )}
              {/* Today's catalog price, as the database will snapshot it on
                  insert: the worker sees what the car pays before submitting.
                  Always mounted, so the live region announces the first pick. */}
              <p className="mt-2 text-sm font-medium text-ink-700" aria-live="polite">
                {serviceIds.length > 0 &&
                  [
                    t('newJob.servicesSelected', { count: serviceIds.length }),
                    t('newJob.payTotal', { amount: formatMoney(serviceTotal(services, serviceIds), i18n.language) }),
                    form.coworkerIds.length > 0 && t('newJob.paySplit', { count: form.coworkerIds.length + 1 }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
              </p>
            </Field>
          </div>


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
            {/* The last few makes, one tap each — consecutive cars are often the
                same make. Gone once a brand is set. */}
            {!form.brand && brandSuggestions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {brandSuggestions.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => {
                      beginNextCar();
                      setForm((f) => ({ ...f, brand: b }));
                    }}
                    className="inline-flex min-h-tap items-center rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-ink-900 active:bg-ink-50"
                  >
                    {b}
                  </button>
                ))}
              </div>
            )}
          </Field>
        </Group>

        {/* Everything optional lives behind one row, so the common car is
            photo → plate/VIN → service → Submit without scrolling past
            notes, site and crew. The summary shows what is set inside, so a
            non-default site or a crew is never hidden from the worker. */}
        <details ref={detailsRef} className="group rounded-xl border border-line bg-surface">
          <summary className="flex min-h-control cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-ink-900 [&::-webkit-details-marker]:hidden">
            <span>{t('newJob.moreDetails')}</span>
            <span className="flex min-w-0 items-center gap-2 font-medium text-ink-600">
              <span className="truncate">
                {[
                  sites.find((x) => x.id === siteId)?.name,
                  form.coworkerIds.length > 0 && t('newJob.coworkersCount', { count: form.coworkerIds.length }),
                  form.note && t('newJob.note'),
                  form.extraPhotos.length > 0 && `${t('newJob.extraPhotos')} ${form.extraPhotos.length}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <Icon name="chevronRight" size={16} className="shrink-0 transition-transform group-open:rotate-90 rtl:-scale-x-100" />
            </span>
          </summary>
          <div className="space-y-4 border-t border-line p-4">
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

          <Field htmlFor="job-site" label={t('newJob.site')}>
            {/* A manager logs at their own site only (the database refuses any other). */}
            <Select
              id="job-site"
              value={siteId ?? ''}
              disabled={isManager}
              invalid={attempted && (!siteId || !siteOk)}
              onChange={(e) => selectSite(e.target.value)}
            >
              {!siteId && <option value="" disabled />}
              {/* Enabled sites, plus a disabled one already chosen (draft, home
                  site) so the field shows it next to the problem, not another. */}
              {pickableSites(sites, [siteId]).map((s) => (
                <option key={s.id} value={s.id} disabled={s.active === false}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>

          {appUser && (
            <Field htmlFor="job-coworkers" label={t('coworkers.label')} optional>
              <CoworkerPicker
                id="job-coworkers"
                staff={staff}
                sites={sites}
                value={form.coworkerIds}
                submitterId={workerId || appUser.id}
                onChange={(ids) => {
                  beginNextCar();
                  setForm((f) => ({ ...f, coworkerIds: ids }));
                }}
              />
            </Field>
          )}
          </div>
        </details>
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
      <div className="sticky bottom-0 z-10 border-t border-line bg-surface px-4 py-3 shadow-bar">
        {/* Same source as the page column, so the bar can never drift from it. */}
        <div className={`mx-auto w-full ${PAGE_WIDTH.form}`}>
          {/* Outcome of the PREVIOUS car. Lives right above the button that
              triggers it, so a pass/fail never requires scrolling back up to
              find out which one happened. */}
          {status !== 'idle' && (
            <div
              role="status"
              aria-live="polite"
              className={`mb-3 flex items-start gap-3 rounded-xl border-2 p-4 ${
                status === 'success'
                  ? 'border-ok-600 bg-ok-50 text-ok-700'
                  : status === 'failed'
                    ? 'border-danger-600 bg-danger-50 text-danger-700'
                    : 'border-ink-900 bg-ink-900 text-surface'
              }`}
            >
              <Icon
                name={status === 'success' ? 'checkCircle' : status === 'failed' ? 'alertTriangle' : 'sync'}
                size={24}
                className="mt-0.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold">
                  {status === 'success'
                    ? t('newJob.submitted')
                    : status === 'failed'
                      ? t(videoLost === 'sent' ? 'newJob.submitted' : 'newJob.failedTitle')
                      : t('queue.title')}
                </p>
                <p className="mt-0.5 text-sm font-medium">
                  {status === 'success'
                    ? // Staff can't edit from My Jobs, so no edit-window promise for them.
                      [
                        isStaff && lastFor
                          ? t('newJob.submittedPlateFor', { plate: lastIdentifier, name: lastFor })
                          : t('newJob.submittedPlate', { plate: lastIdentifier }),
                        !isStaff && t('newJob.editWindow'),
                        videoQueued && t('newJob.videoQueued'),
                      ]
                        .filter(Boolean)
                        .join(' ')
                    : status === 'failed'
                      ? videoLost === 'sent'
                        ? t('newJob.videoNotSaved')
                        : `${t('newJob.failedBody')}${videoLost === 'queued' ? ` ${t('newJob.videoNotKept')}` : ''}`
                      : t(videoLost === 'queued' ? 'newJob.queuedVideoNotSaved' : 'newJob.queuedOffline')}
                </p>
                {status === 'success' && (!isStaff || lastJobId) && (
                  <Link
                    to={isStaff ? `/jobs/${lastJobId}` : '/mine'}
                    className="mt-1 inline-flex min-h-tap items-center text-sm font-bold underline underline-offset-2"
                  >
                    {t(isStaff ? 'newJob.openJob' : 'newJob.edit')}
                  </Link>
                )}
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

          {confirming ? (
            <div ref={confirmRef} tabIndex={-1} role="alertdialog" aria-label={t('newJob.duplicateTitle')} className="outline-none">
              <ConfirmPanel
                variant="secondary"
                icon="check"
                question={t('newJob.duplicateConfirm', describePreviousJob(confirming, i18n.language))}
                confirmLabel={t('newJob.submitAnyway')}
                onConfirm={() => void sendJob()}
                onCancel={() => setConfirming(null)}
              />
            </div>
          ) : (
            <Button
              size="lg"
              block
              variant={problems.length > 0 ? 'incomplete' : 'primary'}
              busy={submitting}
              onClick={() => void handleSubmit()}
              aria-describedby={showProblems ? 'submit-problems' : undefined}
            >
              {submitting ? t('newJob.submitting') : t('newJob.submit')}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
