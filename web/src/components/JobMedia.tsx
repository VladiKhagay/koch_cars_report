import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import type { PhotoKind } from '../lib/types';
import PhotoViewer from './PhotoViewer';
import VideoViewer from './VideoViewer';

/**
 * A job's plate and VIN photos, whichever extras exist, and its video if any.
 * Only the extras that exist are shown: probing all three slots blind would
 * render three 'photo unavailable' tiles on every job that has none. Reads
 * `photos` (RLS covers Carasso for jobs on its sites).
 */
export default function JobMedia({ jobId, downloadName }: { jobId: string; downloadName: string }) {
  const { t } = useTranslation();
  const [extraKinds, setExtraKinds] = useState<PhotoKind[]>([]);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    let live = true;
    void supabase
      .from('photos')
      .select('kind')
      .eq('job_id', jobId)
      .or('kind.like.extra%,kind.eq.video')
      .order('kind')
      .then(({ data }) => {
        if (!live) return;
        const kinds = (data ?? []).map((p: { kind: PhotoKind }) => p.kind);
        setExtraKinds(kinds.filter((k) => k.startsWith('extra')));
        setHasVideo(kinds.includes('video'));
      });
    return () => {
      live = false;
    };
  }, [jobId]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <PhotoViewer jobId={jobId} kind="plate" label={t('newJob.platePhoto')} downloadName={downloadName} />
        <PhotoViewer jobId={jobId} kind="vin" label={t('newJob.vinPhoto')} downloadName={downloadName} />
        {extraKinds.map((kind, i) => (
          <PhotoViewer key={kind} jobId={jobId} kind={kind} label={t('newJob.extraPhoto', { n: i + 1 })} downloadName={downloadName} />
        ))}
      </div>
      {hasVideo && <VideoViewer jobId={jobId} downloadName={downloadName} />}
    </>
  );
}
