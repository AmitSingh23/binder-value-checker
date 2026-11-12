# Binder Value Check

A static page (`public/index.html`) plus one Cloudflare Pages Function
(`functions/price.ts`, served at `/price`) that looks up TCGplayer market prices.

```bash
bun install
bun run dev      # local preview at http://localhost:8788
bun run deploy   # deploy to Cloudflare Pages (run from this folder)
```
