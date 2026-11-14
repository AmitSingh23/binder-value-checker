// Camera scan mode: the full-screen viewfinder.
//
// Ten times a second we sample the area around the card outline (frame.ts)
// and hand it to the HoldDetector (hold-detector.ts), which says what it sees
// and when a new card has held still. Then we grab one full-size picture and
// send just that to /scan. Sampling happens in the browser and costs nothing;
// only captures use the daily allowance.
//
// Each capture shows up as a chip in the tray along the bottom: its picture,
// then what was read. Removing a chip takes its cards back off the list.

import { setStatus, ui } from "../dom";
import { addLines, cardLine, readCards, removeLines, type ScanOutcome } from "../scan";
import { context2d, InOrder, plural } from "../util";
import { FOCUS_PATCH, GRID, GRID_MARGIN, readFrame, type Frame, type Gray } from "./frame";
import { HoldDetector, type Phase } from "./hold-detector";
import { canTakePhotos, cropToJpeg, takeCroppedPhoto } from "./still-photo";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext; // older Safari
  }
}

const SAMPLE_EVERY_MS = 100;
const CAPTURE_MAX_SIDE = 1280; // px; enough to read the collector number
const CROP_MARGIN = 0.06; // grab a little outside the outline
const HINT_AFTER_SAMPLES = 2; // a phase must last this long before the hint changes

const el = ui.camera;

/** One capture and its chip in the tray. */
interface Shot {
  state: "reading" | "added" | "empty" | "failed";
  view: Gray; // what the detector saw, so a miss isn't captured again
  framed: boolean; // its edges lined up with the outline: a card, not the table
  lines: string[]; // what it added to the list
  removed: boolean;
  chip: HTMLLIElement;
  pictureUrl: string | null;
}

/** Everything captured since the camera was opened. */
interface Session {
  shots: Shot[];
  results: InOrder<ScanOutcome>; // written to the list in capture order
}

const newSession = (): Session => ({ shots: [], results: new InOrder(showResult) });

let detector = new HoldDetector();
let session = newSession();
let stream: MediaStream | null = null;
let photoCamera: ImageCapture | null = null; // full-resolution stills, where supported
let timer: number | undefined;
let autoCapture = true;
let torchOn = false;
let audio: AudioContext | null = null;

const isOpen = () => !el.root.hidden;

/* =====================================================================
   Reading the video
   ===================================================================== */

// Where the on-screen card outline falls in the video's own pixels, grown by
// a margin (a fraction of its width and height) on every side.
// The video is shown with object-fit: cover, so undo that scaling.
function outlineInVideo(marginX = 0, marginY = marginX) {
  const { videoWidth: vw, videoHeight: vh } = el.video;
  const box = el.video.getBoundingClientRect();
  const guide = el.guide.getBoundingClientRect();
  const scale = Math.max(box.width / vw, box.height / vh);
  const offX = (box.width - vw * scale) / 2;
  const offY = (box.height - vh * scale) / 2;
  const mx = guide.width * marginX;
  const my = guide.height * marginY;

  const x = Math.max(0, (guide.left - mx - box.left - offX) / scale);
  const y = Math.max(0, (guide.top - my - box.top - offY) / scale);
  const w = Math.min(vw - x, (guide.width + 2 * mx) / scale);
  const h = Math.min(vh - y, (guide.height + 2 * my) / scale);
  return { x, y, w, h };
}

function scratchCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = context2d(canvas, { willReadFrequently: true });
  ctx.imageSmoothingQuality = "medium"; // averages when shrinking, so shake doesn't shimmer
  return ctx;
}

const gridCtx = scratchCanvas(GRID.w, GRID.h);
const focusCtx = scratchCanvas(FOCUS_PATCH, FOCUS_PATCH);

/** What the detector needs to know about the current video frame. */
function sample(): Frame {
  const around = outlineInVideo(GRID_MARGIN.x, GRID_MARGIN.y);
  gridCtx.drawImage(el.video, around.x, around.y, around.w, around.h, 0, 0, GRID.w, GRID.h);

  // Focus is judged on full-size video pixels from the middle of the card.
  const card = outlineInVideo();
  const left = card.x + (card.w - FOCUS_PATCH) / 2;
  const top = card.y + (card.h - FOCUS_PATCH) / 2;
  focusCtx.drawImage(el.video, left, top, FOCUS_PATCH, FOCUS_PATCH, 0, 0, FOCUS_PATCH, FOCUS_PATCH);

  return readFrame(
    gridCtx.getImageData(0, 0, GRID.w, GRID.h).data,
    focusCtx.getImageData(0, 0, FOCUS_PATCH, FOCUS_PATCH).data,
  );
}

/**
 * The outline area (plus a margin) as a JPEG: from a full-resolution photo
 * when the browser can take one, else from the current video frame.
 */
async function takePicture(): Promise<Blob | null> {
  const video = { width: el.video.videoWidth, height: el.video.videoHeight };
  const rect = outlineInVideo(CROP_MARGIN);
  // Grab the video frame now, so there's a fallback from this exact moment.
  const fromVideo = cropToJpeg(el.video, rect, CAPTURE_MAX_SIDE);
  if (!photoCamera) return fromVideo;

  const region = { x: rect.x / video.width, y: rect.y / video.height, w: rect.w / video.width, h: rect.h / video.height };
  return (await takeCroppedPhoto(photoCamera, region, video, CAPTURE_MAX_SIDE)) ?? fromVideo;
}

/* =====================================================================
   The outline and the hint under it
   ===================================================================== */

const HINTS: Record<Phase, { auto: string; manual: string }> = {
  empty: { auto: "Fit a card inside the frame", manual: "Fit a card inside the frame" },
  moving: { auto: "Hold still", manual: "Hold still" },
  holding: { auto: "Hold still…", manual: "Tap the button to capture" },
  focusing: { auto: "Focusing…", manual: "Tap the button to capture" },
  captured: { auto: "Got it. Next card", manual: "Got it. Next card" },
  rejected: { auto: "Couldn't read that. Move it, or tap the button", manual: "Tap the button to try again" },
};

let hintPhase: Phase = "empty"; // the phase on show
let nextPhase: Phase = "empty"; // the phase the detector reported last
let nextPhaseSamples = 0; // how many samples in a row it has reported it
let framed = false; // the detector's last word on whether a card is lined up

// The detector can flip between phases from one sample to the next; the
// outline and hint only follow once a phase has lasted.
function showPhase(phase: Phase, now = false) {
  nextPhaseSamples = phase === nextPhase ? nextPhaseSamples + 1 : 1;
  nextPhase = phase;
  if (!now && nextPhaseSamples < HINT_AFTER_SAMPLES) return;

  hintPhase = phase;
  el.guide.dataset.phase = phase;
  const hint = HINTS[phase][autoCapture ? "auto" : "manual"];
  if (el.hint.textContent !== hint) el.hint.textContent = hint;
}

/** The ring around the outline fills as the hold progresses (0 to 1). */
function showHold(progress: number) {
  el.ring.style.strokeDashoffset = String(1 - progress);
}

/** Runs every SAMPLE_EVERY_MS while the camera is open. */
function tick() {
  if (!el.video.videoWidth || document.hidden) return;

  const hold = detector.update(sample(), performance.now(), autoCapture);
  framed = hold.framed;
  showPhase(hold.phase);
  showHold(hintPhase === hold.phase ? hold.progress : 0);

  if (hold.capture) capture(hold.capture);
}

/* =====================================================================
   Capturing
   ===================================================================== */

/** Flash, buzz and beep. */
function captureFeedback() {
  el.flash.classList.add("on");
  requestAnimationFrame(() => requestAnimationFrame(() => el.flash.classList.remove("on")));
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
  const view = held ?? sample().signature;
  detector.captured(view, performance.now());
  showHold(0);
  showPhase("captured", true);
  captureFeedback();

  const picture = takePicture();
  const mySession = session;
  const shot = addShot(view, framed);
  const i = mySession.shots.push(shot) - 1;
  showTally();

  const blob = await picture;
  if (blob) showPicture(shot, blob);
  const outcome: ScanOutcome = blob ? await readCards(blob) : { error: "Couldn't capture the frame" };

  // The camera was closed and reopened while this was reading: just add it.
  if (mySession !== session) {
    if (!shot.removed && "cards" in outcome && outcome.cards.length) addLines(outcome.cards.map(cardLine));
    return;
  }

  session.results.set(i, outcome);
  showTally();
  // Camera already closed: report on the page once everything is in.
  if (!isOpen() && session.results.handled === session.shots.length) showSummary();
}

/** Called for each capture, in capture order, once it's been read. */
function showResult(outcome: ScanOutcome, i: number) {
  const shot = session.shots[i]!;
  if (shot.removed) return;

  if ("error" in outcome) {
    shot.state = "failed";
    setChipText(shot, outcome.error.slice(0, 120));
  } else if (!outcome.cards.length) {
    shot.state = "empty";
    setChipText(shot, "No card found");
    detector.rejected(shot.view, shot.framed);
  } else {
    shot.state = "added";
    shot.lines = outcome.cards.map(cardLine);
    addLines(shot.lines);
    setChipText(shot, shot.lines.join(", "));
  }
  shot.chip.dataset.state = shot.state;
}

/* =====================================================================
   The tray of captures
   ===================================================================== */

/** A new chip at the front of the tray, showing "Reading…". */
function addShot(view: Gray, framed: boolean): Shot {
  const chip = document.createElement("li");
  chip.className = "shot";
  chip.dataset.state = "reading";
  chip.innerHTML = `
    <span class="shot-picture"></span>
    <span class="shot-text">Reading…</span>
    <button class="shot-remove" type="button" aria-label="Remove this capture">
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8"/></svg>
    </button>`;

  const shot: Shot = { state: "reading", view, framed, lines: [], removed: false, chip, pictureUrl: null };
  chip.querySelector("button")!.addEventListener("click", () => removeShot(shot));
  el.tray.prepend(chip);
  el.tray.scrollLeft = 0;
  return shot;
}

function setChipText(shot: Shot, text: string) {
  shot.chip.querySelector(".shot-text")!.textContent = text;
}

function showPicture(shot: Shot, picture: Blob) {
  if (shot.removed || !isOpen()) return;
  shot.pictureUrl = URL.createObjectURL(picture);
  const img = document.createElement("img");
  img.alt = "";
  img.src = shot.pictureUrl;
  shot.chip.querySelector(".shot-picture")!.append(img);
}

function forgetPicture(shot: Shot) {
  if (shot.pictureUrl) URL.revokeObjectURL(shot.pictureUrl);
  shot.pictureUrl = null;
}

/** Takes a capture back: off the tray, and its cards off the list. */
function removeShot(shot: Shot) {
  shot.removed = true;
  removeLines(shot.lines);
  forgetPicture(shot);
  shot.chip.remove();
  showTally();
  el.shutter.focus();
}

function tally() {
  const kept = session.shots.filter((s) => !s.removed);
  const count = (state: Shot["state"]) => kept.filter((s) => s.state === state).length;
  return {
    added: kept.reduce((sum, s) => sum + s.lines.length, 0),
    reading: count("reading"),
    empty: count("empty"),
    failed: count("failed"),
  };
}

/** The line along the top of the viewfinder. */
function showTally() {
  const t = tally();
  const parts = [`${plural(t.added, "card")} added`];
  if (t.reading) parts.push(`${t.reading} reading`);
  if (t.empty) parts.push(`${t.empty} no card`);
  if (t.failed) parts.push(`${t.failed} failed`);
  el.message.textContent = parts.join(" · ");
}

/** The page's status line after the camera is closed. */
function showSummary() {
  const t = tally();
  const parts = [`Added ${plural(t.added, "card")} with the camera. Check them, then press “Look up values”.`];
  if (t.empty) parts.push(`${plural(t.empty, "capture")} had no card.`);
  if (t.failed) parts.push(`${t.failed} failed.`);
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

  const track = stream.getVideoTracks()[0];
  try {
    photoCamera = track && canTakePhotos() ? new ImageCapture(track) : null;
  } catch {
    photoCamera = null;
  }
  // The phone's light, where the browser lets us switch it (Chrome on Android).
  torchOn = false;
  el.torchButton.hidden = !(track?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch;
  el.torchButton.setAttribute("aria-pressed", "false");

  detector = new HoldDetector();
  session = newSession();
  el.tray.replaceChildren();
  el.video.srcObject = stream;
  el.root.hidden = false;
  document.body.style.overflow = "hidden";
  showHold(0);
  showPhase("empty", true);
  showTally();
  timer = window.setInterval(tick, SAMPLE_EVERY_MS);
  el.shutter.focus();
}

function close() {
  window.clearInterval(timer);
  timer = undefined;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  photoCamera = null;
  el.video.srcObject = null;
  el.root.hidden = true;
  document.body.style.overflow = "";
  session.shots.forEach(forgetPicture);

  const stillReading = session.shots.length - session.results.handled;
  if (stillReading) setStatus(`Reading ${stillReading} more camera capture(s)…`);
  else showSummary();
  ui.cameraButton.focus();
}

function toggleAuto() {
  autoCapture = !autoCapture;
  el.autoButton.setAttribute("aria-checked", String(autoCapture));
  showHold(0);
  showPhase(hintPhase, true);
}

async function toggleTorch() {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] });
    torchOn = !torchOn;
    el.torchButton.setAttribute("aria-pressed", String(torchOn));
  } catch {}
}

export function initCamera() {
  if (!navigator.mediaDevices?.getUserMedia) return; // the button stays hidden
  ui.cameraButton.hidden = false;

  ui.cameraButton.addEventListener("click", open);
  el.doneButton.addEventListener("click", close);
  el.shutter.addEventListener("click", () => capture());
  el.autoButton.addEventListener("click", toggleAuto);
  el.torchButton.addEventListener("click", toggleTorch);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) close();
  });
}
