// Cloudflare Pages Function: this file's path makes it answer GET /price.
// The page itself is the static file public/index.html, served at /.

import type { PriceReply } from "../shared/api";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/11";

async function fetchMarketPrice(productId: string, condition: string): Promise<PriceReply> {
  // e.g. https://mp-search-api.tcgplayer.com/v2/product/84199/details
  const response = await fetch(
    `https://mp-search-api.tcgplayer.com/v2/product/${encodeURIComponent(productId)}/details?includeSkus=true`,
    { headers: { "User-Agent": USER_AGENT } },
  );

  if (!response.ok) throw new Error(`TCGplayer returned ${response.status}`);

  const details = (await response.json()) as {
    skus: {
      sku: number;
      condition: string;
      variant: string;
      language: string;
    }[];
  };

  const skus = details.skus.filter((it) => it.condition === condition);

  const prices = await fetch("https://mpgateway.tcgplayer.com/v1/pricepoints/marketprice/skus/search?mpfev=5710", {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ skuIds: skus.map((it) => it.sku) }),
  });

  if (!prices.ok) throw new Error(`TCGplayer returned ${prices.status}`);

  const pricepoints = (await prices.json()) as {
    skuId: number;
    marketPrice: number;
    lowestPrice: number;
    highestPrice: number;
    medianPrice: number;
  }[];

  // map prices to conditions by matching skuId
  return skus.map((s) => ({
    ...s,
    marketPrice: pricepoints.find((p) => p.skuId === s.sku)?.marketPrice,
  }));
}

export const onRequestGet = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  const condition = url.searchParams.get("condition");

  if (!productId) return new Response("Missing productId", { status: 400 });
  if (!condition) return new Response("Missing condition", { status: 400 });

  try {
    return Response.json(await fetchMarketPrice(productId, condition));
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Price lookup failed", { status: 502 });
  }
};
