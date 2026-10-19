import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Icon from './Icon';
import BillingInput from './BillingInput';
import { Badge } from './ui';

/** One job as a card, the phone layout for manager lists: keeps the plate, crew and reservation field in view where a table would push them off-screen. */
export interface JobCardData {
  id: string;
  plate: string | null;
  vin: string | null;
  brand: string | null;
  billing_code: string | null;
  duplicate_of_job_id: string | null;
}

export default function JobCard({
  job,
  meta,
  showBilling,
  onSaveBilling,
  onDuplicate,
  children,
}: {
  job: JobCardData;
  /** Crew and time, already formatted — "Dana, Avi · 11:30". */
  meta: string;
  /** Whether the reservation-number row is shown. */
  showBilling: boolean;
  onSaveBilling: (value: string) => Promise<boolean>;
  /** When set, the duplicate flag is a button that opens the resolve panel. */
  onDuplicate?: () => void;
  /** Rendered under the card — the duplicate panel. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();

  const flag = job.duplicate_of_job_id && (
    <Badge tone="warn" icon="alertTriangle">
      {t('dashboard.duplicateFlag')}
    </Badge>
  );

  return (
    <div>
      <div className="rounded-xl border border-line bg-surface shadow-card">
        <div className="flex items-stretch">
          <Link
            to={`/jobs/${job.id}`}
            className="flex min-h-control-lg min-w-0 flex-1 items-center justify-between gap-3 rounded-xl p-4 active:bg-ink-50"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-base font-semibold tracking-wide text-ink-900">
                {job.plate ?? job.vin ?? '—'}
                {job.brand && <span className="ms-2 font-sans text-sm font-normal text-ink-600">{job.brand}</span>}
              </p>
              {/* A plate-less job already shows its VIN above. */}
              {job.plate && job.vin && <p className="truncate font-mono text-xs text-ink-600">{job.vin}</p>}
              <p className="truncate text-xs text-ink-600">{meta}</p>
            </div>
            {!onDuplicate && flag}
            <Icon name="chevronRight" size={18} className="shrink-0 text-ink-500 rtl:-scale-x-100" />
          </Link>
          {onDuplicate && flag && (
            <button
              type="button"
              onClick={onDuplicate}
              className="me-3 inline-flex min-h-tap items-center self-center rounded-md"
            >
              {flag}
            </button>
          )}
        </div>

        {showBilling && (
          <div className="flex items-center gap-3 border-t border-line px-4 py-2">
            <span className="shrink-0 whitespace-nowrap text-xs font-medium text-ink-600">
              {t('jobs.billingCode')}
            </span>
            <BillingInput
              fill
              className="md:max-w-64"
              committed={job.billing_code ?? ''}
              resetKey={job.id}
              onSave={onSaveBilling}
            />
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
