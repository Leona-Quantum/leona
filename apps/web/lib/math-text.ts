/**
 * Splitting a line of corpus prose into the parts that are mathematics and the
 * parts that are not.
 *
 * ## Why this exists rather than `MarkdownContent`
 *
 * The obvious move — route `cost`, `conditions`, `contested` and the hops'
 * `theory` through the renderer the chat route already has — was measured
 * before it was written, and it corrupts the corpus. Those fields are **prose
 * with mathematics in it**, not Markdown documents, and nobody authored them
 * against Markdown's rules. Across the ten prose fields on the layer graph, 147
 * of 452 populated values contain a character Markdown assigns a meaning to:
 *
 * | what Markdown would do | values |
 * |---|---|
 * | `\|` starts a table cell — and `\|\|u_in\|\|` is a norm | 78 |
 * | `_x_` is emphasis | 60 |
 * | `*` is emphasis | 7 |
 * | `` ` `` is code, `\` is an escape | 4 |
 *
 * The chat route already carries a helper called `protectMathPipesInTableRows`
 * whose entire job is stopping GFM from shredding a ket into table cells. That
 * is the shape of defence a Markdown parser needs over mathematical prose, and
 * it is a defence against a feature none of these fields want.
 *
 * There is a second, harder blocker: `MarkdownContent` renders into a `<div>`,
 * and every one of these fields is drawn inside a `<p>`, a `<td>`, a `<dd>` or
 * one span of a run. There is no inline mode to ask for.
 *
 * So the renderer here does one thing: it finds `$…$` and leaves **every other
 * character exactly as authored**. A pipe stays a pipe.
 *
 * ## What counts as mathematics
 *
 * `$…$`, inline, and nothing else. Not `$$…$$`: display maths breaks a
 * paragraph in half, and every surface reading this draws inside a line. The
 * gate refuses `$$` in the corpus rather than this function guessing what to do
 * with it.
 *
 * `\$` is a literal dollar. It occurs nowhere in the corpus today and is
 * supported because the alternative is a field that can never mention a price.
 */
export interface MathSegment {
  /** True when `value` is TeX to be typeset, false when it is text to print. */
  math: boolean;
  value: string;
}

/**
 * Whether every `$` in this string is part of a closed pair.
 *
 * Separate from `mathSegments` because the two answers differ on purpose: this
 * is what the gate asks at build time, and `mathSegments` is what the page does
 * at render time with whatever it was given. An unpaired `$` must **fail the
 * build** and must **not** swallow the rest of the sentence on a page that
 * somehow shipped with one — a renderer that silently ate a paragraph would be
 * exactly the kind of failure nothing reports.
 */
export function mathDelimitersBalanced(source: string): boolean {
  return mathSegments(source).every((segment) => !segment.unclosed);
}

interface InternalSegment extends MathSegment {
  unclosed?: boolean;
}

/**
 * The segments, in order, covering the whole input with nothing dropped.
 *
 * The concatenation of every segment's `value` — with the `$` delimiters put
 * back on the maths — is the input. That is asserted in the tests rather than
 * left as a comment, because "the renderer prints everything it was given" is
 * the one property a reader of a physics claim depends on.
 */
export function mathSegments(source: string): InternalSegment[] {
  const segments: InternalSegment[] = [];
  let text = "";
  let at = 0;
  const flush = (): void => {
    if (text !== "") segments.push({ math: false, value: text });
    text = "";
  };
  while (at < source.length) {
    const character = source[at];
    if (character === "\\" && source[at + 1] === "$") {
      text += "$";
      at += 2;
      continue;
    }
    if (character !== "$") {
      text += character;
      at += 1;
      continue;
    }
    // A `$`. Find its partner, skipping an escaped one.
    let end = at + 1;
    while (end < source.length) {
      if (source[end] === "\\" && source[end + 1] === "$") {
        end += 2;
        continue;
      }
      if (source[end] === "$") break;
      end += 1;
    }
    if (end >= source.length) {
      // Unclosed. Print the rest as what it is — text with a dollar in it —
      // rather than typesetting a fragment or dropping it.
      flush();
      segments.push({ math: false, value: source.slice(at), unclosed: true });
      return segments;
    }
    const body = source.slice(at + 1, end);
    flush();
    // `$$` — an empty body — is display maths, or an author's typo for it.
    // Neither belongs inside a line, and the gate says so by name; here it is
    // simply text, so a page never renders half a paragraph as a formula.
    segments.push(body.trim() === "" ? { math: false, value: "$$" } : { math: true, value: body });
    at = end + 1;
  }
  flush();
  return segments;
}

/**
 * Every distinct TeX body in a string, for the gate to try to compile.
 *
 * The gate compiles rather than pattern-matches: `\varepsilon` and `\varepilon`
 * are one character apart and only one of them is a symbol, and the difference
 * is invisible in a diff and invisible on the page too, because KaTeX renders an
 * undefined control sequence as red text that a reader takes for emphasis.
 */
export function mathBodies(source: string): string[] {
  return mathSegments(source)
    .filter((segment) => segment.math)
    .map((segment) => segment.value);
}
