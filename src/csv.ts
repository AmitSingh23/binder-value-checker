// "Copy as CSV"

import { setStatus } from "./dom";
import { listingsURL } from "./prices";
import { chosenCard, marketPrice, overrideFor, rowTotal, state } from "./state";

const HEADER = [
  "Input", "Card", "Set", "Number", "Rarity", "Condition", "Qty",
  "TCGplayer NM USD", "Your price USD", "Total USD", "TCGplayer listings",
];

function toCSV(): string {
  const quote = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const row = (cells: unknown[]) => cells.map(quote).join(",");

  const lines = [row(HEADER)];

  for (const r of state.results) {
    if (r.status !== "found") {
      lines.push(row([r.entry.raw, "NOT FOUND", "", "", "", r.entry.cond, r.entry.qty, "", "", "", ""]));
      continue;
    }
    const card = chosenCard(r);
    lines.push(row([
      r.entry.raw,
      card.name,
      card.set?.name,
      `${card.localId}/${card.set?.cardCount?.official ?? ""}`,
      card.rarity,
      r.entry.cond,
      r.entry.qty,
      marketPrice(r)?.toFixed(2),
      overrideFor(r)?.toFixed(2),
      rowTotal(r)?.toFixed(2),
      listingsURL(card, r.entry.cond),
    ]));
  }

  return lines.join("\n");
}

export async function copyCSV() {
  const text = toCSV();
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied CSV to clipboard.");
  } catch {
    // Older browsers: copy through a hidden textarea.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    setStatus(ok ? "Copied CSV to clipboard." : "Your browser blocked clipboard access.");
  }
}
