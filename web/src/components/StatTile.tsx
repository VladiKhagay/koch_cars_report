/**
 * A counted quantity and the thing it counts.
 *
 * The label used to be 12px in a mid-grey — the number was legible and what it
 * measured was not, which on an analytics screen is the half that matters.
 */
export default function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    /* These sit three across on the worker's own phone, so the padding gives
       way before the label does: at 320px a fixed p-4 leaves ~56px of text
       column and "Jobs this month" breaks into four lines. */
    <div className="rounded-xl border border-line bg-surface p-3 shadow-card sm:p-4">
      <p className="text-sm font-medium text-ink-700">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-ink-900 sm:text-2xl">{value}</p>
    </div>
  );
}
