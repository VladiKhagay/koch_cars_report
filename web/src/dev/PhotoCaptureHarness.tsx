/**
 * Dev-only harness for PhotoCapture.
 *
 * The component only appears on /new, which needs a signed-in worker. This
 * mounts every state side by side so the tile can be checked — including the
 * two file inputs, whose `capture` attribute is the whole point of the change
 * and is invisible in a screenshot.
 *
 * Reachable at /dev/photo in `npm run dev` only; App.tsx does not route to it.
 */
import { useState } from 'react';
import PhotoCapture from '../components/PhotoCapture';
import { Page, PageHeading } from '../components/ui';

const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function pngBlob(): Blob {
  const bytes = Uint8Array.from(atob(PIXEL), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

export default function PhotoCaptureHarness() {
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [extras, setExtras] = useState<Blob[]>([pngBlob()]);

  return (
    <Page width="list" className="space-y-5">
      <PageHeading>PhotoCapture states</PageHeading>
      <div className="grid grid-cols-2 gap-3">
        <PhotoCapture label="Empty" photo={null} onCapture={() => {}} />
        <PhotoCapture label="Processing" photo={pngBlob()} busy onCapture={() => {}} />
        <PhotoCapture label="Success" photo={pngBlob()} onCapture={() => {}} />
        <PhotoCapture label="OCR failed" photo={pngBlob()} error="blurry" onCapture={() => {}} onTypeItIn={() => {}} />
        <PhotoCapture label="Removable" photo={pngBlob()} onCapture={() => {}} onRemove={() => {}} />
        <PhotoCapture label="Live" photo={photo} onCapture={setPhoto} onRemove={() => setPhoto(null)} />
      </div>

      <PageHeading>Extra photo slots</PageHeading>
      <div className="grid grid-cols-2 gap-3">
        {extras.map((b, i) => (
          <PhotoCapture
            key={i}
            label={`Extra photo ${i + 1}`}
            photo={b}
            onCapture={() => {}}
            onRemove={() => setExtras((e) => e.filter((_, j) => j !== i))}
          />
        ))}
        {extras.length < 3 && (
          <PhotoCapture label="Add a photo" photo={null} onCapture={(b) => setExtras((e) => [...e, b])} />
        )}
      </div>
    </Page>
  );
}
