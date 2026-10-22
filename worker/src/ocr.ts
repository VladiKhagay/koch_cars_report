import type { Context } from 'hono';
import type { Env } from './index';
import { getActiveAppUser } from './appUser';
import { rateLimited } from './rateLimit';

// Fixed set so the frontend can translate the reason. The backend only ever
// emits 'not_in_frame'; the wider union is kept for the deployed frontend.
export const OCR_REASONS = ['blurry', 'glare', 'dark', 'angle', 'obstructed', 'not_in_frame'] as const;
export type OcrReason = (typeof OCR_REASONS)[number];

const DEFAULT_MODEL = '@cf/moondream/moondream3.1-9B-A2B';

// Moondream is the only catalogue model with a `detect` task. The read model
// is swappable via OCR_MODEL.
const DETECT_MODEL = DEFAULT_MODEL;

// Transcription-biased prompts: the model only transcribes, validation below
// decides what counts as a usable read. The plate is requested as printed
// (dashes included) because that measured best and normalizePlate handles it.
const PROMPTS: Record<'plate' | 'vin', string> = {
  plate:
    'Read the license plate in this image. ' +
    'Answer with the characters exactly as printed, keeping the dashes. ' +
    'No explanations or any other text.',
  // VINs are photographed through glass, so the prompt names the reflections.
  vin:
    'Read the 17-character VIN in this image. ' +
    'The VIN is photographed through glass, so ignore reflections and glare and read the characters underneath. ' +
    'Return ONLY the 17 VIN characters. ' +
    'No spaces, hyphens, punctuation, explanations, or any other text. ' +
    'A VIN never contains the letters I, O or Q. ' +
    'Always make your best guess.',
};

const DETECT_TARGETS: Record<'plate' | 'vin', string> = {
  plate: 'license plate',
  vin: 'VIN sticker or stamped VIN plate',
};

/**
 * Bounding box in the model's own coordinate space (normalised or pixels —
 * unspecified), passed through untouched; the client knows the image size.
 */
export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Picks the largest plausible box out of Moondream's `detect` objects. */
export function parseDetectObjects(objects: unknown): OcrBox | null {
  if (!Array.isArray(objects)) return null;
  let best: OcrBox | null = null;
  let bestArea = 0;

  for (const raw of objects) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const nums = [o.x_min, o.y_min, o.x_max, o.y_max];
    if (!nums.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;

    // Tolerate corners in either order.
    const x0 = Math.min(o.x_min as number, o.x_max as number);
    const x1 = Math.max(o.x_min as number, o.x_max as number);
    const y0 = Math.min(o.y_min as number, o.y_max as number);
    const y1 = Math.max(o.y_min as number, o.y_max as number);

    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) continue;
    if (x0 < 0 || y0 < 0) continue;

    // A near-full-frame box crops to the original image. Pixel-space boxes are
    // filtered client-side, where the dimensions are known.
    const normalised = x1 <= 1.5 && y1 <= 1.5;
    if (normalised && w * h > 0.9) continue;

    const area = w * h;
    if (area > bestArea) {
      bestArea = area;
      best = { x0, y0, x1, y1 };
    }
  }
  return best;
}

export interface OcrOutcome {
  text: string | null;
  reason: OcrReason | null;
}

// Israeli plates are digits only, so any letter in a read is an OCR error and
// these substitutions are safe inside a mostly-numeric token.
const DIGIT_CONFUSIONS: Record<string, string> = {
  O: '0',
  D: '0',
  Q: '0',
  I: '1',
  L: '1',
  Z: '2',
  S: '5',
  B: '8',
  G: '6',
};

const PLATE_LENGTH = 8;

/**
 * Extracts an 8-digit Israeli plate from free model text, working on digit
 * runs so "123-45-678 on a 2019 Toyota" yields 12345678. A partial read is
 * rejected: it looks authoritative and gets submitted unchecked.
 */
export function normalizePlate(raw: string): string | null {
  // Repair digit confusions only in mostly-numeric tokens, never in prose.
  const repaired = raw
    .toUpperCase()
    .split(/\s+/)
    .map((token) => {
      const digits = (token.match(/\d/g) ?? []).length;
      if (digits < 2) return token;
      return token.replace(/[A-Z]/g, (ch) => DIGIT_CONFUSIONS[ch] ?? ch);
    })
    .join(' ');

  // Join separators between digits (including the middle dot plates are
  // printed with); the length check below rejects accidental welds.
  const joined = repaired.replace(/(\d)[\s.·•–-]+(?=\d)/g, '$1');

  const runs = joined.match(/\d+/g);
  if (!runs) return null;

  return runs.find((r) => r.length === PLATE_LENGTH) ?? null;
}

// I, O and Q are never valid in a VIN, so mapping them to digits is lossless.
// No other substitutions: 5/S and 8/B are both legal.
const VIN_CONFUSIONS: Record<string, string> = { I: '1', O: '0', Q: '0' };

export function normalizeVin(raw: string): string | null {
  // Work on tokens: stripping the whole string would weld prose into a
  // false-positive 17-character run.
  const tokens = raw
    .toUpperCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);

  // Join neighbouring tokens only when both contain a digit (prose never does).
  const candidates: string[] = [];
  for (const token of tokens) {
    const hasDigit = /\d/.test(token);
    const prev = candidates[candidates.length - 1];
    if (hasDigit && prev && /\d/.test(prev)) candidates[candidates.length - 1] = prev + token;
    else candidates.push(token);
  }

  for (const candidate of candidates) {
    const fixed = candidate.replace(/[IOQ]/g, (ch) => VIN_CONFUSIONS[ch]);
    const match = fixed.match(/^[A-HJ-NPR-Z0-9]{17}$/);
    if (match) return match[0];
  }
  return null;
}

/** Pure parser for the model's free-text answer — unit-tested in ocr.test.ts. */
export function parseOcrAnswer(raw: string, kind: 'plate' | 'vin'): OcrOutcome {
  const answer = raw.trim();
  if (!answer) return { text: null, reason: 'not_in_frame' };

  // Older deployments still emit "UNREADABLE <something>"; read what follows.
  const body = answer.replace(/^unreadable\b[\s:,-]*/i, '');

  const text = kind === 'plate' ? normalizePlate(body) : normalizeVin(body);
  return text ? { text, reason: null } : { text: null, reason: 'not_in_frame' };
}

interface OcrRequestBody {
  image: string; // base64, no data: prefix
  mimeType?: string; // defaults to image/jpeg
  kind: 'plate' | 'vin';
  /** 'detect' returns a bounding box to crop to; default 'query' reads text. */
  task?: 'query' | 'detect';
}

// Abuse cap: ~6MB of base64 is ~4.5MB of image.
const MAX_IMAGE_BASE64_LENGTH = 6 * 1024 * 1024;

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Unwraps the `{ result: {...} }` envelope the AI binding returns. */
function unwrap<T>(result: unknown): T {
  const r = result as { result?: T } & T;
  return (r?.result ?? r) as T;
}

export async function handleOcr(c: Context<{ Bindings: Env }>) {
  // The only route that reads nothing from Postgres, so it inherits no RLS
  // check: without this, a deactivated user's still-valid JWT could run the model.
  const limited = await rateLimited(c, c.env.OCR_LIMITER);
  if (limited) return limited;

  // Carasso is read-only and has no photo capture; it must not spend OCR quota.
  const caller = await getActiveAppUser(c);
  if (!caller || !['worker', 'manager', 'admin'].includes(caller.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = await c.req.json<OcrRequestBody>().catch(() => null);
  if (!body || !body.image || (body.kind !== 'plate' && body.kind !== 'vin')) {
    return c.json({ error: 'Expected { image: base64, kind: "plate" | "vin" }' }, 400);
  }
  if (body.image.length > MAX_IMAGE_BASE64_LENGTH) {
    return c.json({ error: 'Image too large' }, 413);
  }

  const mimeType = ALLOWED_MIME_TYPES.includes(body.mimeType ?? '') ? body.mimeType : 'image/jpeg';
  const dataUri = `data:${mimeType};base64,${body.image}`;

  if (body.task === 'detect') {
    try {
      // `stream: false` is required: without it the binding answers with {}.
      const result = await c.env.AI.run(DETECT_MODEL, {
        task: 'detect',
        image: dataUri,
        target: DETECT_TARGETS[body.kind],
        max_objects: 5,
        stream: false,
      });
      const { objects } = unwrap<{ objects?: unknown }>(result);
      const box = parseDetectObjects(objects);
      // Log the raw response when nothing parses: "no plate found" and "boxes
      // under a different key" need different fixes.
      console.log(
        'OCR detect',
        body.kind,
        box ? JSON.stringify(box) : `none raw=${JSON.stringify(result ?? null).slice(0, 400)}`,
      );
      return c.json({ box });
    } catch (err) {
      // Detection is only an optimisation — the client re-reads the full frame.
      console.error('Workers AI detect error', err);
      return c.json({ box: null });
    }
  }

  let raw = '';
  try {
    const result = await c.env.AI.run(c.env.OCR_MODEL || DEFAULT_MODEL, {
      task: 'query',
      image: dataUri,
      question: PROMPTS[body.kind],
      reasoning: false,
      temperature: 0,
      max_tokens: 64,
      stream: false,
    });
    raw = unwrap<{ answer?: string }>(result).answer ?? '';
  } catch (err) {
    // OCR is an accelerator, not a dependency: fail cleanly so the client
    // falls back to manual entry.
    console.error('Workers AI OCR error', err);
    return c.json({ error: 'ocr_unavailable' }, 502);
  }

  const outcome = parseOcrAnswer(raw, body.kind);
  // Length only, never the plate/VIN. The image size shows whether the model
  // got a crop (hundreds of KB) or the whole frame (megabytes).
  console.log(
    'OCR read',
    body.kind,
    body.image.length,
    outcome.text ? `ok len=${outcome.text.length}` : `unreadable len=${raw.length}`,
  );
  return c.json(outcome);
}
