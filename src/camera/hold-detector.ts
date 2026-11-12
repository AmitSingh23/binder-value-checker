// Decides when a card held up to the camera is still enough to capture.
//
// Knows nothing about the page: feed it small RGBA samples of the area inside
// the card outline and it says how far along the hold is and when to capture.
//
// Each sample is turned into grayscale and normalized for brightness and
// contrast, so auto-exposure doesn't count as motion. In testing, the same card
// in a shaky hand stayed under ~10 apart, and two different cards with the same
// layout were 17+ apart.

export const HOLD = {
  sampleW: 20, // card-shaped sample (small = forgiving of hand shake)
  sampleH: 28,
  movingAbove: 11, // change between samples that counts as motion
  spikesAllowed: 1, // ignore this many motion samples in a row (a twitch, a refocus)
  steadyForMs: 600, // hold roughly still this long to capture
  newCardAbove: 13, // must differ this much from the last capture
  minGapMs: 1000, // never capture faster than this
};

export type Gray = Float32Array;

export interface HoldUpdate {
  /** A new card is in the outline and still enough to be counting down. */
  steady: boolean;
  /** 0 to 1: how far through the hold we are. */
  progress: number;
  /** Set when it's time to capture: what the held card looked like. Pass it to captured(). */
  capture: Gray | null;
}

/** RGBA pixels -> grayscale with mean 0 and a fixed contrast. */
export function toGray(rgba: Uint8ClampedArray): Gray {
  const gray = new Float32Array(rgba.length / 4);

  let mean = 0;
  for (let i = 0; i < gray.length; i++) {
    gray[i] = rgba[i * 4]! * 0.3 + rgba[i * 4 + 1]! * 0.59 + rgba[i * 4 + 2]! * 0.11;
    mean += gray[i]!;
  }
  mean /= gray.length;

  let variance = 0;
  for (let i = 0; i < gray.length; i++) {
    gray[i]! -= mean;
    variance += gray[i]! * gray[i]!;
  }

  const k = 50 / (Math.sqrt(variance / gray.length) || 1);
  for (let i = 0; i < gray.length; i++) gray[i]! *= k;
  return gray;
}

/** Average per-pixel difference between two samples. */
export function difference(a: Gray, b: Gray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

export class HoldDetector {
  private prev: Gray | null = null; // last calm sample
  private spikes = 0; // motion samples in a row
  private steadySince: number | null = null; // when the current hold started
  private held: { sum: Gray; count: number } | null = null; // calm samples of the current hold, summed
  private lastShot: Gray | null = null; // what the last capture looked like
  private lastShotAt = -Infinity;

  /**
   * Feed one sample. `autoCapture` off still tracks motion but never
   * reports steady or asks for a capture.
   */
  update(sample: Gray, now: number, autoCapture: boolean): HoldUpdate {
    const spike = !this.prev || difference(sample, this.prev) > HOLD.movingAbove;

    if (spike) {
      // A twitch or refocus: skip this sample and keep comparing against the
      // last calm one. Only sustained motion restarts the hold.
      this.spikes++;
      if (this.spikes > HOLD.spikesAllowed) {
        this.prev = sample;
        this.restartHold();
      }
    } else {
      this.spikes = 0;
      this.prev = sample;
      if (!this.held) {
        this.steadySince = now;
        this.held = { sum: new Float32Array(sample.length), count: 0 };
      }
      // Average the calm samples of this hold; shake mostly cancels out.
      for (let i = 0; i < sample.length; i++) this.held.sum[i]! += sample[i]!;
      this.held.count++;
    }

    const held = this.held;
    const heldFrame = held?.count ? held.sum.map((v) => v / held.count) : null;
    const isNew = !!heldFrame && (!this.lastShot || difference(heldFrame, this.lastShot) > HOLD.newCardAbove);
    const heldMs = this.steadySince == null ? 0 : now - this.steadySince;
    const steady = autoCapture && isNew;

    const due = steady && !spike && heldMs >= HOLD.steadyForMs && now - this.lastShotAt >= HOLD.minGapMs;
    return {
      steady,
      progress: steady ? Math.min(1, heldMs / HOLD.steadyForMs) : 0,
      capture: due ? heldFrame : null,
    };
  }

  /** A capture was taken (auto or by hand). The next one must show a different card. */
  captured(frame: Gray, now: number) {
    this.lastShot = frame;
    this.lastShotAt = now;
    this.restartHold();
  }

  private restartHold() {
    this.steadySince = null;
    this.held = null;
  }
}
