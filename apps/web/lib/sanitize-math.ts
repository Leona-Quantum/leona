import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize KaTeX's rendered HTML before it is handed to the browser as markup.
 *
 * ## Why this exists, given the input is ours
 *
 * `components/math-text.tsx` injects `katex.renderToString` output through
 * React's raw-markup escape hatch. (Spelled out nowhere in this file on purpose:
 * `html-injection-surface.test.ts` greps source text for that identifier and
 * counts every occurrence as a sink, comments included. This module writes no
 * HTML — it returns a string — so naming the API here would put a file on that
 * allowlist which has no business being on it, and an allowlist with a
 * non-sink entry is one nobody trusts.) The input is corpus prose authored in this
 * repository and gated by `scripts/check-math.mjs`, and KaTeX defaults to
 * `trust: false`, which refuses `\href{javascript:…}` and escapes raw HTML. That
 * reasoning is why this file did not exist for a long time, and it was argued at
 * length on ai-ops 138.
 *
 * The owner ruled otherwise on 2026-08-17: *"katex itself is not a good enough
 * sanitizer. we need DOMPurify, so add it wherever it belongs and implement."*
 * So this is a second, independent line — the injection point is sanitized on
 * the way out regardless of what the renderer upstream promises. That is worth
 * having on its own terms: it stops depending on a *default* of a third-party
 * library staying what it is today, and it holds if the input to `MathText` ever
 * stops being repo-authored.
 *
 * ## The configuration is the whole risk, not the sanitizer
 *
 * PR 668 tried this and would have broken the site: its allowlist was
 * `ALLOWED_TAGS: ['span','p']`, `ALLOWED_ATTR: ['class']`, which deletes KaTeX's
 * entire MathML tree and every `style` attribute it positions glyphs with —
 * scrambling 884 corpus values to fix an injection that was not there. A
 * sanitizer that quietly eats correct output is worse than no sanitizer, because
 * the page still renders and nobody looks.
 *
 * So the config here is **additive to DOMPurify's defaults**, never a
 * replacement for them. Defaults already permit HTML, SVG and MathML, which
 * covers all but two of the elements KaTeX emits. Measured, not assumed: on the
 * default config KaTeX output loses `<semantics>`, `<annotation>` and the
 * `encoding` attribute — the MathML content-markup layer that carries the
 * original TeX. That is what a screen reader reads and what "copy as LaTeX"
 * copies, so losing it is a real regression that changes no pixel.
 *
 * ## `annotation`, deliberately NOT `annotation-xml`
 *
 * `<annotation-xml>` is a known mutation-XSS vector: it can switch the parser
 * out of the MathML namespace and back into HTML, which is how a payload that
 * looks inert as MathML becomes live markup after a reparse. DOMPurify forbids
 * it by default and this file does not add it back. KaTeX only ever emits
 * `<annotation encoding="application/x-tex">`, so nothing needs it.
 * `sanitize-math.test.ts` asserts `annotation-xml` is still removed, so a future
 * "add the sibling tag too" edit fails a test instead of opening the hole.
 *
 * ## One normalization, which is why callers must not compare byte-for-byte
 *
 * DOMPurify reserializes through a DOM, so a self-closing `<path … />` comes
 * back as `<path …></path>`. Identical to a browser, six bytes longer as a
 * string. Equivalence here means same elements, same attributes, same text — not
 * an identical string.
 */

/**
 * Additive only. Every key here widens DOMPurify's defaults; nothing narrows
 * them, so a tag or attribute the defaults reject stays rejected.
 */
const KATEX_CONFIG = {
  /**
   * **Parse as XML, not as HTML — and this one is load-bearing.**
   *
   * Under the HTML parser, DOMPurify enforces MathML *text integration points*:
   * inside `<mi>`, `<mo>`, `<mn>`, `<ms>` and `<mtext>` the content is expected
   * to be HTML, so nested MathML there is treated as a namespace violation and
   * removed. KaTeX emits exactly that shape for multi-letter operators —
   * `\bmod` renders as `<mo><mrow><mi>m</mi><mi>o</mi><mi>d</mi></mrow></mo>` —
   * and the HTML parser reduced it to an empty `<mo></mo>`.
   *
   * The result was `n mod 2` read aloud as "n 2", with the visible glyphs
   * untouched, because KaTeX's visual layer is a separate `<span>` tree from the
   * MathML the screen reader gets. A silent accessibility regression on the one
   * corpus construct that hits it: caught by the corpus-wide preservation check
   * in `scripts/check-math.mjs`, and by nothing else — the representative
   * formulas in `sanitize-math.test.ts` all passed.
   *
   * Under the XML parser the nesting survives intact and every payload in the
   * control set is still removed (verified, including `<mo><script>` and
   * `<mtext><img onerror>`).
   *
   * Two consequences of XML mode, both accounted for:
   *
   * 1. The root element comes back carrying `xmlns="http://www.w3.org/1999/xhtml"`.
   *    HTML parsers ignore `xmlns` on HTML elements, so it is inert — but it is
   *    why equivalence checks normalize it away rather than counting attributes.
   * 2. **It fails CLOSED.** XML parsing is strict, so input that is not
   *    well-formed yields an empty string rather than a best-effort recovery.
   *    That is the safe direction, and it is safe *here* because the only caller
   *    passes `katex.renderToString` output, which is well-formed by
   *    construction — proven over all 884 corpus values by the gate above, not
   *    assumed. It also means this function must never be repurposed as a
   *    general-purpose sanitizer for hand-written HTML: it would silently delete
   *    it. `sanitize-math.test.ts` pins the fail-closed direction so a future
   *    change to fail-open has to be argued for.
   */
  // `as const` on the value, not on the object: DOMPurify types this as the
  // literal union `DOMParserSupportedType`, while the arrays below must stay
  // mutable `string[]`. A blanket `as const` on the whole object satisfies the
  // first and breaks the second.
  PARSER_MEDIA_TYPE: "application/xhtml+xml" as const,
  /**
   * MathML content markup. KaTeX wraps its presentation MathML in
   * `<semantics>` and appends the source TeX in `<annotation>`. Neither is in
   * DOMPurify's default MathML allowlist, and both carry no attributes that can
   * execute. `annotation-xml` is excluded on purpose — see the note above.
   */
  ADD_TAGS: ["semantics", "annotation"],
  /**
   * `encoding="application/x-tex"` on the annotation. It is how a consumer knows
   * the annotation body is TeX rather than MathML or plain text; without it the
   * element survives and stops meaning anything.
   */
  ADD_ATTR: [
    "encoding",
    /**
     * **Case-sensitive, and that is the trap.** Under the XML parser above,
     * attribute names keep their case and are matched case-sensitively, so
     * DOMPurify's own lowercase `viewbox` entry does not match the `viewBox` the
     * SVG spec defines. Both of these were being silently dropped from KaTeX's
     * radical rules.
     *
     * Unlike the `\bmod` regression this one is *visible*: `viewBox` establishes
     * the SVG coordinate system, so without it the overline of a `\sqrt` scales
     * against the wrong box. Listed in the exact case the markup uses; adding the
     * lowercase spelling as well does nothing.
     */
    "viewBox",
    "preserveAspectRatio",
  ],
  /**
   * Narrower than the defaults, which is the one place this config tightens
   * rather than widens.
   *
   * DOMPurify permits `<form>`, `<input>` and friends by default — they are not
   * script, so its threat model leaves them in. Found by the control case in
   * `sanitize-math.test.ts`, which is exactly what that case is for: a
   * `<form action="//evil.example">` came back intact. In a *mathematics*
   * fragment that is a credential-harvesting surface with no legitimate use, and
   * `<base>`/`<link>`/`<meta>` are worse than they look — one `<base href>` can
   * repoint every relative URL on the page.
   *
   * KaTeX emits spans, MathML (`math`, `semantics`, `annotation`, `mrow`, `mi`,
   * `mo`, `mn`, `msup`, `mfrac`, `msqrt`, `mtable`…) and inline `svg`/`path`. It
   * has never emitted any element below, so forbidding them costs nothing and
   * the preservation test proves it.
   */
  FORBID_TAGS: [
    "form",
    "input",
    "button",
    "select",
    "option",
    "textarea",
    "label",
    "fieldset",
    "legend",
    "iframe",
    "object",
    "embed",
    "base",
    "link",
    "meta",
    "style",
    "template",
  ],
  /**
   * `formaction` and `action` cannot matter once the elements carrying them are
   * gone, but they are stated so that re-permitting one of those tags does not
   * silently re-permit its most dangerous attribute at the same time.
   */
  FORBID_ATTR: ["action", "formaction", "srcdoc", "ping"],
};

/**
 * Sanitize one KaTeX render. Returns HTML safe to inject.
 *
 * Takes and returns a string rather than doing the injection itself, so the
 * app's single raw-markup sink stays in `components/math-text.tsx` where the
 * injection-surface test can see and count it.
 */
export function sanitizeMathHtml(html: string): string {
  return DOMPurify.sanitize(html, KATEX_CONFIG);
}
