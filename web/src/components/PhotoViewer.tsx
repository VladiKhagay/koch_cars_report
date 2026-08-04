import { useEffect, useState } from 'react';
import { fetchPhotoUrl } from '../lib/workerApi';

export default function PhotoViewer({ jobId, kind, label }: { jobId: string; kind: 'plate' | 'vin'; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoke: string | null = null;
    fetchPhotoUrl(jobId, kind).then((u) => {
      if (u) {
        setUrl(u);
        revoke = u;
      } else {
        setFailed(true);
      }
    });
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [jobId, kind]);

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">{label}</p>
      <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100">
        {url && <img src={url} alt={label} className="h-full w-full object-cover" />}
        {!url && !failed && <span className="text-sm text-slate-400">…</span>}
        {failed && <span className="text-sm text-slate-400">—</span>}
      </div>
    </div>
  );
}
