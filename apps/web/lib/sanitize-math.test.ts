import assert from "node:assert/strict";
import test from "node:test";
import katex from "katex";

import { sanitizeMathHtml } from "./sanitize-math.ts";

/**
 * The sanitizer in front of the app's one HTML injection point.
 *
 * ## What this suite is actually guarding against
 *
 * Not "does DOMPurify remove `<script>`" — it does, and testing a dependency's
 * headline feature proves nothing about this codebase. The risk here runs the
 * other way. PR 668 added DOMPurify to this exact spot with an allowlist that
 * would have deleted KaTeX's whole MathML tree and every `style` attribute it
 * positions glyphs with, scrambling 884 corpus values across two locales. The
 * page would still have rendered. Nobody would have looked.
 *
 * So the load-bearing half of this file is the preservation half, and the
 * stripping half is its control: without the payload cases, a sanitizer that had
 * been accidentally turned into a no-op would pass every preservation assertion
 * perfectly.
 *
 * Coverage of the *real* corpus — all 884 values, both locales — is asserted in
 * `scripts/check-math.mjs`, which already compiles every `$…$` in the corpus and
 * so already has the enumeration. Duplicating that walk here would mean two
 * copies of it to keep in step. This file covers the shapes and the boundaries.
 */

const render = (tex: string): string =>
  katex.renderToString(tex, { throwOnError: false, displayMode: false, output: "htmlAndMathml" });

/**
 * Compare two HTML strings by structure rather than by bytes.
 *
 * Byte equality is the wrong assertion and would fail for a reason that does not
 * matter: DOMPurify reserializes through a DOM, so `<path … />` comes back as
 * `<path …></path>`. What must hold is that no element, no attribute and no text
 * went missing.
 */
function shape(html: string): { tags: string[]; attrs: string[]; text: string } {
  return {
    tags: [...html.matchAll(/<([a-zA-Z][a-zA-Z0-9:-]*)/g)].map((m) => m[1].toLowerCase()),
    // `xmlns` is dropped from the comparison: the XML parser adds
    // `xmlns="http://www.w3.org/1999/xhtml"` to the root element, HTML parsers
    // ignore it, and counting it would report a difference that does not exist
    // for a reader. Nothing else is normalized away.
    attrs: [...html.matchAll(/\s([a-zA-Z][a-zA-Z0-9-]*)\s*=/g)]
      .map((m) => m[1].toLowerCase())
      .filter((name) => name !== "xmlns"),
    // Text between tags, whitespace-collapsed, with character references
    // resolved. Catches an annotation body or a glyph being dropped, which no
    // tag or attribute count would notice. Entities are resolved because
    // reserializing turns `&#x27;` into a literal `'` — the same character, and
    // the corpus has many primes (`P'`, `\varepsilon'`).
    text: decodeEntities(html.replace(/<[^>]*>/g, ""))
      .replace(/\s+/g, " ")
      .trim(),
  };
}

/** Character references KaTeX emits, resolved so encoding is not read as loss. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * A spread of real corpus shapes: radicals and superscripts (which emit the
 * deepest `<span>` nesting and the `<svg><path>` rules), matrices (tables),
 * bra-ket and operator notation, and text mode. If sanitizing preserves these it
 * preserves what the corpus contains.
 */
const FORMULAS = [
  "\\sqrt{N}",
  "O(N^{1/2})",
  "\\frac{1}{2}\\hbar\\omega",
  "|\\psi\\rangle",
  "\\langle \\psi | H | \\psi \\rangle",
  "\\mathcal{O}(\\log N)",
  "\\sum_{i=1}^{n} x_i",
  "\\int_0^\\infty e^{-x}\\,dx",
  "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
  "\\text{CNOT}",
  "U^\\dagger",
  "\\varepsilon \\ll 1",
  "2^{n}",
  "\\alpha\\beta\\gamma",
];

test("sanitizing KaTeX output preserves every element, attribute and glyph", () => {
  for (const tex of FORMULAS) {
    const raw = render(tex);
    const clean = sanitizeMathHtml(raw);
    const before = shape(raw);
    const after = shape(clean);

    assert.deepEqual(
      after.tags,
      before.tags,
      `sanitizing dropped or reordered elements for ${tex}\n` +
        `  lost: ${before.tags.filter((t) => !after.tags.includes(t))}`,
    );
    assert.deepEqual(
      after.attrs,
      before.attrs,
      `sanitizing dropped attributes for ${tex}\n` +
        `  lost: ${before.attrs.filter((a) => !after.attrs.includes(a))}`,
    );
    assert.equal(after.text, before.text, `sanitizing changed rendered text for ${tex}`);
  }
});

test("the MathML semantics layer survives, including the TeX annotation", () => {
  // This is the specific thing DOMPurify's DEFAULT config removes, and the
  // reason lib/sanitize-math.ts needs a config at all. A screen reader reads
  // this, and "copy as LaTeX" copies it.
  for (const tex of ["\\sqrt{N}", "\\frac{1}{2}", "|\\psi\\rangle"]) {
    const clean = sanitizeMathHtml(render(tex));
    assert.match(clean, /<semantics>/, `<semantics> was stripped for ${tex}`);
    assert.match(
      clean,
      /<annotation encoding="application\/x-tex">/,
      `the TeX annotation or its encoding attribute was stripped for ${tex}`,
    );
    // The annotation body is the source, and it must be the source.
    const body = clean.match(/<annotation[^>]*>([\s\S]*?)<\/annotation>/);
    assert.ok(body, `no annotation body for ${tex}`);
    assert.equal(body[1], tex, `the annotation no longer carries the TeX for ${tex}`);
  }
});

test("SVG geometry attributes survive, in their camelCase spelling", () => {
  // The one *visible* regression this config guards. Under the XML parser the
  // attribute allowlist is case-sensitive, so DOMPurify's lowercase `viewbox`
  // does not match SVG's `viewBox`, and KaTeX's radical rules lost both
  // `viewBox` and `preserveAspectRatio` — which scales the overline of a \sqrt
  // against the wrong coordinate box.
  const clean = sanitizeMathHtml(render("\\sqrt{N}"));
  assert.match(clean, /<svg/, "the radical's SVG was removed entirely");
  assert.match(clean, /\sviewBox="/, "viewBox was stripped — \\sqrt will render distorted");
  assert.match(clean, /\spreserveAspectRatio="/, "preserveAspectRatio was stripped");
  assert.match(clean, /<path/, "the radical's path was removed");
});

test("`style` and `class` survive — they are how KaTeX positions glyphs", () => {
  // The PR 668 allowlist kept `class` and dropped `style`, which moves every
  // glyph in a radical or a fraction without removing anything visible enough to
  // notice in a diff.
  const clean = sanitizeMathHtml(render("\\sqrt{\\frac{a}{b}}"));
  assert.match(clean, /style="/, "KaTeX's inline positioning styles were stripped");
  assert.match(clean, /class="katex"/, "the katex root class was stripped");
});

/**
 * The control. Every case below is markup KaTeX would never emit, so these do
 * not test KaTeX — they test that the sanitizer in front of it is switched on.
 * Without them, a `sanitizeMathHtml` accidentally reduced to `(html) => html`
 * passes every assertion above.
 */
test("CONTROL: executable markup does not survive", () => {
  const cases: [string, string][] = [
    ["raw script element", "<span><script>alert(1)</script></span>"],
    ["event handler", '<img src="x" onerror="alert(1)">'],
    ["javascript: href", '<a href="javascript:alert(1)">x</a>'],
    ["svg onload", '<svg onload="alert(1)"></svg>'],
    ["iframe", '<iframe src="//evil.example"></iframe>'],
    ["object", '<object data="//evil.example"></object>'],
    ["form", '<form action="//evil.example"><input name="a"></form>'],
    ["script inside annotation", "<math><semantics><annotation>" + "<script>alert(1)</script>" + "</annotation></semantics></math>"],
  ];
  for (const [label, payload] of cases) {
    const clean = sanitizeMathHtml(payload);
    assert.doesNotMatch(clean, /<script/i, `${label}: a script element survived`);
    assert.doesNotMatch(clean, /\son[a-z]+\s*=/i, `${label}: an event handler survived`);
    assert.doesNotMatch(clean, /<iframe|<object|<embed|<form/i, `${label}: a dangerous element survived`);
    assert.doesNotMatch(
      clean,
      /(?:href|src)\s*=\s*"\s*javascript:/i,
      `${label}: a javascript: URL survived in an attribute`,
    );
  }
});

test("CONTROL: annotation-xml stays forbidden even though annotation is allowed", () => {
  // `<annotation-xml>` can switch the parser out of MathML and back into HTML,
  // which is how inert-looking MathML becomes live markup on a reparse. It is
  // one hyphen away from the tag this file's config ADDS, so the day somebody
  // "adds the sibling too" should be a failing test rather than a new hole.
  const clean = sanitizeMathHtml(
    '<math><semantics><annotation-xml encoding="text/html">' +
      "<script>alert(1)</script></annotation-xml></semantics></math>",
  );
  assert.doesNotMatch(clean, /annotation-xml/i, "annotation-xml was allowed through");
  assert.doesNotMatch(clean, /<script/i, "a script inside annotation-xml survived");
});

test("KaTeX's own refusal of \\href{javascript:} is not undone by sanitizing", () => {
  // KaTeX with `trust: false` emits no href at all here; the payload text
  // survives only inside the inert TeX annotation, which is correct — that is
  // the source, printed as text. Assert on attributes, not on the substring,
  // because "javascript:" appearing as annotation TEXT is not a finding.
  const clean = sanitizeMathHtml(render("\\href{javascript:alert(1)}{x}"));
  const dangerous = [...clean.matchAll(/\s(href|src|on[a-z]+)\s*=\s*"([^"]*)"/gi)];
  assert.equal(dangerous.length, 0, `an executable attribute appeared: ${dangerous.map((m) => m[0])}`);
  assert.doesNotMatch(clean, /<script/i, "a script element appeared");
});

test("multi-letter operators keep their MathML — the \\bmod case", () => {
  // The regression that only the corpus-wide check caught. Under the HTML
  // parser, DOMPurify's MathML text-integration-point rule emptied
  // `<mo><mrow><mi>m</mi><mi>o</mi><mi>d</mi></mrow></mo>` to `<mo></mo>`, so a
  // screen reader read "n mod 2" as "n 2" while the visible glyphs were fine.
  for (const tex of ["n \\bmod 2", "x \\bmod y + z"]) {
    const clean = sanitizeMathHtml(render(tex));
    const mathml = clean.match(/<span class="katex-mathml">([\s\S]*?)<\/span>/);
    assert.ok(mathml, `no MathML block for ${tex}`);
    assert.match(
      mathml[1],
      /<mo[^>]*>\s*<mrow>/,
      `the operator's nested MathML was emptied for ${tex} — a silent screen-reader regression`,
    );
    assert.doesNotMatch(mathml[1], /<mo[^>]*>\s*<\/mo>/, `an empty <mo> survived for ${tex}`);
  }
});

test("CONTROL: input that is not well-formed fails CLOSED, not open", () => {
  // XML parsing is strict, so a malformed fragment yields nothing rather than a
  // best-effort recovery. That is the safe direction and it is pinned here: a
  // future switch back to the HTML parser (or to fail-open recovery) changes
  // this result and has to be argued for rather than absorbed. It is also the
  // reason `sanitizeMathHtml` must never be reused for hand-written HTML — it
  // would silently delete it.
  for (const malformed of ["<span>unclosed", "5 < 7 & 8 > 2", "<span><b>x</span></b>"]) {
    const clean = sanitizeMathHtml(malformed);
    assert.equal(clean, "", `malformed input was recovered rather than refused: ${JSON.stringify(clean)}`);
  }
  // Well-formed text still passes through, so the above is strictness and not a
  // function that always returns nothing — which would pass every payload test.
  assert.equal(sanitizeMathHtml("plain text"), "plain text");
});
