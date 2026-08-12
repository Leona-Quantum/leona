// **The render-level half of the name-plate guard.**
//
// A name on the Atlas map is drawn on a plate — an `<rect class="mj-converge-name-plate">` in
// the canvas fill, painted over the lines and under the text — so that a line running through
// it does not make it unreadable.
//
// **Every name, since session 107** (owner: *"plate every name, but opened ones are fainter
// and within their lines"*). The split it replaces gave a plate to an opened line's name and
// none to a shut one's, which was an accident of when the plate was built rather than a
// decision: an opened name is structurally crossed by its own branches, and a shut one went
// without because a mostly-empty figure had nothing to cross it with. Measured over all 19
// figures × both locales, fully opened, 34 of 478 shut names already have a line through them.
//
// `repository-converge-layout.test.ts` guards the layout half — that a name on a bone stays
// inside the band reserved for it — and **cannot see this half at all**. It measures numbers
// the layout computed. Delete the plate, shrink it, make it transparent, or move it after the
// text, and every layout assertion in this repository stays green while every crossed name on
// the Atlas goes illegible.
//
// ---------------------------------------------------------------------------------------
// **What this file can prove, and what it cannot.**
//
// It cannot prove ink-level vertical coverage, and saying so is the point of this
// paragraph. `--font-ui` is `"Instrument Sans", system-ui, sans-serif`, and Instrument Sans
// arrives through `next/font/google` at *build* time. This harness renders from source with
// no Next by design (AGENTS.md), so the text here draws in whatever `system-ui` resolves to
// on the runner — and the substitute's metrics are not the app's. Measured: the same 12px
// string reports a 20.57px ascent in this harness against the ~9px the real face draws, so
// a strict ink containment check would be red for a plate that is correct in production and
// green for one that is not. The 17px plate height is backed by a hand measurement made
// with `getBBox()` on the *rendered app page* (a 12px Japanese name draws 15.2px tall), and
// that measurement is not reproducible here.
//
// **Nor can it gate on horizontal coverage, and the first version of this file was wrong
// about that.** It reasoned that a fallback face is wider at the same size, so measuring
// against one is conservative — true, and the wrong conclusion. Conservative means no false
// green; it does not mean no false red, and a false red is what arrived: this passed on
// macOS and failed on the Linux CI runner by up to 5.87px, on a plate that is correct.
// Worse, it cannot be fixed by vendoring the font either. Instrument Sans is a Latin face
// and every Japanese name on this map already falls back **in production**, to whatever the
// reader's own machine offers. Which face draws those names is not a property of this
// repository, so no assertion here can be a stable gate on their width.
//
// So the two font-dependent sides are handled the same way, and it is the split this file
// is actually about:
//
//   - **Vertical** — a typographic model with stated constants against the computed
//     font-size. Catches the two regressions anyone can write: someone shrinks the plate,
//     someone raises the font-size.
//   - **Horizontal** — measured every run and **printed, not asserted**. A shortfall shows
//     up in the CI log against the face that drew it, which is the honest form of a fact
//     that depends on the reader's machine. The engine side of it *is* guaranteed
//     arithmetically: the plate is `labelWidth + 10` and `labelWidth` is the same
//     `estimateTextWidth` the column was sized from, so a name can only overrun its plate
//     if that estimator is wrong about the real face — a production measurement, and one
//     the record shows was made by hand on the rendered page.
//
// Everything that does not depend on the substituted face is strict:
//
//   - every drawn name HAS a plate, and every plate has a name;
//   - a **shut** name's plate is fully opaque and filled with the surface the figure is
//     drawn on;
//   - an **opened** name's plate is fainter — the owner asked for it, so that the bone a
//     reader clicks to collapse still reads through its own name — but held above a floor,
//     because "fainter" with no floor is indistinguishable from "does nothing";
//   - every plate is painted before **every** name and after **every** line, which is the
//     whole occlusion rule on this canvas and is not visible from the layout side;
//   - the plate's box contains the name's baseline band.
// ---------------------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

interface StoryEntry {
  name: string;
  title: string;
  file: string;
}

const manifest: StoryEntry[] = JSON.parse(
  readFileSync(join(distDir, "converge-manifest.json"), "utf8"),
);

const PLATE = "mj-converge-name-plate";
// The *markup* form, not the bare class name: `styles.css` is inlined into every document,
// so `.mj-converge-name-plate` appears in all of them and a filter on the bare name selects
// every figure whether or not it draws a plate. Left open at the end of the class value
// rather than closed with a quote, because an opened name's plate carries a second class
// (`--open`) and `class="mj-converge-name-plate"` would silently select only the shut ones —
// which is the half this file least needs to check.
const PLATE_IN_MARKUP = `class="${PLATE}`;

const source = (story: StoryEntry): string => readFileSync(join(distDir, story.file), "utf8");
const withPlates = manifest.filter((story) => source(story).includes(PLATE_IN_MARKUP));
const plateCount = withPlates.reduce(
  (total, story) => total + (source(story).split(PLATE_IN_MARKUP).length - 1),
  0,
);

test("every rendered figure wears its names on plates, and there are as many as before", () => {
  // The floors are what stop the filter above becoming an escape hatch. If the plate
  // stopped being rendered at all, `withPlates` empties and this goes red — rather than the
  // suite going quietly green over an empty subject list, which is a failure this
  // repository has shipped before.
  expect(manifest.length, "converge-manifest.json is empty").toBeGreaterThanOrEqual(30);
  // **All 38 now, not 12 of 36.** Every one of the 19 slots × 2 locales draws at least one
  // name, and since session 107 every drawn name wears a plate — so a figure with no plate
  // in it is a figure that drew no name, which is itself a defect. 576 plates between them,
  // the same 576 the layout test counts as drawn labels at saturation. Pinned just under
  // both: these numbers only move when the graph does, and a drop is the thing to catch.
  expect(withPlates.length, "a rendered figure draws no name plate at all").toBeGreaterThanOrEqual(
    36,
  );
  // 540 until s121 (W17): the refinement fold took three variant lanes off the
  // shut figures (krovi, the improved kernel, LightSABRE) — ×2 locales = 6
  // plates fewer, a picture removed on purpose. Measured 534 on that change;
  // the floor moves with it so the next silent drop still trips.
  expect(plateCount, "too few name plates to be checking anything").toBeGreaterThanOrEqual(534);
});

/** Every `data-name` on an element with this class, in the order they are drawn. */
function keysOf(html: string, className: string): string[] {
  const pattern = new RegExp(`class="${className}[^"]*"\\s+data-name="([^"]*)"`, "g");
  return [...html.matchAll(pattern)].map((match) => match[1]!);
}

for (const story of withPlates) {
  test(`every name has a plate and every plate has a name — ${story.name}`, () => {
    // **Exact, not a floor**, and the difference matters: the counts above permit
    // two whole figures and thirty-six plates to vanish and still pass, because
    // they are pinned *under* the measurement so that graph growth does not turn
    // them red. That makes them a guard against the feature disappearing, not a
    // guard on this figure. This is the second one — the plate set and the name
    // set are compared element by element, so a single name losing its plate goes
    // red on the figure it happened on.
    const html = source(story);
    const plates = keysOf(html, PLATE);
    const names = keysOf(html, "mj-converge-lane-name");
    expect(names.length, `${story.name} draws no names`).toBeGreaterThan(0);
    expect(new Set(plates).size, `${story.name}: two plates claim one name`).toBe(plates.length);
    expect([...plates].sort(), `${story.name}: the plates and the names are different sets`).toEqual(
      [...names].sort(),
    );
  });
}

// The occlusion rule on this canvas, stated as a fact about the markup.
//
// SVG paints in document order, so a plate hides what was emitted before it and nothing
// else. That makes the ORDER of the three passes the whole of the feature, and nothing on
// the layout side can see it: `repository-converge-layout.test.ts` measures numbers the
// layout computed, and every one of them is identical whichever order these are drawn in.
//
// Both halves have a failable case that shipped. Before session 107 the plate sat inside the
// name's own `<a>`, one element per lane, so it was emitted *between* its lane's body and
// that lane's own branches — and a lane's branches are exactly the lines that cross its
// name. Measured on this graph fully opened, 12 of the 45 crossed names were crossed by a
// line drawn later, and no plate could ever have hidden those. Interleave the plates with
// the names instead and the other half breaks: a plate rubs out any earlier *name* it
// overlaps, which measured as 4 pairs.
//
// Read off the source rather than the DOM on purpose. It is the same claim, it needs no
// browser, and it runs over all 38 figures instead of the ones a `page.setContent` happens
// to reach.
const MARK = {
  body: 'class="mj-converge-strand-body',
  spine: 'class="mj-converge-spine',
  lineHit: 'class="mj-converge-strand-hit',
  plate: PLATE_IN_MARKUP,
  name: 'class="mj-converge-lane-name',
  hub: 'class="mj-converge-hub',
  dot: 'class="mj-converge-dot"',
};

for (const story of withPlates) {
  test(`plates are drawn after every line and before every name — ${story.name}`, () => {
    const html = source(story);
    const last = (needle: string) => html.lastIndexOf(needle);
    const first = (needle: string) => html.indexOf(needle);

    const firstPlate = first(MARK.plate);
    expect(firstPlate, `${story.name} draws no plate`).toBeGreaterThan(-1);
    const firstName = first(MARK.name);
    expect(firstName, `${story.name} draws no name`).toBeGreaterThan(-1);

    for (const [what, mark] of [
      ["a strand body", MARK.body],
      ["an opened line's spine", MARK.spine],
      ["a line's click target", MARK.lineHit],
    ] as const) {
      const lastLine = last(mark);
      if (lastLine === -1) continue;
      expect(
        lastLine,
        `${story.name}: ${what} is emitted after the first name plate, so it paints over a ` +
          `name the plate was supposed to clear`,
      ).toBeLessThan(firstPlate);
    }

    expect(
      last(MARK.plate),
      `${story.name}: a name plate is emitted after the first name, so it rubs out a name ` +
        `instead of the lines under one`,
    ).toBeLessThan(firstName);

    // **The last pass, so the contract is checked and not just its middle.** A
    // circle is the thing several lines share, so it sits on top of everything
    // including the names. Reordering it would leave the two assertions above
    // perfectly green.
    for (const mark of [MARK.hub, MARK.dot]) {
      const firstHub = first(mark);
      if (firstHub === -1) continue;
      expect(
        firstHub,
        `${story.name}: a state circle is emitted before the first name, so a name can be drawn ` +
          `over the circle several lines share`,
      ).toBeGreaterThan(firstName);
    }
  });
}

interface PlateReport {
  label: string;
  /** Horizontal slack against the drawn text. Negative means the text ran past. */
  left: number;
  right: number;
  /**
   * Horizontal slack against the name's own **hit target**, which is font-independent:
   * both rects are built from `lane.labelWidth` by two separately written expressions
   * (`+ 10` and `+ 8`). If the plate ever stops being the wider of the two there is
   * clickable area sitting over text nothing is occluding, and no font is involved in
   * saying so — which is why this side can be asserted and the text side cannot.
   */
  hitLeft: number;
  hitRight: number;
  /** The plate's declared box, and the text's baseline, in the same user units. */
  plateTop: number;
  plateBottom: number;
  baseline: number;
  fontSize: number;
  fill: string;
  opacity: number;
  /** An opened line's plate — the one the owner asked to be fainter. */
  open: boolean;
  /** Does the plate come before its own text in paint order? */
  beforeText: boolean;
}

// The band a name occupies relative to its baseline, as multiples of the font size.
// Deliberately generous of the real face (Instrument Sans draws about 0.75em above the
// baseline and 0.21em below at 12px) so this is a check on the *plate*, not a re-derivation
// of one substituted font's metrics.
const ASCENT = 0.85;
const DESCENT = 0.25;

for (const story of withPlates) {
  for (const theme of ["light", "dark"] as const) {
    test(`name plate covers its name — ${story.name} (${theme})`, async ({ page }) => {
      await page.setContent(source(story), { waitUntil: "load" });
      await page.evaluate((value) => {
        document.documentElement.setAttribute("data-theme", value);
      }, theme);
      await page.evaluate(() => document.fonts.ready);

      const plates: PlateReport[] = await page.evaluate((plateClass) => {
        // A box in the element's own space, expressed in the PLATE's space.
        //
        // Two wrong ways were tried first and both are worth naming. `getBBox()` on both,
        // compared directly: that is each element's *own* coordinate system, and the
        // `<text>` is positioned by a `transform` while the plate is positioned by `x`/`y`
        // — it reported a 420px shortfall on a correct plate. `getBoundingClientRect()` on
        // both: same space, sound comparison, but `.mj-converge-canvas` is `max-width:100%`
        // and a fully opened figure is ~25000px wide, so it paints at about 5% scale and
        // every number is sub-pixel — it reported an 8.6px shortfall that was rounding.
        const intoPlateSpace = (plate: SVGGraphicsElement, element: SVGGraphicsElement) => {
          const box = element.getBBox();
          const screen = plate.getScreenCTM();
          const own = element.getScreenCTM();
          if (!screen || !own) return { x0: box.x, x1: box.x + box.width };
          const m = screen.inverse().multiply(own);
          const xs = [box.x, box.x + box.width].flatMap((x) =>
            [box.y, box.y + box.height].map((y) => m.a * x + m.c * y + m.e),
          );
          return { x0: Math.min(...xs), x1: Math.max(...xs) };
        };
        const baselineIn = (plate: SVGGraphicsElement, text: SVGGraphicsElement) => {
          const screen = plate.getScreenCTM();
          const own = text.getScreenCTM();
          if (!screen || !own) return 0;
          const m = screen.inverse().multiply(own);
          // The <text> is drawn at y=0 in its own space, so its baseline is the
          // translation's y component once put into the plate's space.
          return m.f;
        };

        const out: PlateReport[] = [];
        for (const plate of document.querySelectorAll<SVGRectElement>(`.${plateClass}`)) {
          // Paired by `data-name`, which is the lane's key, because the plate and the text
          // are no longer relatives: the plate is drawn in a pass over every lane and the
          // name in the pass after it, so that no plate can rub out any name. Reading the
          // <text> off `plate.parentElement` — which is what this did while both sat inside
          // the name's own `<a>` — now finds the whole canvas and returns whichever name is
          // first in it, so every plate on a figure would be checked against one name and
          // 575 of the 576 checks would be nonsense that happened to pass or fail together.
          const key = plate.getAttribute("data-name");
          const anchor = key === null ? null : document.querySelector<SVGAElement>(
            `a:has(> text.mj-converge-lane-name[data-name="${CSS.escape(key)}"])`,
          );
          const text = anchor?.querySelector<SVGTextElement>("text.mj-converge-lane-name");
          if (!text) {
            out.push({
              label: "",
              left: -1,
              right: -1,
              hitLeft: -1,
              hitRight: -1,
              plateTop: 0,
              plateBottom: 0,
              baseline: 0,
              fontSize: 0,
              fill: "",
              opacity: 1,
              open: false,
              beforeText: false,
            });
            continue;
          }
          const box = plate.getBBox();
          const t = intoPlateSpace(plate, text);
          const hit = anchor?.querySelector<SVGRectElement>("rect.mj-converge-hit");
          const h = hit ? intoPlateSpace(plate, hit) : null;
          const style = getComputedStyle(plate);
          out.push({
            label: text.textContent ?? "",
            left: t.x0 - box.x,
            right: box.x + box.width - t.x1,
            hitLeft: h ? h.x0 - box.x : Number.NaN,
            hitRight: h ? box.x + box.width - h.x1 : Number.NaN,
            plateTop: box.y,
            plateBottom: box.y + box.height,
            baseline: baselineIn(plate, text),
            fontSize: Number.parseFloat(getComputedStyle(text).fontSize),
            fill: style.fill,
            opacity: Number(style.fillOpacity || "1") * Number(style.opacity || "1"),
            open: plate.classList.contains(`${plateClass}--open`),
            beforeText:
              (plate.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
          });
        }
        return out;
      }, PLATE);

      expect(plates.length, `${story.name} drew no name plate`).toBeGreaterThan(0);

      const canvasFill = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--bg-1").trim(),
      );
      // Named in the horizontal report below, so a shortfall in the log says which face
      // produced it rather than reading as a defect in the plate.
      const renderedFont = await page.evaluate(() => {
        const text = document.querySelector("text.mj-converge-lane-name");
        return text ? getComputedStyle(text).fontFamily : "unknown";
      });

      for (const plate of plates) {
        const where = `${story.name} (${theme}): the plate under "${plate.label}"`;
        expect(plate.label, `${story.name}: a plate has no name beside it`).not.toEqual("");
        // Printed, not asserted — see the header. The face that draws this string is chosen
        // by the machine, so a bar on the number would be a bar on the runner's font list.
        const short = Math.min(plate.left, plate.right);
        if (short < 0) {
          // eslint-disable-next-line no-console
          console.log(
            `  ↔ ${where} runs ${(-short).toFixed(2)}px past it in "${renderedFont}" ` +
              `(the app draws it in Instrument Sans, which this harness cannot load)`,
          );
        }
        // Font-independent, and therefore assertable: both rects are built from the same
        // `lane.labelWidth` by two separately written expressions (`+ 10` and `+ 8`). A
        // plate narrower than the click target for its own name means clickable area
        // sitting over text nothing is occluding.
        expect(
          plate.hitLeft,
          `${where} is ${(-plate.hitLeft).toFixed(2)}px narrower on the left than the click ` +
            `target for the same name`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          plate.hitRight,
          `${where} is ${(-plate.hitRight).toFixed(2)}px narrower on the right than the click ` +
            `target for the same name`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          plate.baseline - plate.fontSize * ASCENT,
          `${where} starts ${plate.plateTop.toFixed(2)} against a name reaching ` +
            `${(plate.baseline - plate.fontSize * ASCENT).toFixed(2)} above its baseline`,
        ).toBeGreaterThanOrEqual(plate.plateTop);
        expect(
          plate.baseline + plate.fontSize * DESCENT,
          `${where} ends ${plate.plateBottom.toFixed(2)} against a name reaching ` +
            `${(plate.baseline + plate.fontSize * DESCENT).toFixed(2)} below its baseline`,
        ).toBeLessThanOrEqual(plate.plateBottom);
        // Painted before its text, or it rubs out the very name it exists to reveal.
        expect(plate.beforeText, `${where} is painted after the name it should sit under`).toBe(
          true,
        );
        // **Two bars, because the owner asked for two kinds of plate.**
        //
        // A **shut** name sits out on open canvas with its own strand well clear of it, so
        // its plate hides other people's lines and nothing else — opaque, or it occludes
        // nothing and satisfies every geometry assertion above while doing no work at all.
        //
        // An **opened** name sits on its own bone, and the owner asked for *"opened ones
        // fainter and within their lines"*: an opaque plate there cuts the dotted line a
        // reader has to find and click to collapse, exactly where it is most findable. So
        // the bone reads through its own name. Floored rather than pinned, because the
        // amount is a taste call and the failure to catch is the drift to nothing — a plate
        // at 0.1 looks deliberate in a diff and is illegible on the page.
        if (plate.open) {
          expect(
            plate.opacity,
            `${where} is an opened name's plate at ${plate.opacity.toFixed(2)} — faint enough ` +
              `that it stops occluding the lines it exists to hide`,
          ).toBeGreaterThanOrEqual(0.7);
          expect(
            plate.opacity,
            `${where} is an opened name's plate and is fully opaque — the owner asked for ` +
              `these to be fainter than a shut name's so the bone reads through its own name`,
          ).toBeLessThan(1);
        } else {
          expect(plate.opacity, `${where} is not opaque`).toBeCloseTo(1, 3);
        }
        expect(
          plate.fill,
          `${where} is filled "${plate.fill}" on a canvas drawn on "${canvasFill}" — ` +
            `a rectangle in the wrong shade rubs out the drawing instead of hiding lines`,
        ).not.toEqual("none");
      }
    });
  }
}

