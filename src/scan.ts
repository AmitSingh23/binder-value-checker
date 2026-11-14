// Adding cards from photos. POST /scan (functions/scan.ts) reads them with Workers AI.

import type { ScanReply, ScanRequest, ScannedCard } from "../shared/api";
import { STORAGE_KEYS } from "./constants";
import { setStatus, ui } from "./dom";
import { saveList } from "./state";
import { context2d, errorMessage, InOrder, plural, runInParallel, store } from "./util";

const SCAN_MAX_SIDE = 1280; // px; enough to read the collector number
const PARALLEL_SCANS = 3;

let passcode = store.get(STORAGE_KEYS.scanPasscode, ""); // kept in memory even if storage is blocked

export type ScanOutcome = { cards: ScannedCard[] } | { error: string };

/** Shrink a photo and return it as a JPEG data URL. */
async function photoToDataURL(photo: Blob): Promise<string> {
  const bitmap = await createImageBitmap(photo, { imageOrientation: "from-image" });
  const scale = Math.min(1, SCAN_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  context2d(canvas).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Reads the cards in a photo. Asks for the passcode once if the server wants one. */
async function scanPhoto(photo: Blob): Promise<ScannedCard[]> {
  const image = await photoToDataURL(photo);
  for (let attempt = 0; attempt < 2; attempt++) {
    const body: ScanRequest = { image, passcode };
    const res = await fetch("/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 401 && attempt === 0) {
      const entered = prompt("Passcode for adding cards from photos:");
      if (!entered) throw new Error("No passcode entered");
      passcode = entered.trim();
      store.set(STORAGE_KEYS.scanPasscode, passcode);
      continue;
    }
    if (!res.ok) throw new Error((await res.text()) || `Scan failed (${res.status})`);
    return ((await res.json()) as ScanReply).cards ?? [];
  }
  throw new Error("Wrong passcode");
}

/** Like scanPhoto, but a failure comes back as { error } instead of throwing. */
export async function readCards(photo: Blob): Promise<ScanOutcome> {
  try {
    return { cards: await scanPhoto(photo) };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** "Pikachu ex 238/191 set:SSP"; the total and set code only when the card showed them. */
export function cardLine(c: ScannedCard): string {
  const number = c.total ? `${c.number}/${c.total}` : c.number;
  const set = c.set ? `set:${c.set}` : "";
  return [c.name, number, set].filter(Boolean).join(" ");
}

/** Appends lines to the end of the list. */
export function addLines(lines: string[]) {
  const current = ui.cardsInput.value.replace(/\s+$/, "");
  ui.cardsInput.value = (current ? current + "\n" : "") + lines.join("\n");
  saveList();
}

/** Takes lines back off the list: for each, the last line that matches it exactly. */
export function removeLines(lines: string[]) {
  if (!lines.length) return;
  const current = ui.cardsInput.value.split("\n");
  for (const line of lines) {
    const i = current.lastIndexOf(line);
    if (i >= 0) current.splice(i, 1);
  }
  ui.cardsInput.value = current.join("\n");
  saveList();
}

/** "Add from photos": read each photo and add its cards to the list, in the order picked. */
export async function scanFiles(files: File[]) {
  const photos = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
  if (!photos.length) return;

  let added = 0;
  const problems: string[] = [];

  // Photos finish out of order; write them to the list in the order they were picked.
  const results = new InOrder<ScanOutcome>((outcome, i) => {
    const name = photos[i]!.name || `photo ${i + 1}`;
    if ("error" in outcome) problems.push(`${name}: ${outcome.error}`);
    else if (!outcome.cards.length) problems.push(`${name}: no cards found`);
    else {
      addLines(outcome.cards.map(cardLine));
      added += outcome.cards.length;
    }
  });

  const showProgress = () =>
    setStatus(`Reading photos: ${results.finished} of ${photos.length} done, ${plural(added, "card")} added…`);

  ui.scanButton.disabled = true;
  showProgress();

  await runInParallel(photos.length, PARALLEL_SCANS, async (i) => {
    results.set(i, await readCards(photos[i]!));
    showProgress();
  });

  ui.scanButton.disabled = false;
  const parts = [
    `Added ${plural(added, "card")} from ${plural(photos.length, "photo")}. Check them, then press “Look up values”.`,
  ];
  if (problems.length) parts.push(`Problems: ${problems.join("; ")}`);
  setStatus(parts.join(" "));
}
