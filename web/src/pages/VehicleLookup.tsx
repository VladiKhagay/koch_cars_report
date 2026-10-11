import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { serviceName } from '../lib/serviceName';
import { Button, Card, EmptyState, Page, PageHeading, SearchField, SectionHeading, SkeletonList } from '../components/ui';

/** One row of `lookup_vehicle` (0018). Deliberately carries no worker. */
interface LookupRow {
  created_at: string;
  site_name: string;
  plate: string | null;
  vin: string | null;
  brand: string | null;
  service_name_en: string | null;
  service_name_ru: string | null;
  service_name_he: string | null;
}

/**
 * "Has this car been done before?" for workers, across every site. Workers can
 * only read their own jobs (0003), so this goes through a security definer RPC
 * that returns only date, site, car and service — never who logged it.
 */
export default function VehicleLookup() {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<LookupRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(false);
    const { data, error: rpcError } = await supabase.rpc('lookup_vehicle', { p_query: query });
    setLoading(false);
    if (rpcError) {
      setError(true);
      setRows(null);
      return;
    }
    setRows((data ?? []) as LookupRow[]);
  }

  return (
    <Page>
      <PageHeading lead={t('lookup.lead')}>{t('lookup.title')}</PageHeading>

      <form onSubmit={search} className="flex gap-2">
        <SearchField value={query} onChange={setQuery} label={t('lookup.label')} className="flex-1" />
        <Button type="submit" busy={loading} disabled={!query.trim()}>
          {t('lookup.search')}
        </Button>
      </form>

      {error && <p role="alert" className="text-sm text-danger-600">{t('lookup.error')}</p>}

      {loading ? (
        <SkeletonList />
      ) : rows && rows.length === 0 ? (
        <EmptyState icon="search" title={t('lookup.notFound')} body={t('lookup.notFoundBody')} />
      ) : rows ? (
        <section aria-live="polite">
          <SectionHeading>
            {t('lookup.results')} ({rows.length})
          </SectionHeading>
          <Card padding={false}>
            <ul className="divide-y divide-line">
              {rows.map((r, i) => (
                <li key={i} className="space-y-1 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="font-medium text-ink-900">
                      {serviceName(
                        r.service_name_en
                          ? { name_en: r.service_name_en, name_ru: r.service_name_ru, name_he: r.service_name_he }
                          : null,
                        i18n.language,
                      ) ?? '—'}
                    </span>
                    <span className="text-sm text-ink-600">
                      {new Date(r.created_at).toLocaleDateString(i18n.language)} · {r.site_name}
                    </span>
                  </div>
                  <div dir="ltr" className="font-mono text-sm text-ink-600">
                    {[r.plate, r.vin, r.brand].filter(Boolean).join(' · ')}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </Page>
  );
}
