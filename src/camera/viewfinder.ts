// Camera scan mode: the full-screen viewfinder.
//
// Every few frames we sample the area inside the card outline and hand it to
// the HoldDetector (hold-detector.ts), which says when a new card has held
// still. Then we grab one full-size frame and send just that to /scan.
// Sampling happens in the browser and costs nothing; only captures use the
// daily allowance.

import { setStatus, ui } from "../dom";
import { addLines, cardLine, readCards, type ScanOutcome } from "../scan";
import { context2d, InOrder, plural } from "../util";
import { HOLD, HoldDetector, toGray, type Gray } from "./hold-detector";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext; // older Safari
  }
}

const SAMPLE_EVERY_MS = 100;
const CAPTURE_MAX_SIDE = 1280; // px; enough to read the collector number
const CROP_MARGIN = 0.06; // grab a little outside the outline

const el = ui.camera;

/** Captures since the camera was opened. */
interface Tally {
  results: InOrder<ScanOutcome>; // written to the list in capture order
  started: number;
  added: number;
  empty: number;
  failed: number;
}

const newTally = (): Tally => ({
  results: new InOrder(showCaptureResult), started: 0, added: 0, empty: 0, failed: 0,
});

let detector = new HoldDetector();
let tally = newTally();
let stream: MediaStream | null = null;
let timer: number | undefined;
let autoCapture = true;
let audio: AudioContext | null = null;

const isOpen = () => !el.root.hidden;

/* =====================================================================
   Reading the video
   ===================================================================== */

// Where the on-screen card outline falls in the video's own pixels.
// The video is shown with object-fit: cover, so undo that scaling.
function outlineInVideo(margin = 0) {
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

const sampleCanvas = document.createElement("canvas");
sampleCanvas.width = HOLD.sampleW;
sampleCanvas.height = HOLD.sampleH;
const sampleCtx = context2d(sampleCanvas, { willReadFrequently: true });

/** A tiny copy of the outline area, for the detector. */
function sample(): Gray {
  const r = outlineInVideo();
  sampleCtx.drawImage(el.video, r.x, r.y, r.w, r.h, 0, 0, HOLD.sampleW, HOLD.sampleH);
  return toGray(sampleCtx.getImageData(0, 0, HOLD.sampleW, HOLD.sampleH).data);
}

/** The outline area (plus a margin) at full resolution, as a JPEG. */
function cropFrame(): Promise<Blob | null> {
  const r = outlineInVideo(CROP_MARGIN);
  const scale = Math.min(1, CAPTURE_MAX_SIDE / Math.max(r.w, r.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(r.w * scale);
  canvas.height = Math.round(r.h * scale);
  context2d(canvas).drawImage(el.video, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
}

/** Runs every SAMPLE_EVERY_MS while the camera is open. */
function tick() {
  if (!el.video.videoWidth || document.hidden) return;

  const hold = detector.update(sample(), performance.now(), autoCapture);

  // Fill the bar under the outline as the hold progresses.
  el.guide.classList.toggle("steady", hold.steady);
  el.guide.style.setProperty("--hold", String(hold.progress));

  if (hold.capture) capture(hold.capture);
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

/** Capture now and read the card. `held` is what the detector saw, if it asked for this capture. */
async function capture(held: Gray | null = null) {
  if (!el.video.videoWidth) return;
  detector.captured(held ?? sample(), performance.now());
  el.guide.style.setProperty("--hold", "0");
  captureFeedback();

  const photo = cropFrame();
  const thisTally = tally;
  const i = thisTally.started++;
  showCameraStatus();

  const blob = await photo;
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

  detector = new HoldDetector();
  tally = newTally();
  el.video.srcObject = stream;
  el.root.hidden = false;
  document.body.style.overflow = "hidden";
  el.message.textContent = "Hold a card inside the frame";
  el.lastCapture.textContent = autoCapture ? "It captures when the card holds still" : "Tap the button to capture";
  timer = window.setInterval(tick, SAMPLE_EVERY_MS);
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
  autoCapture = !autoCapture;
  el.autoButton.textContent = `Auto: ${autoCapture ? "on" : "off"}`;
  el.autoButton.setAttribute("aria-pressed", String(autoCapture));
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
