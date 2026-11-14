// Decides when a card held up to the camera should be captured.
//
// Knows nothing about the page: feed it one Frame (frame.ts) per sample and it
// says what it sees and when to capture. It captures a card once it
//
//   1. is there: the outline isn't showing a bare surface,
//   2. has held still for a moment (longer if no card edges line up with the outline),
//   3. is in focus, or has had long enough to get there, and
//   4. isn't the card that was just captured, or a view that already came back with no card.
//
// The numbers in HOLD were set by running card images through frame.ts with
// simulated hand shake, not yet on a real phone: a gently shaking card moves a
// signature by about 5 between samples, the same card nudged a few percent
// sideways is 14 to 17 from where it was, a different card is 24 or more away
// and a bare table 50.

import { differenceAllowingShift, difference, type Frame, type Gray } from "./frame";

export const HOLD = {
  minContrast: 10, // less than this inside the outline is a bare surface
  edgesNeeded: 3, // card edges along the outline for the card to count as lined up
  movingAbove: 8, // change between samples that counts as motion
  spikesAllowed: 1, // ignore this many motion samples in a row (a twitch, a refocus)
  steadyForMs: 300, // hold a lined-up card still this long to capture
  unframedForMs: 1200, // ...and this long when no edges are visible (dark sleeve, dark table)
  focusWaitMs: 600, // then wait up to this much longer for focus to settle
  focusDrop: 0.8, // in focus = at least this share of the sharpest sample of the hold
  focusRise: 1.15, // still focusing = sharper than the last sample by this factor
  sameCardBelow: 18, // this close to the last capture is the same card, maybe nudged
  goneAbove: 30, // this far from it, the card has been taken away...
  goneAfter: 3, // ...once that many samples in a row say so
  minGapMs: 1000, // never capture faster than this
  rejectsKept: 6, // captures that came back with no card, remembered so they aren't repeated
};

export type Phase =
  | "empty" // nothing in the outline
  | "moving" // something's there, but it's moving
  | "holding" // still and new: counting down to a capture
  | "focusing" // held long enough, waiting for the camera to focus
  | "captured" // the card that was just captured is still there
  | "rejected"; // this view was captured before and had no readable card

export interface HoldUpdate {
  phase: Phase;
  /** Card edges line up with the outline. */
  framed: boolean;
  /** 0 to 1: how far through the hold we are. Always 0 with auto-capture off. */
  progress: number;
  /** Set when it's time to capture: what the held card looked like. Pass it to captured(). */
  capture: Gray | null;
}

/** A capture that came back with no card in it. */
interface Reject {
  view: Gray;
  framed: boolean; // it looked like a card (so it's forgotten once taken away) rather than the table
  unlike: number; // samples in a row that didn't look like it
}

/** The calm samples of one hold. */
interface Hold {
  since: number;
  sum: Gray; // signatures added up; averaging cancels most of the shake
  count: number;
  framed: number; // how many of them had the card's edges lined up
  sharpness: number | null; // of the latest sample, and the one before it
  sharpnessBefore: number | null;
  sharpest: number;
}

export class HoldDetector {
  private prev: Gray | null = null; // last calm sample
  private spikes = 0; // motion samples in a row
  private hold: Hold | null = null;
  private lastShot: Gray | null = null; // the last capture, until that card is taken away
  private unlikeLastShot = 0; // samples in a row that didn't look like it
  private lastShotAt = -Infinity;
  private rejects: Reject[] = [];

  /**
   * Feed one sample. With `autoCapture` off it still reports what it sees,
   * but never counts down or asks for a capture.
   */
  update(frame: Frame, now: number, autoCapture: boolean): HoldUpdate {
    const sample = frame.signature;
    this.watchForCardsLeaving(frame);

    if (frame.contrast < HOLD.minContrast) {
      this.prev = null;
      this.spikes = 0;
      this.hold = null;
      return { phase: "empty", framed: false, progress: 0, capture: null };
    }

    // The first sample has nothing to compare against; treat it as calm so the
    // hold starts right away.
    const spike = !!this.prev && difference(sample, this.prev) > HOLD.movingAbove;

    if (spike) {
      // A twitch or refocus: skip this sample and keep comparing against the
      // last calm one. Only sustained motion restarts the hold.
      this.spikes++;
      if (this.spikes > HOLD.spikesAllowed) {
        this.prev = sample;
        this.hold = null;
      }
    } else {
      this.spikes = 0;
      this.prev = sample;
      this.addToHold(frame, now);
    }

    const hold = this.hold;
    if (!hold) return { phase: "moving", framed: false, progress: 0, capture: null };

    const held = hold.sum.map((v) => v / hold.count);
    const framed = hold.framed * 2 >= hold.count;
    const still = { framed, progress: 0, capture: null };

    if (this.lastShot && this.looksLike(held, this.lastShot)) return { phase: "captured", ...still };
    if (this.rejects.some((r) => this.looksLike(held, r.view))) return { phase: "rejected", ...still };
    if (!autoCapture) return { phase: "holding", ...still };

    const heldMs = now - hold.since;
    const needMs = framed ? HOLD.steadyForMs : HOLD.unframedForMs;
    const progress = Math.min(1, heldMs / needMs);
    if (heldMs < needMs) return { phase: "holding", framed, progress, capture: null };

    const focused = inFocus(hold) || heldMs >= needMs + HOLD.focusWaitMs;
    if (!focused) return { phase: "focusing", framed, progress, capture: null };

    const due = !spike && now - this.lastShotAt >= HOLD.minGapMs;
    return { phase: "holding", framed, progress, capture: due ? held : null };
  }

  /** A capture was taken (auto or by hand). The next one must show a different card. */
  captured(view: Gray, now: number) {
    this.lastShot = view;
    this.unlikeLastShot = 0;
    this.lastShotAt = now;
    this.hold = null;
  }

  /**
   * A capture came back with no card in it; don't capture that view again.
   * If it was `framed` it was probably a card that couldn't be read, so it's
   * only held back until it's taken away. Otherwise it's the table, for good.
   */
  rejected(view: Gray, framed: boolean) {
    this.rejects.push({ view, framed, unlike: 0 });
    if (this.rejects.length > HOLD.rejectsKept) this.rejects.shift();
  }

  private looksLike(a: Gray, b: Gray): boolean {
    return differenceAllowingShift(a, b) < HOLD.sameCardBelow;
  }

  // Once the captured card has been taken away, anything may be captured next,
  // even a second copy that looks just the same. Likewise a card that couldn't
  // be read gets another go once it's been taken away and put back.
  private watchForCardsLeaving(frame: Frame) {
    const gone = (view: Gray) =>
      frame.contrast < HOLD.minContrast || differenceAllowingShift(frame.signature, view) > HOLD.goneAbove;

    if (this.lastShot) {
      this.unlikeLastShot = gone(this.lastShot) ? this.unlikeLastShot + 1 : 0;
      if (this.unlikeLastShot >= HOLD.goneAfter) this.lastShot = null;
    }
    for (const reject of this.rejects) {
      if (reject.framed) reject.unlike = gone(reject.view) ? reject.unlike + 1 : 0;
    }
    this.rejects = this.rejects.filter((r) => r.unlike < HOLD.goneAfter);
  }

  private addToHold(frame: Frame, now: number) {
    const size = frame.signature.length;
    const hold = (this.hold ??= {
      since: now, sum: new Float32Array(size), count: 0, framed: 0, sharpness: null, sharpnessBefore: null, sharpest: 0,
    });
    for (let i = 0; i < size; i++) hold.sum[i]! += frame.signature[i]!;
    hold.count++;
    if (frame.edges >= HOLD.edgesNeeded) hold.framed++;

    hold.sharpnessBefore = hold.sharpness;
    hold.sharpness = frame.sharpness;
    hold.sharpest = Math.max(hold.sharpest, frame.sharpness ?? 0);
  }
}

/** Not blurrier than this hold has been, and not still getting sharper. */
function inFocus(hold: Hold): boolean {
  const { sharpness, sharpnessBefore, sharpest } = hold;
  if (sharpness == null) return true; // nothing to go on
  if (sharpnessBefore == null) return false; // one sample doesn't say which way focus is going
  return sharpness >= sharpest * HOLD.focusDrop && sharpness <= sharpnessBefore * HOLD.focusRise;
}
