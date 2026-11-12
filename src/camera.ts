// Camera scan mode.
//
// A live viewfinder. Every few frames we compare a small grayscale copy of
// the area inside the card outline with the previous one. When it has held
// still for a moment and looks different from the last capture, we grab one
// full-size frame and send just that to /scan. Comparing frames happens in
// the browser and costs nothing; only captures use the daily allowance.

import { setStatus, ui } from "./dom";
import { addLines, cardLine, readCards, type ScanOutcome } from "./scan";
import { context2d, InOrder, plural } from "./util";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext; // older Safari
  }
}

// Differences are measured on a tiny, blurred grayscale copy of the outline
// area, normalized for brightness and contrast so auto-exposure doesn't count
// as motion. In testing, the same card in a shaky hand stayed under ~10, and two
// different cards with the same layout were 17+ apart.
const CAM = {
  sampleEveryMs: 100,
  sampleW: 20, // card-shaped sample (small = forgiving of hand shake)
  sampleH: 28,
  movingAbove: 11, // change between samples that counts as motion
  spikesAllowed: 1, // ignore this many motion samples in a row (a twitch, a refocus)
  steadyForMs: 600, // hold roughly still this long to auto-capture
  newCardAbove: 13, // must differ this much from the last capture
  minGapMs: 1000, // never capture faster than this
  captureMaxSide: 1280,
  cropMargin: 0.06, // grab a little outside the outline
};

const el = ui.camera;

/* =====================================================================
   State
   ===================================================================== */

type Gray = Float32Array;

/** Motion tracking between samples. */
interface Motion {
  prev: Gray | null; // last calm sample
  spikes: number; // motion samples in a row
  steadySince: number | null; // when the current hold started
  held: { sum: Gray; count: number } | null; // running sum of calm samples in the current hold
  lastShot: Gray | null; // what the last capture looked like
  lastShotAt: number;
}

/** Captures since the camera was opened. */
interface Tally {
  results: InOrder<ScanOutcome>; // written to the list in capture order
  started: number;
  added: number;
  empty: number;
  failed: number;
}

const newMotion = (): Motion => ({
  prev: null, spikes: 0, steadySince: null, held: null, lastShot: null, lastShotAt: 0,
});
const newTally = (): Tally => ({
  results: new InOrder(showCaptureResult), started: 0, added: 0, empty: 0, failed: 0,
});

let motion = newMotion();
let tally = newTally();
let stream: MediaStream | null = null;
let timer: number | undefined;
let auto = true;
let audio: AudioContext | null = null;

const isOpen = () => !el.root.hidden;

/* =====================================================================
   Sampling the viewfinder
   ===================================================================== */

const sampleCanvas = document.createElement("canvas");
sampleCanvas.width = CAM.sampleW;
sampleCanvas.height = CAM.sampleH;
const sampleCtx = context2d(sampleCanvas, { willReadFrequently: true });

// Where the on-screen card outline falls in the video's own pixels.
// The video is shown with object-fit: cover, so undo that scaling.
function guideRectInVideo(margin = 0) {
  const { videoWidth: vw, videoHeight: vh } = el.video;
  const box = el.video.getBoundingClientRect();
  const guide = el.guide.getBoundingClientRect();
  const scale = Math.max(box.width / vw, box.height / vh);
  const offX = (box.width - vw * scale) / 2;
  const offY = (box.height - vh * scale) / 2;
  const mx = guide.width * margin;
  const my = guide.height * margin;

  const x = Math.max(0, (guide.left - mx - box.left - offX) / scale);
  const y = Math.max(0, (guide.top - my - box.top - offY) / scale);
  const w = Math.min(vw - x, (guide.width + 2 * mx) / scale);
  const h = Math.min(vh - y, (guide.height + 2 * my) / scale);
  return { x, y, w, h };
}

/** A small grayscale copy of the outline area, scaled to a fixed contrast. */
function sampleGray(): Gray {
  const r = guideRectInVideo();
  sampleCtx.drawImage(el.video, r.x, r.y, r.w, r.h, 0, 0, CAM.sampleW, CAM.sampleH);
  const px = sampleCtx.getImageData(0, 0, CAM.sampleW, CAM.sampleH).data;
  const gray = new Float32Array(CAM.sampleW * CAM.sampleH);

  let mean = 0;
  for (let i = 0; i < gray.length; i++) {
    gray[i] = px[i * 4]! * 0.3 + px[i * 4 + 1]! * 0.59 + px[i * 4 + 2]! * 0.11;
    mean += gray[i]!;
  }
  mean /= gray.length;

  let variance = 0;
  for (let i = 0; i < gray.length; i++) {
    gray[i]! -= mean;
    variance += gray[i]! * gray[i]!;
  }

  // Scale to a fixed contrast so exposure changes don't look like motion.
  const k = 50 / (Math.sqrt(variance / gray.length) || 1);
  for (let i = 0; i < gray.length; i++) gray[i]! *= k;
  return gray;
}

function meanDiff(a: Gray, b: Gray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

/** Runs every few frames: track motion, and capture once a new card has held still. */
function tick() {
  if (!el.video.videoWidth || document.hidden) return;

  const gray = sampleGray();
  const now = performance.now();
  const spike = (motion.prev ? meanDiff(gray, motion.prev) : 255) > CAM.movingAbove;

  if (spike) {
    // A twitch or refocus: skip this frame and keep comparing against the last
    // calm one. Only sustained motion restarts the hold.
    motion.spikes++;
    if (motion.spikes > CAM.spikesAllowed) {
      motion.prev = gray;
      motion.steadySince = null;
      motion.held = null;
    }
  } else {
    motion.spikes = 0;
    motion.prev = gray;
    if (motion.steadySince == null) {
      motion.steadySince = now;
      motion.held = { sum: new Float32Array(gray.length), count: 0 };
    }
    // Average the calm frames of this hold; shake mostly cancels out.
    const held = motion.held!;
    for (let i = 0; i < gray.length; i++) held.sum[i]! += gray[i]!;
    held.count++;
  }

  const held = motion.held;
  const heldFrame = held?.count ? held.sum.map((v) => v / held.count) : null;
  const isNew = !!heldFrame && (!motion.lastShot || meanDiff(heldFrame, motion.lastShot) > CAM.newCardAbove);
  const heldMs = motion.steadySince == null ? 0 : now - motion.steadySince;
  const ready = auto && isNew;

  // Fill the bar under the outline as the hold progresses.
  el.guide.classList.toggle("steady", ready);
  el.guide.style.setProperty("--hold", String(ready ? Math.min(1, heldMs / CAM.steadyForMs) : 0));

  if (ready && !spike && heldMs >= CAM.steadyForMs && now - motion.lastShotAt >= CAM.minGapMs) {
    capture(heldFrame);
  }
}

/* =====================================================================
   Capturing
   ===================================================================== */

/** Flash, buzz and beep. */
function captureFeedback() {
  el.flash.classList.add("on");
  requestAnimationFrame(() => requestAnimationFrame(() => el.flash.classList.remove("on")));
  el.guide.classList.add("shot");
  setTimeout(() => el.guide.classList.remove("shot"), 500);
  navigator.vibrate?.(40);

  if (!audio) return;
  try {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.12);
  } catch {}
}

/** Crop the outline (plus a margin) out of the video at full resolution. */
function cropFrame(): HTMLCanvasElement {
  const r = guideRectInVideo(CAM.cropMargin);
  const scale = Math.min(1, CAM.captureMaxSide / Math.max(r.w, r.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(r.w * scale);
  canvas.height = Math.round(r.h * scale);
  context2d(canvas).drawImage(el.video, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Capture now and read the card. `gray` is what the hold looked like, if known. */
async function capture(gray: Gray | null = null) {
  if (!el.video.videoWidth) return;
  motion.lastShot = gray ?? sampleGray();
  motion.lastShotAt = performance.now();
  motion.steadySince = null;
  motion.held = null;
  el.guide.style.setProperty("--hold", "0");
  captureFeedback();

  const canvas = cropFrame();
  const thisTally = tally;
  const i = thisTally.started++;
  showCameraStatus();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  const outcome: ScanOutcome = blob ? await readCards(blob) : { error: "Couldn't capture the frame" };

  // The camera was closed and reopened while this was reading: just add it.
  if (thisTally !== tally) {
    if ("cards" in outcome && outcome.cards.length) addLines(outcome.cards.map(cardLine));
    return;
  }

  tally.results.set(i, outcome);
  showCameraStatus();
  // Camera already closed: report on the page once everything is in.
  if (!isOpen() && tally.results.handled === tally.started) showSummary();
}

/** Called for each capture, in capture order, once it's been read. */
function showCaptureResult(outcome: ScanOutcome) {
  if ("error" in outcome) {
    tally.failed++;
    el.lastCapture.textContent = `✕ ${outcome.error.slice(0, 120)}`;
  } else if (!outcome.cards.length) {
    tally.empty++;
    el.lastCapture.textContent = "No card found, try again";
  } else {
    const lines = outcome.cards.map(cardLine);
    addLines(lines);
    tally.added += lines.length;
    el.lastCapture.textContent = `✓ ${lines.join(", ")}`;
  }
}

function showCameraStatus() {
  const reading = tally.started - tally.results.finished;
  const parts = [`${plural(tally.added, "card")} added`];
  if (reading) parts.push(`${reading} reading`);
  if (tally.empty) parts.push(`${tally.empty} no card`);
  if (tally.failed) parts.push(`${tally.failed} failed`);
  el.message.textContent = parts.join(" · ");
}

/** The page's status line after the camera is closed. */
function showSummary() {
  const parts = [`Added ${plural(tally.added, "card")} with the camera. Check them, then press “Look up values”.`];
  if (tally.empty) parts.push(`${plural(tally.empty, "capture")} had no card.`);
  if (tally.failed) parts.push(`${tally.failed} failed.`);
  setStatus(parts.join(" "));
}

/* =====================================================================
   Opening and closing
   ===================================================================== */

async function open() {
  try {
    const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
    audio ??= AudioCtx ? new AudioCtx() : null;
    audio?.resume();
  } catch {}

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (err) {
    const name = err instanceof Error ? err.name || err.message : String(err);
    setStatus(
      name === "NotAllowedError"
        ? "Camera permission was denied. Allow it in your browser's site settings and try again."
        : `Couldn't open the camera (${name}).`,
    );
    return;
  }

  motion = newMotion();
  tally = newTally();
  el.video.srcObject = stream;
  el.root.hidden = false;
  document.body.style.overflow = "hidden";
  el.message.textContent = "Hold a card inside the frame";
  el.lastCapture.textContent = auto ? "It captures when the card holds still" : "Tap the button to capture";
  timer = window.setInterval(tick, CAM.sampleEveryMs);
  el.shutter.focus();
}

function close() {
  window.clearInterval(timer);
  timer = undefined;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  el.video.srcObject = null;
  el.root.hidden = true;
  document.body.style.overflow = "";

  const stillReading = tally.started - tally.results.handled;
  if (stillReading) setStatus(`Reading ${stillReading} more camera capture(s)…`);
  else showSummary();
  ui.cameraButton.focus();
}

function toggleAuto() {
  auto = !auto;
  el.autoButton.textContent = `Auto: ${auto ? "on" : "off"}`;
  el.autoButton.setAttribute("aria-pressed", String(auto));
  el.guide.classList.remove("steady");
}

export function initCamera() {
  if (!navigator.mediaDevices?.getUserMedia) return; // the button stays hidden
  ui.cameraButton.hidden = false;

  ui.cameraButton.addEventListener("click", open);
  el.doneButton.addEventListener("click", close);
  el.shutter.addEventListener("click", () => capture());
  el.autoButton.addEventListener("click", toggleAuto);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) close();
  });
}
