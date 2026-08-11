"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { carryPaper, carrySelection } from "../lib/repository/canvas-selection";

/**
 * Opening a line moves the picture instead of replacing the page.
 *
 * > *"transitions being perfectly smooth with animation for branches extending
 * > out, zooming in and out, is really needed for this to be professional
 * > product."* — owner, session-101 inbox
 *
 * ## What this is, and what it deliberately is not
 *
 * It is **not** a canvas that owns the drawing. Every shape inside it is still a
 * server-rendered `<a href>` with a real address (D88.2, D90.3): a crawler
 * follows every one, `curl` sees the same figure, and with JavaScript off every
 * click still works — it just navigates, exactly as it did before this file
 * existed. Nothing here produces a shape, decides a geometry, or holds state
 * that the URL does not already hold.
 *
 * All it does is take a click that would have replaced the document with a new
 * copy of the same figure, and make it a same-document update instead. React
 * then reconciles the SVG **in place** — the lane keys are stable across an open
 * set change, which is measured — so a lane's `<path>` keeps its identity and
 * only its `d` changes. That is what the CSS transitions in the converge block
 * of `styles.css` need: a `d` that changes on an element that stayed.
 *
 * ## Why not a view transition, which is the obvious answer
 *
 * Because it cannot reach the shapes. `view-transition-name` on an element
 * *inside* an `<svg>` is never captured by the browser — measured under
 * Playwright, since a hidden agent tab skips every view transition and so cannot
 * tell "does not work" from "did not run". The name survives in the computed
 * style and no `::view-transition-group` is ever built for it. Only the root
 * `<svg>` can carry one, which gives a figure that scales as a picture rather
 * than lines that bend.
 *
 * So the two mechanisms are split by what each can actually do, and both stay:
 *
 * - **Same page, `?open=` changing** — intercepted here, and the geometry
 *   transitions. Every circle slides to its new place as a column widens, and a
 *   branch that was not there before grows in.
 * - **A different page — clicking a name to read about it** — not intercepted,
 *   because that is a real cross-document navigation and it already has the
 *   `@view-transition` zoom that pairs the figure with the same figure on the
 *   destination. Intercepting it would take that away and give nothing back.
 *
 * Session 101 costed this as a fork: rebuild the zoom on
 * `document.startViewTransition()` *or* keep today's cross-document one, ~1,400
 * lines either way. The fork was real for a canvas that owns its drawing. It is
 * not real for one that only changes how a link is followed.
 *
 * ## The rules for intercepting a click, and why each one is here
 */
export function CanvasContinuity({
  children,
  className,
  renderedAt = null,
}: {
  children: ReactNode;
  className?: string;
  /**
   * The `?at=` **this render was built from** — the viewport stamped into every
   * href on the figure below.
   *
   * Needed because the reader's viewport and the links' viewport drift apart the
   * moment they pan: `InfiniteCanvas` writes the live one into the URL with a
   * debounced `replaceState`, while the anchors still carry the value the server
   * rendered with. Following one used to remount the canvas at the stale value,
   * which is session 101's *"every click threw away where you were standing"*.
   * Intercepting fixed the visible half — the canvas is not remounted, so the
   * reader stays put — and left the invisible half worse: the pushed URL would
   * say somewhere the reader is not, and that URL is what they bookmark or send.
   *
   * So an inherited `at` is replaced with the live one. **Inherited**, not "any":
   * the size controls set an `at` of their own deliberately, and one of those
   * must win over where the reader happens to be standing. The test for
   * inherited is exactly this prop — an anchor carrying the value this render was
   * built from is passing it along, not choosing it. Caught in review.
   */
  renderedAt?: string | null;
}): React.ReactElement {
  const router = useRouter();
  const host = useRef<HTMLDivElement>(null);
  // Read inside the handler rather than captured in the effect's closure, so a
  // re-render after a push updates it without re-binding the listener.
  const inherited = useRef(renderedAt);
  inherited.current = renderedAt;

  useEffect(() => {
    const node = host.current;
    if (!node) return;

    function onClick(event: MouseEvent) {
      // Something else already handled it — the pan surface cancels the click
      // that ends a drag, and a drag that ends on a line must not open it.
      if (event.defaultPrevented) return;
      // Left button, unmodified. Every other combination is a reader asking the
      // *browser* for something — a new tab, a new window, a download, a saved
      // link — and answering with a same-document update would be taking a
      // deliberate gesture away.
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      // `closest` from the click target: inside an SVG the event lands on the
      // `<path>` or the `<text>`, never on the `<a>` that wraps it.
      const anchor = target.closest("a");
      if (anchor === null) return;
      if (anchor.getAttribute("target")) return;
      if (anchor.hasAttribute("download")) return;

      // SVG anchors use `href` as a plain attribute; reading `.href` off one
      // gives an `SVGAnimatedString`, not a URL. The attribute is the truth for
      // both kinds, and it is what the server rendered.
      const href = anchor.getAttribute("href");
      // App-relative only. Anything else is off this surface, and `//` is a
      // protocol-relative URL to another origin wearing a leading slash.
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;

      const next = new URL(href, window.location.href);
      // **Same page only.** A link to a different path is a real navigation to a
      // different subject, and it already animates as one — see above. Only a
      // link that re-renders *this* figure with a different `?open=` is a
      // candidate for being turned into a movement of the drawing.
      if (next.pathname !== window.location.pathname) return;
      if (next.search === window.location.search) return;

      // Where the reader is *now*, which is not what the anchor says once they
      // have panned. Only substituted into a link that is passing the rendered
      // value along; a link that names a different viewport chose it.
      const liveParams = new URLSearchParams(window.location.search);
      const live = liveParams.get("at");
      const carried = next.searchParams.get("at");
      if (live !== null && carried === inherited.current && live !== carried) {
        next.searchParams.set("at", live);
      }

      // What the click means for `?sel=` — the Prezi move's selection identity
      // (W16). Derived from the URL diff alone, after the `at` substitution so
      // the jump-rewrite rule sees the anchor's own `at`, not the live one.
      carrySelection(liveParams, next.searchParams);

      // The paper surface rides along too (W20) — same shape, separate rule:
      // selection is about one drawn thing, the paper about the whole surface.
      carryPaper(liveParams, next.searchParams);

      event.preventDefault();
      // `scroll: false` because the reader is looking at a figure, not arriving
      // at a page: jumping them to the top to show them the thing they were
      // already looking at is the opposite of continuity.
      router.push(`${next.pathname}${next.search}`, { scroll: false });
    }

    node.addEventListener("click", onClick);
    return () => node.removeEventListener("click", onClick);
  }, [router]);

  return (
    <div ref={host} className={className}>
      {children}
    </div>
  );
}
