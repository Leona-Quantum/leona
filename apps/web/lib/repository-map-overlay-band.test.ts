import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * `/repository/layers?focus=<slot>` draws its figure flush to
 * `.mj-canvas-layer`'s own (0, 0), and `.mj-map-overlay`'s three controls
 * (back, info, expand-all) sit `position: absolute` over that same corner.
 * Measured on production at 1438px, fetching each figure's rendered HTML and
 * intersecting every `<text>` box with the controls' rectangle: 23 of 28
 * figures had their first label's ink under an opaque button, from 11px
 * ("Multistep, all-at-once") to 72px ("Quantum volume", reading as "volume").
 * It is occlusion, not truncation — `curl` and the DOM both carry the whole
 * string — so no test that reads rendered text content ever saw it.
 *
 * jsdom does not do layout: an assertion phrased as "`getBoundingClientRect`
 * says the boxes do not overlap" reports every box at (0, 0, 0, 0) and passes
 * whether or not the CSS reserves any room at all. This asserts the
 * geometric relationship directly from `styles.css` instead — the honest
 * form is the inequality, not the constant, so a deliberate future resize of
 * the rail does not need this test edited too:
 *
 *     the resting top of the canvas content is at or below
 *     the bottom of the control rail
 */

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(webRoot));

function read(...segments: string[]): string {
  return readFileSync(join(...segments), "utf8");
}

const tokens = read(repoRoot, "packages", "ts", "ui", "tokens.css");
const styles = read(repoRoot, "packages", "ts", "ui", "styles.css");

/** A `--sp-N: <num>px;` token's pixel value, from `tokens.css`. Throws on a
 * name that was renamed or removed, rather than silently comparing against
 * `NaN`. */
function spacingToken(name: string): number {
  const match = tokens.match(new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)px`));
  if (!match) throw new Error(`tokens.css: no --${name} definition found`);
  return Number(match[1]);
}

/** One CSS rule's declaration block — `selector { ... }`, found anywhere in
 * `styles.css` — as a plain string. `styles.css` uses no nested rules, so a
 * non-greedy match up to the first `}` after the selector is exactly that
 * rule's own declarations, not a rule it happens to contain. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`styles.css: no rule found for "${selector}"`);
  return match[1];
}

/**
 * A `calc(...)` expression built only from `+` and terms of the shape
 * `var()` wrapping a `--sp-*` spacing token, or a literal `Npx` — the shape
 * `--map-overlay-band` is written in — evaluated against the token values
 * read from `tokens.css`.
 *
 * Deliberately narrow rather than a general CSS calc() evaluator: an
 * expression this cannot parse throws instead of silently mis-evaluating,
 * so a change to the formula's shape fails this test loudly rather than
 * comparing against a number nobody meant.
 */
function evalSpacingCalc(expr: string): number {
  return expr
    .split("+")
    .map((term) => term.trim())
    .reduce((total, term) => {
      const varMatch = term.match(/^var\(--(sp-\d+)\)$/);
      if (varMatch) return total + spacingToken(varMatch[1]);
      const pxMatch = term.match(/^(\d+(?:\.\d+)?)px$/);
      if (pxMatch) return total + Number(pxMatch[1]);
      throw new Error(`unrecognised calc() term: "${term}"`);
    }, 0);
}

test("the map surface reserves at least the control rail's own height before drawing content", () => {
  // `.mj-map-overlay`'s inset and `.mj-map-overlay-button`'s size — the rail's
  // own footprint, at rest, measured from the same tokens the rail is built
  // from rather than retyped as a constant.
  const railHeight = spacingToken("sp-4") + spacingToken("sp-8");

  // On the VIEWPORT, which is outside `InfiniteCanvas`'s pan/zoom transform —
  // not on `.mj-canvas-layer`, which is inside it. Padding on the layer is in
  // the layer's own coordinates, so the transform scales it while the rail stays
  // at fixed screen size: measured on production, a 56px reservation on the
  // layer holds at zoom 1 and 0.75 and fails at 0.5 (content top 28px, rail
  // bottom 48px) and 0.3 (17px). Asserting the selector, not just the
  // declaration, is what keeps that regression from coming back silently.
  const viewportBody = ruleBody(".mj-map-shell .mj-canvas-viewport");
  assert.match(
    viewportBody,
    /padding-top:\s*var\(--map-overlay-band\)/,
    "expected `.mj-map-shell .mj-canvas-viewport` to reserve `var(--map-overlay-band)` as padding-top, " +
      "so the reservation is in screen pixels at every zoom rather than shrinking with the canvas",
  );
  assert.doesNotMatch(
    styles,
    /\.mj-map-shell \.mj-canvas-layer\s*\{[^}]*padding-top/,
    "the reservation must not sit on `.mj-canvas-layer` — inside the pan/zoom transform it " +
      "scales away when the reader zooms out, and the rail does not",
  );

  const shellBody = ruleBody(".mj-map-shell");
  // Greedy `.*` up to the LAST `)`, not `[^)]*` up to the first: the formula
  // itself is made of `var()` calls wrapping the `--sp-*` tokens, each with
  // its own closing paren before the one that closes `calc(...)`.
  const calcMatch = shellBody.match(/--map-overlay-band:\s*calc\((.*)\)/);
  assert.ok(
    calcMatch,
    "expected `.mj-map-shell` to define `--map-overlay-band` as a calc() over the rail's own tokens",
  );
  const band = evalSpacingCalc(calcMatch![1]);

  assert.ok(
    band >= railHeight,
    `reserved band (${band}px) must be at least the rail's own height ` +
      `(${railHeight}px = --sp-4 inset + --sp-8 button), or the canvas's ` +
      `content still starts under the controls at rest`,
  );
});

test("the button and the band read one token, not two independent copies of the same number", () => {
  // A literal `32px` on the button would happen to equal `--sp-8` today and
  // say nothing about whether it still would after either one changed —
  // exactly the second-writer drift `--map-overlay-band`'s own comment warns
  // against.
  const buttonBody = ruleBody(".mj-map-overlay-button");
  assert.doesNotMatch(buttonBody, /(?:width|height):\s*32px/);
  assert.match(buttonBody, /width:\s*var\(--sp-8\)/);
  assert.match(buttonBody, /height:\s*var\(--sp-8\)/);
});

test("print collapses the reservation along with the controls it exists for", () => {
  // **Brace-counted, not regex-delimited.** A non-greedy `([\s\S]*?)\n\}` ends
  // at the first `}` that starts a line, which today is the media block's own
  // closer only because every rule inside it happens to be indented — one
  // reformat and the block silently becomes the first nested rule, and both
  // assertions below would then be searching the wrong text. Counting braces
  // says what is meant.
  // Anchored to the start of a line, because the plain string also occurs
  // inside a comment further up ("`@media print` reveals it too") and
  // `indexOf` finds that one first — which is how the first version of this
  // test ended up brace-counting from the middle of a comment and asserting
  // against `.mj-map-reading`'s body.
  const atRule = /^@media print\s*\{/m.exec(styles);
  assert.ok(atRule, "expected an @media print block in styles.css");
  const open = atRule.index;
  let depth = 0;
  let close = -1;
  for (let i = styles.indexOf("{", open); i < styles.length; i += 1) {
    if (styles[i] === "{") depth += 1;
    else if (styles[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  assert.notEqual(close, -1, "the @media print block never closes");
  const printBlock = styles.slice(open, close);

  assert.match(
    printBlock,
    /\.mj-map-overlay\s*\{[^}]*display:\s*none/,
    "the overlay controls should not print",
  );
  assert.match(
    printBlock,
    /\.mj-map-shell\s*\{[^}]*--map-overlay-band:\s*0/,
    "the reserved band is dead space on paper once the controls it was reserved for are gone — " +
      "it should collapse under print, not stay at its screen size",
  );
});
