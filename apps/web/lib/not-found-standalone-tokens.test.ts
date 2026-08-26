/**
 * Keeps the in-segment 404's hard-coded palette honest — ai-ops issue 188.
 *
 * `public/not-found.css` is the second file in `apps/web` allowed to carry raw
 * hex colours (`scripts/check-raw-hex.mjs`), because the page it styles renders
 * into a document Next synthesises with an empty `<head>`: no `globals.css`, so
 * no `tokens.css`, so `var(--bg-0)` there is not a colour but nothing at all.
 *
 * The exemption on its own recreates exactly what the token gate exists to
 * prevent — a palette free to drift from the product's, on a surface nobody
 * looks at, because you only reach it by mistyping a URL. So the literals are
 * checked here instead.
 *
 * This is deliberately stricter than the Open Graph card's equivalent
 * (`opengraph-tokens.test.ts`). The card is always dark, so it compares against
 * ONE theme. This sheet ships THREE blocks — light, the OS dark block, and the
 * explicitly-chosen dark block — so a drift in any one of them is its own bug
 * and each has to fail on its own.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const TOKENS = resolve(repoRoot, "packages/ts/ui/tokens.css");
const SHEET = resolve(here, "../public/not-found.css");

/**
 * tokens.css declares each name more than once: a light value on bare `:root`,
 * then a dark one under `[data-theme="dark"]` and again under
 * `prefers-color-scheme: dark`. FIRST is the light value, LAST is the dark one.
 *
 * This comment used to justify taking the LAST on the grounds that "this page
 * has no theme script and so no `data-theme` attribute to key on". That was
 * false, and a dark 404 shipped to readers who had chosen light — the standalone
 * component runs in the browser and reads `majorana.theme.v1` itself. Taking the
 * last still happens to be right, but for a different reason: tokens.css's two
 * dark blocks carry the same values, so either is the dark palette. If they ever
 * diverge, this function is where to decide which one a 404 should copy.
 */
function themeTokens(css: string, name: string): { light: string; dark: string } {
  const matches = [...css.matchAll(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`, "g"))];
  assert.ok(matches.length > 0, `--${name} is not declared in tokens.css at all`);
  assert.ok(
    matches.length > 1,
    `--${name} is declared once in tokens.css, so there is no dark value to compare against`,
  );
  return {
    light: matches[0][1].toLowerCase(),
    dark: matches[matches.length - 1][1].toLowerCase(),
  };
}

/** The value of a `--nf-*` custom property inside a given block of the sheet. */
function nfValue(block: string, name: string): string | undefined {
  return block.match(new RegExp(`--nf-${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`))?.[1]?.toLowerCase();
}

/**
 * The sheet's three palettes.
 *
 * `dark` is the OS block — `@media (prefers-color-scheme: dark)`, whose selector
 * must stay guarded with `:not([data-theme="light"])` or a reader who chose light
 * on a dark OS gets a dark 404, which is the bug this file now pins.
 * `chosenDark` is the block an explicit `data-theme="dark"` selects, for a reader
 * who chose dark on a light OS. `light` is everything before either of them.
 */
function sheetBlocks(): { light: string; dark: string; chosenDark: string } {
  const source = readFileSync(SHEET, "utf8");
  const at = source.indexOf("@media (prefers-color-scheme: dark)");
  assert.notEqual(
    at,
    -1,
    "public/not-found.css no longer has a prefers-color-scheme block — a reader in dark mode " +
      "who has chosen no theme would get the light palette on a page that has no theme script.",
  );
  const end = source.indexOf("}\n}", at);
  assert.notEqual(end, -1, "could not find the end of the dark block in public/not-found.css");
  const osBlock = source.slice(at, end);

  assert.ok(
    /\.mj-nf:not\(\[data-theme="light"\]\)/.test(osBlock),
    'the prefers-color-scheme block in public/not-found.css no longer guards on ' +
      ':not([data-theme="light"]). Without the guard a reader who chose LIGHT on Leona and ' +
      "whose OS is dark gets a dark 404 — measured on production; see ai-ops issue 189.",
  );

  const chosenAt = source.indexOf('.mj-nf[data-theme="dark"]', end);
  assert.notEqual(
    chosenAt,
    -1,
    'public/not-found.css no longer has a .mj-nf[data-theme="dark"] block. Without it a reader ' +
      "who chose DARK on Leona and whose OS is light gets a light 404.",
  );
  const chosenEnd = source.indexOf("\n}", chosenAt);
  assert.notEqual(chosenEnd, -1, 'could not find the end of the [data-theme="dark"] block');

  return { light: source.slice(0, at), dark: osBlock, chosenDark: source.slice(chosenAt, chosenEnd) };
}

// `--nf-*` in public/not-found.css -> the token in tokens.css it copies.
const PALETTE = [
  ["bg", "bg-0"],
  ["panel", "bg-1"],
  ["border", "border-0"],
  ["text", "text-0"],
  ["muted", "text-1"],
  ["accent", "accent"],
  ["accent-press", "accent-press"],
] as const;

test("the standalone 404's light palette still matches tokens.css", () => {
  const css = readFileSync(TOKENS, "utf8");
  const { light } = sheetBlocks();
  for (const [nf, token] of PALETTE) {
    const declared = nfValue(light, nf);
    assert.ok(declared, `--nf-${nf} is no longer declared in public/not-found.css`);
    assert.equal(
      declared,
      themeTokens(css, token).light,
      `--nf-${nf} is ${declared} but --${token} is now ${themeTokens(css, token).light} in ` +
        "tokens.css. That page loads no stylesheet of ours, so the literal has to be updated by hand.",
    );
  }
});

test("the standalone 404's dark palette still matches tokens.css", () => {
  const css = readFileSync(TOKENS, "utf8");
  const { dark } = sheetBlocks();
  for (const [nf, token] of PALETTE) {
    const declared = nfValue(dark, nf);
    assert.ok(declared, `--nf-${nf} is not declared in the dark block of public/not-found.css`);
    assert.equal(
      declared,
      themeTokens(css, token).dark,
      `--nf-${nf} is ${declared} in the dark block but --${token} is now ` +
        `${themeTokens(css, token).dark} in tokens.css.`,
    );
  }
});

test("the standalone 404's two dark blocks cannot disagree with each other", () => {
  // The OS block and the explicitly-chosen block are the same palette reached by
  // two different signals. Editing one and not the other produces a 404 whose
  // colours depend on which of the reader's two settings happened to select it —
  // a defect no screenshot of a single configuration can see.
  const { dark, chosenDark } = sheetBlocks();
  for (const [nf] of PALETTE) {
    assert.equal(
      nfValue(chosenDark, nf),
      nfValue(dark, nf),
      `--nf-${nf} differs between the prefers-color-scheme block and the ` +
        '.mj-nf[data-theme="dark"] block of public/not-found.css.',
    );
  }
  assert.equal(nfValue(chosenDark, "on-accent"), nfValue(dark, "on-accent"));
});

test("the standalone 404 introduces no hex colour outside that palette", () => {
  // Without this the two tests above pass while someone adds an eighth colour
  // answering to no token — the exact hole the raw-hex exemption opens.
  //
  // `--nf-on-accent` is the one deliberate exception: it is the text drawn ON
  // the accent-coloured button, and tokens.css has no name for that pairing.
  // It is required to equal --bg-0 in the matching theme, which is what the
  // rest of the app uses for the same job, so it is still pinned to a token
  // rather than free.
  const css = readFileSync(TOKENS, "utf8");
  const { light, dark } = sheetBlocks();

  assert.equal(nfValue(light, "on-accent"), themeTokens(css, "bg-0").light);
  assert.equal(nfValue(dark, "on-accent"), themeTokens(css, "bg-0").dark);

  const allowed = new Set(
    PALETTE.flatMap(([, token]) => [themeTokens(css, token).light, themeTokens(css, token).dark]),
  );
  allowed.add(themeTokens(css, "bg-0").light);
  allowed.add(themeTokens(css, "bg-0").dark);

  const found = readFileSync(SHEET, "utf8").match(/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g) ?? [];
  const unexpected = found.map((h) => h.toLowerCase()).filter((h) => !allowed.has(h));
  assert.deepEqual(
    unexpected,
    [],
    `public/not-found.css uses hex colours that match no token: ${unexpected.join(", ")}`,
  );
});
