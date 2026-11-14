// Request and reply shapes for the two Pages Functions, shared by the
// server (functions/) and the page (src/).

/** GET /price?productId=…&condition=…  replies with one entry per TCGplayer SKU in that condition. */
export interface SkuPrice {
  sku: number;
  condition: string; // e.g. "Near Mint"
  variant: string; // e.g. "Holofoil"
  language: string;
  marketPrice?: number;
}
export type PriceReply = SkuPrice[];

/** POST /scan */
export interface ScanRequest {
  image: string; // "data:image/jpeg;base64,…"
  passcode?: string;
}
export interface ScannedCard {
  name: string;
  number: string; // "4" in "4/102"
  total: string; // "102" in "4/102", or ""
  set: string; // printed set code, e.g. "SVI" in "SVI EN 198/198", or "" (older cards have none)
}
export interface ScanReply {
  cards: ScannedCard[];
}
