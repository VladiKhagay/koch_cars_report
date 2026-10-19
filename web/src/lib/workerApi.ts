import { supabase } from './supabase';
import {
  blobToBase64,
  cropToBox,
  downscaleImage,
  enhanceForOcr,
  imageSize,
  normalizeBox,
  type DetectBox,
} from './image';
import type { PhotoKind } from './types';

const BASE_URL = import.meta.env.VITE_WORKER_URL;

async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return `Bearer ${token}`;
}

export type OcrReason = 'blurry' | 'glare' | 'dark' | 'angle' | 'obstructed' | 'not_in_frame';

export interface OcrOutcome {
  text: string | null;
  /** Fixed reason code (translatable), set only when text is null. */
  reason: OcrReason | null;
}

/**
 * OCR is an accelerator, never a dependency: any failure resolves to a null
 * result so the caller falls back to manual entry. `reason` says why a read failed.
 */
async function postOcr(image: Blob, kind: 'plate' | 'vin', task: 'query' | 'detect'): Promise<unknown> {
  const base64 = await blobToBase64(image);
  const res = await fetch(`${BASE_URL}/ocr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: await authHeader() },
    body: JSON.stringify({ image: base64, mimeType: 'image/jpeg', kind, task }),
  });
  if (!res.ok) throw new Error(`ocr ${task} failed: ${res.status}`);
  return res.json();
}

/**
 * Largest encoded image sent to /ocr (the Worker caps at ~4.5MB of image).
 * Reads run on the camera original, which can exceed that, so it is downscaled
 * to 2560px first - still far more pixels on the plate than the upload copy.
 */
const MAX_OCR_BYTES = 4 * 1024 * 1024;

async function fitForOcr(image: Blob): Promise<Blob> {
  if (image.size <= MAX_OCR_BYTES) return image;
  try {
    return await downscaleImage(image, 2560, 0.85);
  } catch {
    // Nothing is gained by refusing here: the Worker's own limit still applies,
    // and a rejection now surfaces as an unusable read rather than silently.
    return image;
  }
}

async function readOcr(image: Blob, kind: 'plate' | 'vin'): Promise<OcrOutcome> {
  const data = (await postOcr(await fitForOcr(image), kind, 'query')) as {
    text: string | null;
    reason: OcrReason | null;
  };
  return { text: data.text, reason: data.reason };
}

/**
 * Reads a plate or VIN out of a captured photo. Pass the highest-resolution
 * copy (the camera original): a plate is ~190px wide in a whole-car shot.
 * Detection runs on a small copy, since locating needs less resolution than reading.
 */
export async function ocrPhoto(image: Blob, kind: 'plate' | 'vin'): Promise<OcrOutcome> {
  try {
    let target = image;
    try {
      const small = await downscaleImage(image, 1024, 0.9);
      const { box } = (await postOcr(small, kind, 'detect')) as { box: DetectBox | null };
      if (box) {
        const { width, height } = await imageSize(small);
        target = await cropToBox(image, normalizeBox(box, width, height));
      }
    } catch {
      /* detection is best-effort */
    }

    const first = await readOcr(target, kind);
    if (first.text) return first;

    // Nothing came back. A levels stretch helps glare and reflections; only worth a call if it changed something.
    const enhanced = await enhanceForOcr(target);
    if (enhanced !== target) {
      const second = await readOcr(enhanced, kind);
      if (second.text) return second;
    }

    // Last rung: the uncropped frame. A crop that loses a digit loses it on both
    // attempts above, so the full frame is the only genuinely different input.
    if (target !== image) {
      const third = await readOcr(image, kind);
      if (third.text) return third;
    }
    return first;
  } catch {
    // A read that never completed (413, 429, dropped connection) is an unusable
    // read: without a reason the capture tile shows a green tick over an empty field.
    return { text: null, reason: 'not_in_frame' };
  }
}

/** Why a photo could not be shown, so the viewer doesn't blame the 90-day expiry for everything. */
export type PhotoFailure =
  /** The Worker has no object at this key: never uploaded, or expired. */
  | 'missing'
  /** Token rejected or the job isn't visible to this user. */
  | 'denied'
  /** Network, or the Worker itself failed. Worth retrying. */
  | 'failed';

/** `type` is what the Worker sniffed at upload — the video download names its extension from it. */
export type PhotoResult = { url: string; type: string } | { failure: PhotoFailure };

/** Fetches a private R2 photo through the Worker and returns a local object URL. */
export async function fetchPhotoUrl(jobId: string, kind: PhotoKind): Promise<PhotoResult> {
  // Separate from the request: a lapsed login must not read as a network problem.
  let authorization: string;
  try {
    authorization = await authHeader();
  } catch {
    return { failure: 'denied' };
  }

  try {
    const res = await fetch(`${BASE_URL}/photo/${jobId}/${kind}`, { headers: { Authorization: authorization } });
    if (res.ok) {
      const blob = await res.blob();
      return { url: URL.createObjectURL(blob), type: blob.type };
    }
    if (res.status === 404) return { failure: 'missing' };
    if (res.status === 401 || res.status === 403) return { failure: 'denied' };
    return { failure: 'failed' };
  } catch {
    return { failure: 'failed' };
  }
}

/** Admin-only: send an email invitation and pre-create the user's profile. */
export async function inviteUser(input: {
  email: string;
  name: string;
  role: 'worker' | 'manager' | 'admin';
  siteId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${BASE_URL}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: await authHeader() },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? `invite failed (${res.status})` };
    return { ok: true };
  } catch {
    return { ok: false, error: 'network error' };
  }
}

/**
 * Activates or deactivates a user via the Worker, which also bans the Supabase
 * auth account so a former employee's refresh token stops working. Who may
 * deactivate whom is still decided in Postgres. `sessionRevoked: false` means
 * the profile changed but the user can still authenticate.
 */
export async function setUserActive(
  userId: string,
  active: boolean,
): Promise<{ ok: true; sessionRevoked: boolean } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${BASE_URL}/user-active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: await authHeader() },
      body: JSON.stringify({ userId, active }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; sessionRevoked?: boolean };
    if (!res.ok) return { ok: false, error: data.error ?? `failed (${res.status})` };
    return { ok: true, sessionRevoked: data.sessionRevoked ?? false };
  } catch {
    return { ok: false, error: 'network error' };
  }
}

/** Thrown by uploadPhoto so callers can tell a permanent 4xx from a transient failure. See isPermanentError in jobs.ts. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function uploadPhoto(jobId: string, kind: PhotoKind, image: Blob): Promise<string> {
  const res = await fetch(`${BASE_URL}/upload?jobId=${encodeURIComponent(jobId)}&kind=${kind}`, {
    method: 'POST',
    // Informational only: the Worker decides the type from the bytes.
    headers: { 'Content-Type': image.type || 'application/octet-stream', Authorization: await authHeader() },
    body: image,
  });
  if (!res.ok) throw new HttpError(res.status, `Photo upload failed (${res.status})`);
  const data = (await res.json()) as { key: string };
  return data.key;
}
