import { supabase } from './supabase';
import { blobToBase64 } from './image';

const BASE_URL = import.meta.env.VITE_WORKER_URL;

async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return `Bearer ${token}`;
}

/**
 * OCR is an accelerator, never a dependency: any failure (network, quota,
 * unreadable image) resolves to `null` so the caller falls back to manual
 * entry instead of blocking the worker's submission.
 */
export async function ocrPhoto(image: Blob, kind: 'plate' | 'vin'): Promise<string | null> {
  try {
    const base64 = await blobToBase64(image);
    const res = await fetch(`${BASE_URL}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: await authHeader() },
      body: JSON.stringify({ image: base64, mimeType: 'image/jpeg', kind }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text: string | null };
    return data.text;
  } catch {
    return null;
  }
}

/** Fetches a private R2 photo through the Worker and returns a local object URL. */
export async function fetchPhotoUrl(jobId: string, kind: 'plate' | 'vin'): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/photo/${jobId}/${kind}`, {
      headers: { Authorization: await authHeader() },
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export async function uploadPhoto(jobId: string, kind: 'plate' | 'vin', image: Blob): Promise<string> {
  const res = await fetch(`${BASE_URL}/upload?jobId=${encodeURIComponent(jobId)}&kind=${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', Authorization: await authHeader() },
    body: image,
  });
  if (!res.ok) throw new Error(`Photo upload failed (${res.status})`);
  const data = (await res.json()) as { key: string };
  return data.key;
}
