import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useStaff } from '../lib/useStaff';
import { serviceLabel } from '../lib/serviceRows';
import { describeChanges, type ChangeFormatters } from '../lib/auditChanges';
import { formatMoney } from './money';
import type { Service, Site } from '../lib/types';
import Icon from './Icon';
import { Card, Spinner } from './ui';

type AuditRow = { id: string; action: string; changes: unknown; at: string; user_id: string | null };

/**
 * Read-only log of who changed what on a job (audit_log, written by DB
 * triggers). Collapsed by default and loaded on first open; `refreshKey`
 * changes after a save or a media change so an open list stays current.
 * Managers/admins only: audit_log RLS returns nothing to anyone else, and
 * hides client-price rows (client_price_update) from managers (0034).
 */
export default function EditHistory({
  jobId,
  refreshKey,
  services,
  sites,
}: {
  jobId: string;
  refreshKey: number;
  /** Everything the job's chips know, retired services included, to name ids. */
  services: Service[];
  sites: Pick<Site, 'id' | 'name'>[];
}) {
  const { t, i18n } = useTranslation();
  const staff = useStaff();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setFailed(false);
    void supabase
      .from('audit_log')
      .select('id, action, changes, at, user_id')
      .eq('job_id', jobId)
      .order('at', { ascending: false })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setFailed(true);
        else setRows((data ?? []) as AuditRow[]);
      });
    return () => {
      live = false;
    };
  }, [open, jobId, refreshKey]);

  const fmt: ChangeFormatters = {
    person: (id) => staff.find((s) => s.id === id)?.name ?? '—',
    site: (id) => sites.find((s) => s.id === id)?.name ?? '—',
    service: (id) => {
      const s = services.find((x) => x.id === id);
      return s ? serviceLabel([s], i18n.language) : '—';
    },
    date: (iso) => new Date(iso).toLocaleString(i18n.language),
    slot: (kind) => t(`jobDetail.history.slots.${kind}`, { defaultValue: kind }),
    bool: (b) => t(b ? 'jobDetail.history.yes' : 'jobDetail.history.no'),
    money: (n) => formatMoney(n, i18n.language),
  };
  const empty = t('jobDetail.history.emptyValue');

  return (
    <Card>
      <details onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="flex min-h-tap cursor-pointer items-center gap-2 text-base font-semibold text-ink-900">
          <Icon name="clock" size={18} />
          {t('jobDetail.history.title')}
        </summary>
        <div className="mt-3">
          {failed && <p className="text-sm text-danger-700">{t('common.error')}</p>}
          {!failed && rows === null && (
            <span role="status" className="inline-flex items-center gap-2 text-sm text-ink-600">
              <Spinner />
              {t('common.loading')}
            </span>
          )}
          {!failed && rows?.length === 0 && <p className="text-sm text-ink-600">{t('jobDetail.history.none')}</p>}
          {!failed && rows && rows.length > 0 && (
            <ol className="space-y-3">
              {rows.map((r) => {
                const changes = describeChanges(r.changes, fmt);
                return (
                  <li key={r.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
                    <p className="text-sm font-semibold text-ink-900">
                      {t(`jobDetail.history.actions.${r.action}`, { defaultValue: r.action })}
                    </p>
                    <p className="text-xs text-ink-600">
                      {r.user_id ? fmt.person(r.user_id) : t('jobDetail.history.system')} ·{' '}
                      {new Date(r.at).toLocaleString(i18n.language)}
                    </p>
                    {changes.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-sm text-ink-800">
                        {changes.map((c) => (
                          <li key={c.field} className="break-words">
                            <span className="font-medium">
                              {t(`jobDetail.history.fields.${c.field}`, { defaultValue: c.field })}:
                            </span>{' '}
                            {c.from === undefined
                              ? (c.to ?? empty)
                              : t('jobDetail.history.change', { from: c.from ?? empty, to: c.to ?? empty })}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </details>
    </Card>
  );
}
