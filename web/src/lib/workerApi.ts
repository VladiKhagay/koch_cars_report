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
 * OCR is an accelerator, never a dependency: any failure (network, quota)
 * resolves to a null result so the caller falls back to manual entry
 * instead of blocking the worker's submission. When Gemini itself could
 * read the photo but the text wasn't legible, `reason` carries why, so the
 * UI can say something more useful than silently leaving the field blank.
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

async function readOcr(image: Blob, kind: 'plate' | 'vin'): Promise<OcrOutcome> {
  const data = (await postOcr(image, kind, 'query')) as { text: string | null; reason: OcrReason | null };
  return { text: data.text, reason: data.reason };
}

/**
 * Reads a plate or VIN out of a captured photo.
 *
 * `image` should be the highest-resolution copy available — the camera original,
 * not the downscaled upload. A plate is ~190px wide in a whole-car shot at
 * 4000px, and half that once the photo has been shrunk for upload; those are the
 * pixels the whole crop-and-read detour exists to keep. Detection itself runs on
 * a small copy, since locating a plate needs far less resolution than reading
 * one, and uploading the original twice over mobile data is what the field
 * actually feels.
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

    // Nothing came back. A VIN under the windscreen is usually dark glyphs in a
    // reflected wash, and a plate in direct sun is the same problem inverted —
    // both survive a levels stretch. Only worth a second call when the stretch
    // actually changed something.
    const enhanced = await enhanceForOcr(target);
    if (enhanced === target) return first;
    const second = await readOcr(enhanced, kind);
    return second.text ? second : first;
  } catch {
    return { text: null, reason: null };
  }
}

/**
 * Why a photo could not be shown. The viewer used to be told only "no url",
 * so its one empty state blamed the 90-day expiry for everything — including
 * photos that were never uploaded and sessions that had simply expired.
 */
export type PhotoFailure =
  /** The Worker has no object at this key: never uploaded, or expired. */
  | 'missing'
  /** Token rejected or the job isn't visible to this user. */
  | 'denied'
  /** Network, or the Worker itself failed. Worth retrying. */
  | 'failed';

export type PhotoResult = { url: string } | { failure: PhotoFailure };

/** Fetches a private R2 photo through the Worker and returns a local object URL. */
export async function fetchPhotoUrl(jobId: string, kind: PhotoKind): Promise<PhotoResult> {
  // Resolved separately from the request: authHeader() throws when there is no
  // session, and folding that into the network catch below would tell someone
  // whose login had lapsed to go and check their connection.
  let authorization: string;
  try {
    authorization = await authHeader();
  } catch {
    return { failure: 'denied' };
  }

  try {
    const res = await fetch(`${BASE_URL}/photo/${jobId}/${kind}`, { headers: { Authorization: authorization } });
    if (res.ok) return { url: URL.createObjectURL(await res.blob()) };
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
 * Activates or deactivates a user.
 *
 * Goes through the Worker rather than calling set_user_active directly,
 * because deactivating has to reach two places: the `active` column that RLS
 * reads, and the Supabase auth account itself. Without the second, a former
 * employee keeps a refresh token that renews forever — locked out of the data,
 * but still holding a valid token. The Worker calls the same RPC with this
 * caller's JWT, so who may deactivate whom is still decided in Postgres.
 *
 * `sessionRevoked: false` means the profile change landed but the auth account
 * was not banned — worth surfacing, since the user can still authenticate.
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

export async function uploadPhoto(jobId: string, kind: PhotoKind, image: Blob): Promise<string> {
  const res = await fetch(`${BASE_URL}/upload?jobId=${encodeURIComponent(jobId)}&kind=${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', Authorization: await authHeader() },
    body: image,
  });
  if (!res.ok) throw new Error(`Photo upload failed (${res.status})`);
  const data = (await res.json()) as { key: string };
  return data.key;
}
