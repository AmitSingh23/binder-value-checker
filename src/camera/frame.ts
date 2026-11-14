// What one video frame looks like to the hold detector.
//
// The viewfinder draws the card outline, plus a margin around it, onto a small
// grid and hands the pixels to readFrame(). Nothing here touches the page.
//
//   signature  the inside of the outline, shrunk and normalized for brightness
//              and contrast, so auto-exposure doesn't count as motion
//   contrast   how much there is to see inside the outline (a bare table: little)
//   edges      how many of the card's four edges run along the outline
//   sharpness  how well focused the middle of the card is

export type Gray = Float32Array;

/** The grid the viewfinder samples: the outline (card*) plus a margin on every side. */
export const GRID = { w: 96, h: 136, cardX: 8, cardY: 12, cardW: 80, cardH: 112 } as const;

/** The margin as a fraction of the outline's width and height. */
export const GRID_MARGIN = { x: GRID.cardX / GRID.cardW, y: GRID.cardY / GRID.cardH } as const;

/** The signature: the outline area in 4x4 blocks (small = forgiving of hand shake). */
export const SIGNATURE = { w: GRID.cardW / 4, h: GRID.cardH / 4 } as const;

/** Side of the square patch, in video pixels, that sharpness is measured on. */
export const FOCUS_PATCH = 128;

export interface Frame {
  signature: Gray;
  contrast: number;
  edges: number;
  /** Null when there was no focus patch to measure. */
  sharpness: number | null;
}

const EDGE = {
  minStep: 7, // brightness step (0 to 255) across an edge
  agreeing: 0.7, // share of the edge's length that must show that step
};

export function luminance(rgba: Uint8ClampedArray): Gray {
  const lum = new Float32Array(rgba.length / 4);
  for (let i = 0; i < lum.length; i++) {
    lum[i] = rgba[i * 4]! * 0.3 + rgba[i * 4 + 1]! * 0.59 + rgba[i * 4 + 2]! * 0.11;
  }
  return lum;
}

/** Averages size x size blocks of a w-wide image, from (x0, y0), into a cols x rows image. */
function shrink(lum: Gray, w: number, x0: number, y0: number, size: number, cols: number, rows: number): Gray {
  const out = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      for (let y = 0; y < size; y++) {
        const row = (y0 + r * size + y) * w + x0 + c * size;
        for (let x = 0; x < size; x++) sum += lum[row + x]!;
      }
      out[r * cols + c] = sum / (size * size);
    }
  }
  return out;
}

/** Shifts and scales values to mean 0 and a fixed spread. Returns the spread they had. */
export function normalize(values: Gray): number {
  let mean = 0;
  for (let i = 0; i < values.length; i++) mean += values[i]!;
  mean /= values.length;

  let variance = 0;
  for (let i = 0; i < values.length; i++) {
    values[i]! -= mean;
    variance += values[i]! * values[i]!;
  }
  const spread = Math.sqrt(variance / values.length);

  const k = 50 / (spread || 1);
  for (let i = 0; i < values.length; i++) values[i]! *= k;
  return spread;
}

/** Average per-pixel difference between two signatures. */
export function difference(a: Gray, b: Gray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

/**
 * Like difference(), but lets one signature slide up to `reach` cells in any
 * direction first and returns the best fit. A card that drifted a little in
 * the outline still counts as the same card.
 */
export function differenceAllowingShift(a: Gray, b: Gray, reach = 2): number {
  const { w, h } = SIGNATURE;
  let best = Infinity;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      let sum = 0;
      let count = 0;
      for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y++) {
        for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x++) {
          sum += Math.abs(a[y * w + x]! - b[(y + dy) * w + x + dx]!);
          count++;
        }
      }
      best = Math.min(best, sum / count);
    }
  }
  return best;
}

/* ---------- Card edges ---------- */

// Edges are looked for at half the grid's resolution.
const HALF = { w: GRID.w / 2, h: GRID.h / 2 };

// Where each edge may be (it sits on the outline when the card fills it
// exactly) and which stretch of it we check. The corners are left out: they're
// rounded, and that's where fingers go.
const SIDES = [
  { vertical: true, from: 2, to: 9, start: 20, end: 48 }, // left
  { vertical: true, from: 39, to: 46, start: 20, end: 48 }, // right
  { vertical: false, from: 2, to: 12, start: 14, end: 34 }, // top
  { vertical: false, from: 56, to: 66, start: 14, end: 34 }, // bottom
];

/** Is there a straight brightness step along the line just before row/column `at`? */
function hasEdgeAt(half: Gray, vertical: boolean, at: number, start: number, end: number): boolean {
  const { w } = HALF;
  const across = vertical ? 1 : w; // index step across the edge
  const along = vertical ? w : 1; // index step along it
  const length = end - start;

  let sum = 0;
  const steps = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const p = at * across + (start + i) * along;
    const step = (half[p]! + half[p + across]! - half[p - across]! - half[p - 2 * across]!) / 2;
    steps[i] = step;
    sum += step;
  }
  const mean = sum / length;
  if (Math.abs(mean) < EDGE.minStep) return false;

  // The step must run the length of the edge, not come from one bright blob.
  let agreeing = 0;
  for (const step of steps) if (step * Math.sign(mean) >= EDGE.minStep / 2) agreeing++;
  return agreeing / length >= EDGE.agreeing;
}

/** How many of the four sides of the outline have a card edge near them. */
export function countEdges(lum: Gray): number {
  const half = shrink(lum, GRID.w, 0, 0, 2, HALF.w, HALF.h);
  let found = 0;
  for (const side of SIDES) {
    for (let at = side.from; at <= side.to; at++) {
      if (hasEdgeAt(half, side.vertical, at, side.start, side.end)) {
        found++;
        break;
      }
    }
  }
  return found;
}

/* ---------- Focus ---------- */

/**
 * How much fine detail a square patch of the video has. Higher is sharper.
 *
 * The patch is halved first so sensor noise mostly averages out, then we take
 * the mean squared brightness slope. Only comparisons between samples of the
 * same card mean anything: a busy card scores higher than a plain one.
 */
export function sharpnessOf(rgba: Uint8ClampedArray): number {
  const full = Math.round(Math.sqrt(rgba.length / 4));
  const side = full >> 1;
  const lum = shrink(luminance(rgba), full, 0, 0, 2, side, side);
  let sum = 0;
  for (let y = 1; y < side - 1; y++) {
    for (let x = 1; x < side - 1; x++) {
      const i = y * side + x;
      const dx = lum[i + 1]! - lum[i - 1]!;
      const dy = lum[i + side]! - lum[i - side]!;
      sum += dx * dx + dy * dy;
    }
  }
  return sum / ((side - 2) * (side - 2));
}

/* ---------- The whole frame ---------- */

/**
 * `grid` is GRID.w x GRID.h RGBA pixels of the outline and its margin.
 * `focusPatch`, if there is one, is a square of full-size video pixels from the middle of the outline.
 */
export function readFrame(grid: Uint8ClampedArray, focusPatch?: Uint8ClampedArray): Frame {
  const lum = luminance(grid);
  const signature = shrink(lum, GRID.w, GRID.cardX, GRID.cardY, 4, SIGNATURE.w, SIGNATURE.h);
  const contrast = normalize(signature);
  return {
    signature,
    contrast,
    edges: countEdges(lum),
    sharpness: focusPatch ? sharpnessOf(focusPatch) : null,
  };
}
