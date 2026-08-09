"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  IDENTITY,
  KEYBOARD_ZOOM_FACTOR,
  createCanvasGesture,
  formatViewport,
  panBy,
  transformOf,
  wheelPixels,
  wheelZoomFactor,
  zoomAbout,
  type GestureOutcome,
  type Viewport,
} from "../lib/repository/canvas-viewport";
import type { PublicLocale } from "../lib/public-locale";

/** Viewport pixels per keyboard pan step. Not measured — chosen so a single
 * press moves a visibly deliberate amount (about a finger's width of the
 * strand-canvas hit targets, `.mj-process-hit-line`'s 24px, doubled) without
 * needing more than a few presses to cross the canvas. */
const KEYBOARD_PAN_STEP_PX = 40;

/** `?at=` is written this long after the last viewport change, not on every
 * change — see the effect below for why replaceState still has to run at all
 * during an in-progress drag, just not on every one of its many pointermoves. */
const URL_SYNC_DEBOUNCE_MS = 250;

/**
 * How long after the last gesture event the layer stays promoted to its own
 * compositor layer (`.mj-canvas-viewport--gesturing`, see styles.css).
 *
 * A gap, not a duration: every event restarts it, so the promotion survives a
 * whole gesture however long it runs. 200ms is more than an order of magnitude
 * above the ~8-16ms between the wheel events macOS keeps emitting during
 * momentum, so the layer is never dropped and re-created in the middle of a
 * glide — which would cost exactly the repaint the promotion exists to avoid —
 * and short enough that the rasterized copy of up to four full SVG figures is
 * handed back promptly once the reader stops.
 */
const GESTURE_SETTLE_MS = 200;

/**
 * The `sr-only` description of what the pointer can do here, per surface.
 *
 * Two records rather than one string with a clause spliced in, because the two
 * surfaces genuinely offer different gestures: only the map binds a plain
 * wheel/two-finger scroll to panning (see `onWheel`), so telling a reader of
 * the node-page figure to "scroll to pan" would be describing a control that
 * does nothing there.
 */
const CANVAS_HINT_COPY: Record<PublicLocale, string> = {
  en: "Drag to pan. Pinch, or hold ctrl and scroll, to zoom. Arrow keys pan, plus and minus zoom, zero resets the view.",
  ja: "ドラッグでパン。ピンチ、または ctrl を押しながらスクロールでズーム。矢印キーでパン、プラス／マイナスでズーム、ゼロで表示をリセットします。",
};

const CANVAS_HINT_COPY_FILL: Record<PublicLocale, string> = {
  en: "Scroll or drag to pan. Pinch, or hold ctrl and scroll, to zoom. Arrow keys pan, plus and minus zoom, zero resets the view.",
  ja: "スクロールまたはドラッグでパン。ピンチ、または ctrl を押しながらスクロールでズーム。矢印キーでパン、プラス／マイナスでズーム、ゼロで表示をリセットします。",
};

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
 * The pan/pinch state machine is `createCanvasGesture`, in that same file and
 * likewise DOM-free; what is left here is the adapter that turns DOM events
 * into `PointerSample`s and its instructions back into capture calls and React
 * state. That split exists so the threshold and the ghost-contact guard — both
 * of them silent when they break — can be tested without a browser.
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
   * This is the map surface, not an illustration inside a written record.
   *
   * > *"map itself should take up most of the webpage/screen"* — owner,
   * > session-103 inbox
   *
   * A flag rather than a change to `.mj-canvas-viewport`, because the same
   * component draws a **second** figure — the one on a node's own page — where
   * the map is one section of a written record and taking the whole screen
   * would push the prose it illustrates off it. The map surface passes `fill`;
   * the node page does not.
   *
   * It now decides two things rather than one: the height, and whether a plain
   * wheel pans the canvas or scrolls the page (`onWheel`). A second prop was
   * considered and dropped — it would be set to the same value as this one at
   * both call sites forever, and two flags that must agree are two flags that
   * eventually will not. What the flag really names is *which of the two
   * surfaces this is*, and both behaviours follow from that.
   */
  fill?: boolean;
}) {
  const [view, setView] = useState<Viewport>(initial);
  const [dragging, setDragging] = useState(false);
  const [gesturing, setGesturing] = useState(false);
  const hintId = useId();

  // Event handlers below are registered once (empty dependency array) so a
  // drag in progress is never interrupted by React tearing down and
  // re-attaching listeners mid-gesture. They read the latest viewport through
  // this ref rather than through the `view` closed over at registration time.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Same reason, for the surface flag: the wheel handler is registered once and
  // needs `fill` at event time, not at registration time. In practice neither
  // call site ever changes it after mount, which is exactly why reading it out
  // of a stale closure would go unnoticed if one ever did.
  const fillRef = useRef(fill);
  useEffect(() => {
    fillRef.current = fill;
  }, [fill]);

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

  // --- pointer drag (pan), two-finger pinch (zoom), wheel (pan and zoom) ----
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const gesture = createCanvasGesture();
    // Set the instant a gesture ends having moved the picture, read and cleared
    // by the very next click — and cleared again by the next `pointerdown`,
    // which bounds its life to one gesture. That second reset is not
    // decorative: a two-finger pinch on a touch screen produces no synthesized
    // click at all, so without it a flag raised by a pinch would sit there and
    // eat the next unrelated tap on a link.
    let suppressNextClick = false;

    // --- one layout read per gesture, not one per event --------------------
    //
    // `getBoundingClientRect()` forces the browser to flush pending layout
    // before it can answer. The old handlers called it once per pinch move and
    // once per wheel event, i.e. at trackpad event rate, on a page that draws
    // up to four full SVG figures — a synchronous layout each time, which is
    // the shape of "the canvas is slow" that has nothing to do with React.
    //
    // The rule is one measurement per gesture: the cache is dropped at the
    // start of each one (a `pointerdown`, the first wheel event of a burst) and
    // again whenever the element could have moved under it — a scroll in any
    // ancestor, a window resize, or the element's own `resize: vertical`
    // handle, which no window event reports.
    //
    // Caching within a gesture also makes a drag *more* correct than reading
    // the rect live did: a drag delta is measured against the anchor stored at
    // `pointerdown`, so a rect that shifted mid-gesture (a page scroll) would
    // have teleported the content by the scroll distance.
    let rect: { left: number; top: number; width: number; height: number } | null = null;
    function measure() {
      const cached = rect;
      if (cached) return cached;
      const r = el!.getBoundingClientRect();
      const measured = { left: r.left, top: r.top, width: r.width, height: r.height };
      rect = measured;
      return measured;
    }
    function invalidateRect() {
      rect = null;
    }

    // --- one React commit per animation frame ------------------------------
    //
    // A trackpad reports faster than the display refreshes, so binding
    // `setView` straight to each event renders and writes `style.transform`
    // several times for one painted frame. The pending viewport is held here
    // and handed to React once per frame instead.
    //
    // `viewRef.current` is written **synchronously**, not in the frame
    // callback: wheel zoom and wheel pan both compose against the current
    // viewport, so two events inside one frame have to see each other's result
    // or the second one silently undoes the first.
    let frame = 0;
    let pending: Viewport | null = null;
    function commit(next: Viewport) {
      viewRef.current = next;
      pending = next;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const settled = pending;
        pending = null;
        // Only if nothing newer has landed. A keypress inside the same frame
        // writes `viewRef` and its own state directly (`stepByKeyboard`), and
        // handing React the pointer-derived viewport afterwards would undo it.
        if (settled && viewRef.current === settled) setView(settled);
      });
    }

    // --- compositor-layer promotion, for the duration of a gesture ---------
    //
    // Nothing in this stylesheet used `will-change` before this. Every
    // transform write therefore repainted the SVG figures from scratch. The
    // class is carried in React state rather than poked onto the node, because
    // React owns this element's `className` and would reconcile an imperative
    // change away on its next render.
    let promoted = false;
    let settleTimer = 0;
    function markGesturing() {
      if (!promoted) {
        promoted = true;
        setGesturing(true);
      }
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = 0;
        promoted = false;
        setGesturing(false);
      }, GESTURE_SETTLE_MS);
    }

    function apply(outcome: GestureOutcome) {
      for (const id of outcome.capture) {
        if (!el!.hasPointerCapture(id)) el!.setPointerCapture(id);
      }
      // Ended before began: a pinch handing its gesture over to the one finger
      // still down reports both in the same outcome, and the reader should be
      // left with the grabbing cursor, not without it.
      if (outcome.endedDrag) setDragging(false);
      if (outcome.beganDrag) setDragging(true);
      if (outcome.suppressClick) suppressNextClick = true;
      if (outcome.view) {
        commit(outcome.view);
        markGesturing();
      }
    }

    function sample(e: PointerEvent) {
      const r = measure();
      return { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top, isPrimary: e.isPrimary };
    }

    function onPointerDown(e: PointerEvent) {
      // Left button only, for mouse — a right- or middle-click on the canvas
      // should open its own menu or do nothing, not start a pan. Touch and
      // pen report `button: 0` on their primary contact, so this does not
      // filter them.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // The click belonging to the previous gesture, if the browser was going
      // to synthesize one, has already been dispatched by now: `pointerup` and
      // `click` are delivered synchronously for the same gesture. Anything
      // still set here is therefore a flag nothing ever collected.
      suppressNextClick = false;
      // A gesture starts here, so this is where the one layout read it is
      // allowed belongs.
      invalidateRect();
      apply(gesture.down(sample(e), viewRef.current));
    }

    function onPointerMove(e: PointerEvent) {
      apply(gesture.move(sample(e)));
    }

    function onPointerEnd(e: PointerEvent) {
      const outcome = gesture.end(e.pointerId);
      if (el!.hasPointerCapture(e.pointerId)) el!.releasePointerCapture(e.pointerId);
      apply(outcome);
    }

    function onWindowBlur() {
      // The pointer left the window and was released somewhere we will never
      // hear about — the classic source of a contact that is tracked forever.
      for (const id of gesture.ids()) {
        if (el!.hasPointerCapture(id)) el!.releasePointerCapture(id);
      }
      apply(gesture.cancelAll());
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
      // **What a plain wheel does depends on which surface this is.**
      //
      // It used to do nothing at all, anywhere, and the comment justifying that
      // was right about one surface and wrong about the other:
      //
      // - **The node-page figure** is a box in the middle of a long document,
      //   and a wide one. With a plain wheel bound to the canvas, a reader
      //   scrolling down the page with the pointer over the figure moves the
      //   figure instead of the page and cannot get past it without aiming at
      //   the margin. Measured while building it: the figure had silently
      //   zoomed itself to 73% and panned off-centre from ordinary scrolling.
      //   That surface keeps the old rule — a plain wheel is the page.
      // - **The map surface** (`fill`) is `100dvh` tall and *is* the page rather
      //   than an illustration in one. There, a two-finger scroll that does
      //   nothing is not restraint, it is a dead control: *"On trackpad, I
      //   should be able to scroll through with my two fingers, not click and
      //   drag"* — owner, session-104 inbox. A plain wheel pans it.
      //
      //   It was `calc(100dvh - 15rem)` when this rule was written, and the
      //   sentence that stood here said the ~15rem of chrome around it was what
      //   a reader scrolled with instead. Session 109 took that chrome away —
      //   the map is now edge to edge with a back arrow and an info icon over
      //   it, and there is nothing left to scroll past. So the canvas swallowing
      //   the wheel is total on this surface, which is the intended reading of
      //   the owner's ask and not an oversight: there is no longer a document
      //   underneath for the gesture to belong to.
      //
      // **Momentum is not implemented, deliberately.** macOS keeps emitting
      // `wheel` events with decaying deltas for up to a second or so after the
      // fingers lift; a pan bound 1:1 to those deltas glides and settles on its
      // own, with the OS's own curve. A velocity-and-rAF fling layered on top
      // would run *at the same time* as those events, not instead of them, and
      // the two would add — the "don't overdo it" failure, arrived at by
      // writing more code. Drag-panning with a mouse has no OS momentum and
      // gets none here either; that is a separate feature, not this one leaking.
      //
      // ⌘+scroll is left alone: it is the browser's own page zoom, and this
      // canvas taking it was a hijack of a system-level gesture. Only `ctrlKey`
      // means zoom now — which is also how every browser delivers a trackpad
      // pinch, so pinch-to-zoom keeps working on both surfaces untouched.
      //
      // `promoted` is false exactly when no gesture is in flight, so this is
      // the first event of a wheel burst and the moment to re-read the rect.
      // Every later event in the burst, momentum included, reuses it.
      if (!promoted) invalidateRect();
      if (e.ctrlKey) {
        // A horizontal-only event (deltaY === 0) is not a zoom input: the
        // common source is a two-finger horizontal swipe, which is a pan.
        if (e.deltaY === 0) return;
        const r = measure();
        const factor = wheelZoomFactor(wheelPixels(e.deltaY, e.deltaMode, r.height));
        commit(zoomAbout(viewRef.current, e.clientX - r.left, e.clientY - r.top, factor));
        markGesturing();
        // Only when cancelable: a wheel event dispatched during a passive
        // listener pass (not the case for the { passive: false } listener
        // below, but true of some synthetic replays) throws if preventDefault()
        // is called on it regardless of intent.
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (e.metaKey) return;
      if (!fillRef.current) return;
      const r = measure();
      const dx = wheelPixels(e.deltaX, e.deltaMode, r.width);
      const dy = wheelPixels(e.deltaY, e.deltaMode, r.height);
      if (dx === 0 && dy === 0) return;
      // Negated, and 1:1 with the reported delta. Scrolling down means "show me
      // what is further down", which moves the content up. No multiplier: the
      // deltas macOS reports already carry its own scroll acceleration, so a
      // fast flick is already a big delta, and a pan that does not track the
      // fingers exactly is the thing that stops a canvas feeling like one.
      commit(panBy(viewRef.current, -dx, -dy));
      markGesturing();
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
    // `lostpointercapture` closes the case where the browser takes a capture
    // away from us mid-drag (a system gesture, a context menu) and then never
    // sends the `pointerup` that would have ended it.
    el.addEventListener("lostpointercapture", onPointerEnd);
    el.addEventListener("click", onClickCapture, true);
    el.addEventListener("wheel", onWheel, { passive: false });
    // Releases are heard on `window`, not on the element. A press that stayed
    // under the drag threshold never took capture, so its `pointerup` is
    // delivered to whatever is under the pointer at the time — which, for a
    // press that wandered off the canvas, is not this element. Element-scoped
    // listeners simply never heard about it, and the contact stayed tracked.
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    window.addEventListener("blur", onWindowBlur);

    // The cached rect goes stale when the element moves or resizes. A window
    // `resize` does not cover the element's own `resize: vertical` handle, so
    // observe the element too; `scroll` is capture-phase because a scroll
    // inside any ancestor moves this element without bubbling.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(invalidateRect) : null;
    observer?.observe(el);
    window.addEventListener("scroll", invalidateRect, { passive: true, capture: true });
    window.addEventListener("resize", invalidateRect, { passive: true });

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("lostpointercapture", onPointerEnd);
      el.removeEventListener("click", onClickCapture, true);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("scroll", invalidateRect, { capture: true });
      window.removeEventListener("resize", invalidateRect);
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      if (settleTimer) window.clearTimeout(settleTimer);
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
   *
   * It also does not go through the per-frame coalescing the pointer and wheel
   * paths use: one keypress is one step, and there is never a second one in the
   * same frame to fold it into.
   */
  function stepByKeyboard(next: Viewport) {
    viewRef.current = next;
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
        stepByKeyboard(panBy(current, KEYBOARD_PAN_STEP_PX, 0));
        break;
      case "ArrowRight":
        stepByKeyboard(panBy(current, -KEYBOARD_PAN_STEP_PX, 0));
        break;
      case "ArrowUp":
        stepByKeyboard(panBy(current, 0, KEYBOARD_PAN_STEP_PX));
        break;
      case "ArrowDown":
        stepByKeyboard(panBy(current, 0, -KEYBOARD_PAN_STEP_PX));
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
      className={`mj-canvas-viewport${fill ? " mj-canvas-viewport--fill" : ""}${dragging ? " mj-canvas-viewport--dragging" : ""}${gesturing ? " mj-canvas-viewport--gesturing" : ""}`}
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
        {(fill ? CANVAS_HINT_COPY_FILL : CANVAS_HINT_COPY)[locale]}
      </p>
    </div>
  );
}
