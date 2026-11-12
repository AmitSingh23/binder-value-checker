import express from 'express';

const app = express();
app.use(express.json());

// The page is served from this same server, so its requests to /price are
// same-origin and need no CORS. Open http://localhost:3000 rather than the file.
app.get('/', (_req, res) => {
  res.sendFile('binder-value-check.html', { root: import.meta.dir, maxAge: 0, cacheControl: false });
});

// fetch is built into Bun, so no import is needed.
async function fetchMarketPrice(productId: string, condition: string) {
  // fetch https://mp-search-api.tcgplayer.com/v2/product/84199/details for a given product id
  const response = await fetch(`https://mp-search-api.tcgplayer.com/v2/product/${encodeURIComponent(productId)}/details?includeSkus=true`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/11",
    }
  });

  if (!response.ok) throw new Error(`TCGplayer returned ${response.status}`);

  const details = (await response.json()) as {
    skus: {
      sku: number;
      condition: string;
      variant: string;
      language: string;
    }[];
  };

  const body = JSON.stringify({
    skuIds: details.skus.filter(it => it.condition === condition)?.map((it) => it.sku)
  });

  const prices = await fetch("https://mpgateway.tcgplayer.com/v1/pricepoints/marketprice/skus/search?mpfev=5710", {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/11", 
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body,
  });

  const pricepoints = await prices.json() as {
    skuId: number;
    marketPrice: number;
    lowestPrice: number;
    highestPrice: number;
    medianPrice: number;
  }[];

  // map prices to conditions by matching skuId
  const ret = details.skus
    .filter(it => it.condition === condition)
    .map(s => {
      const p = pricepoints.find(p => p.skuId === s.sku)
      return {
        ...s,
        marketPrice: p?.marketPrice
      }
  });


  return ret
}

app.get('/price', async (req, res) => {
  const { productId, condition } = req.query;

  // ?productId=123 gives a string; anything else (missing, repeated, nested) is rejected.
  if (typeof productId !== 'string' || !productId) return res.status(400).send("Missing productId");

  // ?condition=LP gives a string; anything else (missing, repeated, nested) is rejected.
  if (typeof condition !== 'string' || !condition) return res.status(400).send("Missing condition");

  const price = await fetchMarketPrice(productId, condition);
  res.json(price);
})

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Binder Value Check: http://localhost:${port}`));
