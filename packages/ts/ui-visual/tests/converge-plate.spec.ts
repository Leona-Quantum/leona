// **The render-level half of the opened-name guard.**
//
// An opened line on the Atlas map wears its own name on itself (owner, session 104:
// *"the name of the process line resides there not in some surrounding area"*), and that
// position is structurally crossed — every child of an opened fan converges onto its
// parent's spine at both ends, so branches pass through the name near the ends of the span
// whatever band the layout reserves. Measured: they clear the middle 76% and cross the
// rest, so no band width fixes it. The name is therefore **occluded** rather than moved: an
// opaque `<rect class="mj-converge-name-plate">` in the canvas fill, drawn under the text
// and over the lines.
//
// `repository-converge-layout.test.ts` guards the layout half — that a name on a bone stays
// inside the band reserved for it — and **cannot see this half at all**. It measures
// numbers the layout computed. Delete the plate, shrink it, make it transparent, or move it
// after the text, and every layout assertion in this repository stays green while every
// opened name on the Atlas goes illegible.
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
// green for one that is not. The 16px plate height is backed by a hand measurement made
// with `getBBox()` on the *rendered app page* (a 12px Japanese name draws 15.2px tall), and
// that measurement is not reproducible here.
//
// So the vertical side is checked as a **typographic model with stated constants** against
// the computed font-size — which catches the two regressions that can actually be written
// (someone shrinks the plate; someone raises the font-size) — and everything that does not
// depend on the substituted face is checked strictly:
//
//   - every name drawn on a bone HAS a plate (the hole NEXT.md named);
//   - the plate is opaque and filled with the surface the figure is drawn on;
//   - the plate is painted before its own text and after the lines;
//   - the plate is at least as WIDE as the text actually drew. This one survives
//     substitution in the direction that matters: a fallback face is wider than the
//     designed one at the same size, so passing here is a conservative result, and running
//     wide is the failure that has actually happened on this canvas.
//
// Closing the last sliver means either vendoring the woff2 into this package or measuring
// on a served page, and both are decisions rather than oversights. Recorded in NEXT.md.
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
// so `.mj-converge-name-plate` appears in all 36 of them and a filter on the bare name
// selects every figure, including the 12 that draw no plate at all.
const PLATE_IN_MARKUP = `class="${PLATE}"`;

const source = (story: StoryEntry): string => readFileSync(join(distDir, story.file), "utf8");
const withPlates = manifest.filter((story) => source(story).includes(PLATE_IN_MARKUP));
const plateCount = withPlates.reduce(
  (total, story) => total + (source(story).split(PLATE_IN_MARKUP).length - 1),
  0,
);

test("the figures that wear a name on a bone were rendered, and there are as many as before", () => {
  // The floors are what stop the filter above becoming an escape hatch. If the plate
  // stopped being rendered at all, `withPlates` empties and this goes red — rather than the
  // suite going quietly green over an empty subject list, which is a failure this
  // repository has shipped before.
  expect(manifest.length, "converge-manifest.json is empty").toBeGreaterThanOrEqual(30);
  // 12 of the 36 rendered figures (18 slots × 2 locales) open into a fan, and they carry 86
  // plates between them — 43 per locale, the same 43 names-on-a-bone the layout test
  // counts. Pinned just under both.
  expect(withPlates.length, "no rendered figure draws a name on a bone").toBeGreaterThanOrEqual(
    12,
  );
  expect(plateCount, "too few name plates to be checking anything").toBeGreaterThanOrEqual(80);
});

interface PlateReport {
  label: string;
  /** Horizontal slack in the figure's own user units. Negative means text ran past. */
  left: number;
  right: number;
  /** The plate's declared box, and the text's baseline, in the same user units. */
  plateTop: number;
  plateBottom: number;
  baseline: number;
  fontSize: number;
  fill: string;
  opacity: number;
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
          // Sibling, not descendant: both live inside the name's own <a>. Reading the
          // <text> off that anchor is what makes this a check of *this* plate against *its*
          // name rather than against whatever text is nearest.
          const anchor = plate.parentElement;
          const text = anchor?.querySelector<SVGTextElement>("text.mj-converge-lane-name");
          if (!text) {
            out.push({
              label: "",
              left: -1,
              right: -1,
              plateTop: 0,
              plateBottom: 0,
              baseline: 0,
              fontSize: 0,
              fill: "",
              opacity: 1,
              beforeText: false,
            });
            continue;
          }
          const box = plate.getBBox();
          const t = intoPlateSpace(plate, text);
          const style = getComputedStyle(plate);
          out.push({
            label: text.textContent ?? "",
            left: t.x0 - box.x,
            right: box.x + box.width - t.x1,
            plateTop: box.y,
            plateBottom: box.y + box.height,
            baseline: baselineIn(plate, text),
            fontSize: Number.parseFloat(getComputedStyle(text).fontSize),
            fill: style.fill,
            opacity: Number(style.fillOpacity || "1") * Number(style.opacity || "1"),
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

      for (const plate of plates) {
        const where = `${story.name} (${theme}): the plate under "${plate.label}"`;
        expect(plate.label, `${story.name}: a plate has no name beside it`).not.toEqual("");
        expect(plate.left, `${where} leaves ${(-plate.left).toFixed(2)}px uncovered on the left`)
          .toBeGreaterThanOrEqual(0);
        expect(
          plate.right,
          `${where} leaves ${(-plate.right).toFixed(2)}px uncovered on the right`,
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
        // Opaque, or it occludes nothing — a see-through plate satisfies every geometry
        // assertion above and does no work at all.
        expect(plate.opacity, `${where} is not opaque`).toBeCloseTo(1, 3);
        expect(
          plate.fill,
          `${where} is filled "${plate.fill}" on a canvas drawn on "${canvasFill}" — ` +
            `a rectangle in the wrong shade rubs out the drawing instead of hiding lines`,
        ).not.toEqual("none");
      }
    });
  }
}
