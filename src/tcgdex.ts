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

  // 5. If a set size was given ("/102"), use it to pick the right set.
  if (entry.total && /^\d+$/.test(entry.total)) {
    const setSize = Number(entry.total);
    const bySetSize = details.filter((card) => card.set?.cardCount?.official === setSize);
    if (bySetSize.length) return { matches: bySetSize };
    return {
      matches: details,
      note: `No set with ${setSize} cards had this number; showing closest matches.`,
    };
  }

  return { matches: details };
}
