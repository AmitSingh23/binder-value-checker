# Binder Value Check

A static page (`public/index.html`) plus one Cloudflare Pages Function
(`functions/price.ts`, served at `/price`) that looks up TCGplayer market prices.

```bash
bun install
bun run dev      # local preview at http://localhost:8788
bun run deploy   # deploy to Cloudflare Pages (run from this folder)
```

## Adding cards from photos

"Add from photo" sends each photo to `functions/scan.ts` (`POST /scan`), which reads
card names and numbers with Workers AI (`@cf/meta/llama-4-scout-17b-16e-instruct`,
free daily allowance) and appends them to the list.

Setup on the Pages project (Settings → Bindings / Variables and Secrets), then redeploy:

- **Workers AI** binding, variable name `AI` (required)
- `SCAN_PASSCODE` secret (optional): if set, the page asks for it once before scanning
- `SCAN_MODEL` variable (optional): a different Workers AI vision model to read cards with,
  e.g. `@cf/mistralai/mistral-small-3.1-24b-instruct`
