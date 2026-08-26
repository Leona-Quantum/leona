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
 * ONE theme. This sheet ships both, keyed on `prefers-color-scheme`, so a
 * drifted light value and a drifted dark value are two different bugs and both
 * have to fail.
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
 * Taking `matches[1]` for dark rather than the last would read the
 * `[data-theme="dark"]` block, which is the right value today and is not the one
 * this sheet can use — this page has no theme script and so no `data-theme`
 * attribute to key on. The last declaration IS the media-query block, which is
 * the only one that applies here, so that is what is compared.
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
 * The sheet's two palettes. The dark one lives inside the
 * `@media (prefers-color-scheme: dark)` block; the light one is everything
 * before it.
 */
function sheetBlocks(): { light: string; dark: string } {
  const source = readFileSync(SHEET, "utf8");
  const at = source.indexOf("@media (prefers-color-scheme: dark)");
  assert.notEqual(
    at,
    -1,
    "public/not-found.css no longer has a prefers-color-scheme block — a reader in dark mode " +
      "would get the light palette on a page that has no theme script to correct it.",
  );
  const end = source.indexOf("}\n}", at);
  assert.notEqual(end, -1, "could not find the end of the dark block in public/not-found.css");
  return { light: source.slice(0, at), dark: source.slice(at, end) };
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
