import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The notebook code editor draws the same text in three stacked layers: the highlighted
 * <pre> the reader sees, an invisible line layer that carries lint underlines, and an
 * invisible <textarea> that takes the caret and the keyboard. They must share every
 * metric, or the caret and the underlines land on the wrong characters. jsdom computes no
 * layout and no cascade, so the component tests cannot see any of that. These tests read
 * the stylesheet itself and pin the three rules whose absence shipped, and was seen only
 * in a real browser, on 2026-09-24:
 *
 * - the line layer's text was a visible colour, so every line was drawn twice;
 * - the line layer's left inset lacked the --sp-2 the <pre> and <textarea> have, so it
 *   sat 8px left and wrapped at a different width;
 * - the workspace shell's `.mj-shell--workspace :is(button, input, select, textarea)`
 *   (specificity 0,1,1) outranked `.mj-code-editor-metrics` (0,1,0) and put the textarea
 *   in the sans-serif UI font under a monospace <pre>.
 */
const CSS = readFileSync(new URL("../components/notebook-ide.css", import.meta.url), "utf8");

/** Every `selector { declarations }` block, comments removed, as [selector, decls]. */
function rules(): Array<[string, Map<string, string>]> {
  const text = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Array<[string, Map<string, string>]> = [];
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>();
    for (const part of match[2].split(";")) {
      const colon = part.indexOf(":");
      if (colon > 0) decls.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
    }
    out.push([match[1].trim(), decls]);
  }
  return out;
}

function declsFor(selector: string): Map<string, string> {
  const found = rules().filter(([sel]) => sel === selector);
  assert.equal(found.length, 1, `expected exactly one rule for ${selector}, found ${found.length}`);
  return found[0][1];
}

test("the stylesheet parses into the rules these tests read", () => {
  // Positive control: a parse that finds nothing must fail here, not pass below.
  assert.ok(rules().length >= 30, `only ${rules().length} rules parsed`);
});

test("the line layer draws no visible text", () => {
  assert.equal(declsFor(".mj-code-editor-lines").get("color"), "transparent");
  assert.equal(declsFor(".mj-code-editor-line-content").get("color"), "transparent");
});

test("the line layer's text starts where the highlighted text starts", () => {
  const pre = declsFor(".mj-code-editor-highlight").get("padding-left");
  const line = declsFor(".mj-code-editor-line").get("padding-left");
  assert.ok(pre, "the <pre> sets its left inset");
  assert.equal(line, pre, "the line layer's inset must equal the <pre>'s");
});

test("the textarea is monospace with a selector that outranks the workspace shell's", () => {
  // `.mj-shell--workspace :is(button, input, select, textarea)` is (0,1,1). A rule with
  // two classes and the element beats it wherever this file loads.
  const decls = declsFor(".mj-code-editor textarea.mj-code-editor-input");
  assert.equal(decls.get("font-family"), "var(--font-mono)");
  assert.equal(decls.get("font-size"), declsFor(".mj-code-editor-metrics").get("font-size"));
  assert.equal(decls.get("line-height"), declsFor(".mj-code-editor-metrics").get("line-height"));
});
