import { describe, expect, test } from "bun:test";
import { photoRegion } from "./still-photo";

const centre = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

describe("photoRegion", () => {
  test("same shape: scales straight up", () => {
    const rect = photoRegion(centre, { width: 1920, height: 1080 }, { width: 3840, height: 2160 });
    expect(rect).toEqual({ x: 960, y: 540, w: 1920, h: 1080 });
  });

  test("16:9 video from a 4:3 photo: video is the photo's middle band", () => {
    // 1920x1080 video, 4000x3000 photo: the video covers 4000x2250 of it, 375px down.
    const rect = photoRegion(centre, { width: 1920, height: 1080 }, { width: 4000, height: 3000 })!;
    expect(rect.x).toBeCloseTo(1000);
    expect(rect.w).toBeCloseTo(2000);
    expect(rect.y).toBeCloseTo(375 + 562.5);
    expect(rect.h).toBeCloseTo(1125);
  });

  test("portrait video and portrait photo", () => {
    const rect = photoRegion(centre, { width: 1080, height: 1920 }, { width: 3000, height: 4000 })!;
    expect(rect.y).toBeCloseTo(1000);
    expect(rect.h).toBeCloseTo(2000);
    expect(rect.x).toBeCloseTo(375 + 562.5);
  });

  test("gives up when orientations disagree", () => {
    expect(photoRegion(centre, { width: 1080, height: 1920 }, { width: 4000, height: 3000 })).toBeNull();
  });

  test("stays inside the photo", () => {
    const rect = photoRegion({ x: -0.1, y: 0.9, w: 0.5, h: 0.5 }, { width: 100, height: 100 }, { width: 200, height: 200 })!;
    expect(rect.x).toBe(0);
    expect(rect.y + rect.h).toBeLessThanOrEqual(200);
  });
});
