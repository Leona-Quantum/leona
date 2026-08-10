"use client";

// Everything written about the map, in one box behind one icon.
//
// > *"When information icon clicked on, opens a popup in the middle of the
// > screen that explains stuff about how the map works … In this information
// > box there is a collapsible sidebar with options on the left and the content
// > in the rest of the box … Overly pedantic explanations like what is on the
// > page right now should be removed."* — owner, ask H
//
// ## The `<details>` argument, honoured rather than overruled
//
// `repository-converge-view.tsx:840-858` argued *against* exactly this control:
// an onClick popup only works after hydration, so it has no address, no crawler
// sees it, and a reader with JavaScript off cannot reach it (D88.2, and the two
// sessions `?category=` cost). The owner has now asked for a popup. Both of
// those can be true at once, because the part of that argument that binds is
// not the `<details>` element — it is the two properties the element happened
// to give for free:
//
//   1. **it works with no JavaScript**, and
//   2. **it has an address**.
//
// So what is open here is `?about=<section>`, resolved on the server. Opening
// the box is a link, choosing a section is a link, closing it is a link, and
// every one of them renders server-side. With JavaScript off the box opens,
// every section is reachable, the size rungs inside it still work, and `curl`
// returns all five sections whether the box is open or shut — the shut state
// renders the same markup under `hidden`, so a crawler follows the links inside
// it either way. The box is strictly *better addressed* than the `<details>` it
// replaces, which had no address at all.
//
// What this file adds on top of that markup is enhancement and nothing else:
// a focus trap, Escape, and backdrop dismissal. Remove the JavaScript and the
// feature does not degrade to broken, it degrades to navigation.
//
// ## Why the copy lives in the client bundle
//
// Both locales of it ship, because this is a client component and a
// `Record<PublicLocale, …>` of functions cannot cross the server boundary. It
// is roughly 4 KB of text per locale on a route whose figure is already an
// order of magnitude larger, and the alternative — copy on the server, dialog
// behaviour in a second file — splits one box across two files so that the next
// person editing a sentence has to find the other half.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PUBLIC_SHELL_COPY, type PublicLocale } from "../lib/public-locale";
import { MAP_ABOUT_SECTIONS, type MapAboutSection } from "../lib/repository/map-about";
import { LanguageToggle } from "./language-toggle";
import { ThemeToggle } from "./theme-toggle";

/**
 * The marks §2 draws, named by what the canvas calls them rather than by what
 * they look like, so a change to the drawing renames the legend row with it.
 */
/**
 * `open` and `feed` were missing from the content spec this box was built to,
 * and were added back on review. The canvas draws both — an opened lane is a
 * `mj-converge-spine` rather than a `mj-converge-strand-body`, and an
 * ingredient hangs off a belly as a `mj-converge-feed-line` — so a key without
 * them explains six of the eight marks a reader can actually see. The old
 * `KeyMark` this box replaced had all eight; losing two while claiming to be
 * "the legend" would be a quieter version of the defect that key already
 * shipped once, where a swatch drew a shape the canvas had stopped drawing.
 */
type LegendKind = "terminal" | "inner" | "recorded" | "unpinned" | "unpublished" | "atlas" | "open" | "feed";

interface MapInfoCopy {
  /** The box's own name, above the section list. Not a heading — the sections are. */
  eyebrow: string;
  sections: Record<MapAboutSection, string>;
  sectionsLabel: string;
  close: string;
  whatThisIs: readonly string[];
  legend: readonly { kind: LegendKind; text: string }[];
  move: readonly string[];
  claims: readonly string[];
  gaps: readonly string[];
  display: string;
  elsewhere: string;
}

const COPY: Record<PublicLocale, MapInfoCopy> = {
  en: {
    eyebrow: "About this map",
    sectionsLabel: "Sections",
    close: "Close",
    sections: {
      "what-this-is": "What this is",
      "how-to-read-it": "How to read it",
      "how-to-move-around": "How to move around",
      "what-a-line-claims": "What a line is claiming",
      "not-here-yet": "What is not here yet",
    },
    whatThisIs: [
      "Quantum algorithms are not written from scratch. They are assembled from a small number of reusable steps, and almost every published method is a different route through the same handful of them.",
      "This is a map of those routes. Circles are the things an algorithm can be holding. Lines are the steps that carry you from one to the next. A method is a path across.",
      "Nothing here is generated. Every line was read out of a paper and checked against it.",
    ],
    legend: [
      { kind: "terminal", text: "Something you can hold — a state, a matrix, a circuit, an answer." },
      { kind: "inner", text: "The same, in the middle of a step you have opened." },
      { kind: "recorded", text: "A step. Someone has published a way through it." },
      { kind: "unpinned", text: "A step whose way through has not been pinned to one method." },
      { kind: "unpublished", text: "A step nothing published fills yet." },
      { kind: "open", text: "A step you have opened. What is drawn inside it is how it was done." },
      { kind: "feed", text: "Something the route needs but does not produce — an ingredient it takes in." },
      { kind: "atlas", text: "There is a record in the repository for this one." },
    ],
    move: [
      "Two fingers move the map. Pinch to zoom, or hold ctrl and scroll.",
      "Click a step to open it in place — everything else stays where it is.",
      "Click a name to read the full record without leaving the map.",
      "Arrow keys move, plus and minus zoom, zero puts it back.",
    ],
    claims: [
      "A solid line means a paper puts those two steps together and we have the citation. A long-dashed line means the route is recorded but no single method has been named for that step. A short-dashed line means nothing published fills it — the step is real, the way through is not written yet.",
      // **The mark, explained where the line's other claims are.** Not a legend
      // row: those are strokes, drawn with the canvas's own shapes, and this is
      // text at the end of a name. It belongs with the claims because that is
      // what it is — the route saying it walks this step many times, in the
      // source's own symbol. A mark with no key says *special* without saying
      // what, which is the failure this repository has already written down once.
      "A count after a step's name — ×T/h, ×O(κ) — means the route walks that step that many times rather than once. It is the source's own symbol, and the card says what it stands for and what one turn costs. A step with no count is a step no source we read said is repeated, which is not the same as one taken once.",
      // **The second claim, drawn rather than suffixed (W13).** This taught a
      // `⊂` symbol the owner rejected — a mark borrowed from set inclusion
      // that repeated the parent's name because graph order used to interleave
      // the group. The fan is grouped now: the relation is the nesting itself,
      // and the key explains the bracket a reader will actually see.
      "A line drawn nested under another, on the soft shaded band behind it, is a narrower version of the line above it: the same construction, re-analysed or re-tuned, filling the same step. It is why two lines can draw the identical interior and still be two entries. Lines outside the band are alternatives to their neighbours, not versions of them.",
      "The map does not hide the gaps. An empty step is drawn as an empty step.",
    ],
    gaps: [
      "The map covers the algorithm literature. The repository covers circuits and primitives. They overlap less than you would expect, and where a method has no record we say so on its page rather than leaving the space blank.",
      "Where something named here does have a record, its name links straight to it.",
    ],
    display: "Display",
    elsewhere: "Elsewhere",
  },
  ja: {
    eyebrow: "この地図について",
    sectionsLabel: "目次",
    close: "閉じる",
    sections: {
      "what-this-is": "これは何か",
      "how-to-read-it": "図の読み方",
      "how-to-move-around": "動かし方",
      "what-a-line-claims": "線が述べていること",
      "not-here-yet": "まだここにないもの",
    },
    whatThisIs: [
      "量子アルゴリズムは一から書かれるものではありません。再利用できる少数の工程を組み合わせて作られており、公開されている手法のほとんどは、同じひと握りの工程を通る別々の経路です。",
      "これはその経路の地図です。円はアルゴリズムが手にしている対象、線はある対象から次の対象へ運ぶ工程、そして手法はそこを横断する一本の道です。",
      "生成されたものはひとつもありません。すべての線は論文から読み取り、その論文と突き合わせて確認したものです。",
    ],
    legend: [
      { kind: "terminal", text: "手にできるもの — 状態、行列、回路、答え。" },
      { kind: "inner", text: "同じもの。開いた工程の内側にあります。" },
      { kind: "recorded", text: "工程。そこを通る方法が公開されています。" },
      { kind: "unpinned", text: "通る方法が特定の手法に結びつけられていない工程。" },
      { kind: "unpublished", text: "公開された文献がまだ満たしていない工程。" },
      { kind: "open", text: "開いた工程。その内側に描かれているのが、どう行われたかです。" },
      { kind: "feed", text: "その経路が必要とするが自身では作らないもの。外から受け取る材料です。" },
      { kind: "atlas", text: "これについてはリポジトリに記録があります。" },
    ],
    move: [
      "二本指で地図を動かします。ピンチ、または ctrl を押しながらスクロールで拡大縮小します。",
      "工程をクリックするとその場で開きます。ほかはすべてそのままです。",
      "名前をクリックすると、地図を離れずに記録の全文を読めます。",
      "矢印キーで移動、プラスとマイナスで拡大縮小、ゼロで元に戻ります。",
    ],
    claims: [
      "実線は、その二つの工程を結びつけた論文があり、その出典を保持していることを意味します。長い破線は、経路は記録されているものの、その工程を満たす手法が名指しされていないことを意味します。短い破線は、公開された文献がそこを満たしていないことを意味します。工程は実在し、通る方法がまだ書かれていません。",
      "工程の名前のうしろに付く回数 — ×T/h、×O(κ) — は、その経路がその工程を 1 回ではなく、その回数だけ実行することを表します。出典が用いている記号そのままであり、その記号が何を指すのか、また 1 回あたり何が費やされるのかはカードに記してあります。回数の付かない工程は、繰り返すと述べた出典を確認できていない工程であって、1 回だけ実行するという意味ではありません。",
      "淡い帯の上で、別の線の下に入れ子で描かれている線は、その上の線をより狭めた版です。構成は同じで、それを再解析または再調整したものであり、埋める工程も同じです。二つの線が同一の内部を描きながらなお別の項目である理由がこれです。帯の外にある線は、隣接するものの版ではなく、それに代わる選択肢です。",
      "この地図は欠落を隠しません。空の工程は空の工程として描かれます。",
    ],
    gaps: [
      "この地図が扱うのはアルゴリズムの文献です。リポジトリが扱うのは回路とプリミティブです。両者の重なりは思うより小さく、ある手法に記録がない場合は、空白のままにせず、その頁でそう述べます。",
      "ここに名前のあるもののうち記録があるものは、その名前から直接その記録へ行けます。",
    ],
    display: "表示",
    elsewhere: "サイト内の他のページ",
  },
};

// Everything the keyboard can land on. Copied from `account-modal.tsx:29-30`,
// which is the reference focus trap in this repo; `[tabindex="-1"]` is
// programmatic-only focus (the dialog shell itself) and must not be a Tab stop.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const TITLE_ID_PREFIX = "mj-map-info-title-";

/**
 * A legend mark, drawn with the canvas's own class names and the canvas's own
 * geometry.
 *
 * `lane` is `legendMark().outline` from `converge-layout.ts`, passed in from the
 * server rather than imported here — the layout module is large and this is a
 * client component, and the point of `legendMark` is that one function produces
 * the shape for both the figure and the key. Writing the path out by hand is
 * exactly the bug the old `KeyMark` shipped: three swatches drawing a lens the
 * canvas had stopped drawing, in a key whose own comment forbade it.
 */
function LegendMark({ kind, lane }: { kind: LegendKind; lane: string }): React.ReactElement {
  const common = { width: 34, height: 18, viewBox: "0 0 34 18", "aria-hidden": true } as const;
  if (kind === "terminal" || kind === "inner") {
    return (
      <svg className="mj-strand-legend-mark mj-converge-key" {...common}>
        <g className={`mj-converge-hub mj-converge-hub--${kind}`}>
          <circle className="mj-converge-dot" cx="17" cy="9" r={kind === "terminal" ? 6 : 4} />
        </g>
      </svg>
    );
  }
  if (kind === "atlas") {
    return (
      <svg className="mj-strand-legend-mark mj-converge-key" {...common}>
        <g className="mj-converge-lane mj-converge-lane--recorded mj-converge-lane--atlas">
          <text className="mj-converge-lane-name" x="17" y="13" textAnchor="middle">
            abc
          </text>
        </g>
      </svg>
    );
  }
  // An opened lane is the one mark whose shape is not `legendMark().outline`:
  // the canvas swaps the filled body for a `mj-converge-spine`, and the two are
  // never drawn together. A straight run is honest here — the spine's curve
  // belongs to whatever the lane's own geometry was, and this swatch is 34px
  // wide, so a bowed 34px path would say something about the shape that the
  // figure does not.
  if (kind === "open") {
    return (
      <svg className="mj-strand-legend-mark mj-converge-key" {...common}>
        <g className="mj-converge-lane mj-converge-lane--recorded">
          <path className="mj-converge-spine" d="M4 9 H30" />
        </g>
      </svg>
    );
  }
  // An ingredient hangs off the belly rather than lying along it, so it is the
  // one mark drawn across the swatch instead of through it.
  if (kind === "feed") {
    return (
      <svg className="mj-strand-legend-mark mj-converge-key" {...common}>
        <g className="mj-converge-lane mj-converge-lane--recorded">
          <path className="mj-converge-strand-body" d="M4 5 H30" />
          <line className="mj-converge-feed-line" x1="17" y1="5" x2="17" y2="16" />
        </g>
      </svg>
    );
  }
  return (
    <svg className="mj-strand-legend-mark mj-converge-key" {...common}>
      <g className={`mj-converge-lane mj-converge-lane--${kind}`}>
        <path className="mj-converge-strand-body" d={lane} />
      </g>
    </svg>
  );
}

export function MapInfoPopup({
  locale,
  section,
  sectionHrefs,
  closeHref,
  laneMark,
  sizeControl,
}: {
  locale: PublicLocale;
  /** Which section `?about=` names, or null for a shut box. */
  section: MapAboutSection | null;
  /** One address per section, built server-side so this component builds no URLs. */
  sectionHrefs: Record<MapAboutSection, string>;
  closeHref: string;
  /** `legendMark().outline` — the shape the canvas itself draws. */
  laneMark: string;
  /** The named size rungs, rendered on the server; see §3 below for why here. */
  sizeControl: ReactNode;
  // `withRecord` and `total` were props until session 110. They fed one
  // sentence — "N of the M things named on this map have a record in the
  // repository" — which the owner asked to lose along with every other number
  // in this box. They are removed rather than left unused, because a prop
  // nothing reads is a fact the caller still computes and a later session still
  // has to reason about. `repository-preface.tsx` states the rule that governed
  // them and still governs any number that comes back: counted, never typed.
}): React.ReactElement {
  const copy = COPY[locale];
  const shell = PUBLIC_SHELL_COPY[locale];
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const open = section !== null;
  // Controlled, not a bare `open` attribute. React keeps `<details open>` in
  // sync on every render, so an uncontrolled one would spring back open the
  // moment a section link re-rendered this component — the reader collapses the
  // sidebar, clicks a section, and finds it expanded again. Initial `true`
  // means the server-rendered markup carries `open`, so a reader with no
  // JavaScript gets an expanded list they can still collapse natively.
  const [navOpen, setNavOpen] = useState(true);

  // Shutting the box from the keyboard or the backdrop, where there is no
  // anchor for `CanvasContinuity` to rewrite. Read off `window.location` rather
  // than using `closeHref`, and the difference is measurable: `InfiniteCanvas`
  // writes the live viewport into the URL with a debounced `replaceState`, so
  // after a pan the server-rendered `closeHref` names somewhere the reader is
  // no longer standing. Pressing Escape would teleport the map.
  const closeRef = useRef<() => void>(() => undefined);
  closeRef.current = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("about");
    router.push(`${url.pathname}${url.search}`, { scroll: false });
  };

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Who to hand focus back to — normally the info button in the overlay,
    // which carries `[data-modal-return-focus]` for the case where the opener
    // was something else (a link somebody followed straight into `?about=`).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const reachable = (element: HTMLElement) =>
      element.getClientRects().length > 0 && !element.closest("[inert]");
    const focusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(reachable);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Capture phase and stopPropagation, same as `account-modal.tsx:72-78`:
        // the canvas under this box has its own keydown handler, and arrow keys
        // and zero pan and reset it. Escape belongs to the box while it is up.
        event.stopPropagation();
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const stops = focusable();
      if (stops.length === 0) {
        // Nothing to move to. Refusing the keystroke is still better than
        // letting Tab walk out into the map behind an aria-modal dialog.
        event.preventDefault();
        return;
      }
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      const active = document.activeElement;
      const inside = active instanceof Node && dialog.contains(active) && active !== dialog;
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    // preventScroll: the map behind is a fixed-height canvas and the box is
    // `position: fixed`, so there is nothing that should move when focus lands.
    dialog.focus({ preventScroll: true });

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      // `!== document.body` is the part `account-modal.tsx` does not need and
      // this does. That modal is only ever reached by clicking something, so
      // its opener is always a real element. This box has an address, so a
      // reader can arrive on `?about=…` with it already open and nothing
      // focused — `document.activeElement` is then `<body>`, which is connected
      // and not inert, so without this test the first branch would take it,
      // call `.focus()` on an unfocusable element, and silently do nothing.
      //
      // **Measured, and honestly only half-confirmed.** Opened by a click and
      // closed by Escape, focus comes back to the information icon: checked on
      // `next start`, `document.activeElement` carrying
      // `[data-modal-return-focus]` afterwards. Opened by *arriving on the URL*
      // and closed by Escape, focus lands on `<body>` instead — the box's own
      // shell had focus, the backdrop went `hidden` underneath it, and the
      // browser dropped focus without firing a single `focusout`, which is what
      // a window that does not itself have focus does. In that state a
      // `.focus()` call on the fallback produces no event either, so the
      // measurement cannot separate "the call did nothing" from "the
      // environment reported nothing".
      //
      // Left as a plain fallback rather than chased with a `setTimeout` racing
      // the router's own focus handling, which can steal focus from whatever
      // the reader touched next. The cost if it really is landing on `<body>`
      // is one Tab: `.mj-map-overlay` is the first thing in the document, so
      // the next stop is the back arrow and the one after it is this control.
      if (opener && opener !== document.body && opener.isConnected && !opener.closest("[inert]")) {
        opener.focus();
        return;
      }
      document.querySelector<HTMLElement>("[data-modal-return-focus]")?.focus();
    };
    // `open`, not `section`: keyed on the section this would steal focus back
    // to the dialog shell every time the reader clicked a section in the
    // sidebar, losing their place in the list they are reading from.
  }, [open]);

  const titleId = `${TITLE_ID_PREFIX}${section ?? MAP_ABOUT_SECTIONS[0]}`;

  const siteLinks: { href: string; label: string }[] = [
    { href: "/", label: shell.nav.product },
    { href: "/repository", label: shell.nav.repository },
    { href: "/workspace", label: shell.nav.workspace },
    { href: "/pricing", label: shell.nav.pricing },
    { href: "/contact", label: shell.nav.contact },
    { href: "/privacy", label: shell.footer.privacy },
    { href: "/terms", label: shell.footer.terms },
  ];

  return (
    <div
      className="mj-map-info-backdrop"
      role="presentation"
      hidden={!open}
      // mousedown, not click: a drag that STARTS inside the box (selecting a
      // sentence) and ends over the backdrop fires `click` on the backdrop, and
      // would dismiss a panel the person was reading. `account-modal.tsx:144`
      // records the same measurement.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      <div
        className="mj-map-info"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
      >
        <a className="mj-icon-button mj-map-info-close" href={closeHref} aria-label={copy.close} title={copy.close}>
          ×
        </a>

        <p className="mj-map-info-eyebrow">{copy.eyebrow}</p>

        <div className="mj-map-info-layout">
          <details
            className="mj-map-info-nav"
            open={navOpen}
            onToggle={(event) => setNavOpen(event.currentTarget.open)}
          >
            <summary>{copy.sectionsLabel}</summary>
            <nav aria-label={copy.sectionsLabel}>
              <ul>
                {MAP_ABOUT_SECTIONS.map((id) => (
                  <li key={id}>
                    {id === section ? (
                      <strong aria-current="true">{copy.sections[id]}</strong>
                    ) : (
                      <a href={sectionHrefs[id]}>{copy.sections[id]}</a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          </details>

          {/* The scroll container is this inner element rather than the dialog
              shell, so the close button stays pinned while a long section moves
              under it. That makes it a scrollable region a keyboard user has to
              be able to reach — hence the tabIndex and a name of its own,
              without which arrow-key scrolling would have no way to get here. */}
          <div className="mj-map-info-body" role="region" aria-labelledby={titleId} tabIndex={0}>
            {/* All five sections render on every response, and four of them
                are `hidden`. It costs about 4 KB and buys three things: `curl`
                and a crawler get the whole explanation whatever `?about=` says,
                the named size rungs below never leave the document, and
                switching section is a paint rather than a fetch for anyone who
                has the page already. */}
            <section
              className="mj-map-info-section"
              hidden={section !== "what-this-is"}
            >
              <h2 id={`${TITLE_ID_PREFIX}what-this-is`}>{copy.sections["what-this-is"]}</h2>
              {copy.whatThisIs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>

            <section
              className="mj-map-info-section"
              hidden={section !== "how-to-read-it"}
            >
              <h2 id={`${TITLE_ID_PREFIX}how-to-read-it`}>{copy.sections["how-to-read-it"]}</h2>
              {/* Drawn, not described. The marks are the ones the canvas draws,
                  at the size it draws them, each beside one sentence — a legend
                  that names a shape in words is a second description of a
                  picture and drifts away from it. */}
              <ul className="mj-strand-legend mj-map-info-legend">
                {copy.legend.map((row) => (
                  <li key={row.kind}>
                    <LegendMark kind={row.kind} lane={laneMark} />
                    <span>{row.text}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section
              className="mj-map-info-section"
              hidden={section !== "how-to-move-around"}
            >
              <h2 id={`${TITLE_ID_PREFIX}how-to-move-around`}>{copy.sections["how-to-move-around"]}</h2>
              <ul className="mj-map-info-list">
                {copy.move.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {/* The named sizes live here and nowhere else on the surface.
                  D88.2 is that a named size has to stay addressable because it
                  is the only zoom a reader without JavaScript, a printout or
                  `curl` can reach — and this box is the one place left on a
                  chrome-less map where such a reader can still click one.
                  Following a rung shuts the box, which is correct: a reader who
                  has just chosen a size wants to see the map at it. */}
              {sizeControl}
            </section>

            <section
              className="mj-map-info-section"
              hidden={section !== "what-a-line-claims"}
            >
              <h2 id={`${TITLE_ID_PREFIX}what-a-line-claims`}>{copy.sections["what-a-line-claims"]}</h2>
              {copy.claims.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>

            <section
              className="mj-map-info-section"
              hidden={section !== "not-here-yet"}
            >
              <h2 id={`${TITLE_ID_PREFIX}not-here-yet`}>{copy.sections["not-here-yet"]}</h2>
              {copy.gaps.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          </div>
        </div>

        {/* The theme and language controls, which left with the page chrome.
            `data-theme` is stamped on `<html>` by `app/layout.tsx` and the
            locale cookie is read on the server, so neither of them *broke* when
            the header went — what a reader on this surface lost is the
            controls, and this is where they are now. The site links are here
            for the same reason: the map has one back arrow and no nav, and
            every address the old footer emitted still has to be reachable from
            the page that used to emit it. */}
        <footer className="mj-map-info-footer">
          <div className="mj-map-info-settings">
            <span className="mj-map-info-footer-label">{copy.display}</span>
            <LanguageToggle locale={locale} />
            <ThemeToggle locale={locale} />
          </div>
          <nav className="mj-map-info-elsewhere" aria-label={copy.elsewhere}>
            <span className="mj-map-info-footer-label">{copy.elsewhere}</span>
            {siteLinks.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
        </footer>
      </div>
    </div>
  );
}
