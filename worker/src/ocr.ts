import type { Context } from 'hono';
import type { Env } from './index';

// Fixed set rather than free text so the frontend can translate the reason
// instead of showing raw English model output to Russian-speaking workers.
export const OCR_REASONS = ['blurry', 'glare', 'dark', 'angle', 'obstructed', 'not_in_frame'] as const;
export type OcrReason = (typeof OCR_REASONS)[number];

const MOONDREAM_MODEL = '@cf/moondream/moondream3.1-9B-A2B';

// Moondream's `query` task returns free text (no JSON-schema enforcement),
// so the prompt pins a strict answer format and parseOcrAnswer() below is
// deliberately tolerant of the small deviations a compact model produces
// (quotes, trailing periods, "the plate is..." preambles).
const PROMPTS: Record<'plate' | 'vin', string> = {
  plate:
    'Read the vehicle license plate number in this photo. ' +
    'Answer with ONLY the plate characters exactly as printed (keep hyphens/spaces). ' +
    `If you cannot read it, answer with only: UNREADABLE <reason>, where <reason> is one of: ${OCR_REASONS.join(', ')}.`,
  vin:
    'Read the vehicle VIN (17-character Vehicle Identification Number) in this photo, usually on a sticker or stamped plate. ' +
    'It never contains the letters I, O, or Q. Answer with ONLY the 17 VIN characters, no spaces. ' +
    `If you cannot read it, answer with only: UNREADABLE <reason>, where <reason> is one of: ${OCR_REASONS.join(', ')}.`,
};

export interface OcrOutcome {
  text: string | null;
  reason: OcrReason | null;
}

/** Pure parser for the model's free-text answer — unit-tested in ocr.test.ts. */
export function parseOcrAnswer(raw: string, kind: 'plate' | 'vin'): OcrOutcome {
  let answer = raw.trim();
  if (!answer) return { text: null, reason: 'not_in_frame' };

  // Strip wrapping quotes/backticks and a trailing period.
  answer = answer.replace(/^["'`]+|["'`.]+$/g, '').trim();

  if (/^unreadable\b/i.test(answer)) {
    const rest = answer.replace(/^unreadable[\s:,-]*/i, '').trim().toLowerCase();
    const reason = OCR_REASONS.find((r) => rest.startsWith(r) || rest.includes(r));
    return { text: null, reason: reason ?? 'not_in_frame' };
  }

  // Compact models sometimes preamble ("The plate reads A123BC77"). Take the
  // last "word run" of plausible plate/VIN characters.
  let text = answer.toUpperCase();
  if (kind === 'vin') {
    const match = text.match(/[A-HJ-NPR-Z0-9]{17}/);
    if (!match) return { text: null, reason: 'not_in_frame' };
    text = match[0];
  } else {
    // Plates: keep alphanumerics plus separators; drop everything before a
    // colon-style preamble if present.
    const afterColon = text.includes(':') ? text.slice(text.lastIndexOf(':') + 1) : text;
    text = afterColon.replace(/[^A-Z0-9\s-]/g, '').trim();
    if (!text || text.length > 12) return { text: null, reason: 'not_in_frame' };
  }
  return { text, reason: null };
}

interface OcrRequestBody {
  image: string; // base64, no data: prefix
  mimeType?: string; // defaults to image/jpeg
  kind: 'plate' | 'vin';
}

// ~6MB of base64 ≈ 4.5MB image — far above the ~250KB downscaled photos the
// app actually sends; this cap only exists to stop abuse of the endpoint.
const MAX_IMAGE_BASE64_LENGTH = 6 * 1024 * 1024;

export async function handleOcr(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<OcrRequestBody>().catch(() => null);
  if (!body || !body.image || (body.kind !== 'plate' && body.kind !== 'vin')) {
    return c.json({ error: 'Expected { image: base64, kind: "plate" | "vin" }' }, 400);
  }
  if (body.image.length > MAX_IMAGE_BASE64_LENGTH) {
    return c.json({ error: 'Image too large' }, 413);
  }

  const mimeType = body.mimeType ?? 'image/jpeg';

  let raw = '';
  try {
    const result = (await c.env.AI.run(MOONDREAM_MODEL, {
      task: 'query',
      image: `data:${mimeType};base64,${body.image}`,
      question: PROMPTS[body.kind],
      reasoning: false,
      temperature: 0,
      max_tokens: 128,
      stream: false,
    })) as { answer?: string };
    raw = result.answer ?? '';
  } catch (err) {
    // OCR is an accelerator, not a dependency — surface a clean failure so
    // the client falls back to manual entry rather than retry-looping.
    console.error('Workers AI OCR error', err);
    return c.json({ error: 'ocr_unavailable' }, 502);
  }

  const outcome = parseOcrAnswer(raw, body.kind);
  return c.json(outcome);
}
