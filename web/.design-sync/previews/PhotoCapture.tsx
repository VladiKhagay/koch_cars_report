import { PhotoCapture } from 'web';

// PhotoCapture takes a real Blob and object-URLs it, so the preview needs an
// actual image blob rather than a src string. An inline SVG blob stands in for
// the camera capture — it loads synchronously from the object URL.
function imageBlob(inner: string, bg: string): Blob {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
    <rect width="640" height="480" fill="${bg}"/>${inner}</svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

const PLATE = imageBlob(
  `<rect x="120" y="180" width="400" height="110" rx="10" fill="#f8fafc" stroke="#0f172a" stroke-width="6"/>
   <rect x="126" y="186" width="52" height="98" rx="6" fill="#1d4ed8"/>
   <text x="152" y="245" font-family="Helvetica,Arial" font-size="26" font-weight="700" fill="#ffffff" text-anchor="middle">D</text>
   <text x="360" y="258" font-family="Helvetica,Arial" font-size="62" font-weight="700" fill="#0f172a" text-anchor="middle" letter-spacing="6">B MK 4718</text>`,
  '#334155',
);

const VIN = imageBlob(
  `<rect x="70" y="200" width="500" height="80" rx="4" fill="#e2e8f0"/>
   <text x="320" y="255" font-family="Menlo,monospace" font-size="40" font-weight="600" fill="#0f172a" text-anchor="middle">WVWZZZ1JZ3W386752</text>`,
  '#475569',
);

const noop = () => {};

// The tile derives one of four states from its props:
//   empty  = no photo · processing = photo + busy · error = photo + error
//   success = photo, no busy, no error (or the error was dismissed).

/** Empty tile — the default New Job state. Tapping it opens the rear camera. */
export const Empty = () => (
  <div className="max-w-xs bg-slate-50 p-4">
    <PhotoCapture label="License plate photo" photo={null} onCapture={noop} />
  </div>
);

/** After capture: the shot fills the tile with a "Retake" affordance. */
export const Captured = () => (
  <div className="max-w-xs bg-slate-50 p-4">
    <PhotoCapture label="License plate photo" photo={PLATE} onCapture={noop} />
  </div>
);

/** busy=true — OCR is reading the photo; the tile dims and blocks a retake. */
export const Reading = () => (
  <div className="max-w-xs bg-slate-50 p-4">
    <PhotoCapture label="VIN photo" photo={VIN} busy onCapture={noop} />
  </div>
);

/** OCR couldn't read the shot — the reason is shown with Retake / Type it in.
 *  "Type it in" dismisses the error and drops the tile back to success. */
export const OcrFailed = () => (
  <div className="max-w-xs bg-slate-50 p-4">
    <PhotoCapture
      label="VIN photo"
      photo={VIN}
      error="Couldn't read it (glare) — enter manually or retake the photo"
      onCapture={noop}
      onTypeItIn={noop}
    />
  </div>
);

/** Both tiles as New Job stacks them: plate captured, VIN still to shoot. */
export const NewJobPair = () => (
  <div className="flex max-w-xs flex-col gap-4 bg-slate-50 p-4">
    <PhotoCapture label="License plate photo" photo={PLATE} onCapture={noop} />
    <PhotoCapture label="VIN photo" photo={null} onCapture={noop} />
  </div>
);
