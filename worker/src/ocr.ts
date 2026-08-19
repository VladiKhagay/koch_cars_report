import type { Context } from 'hono';
import type { Env } from './index';
import { getActiveAppUser } from './appUser';
import { rateLimited } from './rateLimit';

// Kept as a fixed set so the frontend can translate the reason instead of
// showing raw English model output. The VLM is no longer asked to classify
// *why* a read failed — it cannot do that reliably — so the backend now only
// ever emits 'not_in_frame', meaning "no usable value came back". The wider
// union stays for wire compatibility with the deployed frontend.
export const OCR_REASONS = ['blurry', 'glare', 'dark', 'angle', 'obstructed', 'not_in_frame'] as const;
export type OcrReason = (typeof OCR_REASONS)[number];

const DEFAULT_MODEL = '@cf/moondream/moondream3.1-9B-A2B';

// Moondream is the only model in the Workers AI catalogue exposing a `detect`
// task, so detection stays pinned to it. The read step is swappable via the
// OCR_MODEL var (e.g. @cf/meta/llama-3.2-11b-vision-instruct) so accuracy can
// be compared on real photos without a code change — no catalogue model is
// OCR-specialised, so which VLM reads small text best is an empirical question.
const DETECT_MODEL = DEFAULT_MODEL;

// Transcription-biased prompts. The old prompts offered `UNREADABLE <reason>`
// as an explicit escape hatch and the model took it on nearly every whole-car
// photo. Validation below decides what counts as a usable read; the model's
// only job is to transcribe.
const PROMPTS: Record<'plate' | 'vin', string> = {
  plate:
    'Read the Israeli vehicle license plate in this image. ' +
    'Israeli plates are 8 digits, no letters. ' +
    'Return ONLY the 8 plate digits. ' +
    'Do not include spaces, hyphens, punctuation, explanations, or any other text. ' +
    'Always make your best guess.',
  // The VIN plate sits under the windscreen, so nearly every real photo has
  // reflections across it. Naming that in the prompt stops the model treating
  // the glare as the subject and answering about it.
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
 * Bounding box in whatever coordinate space the model returned. Moondream's
 * documented schema (verified against the live model-schema API) is
 * x_min/y_min/x_max/y_max, but does not state whether values are normalised
 * 0..1 or absolute pixels — so the box is passed through untouched and the
 * client, which knows the real image dimensions, decides. See
 * `boxToCropRect()` in the frontend.
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

    // Tolerate a model that emits the corners in either order.
    const x0 = Math.min(o.x_min as number, o.x_max as number);
    const x1 = Math.max(o.x_min as number, o.x_max as number);
    const y0 = Math.min(o.y_min as number, o.y_max as number);
    const y1 = Math.max(o.y_min as number, o.y_max as number);

    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) continue; // zero-size / negative
    if (x0 < 0 || y0 < 0) continue; // outside the frame

    // A box covering essentially the whole frame carries no information — it
    // would crop to the original image. Only meaningful for normalised coords;
    // pixel-space boxes are filtered client-side where the dimensions are known.
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

// Israeli civilian plates are digits only (verified: 8-digit XXX-XX-XXX since
// July 2017, 7-digit XX-XXX-XX from 1980-2017, plus older 5- and 6-digit
// plates still in service). Any letter in a plate read is therefore an OCR
// error, which makes these substitutions safe *inside a mostly-numeric token*.
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
 * Extracts an Israeli plate from free model text.
 *
 * Works on digit *runs* rather than stripping all non-digits globally, so
 * "123-45-678 on a 2019 Toyota" yields 12345678 and not 123456782019.
 *
 * Only a full 8-digit read counts: a partial read is worse than no read, since
 * it looks authoritative in the field and gets submitted unchecked. Digits are
 * returned unformatted — plates are stored and shown without separators.
 */
export function normalizePlate(raw: string): string | null {
  // Repair digit-confusions only within tokens that are already mostly
  // numeric, so prose ("visible", "plate") is never mangled into digits.
  const repaired = raw
    .toUpperCase()
    .split(/\s+/)
    .map((token) => {
      const digits = (token.match(/\d/g) ?? []).length;
      if (digits < 2) return token;
      return token.replace(/[A-Z]/g, (ch) => DIGIT_CONFUSIONS[ch] ?? ch);
    })
    .join(' ');

  // Join separators that sit *between* digits, so a printed "123-45-678"
  // becomes one run while unrelated numbers stay separate.
  const joined = repaired.replace(/(\d)[\s.–-]+(?=\d)/g, '$1');

  const runs = joined.match(/\d+/g);
  if (!runs) return null;

  return runs.find((r) => r.length === PLATE_LENGTH) ?? null;
}

// I, O and Q are not valid VIN characters, so mapping them onto the digits
// they are misread as is lossless — a VIN can never legitimately contain them.
// No other substitutions are applied: 5/S and 8/B are both legal in a VIN, so
// "correcting" those would silently corrupt valid values.
const VIN_CONFUSIONS: Record<string, string> = { I: '1', O: '0', Q: '0' };

export function normalizeVin(raw: string): string | null {
  // Work on tokens, never on the whole string: stripping every non-alphanumeric
  // globally welds prose into a false positive — "I can see a car but no VIN
  // sticker" collapses to a 17-character run that looks exactly like a VIN.
  const tokens = raw
    .toUpperCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);

  // A printed VIN is sometimes read back in space-separated groups, so join
  // neighbouring tokens — but only when both contain a digit, which prose
  // words never do.
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

  // Older deployments (and the occasional stubborn model) still emit
  // "UNREADABLE <something>"; drop the keyword and read whatever follows.
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

// ~6MB of base64 ≈ 4.5MB image — well above the ~1920px JPEGs the app sends;
// this cap only exists to stop abuse of the endpoint.
const MAX_IMAGE_BASE64_LENGTH = 6 * 1024 * 1024;

/** Unwraps the `{ result: {...} }` envelope the AI binding actually returns. */
function unwrap<T>(result: unknown): T {
  const r = result as { result?: T } & T;
  return (r?.result ?? r) as T;
}

export async function handleOcr(c: Context<{ Bindings: Env }>) {
  /*
   * The only route that reads nothing from Postgres, and therefore the only
   * one that inherits no authorization from RLS. Everything else here ends in
   * a query whose policies run through current_app_user() and fail closed for
   * a deactivated account; this one would otherwise run a 9B vision model on
   * the strength of a valid signature alone — which a former employee's
   * auto-refreshing token keeps producing indefinitely.
   */
  const limited = await rateLimited(c, c.env.OCR_LIMITER);
  if (limited) return limited;

  if (!(await getActiveAppUser(c))) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = await c.req.json<OcrRequestBody>().catch(() => null);
  if (!body || !body.image || (body.kind !== 'plate' && body.kind !== 'vin')) {
    return c.json({ error: 'Expected { image: base64, kind: "plate" | "vin" }' }, 400);
  }
  if (body.image.length > MAX_IMAGE_BASE64_LENGTH) {
    return c.json({ error: 'Image too large' }, 413);
  }

  const mimeType = body.mimeType ?? 'image/jpeg';
  const dataUri = `data:${mimeType};base64,${body.image}`;

  if (body.task === 'detect') {
    try {
      // `detect` does not support streaming, so no `stream` flag is sent.
      const result = await c.env.AI.run(DETECT_MODEL, {
        task: 'detect',
        image: dataUri,
        target: DETECT_TARGETS[body.kind],
        max_objects: 5,
      });
      const { objects } = unwrap<{ objects?: unknown }>(result);
      return c.json({ box: parseDetectObjects(objects) });
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
    // OCR is an accelerator, not a dependency — surface a clean failure so
    // the client falls back to manual entry rather than retry-looping.
    console.error('Workers AI OCR error', err);
    return c.json({ error: 'ocr_unavailable' }, 502);
  }

  const outcome = parseOcrAnswer(raw, body.kind);
  /*
   * The one failure that used to leave no trace anywhere. An exception is
   * logged above, but the common case is quieter: the model answers, the
   * answer does not survive normalisation, and the worker is told "couldn't
   * read it" while nothing records WHAT came back — so "it didn't read the
   * plate" could not be diagnosed from the logs at all. A plate that arrives
   * one digit short, or carrying a letter the confusion table does not cover,
   * looks identical from outside to a photo the model never saw.
   *
   * Failures only, and only the first 120 characters: the value is a plate or
   * a VIN, which is already stored in Postgres, and this is the shortest thing
   * that makes the next report answerable.
   */
  if (!outcome.text) {
    console.log('OCR unparsed', body.kind, JSON.stringify(raw.slice(0, 120)));
  }
  return c.json(outcome);
}
