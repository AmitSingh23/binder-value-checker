// Binder Value Check: the page's entry point. Bundled to public/app.js by `bun run build`.
//
// Where things live:
//   parse.ts        reading a line like "2x Charizard 4/102 LP"
//   tcgdex.ts       finding the card in TCGdex
//   prices.ts       TCGdex prices and TCGplayer listing links
//   live-prices.ts  live TCGplayer prices from our /price function
//   state.ts        lookup results, "Your price" entries, row values, saving
//   table.ts        drawing the table, totals and status line
//   lookup.ts       the "Look up values" button
//   csv.ts          the "Copy as CSV" button
//   scan.ts         "Add from photos" via our /scan function
//   camera.ts       "Scan with camera"

import { initCamera } from "./camera";
import { copyCSV } from "./csv";
import { ui } from "./dom";
import { lookUpAll } from "./lookup";
import { scanFiles } from "./scan";
import { restoreSaved, saveList } from "./state";
import { initTable, render } from "./table";

initTable();
initCamera();

ui.cardsInput.addEventListener("input", saveList);
ui.lookupButton.addEventListener("click", () => lookUpAll());
ui.copyButton.addEventListener("click", () => copyCSV());

ui.scanButton.addEventListener("click", () => ui.scanFile.click());
ui.scanFile.addEventListener("change", () => {
  const files = [...(ui.scanFile.files ?? [])];
  ui.scanFile.value = ""; // so picking the same photo again still fires
  scanFiles(files);
});

restoreSaved();
render();
