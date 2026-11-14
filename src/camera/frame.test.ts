import { describe, expect, test } from "bun:test";
import {
  countEdges, difference, differenceAllowingShift, GRID, luminance, normalize, readFrame, sharpnessOf, SIGNATURE,
} from "./frame";

/** RGBA pixels from a brightness for each (x, y). */
function image(w: number, h: number, brightness: (x: number, y: number) => number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = brightness(x, y);
      rgba.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  return rgba;
}

/** A stand-in for card art: smooth diagonal blobs, different for each seed. */
const art = (seed: number) => (x: number, y: number) =>
  120 + 50 * Math.sin((x + y) * 0.09 * seed + seed) + 40 * Math.cos((x - 2 * y) * 0.05 * seed + 2 * seed);

const BORDER = 3; // px of light card border around the art

/**
 * The sampling grid with a card on a table. `inset` shrinks the card inside
 * the outline (negative grows it); dx slides it sideways.
 */
function scene({ seed = 1, table = 40, inset = 0, dx = 0, card = true } = {}): Uint8ClampedArray {
  const left = GRID.cardX + inset + dx;
  const right = GRID.cardX + GRID.cardW - inset + dx;
  const top = GRID.cardY + inset;
  const bottom = GRID.cardY + GRID.cardH - inset;
  const paint = art(seed);
  return image(GRID.w, GRID.h, (x, y) => {
    if (!card || x < left || x >= right || y < top || y >= bottom) return table;
    const inBorder = x < left + BORDER || x >= right - BORDER || y < top + BORDER || y >= bottom - BORDER;
    return inBorder ? 215 : paint(x - dx, y);
  });
}

describe("readFrame", () => {
  test("the signature ignores brightness and contrast changes", () => {
    const bright = scene();
    const dim = bright.map((v, i) => (i % 4 === 3 ? v : v * 0.5 + 20));
    const a = readFrame(bright).signature;
    const b = readFrame(dim).signature;
    expect(a.length).toBe(SIGNATURE.w * SIGNATURE.h);
    expect(difference(a, b)).toBeLessThan(1);
  });

  test("a bare surface has next to no contrast; a card has plenty", () => {
    expect(readFrame(scene({ card: false })).contrast).toBeLessThan(1);
    expect(readFrame(scene()).contrast).toBeGreaterThan(20);
  });

  test("different cards are far apart", () => {
    const a = readFrame(scene({ seed: 1 })).signature;
    const b = readFrame(scene({ seed: 2 })).signature;
    expect(differenceAllowingShift(a, b)).toBeGreaterThan(30);
  });

  test("no focus patch, no sharpness", () => {
    expect(readFrame(scene()).sharpness).toBeNull();
  });
});

describe("differenceAllowingShift", () => {
  test("forgives a card that slid over a little", () => {
    const table = 128; // so the strip of table that slides into view doesn't dominate
    const a = readFrame(scene({ table })).signature;
    const b = readFrame(scene({ table, dx: 4 })).signature; // one signature cell
    expect(differenceAllowingShift(a, b)).toBeLessThan(difference(a, b) / 2);
  });

  test("is zero for the same signature", () => {
    const a = readFrame(scene()).signature;
    expect(differenceAllowingShift(a, a)).toBe(0);
  });
});

describe("countEdges", () => {
  const edges = (options: Parameters<typeof scene>[0]) => countEdges(luminance(scene(options)));

  test("finds all four edges of a card that fills the outline", () => {
    expect(edges({})).toBe(4);
  });

  test("on a light table too", () => {
    expect(edges({ table: 250 })).toBe(4);
  });

  test("when the card is a bit small or a bit big for the outline", () => {
    expect(edges({ inset: 6 })).toBe(4);
    expect(edges({ inset: -5 })).toBe(4);
  });

  test("finds none on a bare table", () => {
    expect(edges({ card: false })).toBe(0);
  });

  test("light falling off across a bare table isn't a card: at most two sides", () => {
    expect(countEdges(luminance(image(GRID.w, GRID.h, (x) => 40 + x * 2)))).toBeLessThanOrEqual(2);
  });

  test("isn't fooled by busy texture", () => {
    let seed = 7;
    const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 200;
    expect(countEdges(luminance(image(GRID.w, GRID.h, noise)))).toBe(0);
  });
});

describe("sharpnessOf", () => {
  const stripes = (period: number) => image(64, 64, (x) => 128 + 100 * Math.sin((x / period) * 2 * Math.PI));

  test("fine detail scores higher than the same picture blurred out", () => {
    expect(sharpnessOf(stripes(8))).toBeGreaterThan(sharpnessOf(stripes(32)) * 4);
  });

  test("a flat patch scores zero", () => {
    expect(sharpnessOf(image(64, 64, () => 90))).toBe(0);
  });
});

describe("normalize", () => {
  test("returns the spread the values had", () => {
    const values = new Float32Array([0, 20, 0, 20]);
    expect(normalize(values)).toBe(10);
    expect([...values]).toEqual([-50, 50, -50, 50]);
  });
});
