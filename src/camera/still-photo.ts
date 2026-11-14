// Cropping a capture out of either a video frame or a full-resolution photo.
//
// Where the browser supports ImageCapture (Chrome on Android, not Safari),
// takePhoto() gives a proper still from the camera's photo pipeline: full
// sensor resolution, better focus and noise handling than a video frame.
// Elsewhere, or if it fails, we use the video frame.

import { context2d } from "../util";

/** A rectangle as fractions (0 to 1) of an image's width and height. */
export interface Fraction {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A rectangle in pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TAKE_PHOTO_TIMEOUT_MS = 3000;

export const canTakePhotos = () => typeof ImageCapture !== "undefined";

/**
 * Where a region of the video falls in a full photo from the same camera.
 *
 * The video is usually a centred crop of the sensor (16:9 video from a 4:3
 * sensor), so the photo shows a bit more around the edges. Returns null when
 * the two disagree on orientation (one portrait, one landscape): we can't
 * line them up safely then.
 */
export function photoRegion(
  region: Fraction,
  video: { width: number; height: number },
  photo: { width: number; height: number },
): Rect | null {
  if (video.width > video.height !== photo.width > photo.height) return null;

  const scale = Math.min(photo.width / video.width, photo.height / video.height);
  const offX = (photo.width - video.width * scale) / 2;
  const offY = (photo.height - video.height * scale) / 2;

  const x = Math.max(0, offX + region.x * video.width * scale);
  const y = Math.max(0, offY + region.y * video.height * scale);
  const w = Math.min(photo.width - x, region.w * video.width * scale);
  const h = Math.min(photo.height - y, region.h * video.height * scale);
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** Crops `rect` out of `source` and returns it as a JPEG no bigger than maxSide. */
export function cropToJpeg(source: CanvasImageSource, rect: Rect, maxSide: number): Promise<Blob | null> {
  const scale = Math.min(1, maxSide / Math.max(rect.w, rect.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(rect.w * scale);
  canvas.height = Math.round(rect.h * scale);
  context2d(canvas).drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("takePhoto timed out")), ms));
}

/**
 * Takes a full-resolution photo and crops `region` (fractions of the video
 * frame) out of it. Null if the photo couldn't be taken or lined up.
 */
export async function takeCroppedPhoto(
  camera: ImageCapture,
  region: Fraction,
  video: { width: number; height: number },
  maxSide: number,
): Promise<Blob | null> {
  try {
    const photo = await Promise.race([camera.takePhoto(), timeout(TAKE_PHOTO_TIMEOUT_MS)]);
    const bitmap = await createImageBitmap(photo, { imageOrientation: "from-image" });
    try {
      const rect = photoRegion(region, video, bitmap);
      return rect ? await cropToJpeg(bitmap, rect, maxSide) : null;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
