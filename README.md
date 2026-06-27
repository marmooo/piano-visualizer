# @marmooo/piano-visualizer

A piano MIDI visualizer powered by [Midy](https://github.com/marmooo/midy).

Canvas-based piano roll visualizer. Works on the main thread or inside a Web
Worker with `OffscreenCanvas`.

## Files

| File                   | Role                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `piano-visualizer.js`  | Library. Import `PianoVisualizer` and `extractNotesFromMidy`.                            |
| `visualizer-worker.js` | Worker adapter. Thin message handler that drives `PianoVisualizer` from the main thread. |
| `index.js`             | Application entry point. Wires Midy + MIDIPlayer to the worker.                          |

---

## Quick start — main thread

```html
<canvas id="piano-visualizer" width="800" height="600"></canvas>
```

```js
import { extractNotesFromMidy, PianoVisualizer } from "./piano-visualizer.js";
import { Midy } from "...";

const canvas = document.getElementById("piano-visuzlier");
const visualizer = new PianoVisualizer(canvas);

const res = await fetch("song.mid");
const midi = new Uint8Array(await res.arrayBuffer());
await midy.loadMIDI(midi);
visualizer.setNotes(extractNotesFromMidy(midy));

visualizer.start(); // standalone: counts from 0 with wall-clock time
// visualizer.stop();
```

---

## Syncing to an audio engine (Midy)

Pass a `getTime` callback so the visualizer reads seconds from the same clock as
audio playback.

```js
const audioContext = new AudioContext();
const midy = new Midy(audioContext);

midy.addEventListener("started", () => {
  visualizer.start(() => midy.currentTime());
});
midy.addEventListener("paused", () => visualizer.stop());
midy.addEventListener("stopped", () => visualizer.stop());
```

---

## Offscreen / Worker

Transfer canvases to a worker and use the bundled `visualizer-worker.js`.

```js
// main thread
const worker = new Worker("./visualizer-worker.js", { type: "module" });

const offMain = document.getElementById("mainCanvas")
  .transferControlToOffscreen();
const offKeyboard = document.getElementById("keyboardCanvas")
  .transferControlToOffscreen();
const offParticle = document.getElementById("particleCanvas")
  .transferControlToOffscreen();
const offLine = document.getElementById("lineCanvas")
  .transferControlToOffscreen();

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

// The worker fires { type: "ended" } when all notes and particles are done.
// Use it to stop the rAF loop so it doesn't burn CPU after playback finishes.
worker.addEventListener("message", (e) => {
  if (e.data.type === "ended") stopRaf();
});

// Load notes
const midi = new Uint8Array(await (await fetch("song.mid")).arrayBuffer());
worker.postMessage({ type: "call", method: "setNotes", args: [midi] });

// Drive the visualizer with a rAF loop on the main thread.
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

function startVisualizer() {
  stopRaf();
  worker.postMessage({ type: "stop" });
  startRaf();
}
function stopVisualizer() {
  stopRaf();
  worker.postMessage({ type: "stop" });
}
function pauseVisualizer() {
  stopRaf();
  worker.postMessage({ type: "tick", currentTime: midy.resumeTime });
}

midy.addEventListener("started", startVisualizer);
midy.addEventListener("resumed", startRaf);
midy.addEventListener("paused", pauseVisualizer);
midy.addEventListener("stopped", stopVisualizer);
```

### Worker message reference

| `type`   | Fields                                                         | Description                                                                                                         |
| -------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `"init"` | `mainCanvas`, `keyboardCanvas`, `particleCanvas`, `lineCanvas` | Initialize with four `OffscreenCanvas` objects. Must be transferred.                                                |
| `"tick"` | `currentTime`                                                  | Render one frame at the given playback time (seconds). Call from a `requestAnimationFrame` loop on the main thread. |
| `"stop"` | —                                                              | Stop rendering and reset state.                                                                                     |
| `"call"` | `method`, `args?`                                              | Call any public method on `PianoVisualizer`. `setNotes` accepts a `Uint8Array`.                                     |

Worker → main thread messages:

| `type`    | Description                                                                       |
| --------- | --------------------------------------------------------------------------------- |
| `"ended"` | All notes and particles have finished. Stop the rAF loop to avoid idle CPU usage. |

---

## Four-canvas layout

The app uses four layered canvases for independent z-ordering:

```html
<div id="canvasContainer" style="position:relative">
  <canvas id="mainCanvas" class="visualizerCanvas"></canvas>
  <canvas id="particleCanvas" class="visualizerCanvas"></canvas>
  <canvas id="keyboardCanvas" class="visualizerCanvas"></canvas>
  <canvas id="lineCanvas" class="visualizerCanvas"></canvas>
</div>
```

```js
const visualizer = new PianoVisualizer(
  {
    main: mainCanvas,
    keyboard: keyboardCanvas,
    particle: particleCanvas,
    line: lineCanvas,
  },
  options,
);
```

Single-canvas mode is also supported (layers are composited internally):

```js
const visualizer = new PianoVisualizer(canvas, options);
```

---

## API

### `extractNotesFromMidy(midy): NoteData[]`

Extracts notes from `midy.timeline` after `midy.loadMIDI()` has completed.

```ts
type NoteData = {
  noteNumber: number; // 0–127
  startTime: number; // seconds
  endTime: number; // seconds
  channel: number; // 0–15
  programNumber: number;
};
```

---

### `new PianoVisualizer(canvasOrLayers, options?)`

| Argument         | Type                                                                         |
| ---------------- | ---------------------------------------------------------------------------- |
| `canvasOrLayers` | `HTMLCanvasElement \| OffscreenCanvas \| { main, keyboard, particle, line }` |
| `options`        | `Partial<VisualizerOptions>` (see below)                                     |

---

### Methods

#### `setNotes(notesOrUint8Array)`

Load notes. Accepts either a parsed `NoteData[]` or a raw `Uint8Array` (MIDI
file), in which case `parseMidiToNotes` is called internally.

#### `start(getTime?)`

Begin the animation loop.

- `getTime: () => number` — returns current playback position in **seconds**. If
  omitted, wall-clock time from the moment `start()` is called is used.

#### `stop()`

Stop the animation loop and reset state.

#### `tick(currentTimeSec)`

Render one frame at the given time. Used in Worker mode instead of
`start()`/`stop()`. Fires `onEnded` when all notes and particles are done.

#### `resize(width, height)`

Update canvas dimensions. Call whenever the container size changes.

```js
const dpr = devicePixelRatio || 1;
new ResizeObserver(() => {
  vis.resize(canvas.clientWidth * dpr, canvas.clientHeight * dpr);
}).observe(canvas);
```

#### `updateOption(path, value)`

Update a single option by dot-path at runtime. Triggers any necessary re-draw
automatically.

```js
visualizer.updateOption("noteDirection", "up");
visualizer.updateOption("effects.glow", true);
visualizer.updateOption("effects.ignite", true);
visualizer.updateOption("noteOptions.noteSizeFactor", 0.9);
visualizer.updateOption("noteOptions.strokeOnly", true);
visualizer.updateOption("noteOptions.strokeDash", "dashed"); // "none" | "dotted" | "dashed"
visualizer.updateOption("keyboardOptions.keyAspectRatio", 5);
visualizer.updateOption("keyboardOptions.opacity", 0.8);
visualizer.updateOption("lineOptions.color", "#aabbff");
visualizer.updateOption("lineOptions.opacity", 0.7);
visualizer.updateOption("timeOffset", 0.05);
```

#### `renderKeyboard()`

Re-draw the static keyboard. Called automatically after `resize`, `setNotes`,
and relevant `updateOption` calls.

#### `onEnded` (property)

Optional callback fired by `tick()` when all notes and particles have finished
rendering.

```js
visualizer.onEnded = () => console.log("playback complete");
```

---

## Options

```js
{
  noteDirection: "down",        // "down" | "up" | "left" | "right"
  showPiano: "piano",           // "piano" | "line" | "none"
  timeOffset: 0,                // seconds added to playback time
  speedFactor: 1.0,
  scrollDistanceFactor: 1.0,

  channelColors: [ /* 16 hex strings */ ],
  programColors: [],            // per GM program number (overrides channelColors)

  effects: {
    glow: false,
    glowBlur: 20,
    particle: true,
    bounce: false,
    ignite: false,              // notes are dim until they hit the piano/line
    pianoPosition: 0.0,         // 0 = default edge, 1 = opposite edge
  },

  bounceOptions: {
    distance: 12,
    duration: 0.15,
    direction: "positive",      // "positive" | "negative"
  },

  lineOptions: {
    color: "#888",
    opacity: 1.0,
    lineWidth: 2,
    glowColor: "#88aaff",       // null = use lineOptions.color
    glowBlur: 20,
  },

  noteOptions: {
    drawMethod: "roundRect",    // "roundRect" | "fillRect"
    borderRadius: 0.2,
    noteSizeFactor: 0.7,
    defaultNoteColor: "#3399ff",
    fadeEffect: false,          // comet-tail fade toward the trailing edge
    strokeOnly: false,          // draw outline only (no fill)
    strokeWidth: 2,
    strokeDash: "none",         // "none" | "dotted" | "dashed"
  },

  keyboardOptions: {
    drawMethod: "roundRect",    // "roundRect" | "fillRect"
    keyAspectRatio: 4,          // key height / width ratio
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

  fogOptions: {
    color: "rgba(0,0,0,0.85)",
    size: 0.25,
    targets: [],                // "top"|"bottom"|"left"|"right"|"pianoNear"|"pianoFar"
  },

  particleOptions: {
    drawMethod: "roundRect",
  },
}
```

---

## Background image / video (app only)

`index.html` / `index.js` support an optional background image or video behind
the canvases. This is **not** part of `PianoVisualizer` — its canvases are
always transparent.

```html
<div id="canvasContainer">
  <img id="backgroundImage"   class="backgroundLayer" hidden>
  <video id="backgroundVideo" class="backgroundLayer" hidden loop muted autoplay playsinline></video>
  <canvas id="mainCanvas"     class="visualizerCanvas"></canvas>
  ...
</div>
```

The Global panel offers built-in presets and a custom file picker. Images and
videos are supported.
