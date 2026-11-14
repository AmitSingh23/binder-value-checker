// Finding cards in TCGdex (free card database with daily TCGplayer prices).

import { TCGDEX_API } from "./constants";
import { normalizeNumber } from "./parse";
import type { Card, CardBrief, Entry } from "./types";

// One request per URL. Failed requests are forgotten so they can be retried.
const requestCache = new Map<string, Promise<unknown>>();

function getJSON<T>(url: string): Promise<T> {
  let request = requestCache.get(url);
  if (!request) {
    request = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`TCGdex returned ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        requestCache.delete(url);
        throw err;
      });
    requestCache.set(url, request);
  }
  return request as Promise<T>;
}

// TCG Pocket (the phone game) cards share names and numbers with real cards. Skip them.
function isPocketCard(card: Card): boolean {
  return /pocket/i.test(card.set?.serie?.name ?? "") || /^[AB]\d/.test(card.set?.id ?? "");
}

/** A set from TCGdex's /sets/{id}. Only the fields we use. */
interface TcgdexSet {
  id: string;
  abbreviation?: { official?: string }; // printed set code, e.g. "SVI"
}

export interface CardSearch {
  matches: Card[];
  note?: string; // a warning to show with the matches
}

/** Find every printing that matches an entry's name and number. */
export async function findCard(entry: Entry): Promise<CardSearch> {
  // 1. Every card whose name contains the search text.
  const list = await getJSON<CardBrief[] | null>(`${TCGDEX_API}/cards?name=${encodeURIComponent(entry.name)}`);

  // 2. Keep the ones with the right number.
  const wantedNumber = normalizeNumber(entry.number);
  let hits = (list ?? []).filter((c) => normalizeNumber(c.localId) === wantedNumber);
  if (!hits.length) return { matches: [] };

  // 3. Prefer an exact name match ("Charizard", not "Dark Charizard").
  const exactName = hits.filter((c) => c.name.toLowerCase() === entry.name.toLowerCase());
  if (exactName.length) hits = exactName;

  // 4. Load full details (set, prices) for up to 12 candidates.
  const details = (await Promise.all(hits.slice(0, 12).map((c) => getJSON<Card>(`${TCGDEX_API}/cards/${c.id}`))))
    .filter((card) => !isPocketCard(card));

  let matches = details;
  const notes: string[] = [];

  // 5. If a set code was given ("set:SVI"), it names the set exactly.
  if (entry.set) {
    const bySetCode = await withSetCode(matches, entry.set);
    if (bySetCode.length) matches = bySetCode;
    else notes.push(`No set with code ${entry.set} had this card.`);
  }

  // 6. If a set size was given ("/102"), use it to pick the right set.
  if (entry.total && /^\d+$/.test(entry.total)) {
    const setSize = Number(entry.total);
    const bySetSize = matches.filter((card) => card.set?.cardCount?.official === setSize);
    if (bySetSize.length) matches = bySetSize;
    else notes.push(`No set with ${setSize} cards had this number.`);
  }

  if (notes.length && matches.length) notes.push("Showing closest matches.");
  return { matches, note: notes.join(" ") || undefined };
}

/** The cards whose set has this printed code ("SVI", "MEW"). */
async function withSetCode(cards: Card[], code: string): Promise<Card[]> {
  const wanted = code.toUpperCase();
  const setIds = [...new Set(cards.map((c) => c.set?.id).filter((id) => id != null))];
  const sets = await Promise.all(
    setIds.map((id) => getJSON<TcgdexSet>(`${TCGDEX_API}/sets/${encodeURIComponent(id)}`).catch(() => null)),
  );
  const matching = new Set(
    sets.filter((s) => s?.abbreviation?.official?.toUpperCase() === wanted).map((s) => s!.id),
  );
  return cards.filter((c) => c.set?.id != null && matching.has(c.set.id));
}
