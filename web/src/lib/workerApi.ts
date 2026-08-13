import { supabase } from './supabase';
import { blobToBase64, cropToBox, type DetectBox } from './image';
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

export async function ocrPhoto(image: Blob, kind: 'plate' | 'vin'): Promise<OcrOutcome> {
  try {
    // Workers photograph the whole car, so the plate is a small patch of the
    // frame. Locate it first and read a tight crop; if detection fails we just
    // read the full frame as before.
    let target = image;
    try {
      const { box } = (await postOcr(image, kind, 'detect')) as { box: DetectBox | null };
      if (box) target = await cropToBox(image, box);
    } catch {
      /* detection is best-effort */
    }

    const data = (await postOcr(target, kind, 'query')) as {
      text: string | null;
      reason: OcrReason | null;
    };
    return { text: data.text, reason: data.reason };
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
