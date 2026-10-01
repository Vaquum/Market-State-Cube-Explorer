// tools/benchmark/instrument.js (H9): the init script of the navigation benchmark. Test-only: the orchestrator injects it with
// addInitScript into every trial of every build identically (TESTPLAN.md 5.4, DD-T12); it is never part of the page.
//
// What it measures, and how each definition is chosen so the two builds are read the same way:
//   DRAW       a page requestAnimationFrame callback during which the `width` or `height` setter of HTMLCanvasElement ran on
//              #ol-canvas (DD-T28). The page draws only from a rAF callback and clears by assigning canvas.width in geometry(); it
//              never calls clearRect, so a clearRect test would record no draw at all. The setter wrapper only sets a flag, and only
//              INSIDE a callback (the rule of tests/browser/probe.js, AM-H7a-3): an assignment outside any callback (a resize handler,
//              a microtask after the callback returned) is not a draw; it is counted apart as `outsideSets`, as the probe does.
//   FRAME      the timestamps of a heartbeat rAF loop that runs only while a gesture is recorded, so main-thread blocking shows up
//              even in frames where the page drew nothing; intervals are differences of consecutive timestamps.
//   INPUT TO   for each wheel and pointermove event (the events that move the view; a pointerdown changes nothing until the first
//   PAINT      move), the end of the first DRAW callback that began after the event minus event.timeStamp. It excludes the
//              compositor and present latency (TESTPLAN.md B-L1). Events that no draw ever answers are counted as `unpainted`.
//   TIMER      the smallest positive step of performance.now() seen in a tight loop: the floor under every A/A floor.
// Nothing is selected: every draw callback, every frame and every event inside begin()..end() is kept, in order.
//
// window.__bench.begin()  start recording (and the heartbeat)
// window.__bench.end()    stop and return {draws, frameIntervals, frameCount, inputToPaint, unpainted, outsideSets}, times in milliseconds
// window.__bench.timerResolution()  -> number | null
(function () {
  "use strict";
  if (window.__bench) return;

  const nativeRaf = window.requestAnimationFrame.bind(window);
  const clock = () => performance.now();

  let recording = false;
  let depth = 0; // recorded page callbacks being run (more than 1 only when one is invoked from another): inside one, an assignment makes a draw
  let canvasHit = false; // a width/height assignment on #ol-canvas inside the current callback
  let outsideSets = 0; // width/height assignments on #ol-canvas while recording but outside every page callback
  let draws = [];
  let frames = [];
  let pending = []; // event timestamps waiting for the next draw
  let paint = [];

  for (const property of ["width", "height"]) {
    const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property);
    Object.defineProperty(HTMLCanvasElement.prototype, property, {
      configurable: true,
      enumerable: original.enumerable,
      get() {
        return original.get.call(this);
      },
      set(value) {
        if (this.id === "ol-canvas") {
          if (depth > 0) canvasHit = true;
          else if (recording) outsideSets++;
        }
        original.set.call(this, value);
      },
    });
  }

  // Every page callback is timed from just before it runs to just after it returns; the result is kept only for a draw. An exception
  // still reaches the page (try/finally rethrows), so the page behaves as it does without the wrapper.
  window.requestAnimationFrame = function (callback) {
    return nativeRaf(function (timestamp) {
      if (!recording) return callback(timestamp);
      canvasHit = false;
      depth++;
      const began = clock();
      try {
        return callback(timestamp);
      } finally {
        depth--;
        const ended = clock();
        if (canvasHit) {
          draws.push(ended - began);
          // The events that arrived before this callback began are answered by it; later ones wait for the next draw.
          const waiting = [];
          for (const at of pending) {
            if (at <= began) paint.push(ended - at);
            else waiting.push(at);
          }
          pending = waiting;
        }
        canvasHit = false;
      }
    });
  };

  for (const type of ["wheel", "pointermove"]) {
    window.addEventListener(type, (event) => { if (recording) pending.push(event.timeStamp); }, { capture: true, passive: true });
  }

  const beat = (timestamp) => {
    if (!recording) return;
    frames.push(timestamp);
    nativeRaf(beat);
  };

  const bench = {
    version: 1,
    begin() {
      draws = [];
      frames = [];
      pending = [];
      paint = [];
      canvasHit = false;
      outsideSets = 0;
      recording = true;
      nativeRaf(beat);
    },
    end() {
      recording = false;
      const frameIntervals = [];
      for (let i = 1; i < frames.length; i++) frameIntervals.push(frames[i] - frames[i - 1]);
      return { draws, frameIntervals, frameCount: frames.length, inputToPaint: paint, unpainted: pending.length, outsideSets };
    },
    timerResolution() {
      let best = Infinity;
      let last = clock();
      let steps = 0;
      const stop = last + 200;
      while (steps < 100) {
        const now = clock();
        if (now >= stop) break; // a coarse or frozen clock gives up after 200 ms
        if (now > last) {
          best = Math.min(best, now - last);
          last = now;
          steps++;
        }
      }
      return best === Infinity ? null : best;
    },
  };
  Object.defineProperty(window, "__bench", { value: Object.freeze(bench), configurable: false });
})();
