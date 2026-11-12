// The results table, the totals bar and the status line.

import { CONDITION_NAME, CONDITIONS, type Condition } from "./constants";
import { ui, setStatus } from "./dom";
import { anyLivePriceLoading, isLivePriceLoading, livePrice, onLivePrice, requestLivePrice } from "./live-prices";
import { listingsURL, priceInfo } from "./prices";
import {
  chosenCard,
  isFound,
  marketPrice,
  overrideFor,
  parsePrice,
  rowTotal,
  saveResults,
  setOverride,
  state,
} from "./state";
import type { Card, FoundResult, NotFoundResult, PendingResult } from "./types";
import { esc, money } from "./util";

const COLUMNS = 9;

/* =====================================================================
   Rows
   ===================================================================== */

function pendingRow(r: PendingResult): string {
  return `
    <tr>
      <td class="wide" colspan="${COLUMNS}">
        <span class="input-line">${esc(r.entry.raw)}</span> — looking up…
      </td>
    </tr>`;
}

function notFoundRow(r: NotFoundResult): string {
  const message = r.message ? `<div class="hint">${esc(r.message)}</div>` : "";
  return `
    <tr>
      <td class="wide"><div class="input-line">${esc(r.entry.raw)}</div></td>
      <td class="wide" colspan="${COLUMNS - 1}"><span class="pill bad">Not found</span>${message}</td>
    </tr>`;
}

function foundRow(r: FoundResult, i: number): string {
  const card = chosenCard(r);
  return `
    <tr>
      <td class="wide">${cardCell(r, card)}</td>
      <td class="wide">${matchCell(r, i)}</td>
      <td data-label="Condition">${conditionSelect(r, i)}</td>
      <td data-label="Listings">${listingsLink(r, card)}</td>
      <td class="num" data-label="Qty">${r.entry.qty}</td>
      <td class="num" data-label="TCGplayer (USD)" id="price-${i}">${priceCell(r, { showLiveTag: false })}</td>
      <td class="num" data-label="Lowest price" id="lowest-${i}">${priceCell(r, { showLiveTag: true })}</td>
      <td class="num" data-label="Your price">${yourPriceInput(r, i, card)}</td>
      <td class="num" data-label="Total (USD)" id="total-${i}">${totalCell(r)}</td>
    </tr>`;
}

/* =====================================================================
   Cells
   ===================================================================== */

// Thumbnail, name, set line, and the original input line.
function cardCell(r: FoundResult, card: Card): string {
  const img = card.image ? `<img src="${esc(card.image)}/low.webp" alt="" loading="lazy">` : "";
  const setSize = card.set?.cardCount?.official ?? "?";
  const rarity = card.rarity ? ` · ${esc(card.rarity)}` : "";
  return `
    <div class="card">
      ${img}
      <div>
        <div class="nm">${esc(card.name)}</div>
        <div class="sub">${esc(card.set?.name)} · ${esc(card.localId)}/${esc(setSize)}${rarity}</div>
        <div class="input-line">${esc(r.entry.raw)}</div>
      </div>
    </div>`;
}

// Match badge, an optional warning, and a printing picker when there's more than one.
function matchCell(r: FoundResult, i: number): string {
  let pill: string;
  if (r.note) pill = `<span class="pill warn">Check</span>`;
  else if (r.matches.length > 1) pill = `<span class="pill warn">${r.matches.length} printings</span>`;
  else pill = `<span class="pill ok">Matched</span>`;

  const note = r.note ? `<div class="hint">${esc(r.note)}</div>` : "";

  let picker = "";
  if (r.matches.length > 1) {
    const options = r.matches
      .map((m, j) => `
        <option value="${j}" ${j === r.choice ? "selected" : ""}>
          ${esc(m.set?.name)} · ${esc(m.localId)}/${esc(m.set?.cardCount?.official)}
        </option>`)
      .join("");
    picker = `<select class="printing" data-row="${i}" aria-label="Choose printing">${options}</select>`;
  }

  return pill + note + picker;
}

function conditionSelect(r: FoundResult, i: number): string {
  const options = CONDITIONS.map(
    (code) =>
      `<option value="${code}" ${code === r.entry.cond ? "selected" : ""} title="${CONDITION_NAME[code]}">${code}</option>`,
  ).join("");
  return `<select class="cond" data-row="${i}" aria-label="Condition">${options}</select>`;
}

function listingsLink(r: FoundResult, card: Card): string {
  const cond = r.entry.cond;
  return `
    <a class="listings"
       href="${esc(listingsURL(card, cond))}"
       target="_blank" rel="noopener"
       title="${esc(CONDITION_NAME[cond])} listings on TCGplayer">${esc(cond)} on TCGplayer ↗</a>`;
}

const UPDATING_TAG = `<span class="updating"><span class="ring" aria-hidden="true"></span>updating</span>`;

// Main price (live from TCGplayer once it arrives), its printing, and
// TCGdex's prices for the other printings.
function priceCell(r: FoundResult, { showLiveTag }: { showLiveTag: boolean }): string {
  const info = priceInfo(chosenCard(r));
  const cond = r.entry.cond;
  const loading = isLivePriceLoading(info.productId, cond);
  const isLive = livePrice(info.productId, cond) != null;

  const status = loading ? UPDATING_TAG : showLiveTag && isLive ? "live" : null;
  const label = [info.variant ? esc(info.variant) : null, status].filter(Boolean).join(" · ");
  const mainLabel = label ? `<div class="variants">${label}</div>` : "";
  const others = info.others.map((o) => `<div class="variants">${esc(o.label)} ${money(o.usd)}</div>`).join("");

  return `<b class="${loading ? "stale" : ""}">${money(marketPrice(r))}</b>${mainLabel}${others}`;
}

function yourPriceInput(r: FoundResult, i: number, card: Card): string {
  const mine = overrideFor(r);
  const label = `Your price for ${esc(card.name)} in ${esc(CONDITION_NAME[r.entry.cond])}`;
  return `
    <label class="override">$<input
      data-row="${i}"
      type="text" inputmode="decimal" autocomplete="off" placeholder="—"
      value="${mine != null ? mine.toFixed(2) : ""}"
      class="${mine != null ? "set" : ""}"
      aria-label="${label}"></label>`;
}

function totalCell(r: FoundResult): string {
  const note = overrideFor(r) != null ? `<div class="mine">your price</div>` : "";
  return `<b>${money(rowTotal(r))}</b>${note}`;
}

/* =====================================================================
   Drawing
   ===================================================================== */

/** Redraws every row, then the totals. */
export function render() {
  // Ask for live prices first (each product/condition pair only once), so rows
  // drawn below know which prices are still loading and keep their old number.
  for (const r of state.results) {
    if (isFound(r)) requestLivePrice(priceInfo(chosenCard(r)).productId, r.entry.cond);
  }

  ui.rows.innerHTML = state.results
    .map((r, i) => {
      switch (r.status) {
        case "pending":
          return pendingRow(r);
        case "not-found":
          return notFoundRow(r);
        case "found":
          return foundRow(r, i);
      }
    })
    .join("");

  updateSummary();
  updateLoadingBar();
}

const setCell = (id: string, html: string) => {
  const cell = document.getElementById(id);
  if (cell) cell.innerHTML = html;
};

// A live price arrived: update just the rows showing that product in that condition,
// plus the totals. (Not a full redraw, so a price box you're typing in keeps focus.)
function showLivePrice(productId: number, cond: Condition) {
  state.results.forEach((r, i) => {
    if (!isFound(r) || r.entry.cond !== cond || priceInfo(chosenCard(r)).productId !== productId) return;
    setCell(`price-${i}`, priceCell(r, { showLiveTag: false }));
    setCell(`lowest-${i}`, priceCell(r, { showLiveTag: true }));
    setCell(`total-${i}`, totalCell(r));
  });
  updateSummary();
}

function updateLoadingBar() {
  const busy = anyLivePriceLoading();
  ui.loadingBar.classList.toggle("visible", busy);
  ui.loadingBar.setAttribute("aria-hidden", String(!busy));
}

/* =====================================================================
   Totals and status line
   (also run on every keystroke in a price box, without redrawing rows)
   ===================================================================== */

function statusText(): string {
  const { results, savedAt } = state;
  if (!results.length) return "Press “Look up values” to price the list.";

  const done = results.filter((r) => r.status !== "pending").length;
  if (done < results.length) return `Looking up ${done + 1} of ${results.length}…`;

  const found = results.filter(isFound);
  const notFound = results.length - found.length;
  const withMine = found.filter((r) => overrideFor(r) != null).length;
  const playedAtNM = found.filter((r) => r.entry.cond !== "NM" && overrideFor(r) == null).length;

  const parts = [`${found.length} of ${results.length} lines priced`];
  if (notFound) parts.push(`${notFound} not found`);
  if (withMine) parts.push(`${withMine} with your price`);
  if (playedAtNM) parts.push(`${playedAtNM} played without your price (counted at NM)`);
  if (savedAt) {
    const when = new Date(savedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    parts.push(`market prices from ${when}`);
  }
  return parts.join(" · ") + ".";
}

export function updateSummary() {
  const found = state.results.filter(isFound);
  const totalUsd = found.reduce((sum, r) => sum + (rowTotal(r) ?? 0), 0);
  const cardCount = found.reduce((sum, r) => sum + r.entry.qty, 0);
  const stillLooking = state.results.some((r) => r.status === "pending");

  ui.totalUsd.textContent = found.length ? money(totalUsd) : "—";
  ui.totalCount.textContent = found.length ? String(cardCount) : "—";
  setStatus(statusText());
  ui.copyButton.disabled = !found.length || stillLooking;
}

/* =====================================================================
   Table events
   ===================================================================== */

function rowFor(el: HTMLElement): FoundResult | null {
  const r = state.results[Number(el.dataset.row)];
  return r && isFound(r) ? r : null;
}

export function initTable() {
  onLivePrice((productId, cond) => {
    updateLoadingBar();
    showLivePrice(productId, cond);
  });

  // Printing picker, condition picker, and tidying a price box when you leave it.
  ui.rows.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const r = rowFor(el);
    if (!r) return;

    if (el.matches("select.printing")) {
      r.choice = Number(el.value);
    } else if (el.matches("select.cond")) {
      r.entry.cond = el.value as Condition;
    } else if (el.matches(".override input")) {
      // "12.5" -> "12.50" once you're done typing.
      const mine = overrideFor(r);
      if (mine != null) el.value = mine.toFixed(2);
      return;
    }
    render();
    saveResults();
  });

  // Typing a price: saved and totalled as you type. The row isn't redrawn,
  // so the box keeps focus.
  ui.rows.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    const r = rowFor(el);
    if (!r || !el.matches(".override input")) return;

    const price = parsePrice(el.value);
    setOverride(r, price);
    el.classList.toggle("set", price != null);
    setCell(`total-${el.dataset.row}`, totalCell(r));
    updateSummary();
  });
}
