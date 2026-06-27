import { PianoVisualizer } from "./piano-visualizer.js";

let visualizer;

self.onmessage = (event) => {
  const {
    type,
    method,
    args,
    mainCanvas,
    keyboardCanvas,
    particleCanvas,
    lineCanvas,
  } = event.data;

  switch (type) {
    case "init":
      visualizer = new PianoVisualizer(
        {
          main: mainCanvas,
          keyboard: keyboardCanvas,
          particle: particleCanvas,
          line: lineCanvas,
        },
      );
      visualizer.onEnded = () => self.postMessage({ type: "ended" });
      break;

    // currentTime: audioContext.currentTime (seconds), already offset-adjusted by main thread
    case "tick":
      if (visualizer) visualizer.tick(event.data.currentTime);
      break;

    case "stop":
      if (visualizer) visualizer.stop();
      break;

    case "call":
      if (!visualizer || typeof visualizer[method] !== "function") break;
      visualizer[method](...(args ?? []));
      break;
  }
};
