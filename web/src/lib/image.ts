/**
 * Largest photo the Worker's /upload will accept.
 *
 * Must match MAX_UPLOAD_BYTES in worker/src/upload.ts. The two packages deploy
 * separately and share no module, so the number is written down twice on
 * purpose — but only the Worker's copy is a security control. This one exists
 * so the downscale-failure path fails on the phone instead of uploading bytes
 * that are certain to be rejected.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Downscale a captured photo client-side before it ever leaves the phone. */
export async function downscaleImage(file: File | Blob, maxDim = 1920, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode image'))),
      'image/jpeg',
      quality,
    );
  });
}

/** Pixel dimensions of an encoded image. */
export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  return { width: bitmap.width, height: bitmap.height };
}

/** Corner box as returned by the Worker, in the model's own coordinate space. */
export interface DetectBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Turns a detected box into a padded, in-bounds pixel crop rect.
 *
 * Moondream's schema does not state whether coordinates are normalised or
 * absolute, so both are accepted: anything within 0..1.5 is treated as
 * normalised, larger values as pixels.
 *
 * Padding is asymmetric — more vertically than horizontally, as a plate is a
 * wide, short strip whose top and bottom characters sit close to the border.
 * Too tight a crop clips the glyphs that touch the plate frame.
 */
export function boxToCropRect(
  box: DetectBox,
  imgW: number,
  imgH: number,
  padX = 0.08,
  padY = 0.25,
): CropRect | null {
  const normalised = box.x1 <= 1.5 && box.y1 <= 1.5;
  const x0 = normalised ? box.x0 * imgW : box.x0;
  const y0 = normalised ? box.y0 * imgH : box.y0;
  const x1 = normalised ? box.x1 * imgW : box.x1;
  const y1 = normalised ? box.y1 * imgH : box.y1;

  const w = x1 - x0;
  const h = y1 - y0;
  if (!(w > 0 && h > 0)) return null;
  // A box covering the whole frame means detection found nothing useful.
  if (w * h > imgW * imgH * 0.9) return null;

  const sx = Math.max(0, x0 - w * padX);
  const sy = Math.max(0, y0 - h * padY);
  const sw = Math.min(imgW - sx, w * (1 + padX * 2));
  const sh = Math.min(imgH - sy, h * (1 + padY * 2));
  // Below this there are too few pixels on the characters for the crop to help.
  if (sw < 16 || sh < 8) return null;

  return { sx, sy, sw, sh };
}

/**
 * Rewrites a box into 0..1 fractions of its own source image.
 *
 * Detection runs on a small copy of the photo (fast to upload) while the crop
 * is taken from the full-resolution original. A normalised box survives that
 * change of resolution; a pixel-space one would land somewhere else entirely.
 */
export function normalizeBox(box: DetectBox, srcW: number, srcH: number): DetectBox {
  if (box.x1 <= 1.5 && box.y1 <= 1.5) return box;
  return { x0: box.x0 / srcW, y0: box.y0 / srcH, x1: box.x1 / srcW, y1: box.y1 / srcH };
}

/**
 * Crops to the detected box and upscales, so the plate fills the frame the
 * model sees. A plate is only ~190px wide in a whole-car shot; cropping to it
 * is what makes OCR viable at all.
 */
export async function cropToBox(file: File | Blob, box: DetectBox, outWidth = 1024): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const rect = boxToCropRect(box, bitmap.width, bitmap.height);
  if (!rect) throw new Error('Unusable crop box');

  // Only ever upscale — shrinking a crop would throw away the pixels this
  // whole detour exists to preserve.
  const scale = Math.max(1, outWidth / rect.sw);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(rect.sw * scale);
  canvas.height = Math.round(rect.sh * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(bitmap, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, canvas.width, canvas.height);

  // Quality 0.95: the crop is small, and JPEG ringing around glyph edges is
  // exactly the artefact that costs character accuracy.
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode crop'))), 'image/jpeg', 0.95);
  });
}

/**
 * Black/white points that put most of a histogram's mass across the full range.
 *
 * A VIN photographed through the windscreen comes back as dark characters in a
 * bright reflected wash — the glyphs are still there, but squeezed into a
 * narrow band of the range, which is exactly what a vision model loses. The
 * percentiles are deliberately loose: a glare highlight is a real part of the
 * image, and clipping it away is the point.
 *
 * `histogram` is 256 luminance bucket counts. Returns null when there is
 * nothing to gain (already full-range, or a flat frame that stretching would
 * only amplify noise in).
 */
export function levelRange(histogram: ArrayLike<number>, lowPct = 0.02, highPct = 0.98): [number, number] | null {
  let total = 0;
  for (let i = 0; i < 256; i++) total += histogram[i];
  if (!total) return null;

  const lowTarget = total * lowPct;
  const highTarget = total * highPct;
  let seen = 0;
  let low = 0;
  let high = 255;
  for (let i = 0; i < 256; i++) {
    seen += histogram[i];
    if (seen <= lowTarget) low = i;
    if (seen >= highTarget) {
      high = i;
      break;
    }
  }

  // Below ~24 levels of spread the frame carries no usable structure, and the
  // stretch would turn sensor noise into fake glyph edges.
  if (high - low < 24) return null;
  // And above ~222 there is nothing left to win: the gain is under 1.15x, not
  // worth a second model call. Gated on the gain rather than on the exact
  // endpoints, since loose percentiles never return a clean 0..255.
  if (high - low > 222) return null;
  return [low, high];
}

/**
 * Grayscale + levels stretch, as a second chance for a read the model failed.
 *
 * Returns the input untouched when there is no headroom, so the caller can
 * skip a pointless second model call by comparing identity.
 */
export async function enhanceForOcr(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  ctx.drawImage(bitmap, 0, 0);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  const histogram = new Uint32Array(256);
  // Rec. 601 luma, integer-weighted — this is a preprocessing step, not colour
  // management, and the exact coefficients do not change what the model reads.
  for (let i = 0; i < px.length; i += 4) {
    const luma = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
    px[i] = px[i + 1] = px[i + 2] = luma;
    histogram[luma]++;
  }

  const range = levelRange(histogram);
  if (!range) return blob;
  const [low, high] = range;
  const scale = 255 / (high - low);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, (px[i] - low) * scale));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);

  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ?? blob), 'image/jpeg', 0.95);
  });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:image/jpeg;base64," prefix — Gemini wants raw base64.
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
