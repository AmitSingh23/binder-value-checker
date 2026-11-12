// Live TCGplayer prices.
//
// TCGdex refreshes its prices once a day. Our Pages Function (functions/price.ts,
// served at /price) asks TCGplayer directly. Each product + condition is asked
// for once per page load.

import type { PriceReply } from "../shared/api";
import { CONDITION_NAME, type Condition } from "./constants";

type ProductId = number | null;

const keyOf = (productId: ProductId, cond: Condition) => `${productId}|${cond}`;

// Answered requests: the live price, or null if TCGplayer had none or the request failed.
const answered = new Map<string, number | null>();
// Requests still out.
const inFlight = new Set<string>();

let onAnswer: (productId: number, cond: Condition) => void = () => {};

/** Called each time a live price arrives (or fails). */
export function onLivePrice(listener: typeof onAnswer) {
  onAnswer = listener;
}

/** Asks our server for a product's market price in a condition. Null if it fails. */
async function fetchLivePrice(productId: number, cond: Condition): Promise<number | null> {
  const condition = CONDITION_NAME[cond];
  try {
    const params = new URLSearchParams({ productId: String(productId), condition });
    const response = await fetch(`/price?${params}`);
    if (!response.ok) return null;
    const skus = (await response.json()) as PriceReply | null;
    // The first printing with a price.
    return skus?.find((s) => s.condition === condition && s.marketPrice != null)?.marketPrice ?? null;
  } catch {
    return null;
  }
}

/** Starts fetching a live price, unless it's already fetched or on its way. */
export function requestLivePrice(productId: ProductId, cond: Condition) {
  const key = keyOf(productId, cond);
  if (productId == null || inFlight.has(key) || answered.has(key)) return;

  inFlight.add(key);
  fetchLivePrice(productId, cond).then((price) => {
    answered.set(key, price);
    inFlight.delete(key);
    onAnswer(productId, cond);
  });
}

/** The live price; null if there is none; undefined if we haven't heard back yet. */
export const livePrice = (productId: ProductId, cond: Condition) => answered.get(keyOf(productId, cond));

export const isLivePriceLoading = (productId: ProductId, cond: Condition) => inFlight.has(keyOf(productId, cond));

export const anyLivePriceLoading = () => inFlight.size > 0;
