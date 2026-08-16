/**
 * Keeps the Open Graph card's hard-coded palette honest.
 *
 * `app/opengraph-image.tsx` is the one file in `apps/web` allowed to carry raw
 * hex colours, because `next/og` renders through Satori and Satori resolves no
 * CSS custom properties — `var(--bg-0)` there yields a transparent box, not a
 * colour. That exemption is real, but on its own it recreates the problem the
 * token gate exists to prevent: a palette that can drift from the product's
 * without anything noticing, on a surface nobody looks at because it is only
 * ever seen inside someone else's Slack.
 *
 * So the literals are exempt from `check-raw-hex.mjs` and checked here instead.
 * This parses the dark theme straight out of `packages/ts/ui/tokens.css` and
 * asserts the card still agrees with it. If a token moves, this fails and names
 * the constant to update.
 *
 * `app/icon.svg` carries the same literals for the same reason and is exempt
 * only by accident — `.svg` is not a scanned extension — so it is checked here
 * too rather than left to the accident.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const TOKENS = resolve(repoRoot, "packages/ts/ui/tokens.css");
const OG_IMAGE_SOURCE = resolve(here, "../app/opengraph-image.tsx");
const ICON_SOURCE = resolve(here, "../app/icon.svg");

/**
 * The dark-theme value of a token.
 *
 * tokens.css declares each name more than once — a light value on bare
 * `:root`, then a dark one under `[data-theme="dark"]` and again under
 * `prefers-color-scheme: dark`. The card is always dark regardless of the
 * reader's theme, because it is rendered against Slack's or X's own chrome and
 * there is no visitor preference to honour. So we want the LAST declaration,
 * not the first: taking the first would silently compare the card against the
 * light palette and pass only when the two happened to match.
 */
function darkToken(css: string, name: string): string {
  const matches = [...css.matchAll(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`, "g"))];
  assert.ok(matches.length > 0, `--${name} is not declared in tokens.css at all`);
  assert.ok(
    matches.length > 1,
    `--${name} is declared once in tokens.css, so there is no dark value to compare against`,
  );
  return matches[matches.length - 1][1].toLowerCase();
}

/** Every hex literal in a file, lowercased. */
function hexesIn(path: string): string[] {
  const found = readFileSync(path, "utf8").match(/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g);
  return (found ?? []).map((h) => h.toLowerCase());
}

// name in tokens.css -> the constant in opengraph-image.tsx that copies it
const CARD_PALETTE = [
  ["bg-0", "BG_0"],
  ["bg-1", "BG_1"],
  ["text-0", "TEXT_0"],
  ["text-1", "TEXT_1"],
  ["accent", "ACCENT"],
  ["border-0", "BORDER_0"],
] as const;

test("the OG card's palette still matches the dark theme in tokens.css", () => {
  const css = readFileSync(TOKENS, "utf8");
  const source = readFileSync(OG_IMAGE_SOURCE, "utf8");

  for (const [token, constant] of CARD_PALETTE) {
    const expected = darkToken(css, token);
    const declared = source.match(new RegExp(`const ${constant} = "(#[0-9a-fA-F]{3,8})"`));
    assert.ok(declared, `${constant} is no longer declared in app/opengraph-image.tsx`);
    assert.equal(
      declared[1].toLowerCase(),
      expected,
      `${constant} is ${declared[1]} but --${token} is now ${expected} in tokens.css. ` +
        "Satori cannot read CSS variables, so update the literal in app/opengraph-image.tsx.",
    );
  }
});

test("the OG card introduces no hex colour outside that palette", () => {
  // Without this, the check above passes while someone adds a seventh colour
  // that answers to no token at all — which is exactly the hole the raw-hex
  // exemption opens.
  const css = readFileSync(TOKENS, "utf8");
  const allowed = new Set(CARD_PALETTE.map(([token]) => darkToken(css, token)));
  const unexpected = hexesIn(OG_IMAGE_SOURCE).filter((h) => !allowed.has(h));
  assert.deepEqual(
    unexpected,
    [],
    `app/opengraph-image.tsx uses hex colours that match no token: ${unexpected.join(", ")}`,
  );
});

test("the favicon's literals still match the dark theme too", () => {
  // icon.svg says in its own comment that it is "kept in sync by hand" with
  // bg-0 and accent. Hand-sync is a promise; this is the check.
  const css = readFileSync(TOKENS, "utf8");
  const allowed = new Set([darkToken(css, "bg-0"), darkToken(css, "accent")]);
  const unexpected = hexesIn(ICON_SOURCE).filter((h) => !allowed.has(h));
  assert.deepEqual(
    unexpected,
    [],
    `app/icon.svg uses colours that are no longer --bg-0 or --accent: ${unexpected.join(", ")}`,
  );
});
