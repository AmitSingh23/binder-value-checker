// A card's TCGdex prices, and links to its TCGplayer listings.

import {
  CONDITION_NAME,
  TCGPLAYER_PRINTING,
  VARIANT_LABEL,
  VARIANT_ORDER,
  type Condition,
} from "./constants";
import type { Card, TcgplayerPrice } from "./types";

export interface PriceInfo {
  usd: number | null; // near-mint price of the main printing (market price, else mid price)
  variantKey: string | null; // TCGdex key of the main printing, e.g. "holofoil"
  variant: string | null; // short label of the main printing, e.g. "holo"
  others: { label: string; usd: number }[]; // the other priced printings
  productId: number | null; // TCGplayer product id of the main printing
}

function variantRank(key: string): number {
  const i = VARIANT_ORDER.indexOf(key);
  return i === -1 ? VARIANT_ORDER.length : i;
}

/** Printing key -> prices, skipping TCGdex's non-price fields like "updated". */
function tcgplayerPrices(card: Card): Record<string, TcgplayerPrice> {
  const prices: Record<string, TcgplayerPrice> = {};
  for (const [key, value] of Object.entries(card.pricing?.tcgplayer ?? {})) {
    if (value && typeof value === "object") prices[key] = value as TcgplayerPrice;
  }
  return prices;
}

export function priceInfo(card: Card): PriceInfo {
  const tcgplayer = tcgplayerPrices(card);
  const priceOf = (key: string) => tcgplayer[key]?.marketPrice ?? tcgplayer[key]?.midPrice ?? null;

  const variants = Object.keys(tcgplayer).sort((a, b) => variantRank(a) - variantRank(b));
  const priced = variants.filter((key) => priceOf(key) != null);
  const main = priced[0] ?? variants[0];

  return {
    usd: priced[0] ? priceOf(priced[0]) : null,
    variantKey: main ?? null,
    variant: main ? (VARIANT_LABEL[main] ?? main) : null,
    others: priced.slice(1).map((key) => ({ label: VARIANT_LABEL[key] ?? key, usd: priceOf(key)! })),
    productId: main ? (tcgplayer[main]?.productId ?? null) : null,
  };
}

/**
 * The card's TCGplayer page, with listings filtered to the condition,
 * printing and English. Falls back to a TCGplayer search if there's no product id.
 */
export function listingsURL(card: Card, cond: Condition): string {
  const info = priceInfo(card);

  if (info.productId == null) {
    const query = `${card.name} ${card.localId}`;
    return `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(query)}`;
  }

  const params = new URLSearchParams({ Language: "English", Condition: CONDITION_NAME[cond] });
  const printing = info.variantKey && TCGPLAYER_PRINTING[info.variantKey];
  if (printing) params.set("Printing", printing);

  return `https://www.tcgplayer.com/product/${info.productId}?${params}`;
}
