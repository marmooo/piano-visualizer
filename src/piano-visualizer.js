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

const isBlackTable = [
  false,
  true,
  false,
  true,
  false,
  false,
  true,
  false,
  true,
  false,
  true,
  false,
];

// Precomputed white-key index for every MIDI note number (0-127),
// replacing an O(n) loop (counting white keys from note 21 up to noteNumber)
// that was run for every visible note every frame.
const whiteKeyIndexTable = (() => {
  const table = new Int16Array(128);
  let idx = 0;
  for (let n = 21; n <= 127; n++) {
    if (!isBlackTable[n % 12]) idx++;
    table[n] = idx - 1;
  }
  // For note numbers below 21, the original loop body never executes,
  // so idx stays 0 and the result is -1.
  for (let n = 0; n < 21; n++) table[n] = -1;
  return table;
})();

// ---- MIDI parsing (pure, no side effects) --------------------------------

// Extract NoteData[] from midy's already-parsed timeline.
// midy.timeline[i].startTime is in ticks; multiply by 1/midy.tempo to get seconds.
// This avoids re-parsing MIDI and guarantees exact time alignment with audio playback.
export function extractNotesFromMidy(midy) {
  const inverseTempo = 1 / midy.tempo;
  const timeline = midy.timeline;
  const notes = [];
  const programs = new Uint8Array(16);
  // track active noteOn by channel*128+noteNumber → note object
  const active = new Map();

  for (const event of timeline) {
    const sec = event.startTime * inverseTempo;
    switch (event.type) {
      case "programChange":
        if (event.channel != null) {
          programs[event.channel] = event.programNumber ?? 0;
        }
        break;
      case "noteOn": {
        if (event.velocity === 0) {
          // velocity=0 noteOn is treated as noteOff
          const key = event.channel * 128 + event.noteNumber;
          const note = active.get(key);
          if (note) {
            note.endTime = sec;
            active.delete(key);
          }
          break;
        }
        const key = event.channel * 128 + event.noteNumber;
        const note = {
          noteNumber: event.noteNumber,
          startTime: sec,
          endTime: sec,
          channel: event.channel,
          programNumber: programs[event.channel],
        };
        notes.push(note);
        active.set(key, note);
        break;
      }
      case "noteOff": {
        const key = event.channel * 128 + event.noteNumber;
        const note = active.get(key);
        if (note) {
          note.endTime = sec;
          active.delete(key);
        }
        break;
      }
    }
  }
  // notes are already in timeline order (sorted by startTime)
  return notes;
}

// ---- Default options -----------------------------------------------------

const defaultOptions = {
  noteOptions: {
    drawMethod: "roundRect",
    borderRadius: 0.2,
    noteSizeFactor: 0.7,
    defaultNoteColor: "#3399ff",
    fadeEffect: false,
    strokeOnly: false,
    strokeWidth: 2,
    strokeDash: "none", // "none" | "dotted" | "dashed"
  },
  keyboardOptions: {
    drawMethod: "roundRect",
    borderRadius: 0.1,
    keyAspectRatio: 4,
    opacity: 1.0,
    blackKeyWidthFactor: 0.6,
    blackKeyHeightFactor: 0.6,
    pressEffect: true,
    pressDepth: 4,
    pressScale: 0.95,
    pressShadowOffset: 2,
    gradientEffect: false,
    gradientColors: ["rgba(255,255,255,0.2)", "rgba(0,0,0,0.2)"],
  },
  particleOptions: {
    drawMethod: "roundRect",
    type: "burst", // "burst" | "spark" (future)
  },
  noteDirection: "down",
  showPiano: "piano", // "piano" | "line" | "none"
  timeOffset: 0, // seconds; positive = notes arrive earlier, negative = later
  speedFactor: 1.0,
  scrollDistanceFactor: 1.0,
  channelColors: defaultChannelColors,
  programColors: [],
  noteOpacity: 1.0,
  effects: {
    glow: false,
    glowBlur: 20,
    particle: true,
    bounce: false,
    ignite: false,
    pianoPosition: 0.0, // 0 = piano at default edge, 1 = piano at opposite edge
  },
  fogOptions: {
    color: "rgba(0,0,0,0.85)", // opaque color of the fog (typically matches bg)
    size: 0.25, // fraction of canvas width/height covered by fog (0–1)
    targets: [], // active fog zones: "top"|"bottom"|"left"|"right"|"piano"
  },
  lineOptions: {
    color: "#888",
    opacity: 1.0,
    lineWidth: 2,
    glowColor: "#88aaff", // glow color for the line; null = use lineOptions.color
    glowBlur: 20, // glow blur radius (0 = no glow)
  },
  bounceOptions: {
    distance: 12, // pixels to shift perpendicular to note direction
    duration: 0.15, // seconds for one bounce (sin arc: 0 → peak → 0)
    direction: "positive", // perpendicular shift: "positive" (right/down) | "negative" (left/up)
  },
};

function deepMerge(base, override) {
  const out = { ...base };
  for (const key of Object.keys(override ?? {})) {
    if (
      override[key] !== null &&
      typeof override[key] === "object" &&
      !Array.isArray(override[key]) &&
      typeof base[key] === "object"
    ) {
      out[key] = deepMerge(base[key], override[key]);
    } else {
      out[key] = override[key];
    }
  }
  return out;
}

// ---- PianoVisualizer -----------------------------------------------------
//
// Usage (main thread):
//   const vis = new PianoVisualizer(canvas, options);
//   vis.setNotes(parseMidiToNotes(uint8Array));
//   vis.start(() => audioContext.currentTime);   // getTime returns seconds
//   vis.stop();
//
// Usage (OffscreenCanvas / Worker):
//   const vis = new PianoVisualizer(offscreenCanvas, options);
//   vis.setNotes(notes);
//   vis.start(getTime);
//
// Layered rendering (three separate canvases):
//   const vis = new PianoVisualizer(
//     { main: canvas1, keyboard: canvas2, particle: canvas3 },
//     options,
//   );

export class PianoVisualizer {
  #fadeSpriteCache = new Map();
  #notes = null;
  #noteIndex = 0;
  #activeKeys = new Array(128).fill(null);
  #particles = [];
  #animId = null;
  #getTime = null;
  #lastT = -Infinity;
  #lastFrame = 0;
  #boundLoop = this.#loop.bind(this);
  #singleCanvas = false;
  #keyboardLayer = null;
  #particleLayer = null;
  #lineLayer = null;
  onEnded = null; // called when tick() detects all notes and particles are done

  constructor(canvasOrLayers, options = {}) {
    this.options = deepMerge(defaultOptions, options);
    this.#initContexts(canvasOrLayers);
    this.resize(this.mainCtx.canvas.width, this.mainCtx.canvas.height);
  }

  // Accept either a single canvas or { main, keyboard, particle }
  #initContexts(canvasOrLayers) {
    if (
      canvasOrLayers && typeof canvasOrLayers === "object" &&
      "main" in canvasOrLayers
    ) {
      this.mainCtx = canvasOrLayers.main.getContext("2d");
      this.keyboardCtx = canvasOrLayers.keyboard.getContext("2d");
      this.particleCtx = canvasOrLayers.particle.getContext("2d");
      this.lineCtx = canvasOrLayers.line.getContext("2d");
      this.#singleCanvas = false;
    } else {
      const canvas = canvasOrLayers;
      this.mainCtx = canvas.getContext("2d");
      // Create internal OffscreenCanvas layers for keyboard and particles
      const w = canvas.width || 300;
      const h = canvas.height || 150;
      this.#keyboardLayer = new OffscreenCanvas(w, h);
      this.#particleLayer = new OffscreenCanvas(w, h);
      this.#lineLayer = new OffscreenCanvas(w, h);
      this.keyboardCtx = this.#keyboardLayer.getContext("2d");
      this.particleCtx = this.#particleLayer.getContext("2d");
      this.lineCtx = this.#lineLayer.getContext("2d");
      this.#singleCanvas = true;
    }
  }

  // Public: load notes parsed externally, or pass a Uint8Array and let us parse
  setNotes(notesOrUint8Array) {
    if (notesOrUint8Array instanceof Uint8Array) {
      this.#notes = parseMidiToNotes(notesOrUint8Array);
    } else {
      // Assume NoteData[] already sorted by startTime
      this.#notes = notesOrUint8Array.slice().sort((a, b) =>
        a.startTime - b.startTime
      );
    }
    for (const note of this.#notes) {
      note.hit = false;
      note.hitTime = undefined;
      // Pre-compute values that depend only on the note + current options,
      // so #renderNotes doesn't recompute them every frame for every note.
      note.duration = note.endTime - note.startTime;
      note.color = this.#getNoteColor(note);
    }
    this.renderKeyboard();
  }

  // Recompute note.color for all notes — call after channelColors,
  // programColors, or noteOptions.defaultNoteColor change.
  #recolorNotes() {
    if (!this.#notes) return;
    for (const note of this.#notes) note.color = this.#getNoteColor(note);
  }

  // getTime: () => number  — returns current playback position in seconds
  // If omitted, falls back to wall-clock time from start (demo / standalone use)
  start(getTime) {
    if (!this.#notes) return;
    if (getTime) {
      this.#getTime = getTime;
    } else {
      const t0 = performance.now();
      this.#getTime = () => (performance.now() - t0) / 1000;
    }
    this.#noteIndex = 0;
    this.#particles.length = 0;
    this.#activeKeys.fill(null);
    this.#lastT = -Infinity;
    for (const note of this.#notes) {
      note.hit = false;
      note.hitTime = undefined;
    }
    this.#lastFrame = performance.now();
    this.#loop();
  }

  stop() {
    this.#noteIndex = 0;
    this.#lastT = -Infinity;
    if (this.#animId) {
      cancelAnimationFrame(this.#animId);
      this.#animId = null;
    }
  }

  // Worker / external-clock mode: call this every frame with the current
  // playback time in seconds (e.g. from audioContext.currentTime).
  // The caller is responsible for the animation loop; no rAF is used internally.
  tick(currentTimeSec) {
    currentTimeSec += this.options.timeOffset;
    if (this.#notes) {
      if (
        currentTimeSec < this.#lastT - 0.05 ||
        currentTimeSec > this.#lastT + 1.0
      ) {
        this.#seekTo(currentTimeSec);
      }
    }
    const now = performance.now();
    const dtMs = now - this.#lastFrame;
    this.#lastFrame = now;
    this.#lastT = currentTimeSec;
    this.#render(currentTimeSec, dtMs);
    if (
      this.#notes && this.#notes.length <= this.#noteIndex &&
      this.#particles.length === 0
    ) {
      this.onEnded?.();
    }
  }

  // Call whenever the canvas size changes
  resize(width, height) {
    this.width = width;
    this.height = height;
    for (
      const ctx of [
        this.mainCtx,
        this.keyboardCtx,
        this.particleCtx,
        this.lineCtx,
      ]
    ) {
      ctx.canvas.width = width;
      ctx.canvas.height = height;
    }
    if (this.#singleCanvas) {
      this.#keyboardLayer.width = width;
      this.#keyboardLayer.height = height;
      this.#particleLayer.width = width;
      this.#particleLayer.height = height;
      this.#lineLayer.width = width;
      this.#lineLayer.height = height;
    }
    this.#updateKeyLayout();
    this.#computeScrollSpeed();
    this.renderKeyboard();
  }

  // Dot-path option update: "effects.glow", "noteOptions.noteSizeFactor", etc.
  updateOption(path, value) {
    const keys = path.split(".");
    let target = this.options;
    for (let i = 0; i < keys.length - 1; i++) target = target[keys[i]];
    target[keys.at(-1)] = value;

    const hooks = {
      "showPiano": () => {
        // Clear keyboard layer so switching piano→line removes the keyboard drawing
        this.keyboardCtx.clearRect(
          0,
          0,
          this.keyboardCtx.canvas.width,
          this.keyboardCtx.canvas.height,
        );
        this.renderKeyboard();
      },
      "noteDirection": () => {
        this.resize(this.width, this.height);
      },
      "effects.pianoPosition": () => {
        this.resize(this.width, this.height);
      },
      "effects.glow": () => {
        this.renderKeyboard();
      },
      "speedFactor": () => this.#computeScrollSpeed(),
      "scrollDistanceFactor": () => this.#computeScrollSpeed(),
      "noteOptions.noteSizeFactor": () => this.renderKeyboard(),
      "keyboardOptions.keyAspectRatio": () =>
        this.resize(this.width, this.height),
      "keyboardOptions.opacity": () => this.renderKeyboard(),
      "keyboardOptions.gradientEffect": () => this.renderKeyboard(),
      "keyboardOptions.pressEffect": () => this.renderKeyboard(),
      "channelColors": () => this.#recolorNotes(),
      "programColors": () => this.#recolorNotes(),
      "noteOptions.defaultNoteColor": () => this.#recolorNotes(),
      "noteOpacity": () => {
        this.#recolorNotes();
        this.renderKeyboard();
      },
    };
    hooks[path]?.();
  }

  // Render the static keyboard (call after resize / option change)
  renderKeyboard() {
    const { noteDirection, showPiano, effects, keyboardOptions } = this.options;
    const ctx = this.keyboardCtx;
    ctx.shadowBlur = effects.glow ? effects.glowBlur : 0;
    if (!effects.glow) ctx.shadowColor = "transparent";
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    if (showPiano === "piano") {
      ctx.globalAlpha = keyboardOptions.opacity ?? 1;
      if (noteDirection === "down" || noteDirection === "up") {
        this.#drawVerticalKeyboard();
      } else {
        this.#drawHorizontalKeyboard();
      }
      if (this.options.keyboardOptions.gradientEffect) this.#applyGradient();
      ctx.globalAlpha = 1;
    }
    if (this.#singleCanvas) this.#compositeToMain();
  }

  // Render the line onto lineCtx. Cleared by #render before this call.
  #renderLineLayer() {
    this.#drawLine(this.lineCtx);
  }

  // Draw a thin line at the piano position (alternative to or on top of keyboard)
  #drawLine(ctx) {
    const { noteDirection, lineOptions } = this.options;
    const glowColor = lineOptions.glowColor ?? lineOptions.color;
    ctx.globalAlpha = lineOptions.opacity ?? 1;
    ctx.shadowColor = lineOptions.glowBlur > 0 ? glowColor : "transparent";
    ctx.shadowBlur = lineOptions.glowBlur;
    ctx.strokeStyle = lineOptions.color;
    ctx.lineWidth = lineOptions.lineWidth;
    ctx.beginPath();
    if (noteDirection === "down" || noteDirection === "up") {
      const y = noteDirection === "down"
        ? this.pianoY
        : this.pianoY + this.keyHeight;
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
    } else {
      const x = noteDirection === "right"
        ? this.pianoX
        : this.pianoX + this.keyWidth;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
    }
    ctx.stroke();
    // reset shadow so subsequent keyboard draws aren't affected
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.globalAlpha = 1;
  }

  // ---- Private: layout ---------------------------------------------------

  #updateKeyLayout() {
    const {
      noteDirection,
      keyboardOptions: { keyAspectRatio },
      effects: { pianoPosition },
    } = this.options;
    const pp = pianoPosition;
    this.whiteKeyCount = 52;
    if (noteDirection === "down" || noteDirection === "up") {
      this.keyWidth = this.width / this.whiteKeyCount;
      this.keyHeight = this.keyWidth * keyAspectRatio;
      this.pianoX = 0;
      // pp=0: default edge (down=bottom, up=top), pp=1: opposite edge
      if (noteDirection === "down") {
        this.pianoY = (1 - pp) * (this.height - this.keyHeight);
      } else {
        this.pianoY = pp * (this.height - this.keyHeight);
      }
    } else {
      this.keyHeight = this.height / this.whiteKeyCount;
      this.keyWidth = this.keyHeight * keyAspectRatio;
      this.pianoY = 0;
      if (noteDirection === "right") {
        this.pianoX = (1 - pp) * (this.width - this.keyWidth);
      } else {
        this.pianoX = pp * (this.width - this.keyWidth);
      }
    }
  }

  #computeScrollSpeed() {
    const { noteDirection, speedFactor, scrollDistanceFactor } = this.options;
    // Use the actual travel distance (canvas edge to piano) not the full canvas size.
    // This ensures a note appears at the canvas edge exactly 1/speedFactor seconds
    // before it hits the piano.
    // distance = travel distance from the spawn edge to the piano.
    // Must match #calcNotePosition and #getStartPosition logic.
    let distance;
    switch (noteDirection) {
      case "down":
        distance = this.pianoY > this.height / 2
          ? this.pianoY
          : this.height - this.pianoY;
        break;
      case "up":
        distance = this.pianoY < this.height / 2
          ? this.height - this.pianoY - this.keyHeight
          : this.pianoY + this.keyHeight;
        break;
      case "right":
        distance = this.pianoX > this.width / 2
          ? this.pianoX
          : this.width - this.pianoX;
        break;
      case "left":
        distance = this.pianoX < this.width / 2
          ? this.width - this.pianoX - this.keyWidth
          : this.pianoX + this.keyWidth;
        break;
      default:
        distance = this.height;
    }
    this.scrollSpeed = distance * speedFactor * scrollDistanceFactor;
  }

  // ---- Private: animation loop -------------------------------------------

  #loop() {
    if (!this.#animId && !this.#getTime) return; // stopped externally
    const now = performance.now();
    const dtMs = now - this.#lastFrame;
    if (dtMs < 1000 / 60) {
      this.#animId = requestAnimationFrame(this.#boundLoop);
      return;
    }
    const t = this.#getTime() + this.options.timeOffset;
    // Seek detection for start() mode (e.g. if getTime jumps)
    if (t < this.#lastT - 0.05 || (this.#lastT === -Infinity && t > 0)) {
      this.#seekTo(t);
    }
    if (this.#notes.length <= this.#noteIndex && this.#particles.length === 0) {
      this.stop();
      return;
    }
    this.#render(t, dtMs);
    this.#lastT = t;
    this.#lastFrame = now;
    this.#animId = requestAnimationFrame(this.#boundLoop);
  }

  // ---- Private: render ---------------------------------------------------

  #render(t, dtMs) {
    const { showPiano, effects } = this.options;
    this.#renderNotes(t);
    if (showPiano === "piano") {
      this.#updateActiveKeys(t);
      this.renderKeyboard();
    }
    // lineCtx is the topmost layer: clear it first, then draw line and/or fog
    this.lineCtx.clearRect(
      0,
      0,
      this.lineCtx.canvas.width,
      this.lineCtx.canvas.height,
    );
    if (showPiano === "line") {
      this.#renderLineLayer();
    }
    if (effects.particle) {
      this.#updateParticles(dtMs / 1000);
      this.#renderParticles();
    } else if (this.#particles.length) {
      this.particleCtx.clearRect(
        0,
        0,
        this.particleCtx.canvas.width,
        this.particleCtx.canvas.height,
      );
      this.#particles.length = 0;
    }
    if (this.options.fogOptions.targets.length) this.#renderFog();
    if (this.#singleCanvas) this.#compositeToMain();
  }

  // Composite internal layers onto main canvas (single-canvas mode)
  #compositeToMain() {
    const ctx = this.mainCtx;
    ctx.drawImage(this.#particleLayer, 0, 0);
    ctx.drawImage(this.#keyboardLayer, 0, 0);
    ctx.drawImage(this.#lineLayer, 0, 0);
  }

  // Fog effect: for each active target, draw a gradient overlay on lineCtx
  // (always the topmost canvas layer).
  // "top"/"bottom"/"left"/"right" = fixed edge fogs.
  // "piano" = fog at the piano edge, directed toward note-spawn side.
  // fogOptions.color should match the canvas background.
  // fogOptions.size controls how far each gradient extends (fraction of canvas).
  #renderFog() {
    const ctx = this.lineCtx;
    const { noteDirection } = this.options;
    const { color, size, targets } = this.options.fogOptions;
    if (!targets.length) return;
    const W = this.width, H = this.height;
    ctx.save();

    for (const target of targets) {
      let x0, y0, x1, y1, rectX, rectY, rectW, rectH;
      switch (target) {
        case "top": {
          const fogH = H * size;
          x0 = 0;
          y0 = 0;
          x1 = 0;
          y1 = fogH;
          rectX = 0;
          rectY = 0;
          rectW = W;
          rectH = fogH;
          break;
        }
        case "bottom": {
          const fogH = H * size;
          x0 = 0;
          y0 = H;
          x1 = 0;
          y1 = H - fogH;
          rectX = 0;
          rectY = H - fogH;
          rectW = W;
          rectH = fogH;
          break;
        }
        case "left": {
          const fogW = W * size;
          x0 = 0;
          y0 = 0;
          x1 = fogW;
          y1 = 0;
          rectX = 0;
          rectY = 0;
          rectW = fogW;
          rectH = H;
          break;
        }
        case "right": {
          const fogW = W * size;
          x0 = W;
          y0 = 0;
          x1 = W - fogW;
          y1 = 0;
          rectX = W - fogW;
          rectY = 0;
          rectW = fogW;
          rectH = H;
          break;
        }
        case "pianoNear":
        case "pianoFar": {
          const near = target === "pianoNear";
          // Both Near and Far originate from the same line coordinate (matching #drawLine),
          // and fan outward in opposite directions from it.
          // down:  line at pianoY       → Near goes up,    Far goes down
          // up:    line at pianoY+keyH  → Near goes down,  Far goes up
          // right: line at pianoX       → Near goes left,  Far goes right
          // left:  line at pianoX+keyW  → Near goes right, Far goes left
          switch (noteDirection) {
            case "down": {
              const fogH = H * size;
              const line = this.pianoY;
              if (near) {
                x0 = 0;
                y0 = line;
                x1 = 0;
                y1 = line - fogH;
                rectX = 0;
                rectY = line - fogH;
                rectW = W;
                rectH = fogH;
              } else {
                x0 = 0;
                y0 = line;
                x1 = 0;
                y1 = line + fogH;
                rectX = 0;
                rectY = line;
                rectW = W;
                rectH = fogH;
              }
              break;
            }
            case "up": {
              const fogH = H * size;
              const line = this.pianoY + this.keyHeight;
              if (near) {
                x0 = 0;
                y0 = line;
                x1 = 0;
                y1 = line + fogH;
                rectX = 0;
                rectY = line;
                rectW = W;
                rectH = fogH;
              } else {
                x0 = 0;
                y0 = line;
                x1 = 0;
                y1 = line - fogH;
                rectX = 0;
                rectY = line - fogH;
                rectW = W;
                rectH = fogH;
              }
              break;
            }
            case "right": {
              const fogW = W * size;
              const line = this.pianoX;
              if (near) {
                x0 = line;
                y0 = 0;
                x1 = line - fogW;
                y1 = 0;
                rectX = line - fogW;
                rectY = 0;
                rectW = fogW;
                rectH = H;
              } else {
                x0 = line;
                y0 = 0;
                x1 = line + fogW;
                y1 = 0;
                rectX = line;
                rectY = 0;
                rectW = fogW;
                rectH = H;
              }
              break;
            }
            case "left": {
              const fogW = W * size;
              const line = this.pianoX + this.keyWidth;
              if (near) {
                x0 = line;
                y0 = 0;
                x1 = line + fogW;
                y1 = 0;
                rectX = line;
                rectY = 0;
                rectW = fogW;
                rectH = H;
              } else {
                x0 = line;
                y0 = 0;
                x1 = line - fogW;
                y1 = 0;
                rectX = line - fogW;
                rectY = 0;
                rectW = fogW;
                rectH = H;
              }
              break;
            }
            default:
              continue;
          }
          break;
        }
        default:
          continue;
      }
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(rectX, rectY, rectW, rectH);
    }
    ctx.restore();
  }

  // Reposition noteIndex and reset transient state to match an arbitrary t.
  // Called when tick()/loop() detects a jump (seek, stop→play, first frame).
  #seekTo(t) {
    this.#particles.length = 0;
    this.#activeKeys.fill(null);
    for (const note of this.#notes) {
      note.hit = false;
      note.hitTime = undefined;
    }
    // Binary-search for the first note whose endTime > t
    const notes = this.#notes;
    let lo = 0, hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (notes[mid].endTime <= t) lo = mid + 1;
      else hi = mid;
    }
    this.#noteIndex = lo;
  }

  #updateActiveKeys(t) {
    const notes = this.#notes;
    if (!notes) return;
    for (let i = this.#noteIndex; i < notes.length; i++) {
      const note = notes[i];
      if (t < note.startTime) break;
      if (note.startTime <= t && t < note.endTime) {
        this.#activeKeys[note.noteNumber] = note.color;
      } else if (note.endTime <= t) {
        this.#activeKeys[note.noteNumber] = null;
        if (this.#noteIndex === i) this.#noteIndex++;
      }
    }
  }

  #renderNotes(t) {
    const ctx = this.mainCtx;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (!this.#notes) return;
    const { speedFactor, effects } = this.options;
    const { glow, glowBlur } = effects;
    ctx.shadowBlur = glow ? glowBlur : 0;
    if (!glow) ctx.shadowColor = "transparent";

    // maxLookahead in seconds = travel distance / scrollSpeed = 1/speedFactor
    const maxLookahead = 1 / speedFactor;
    const bounceDuration = effects.bounce
      ? this.options.bounceOptions.duration
      : 0;
    const notes = this.#notes;
    for (let i = this.#noteIndex; i < notes.length; i++) {
      const note = notes[i];
      if (t < note.startTime - maxLookahead) break;
      if (
        t > note.endTime + maxLookahead &&
        t > (note.hitTime ?? -Infinity) + bounceDuration
      ) continue;
      const startPos = this.#getStartPosition(note.noteNumber);
      let pos = this.#calcNotePosition(note, t, startPos);
      const color = note.color;
      this.#checkNoteHit(note, pos, color, t);
      if (effects.bounce && note.hitTime !== undefined) {
        const elapsed = t - note.hitTime;
        const { noteDirection } = this.options;
        const { distance, duration, direction } = this.options.bounceOptions;
        if (elapsed >= 0 && elapsed < duration) {
          const shift = Math.sin(Math.PI * elapsed / duration) * distance;
          pos = { ...pos };
          const isVertical = noteDirection === "down" || noteDirection === "up";
          const sign = direction === "positive" ? 1 : -1;
          // shift perpendicular to the note's travel direction
          if (isVertical) pos.x += shift * sign;
          else pos.y += shift * sign;
        }
      }
      if (glow) ctx.shadowColor = color;
      // progress: 0 = just spawned at canvas edge, 1 = reached piano
      let progress = 0;
      const { noteDirection } = this.options;
      switch (noteDirection) {
        case "down":
          progress = pos.y + pos.h >= 0
            ? Math.min(1, (pos.y + pos.h) / (this.pianoY || 1))
            : 0;
          break;
        case "up": {
          const target = this.pianoY + this.keyHeight;
          progress = Math.min(1, 1 - pos.y / (target || 1));
          break;
        }
        case "right":
          progress = pos.x + pos.w >= 0
            ? Math.min(1, (pos.x + pos.w) / (this.pianoX || 1))
            : 0;
          break;
        case "left": {
          const target = this.pianoX + this.keyWidth;
          progress = Math.min(1, 1 - pos.x / (target || 1));
          break;
        }
      }
      this.#drawNote(ctx, pos, color, note.hit);
    }
  }

  // ---- Private: note geometry --------------------------------------------

  #getWhiteKeyIndex(noteNumber) {
    return whiteKeyIndexTable[noteNumber];
  }

  #getStartPosition(noteNumber) {
    const isBlack = isBlackTable[noteNumber % 12];
    const whiteIndex = this.#getWhiteKeyIndex(noteNumber);
    const wKeyW = this.keyWidth;
    const wKeyH = this.keyHeight;
    // startPos is the canvas edge opposite the piano — notes spawn there and travel toward the piano.
    // When pianoPosition moves the piano, we derive startY/startX from the opposite side of the piano.
    switch (this.options.noteDirection) {
      case "down":
        return {
          x: isBlack ? whiteIndex * wKeyW + wKeyW * 0.7 : whiteIndex * wKeyW,
          y: this.pianoY > this.height / 2 ? 0 : this.height,
        };
      case "up":
        return {
          x: isBlack ? whiteIndex * wKeyW + wKeyW * 0.7 : whiteIndex * wKeyW,
          y: this.pianoY < this.height / 2 ? this.height : 0,
        };
      case "right":
        return {
          x: this.pianoX > this.width / 2 ? 0 : this.width,
          y: isBlack ? whiteIndex * wKeyH + wKeyH * 0.7 : whiteIndex * wKeyH,
        };
      case "left":
        return {
          x: this.pianoX < this.width / 2 ? this.width : 0,
          y: isBlack ? whiteIndex * wKeyH + wKeyH * 0.7 : whiteIndex * wKeyH,
        };
    }
  }

  #calcNotePosition(note, t, startPos) {
    const {
      noteDirection,
      noteOptions: { noteSizeFactor },
      keyboardOptions: { blackKeyWidthFactor, blackKeyHeightFactor },
    } = this.options;
    const isBlack = isBlackTable[note.noteNumber % 12];
    const isVertical = noteDirection === "down" || noteDirection === "up";
    // distance = travel distance from startPos to piano edge.
    // At t=startTime, offset=distance → note leading edge is exactly at the piano.
    let distance;
    switch (noteDirection) {
      case "down":
        distance = Math.abs(this.pianoY - startPos.y);
        break;
      case "up":
        distance = Math.abs(this.pianoY + this.keyHeight - startPos.y);
        break;
      case "right":
        distance = Math.abs(this.pianoX - startPos.x);
        break;
      case "left":
        distance = Math.abs(this.pianoX + this.keyWidth - startPos.x);
        break;
    }
    const offset = (t - note.startTime) * this.scrollSpeed + distance;

    if (isVertical) {
      const w = this.keyWidth * noteSizeFactor *
        (isBlack ? blackKeyWidthFactor : 1);
      const h = note.duration * this.scrollSpeed *
        (isBlack ? blackKeyHeightFactor : 1);
      const x = startPos.x +
        (this.keyWidth * (isBlack ? blackKeyWidthFactor : 1) - w) / 2;
      // "down": startPos.y=0, t=startTime → y+h = 0+pianoY-h+h = pianoY ✓
      // "up":   startPos.y=height, t=startTime → y = height-distance = pianoY+keyHeight ✓
      const y = noteDirection === "down"
        ? startPos.y + offset - h
        : startPos.y - offset;
      return { x, y, w, h };
    } else {
      const w = note.duration * this.scrollSpeed;
      const h = this.keyHeight * noteSizeFactor *
        (isBlack ? blackKeyHeightFactor : 1);
      // "right": startPos.x=0, t=startTime → x+w = 0+pianoX-w+w = pianoX ✓
      // "left":  startPos.x=width, t=startTime → x = width-distance = pianoX+keyWidth ✓
      const x = noteDirection === "right"
        ? startPos.x + offset - w
        : startPos.x - offset;
      const y = startPos.y +
        (this.keyHeight * (isBlack ? blackKeyHeightFactor : 1) - h) / 2;
      return { x, y, w, h };
    }
  }

  // ---- Private: note drawing ---------------------------------------------

  #getNoteColor(note) {
    const {
      channelColors,
      programColors,
      noteOptions: { defaultNoteColor },
      noteOpacity,
    } = this.options;
    let color;
    if (programColors.length) {
      color = programColors[note.programNumber % programColors.length];
    } else if (channelColors.length) {
      color = channelColors[note.channel % channelColors.length];
    } else color = defaultNoteColor;
    if (noteOpacity >= 1) return color;
    // Convert any hex color (#rrggbb or #rgb) to rgba with opacity applied
    const hex = color.trim();
    if (hex.startsWith("#")) {
      let r, g, b;
      if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
      } else {
        r = parseInt(hex.slice(1, 3), 16);
        g = parseInt(hex.slice(3, 5), 16);
        b = parseInt(hex.slice(5, 7), 16);
      }
      return `rgba(${r},${g},${b},${noteOpacity})`;
    }
    return color;
  }

  #drawNote(ctx, pos, color, hit = false) {
    const {
      fadeEffect,
      drawMethod,
      borderRadius,
      strokeOnly,
      strokeWidth,
      strokeDash,
    } = this.options.noteOptions;
    const { ignite } = this.options.effects;
    const isVertical = this.options.noteDirection === "down" ||
      this.options.noteDirection === "up";

    // ignite: dim the color until the note hits the piano/line
    const drawColor = (ignite && !hit) ? this.#dimColor(color) : color;

    if (fadeEffect && !strokeOnly) {
      // Fill with the solid color first, then clip to the note's shape and
      // stamp a pre-rendered transparent→color gradient sprite over it.
      // Avoids calling createLinearGradient() (a per-call allocation) for
      // every note on every frame.
      // The sprite is transparent at its start edge and opaque (color) at its
      // end edge. To get a comet trail (faded tail, solid leading edge), the
      // opaque end must align with the note's direction of travel:
      //   "down":  travels downward → leading edge = bottom → sprite as-is (top→bottom)
      //   "up":    travels upward   → leading edge = top    → sprite flipped vertically
      //   "right": travels rightward→ leading edge = right  → sprite as-is (left→right)
      //   "left":  travels leftward → leading edge = left   → sprite flipped horizontally
      const noteDirection = this.options.noteDirection;
      const flip = noteDirection === "up" || noteDirection === "left";
      const sprite = this.#getFadeSprite(drawColor, isVertical);
      ctx.save();
      this.#clipShape(ctx, pos, drawMethod, borderRadius);
      if (flip) {
        if (isVertical) {
          ctx.translate(pos.x, pos.y + pos.h);
          ctx.scale(1, -1);
          ctx.drawImage(sprite, 0, 0, pos.w, pos.h);
        } else {
          ctx.translate(pos.x + pos.w, pos.y);
          ctx.scale(-1, 1);
          ctx.drawImage(sprite, 0, 0, pos.w, pos.h);
        }
      } else {
        ctx.drawImage(sprite, pos.x, pos.y, pos.w, pos.h);
      }
      ctx.restore();
    } else if (strokeOnly) {
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = strokeWidth;
      const sw = strokeWidth;
      if (strokeDash === "dotted") ctx.setLineDash([sw, sw * 2]);
      else if (strokeDash === "dashed") ctx.setLineDash([sw * 4, sw * 2]);
      else ctx.setLineDash([]);
      this.#strokeShape(ctx, pos, drawMethod, borderRadius);
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = drawColor;
      this.#fillShape(ctx, pos, drawMethod, false, borderRadius);
    }
  }

  #checkNoteHit(note, pos, color, t) {
    if (note.hit) return;
    const { noteDirection, effects } = this.options;
    let hit = false;
    switch (noteDirection) {
      case "down":
        hit = (pos.y + pos.h) >= this.pianoY;
        break;
      case "up":
        hit = pos.y <= (this.pianoY + this.keyHeight);
        break;
      case "right":
        hit = (pos.x + pos.w) >= this.pianoX;
        break;
      case "left":
        hit = pos.x <= (this.pianoX + this.keyWidth);
        break;
    }
    if (!hit) return;
    note.hit = true;
    note.hitTime = t;
    if (!effects.particle) return;
    let sx = pos.x + pos.w / 2, sy = pos.y + pos.h / 2;
    if (noteDirection === "down") sy = this.pianoY + 4;
    if (noteDirection === "up") sy = this.pianoY + this.keyHeight - 4;
    if (noteDirection === "right") sx = this.pianoX - 4;
    if (noteDirection === "left") sx = this.pianoX + this.keyWidth + 4;
    this.#spawnParticles(sx, sy, color);
  }

  // ---- Private: keyboard -------------------------------------------------

  #drawVerticalKeyboard() {
    const { blackKeyWidthFactor, blackKeyHeightFactor } =
      this.options.keyboardOptions;
    let wi = 0;
    for (let i = 21; i <= 108; i++) {
      if (!isBlackTable[i % 12]) {
        this.#drawKey(
          i,
          wi * this.keyWidth,
          this.pianoY,
          this.keyWidth,
          this.keyHeight,
          "#fff",
        );
        wi++;
      }
    }
    wi = 0;
    for (let i = 21; i <= 108; i++) {
      if (!isBlackTable[i % 12]) {
        wi++;
        continue;
      }
      const x = (wi - 1) * this.keyWidth + this.keyWidth * 0.7;
      this.#drawKey(
        i,
        x,
        this.pianoY,
        this.keyWidth * blackKeyWidthFactor,
        this.keyHeight * blackKeyHeightFactor,
        "#000",
      );
    }
  }

  #drawHorizontalKeyboard() {
    const { blackKeyWidthFactor, blackKeyHeightFactor } =
      this.options.keyboardOptions;
    let wi = 0;
    for (let n = 21; n <= 108; n++) {
      if (!isBlackTable[n % 12]) {
        this.#drawKey(
          n,
          this.pianoX,
          wi * this.keyHeight,
          this.keyWidth,
          this.keyHeight,
          "#fff",
        );
        wi++;
      }
    }
    wi = 0;
    for (let n = 21; n <= 108; n++) {
      if (!isBlackTable[n % 12]) {
        wi++;
        continue;
      }
      const y = (wi - 1) * this.keyHeight + this.keyHeight * 0.7;
      this.#drawKey(
        n,
        this.pianoX,
        y,
        this.keyWidth * blackKeyWidthFactor,
        this.keyHeight * blackKeyHeightFactor,
        "#000",
      );
    }
  }

  #drawKey(noteNumber, x, y, w, h, defaultColor) {
    const ctx = this.keyboardCtx;
    const { keyboardOptions, effects, noteOpacity } = this.options;
    const activeColor = this.#activeKeys[noteNumber];
    const color = activeColor || defaultColor;
    let offsetY = 0, drawW = w, drawH = h;
    if (keyboardOptions.pressEffect && activeColor) {
      offsetY = keyboardOptions.pressDepth;
      drawW *= keyboardOptions.pressScale;
      drawH *= keyboardOptions.pressScale;
    }
    if (effects.glow) ctx.shadowColor = color;
    if (activeColor && noteOpacity < 1) {
      // Lerp between defaultColor and activeColor by noteOpacity,
      // producing a fully opaque result so white and black keys shift equally.
      const [dr, dg, db] = defaultColor === "#fff"
        ? [255, 255, 255]
        : [0, 0, 0];
      const rgba = activeColor.match(/rgba?\((\d+),(\d+),(\d+)/);
      const hex = !rgba && activeColor.match(/^#([0-9a-f]{6})$/i);
      let ar, ag, ab;
      if (rgba) {
        [ar, ag, ab] = [
          parseInt(rgba[1]),
          parseInt(rgba[2]),
          parseInt(rgba[3]),
        ];
      } else if (hex) {
        ar = parseInt(hex[1].slice(0, 2), 16);
        ag = parseInt(hex[1].slice(2, 4), 16);
        ab = parseInt(hex[1].slice(4, 6), 16);
      }
      let blended;
      if (ar !== undefined) {
        const r = Math.round(dr + (ar - dr) * noteOpacity);
        const g = Math.round(dg + (ag - dg) * noteOpacity);
        const b = Math.round(db + (ab - db) * noteOpacity);
        blended = `rgb(${r},${g},${b})`;
      } else {
        blended = activeColor;
      }
      ctx.fillStyle = blended;
      ctx.strokeStyle = "rgba(0,0,0,0.2)";
      this.#fillShape(
        ctx,
        { x, y: y + offsetY, w: drawW, h: drawH },
        keyboardOptions.drawMethod,
        true,
        keyboardOptions.borderRadius,
      );
    } else {
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(0,0,0,0.2)";
      this.#fillShape(
        ctx,
        { x, y: y + offsetY, w: drawW, h: drawH },
        keyboardOptions.drawMethod,
        true,
        keyboardOptions.borderRadius,
      );
    }
  }

  #applyGradient() {
    const { gradientColors } = this.options.keyboardOptions;
    const ctx = this.keyboardCtx;
    const grad = ctx.createLinearGradient(
      0,
      this.pianoY,
      0,
      this.pianoY + this.keyHeight,
    );
    for (let i = 0; i < gradientColors.length; i++) {
      grad.addColorStop(i, gradientColors[i]);
    }
    ctx.save();
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = grad;
    ctx.fillRect(0, this.pianoY, ctx.canvas.width, this.keyHeight);
    ctx.restore();
  }

  // ---- Private: particles ------------------------------------------------

  #spawnParticles(x, y, color) {
    const n = 14 + Math.floor(Math.random() * 8);
    for (let i = 0; i < n; i++) {
      const speed = 80 + Math.random() * 200;
      const ang = Math.random() * Math.PI * 2;
      this.#particles.push({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(ang) * speed * (0.4 + Math.random() * 1.2),
        vy: Math.sin(ang) * speed * (0.4 + Math.random() * 1.2),
        life: 0.6 + Math.random() * 0.9,
        maxLife: 0.6 + Math.random() * 0.9,
        color,
      });
    }
  }

  #updateParticles(dt) {
    const gravity = 400;
    let wi = 0;
    for (const p of this.#particles) {
      p.vy += gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life > 0) this.#particles[wi++] = p;
    }
    this.#particles.length = wi;
  }

  #renderParticles() {
    const ctx = this.particleCtx;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const { drawMethod } = this.options.particleOptions;
    // Setting ctx.fillStyle re-parses the color string even when unchanged,
    // so skip the assignment when consecutive particles share a color
    // (common since #spawnParticles emits a burst of same-colored particles).
    let lastColor = null;
    for (const p of this.#particles) {
      const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.globalAlpha = alpha;
      if (p.color !== lastColor) {
        ctx.fillStyle = p.color;
        lastColor = p.color;
      }
      const size = 4 + 5 * (1 - alpha);
      this.#fillShape(ctx, { x: p.x, y: p.y, w: size, h: size }, drawMethod);
    }
    ctx.globalAlpha = 1;
  }

  // ---- Private: shared shape drawing -------------------------------------

  // ignite: return a darkened version of color (about 25% brightness)
  #dimColor(color) {
    const hex = color.trim();
    if (hex.startsWith("#")) {
      let r, g, b = null;
      if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
      } else {
        r = parseInt(hex.slice(1, 3), 16);
        g = parseInt(hex.slice(3, 5), 16);
        b = parseInt(hex.slice(5, 7), 16);
      }
      r = Math.round(r * 0.5);
      g = Math.round(g * 0.5);
      b = Math.round(b * 0.5);
      return `rgb(${r},${g},${b})`;
    }
    const rgba = color.match(
      /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/,
    );
    if (rgba) {
      const r = Math.round(parseInt(rgba[1]) * 0.5);
      const g = Math.round(parseInt(rgba[2]) * 0.5);
      const b = Math.round(parseInt(rgba[3]) * 0.5);
      return rgba[4] !== undefined
        ? `rgba(${r},${g},${b},${rgba[4]})`
        : `rgb(${r},${g},${b})`;
    }
    return color;
  }

  // Pre-render a transparent→color gradient strip for fadeEffect, reused via
  // drawImage() instead of calling createLinearGradient() for every note
  // every frame (which allocates a new gradient object each time).
  #getFadeSprite(color, vertical) {
    const key = color + "|" + (vertical ? "v" : "h");
    let sprite = this.#fadeSpriteCache.get(key);
    if (sprite) return sprite;

    const size = 64;
    sprite = new OffscreenCanvas(vertical ? 1 : size, vertical ? size : 1);
    const sctx = sprite.getContext("2d");
    const grad = vertical
      ? sctx.createLinearGradient(0, 0, 0, size)
      : sctx.createLinearGradient(0, 0, size, 0);
    grad.addColorStop(0, "transparent");
    grad.addColorStop(1, color);
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, sprite.width, sprite.height);

    this.#fadeSpriteCache.set(key, sprite);
    return sprite;
  }

  #fillShape(ctx, { x, y, w, h }, method, stroke = false, borderRadius = 0.2) {
    switch (method) {
      case "fillRect":
        ctx.fillRect(x, y, w, h);
        if (stroke) ctx.strokeRect(x, y, w, h);
        break;
      case "roundRect":
      default: {
        const r = Math.min(w, h) * borderRadius;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.fill();
        if (stroke) ctx.stroke();
        break;
      }
    }
  }

  #clipShape(ctx, { x, y, w, h }, method, borderRadius = 0.2) {
    ctx.beginPath();
    if (method === "fillRect") {
      ctx.rect(x, y, w, h);
    } else {
      const r = Math.min(w, h) * borderRadius;
      ctx.roundRect(x, y, w, h, r);
    }
    ctx.clip();
  }

  #strokeShape(ctx, { x, y, w, h }, method, borderRadius = 0.2) {
    ctx.beginPath();
    if (method === "fillRect") {
      ctx.rect(x, y, w, h);
    } else {
      const r = Math.min(w, h) * borderRadius;
      ctx.roundRect(x, y, w, h, r);
    }
    ctx.stroke();
  }
}
