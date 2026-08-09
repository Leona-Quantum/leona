"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { IDENTITY, formatViewport, transformOf, zoomAbout, type Viewport } from "../lib/repository/canvas-viewport";
import type { PublicLocale } from "../lib/public-locale";

/** Pixels the pointer has to travel before a press becomes a pan rather than a
 * click. Small enough that a deliberate drag registers almost immediately,
 * large enough to absorb the few pixels of jitter a real mouse or a finger
 * produces between pressing down and lifting on the same spot — the gap a
 * "0px" threshold would misread as a drag and use to eat every click. */
const DRAG_THRESHOLD_PX = 4;

/** Viewport pixels per keyboard pan step. Not measured — chosen so a single
 * press moves a visibly deliberate amount (about a finger's width of the
 * strand-canvas hit targets, `.mj-process-hit-line`'s 24px, doubled) without
 * needing more than a few presses to cross the canvas. */
const KEYBOARD_PAN_STEP_PX = 40;

/** Zoom multiplier per `+`/`-` keypress. 20%, matching the step size most
 * browsers' own Ctrl/Cmd+`+`/`-` page-zoom uses, so a keyboard user already
 * has an intuition for how far one press goes. */
const KEYBOARD_ZOOM_FACTOR = 1.2;

/** `deltaMode` 1 ("line") events report a small integer count of lines rather
 * than pixels; 16 is a standard single-line height used to bring that count
 * into the same rough unit as `deltaMode` 0 ("pixel") before both are fed to
 * the same exponential curve. `deltaMode` 2 ("page") is normalized against the
 * canvas's own rect instead, immediately below, since "a page" has no fixed
 * pixel size. Real wheel and trackpad hardware almost always reports mode 0;
 * this exists so the other two do not produce a huge, jarring zoom jump
 * instead of simply being rare. */
const WHEEL_LINE_HEIGHT_PX = 16;

/**
 * Wheel-to-zoom speed. Not derived from a measurement — there is nothing in
 * this codebase to derive it from — so treat it as a feel constant subject to
 * an owner taste-check, the same way the "lab" palette in tokens.css is
 * flagged not-yet-ratified. Picked so one physical mouse-wheel notch
 * (deltaY ~100px in Chrome's default pixel mode) is roughly a 15% zoom step —
 * `Math.exp(-100 * 0.0015) ≈ 0.86` — which is the same order of magnitude as
 * Figma's and Miro's default wheel-zoom speed.
 */
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

/** `?at=` is written this long after the last viewport change, not on every
 * change — see the effect below for why replaceState still has to run at all
 * during an in-progress drag, just not on every one of its many pointermoves. */
const URL_SYNC_DEBOUNCE_MS = 250;

const KEYBOARD_HINT_COPY: Record<PublicLocale, string> = {
  en: "Drag to pan. Pinch, or hold ctrl and scroll, to zoom. Arrow keys pan, plus and minus zoom, zero resets the view.",
  ja: "ドラッグでパン。ピンチ、または ctrl を押しながらスクロールでズーム。矢印キーでパン、プラス／マイナスでズーム、ゼロで表示をリセットします。",
};

/** The straight-line distance between two viewport-local points — used for
 * both drag distance and the two-finger pinch's finger separation. */
function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * An addressable pan/zoom viewport for `/repository/layers`'s converge canvas.
 *
 * The state this renders is `Viewport` from `lib/repository/canvas-viewport.ts`
 * — a plain `{x, y, z}` the server can resolve from `?at=` with no DOM
 * involved. This component is the other half: the part that actually needs a
 * browser (pointer/wheel/keyboard input, `history.replaceState`), kept behind
 * "use client" and nothing more than that behind it. Every visual transform
 * this component ever applies goes through `transformOf`, the same function
 * the server used to render the initial one — see that file's header for why
 * a second writer of the same string is the specific bug this avoids.
 *
 * State initializes from `initial` directly (`useState(initial)`), not from
 * an effect: an effect only runs after the first client render commits, so
 * seeding state there would mean the server-rendered HTML always shows
 * `IDENTITY` for one frame — visible as a flash on every load of a shared
 * `?at=` link, and the literal thing "no-JS still gets the viewport the URL
 * names" rules out, since a reader with JS off would be stuck on that first
 * frame forever.
 */
export function InfiniteCanvas({
  children,
  initial,
  label,
  locale,
  fill = false,
}: {
  children: ReactNode;
  initial: Viewport;
  label: string;
  locale: PublicLocale;
  /**
   * Take the height of the screen rather than the fixed 32rem box.
   *
   * > *"map itself should take up most of the webpage/screen"* — owner,
   * > session-103 inbox
   *
   * A flag rather than a change to `.mj-canvas-viewport`, because the same
   * component draws a **second** figure — the one on a node's own page — where
   * the map is one section of a written record and taking the whole screen
   * would push the prose it illustrates off it. The map surface passes `fill`;
   * the node page does not.
   */
  fill?: boolean;
}) {
  const [view, setView] = useState<Viewport>(initial);
  const [dragging, setDragging] = useState(false);
  const hintId = useId();

  // Event handlers below are registered once (empty dependency array) so a
  // drag in progress is never interrupted by React tearing down and
  // re-attaching listeners mid-gesture. They read the latest viewport through
  // this ref rather than through the `view` closed over at registration time.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const rootRef = useRef<HTMLDivElement>(null);

  // --- ?at= sync: debounced, replaceState only, every other param kept -----
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      // The URL already names `initial` — that is what just got rendered — so
      // the first run of this effect has nothing to write back. Writing here
      // unconditionally would also be the one case that could turn a plain
      // `/repository/layers` into `?at=0,0,1` on first paint, which the
      // omit-at-identity rule below exists specifically to prevent.
      isFirstRender.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      const formatted = formatViewport(view);
      // Never write `at=0,0,1`: an identity viewport is what a bare URL
      // already means, so naming it explicitly would only make every shared
      // link one parameter longer for no reader-visible difference.
      if (formatted === formatViewport(IDENTITY)) {
        url.searchParams.delete("at");
      } else {
        url.searchParams.set("at", formatted);
      }
      // `history.state` is carried through rather than replaced with `null`:
      // Next's App Router keeps its own scroll-restoration bookkeeping there,
      // and this is a viewport update, not a navigation, so that bookkeeping
      // is not this component's to discard.
      window.history.replaceState(window.history.state, "", url);
    }, URL_SYNC_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [view]);

  // --- pointer drag (pan), two-finger pinch (zoom), wheel (zoom) -----------
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let drag: {
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startView: Viewport;
      moved: boolean;
    } | null = null;
    let pinch: { startDistance: number; startView: Viewport } | null = null;
    // Set the instant a drag ends with `moved: true`, read and cleared by the
    // very next click. Between those two points nothing else runs on this
    // thread (pointerup and click are both dispatched synchronously for the
    // same user gesture), so there is no window in which a click from an
    // unrelated later gesture could see a stale `true` left over.
    let suppressNextClick = false;

    function localPoint(clientX: number, clientY: number) {
      const rect = el!.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function onPointerDown(e: PointerEvent) {
      // Left button only, for mouse — a right- or middle-click on the canvas
      // should open its own menu or do nothing, not start a pan. Touch and
      // pen report `button: 0` on their primary contact, so this does not
      // filter them.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // **Capture is NOT taken here.** It is taken in `onPointerMove`, the
      // moment the drag threshold is crossed.
      //
      // Pointer capture retargets the compatibility mouse events — `click`
      // among them — at the capturing element for as long as it is held. Taking
      // it on every `pointerdown` would therefore deliver every click to this
      // `<div>` instead of to the `<a>` underneath it, and every link on the
      // canvas would be dead: no error, no warning, nothing in the console, just
      // shapes that do not navigate. That is the same failure the movement
      // threshold below exists to prevent, arriving by a different door, so the
      // capture is deferred to exactly the case that needs it — a drag that has
      // left the element — and a plain click never involves capture at all.
      if (pointers.size === 2) {
        // A second finger just landed: this gesture is a pinch, not a pan.
        // A pinch needs capture from the start — there is no threshold to wait
        // for and two fingers are never a click.
        for (const id of pointers.keys()) {
          if (!el!.hasPointerCapture(id)) el!.setPointerCapture(id);
        }
        // Whatever single-finger drag was starting under the first finger is
        // abandoned outright rather than resumed later — resuming it on
        // pinch-end would pan by the sum of both fingers' movement, which is
        // not what either finger did on its own.
        drag = null;
        setDragging(false);
        const [a, b] = [...pointers.values()];
        pinch = { startDistance: distance(a, b), startView: viewRef.current };
        return;
      }
      if (pointers.size === 1) {
        drag = {
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startView: viewRef.current,
          moved: false,
        };
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const mid = localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
        const factor = distance(a, b) / pinch.startDistance;
        setView(zoomAbout(pinch.startView, mid.x, mid.y, factor));
        return;
      }

      if (!drag || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      // This threshold check is the single most important correctness
      // property this component has. Below DRAG_THRESHOLD_PX the pointer has
      // not moved far enough to tell a real drag apart from the jitter of an
      // ordinary click, so nothing is repainted and `moved` stays false — and
      // `moved` is exactly what the click-capture handler below checks before
      // it will call preventDefault(). A pan implementation that swallowed
      // every click regardless of movement would make every link this canvas
      // ever contains permanently unclickable; that failure is silent (no
      // error, the link is just dead) and would not show up in anything short
      // of actually clicking one, which is why the threshold and the
      // suppression it gates are kept next to each other in one file.
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      if (!drag.moved) {
        // Now, and only now: this is a drag. Capturing here keeps it alive if
        // the pointer leaves the viewport, and keeps it away from every click
        // that never became one. See the note in `onPointerDown`.
        el!.setPointerCapture(e.pointerId);
      }
      drag.moved = true;
      setDragging(true);
      setView({ ...drag.startView, x: drag.startView.x + dx, y: drag.startView.y + dy });
    }

    function endPointer(e: PointerEvent) {
      pointers.delete(e.pointerId);
      if (el!.hasPointerCapture(e.pointerId)) el!.releasePointerCapture(e.pointerId);

      if (pinch && pointers.size < 2) pinch = null;

      if (drag && e.pointerId === drag.pointerId) {
        if (drag.moved) suppressNextClick = true;
        drag = null;
        setDragging(false);
      }
    }

    // Capture phase, registered on this element: it runs before the click
    // reaches whichever `<a>` inside `children` was under the pointer, which
    // is what makes preventDefault() here actually cancel that link's
    // navigation instead of merely observing a click that already happened.
    function onClickCapture(e: MouseEvent) {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      e.preventDefault();
      e.stopPropagation();
    }

    function onWheel(e: WheelEvent) {
      // **A plain wheel is the page scrolling, not this figure zooming.**
      //
      // This canvas is a box in the middle of a long document, not a full-screen
      // map, and it is wide: with a plain wheel bound to zoom, a reader scrolling
      // down the page with the pointer anywhere over the figure zooms it instead
      // of moving down the page, and cannot get past it without aiming at the
      // margin. Measured on the built page while verifying this session's work —
      // the figure had silently zoomed itself to 73% and panned off-centre from
      // nothing but ordinary scrolling.
      //
      // So zoom needs the modifier, which costs nothing where it matters: a
      // trackpad pinch is *delivered* as `ctrl + wheel` by every browser, so
      // pinch-to-zoom keeps working untouched, and it is the gesture a reader
      // actually reaches for. A mouse wheel scrolls the page, which is what a
      // wheel does everywhere else on it. Keyboard `+`/`-` and the size links
      // are the two ways in that need no pointer at all.
      if (!e.ctrlKey && !e.metaKey) return;
      // A horizontal-only wheel event (deltaY === 0) is not a zoom input on
      // this surface — the common source is a two-finger horizontal trackpad
      // swipe, which several browsers reserve for back/forward navigation.
      if (e.deltaY === 0) return;
      const rect = el!.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const pixels =
        e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_HEIGHT_PX : e.deltaMode === 2 ? e.deltaY * rect.height : e.deltaY;
      const factor = Math.exp(-pixels * WHEEL_ZOOM_SENSITIVITY);
      setView(zoomAbout(viewRef.current, px, py, factor));
      // Only when cancelable: a wheel event dispatched during a passive
      // listener pass (not the case for the { passive: false } listener
      // below, but true of some synthetic replays) throws if preventDefault()
      // is called on it regardless of intent.
      if (e.cancelable) e.preventDefault();
    }

    // { passive: false } on wheel alone: it is the one listener here that
    // calls preventDefault(), and a passive listener's preventDefault() is a
    // silent no-op (with a console warning) rather than an error — the bug it
    // would cause is the page scrolling out from under a reader who is
    // zooming the canvas, with nothing in the console loud enough to notice
    // during normal use. Pointer and click listeners never block their
    // default beyond the one gated click, so they stay passive.
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove, { passive: true });
    el.addEventListener("pointerup", endPointer);
    el.addEventListener("pointercancel", endPointer);
    el.addEventListener("click", onClickCapture, true);
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endPointer);
      el.removeEventListener("pointercancel", endPointer);
      el.removeEventListener("click", onClickCapture, true);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  // --- keyboard: arrows pan, +/- zoom, 0 resets to `initial` ---------------

  /**
   * A keyboard step lands immediately.
   *
   * It used to ease into place over 150ms, skipped under
   * `prefers-reduced-motion`. Removed on review: the coding guidelines carry a
   * **closed** list of permitted animations and a canvas keyboard-step is not on
   * it. Adding a sixth quietly is how a closed list stops being one, and
   * extending it is the owner's call rather than a side effect of building a
   * viewport. Nothing is lost for the readers it would have mattered to most —
   * an instant step is what they were getting anyway.
   */
  function stepByKeyboard(next: Viewport) {
    setView(next);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Only the viewport's own focus drives the viewport.
    //
    // This handler is on the container, so it also sees keys bubbling from the
    // `<a>` shapes inside it. With a link on the figure focused, an arrow key
    // panned the canvas *and* called `preventDefault()` — cancelling the
    // browser's own behaviour for a key press that belonged to the link, on a
    // component whose whole justification for declining `role="application"` is
    // that the content keeps its usual navigation.
    if (e.target !== e.currentTarget) return;
    const current = viewRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    switch (e.key) {
      case "ArrowLeft":
        stepByKeyboard({ ...current, x: current.x + KEYBOARD_PAN_STEP_PX });
        break;
      case "ArrowRight":
        stepByKeyboard({ ...current, x: current.x - KEYBOARD_PAN_STEP_PX });
        break;
      case "ArrowUp":
        stepByKeyboard({ ...current, y: current.y + KEYBOARD_PAN_STEP_PX });
        break;
      case "ArrowDown":
        stepByKeyboard({ ...current, y: current.y - KEYBOARD_PAN_STEP_PX });
        break;
      // "=" is the unshifted key that produces "+" on a US layout; both are
      // accepted so a reader does not have to hold Shift to zoom in.
      case "+":
      case "=":
        stepByKeyboard(zoomAbout(current, rect.width / 2, rect.height / 2, KEYBOARD_ZOOM_FACTOR));
        break;
      case "-":
        stepByKeyboard(zoomAbout(current, rect.width / 2, rect.height / 2, 1 / KEYBOARD_ZOOM_FACTOR));
        break;
      case "0":
        stepByKeyboard(initial);
        break;
      default:
        // Not a key this control handles — let it bubble and do whatever it
        // would otherwise do (e.g. Tab still moves focus off the canvas).
        return;
    }
    e.preventDefault();
  }

  return (
    <div
      ref={rootRef}
      // No `role="application"`: that role tells assistive tech to stop
      // offering its own reading and navigation commands for everything
      // inside and hand all keyboard handling to this component instead. The
      // content in `children` is an ordinary set of `<a href>` links (the
      // repository canvas's shapes), which still need to work with a screen
      // reader's native link list and its usual navigation — a control
      // surface, not an application, is what this is.
      className={`mj-canvas-viewport${fill ? " mj-canvas-viewport--fill" : ""}${dragging ? " mj-canvas-viewport--dragging" : ""}`}
      tabIndex={0}
      aria-label={label}
      aria-describedby={hintId}
      onKeyDown={onKeyDown}
    >
      <div
        className="mj-canvas-layer"
        style={{ transform: transformOf(view), transformOrigin: "0 0" }}
      >
        {children}
      </div>
      <p id={hintId} className="sr-only">
        {KEYBOARD_HINT_COPY[locale]}
      </p>
    </div>
  );
}
