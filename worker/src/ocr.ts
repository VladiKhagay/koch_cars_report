import type { Context } from 'hono';
import type { Env } from './index';

const PROMPTS: Record<'plate' | 'vin', string> = {
  plate: 'This photo shows a vehicle license plate. Read the plate number exactly as printed, keeping any hyphens/spaces.',
  vin:
    'This photo shows a vehicle VIN (17-character Vehicle Identification Number), typically on a ' +
    'sticker or stamped plate. The VIN never contains the letters I, O, or Q.',
};

// Fixed set rather than free text so the frontend can translate the reason
// instead of showing raw English model output to Russian-speaking workers.
const OCR_REASONS = ['blurry', 'glare', 'dark', 'angle', 'obstructed', 'not_in_frame', 'none'] as const;
type OcrReason = (typeof OCR_REASONS)[number];

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    readable: { type: 'BOOLEAN', description: 'true only if the requested text is clearly legible in the photo' },
    text: { type: 'STRING', description: 'the extracted text exactly as printed, uppercase; empty string if not readable' },
    reason: {
      type: 'STRING',
      enum: OCR_REASONS as unknown as string[],
      description: 'why the text could not be read; use "none" when readable is true',
    },
  },
  required: ['readable', 'text', 'reason'],
};

interface OcrRequestBody {
  image: string; // base64, no data: prefix
  mimeType?: string; // defaults to image/jpeg
  kind: 'plate' | 'vin';
}

interface OcrResult {
  readable?: boolean;
  text?: string;
  reason?: OcrReason;
}

export async function handleOcr(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<OcrRequestBody>().catch(() => null);
  if (!body || !body.image || (body.kind !== 'plate' && body.kind !== 'vin')) {
    return c.json({ error: 'Expected { image: base64, kind: "plate" | "vin" }' }, 400);
  }

  const mimeType = body.mimeType ?? 'image/jpeg';
  const prompt = PROMPTS[body.kind];
  // Google has no auto-updating "latest" alias for Gemini models — pinned
  // model names get deprecated on their own schedule (this one already
  // broke once). Kept as a plain var (not a secret) so a future deprecation
  // is a `wrangler deploy` config change, not a code change.
  const model = c.env.GEMINI_MODEL || 'gemini-3.6-flash';

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${c.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: body.image } }],
          },
        ],
        generationConfig: {
          temperature: 0,
          // Generous headroom: Gemini 3 Flash can't fully disable thinking
          // (thinkingLevel "low" still reasons a little), and those tokens
          // count against this same budget — too small a cap is exactly
          // what caused OCR to return nothing despite a 200 OK earlier.
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          // thinkingBudget (the 2.5-series field) doesn't exist on 3.x
          // models and made the request 400 — thinkingLevel is the 3.x
          // equivalent. This is a plain extraction task, so the lowest
          // level is enough; "off" isn't offered on Flash.
          thinkingConfig: { thinkingLevel: 'low' },
        },
      }),
    },
  );

  if (!res.ok) {
    // OCR is an accelerator, not a dependency — surface a clean failure so
    // the client falls back to manual entry rather than retry-looping.
    console.error('Gemini OCR error', res.status, await res.text().catch(() => ''));
    return c.json({ error: 'ocr_unavailable' }, 502);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  let parsed: OcrResult = {};
  try {
    parsed = JSON.parse(raw) as OcrResult;
  } catch {
    console.error('Gemini OCR: non-JSON response', raw);
  }

  const text = parsed.text?.trim().toUpperCase();
  if (!parsed.readable || !text) {
    const reason = parsed.reason && parsed.reason !== 'none' ? parsed.reason : 'not_in_frame';
    return c.json({ text: null, reason });
  }
  return c.json({ text, reason: null });
}
