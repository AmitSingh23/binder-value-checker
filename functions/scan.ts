// Cloudflare Pages Function: POST /scan reads Pokémon cards in a photo.
//
// Body: { image: "data:image/jpeg;base64,..." , passcode?: string }
// Reply: { cards: [{ name, number, total }] }
//
// Uses Workers AI (free daily allowance). Needs a Workers AI binding named
// AI on the Pages project (Settings > Bindings). If a SCAN_PASSCODE
// variable is set on the project, requests must send the same passcode.

import type { ScanReply, ScannedCard } from "../shared/api";

const MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

// ~1.5 MB of base64 is plenty for a 1280px JPEG; reject anything bigger.
const MAX_IMAGE_CHARS = 1_500_000;

const PROMPT = `You are reading Pokémon trading cards in a photo.
For every card you can see, read:
- name: the card name printed at the top, exactly as printed, including suffixes like "ex", "EX", "GX", "V", "VMAX", "VSTAR" (e.g. "Charizard ex", "Umbreon VMAX").
- number: the collector number printed in a bottom corner, before the slash (e.g. "4" in "4/102", "TG12" in "TG12/TG30", "SV49" in "SV49/SV94"). Copy it exactly as printed, including letters and leading zeros.
- total: the number after the slash (e.g. "102"), or "" if there is no slash.
If you cannot read a value, use "".
Reply with JSON only, no other text, in exactly this shape:
{"cards":[{"name":"...","number":"...","total":"..."}]}
If there are no Pokémon cards in the photo, reply {"cards":[]}.`;

interface Env {
  AI: { run(model: string, input: unknown): Promise<unknown> };
  SCAN_PASSCODE?: string;
}

const text = (body: string, status: number) => new Response(body, { status });

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

// The model replies with text that should be JSON, but small models sometimes
// wrap it in ``` fences or add a sentence. Take the outermost {...}.
function parseCards(reply: unknown): ScannedCard[] | null {
  let data: unknown = reply;
  if (typeof reply === "string") {
    const start = reply.indexOf("{");
    const end = reply.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      data = JSON.parse(reply.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  const list = (data as { cards?: unknown })?.cards;
  if (!Array.isArray(list)) return null;
  return list
    .map((c) => ({ name: str(c?.name), number: str(c?.number), total: str(c?.total) }))
    .filter((c) => c.name || c.number);
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  if (!env.AI) return text("Workers AI isn't set up: add a Workers AI binding named AI to this Pages project.", 500);

  let body: { image?: unknown; passcode?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return text("Send JSON: { image }", 400);
  }
  if (!body || typeof body !== "object") return text("Send JSON: { image }", 400);

  if (env.SCAN_PASSCODE && body.passcode !== env.SCAN_PASSCODE) return text("Wrong passcode", 401);

  const image = body.image;
  if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
    return text("image must be a JPEG, PNG or WebP data URL", 400);
  }
  if (image.length > MAX_IMAGE_CHARS) return text("Image too large", 413);

  let result: unknown;
  try {
    result = await env.AI.run(MODEL, {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      max_tokens: 600,
      temperature: 0,
    });
  } catch (err) {
    // Includes running out of the free daily allowance.
    return text(`Card reader failed: ${err instanceof Error ? err.message : String(err)}`, 502);
  }

  const reply = (result as { response?: unknown })?.response;
  const cards = parseCards(reply);
  if (!cards) {
    const shown = typeof reply === "string" ? reply.slice(0, 300) : JSON.stringify(reply)?.slice(0, 300);
    return text(`Couldn't understand the card reader's reply: ${shown}`, 502);
  }

  return Response.json({ cards } satisfies ScanReply);
};
