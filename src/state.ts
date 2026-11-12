// The lookup results, "Your price" entries, what each row is worth,
// and saving all of it in this browser.

import { STORAGE_KEYS } from "./constants";
import { ui } from "./dom";
import { isLivePriceLoading, livePrice } from "./live-prices";
import { priceInfo } from "./prices";
import type { Card, Entry, FoundResult, Line, Result } from "./types";
import { store } from "./util";

export const state = {
  /** One per line of the list. */
  results: [] as Result[],
  /** When the shown lookup was made, if it was restored from a save. */
  savedAt: null as string | null,
};

export const isFound = (r: Result): r is FoundResult => r.status === "found";
export const chosenCard = (r: FoundResult): Card => r.matches[r.choice]!;

/* ---------- Market price ---------- */

// Row -> the market price it last showed. While a new condition/printing's live
// price is loading, the row keeps showing that number instead of jumping to
// TCGdex's (different) price and back.
const shownPrice = new WeakMap<FoundResult, number | null>();

/** TCGplayer's live price for the row's condition once it's in, else TCGdex's near-mint price. */
export function marketPrice(r: FoundResult): number | null {
  const info = priceInfo(chosenCard(r));
  const cond = r.entry.cond;
  if (isLivePriceLoading(info.productId, cond) && shownPrice.has(r)) return shownPrice.get(r)!;

  const live = livePrice(info.productId, cond);
  const price = live !== undefined ? live : info.usd;
  shownPrice.set(r, price);
  return price;
}

/* ---------- "Your price" overrides ----------
   Keyed by exact printing + condition, so an LP price stays with LP and
   comes back if the card is looked up again or the list is reordered. */

const overrides = store.get<Record<string, number>>(STORAGE_KEYS.overrides, {});

const overrideKey = (r: FoundResult) => `${chosenCard(r).id}|${r.entry.cond}`;

export const overrideFor = (r: FoundResult): number | null => overrides[overrideKey(r)] ?? null;

export function setOverride(r: FoundResult, price: number | null) {
  if (price == null) delete overrides[overrideKey(r)];
  else overrides[overrideKey(r)] = price;
  store.set(STORAGE_KEYS.overrides, overrides);
}

/** "$1,234.5" -> 1234.5. Null for anything that isn't a non-negative number. */
export function parsePrice(text: string): number | null {
  const n = parseFloat(text.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/* ---------- Row value ---------- */

/** What one copy is worth: your price if set, otherwise the market price. */
export const unitValue = (r: FoundResult) => overrideFor(r) ?? marketPrice(r);

export function rowTotal(r: FoundResult): number | null {
  const each = unitValue(r);
  return each != null ? each * r.entry.qty : null;
}

/* ---------- Saving the last lookup ---------- */

// The saved format predates these types; keep it so old saves still load.
interface SavedResult {
  entry: Line | Entry;
  error?: true | string;
  note?: string;
  choice?: number;
  matches?: Card[];
}
interface SavedLookup {
  savedAt: string;
  results: SavedResult[];
}

// Keep only what the table needs from each card (the full TCGdex record is much bigger).
function slimCard(c: Card): Card {
  return {
    id: c.id,
    name: c.name,
    localId: c.localId,
    rarity: c.rarity,
    image: c.image,
    set: { name: c.set?.name, cardCount: { official: c.set?.cardCount?.official } },
    pricing: { tcgplayer: c.pricing?.tcgplayer },
  };
}

export function saveResults() {
  if (state.results.some((r) => r.status === "pending")) return; // don't save a half-finished lookup

  const saved: SavedLookup = {
    savedAt: state.savedAt ?? new Date().toISOString(),
    results: state.results.map((r): SavedResult =>
      r.status === "found"
        ? { entry: r.entry, note: r.note, choice: r.choice, matches: r.matches.map(slimCard) }
        : { entry: r.entry, error: (r.status === "not-found" && r.message) || true },
    ),
  };
  store.set(STORAGE_KEYS.results, saved);
}

/** Puts back the list and the last lookup as it was left. Its prices are from when it was made. */
export function restoreSaved() {
  const savedList = store.get<string | null>(STORAGE_KEYS.list, null);
  if (savedList) ui.cardsInput.value = savedList;

  const last = store.get<SavedLookup | null>(STORAGE_KEYS.results, null);
  if (!last?.results?.length) return;

  state.results = last.results.map((r): Result =>
    r.matches?.length
      ? { status: "found", entry: r.entry as Entry, matches: r.matches, choice: r.choice ?? 0, note: r.note }
      : { status: "not-found", entry: r.entry, message: typeof r.error === "string" ? r.error : undefined },
  );
  state.savedAt = last.savedAt;
}

export const saveList = () => store.set(STORAGE_KEYS.list, ui.cardsInput.value);
