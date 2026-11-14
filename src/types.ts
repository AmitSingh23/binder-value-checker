import type { Condition } from "./constants";

/* ---------- One line of the user's list ---------- */

/** What every line has, even one we couldn't read. */
export interface Line {
  raw: string; // exactly as typed
  qty: number;
  cond: Condition;
}

/** A line we could read: "2x Charizard 4/102 LP". */
export interface Entry extends Line {
  name: string;
  number: string; // "4", "TG12", "SV49"
  total: string | null; // set size after the slash, if given
  set?: string | null; // printed set code from "set:SVI", if given (missing in older saves)
}

export type ParsedLine = Entry | (Line & { error: string });

/* ---------- TCGdex cards ---------- */

/** One printing's TCGplayer prices, as TCGdex reports them. */
export interface TcgplayerPrice {
  productId?: number;
  marketPrice?: number | null;
  midPrice?: number | null;
}

/** A card from TCGdex's /cards/{id}. Only the fields we use. */
export interface Card {
  id: string;
  name: string;
  localId: string; // collector number
  rarity?: string;
  image?: string;
  set?: {
    id?: string;
    name?: string;
    serie?: { name?: string };
    cardCount?: { official?: number };
  };
  pricing?: {
    // Printing key ("holofoil", …) -> prices. Also holds non-object fields like "updated".
    tcgplayer?: Record<string, unknown>;
  };
}

/** A card from TCGdex's /cards?name= search. */
export interface CardBrief {
  id: string;
  name: string;
  localId: string;
}

/* ---------- Lookup results: one per line of the list ---------- */

export type Result = PendingResult | NotFoundResult | FoundResult;

export interface PendingResult {
  status: "pending";
  entry: Entry;
}

export interface NotFoundResult {
  status: "not-found";
  entry: Line;
  message?: string; // why, if it wasn't simply "not found"
}

export interface FoundResult {
  status: "found";
  entry: Entry;
  matches: Card[]; // every printing that fits
  choice: number; // index into matches
  note?: string; // a warning about the match
}
