import { describe, expect, test } from "bun:test";
import { HOLD, HoldDetector, toGray, type Gray, type HoldUpdate } from "./hold-detector";

const PIXELS = HOLD.sampleW * HOLD.sampleH;
const STEP_MS = 100;

/** A made-up card: a pattern picked by `seed`, plus optional jitter for a shaky hand. */
function card(seed: number, jitter = 0): Gray {
  const rgba = new Uint8ClampedArray(PIXELS * 4);
  for (let i = 0; i < PIXELS; i++) {
    const v = 128 + 100 * Math.sin(i * 0.37 * seed + seed) + (Math.random() - 0.5) * jitter;
    rgba.set([v, v, v, 255], i * 4);
  }
  return toGray(rgba);
}

/** Feeds samples 100 ms apart and returns every update. */
function feed(detector: HoldDetector, samples: Gray[], start = 0, auto = true): HoldUpdate[] {
  return samples.map((s, i) => detector.update(s, start + i * STEP_MS, auto));
}

const times = <T>(n: number, make: () => T) => Array.from({ length: n }, make);

describe("toGray", () => {
  test("ignores brightness and contrast changes", () => {
    const rgba = new Uint8ClampedArray(PIXELS * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 200));
    const dimmer = rgba.map((v, i) => (i % 4 === 3 ? v : v * 0.5 + 20));
    const a = toGray(rgba);
    const b = toGray(dimmer);
    for (let i = 0; i < a.length; i++) expect(a[i]!).toBeCloseTo(b[i]!, 0);
  });
});

describe("HoldDetector", () => {
  test("captures a card held still long enough", () => {
    const updates = feed(new HoldDetector(), times(10, () => card(1)));
    const first = updates.findIndex((u) => u.capture);
    // The first two samples have nothing calm to compare against, so the hold
    // starts on the third; then 600 ms of holding.
    expect(first).toBe(2 + HOLD.steadyForMs / STEP_MS);
    expect(updates[first - 1]!.progress).toBeLessThan(1);
    expect(updates[first]!.progress).toBe(1);
  });

  test("captures through a little hand shake", () => {
    const updates = feed(new HoldDetector(), times(12, () => card(1, 4)));
    expect(updates.some((u) => u.capture)).toBe(true);
  });

  test("doesn't capture the same card twice", () => {
    const detector = new HoldDetector();
    const updates = feed(detector, times(30, () => card(1)));
    const capture = updates.find((u) => u.capture)!.capture!;
    detector.captured(capture, 700);
    const later = feed(detector, times(30, () => card(1)), 800);
    expect(later.some((u) => u.capture)).toBe(false);
  });

  test("captures the next, different card", () => {
    const detector = new HoldDetector();
    const first = feed(detector, times(10, () => card(1))).find((u) => u.capture)!.capture!;
    detector.captured(first, 1000);
    const next = feed(detector, times(15, () => card(2)), 1100);
    expect(next.some((u) => u.capture)).toBe(true);
  });

  test("one twitch doesn't restart the hold", () => {
    const samples = [...times(4, () => card(1)), card(9), ...times(4, () => card(1))];
    const updates = feed(new HoldDetector(), samples);
    expect(updates.some((u) => u.capture)).toBe(true);
  });

  test("sustained motion restarts the hold", () => {
    const samples = [...times(4, () => card(1)), card(9), card(5), card(1), card(1)];
    const updates = feed(new HoldDetector(), samples);
    expect(updates.some((u) => u.capture)).toBe(false);
    expect(updates.at(-1)!.progress).toBeLessThan(0.5);
  });

  test("with auto-capture off, never asks to capture", () => {
    const updates = feed(new HoldDetector(), times(20, () => card(1)), 0, false);
    expect(updates.every((u) => !u.capture && !u.steady && u.progress === 0)).toBe(true);
  });
});
