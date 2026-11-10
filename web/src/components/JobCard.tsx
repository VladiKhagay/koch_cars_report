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
  time,
  services,
}: {
  job: JobCardData;
  /** Crew, time, service — already formatted, one entry each. Each is isolated
      so an English name inside a Hebrew line cannot reorder its neighbours. */
  meta: (string | null)[];
  /** Whether the reservation-number row is shown. */
  showBilling: boolean;
  /** Absent = read-only (Carasso): the reservation number is shown, not editable. */
  onSaveBilling?: (value: string) => Promise<boolean>;
  /** When set, the duplicate flag is a button that opens the resolve panel. */
  onDuplicate?: () => void;
  /** Shown at the trailing edge of the top row (opposite the plate in both directions). */
  time?: string;
  /** Localized service names, drawn as tags. */
  services?: string[];
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
            <div className="min-w-0 flex-1 space-y-1.5">
              {/* `.font-mono` pins direction:ltr, so it sits on inline spans: on a
                  block it would flip "start" to the left inside a Hebrew card. */}
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-base font-semibold text-ink-900">
                  <span className="font-mono tracking-wide">{job.plate ?? job.vin ?? '—'}</span>
                  {job.brand && <span className="ms-2 text-sm font-normal text-ink-600">{job.brand}</span>}
                </p>
                {time && <span className="shrink-0 text-xs font-medium tabular-nums text-ink-600">{time}</span>}
              </div>
              {/* A plate-less job already shows its VIN above. */}
              {job.plate && job.vin && (
                <p className="truncate text-xs text-ink-600">
                  <span className="font-mono">{job.vin}</span>
                </p>
              )}
              {services && services.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label={t('jobs.service')}>
                  {services.map((name, i) => (
                    <li
                      key={i}
                      className="rounded-md border border-line bg-ink-50 px-2 py-0.5 text-xs font-semibold text-ink-700"
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              )}
              {meta.some(Boolean) && (
                <p className="flex items-start gap-1.5 break-words text-xs text-ink-600">
                  <Icon name="user" size={14} className="mt-0.5 shrink-0 text-ink-500" />
                  <span className="min-w-0">
                    {meta.filter(Boolean).map((part, i) => (
                      <span key={i}>
                        {i > 0 && ' · '}
                        <bdi>{part}</bdi>
                      </span>
                    ))}
                  </span>
                </p>
              )}
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
            {onSaveBilling ? (
              <BillingInput
                fill
                className="md:max-w-64"
                committed={job.billing_code ?? ''}
                resetKey={job.id}
                onSave={onSaveBilling}
              />
            ) : (
              <span className="min-w-0 break-words font-mono text-sm text-ink-900">{job.billing_code ?? '—'}</span>
            )}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
