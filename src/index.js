import { Midy } from "https://cdn.jsdelivr.net/gh/marmooo/midy@0.5.8/dist/midy.min.js";
import { MIDIPlayer } from "https://cdn.jsdelivr.net/npm/@marmooo/midi-player@0.0.7/+esm";
import { extractNotesFromMidy } from "./piano-visualizer.js";

class Draggable {
  static defaultOptions = {
    offset: 10,
  };
  static draggableElements = new Set();
  static highestZIndex = 1;
  element;
  options = {};
  isDragging = false;
  startX;
  startY;
  initialLeft;
  initialTop;

  constructor(element, options = {}) {
    this.element = element;
    this.options = { ...Draggable.defaultOptions, ...options };
    Draggable.draggableElements.add(this.element);
    this.init();
  }

  init() {
    this.element.style.position = "absolute";
    this.element.style.cursor = "grab";
    this.element.addEventListener("pointerdown", this.onPointerDown);
    this.element.addEventListener("pointermove", this.onPointerMove);
    this.element.addEventListener("pointerup", this.onPointerUp);
    if (!this.element.style.zIndex) {
      Draggable.highestZIndex += 1;
      this.element.style.zIndex = Draggable.highestZIndex;
    }
  }

  isInBorder(event) {
    const { offset, handle } = this.options;
    if (handle && handle.contains(event.target)) return true;
    const rect = this.element.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x <= offset) return true;
    if (y <= offset) return true;
    if (rect.width - x <= offset) return true;
    if (rect.height - y <= offset) return true;
    return false;
  }

  onPointerDown = (event) => {
    if (event.buttons > 0) {
      if (!this.isInBorder(event)) return;
      this.isDragging = true;
      this.startX = event.clientX;
      this.startY = event.clientY;
      this.initialLeft = this.element.offsetLeft;
      this.initialTop = this.element.offsetTop;
      this.element.setPointerCapture(event.pointerId);
      this.element.style.cursor = "grabbing";
      Draggable.highestZIndex += 1;
      this.element.style.zIndex = Draggable.highestZIndex;
    }
  };

  onPointerMove = (event) => {
    if (this.isDragging) {
      const deltaX = event.clientX - this.startX;
      const deltaY = event.clientY - this.startY;
      this.element.style.left = this.initialLeft + deltaX + "px";
      this.element.style.top = this.initialTop + deltaY + "px";
    }
  };

  onPointerUp = (event) => {
    if (this.isDragging) {
      this.isDragging = false;
      this.element.releasePointerCapture(event.pointerId);
      this.element.style.cursor = "grab";
    }
  };

  destroy() {
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    this.element.removeEventListener("pointermove", this.onPointerMove);
    this.element.removeEventListener("pointerup", this.onPointerUp);
    Draggable.draggableElements.delete(this.element);
    this.element.style = "";
  }
}

function toggleDarkMode() {
  const html = document.documentElement;
  const newTheme = html.getAttribute("data-bs-theme") === "dark"
    ? "light"
    : "dark";
  html.setAttribute("data-bs-theme", newTheme);
  localStorage.setItem("darkMode", newTheme);
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (Math.floor(max) - Math.ceil(min))) +
    Math.ceil(min);
}

function shuffle(array) {
  for (let i = array.length; 1 < i; i--) {
    const k = Math.floor(Math.random() * i);
    [array[k], array[i - 1]] = [array[i - 1], array[k]];
  }
  return array;
}

function getGlobalCSS() {
  const sheet = new CSSStyleSheet();
  let css = "";
  for (const s of document.styleSheets) {
    try {
      for (const r of s.cssRules) css += r.cssText;
    } catch { /* skip cross-origin sheets */ }
  }
  sheet.replaceSync(css);
  return sheet;
}

function setSampleEvents() {
  document.getElementById("samples").addEventListener("change", (event) => {
    const target = event.target;
    switch (target.name) {
      case "sampleMIDI":
        getSampleMIDI("https://midi-db.pages.dev/" + target.value);
        break;
      case "sampleSoundFont":
        midiPlayer.soundFontURL = "https://soundfonts.pages.dev/" +
          target.value;
        break;
    }
  });
}

async function getSampleMIDI(url) {
  const response = await fetch(url);
  const file = await response.blob();
  await loadMIDI(file);
}

async function getSampleMIDIList() {
  const root = document.getElementById("sampleMIDI");
  const homepageResponse = await fetch(
    "https://midi-db.pages.dev/collections.json",
  );
  const homepageList = await homepageResponse.json();
  const homepage = homepageList[getRandomInt(0, homepageList.length)];
  const { license: homepageLicense, maintainer: homepageMaintainer } = homepage;
  const license = homepageLicense.startsWith("http")
    ? `<a href="${homepageLicense}">custom</a>`
    : homepageLicense;
  const fileResponse = await fetch(
    `https://midi-db.pages.dev/json/${homepage.id}/${htmlLang}.json`,
  );
  const fileList = await fileResponse.json();
  const longFileList = fileList.filter((f) => !f.time.startsWith("0:"));
  shuffle(longFileList);

  let html = "";
  for (let i = 0; i < Math.min(15, longFileList.length); i++) {
    const file = longFileList[i];
    const maintainer = homepageMaintainer || file.maintainer;
    html += `
<div class="form-check">
  <label class="form-check-label">
    <input class="form-check-input" type="radio" name="sampleMIDI" value="${file.file}">
    ${file.title}, ${maintainer} (${license})
  </label>
</div>`;
  }
  root.innerHTML = html;
}

async function getSampleSoundFontList() {
  const root = document.getElementById("sampleSoundFont");
  const response = await fetch("https://soundfonts.pages.dev/list.json");
  const list = await response.json();
  let html = "";
  for (const soundFont of list) {
    const checked = soundFont.name === "GeneralUser_GS_v1.471" ? "checked" : "";
    const license = soundFont.license.startsWith("http")
      ? `<a href="${soundFont.license}">custom</a>`
      : soundFont.license;
    html += `
<div class="form-check">
  <label class="form-check-label">
    <input class="form-check-input" type="radio" name="sampleSoundFont" value="${soundFont.name}" ${checked}>
    ${soundFont.name} (${license})
  </label>
</div>`;
  }
  root.innerHTML = html;
}

function reloadNotes() {
  // Re-extract notes using the current midy.tempo.
  // Must be called after loadMIDI and after every tempoChange, because
  // extractNotesFromMidy converts ticks → seconds using midy.tempo at call time.
  const notes = extractNotesFromMidy(midy);
  worker.postMessage({ type: "call", method: "setNotes", args: [notes] });
}

function onTempoChanged() {
  reloadNotes();
  // Reset #lastT so the next tick triggers #seekTo at the correct position.
  worker.postMessage({ type: "stop" });
  // Use resumeTime (set synchronously by seekTo) rather than currentTime(),
  // which may be stale until startTime is updated in the playNotes loop.
  worker.postMessage({ type: "tick", currentTime: midy.resumeTime });
}

async function loadMIDI(file) {
  if (!file) return;
  await midiPlayer.handleStop();
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  // Load into midy first so midy.timeline and midy.tempo are populated
  await midiPlayer.loadMIDI(uint8Array);
  reloadNotes();
}

async function loadSoundFont(file) {
  if (!file) return;
  const arrayBuffer = await file.arrayBuffer();
  await midy.loadSoundFont(new Uint8Array(arrayBuffer));
}

async function loadFile(file) {
  const ext = file.name.split(".").at(-1).toLowerCase();
  if (ext === "mid" || ext === "midi") {
    await loadMIDI(file);
  } else if (ext === "sf2" || ext === "sf3") {
    await loadSoundFont(file);
  }
}

function setDragEvent() {
  const selectPanel = document.getElementById("selectPanel");
  let dragCounter = 0;
  selectPanel.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    selectPanel.classList.add("border", "border-secondary");
  });
  selectPanel.addEventListener("dragleave", (e) => {
    e.preventDefault();
    if (--dragCounter === 0) {
      selectPanel.classList.remove("border", "border-secondary");
    }
  });
  selectPanel.addEventListener("dragover", (e) => e.preventDefault());
  selectPanel.addEventListener("drop", (e) => {
    e.preventDefault();
    selectPanel.classList.remove("border", "border-secondary");
    loadFile(e.dataTransfer.files[0]);
  });
}

// ---- Canvas / Worker setup -----------------------------------------------

const dpr = globalThis.devicePixelRatio || 1;
const mainCanvas = document.getElementById("mainCanvas");
const keyboardCanvas = document.getElementById("keyboardCanvas");
const particleCanvas = document.getElementById("particleCanvas");
const lineCanvas = document.getElementById("lineCanvas");

const offMain = mainCanvas.transferControlToOffscreen();
const offKeyboard = keyboardCanvas.transferControlToOffscreen();
const offParticle = particleCanvas.transferControlToOffscreen();
const offLine = lineCanvas.transferControlToOffscreen();
const worker = new Worker("./visualizer-worker.js", { type: "module" });
worker.postMessage(
  {
    type: "init",
    mainCanvas: offMain,
    keyboardCanvas: offKeyboard,
    particleCanvas: offParticle,
    lineCanvas: offLine,
  },
  [offMain, offKeyboard, offParticle, offLine],
);
worker.addEventListener("message", (e) => {
  if (e.data.type === "ended") stopRaf();
});

function resize() {
  const width = mainCanvas.clientWidth * dpr;
  const height = mainCanvas.clientHeight * dpr;
  worker.postMessage({ type: "call", method: "resize", args: [width, height] });
}
resize();
globalThis.addEventListener("resize", resize);

// Make the configuration panel draggable. The "Configuration" heading acts
// as a drag handle in addition to the panel's own border.
const controls = document.getElementById("controls");
new Draggable(controls, { handle: controls.querySelector("h6") });

// ---- Background image / video ---------------------------------------------
//
// The background layer is a plain <img>/<video> element placed behind the
// canvases (see .backgroundLayer in index.html), shown centered, scaled to
// fit without cropping (object-fit: contain), and not tiled.
//
// API: after loadBackground() resolves, `backgroundImageEl` / `backgroundVideoEl`
// are exported on globalThis so users can freely restyle them, e.g.:
//
//   globalThis.backgroundImageEl.style.opacity = "0.5";
//   globalThis.backgroundImageEl.style.filter = "blur(4px)";
//   globalThis.backgroundVideoEl.style.objectFit = "cover";
//
const backgroundImageEl = document.getElementById("backgroundImage");
const backgroundVideoEl = document.getElementById("backgroundVideo");
globalThis.backgroundImageEl = backgroundImageEl;
globalThis.backgroundVideoEl = backgroundVideoEl;

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogv", "ogg", "mov"]);

function isVideoUrl(url) {
  const ext = url.split(".").pop().toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

function hideBackground() {
  backgroundImageEl.hidden = true;
  backgroundVideoEl.hidden = true;
  backgroundVideoEl.pause();
  backgroundVideoEl.removeAttribute("src");
  backgroundImageEl.removeAttribute("src");
}

function showImageBackground(src) {
  backgroundVideoEl.hidden = true;
  backgroundVideoEl.pause();
  backgroundVideoEl.removeAttribute("src");
  backgroundImageEl.src = src;
  backgroundImageEl.hidden = false;
}

function showVideoBackground(src) {
  backgroundImageEl.hidden = true;
  backgroundImageEl.removeAttribute("src");
  backgroundVideoEl.src = src;
  backgroundVideoEl.hidden = false;
  backgroundVideoEl.play().catch(() => {});
}

// Show a background from a URL (preset path or object URL). Whether it's an
// image or video is determined from the file extension.
function loadBackgroundUrl(url) {
  if (isVideoUrl(url)) {
    showVideoBackground(url);
  } else {
    showImageBackground(url);
  }
}

// Load a same-origin object URL from a user-selected file. The file's type
// is known directly from `file.type`, so this doesn't rely on the extension.
function loadBackgroundFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("video/")) {
    showVideoBackground(url);
  } else if (file.type.startsWith("image/")) {
    showImageBackground(url);
  }
}

document.getElementById("backgroundPreset").addEventListener(
  "change",
  (event) => {
    const value = event.currentTarget.value;
    const fileInput = document.getElementById("backgroundFile");
    if (value === "custom") {
      fileInput.click();
    } else {
      if (!value) {
        hideBackground();
      } else {
        loadBackgroundUrl(value);
      }
    }
  },
);

document.getElementById("backgroundFile").addEventListener(
  "change",
  (event) => {
    loadBackgroundFile(event.target.files[0]);
  },
);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseVisualizer();
  } else if (audioContext.state === "running") {
    resumeVisualizer();
  }
});

// ---- Option controls -----------------------------------------------------

// When not playing, send one tick at the current position so option changes
// are immediately visible on the canvas.
function nudge() {
  if (rafId === null) {
    worker.postMessage({ type: "tick", currentTime: midy.resumeTime ?? 0 });
  }
}

document.getElementById("showPiano").addEventListener("change", (event) => {
  const val = event.currentTarget.value;
  keyboardCanvas.style.display = val === "none" ? "none" : "block";
  worker.postMessage({
    type: "call",
    method: "updateOption",
    args: ["showPiano", val],
  });
  nudge();
});

for (
  const option of [
    "noteDirection",
    "speedFactor",
    "scrollDistanceFactor",
    "noteOptions.thickness",
    "keyboardOptions.keyAspectRatio",
    "effects.pianoPosition",
  ]
) {
  document.getElementById(option).addEventListener("change", (event) => {
    worker.postMessage({
      type: "call",
      method: "updateOption",
      args: [option, event.currentTarget.value],
    });
    nudge();
  });
}

for (
  const option of [
    "effects.glow",
    "effects.particle",
    "effects.bounce",
    "effects.ignite",
    "noteOptions.fadeEffect",
    "keyboardOptions.gradientEffect",
    "keyboardOptions.pressEffect",
  ]
) {
  document.getElementById(option).addEventListener("change", (event) => {
    worker.postMessage({
      type: "call",
      method: "updateOption",
      args: [option, event.currentTarget.checked],
    });
    nudge();
  });
}

// ---- Fog controls --------------------------------------------------------

function updateFogTargets() {
  const targets = ["top", "bottom", "left", "right", "pianoNear", "pianoFar"]
    .filter((t) => document.getElementById(`fog.${t}`).checked);
  worker.postMessage({
    type: "call",
    method: "updateOption",
    args: ["fogOptions.targets", targets],
  });
  nudge();
}
for (const t of ["top", "bottom", "left", "right", "pianoNear", "pianoFar"]) {
  document.getElementById(`fog.${t}`).addEventListener(
    "change",
    updateFogTargets,
  );
}

function updateFogColor() {
  const hex = document.getElementById("fogOptions.color").value;
  const opacity = parseFloat(
    document.getElementById("fogOptions.opacity").value,
  );
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  worker.postMessage({
    type: "call",
    method: "updateOption",
    args: ["fogOptions.color", `rgba(${r},${g},${b},${opacity})`],
  });
  nudge();
}
document.getElementById("fogOptions.color").addEventListener(
  "input",
  updateFogColor,
);
document.getElementById("fogOptions.opacity").addEventListener(
  "input",
  updateFogColor,
);

document.getElementById("fogOptions.size").addEventListener(
  "input",
  (event) => {
    worker.postMessage({
      type: "call",
      method: "updateOption",
      args: ["fogOptions.size", parseFloat(event.currentTarget.value)],
    });
    nudge();
  },
);

// ---- Color controls -------------------------------------------------------

const defaultChannelColors = [
  "#ff6666",
  "#ff9966",
  "#ffcc66",
  "#ccff66",
  "#66ff66",
  "#66ffcc",
  "#66ccff",
  "#6699ff",
  "#9966ff",
  "#cc66ff",
  "#ff66cc",
  "#ff6699",
  "#999999",
  "#99cc66",
  "#66ffff",
  "#ff99cc",
];

const channelColors = [...defaultChannelColors];

(function buildChannelColorPickers() {
  const container = document.getElementById("channelColorPickers");
  container.style.display = "grid";
  container.style.gridTemplateColumns = "repeat(4, 1fr)";
  container.style.gap = "4px";
  for (let ch = 0; ch < 16; ch++) {
    const label = document.createElement("label");
    label.className = "d-flex flex-column align-items-center small";
    const input = document.createElement("input");
    input.type = "color";
    input.id = `channelColor.${ch}`;
    input.value = defaultChannelColors[ch];
    input.className = "form-control form-control-color p-0";
    input.style.width = "32px";
    input.style.height = "32px";
    input.addEventListener("input", (event) => {
      channelColors[ch] = event.currentTarget.value;
      worker.postMessage({
        type: "call",
        method: "updateOption",
        args: ["channelColors", [...channelColors]],
      });
      nudge();
    });
    label.appendChild(input);
    label.appendChild(document.createTextNode(`ch${ch + 1}`));
    container.appendChild(label);
  }
})();

document.getElementById("noteOpacity").addEventListener("input", (event) => {
  worker.postMessage({
    type: "call",
    method: "updateOption",
    args: ["noteOpacity", parseFloat(event.currentTarget.value)],
  });
  nudge();
});

document.getElementById("keyboardOptions.opacity").addEventListener(
  "input",
  (event) => {
    worker.postMessage({
      type: "call",
      method: "updateOption",
      args: ["keyboardOptions.opacity", parseFloat(event.currentTarget.value)],
    });
    nudge();
  },
);

document.getElementById("lineOptions.color").addEventListener(
  "input",
  (event) => {
    worker.postMessage({
      type: "call",
      method: "updateOption",
      args: ["lineOptions.color", event.currentTarget.value],
    });
    nudge();
  },
);

document.getElementById("lineOptions.opacity").addEventListener(
  "input",
  (event) => {
    worker.postMessage({
      type: "call",
      method: "updateOption",
      args: ["lineOptions.opacity", parseFloat(event.currentTarget.value)],
    });
    nudge();
  },
);

document.getElementById("noteOptions.drawMethod").addEventListener(
  "change",
  (event) => {
    worker.postMessage({
      type: "call",
      method: "updateOption",
      args: ["noteOptions.drawMethod", event.currentTarget.value],
    });
    nudge();
  },
);

document.getElementById("noteOptions.strokeOnly").addEventListener(
  "change",
  (event) => {
    worker.postMessage({
      type: "call",
      method: "updateOption",
      args: ["noteOptions.strokeOnly", event.currentTarget.checked],
    });
    nudge();
  },
);

document.getElementById("noteOptions.strokeDash").addEventListener(
  "change",
  (event) => {
    worker.postMessage({
      type: "call",
      method: "updateOption",
      args: ["noteOptions.strokeDash", event.currentTarget.value],
    });
    nudge();
  },
);

document.getElementById("noteOptions.strokeWidth").addEventListener(
  "input",
  (event) => {
    worker.postMessage({
      type: "call",
      method: "updateOption",
      args: ["noteOptions.strokeWidth", parseFloat(event.currentTarget.value)],
    });
    nudge();
  },
);

const htmlLang = document.documentElement.lang;
await getSampleMIDIList();
await getSampleSoundFontList();
setSampleEvents();
setDragEvent();

// ---- Audio ---------------------------------------------------------------

const audioContext = new AudioContext();
if (audioContext.state === "running") await audioContext.suspend();
const midy = new Midy(audioContext);
midy.cacheMode = "chunk";
const midiPlayer = new MIDIPlayer(midy);
midiPlayer.defaultLayout();
midiPlayer.applyTheme(getGlobalCSS(), {
  "midi-player-btn": "btn bg-light-subtle p-1",
  "midi-player-text": "p-1",
  "midi-player-range": "form-range",
});
document.getElementById("midi-player").appendChild(midiPlayer.root);

// ---- Video recording (canvas composite + audio from midy.masterVolume) ----

let mediaRecorder = null;
let recordedChunks = [];
let recordRafId = null;
let recordStreamDest = null;
let isRecording = false;

const recordCanvas = document.createElement("canvas");
const recordCtx = recordCanvas.getContext("2d");

function getSupportedMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function getRecordSize() {
  const baseW = mainCanvas.clientWidth;
  const baseH = mainCanvas.clientHeight;
  const res = document.getElementById("recordResolution").value;

  if (res === "720" || res === "1080") {
    const targetH = Number(res);
    const scale = targetH / baseH;
    return {
      w: Math.round(baseW * scale),
      h: targetH,
    };
  }
  const scale = parseFloat(res) || 1;
  return {
    w: Math.round(baseW * scale),
    h: Math.round(baseH * scale),
  };
}

function drawRecordFrame() {
  const { w, h } = getRecordSize();
  if (recordCanvas.width !== w || recordCanvas.height !== h) {
    recordCanvas.width = w;
    recordCanvas.height = h;
  }
  recordCtx.fillStyle = "#000";
  recordCtx.fillRect(0, 0, w, h);

  if (
    !backgroundImageEl.hidden && backgroundImageEl.complete &&
    backgroundImageEl.naturalWidth
  ) {
    drawCover(recordCtx, backgroundImageEl, w, h);
  } else if (!backgroundVideoEl.hidden && backgroundVideoEl.readyState >= 2) {
    drawCover(recordCtx, backgroundVideoEl, w, h);
  }

  for (const c of [mainCanvas, particleCanvas, keyboardCanvas, lineCanvas]) {
    if (c.style.display === "none") continue;
    try {
      recordCtx.drawImage(c, 0, 0, w, h);
    } catch {
      /* ignore */
    }
  }
}

/** object-fit: cover */
function drawCover(ctx, media, dw, dh) {
  const sw = media.videoWidth || media.naturalWidth || media.width;
  const sh = media.videoHeight || media.naturalHeight || media.height;
  if (!sw || !sh) return;
  const scale = Math.max(dw / sw, dh / sh);
  const tw = sw * scale;
  const th = sh * scale;
  const ox = (dw - tw) / 2;
  const oy = (dh - th) / 2;
  ctx.drawImage(media, ox, oy, tw, th);
}

function startRecordLoop() {
  if (recordRafId !== null) return;
  function loop() {
    drawRecordFrame();
    recordRafId = requestAnimationFrame(loop);
  }
  recordRafId = requestAnimationFrame(loop);
}

function stopRecordLoop() {
  if (recordRafId !== null) {
    cancelAnimationFrame(recordRafId);
    recordRafId = null;
  }
}

async function startRecording() {
  if (isRecording) return;
  if (audioContext.state === "suspended") await audioContext.resume();

  const mimeType = getSupportedMimeType();
  if (!mimeType) {
    alert("MediaRecorder is not supported in this browser.");
    return;
  }

  const fps = parseInt(document.getElementById("recordFps").value, 10) || 30;
  const videoBitsPerSecond =
    parseInt(document.getElementById("recordQuality").value, 10) || 8_000_000;

  drawRecordFrame();

  const videoStream = recordCanvas.captureStream(fps);

  recordStreamDest = audioContext.createMediaStreamDestination();
  midy.masterVolume.connect(recordStreamDest);

  const stream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...recordStreamDest.stream.getAudioTracks(),
  ]);

  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond,
  });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `piano-visualizer-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
    cleanupRecording();
  };

  mediaRecorder.start(1000);
  isRecording = true;
  startRecordLoop();

  const btn = document.getElementById("recordBtn");
  btn.textContent = "⏹ Stop";
  btn.classList.replace("btn-danger", "btn-warning");
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
  // onstop → cleanupRecording
}

function cleanupRecording() {
  stopRecordLoop();
  if (recordStreamDest) {
    try {
      midy.masterVolume.disconnect(recordStreamDest);
    } catch { /* already disconnected */ }
    recordStreamDest = null;
  }
  if (mediaRecorder) {
    mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    mediaRecorder = null;
  }
  isRecording = false;
  recordedChunks = [];
  const btn = document.getElementById("recordBtn");
  btn.textContent = "⏺ Start";
  btn.classList.replace("btn-warning", "btn-danger");
}

document.getElementById("recordBtn").addEventListener("click", () => {
  if (isRecording) stopRecording();
  else startRecording();
});

// stop recording when playback ends
midy.addEventListener("stopped", () => {
  if (isRecording) stopRecording();
});
midy.addEventListener("ended", () => {
  if (isRecording) stopRecording();
});

// ---- Visualizer playback sync ------------------------------------------

// Sync visualizer timeOffset with startDelay so notes appear on screen
// before audio starts. timeOffset = -startDelay shifts the note display
// backward in time by the same amount as the audio start delay.
function applyStartDelay(delay) {
  midy.startDelay = delay;
  worker.postMessage({
    type: "call",
    method: "updateOption",
    args: ["timeOffset", -delay],
  });
}
applyStartDelay(2);

document.getElementById("startDelay").addEventListener("change", (event) => {
  applyStartDelay(parseFloat(event.currentTarget.value));
});

// Drive the visualizer with a rAF loop on the main thread.
// midy.currentTime() returns the current MIDI playback position in seconds,
// exactly matching the scheduled audio. Use it directly.
let rafId = null;

function startRaf() {
  if (rafId !== null) return;
  function loop() {
    worker.postMessage({ type: "tick", currentTime: midy.currentTime() });
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);
}

function stopRaf() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

// started: new playback from the beginning — reset visualizer state then start rAF
function startVisualizer() {
  stopRaf();
  worker.postMessage({ type: "stop" });
  startRaf();
}

// paused / visibilitychange hidden: freeze the rAF loop at the exact pause position.
// midy.currentTime() is reliable here because the "paused" event fires after
// audioContext.suspend() completes. Send one final tick with resumeTime so the
// canvas stops at the correct position, then kill the rAF loop.
function pauseVisualizer() {
  stopRaf();
  worker.postMessage({ type: "tick", currentTime: midy.resumeTime });
}

// resumed / visibilitychange visible: restart rAF; next tick resumes from current t
function resumeVisualizer() {
  startRaf();
}

// stopped: reset visualizer state entirely
function stopVisualizer() {
  stopRaf();
  worker.postMessage({ type: "stop" });
}

midy.addEventListener("started", startVisualizer);
midy.addEventListener("resumed", resumeVisualizer);
midy.addEventListener("paused", pauseVisualizer);
midy.addEventListener("stopped", stopVisualizer);
midy.addEventListener("tempoChanged", onTempoChanged);

// ---- UI events -----------------------------------------------------------

document.getElementById("toggleDarkMode").onclick = toggleDarkMode;
document.getElementById("selectFile").onclick = () =>
  document.getElementById("inputFile").click();
document.getElementById("inputFile").addEventListener(
  "change",
  (e) => loadFile(e.target.files[0]),
);

globalThis.addEventListener("paste", (e) => {
  const file = e.clipboardData.items[0]?.getAsFile();
  if (file) loadFile(file);
});
