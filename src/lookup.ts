// "Look up values": parse the list and find every line in TCGdex.

import { ui } from "./dom";
import { parseLine } from "./parse";
import { saveList, saveResults, state } from "./state";
import { render } from "./table";
import { findCard } from "./tcgdex";
import type { Result } from "./types";
import { errorMessage, runInParallel } from "./util";

const PARALLEL_LOOKUPS = 4;

export async function lookUpAll() {
  saveList();

  const lines = ui.cardsInput.value.split("\n").map(parseLine).filter((line) => line != null);
  state.results = lines.map((line): Result =>
    "error" in line
      ? { status: "not-found", entry: line, message: line.error }
      : { status: "pending", entry: line },
  );
  state.savedAt = null;
  render();
  ui.lookupButton.disabled = true;

  await runInParallel(state.results.length, PARALLEL_LOOKUPS, async (i) => {
    const r = state.results[i]!;
    if (r.status !== "pending") return;

    try {
      const { matches, note } = await findCard(r.entry);
      state.results[i] = matches.length
        ? { status: "found", entry: r.entry, matches, choice: 0, note }
        : { status: "not-found", entry: r.entry }; // shows just "Not found"
    } catch (err) {
      state.results[i] = {
        status: "not-found",
        entry: r.entry,
        message: `Lookup failed (${errorMessage(err)}). Check your connection and try again.`,
      };
    }
    render();
  });

  ui.lookupButton.disabled = false;
  render();
  saveResults();
}
