/**
 * A counted quantity and the thing it counts.
 *
 * The label used to be 12px in a mid-grey — the number was legible and what it
 * measured was not, which on an analytics screen is the half that matters.
 */
export default function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <p className="text-sm font-medium text-ink-700">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink-900">{value}</p>
    </div>
  );
}
