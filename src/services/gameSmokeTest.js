import vm from "node:vm";

// Runtime smoke test for generated games.
//
// findSyntaxError only proves the module PARSES — code like
// `board[row][col] = piece` (where board[row] is undefined) parses fine and
// then throws "Cannot set properties of undefined" the instant it runs, which
// the player sees as "Generated build failed to run…". This executes the module
// in a permissive browser-like sandbox so those top-level (and first-frame)
// runtime crashes are caught before the game is saved as "ready".

const noop = () => {};

// Strips the imports/exports the sandbox also strips, so the smoke test runs
// the exact shape the browser executes.
function stripForRun(code) {
  return String(code || "")
    .replace(/^\s*import\s+["'][^"']*["'];?\s*$/gm, "")
    .replace(/^\s*import\s+[^;\n]*from\s+["'][^"']*["'];?\s*$/gm, "")
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, "")
    .replace(/^(\s*)export\s+(const|let|var|function|class|async)/gm, "$1$2");
}

// A function that swallows any call/get/new without throwing — used for unknown
// browser globals so a valid game never trips a false "X is not defined".
function makeChainable() {
  const fn = function () {
    return makeChainable();
  };
  return new Proxy(fn, {
    get: (_t, prop) => (prop === Symbol.toPrimitive ? () => 0 : makeChainable()),
    apply: () => makeChainable(),
    construct: () => ({}),
    set: () => true,
  });
}

function makeDom(register = noop) {
  const styleProxy = new Proxy({}, { get: () => "", set: () => true });
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "measureText") return () => ({ width: 8 });
        if (prop === "getImageData")
          return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
        if (typeof prop === "string" && /^create(Linear|Radial|Conic)Gradient$/.test(prop))
          return () => ({ addColorStop: noop });
        if (prop === "createPattern") return () => ({});
        if (prop === "canvas") return el;
        return noop; // every other ctx method is a no-op
      },
      set: () => true,
    },
  );
  const el = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "getContext") return () => ctx;
        if (prop === "style") return styleProxy;
        if (prop === "classList")
          return { add: noop, remove: noop, toggle: noop, contains: () => false };
        if (prop === "dataset") return {};
        if (prop === "getBoundingClientRect")
          return () => ({ left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540, x: 0, y: 0 });
        if (prop === "querySelector" || prop === "closest") return () => el;
        if (prop === "querySelectorAll") return () => [el];
        if (prop === "addEventListener") return (type, handler) => register(type, handler);
        if (
          prop === "removeEventListener" ||
          prop === "appendChild" ||
          prop === "removeChild" ||
          prop === "setAttribute" ||
          prop === "removeAttribute" ||
          prop === "focus" ||
          prop === "blur" ||
          prop === "play" ||
          prop === "pause" ||
          prop === "load" ||
          prop === "requestPointerLock" ||
          prop === "scrollIntoView"
        )
          return noop;
        if (prop === "children" || prop === "childNodes") return [];
        if (["width", "height", "clientWidth", "clientHeight", "offsetWidth", "offsetHeight"].includes(prop))
          return 960;
        if (prop === "textContent" || prop === "innerHTML" || prop === "value" || prop === "id") return "";
        return undefined;
      },
      set: () => true,
    },
  );
  const documentMock = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "querySelector" || prop === "getElementById" || prop === "createElement")
          return () => el;
        if (
          prop === "querySelectorAll" ||
          prop === "getElementsByClassName" ||
          prop === "getElementsByTagName"
        )
          return () => [el];
        if (prop === "createElementNS") return () => el;
        if (prop === "addEventListener") return (type, handler) => register(type, handler);
        if (prop === "removeEventListener") return noop;
        if (prop === "body" || prop === "documentElement" || prop === "head") return el;
        return undefined;
      },
      set: () => true,
    },
  );
  return { el, ctx, documentMock };
}

/**
 * Executes the generated module and a few animation frames in a mocked browser
 * environment. Returns { ok: true } when it runs without throwing, or
 * { ok: false, error } with the runtime error message when it crashes.
 */
export function runtimeSmokeTest(code, gamePackage) {
  // Capture every event listener the game registers (on the canvas, document,
  // or window) so we can fire real input at it below. Without this, input
  // handlers never run and input-path crashes go undetected.
  const listeners = new Map();
  const register = (type, handler) => {
    if (typeof type !== "string" || typeof handler !== "function") return;
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
  };

  const { el, documentMock } = makeDom(register);
  let rafQueue = [];
  let timerQueue = [];

  const base = {
    gamePackage: gamePackage ?? {},
    document: documentMock,
    console: { log: noop, warn: noop, error: noop, info: noop, debug: noop },
    requestAnimationFrame: (cb) => {
      if (typeof cb === "function") rafQueue.push(cb);
      return rafQueue.length;
    },
    cancelAnimationFrame: noop,
    setTimeout: (cb) => {
      if (typeof cb === "function") timerQueue.push(cb);
      return timerQueue.length;
    },
    clearTimeout: noop,
    setInterval: (cb) => {
      if (typeof cb === "function") timerQueue.push(cb);
      return timerQueue.length;
    },
    clearInterval: noop,
    addEventListener: (type, handler) => register(type, handler),
    removeEventListener: noop,
    Image: function () {
      return el;
    },
    Audio: function () {
      return el;
    },
    devicePixelRatio: 1,
    innerWidth: 960,
    innerHeight: 540,
    performance: { now: () => Date.now() },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop, clear: noop },
    navigator: { userAgent: "node", maxTouchPoints: 0, language: "en" },
    location: { href: "", origin: "", reload: noop, replace: noop },
    alert: noop,
    postMessage: noop,
    parent: { postMessage: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    // Native intrinsics the code legitimately needs to behave normally.
    Math,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Symbol,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    RegExp,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    Float32Array,
    Float64Array,
    Uint8Array,
    Uint8ClampedArray,
    Int8Array,
    Int16Array,
    Int32Array,
    Uint16Array,
    Uint32Array,
    ArrayBuffer,
  };

  // Sandbox global: known keys are the stubs above; any unknown global read
  // returns a harmless chainable so exotic browser APIs never false-positive.
  const sandbox = new Proxy(base, {
    has: () => true, // make every bare identifier resolve on the global (no ReferenceError)
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === Symbol.unscopables) return undefined;
      return makeChainable();
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  base.window = sandbox;
  base.globalThis = sandbox;
  base.self = sandbox;

  const context = vm.createContext(sandbox);
  const source = stripForRun(code);

  // "load" crashes happen as the module first executes — these are real and
  // input-independent (e.g. board[r][c] before board[r] exists). "frame"
  // crashes happen while blindly stepping animation frames with no real input
  // and can be false positives for input-driven games, so callers may treat
  // them as soft.
  try {
    new vm.Script(source, { filename: "generated-game.js" }).runInContext(context, { timeout: 2500 });
  } catch (error) {
    return { ok: false, error: errorMessage(error), phase: "load" };
  }

  // Drive a few frames so crashes inside update/render surface too.
  const stepFrames = (rounds, startRound = 0) => {
    for (let round = startRound; round < startRound + rounds; round += 1) {
      const callbacks = rafQueue.concat(timerQueue).slice(0, 40);
      rafQueue = [];
      timerQueue = [];
      for (const cb of callbacks) cb(round * 16);
    }
  };

  try {
    stepFrames(3);
  } catch (error) {
    return { ok: false, error: errorMessage(error), phase: "frame" };
  }

  // Fire real input at the handlers the game registered, then step more frames.
  // This is what catches "character does not work": handlers that throw on a key
  // press / tap / swipe, or that index into something the input path leaves
  // undefined. With no input driven, those bugs ship silently.
  try {
    dispatch(listeners, el);
    stepFrames(3, 3);
  } catch (error) {
    return { ok: false, error: errorMessage(error), phase: "input" };
  }

  return { ok: true, phase: "ok" };
}

// Builds a browser-like event with the fields games commonly read, so a handler
// that destructures e.key / e.clientX / e.touches[0] runs the same path it would
// for a real player.
function makeEvent(type, props = {}) {
  return {
    type,
    preventDefault: noop,
    stopPropagation: noop,
    stopImmediatePropagation: noop,
    repeat: false,
    button: 0,
    buttons: 1,
    clientX: 480,
    clientY: 270,
    pageX: 480,
    pageY: 270,
    offsetX: 480,
    offsetY: 270,
    screenX: 480,
    screenY: 270,
    movementX: 6,
    movementY: 0,
    deltaX: 0,
    deltaY: 0,
    pointerId: 1,
    pointerType: "touch",
    touches: [{ clientX: 480, clientY: 270, pageX: 480, pageY: 270, identifier: 0 }],
    changedTouches: [{ clientX: 480, clientY: 270, pageX: 480, pageY: 270, identifier: 0 }],
    ...props
  };
}

// Fires a representative spread of keyboard, pointer, and touch input at the
// registered handlers. A single handler throwing surfaces as an "input"-phase
// crash, which callers treat as a real, hard break.
function dispatch(listeners, el) {
  const keys = [
    { key: "ArrowUp", code: "ArrowUp", keyCode: 38, which: 38 },
    { key: "ArrowDown", code: "ArrowDown", keyCode: 40, which: 40 },
    { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, which: 37 },
    { key: "ArrowRight", code: "ArrowRight", keyCode: 39, which: 39 },
    { key: " ", code: "Space", keyCode: 32, which: 32 },
    { key: "r", code: "KeyR", keyCode: 82, which: 82 }
  ];
  const events = [];
  for (const k of keys) events.push(makeEvent("keydown", k));
  for (const k of keys) events.push(makeEvent("keyup", k));
  for (const type of [
    "pointerdown",
    "mousedown",
    "touchstart",
    "pointermove",
    "mousemove",
    "touchmove",
    "pointerup",
    "mouseup",
    "click"
  ]) {
    events.push(makeEvent(type, { target: el, currentTarget: el }));
  }
  events.push(makeEvent("touchend", { target: el, currentTarget: el, touches: [] }));

  for (const event of events) {
    const handlers = listeners.get(event.type);
    if (!handlers) continue;
    for (const handler of handlers.slice(0, 20)) handler(event);
  }
}

function errorMessage(error) {
  if (!error) return "Unknown runtime error";
  return String(error.message || error).slice(0, 300);
}
