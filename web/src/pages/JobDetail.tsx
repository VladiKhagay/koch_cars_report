import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { fetchDuplicateSummary, saveBilling, setJobServices } from '../lib/jobs';
import { fetchServiceClientPrices, parsePrice } from '../lib/clientPrices';
import { serviceLabel } from '../lib/serviceRows';
import { stripPlate } from '../lib/vin';
import { toLocalInput } from '../lib/formatDate';
import { useSiteScope } from '../lib/useSiteScope';
import { useStaff } from '../lib/useStaff';
import { SERVICE_COLUMNS, type ClientPrices, type Job, type PreviousJob, type Service } from '../lib/types';
import JobMedia from '../components/JobMedia';
import EditHistory from '../components/EditHistory';
import CarassoJobDetail from './CarassoJobDetail';
import { describePreviousJob } from '../components/previousJob';
import { formatMoney } from '../components/money';
import CoworkerPicker from '../components/CoworkerPicker';
import ServiceChips from '../components/ServiceChips';
import {
  lineWrites as planLineWrites,
  missingServices,
  planJobEdit,
  type JobFieldDraft,
  type LineMoney,
} from './jobDetailLines';
import StatusBanner from '../components/StatusBanner';
import Icon from '../components/Icon';
import {
  Button,
  Card,
  ConfirmAction,
  DetailRow,
  EmptyState,
  Field,
  FieldNotice,
  Page,
  SectionHeading,
  Select,
  Skeleton,
  fieldClass,
  fieldErrorClass,
} from '../components/ui';

const priceText = (n: number | null | undefined) => (n == null ? '' : String(n));

/** Same members, any order. */
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Carasso gets its own read-only screen (a different view, no pay, no edit); everyone else the staff screen. */
export default function JobDetail() {
  const { appUser } = useAuth();
  return appUser?.role === 'carasso' ? <CarassoJobDetail /> : <StaffJobDetail />;
}

function StaffJobDetail() {
  const { t, i18n } = useTranslation();
  const { appUser } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const staff = useStaff();
  const { sites } = useSiteScope();
  /* Submitter, crew and site are editable together: reassigning the job to one
     of its co-workers, or moving it to the yard it was really done at, are the
     corrections a manager actually makes. Shares recompute in Postgres (0019). */
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [coworkerIds, setCoworkerIds] = useState<string[]>([]);
  const [siteId, setSiteId] = useState('');
  /* Services (0033): managers and admins change the set; the database keeps
     the snapshot of lines already on the job and prices new ones from today's
     catalog. `catalog` is what can be added: active services only. */
  const [catalog, setCatalog] = useState<Service[]>([]);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  /* Per-line money, admin only. `lineDefaults` is what each line holds now (its
     snapshot) or would get if added (the catalog); `lineDrafts` is what the
     admin typed over it. Only a line whose draft differs from its default is
     written, so an untouched new line keeps the database's own snapshot. */
  const [lineDefaults, setLineDefaults] = useState<Record<string, LineMoney>>({});
  const [lineDrafts, setLineDrafts] = useState<Record<string, Partial<LineMoney>>>({});
  const [priceError, setPriceError] = useState(false);
  const [servicesError, setServicesError] = useState(false);
  /** The earlier job a duplicate flag points at: date, site, service only. */
  const [earlier, setEarlier] = useState<PreviousJob | null>(null);
  const [billingCode, setBillingCode] = useState('');
  const [managerNote, setManagerNote] = useState('');
  /* The car itself and when it was done: managers/admins correct these too.
     Same plate/VIN rules as New Job (normalizeVehicle); the database re-runs
     the duplicate flag and logs the change. */
  const [plate, setPlate] = useState('');
  const [vin, setVin] = useState('');
  const [brand, setBrand] = useState('');
  const [workerNote, setWorkerNote] = useState('');
  const [date, setDate] = useState('');
  /** Bumped after every write so an open Edit history re-reads. */
  const [historyKey, setHistoryKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  /* Read-first: editing lives behind these. A section with unsaved changes or
     errors is held open (see EditSection), and Save shows while either is open. */
  const [editOpen, setEditOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);

  const role = appUser?.role;
  /* Names come with the job's lines now, so a language switch no longer
     reloads (and wipes unsaved edits). */
  useEffect(() => {
    if (id) void load(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, role]);

  /** `quiet`: refresh after a save without the skeleton flashing in. */
  async function load(jobId: string, quiet = false) {
    if (!quiet) setLoading(true);
    const { data: j } = await supabase.from('jobs_manager').select('*').eq('id', jobId).single<Job>();
    if (!j) {
      setLoading(false);
      return;
    }
    const isAdmin = appUser?.role === 'admin';
    const lines = j.services ?? [];
    const [{ data: active }, catalogPrices, { data: linePrices }, dup] = await Promise.all([
      supabase.from('services').select(SERVICE_COLUMNS).eq('active', true).is('deleted_at', null).order('sort_order'),
      isAdmin ? fetchServiceClientPrices() : Promise.resolve(new Map<string, ClientPrices>()),
      // Admin only: the managers' API cannot read client prices (RLS).
      isAdmin
        ? supabase.from('job_service_client_prices').select('service_id, unit_price, total_price').eq('job_id', jobId)
        : Promise.resolve({ data: [] as (ClientPrices & { service_id: string })[] }),
      j.duplicate_of_job_id ? fetchDuplicateSummary(jobId) : Promise.resolve(null),
    ]);

    const defaults: Record<string, LineMoney> = {};
    for (const s of (active ?? []) as Service[]) {
      const p = catalogPrices.get(s.id);
      defaults[s.id] = { pay: String(s.worker_price), unit: priceText(p?.unit_price), total: priceText(p?.total_price) };
    }
    for (const l of lines) {
      const p = (linePrices ?? []).find((x) => x.service_id === l.service_id);
      defaults[l.service_id] = { pay: String(l.worker_price), unit: priceText(p?.unit_price), total: priceText(p?.total_price) };
    }

    setJob(j);
    setBillingCode(j.billing_code ?? '');
    setManagerNote(j.manager_note ?? '');
    setPlate(j.plate ?? '');
    setVin(j.vin ?? '');
    setBrand(j.brand ?? '');
    setWorkerNote(j.worker_note ?? '');
    setDate(toLocalInput(j.created_at));
    setCatalog((active ?? []) as Service[]);
    setServiceIds(lines.map((l) => l.service_id));
    setLineDefaults(defaults);
    setLineDrafts({});
    setPriceError(false);
    setServicesError(false);
    setEarlier(dup);
    setSelectedWorkerId(j.worker_id);
    setCoworkerIds(j.coworker_ids ?? []);
    setSiteId(j.site_id);
    setLoading(false);
  }

  const lineValue = (serviceId: string, field: keyof LineMoney) =>
    lineDrafts[serviceId]?.[field] ?? lineDefaults[serviceId]?.[field] ?? '';
  const setLineValue = (serviceId: string, field: keyof LineMoney, value: string) =>
    setLineDrafts((d) => ({ ...d, [serviceId]: { ...d[serviceId], [field]: value } }));

  /* The jobs-row update and its validation gate (see planJobEdit); the inline
     errors read from the same plan. No job yet: no plan, no errors. */
  const draft: JobFieldDraft = {
    plate,
    vin,
    brand,
    workerNote,
    date,
    workerId: selectedWorkerId,
    coworkerIds,
    siteId,
  };
  const edit = job ? planJobEdit(job, draft, Date.now()) : null;
  const vehicle = edit?.vehicle ?? { plateError: false, vinError: false, missingBoth: false, vinChecksum: null };
  const dateError = edit?.dateError ?? false;
  const vinChanged = edit?.vinChanged ?? false;

  async function handleSave() {
    if (!job || !appUser || !edit) return;
    const isAdmin = appUser.role === 'admin';
    // Shown inline already; the check digit is a warning and never blocks.
    if (edit.blocked) return;
    const originalServiceIds = job.service_ids ?? (job.services ?? []).map((l) => l.service_id);
    // A job keeps at least one service (the database refuses none); a legacy job
    // that never had one may still save its other fields.
    if (missingServices(originalServiceIds, serviceIds)) {
      setServicesError(true);
      return;
    }
    setServicesError(false);
    /* Admin money, per line, validated before anything is written (see lineWrites). */
    const { writes: lineWrites, invalid } = isAdmin
      ? planLineWrites(serviceIds, lineDefaults, lineDrafts)
      : { writes: [], invalid: false };
    if (invalid) {
      setPriceError(true);
      return;
    }
    setPriceError(false);
    setSaving(true);
    const servicesChanged = !sameSet(serviceIds, originalServiceIds);
    const billing = { billing_code: billingCode || null, manager_note: managerNote || null };
    const { changes: jobChanges, plateChanged, vehicle: stored } = edit;
    // Every write below is logged by database triggers (audit_log), in the same transaction.
    const moving = jobChanges.site_id !== job.site_id;
    /* Order matters: a manager who moves the job away loses access to its
       billing row and its services, so those go first and the jobs update (which
       carries the site) goes last. Each step stops the rest on failure. */
    let error: { message: string } | null = (await saveBilling(job.id, billing)).error;
    if (!error && servicesChanged) ({ error } = await setJobServices(job.id, serviceIds));
    for (const w of lineWrites) {
      if (error) break;
      if (w.payChanged)
        ({ error } = await supabase
          .from('job_services')
          .update({ worker_price: parsePrice(w.pay) })
          .eq('job_id', job.id)
          .eq('service_id', w.sid));
      if (!error && w.pricesChanged)
        ({ error } = await supabase
          .from('job_service_client_prices')
          .upsert(
            { job_id: job.id, service_id: w.sid, unit_price: parsePrice(w.unit), total_price: parsePrice(w.total) },
            { onConflict: 'job_id,service_id' },
          ));
    }
    if (!error) {
      if (moving && !isAdmin) {
        /* No RETURNING here: the moved row fails the manager's select policy,
           which would refuse the whole update. So a zero-row update can't be
           told apart on a move; RLS errors still surface. */
        ({ error } = await supabase.from('jobs').update(jobChanges).eq('id', job.id));
      } else {
        const res = await supabase.from('jobs').update(jobChanges).eq('id', job.id).select('id');
        // Zero rows back is RLS quietly refusing the update: a failed save, not a saved one.
        error = res.error ?? (res.data?.length ? null : { message: 'job not updated' });
      }
    }
    setSaving(false);
    setHistoryKey((k) => k + 1);
    if (error) {
      setSaveError(true);
      return;
    }
    setSaveError(false);
    // Re-read: the pay sum and new lines' snapshots are the database's. A
    // manager who moved the job off their site can no longer read it.
    if (moving && !isAdmin) {
      // The read-only view shows `job`, so it carries everything just saved.
      setJob({ ...job, ...jobChanges, ...billing, service_ids: serviceIds });
      setCoworkerIds(jobChanges.coworker_ids);
      // The stored form, so the fields don't read as changed against the new job.
      if (plateChanged) setPlate(stored.plate ?? '');
      if (vinChanged) setVin(stored.vin ?? '');
    } else await load(job.id, true);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  /** Delete / restore. Zero rows back is RLS quietly refusing: a failure, not a success. */
  async function setDeleted(deleted: boolean): Promise<boolean> {
    if (!job || !appUser) return false;
    const res = await supabase
      .from('jobs')
      .update({ deleted_at: deleted ? new Date().toISOString() : null })
      .eq('id', job.id)
      .select('id');
    const ok = !res.error && !!res.data?.length;
    setSaveError(!ok);
    setHistoryKey((k) => k + 1);
    return ok;
  }

  async function handleDelete() {
    if (await setDeleted(true)) navigate(-1);
  }

  async function handleRestore() {
    if (job && (await setDeleted(false))) void load(job.id);
  }

  if (loading) {
    return (
      <Page width="list">
        <Skeleton className="h-7 w-48" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
        <Skeleton className="h-40" />
      </Page>
    );
  }

  if (!job) {
    return (
      <Page width="list">
        <EmptyState
          icon="alertCircle"
          title={t('jobDetail.notFoundTitle')}
          body={t('jobDetail.notFoundBody')}
          action={
            <Button variant="secondary" icon="chevronLeft" onClick={() => navigate(-1)}>
              {t('jobDetail.back')}
            </Button>
          }
        />
      </Page>
    );
  }

  const canManage = appUser?.role === 'manager' || appUser?.role === 'admin';
  const isAdmin = appUser?.role === 'admin';
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? '—';
  /* Any active colleague, from any site. The current submitter stays listed
     even if deactivated since, so the field never silently jumps on load. */
  const submitterOptions = staff.filter((s) => s.active || s.id === job.worker_id);
  /* What the chips offer: the active catalog, plus any service already on the
     job that has since been retired or deleted (named from the line, and
     marked), so it can be kept or removed but never silently dropped. */
  const retired = ` (${t('jobDetail.serviceRetired')})`;
  const chipServices: Service[] = [
    ...catalog,
    ...(job.services ?? [])
      .filter((l) => !catalog.some((s) => s.id === l.service_id))
      .map((l, i) => ({
        id: l.service_id,
        name_en: l.name_en + retired,
        name_ru: l.name_ru ? l.name_ru + retired : null,
        name_he: l.name_he ? l.name_he + retired : null,
        catalog_number: l.catalog_number,
        worker_price: l.worker_price,
        active: false,
        sort_order: Number.MAX_SAFE_INTEGER - 1000 + i,
        deleted_at: null,
      })),
  ];
  const chipName = (sid: string) => {
    const s = chipServices.find((x) => x.id === sid);
    return s ? serviceLabel([s], i18n.language) : '—';
  };

  const savedServiceIds = job.service_ids ?? (job.services ?? []).map((l) => l.service_id);
  const servicesMissing = servicesError || missingServices(savedServiceIds, serviceIds);
  const fieldsInvalid = vehicle.plateError || vehicle.vinError || vehicle.missingBoth || dateError;
  const editDirty =
    plate !== (job.plate ?? '') ||
    vin !== (job.vin ?? '') ||
    brand.trim() !== (job.brand ?? '') ||
    workerNote.trim() !== (job.worker_note ?? '') ||
    date !== toLocalInput(job.created_at) ||
    selectedWorkerId !== job.worker_id ||
    siteId !== job.site_id ||
    !sameSet(coworkerIds, job.coworker_ids ?? []) ||
    !sameSet(serviceIds, savedServiceIds);
  const billingDirty =
    billingCode !== (job.billing_code ?? '') ||
    managerNote !== (job.manager_note ?? '') ||
    Object.keys(lineDrafts).length > 0;
  const unsaved = <span className="font-semibold text-warn-700">{t('jobDetail.unsaved')}</span>;

  return (
    <Page width="list">
      {/* The back link labels the title; tight, not a section of its own. */}
      <div className="space-y-2">
        <Link
          to="/dashboard"
          className="inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold text-ink-700 hover:text-ink-900"
        >
          <Icon name="chevronLeft" size={18} />
          {t('jobDetail.back')}
        </Link>

        {/* A plate is eight mono digits with wide tracking, and the brand rides
            beside it on the same line. At 28px that pair is wider than a 360px
            screen, so the brand wrapped alone under its plate. */}
        <h1 className="font-mono text-xl font-semibold tracking-wide text-ink-900 sm:text-2xl">
          {job.plate ?? job.vin ?? '—'}
          <span className="ms-3 font-sans text-sm font-normal tracking-normal text-ink-600 sm:text-base">
            {job.brand ?? '—'}
          </span>
        </h1>
      </div>

      {job.deleted_at && <StatusBanner tone="warning">{t('jobDetail.deletedNotice')}</StatusBanner>}
      {job.duplicate_of_job_id && (
        <StatusBanner tone="warning">
          {earlier ? t('jobDetail.duplicateOfDetail', describePreviousJob(earlier, i18n.language)) : t('jobDetail.duplicateOf')}
        </StatusBanner>
      )}

      {/* Read first: the job as values, then the editing behind collapsed
          sections. Two columns from md, so photos and the record sit side by side. */}
      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <div className="space-y-4">
          <JobMedia
            jobId={job.id}
            downloadName={`${job.plate ?? job.vin ?? job.id}_${job.created_at.slice(0, 10)}`}
            editable={canManage}
            onChanged={() => setHistoryKey((k) => k + 1)}
          />
        </div>

        <div className="space-y-4">
          <Card>
            <SectionHeading icon="clipboard">{t('jobDetail.details')}</SectionHeading>
            {/*
              Label above value rather than a justify-between row. A 17-character
              VIN and a comma-joined service list used to collide with the label,
              and Russian labels run about twice as long, which squeezed the
              value column further.
            */}
            <dl className="space-y-3">
              <DetailRow label={t('newJob.plate')} value={job.plate ?? '—'} mono copy={!!job.plate} />
              <DetailRow label={t('newJob.vin')} value={job.vin ?? '—'} mono copy={!!job.vin} />
              <DetailRow label={t('newJob.brand')} value={job.brand ?? '—'} />
              <DetailRow label={t('jobDetail.date')} value={new Date(job.created_at).toLocaleString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} />
              <DetailRow label={t('jobDetail.worker')} value={nameOf(job.worker_id)} />
              {job.coworker_ids.length > 0 && (
                <DetailRow label={t('coworkers.label')} value={job.coworker_ids.map(nameOf).join(', ')} />
              )}
              <DetailRow label={t('newJob.site')} value={sites.find((s) => s.id === job.site_id)?.name ?? '—'} />
              <DetailRow
                label={t('jobDetail.services')}
                value={savedServiceIds.map(chipName).join(', ') || '—'}
              />
              {job.worker_note && <DetailRow label={t('jobDetail.workerNote')} value={job.worker_note} />}
              {canManage && (
                <>
                  <DetailRow label={t('jobDetail.billingCode')} value={job.billing_code ?? '—'} mono />
                  {job.manager_note && <DetailRow label={t('jobDetail.managerNote')} value={job.manager_note} />}
                  {/* The sum of the lines' pay snapshots, set by the database. */}
                  <DetailRow label={t('jobDetail.payTotal')} value={formatMoney(job.worker_price, i18n.language)} />
                </>
              )}
            </dl>
          </Card>

          {canManage && (
            <>
              <EditSection
                title={t('jobDetail.editDetails')}
                status={editDirty && unsaved}
                open={editOpen}
                onOpenChange={setEditOpen}
                locked={editDirty || fieldsInvalid || servicesMissing}
              >
                <Field
                  htmlFor="job-date"
                  label={t('jobDetail.date')}
                  error={dateError ? t('jobDetail.dateInvalid') : undefined}
                >
                  <input
                    id="job-date"
                    type="datetime-local"
                    value={date}
                    max={toLocalInput(new Date())}
                    onChange={(e) => setDate(e.target.value)}
                    className={`${fieldClass} ${dateError ? fieldErrorClass : ''}`}
                  />
                </Field>
                <Field
                  htmlFor="job-plate"
                  label={t('newJob.plate')}
                  optional
                  error={
                    vehicle.plateError
                      ? t('newJob.plateInvalid')
                      : vehicle.missingBoth
                        ? t('newJob.needIdentifier')
                        : undefined
                  }
                >
                  <input
                    id="job-plate"
                    value={plate}
                    inputMode="numeric"
                    maxLength={8}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => setPlate(stripPlate(e.target.value).slice(0, 8))}
                    className={`${fieldClass} font-mono tracking-wider ${
                      vehicle.plateError || vehicle.missingBoth ? fieldErrorClass : ''
                    }`}
                  />
                </Field>
                <Field
                  htmlFor="job-vin"
                  label={t('newJob.vin')}
                  optional
                  error={vehicle.vinError ? t('newJob.vinInvalid') : undefined}
                >
                  <input
                    id="job-vin"
                    value={vin}
                    maxLength={17}
                    inputMode="text"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => setVin(e.target.value.toUpperCase())}
                    className={`${fieldClass} font-mono tracking-wider uppercase ${
                      vehicle.vinError ? fieldErrorClass : ''
                    }`}
                  />
                  {/* Advisory only, as on New Job: imports can fail the check digit. */}
                  {vinChanged && vehicle.vinChecksum === false && !vehicle.vinError && (
                    <FieldNotice>{t('newJob.vinChecksumWarning')}</FieldNotice>
                  )}
                </Field>
                <Field htmlFor="job-brand" label={t('newJob.brand')} optional>
                  <input id="job-brand" value={brand} onChange={(e) => setBrand(e.target.value)} className={fieldClass} />
                </Field>
                <Field htmlFor="job-worker" label={t('jobDetail.worker')}>
                  <Select id="job-worker" value={selectedWorkerId} onChange={(e) => setSelectedWorkerId(e.target.value)}>
                    {submitterOptions.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field htmlFor="job-coworkers" label={t('coworkers.label')}>
                  <CoworkerPicker
                    id="job-coworkers"
                    staff={staff}
                    sites={sites}
                    value={coworkerIds}
                    submitterId={selectedWorkerId || job.worker_id}
                    onChange={setCoworkerIds}
                  />
                </Field>
                <Field htmlFor="job-site" label={t('newJob.site')}>
                  <Select id="job-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div>
                  <p className="mb-2 text-sm font-medium text-ink-700">{t('jobDetail.services')}</p>
                  <ServiceChips
                    services={chipServices}
                    selected={serviceIds}
                    label={t('jobDetail.services')}
                    onToggle={(sid) => {
                      setServicesError(false);
                      setServiceIds((ids) => (ids.includes(sid) ? ids.filter((x) => x !== sid) : [...ids, sid]));
                    }}
                  />
                  {servicesMissing && (
                    <p className="mt-1.5 text-sm text-danger-700" role="alert">
                      {t('jobDetail.servicesRequired')}
                    </p>
                  )}
                </div>
                <Field htmlFor="worker-note" label={t('jobDetail.workerNote')} optional>
                  <textarea
                    id="worker-note"
                    value={workerNote}
                    onChange={(e) => setWorkerNote(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-line-strong bg-surface px-3.5 py-3 text-base text-ink-900 focus:border-ink-900"
                  />
                </Field>
              </EditSection>

              <EditSection
                title={t('jobDetail.billingSection')}
                status={billingDirty && unsaved}
                open={billingOpen}
                onOpenChange={setBillingOpen}
                locked={billingDirty || priceError}
              >
                <Field htmlFor="billing-code" label={t('jobDetail.billingCode')}>
                  <input
                    id="billing-code"
                    value={billingCode}
                    onChange={(e) => setBillingCode(e.target.value)}
                    className={`${fieldClass} font-mono`}
                  />
                </Field>
                <Field htmlFor="manager-note" label={t('jobDetail.managerNote')} optional>
                  <textarea
                    id="manager-note"
                    value={managerNote}
                    onChange={(e) => setManagerNote(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-line-strong bg-surface px-3.5 py-3 text-base text-ink-900 focus:border-ink-900"
                  />
                </Field>
                {/* Only an admin edits a line's pay and client prices; the
                    managers' API cannot read client prices. */}
                {isAdmin && serviceIds.length > 0 && (
                  <div className="space-y-4 border-t border-line pt-4">
                    <h3 className="text-base font-semibold text-ink-900">{t('jobDetail.pricing')}</h3>
                    {serviceIds.map((sid) => (
                      // One fieldset per line, its legend the service: three lines
                      // otherwise read as nine identical "Worker pay" fields.
                      <fieldset key={sid} className="space-y-3 rounded-xl border border-line p-3">
                        <legend className="px-1 text-sm font-semibold text-ink-900">{chipName(sid)}</legend>
                        {(
                          [
                            ['pay', 'linePay'],
                            ['unit', 'lineClientUnit'],
                            ['total', 'lineClientTotal'],
                          ] as const
                        ).map(([field, key]) => (
                          <Field key={field} htmlFor={`line-${field}-${sid}`} label={t(`jobDetail.${key}`)}>
                            <input
                              id={`line-${field}-${sid}`}
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              value={lineValue(sid, field)}
                              onChange={(e) => setLineValue(sid, field, e.target.value)}
                              className={`${fieldClass} font-mono`}
                            />
                          </Field>
                        ))}
                      </fieldset>
                    ))}
                    {priceError && <StatusBanner tone="error" live>{t('prices.invalid')}</StatusBanner>}
                  </div>
                )}
              </EditSection>

              {/* One Save for both sections, as before. Shown while either is
                  open (or holds edits); errors show whenever they exist. */}
              {fieldsInvalid && (
                <StatusBanner tone="error" live>
                  {t('jobDetail.fixFields')}
                </StatusBanner>
              )}
              {saveError && <StatusBanner tone="error">{t('jobDetail.saveFailed')}</StatusBanner>}
              {(editOpen || billingOpen || editDirty || billingDirty || saved) && (
                <Button size="lg" block busy={saving} icon={saved ? 'check' : undefined} onClick={() => void handleSave()}>
                  {saved ? t('jobDetail.saved') : t('jobDetail.save')}
                </Button>
              )}

              <EditHistory jobId={job.id} refreshKey={historyKey} services={chipServices} sites={sites} />

              {/* Delete stays two taps (ConfirmAction), and now also behind this row. */}
              <EditSection title={t('jobDetail.moreActions')}>
                {job.deleted_at ? (
                  <Button variant="secondary" icon="sync" block onClick={() => void handleRestore()}>
                    {t('jobDetail.restore')}
                  </Button>
                ) : (
                  <ConfirmAction
                    block
                    trigger={t('jobDetail.deleteAction')}
                    question={t('jobDetail.deleteConfirm')}
                    confirmLabel={t('jobDetail.delete')}
                    onConfirm={() => void handleDelete()}
                  />
                )}
              </EditSection>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}

/**
 * A collapsed editing section (native details, same row shape as New Job's
 * "More details"). `locked` holds it open: a section with unsaved changes or an
 * error never folds them out of sight, and the summary says why.
 */
function EditSection({
  title,
  status,
  open = false,
  onOpenChange,
  locked = false,
  children,
}: {
  title: string;
  status?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  locked?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={open || locked}
      onToggle={(e) => {
        const el = e.currentTarget;
        if (!el.open && locked) el.open = true;
        else onOpenChange?.(el.open);
      }}
      className="group rounded-xl border border-line bg-surface shadow-card"
    >
      <summary className="flex min-h-control cursor-pointer list-none items-center justify-between gap-3 px-4 text-base font-semibold text-ink-900 [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink-600">
          {status && <span className="truncate">{status}</span>}
          <Icon
            name="chevronRight"
            size={16}
            className="shrink-0 transition-transform group-open:rotate-90 rtl:-scale-x-100"
          />
        </span>
      </summary>
      <div className="space-y-4 border-t border-line p-4">{children}</div>
    </details>
  );
}
