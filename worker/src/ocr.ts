import type { Context } from 'hono';
import type { Env } from './index';

const PROMPTS: Record<'plate' | 'vin', string> = {
  plate:
    'This photo shows a vehicle license plate. Return ONLY the plate number as printed, ' +
    'with no extra words, no punctuation explanation, uppercase, keeping any hyphens/spaces ' +
    'exactly as shown. If unreadable, return exactly: UNREADABLE',
  vin:
    'This photo shows a vehicle VIN (17-character Vehicle Identification Number), typically on a ' +
    'sticker or stamped plate. Return ONLY the 17-character VIN, uppercase, no spaces, no other text. ' +
    'The VIN never contains the letters I, O, or Q. If unreadable, return exactly: UNREADABLE',
};

interface OcrRequestBody {
  image: string; // base64, no data: prefix
  mimeType?: string; // defaults to image/jpeg
  kind: 'plate' | 'vin';
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
        generationConfig: { temperature: 0, maxOutputTokens: 32 },
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
  const text = raw.trim().toUpperCase();

  if (!text || text === 'UNREADABLE') {
    return c.json({ text: null });
  }
  return c.json({ text });
}
