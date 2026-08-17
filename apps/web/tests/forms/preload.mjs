// Loaded via `node --import` (see run.mjs), NOT bundled with the test files.
//
// This has to run, and finish, BEFORE react-dom is evaluated at all — not
// merely before the test bodies run. react-dom's event system computes
// `isInputEventSupported` (and `canUseDOM`) as a MODULE-LEVEL constant the
// moment react-dom/client is first imported, by feature-detecting against
// `document`. If `document` is not there yet, React permanently believes it
// is running in IE and wires up the `attachEvent`-based input polyfill
// instead of native "input"/"change" events — which then throws
// ("activeElement$1.attachEvent is not a function", jsdom has no such thing)
// the moment any autofocused field receives real focus.
//
// Why this can't just be "the first import" inside the bundled test file, the
// way `dom-env.ts` originally tried it: `run.mjs` bundles each `*.test.tsx`
// with esbuild and `packages: "external"`, so react/react-dom/testing-library
// stay real `import` statements of the ONE resulting module. Per the ES
// module spec, ALL of a module's static imports — wherever they're written —
// are resolved and evaluated before ANY of that module's own top-level code
// runs. Splitting the setup into its own bundled file doesn't change that:
// it is still just more of "this module's own top-level code," still queued
// behind every external import, including react-dom.
//
// `--import` sidesteps the whole problem instead of routing around it: a
// preloaded module is its own separate module graph that Node fully
// evaluates before the main entry point's graph is even touched, so this
// file's jsdom setup is guaranteed to finish before react-dom's module is
// ever reached.
import { JSDOM, VirtualConsole } from "jsdom";

const virtualConsole = new VirtualConsole();
// Forward real console usage from rendered code (there is none expected here,
// but keep parity with a real browser); jsdom's own "not implemented" noise
// is handled separately below, not dumped to the terminal on every test.
virtualConsole.forwardTo(console, { omitJSDOMErrors: true });

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:3000/",
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;

// `defineProperty`, not `=`: Node 21+ ships its own read-only `navigator`
// global (User-Agent Client Hints) as an accessor, and a plain assignment
// throws past it.
function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

setGlobal("window", window);
setGlobal("document", window.document);
setGlobal("navigator", window.navigator);
setGlobal("HTMLElement", window.HTMLElement);
setGlobal("Element", window.Element);
setGlobal("Node", window.Node);
setGlobal("Event", window.Event);
setGlobal("MouseEvent", window.MouseEvent);
setGlobal("KeyboardEvent", window.KeyboardEvent);
setGlobal("SVGElement", window.SVGElement);
// Node's own global FormData (undici) does not recognize a jsdom
// HTMLFormElement as an HTMLFormElement — `new FormData(form)` throws a
// webidl conversion error. jsdom ships a FormData that understands its own
// form elements; `contact-form.tsx` and `welcome-form.tsx` both build their
// submit payload with `new FormData(event.currentTarget)`, so this has to be
// jsdom's version for either form's submit handler to run at all.
setGlobal("FormData", window.FormData);
setGlobal("getComputedStyle", window.getComputedStyle.bind(window));
// jsdom implements no layout at all, so it ships no ResizeObserver — the
// Studio canvas (StudioPanelSurface) uses one to size the circuit diagram.
// A no-op is honest here: this suite never asserts on measured pixel size,
// only on component state, and a real implementation would have nothing to
// measure in a DOM with no layout engine anyway.
setGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
// jsdom runs no layout engine, so every element reports clientWidth/
// clientHeight as 0. CircuitDiagram (Studio's canvas) uses those to decide
// its VISIBLE window of qubits/steps on mount (circuit-diagram.tsx's
// `syncViewport`) — a real 0×0 viewport clips the diagram down to
// nothing, well below a component starting default of 1024×640, so
// clicking a step that is genuinely on the canvas finds no element at all.
// A generous fixed size is honest for what this suite tests (component
// state and submission, never measured pixel layout).
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, value: 2000 });
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable: true, value: 800 });
setGlobal("requestAnimationFrame", (callback) => setTimeout(() => callback(Date.now()), 0));
setGlobal("cancelAnimationFrame", (id) => clearTimeout(id));

// React 19 checks for this to decide which environment it is in.
setGlobal("IS_REACT_ACT_ENVIRONMENT", true);

// Exposed for dom-env.ts's navigation-attempt detector — see the comment on
// `waitForNavigationAttempt` there for why `window.location` itself has to be
// observed this way instead of being stubbed directly.
globalThis.__formTestVirtualConsole = virtualConsole;
