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
 * Crops to the detected box and upscales, so the plate fills the frame the
 * model sees. A plate is only ~190px wide in a whole-car shot; cropping to it
 * is what makes OCR viable at all.
 */
export async function cropToBox(file: File | Blob, box: DetectBox, outWidth = 768): Promise<Blob> {
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
