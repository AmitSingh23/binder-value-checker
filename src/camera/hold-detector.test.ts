import { describe, expect, test } from "bun:test";
import { normalize, SIGNATURE, type Frame, type Gray } from "./frame";
import { HOLD, HoldDetector, type HoldUpdate, type Phase } from "./hold-detector";

const STEP_MS = 100;

/** A made-up card's signature: a pattern picked by `seed`, plus optional jitter for a shaky hand. */
function signature(seed: number, jitter = 0): Gray {
  const values = new Float32Array(SIGNATURE.w * SIGNATURE.h);
  for (let y = 0; y < SIGNATURE.h; y++) {
    for (let x = 0; x < SIGNATURE.w; x++) {
      values[y * SIGNATURE.w + x] =
        Math.sin((x + y) * 0.45 * seed + seed) + Math.cos((x - 2 * y) * 0.3 * seed) + (Math.random() - 0.5) * jitter;
    }
  }
  normalize(values);
  return values;
}

/** A card lined up with the outline. Override anything. */
const card = (seed: number, extra: Partial<Frame> & { jitter?: number } = {}): Frame => ({
  signature: signature(seed, extra.jitter),
  contrast: 40,
  edges: 4,
  sharpness: null,
  ...extra,
});

const bareTable = (): Frame => ({ signature: signature(77, 2), contrast: 2, edges: 0, sharpness: null });

/** Feeds frames 100 ms apart and returns every update. */
function feed(detector: HoldDetector, frames: Frame[], start = 0, auto = true): HoldUpdate[] {
  return frames.map((f, i) => detector.update(f, start + i * STEP_MS, auto));
}

const times = <T>(n: number, make: () => T) => Array.from({ length: n }, make);
const captures = (updates: HoldUpdate[]) => updates.filter((u) => u.capture).length;
const phases = (updates: HoldUpdate[]): Phase[] => updates.map((u) => u.phase);

/** Holds a card until it's captured, tells the detector, and returns when that was. */
function captureCard(detector: HoldDetector, seed: number, start = 0): number {
  const updates = feed(detector, times(10, () => card(seed)), start);
  const i = updates.findIndex((u) => u.capture);
  expect(i).toBeGreaterThan(-1);
  const at = start + i * STEP_MS;
  detector.captured(updates[i]!.capture!, at);
  return at;
}

describe("HoldDetector: holding still", () => {
  test("captures a lined-up card held still long enough", () => {
    const updates = feed(new HoldDetector(), times(10, () => card(1)));
    const first = updates.findIndex((u) => u.capture);
    // The hold starts on the first sample.
    expect(first).toBe(HOLD.steadyForMs / STEP_MS);
    expect(updates[first - 1]!.progress).toBeLessThan(1);
    expect(updates[first]!.progress).toBe(1);
    expect(updates[first]!.framed).toBe(true);
  });

  test("captures through a little hand shake", () => {
    const updates = feed(new HoldDetector(), times(12, () => card(1, { jitter: 0.25 })));
    expect(captures(updates)).toBeGreaterThan(0);
  });

  test("one twitch doesn't restart the hold", () => {
    const frames = [card(1), card(1), card(9), ...times(4, () => card(1))];
    expect(captures(feed(new HoldDetector(), frames))).toBeGreaterThan(0);
  });

  test("sustained motion restarts the hold", () => {
    const frames = [card(1), card(1), card(9), card(5), card(1), card(1)];
    const updates = feed(new HoldDetector(), frames);
    expect(captures(updates)).toBe(0);
    expect(updates[3]!.phase).toBe("moving");
    expect(updates.at(-1)!.progress).toBeLessThan(0.5);
  });

  test("with auto-capture off, reports what it sees but never counts down or captures", () => {
    const updates = feed(new HoldDetector(), times(20, () => card(1)), 0, false);
    expect(updates.every((u) => !u.capture && u.progress === 0 && u.phase === "holding")).toBe(true);
  });
});

describe("HoldDetector: is there a card?", () => {
  test("never captures a bare table", () => {
    const updates = feed(new HoldDetector(), times(40, bareTable));
    expect(captures(updates)).toBe(0);
    expect(new Set(phases(updates))).toEqual(new Set<Phase>(["empty"]));
  });

  test("waits longer when no card edges line up with the outline", () => {
    const updates = feed(new HoldDetector(), times(20, () => card(1, { edges: 0 })));
    const first = updates.findIndex((u) => u.capture);
    expect(first).toBe(HOLD.unframedForMs / STEP_MS);
    expect(updates[first]!.framed).toBe(false);
  });

  test("a view that came back with no card isn't captured again", () => {
    const detector = new HoldDetector();
    const woodGrain = () => card(3, { edges: 0 });
    const first = feed(detector, times(20, woodGrain)).find((u) => u.capture)!;
    detector.captured(first.capture!, 1200);
    detector.rejected(first.capture!, first.framed);

    // A hand comes and goes, then the same table again.
    feed(detector, times(5, () => card(8, { jitter: 3 })), 1300);
    const later = feed(detector, times(30, woodGrain), 1800);
    expect(captures(later)).toBe(0);
    expect(later.at(-1)!.phase).toBe("rejected");
  });

  test("a card that couldn't be read is held back, then tried again once it's been taken away", () => {
    const detector = new HoldDetector();
    const at = captureCard(detector, 1);
    detector.rejected(signature(1), true);

    const stillThere = feed(detector, times(20, () => card(1)), at + STEP_MS);
    expect(captures(stillThere)).toBe(0);

    feed(detector, times(HOLD.goneAfter, bareTable), at + 2200);
    const putBack = feed(detector, times(15, () => card(1)), at + 3000);
    expect(captures(putBack)).toBeGreaterThan(0);
  });
});

describe("HoldDetector: focus", () => {
  const sharpening = [100, 200, 400, 800, 1500, 2000, 2050, 2040, 2060, 2050];

  test("waits while the camera is still focusing", () => {
    const frames = sharpening.map((sharpness) => card(1, { sharpness }));
    const updates = feed(new HoldDetector(), frames);
    const first = updates.findIndex((u) => u.capture);
    expect(updates[HOLD.steadyForMs / STEP_MS]!.phase).toBe("focusing");
    expect(first).toBe(sharpening.indexOf(2050)); // the first sample that's no sharper than the one before
  });

  test("waits when focus has dropped away", () => {
    const frames = [2000, 2000, 2000, 900, 900, 2000, 2000].map((sharpness) => card(1, { sharpness }));
    const updates = feed(new HoldDetector(), frames);
    expect(updates[3]!.phase).toBe("focusing");
    expect(updates[4]!.phase).toBe("focusing");
    expect(updates.findIndex((u) => u.capture)).toBe(6);
  });

  test("gives up waiting for focus after a while", () => {
    // Sharpness that never settles.
    const frames = times(20, () => 0).map((_, i) => card(1, { sharpness: 100 * 1.3 ** i }));
    const first = feed(new HoldDetector(), frames).findIndex((u) => u.capture);
    expect(first).toBe((HOLD.steadyForMs + HOLD.focusWaitMs) / STEP_MS);
  });
});

describe("HoldDetector: one capture per card", () => {
  test("doesn't capture the same card twice while it stays put", () => {
    const detector = new HoldDetector();
    const at = captureCard(detector, 1);
    const later = feed(detector, times(40, () => card(1, { jitter: 0.25 })), at + STEP_MS);
    expect(captures(later)).toBe(0);
    expect(later.at(-1)!.phase).toBe("captured");
  });

  test("captures the next, different card", () => {
    const detector = new HoldDetector();
    const at = captureCard(detector, 1);
    const next = feed(detector, times(15, () => card(2)), at + STEP_MS);
    expect(captures(next)).toBeGreaterThan(0);
  });

  test("captures a second copy of the same card once the first is taken away", () => {
    const detector = new HoldDetector();
    const at = captureCard(detector, 1);
    feed(detector, times(HOLD.goneAfter, bareTable), at + STEP_MS);
    const second = feed(detector, times(15, () => card(1)), at + 1000);
    expect(captures(second)).toBeGreaterThan(0);
  });

  test("a glimpse of something else doesn't count as taking the card away", () => {
    const detector = new HoldDetector();
    const at = captureCard(detector, 1);
    feed(detector, times(HOLD.goneAfter - 1, bareTable), at + STEP_MS);
    const same = feed(detector, times(15, () => card(1)), at + 1000);
    expect(captures(same)).toBe(0);
  });

  test("never captures faster than the minimum gap", () => {
    const detector = new HoldDetector();
    const at = captureCard(detector, 1);
    const next = feed(detector, times(15, () => card(2)), at + STEP_MS);
    const first = next.findIndex((u) => u.capture);
    expect(at + STEP_MS + first * STEP_MS - at).toBeGreaterThanOrEqual(HOLD.minGapMs);
  });
});
