// Reading the user's list: one card per line.

import { CONDITION_ALIASES, type Condition } from "./constants";
import type { ParsedLine } from "./types";

// A condition at the end of the line, optionally in () or [] and after a
// separator, e.g. " LP", ", near mint", " (MP)", " - [HP]".
// Longer phrases come first so "near mint" wins over "mint".
const TRAILING_CONDITION =
  /[\s,;|(\[–-]+\(?\[?\s*(near mint|lightly played|light played|moderately played|heavily played|heavy played|damaged|played|mint|poor|nm|lp|mp|hp|dmg|dm)\s*\)?\]?$/i;

// A printed set code anywhere in the line: "set:SVI", "set: MEW".
// Spelled out so it can't be mistaken for a condition or part of the name.
const SET_CODE = /(?:^|\s)set:\s*([A-Za-z0-9-]+)(?=\s|$)/i;

// A quantity at the start: "2x Gengar", "3 x Gengar".
const LEADING_QTY = /^(\d+)\s*x\s+/i;

// A quantity at the end: "Gengar 94/165 x2".
const TRAILING_QTY = /\s+x\s*(\d+)$/i;

// What's left must be "<name> <number>" or "<name> <number>/<set total>".
// Numbers may have letter prefixes/suffixes (TG12, SV49, 25a), and a "#" is allowed.
//   group 1: name   group 2: card number   group 3: set total (optional)
const NAME_AND_NUMBER = /^(.+?)[\s,;|#–-]+#?([A-Za-z]*\d+[A-Za-z]*)\s*(?:\/\s*([A-Za-z]*\d+))?$/;

/**
 * Turn one line of the list into an entry, or null for a blank line.
 * Examples it accepts:
 *   "2x Charizard 4/102 LP"
 *   "Charizard, 004/102 x2 (MP)"
 *   "Mew TG12/TG30"
 *   "Charizard 4 near mint"
 *   "Pikachu ex 238/191 set:SSP LP"
 */
export function parseLine(raw: string): ParsedLine | null {
  let line = raw.trim();
  if (!line) return null;

  let qty = 1;
  let cond: Condition = "NM";
  let set: string | null = null;

  const setMatch = SET_CODE.exec(line);
  if (setMatch) {
    set = setMatch[1]!.toUpperCase();
    line = (line.slice(0, setMatch.index) + " " + line.slice(setMatch.index + setMatch[0].length)).trim();
  }

  const lead = LEADING_QTY.exec(line);
  if (lead) {
    qty = Number(lead[1]);
    line = line.slice(lead[0].length);
  }

  // Condition and trailing quantity can come in either order, so try twice.
  for (let pass = 0; pass < 2; pass++) {
    const condMatch = TRAILING_CONDITION.exec(line);
    const alias = condMatch && CONDITION_ALIASES[condMatch[1]!.toUpperCase()];
    if (condMatch && alias) {
      cond = alias;
      line = line.slice(0, -condMatch[0].length);
    }

    const qtyMatch = TRAILING_QTY.exec(line);
    if (qtyMatch) {
      qty = Number(qtyMatch[1]);
      line = line.slice(0, -qtyMatch[0].length);
    }
  }

  const m = NAME_AND_NUMBER.exec(line);
  if (!m) return { raw, qty, cond, error: "Couldn’t find a card number. Use “Name 12/99”." };

  return { raw, qty, cond, name: m[1]!.trim(), number: m[2]!, total: m[3] ?? null, set };
}

/** Normalise card numbers so they compare equal: "054" -> "54", "TG07" -> "TG7", "sv49" -> "SV49". */
export function normalizeNumber(s: string): string {
  return s.toUpperCase().replace(/^([A-Z]*)0*(\d)/, "$1$2");
}
