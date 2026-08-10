export default function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
