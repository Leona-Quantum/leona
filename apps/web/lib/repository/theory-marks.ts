/**
 * The mathematics of a hop, and the two things marked *inside* it.
 *
 * ## Why this is one string and not three fields
 *
 * Session 114 gave a hop three slots — the mathematics, the approximations made
 * here, the assumptions needed here — and drew them as three stacked headings.
 * The owner read it and answered:
 *
 * > *"assumptions and approximations will be colored/bolded highlighted/commented
 * > within the mathematics, so no need for the sections. this is probably going to
 * > be bulky, so too many sections here can make it hard to follow."*
 *
 * That is a **content model**, not a styling note. An approximation is not a
 * paragraph about the hop, it is a clause *of* the hop's mathematics — the
 * sentence that says what was replaced by what. A separate field forces an author
 * to write the mathematics once and then write a second, detached description of
 * one of its clauses, and the two drift the first time either is edited. It is
 * the same argument `layers.ts` already makes for putting `through`, `via` and
 * `repeats` on the step rather than on the method: a method does not approximate,
 * it approximates *something*, at a place.
 *
 * So the mathematics is one string an author writes once, and the two things a
 * reader must not miss are marked where they occur.
 *
 * ## The syntax
 *
 * `[[approximation: … ]]` and `[[assumption: … ]]`, anywhere in the prose. No
 * nesting, no unclosed marks, no unknown kinds — `validateTheory` rejects all
 * three, so a malformed mark fails the build rather than rendering as literal
 * brackets on a published card.
 *
 * Two kinds and no more. They are the two the model already had names for and
 * the two he named. A third — a general "note" — would be a field nobody asked
 * for whose meaning is decided by whoever writes into it first.
 *
 * ## Both locales must mark the same things
 *
 * `validatePairedTheory` checks that `theory` and `theoryJa` carry the same kinds
 * in the same order. A translation that drops a highlight is not a translation
 * with a styling difference: it is one set of readers being shown that a step
 * makes an approximation and another set not being shown it. The rule is cheap
 * here and unenforceable once 91 hops are authored.
 */

/** The two things a reader must not miss inside a hop's mathematics. */
export const THEORY_MARKS = ["approximation", "assumption"] as const;

export type TheoryMark = (typeof THEORY_MARKS)[number];

/** One run of the mathematics: plain prose, or a marked clause inside it. */
export interface TheorySpan {
  /** `null` for ordinary prose — the common case, and most of every note. */
  readonly mark: TheoryMark | null;
  readonly text: string;
}

const MARK_PATTERN = /\[\[([a-z]+):([\s\S]*?)\]\]/g;

function isMark(value: string): value is TheoryMark {
  return (THEORY_MARKS as readonly string[]).includes(value);
}

/**
 * The prose, split into runs.
 *
 * **Never throws, and reproduces its input exactly.** Concatenating the spans
 * gives the source back character for character wherever a mark is *not*
 * well-formed, and that is the contract the whole arrangement rests on: parsing
 * and validation are separate so the gate can sit at the build rather than at
 * the draw, and a renderer that throws on bad data takes a page down over a
 * typo. If this could silently eat a fragment, a malformed note would reach a
 * reader shorter than it was written — which is worse than reaching them with
 * visible brackets in it, because nobody can see what is missing.
 *
 * So a match becomes a marked span only when it is a mark in every respect:
 * known kind, nothing nested inside it, non-empty. Anything else stays the plain
 * prose it looks like, and `validateTheory` is what tells the author. That
 * function scans the source itself rather than reading these spans, precisely
 * because a validator reading the parser's output cannot report what the parser
 * has already normalised away.
 */
export function parseTheory(source: string): readonly TheorySpan[] {
  const spans: TheorySpan[] = [];
  let cursor = 0;
  for (const match of source.matchAll(MARK_PATTERN)) {
    const [whole, kind = "", body = ""] = match;
    const start = match.index;
    // Already inside text a previous match consumed. Reachable only after a
    // skipped mark, whose `]]` a later match can otherwise claim twice.
    if (start < cursor) continue;
    if (!isMark(kind)) continue;
    // **Nested, and this is why the test is here and not only in the validator.**
    // `[[a: [[b: x]] ]]` matches non-greedily through the *inner* `]]`, so taking
    // it would swallow `[[a: ` and render neither the text nor any sign that it
    // was there. Left whole, it is visibly wrong — which is the failure mode this
    // parser is supposed to have.
    if (body.includes("[[")) continue;
    const text = body.trim();
    // An empty mark marks nothing, and dropping it would delete
    // `[[approximation: ]]` from the drawing. Prose, and reported by the
    // validator, which finds it without help from here.
    if (text === "") continue;
    if (start > cursor) spans.push({ mark: null, text: source.slice(cursor, start) });
    spans.push({ mark: kind, text });
    cursor = start + whole.length;
  }
  if (cursor < source.length) spans.push({ mark: null, text: source.slice(cursor) });
  // Empty *plain* runs go — a mark at either end of the prose otherwise leaves a
  // zero-length span beside it, which draws an empty element nobody can see and
  // nobody reports.
  return spans.filter((span) => span.text !== "");
}

/** The kinds this note marks, in the order it marks them. */
export function marksOf(source: string): readonly TheoryMark[] {
  return parseTheory(source)
    .map((span) => span.mark)
    .filter((mark): mark is TheoryMark => mark !== null);
}

/**
 * What is wrong with one locale's mathematics, as sentences an author can act on.
 *
 * Empty means well-formed. **It reads the source, not `parseTheory`'s output**,
 * and that is the point: the parser leaves every malformed mark as prose, so a
 * validator reading its spans would find nothing wrong with any of them. The two
 * agree on what a mark is and disagree on what to do about one that is not.
 */
export function validateTheory(owner: string, source: string): string[] {
  const errors: string[] = [];
  // Unknown kinds first: `[[approximaton: …]]` is a typo that would otherwise
  // sail through as prose containing literal brackets, which is exactly the
  // thing a reader would report as a rendering bug rather than a data one.
  for (const match of source.matchAll(/\[\[([a-z]+):/g)) {
    const kind = match[1] ?? "";
    if (!isMark(kind)) {
      errors.push(
        `${owner}: [[${kind}: …]] is not a mark — the kinds are ${THEORY_MARKS.join(", ")}`,
      );
    }
  }
  // **A left-to-right walk with a depth, not two counts.** Counting `[[` against
  // `]]` says `x ]] [[approximation: y` is balanced: one of each, and both of
  // them wrong. Order is the fact, so order is what is checked — and one walk
  // reports a stray closer, a nested mark and an unclosed one, which two counts
  // and a lookahead regex managed between them only by accident.
  let depth = 0;
  let nested = false;
  let stray = false;
  for (const match of source.matchAll(/\[\[|\]\]/g)) {
    if (match[0] === "[[") {
      if (depth > 0) nested = true;
      depth += 1;
      continue;
    }
    if (depth === 0) {
      stray = true;
      continue;
    }
    depth -= 1;
  }
  if (stray) {
    errors.push(`${owner}: a ']]' closes a mark that was never opened`);
  }
  // Nesting has no meaning: a clause is one kind or the other, and a renderer
  // asked to draw an approximation inside an assumption has to pick one anyway.
  if (nested) {
    errors.push(`${owner}: marks are nested — a clause is one kind or the other`);
  }
  if (depth > 0) {
    errors.push(`${owner}: ${depth} '[[' left open — a mark is unclosed`);
  }
  // Empty marks, found in the source for the reason in the doc comment above:
  // the parser renders one as prose, so its spans no longer carry it.
  for (const match of source.matchAll(MARK_PATTERN)) {
    const kind = match[1] ?? "";
    const body = match[2] ?? "";
    if (isMark(kind) && !body.includes("[[") && body.trim() === "") {
      errors.push(`${owner}: an empty [[${kind}: …]] marks nothing`);
    }
  }
  return errors;
}

/**
 * What is wrong across the pair, given both locales are present.
 *
 * Kind-by-kind and in order, because the marks are positions in a sentence and
 * two translations that mark the same *set* in a different order are marking
 * different clauses.
 */
export function validatePairedTheory(owner: string, en: string, ja: string): string[] {
  const left = marksOf(en);
  const right = marksOf(ja);
  if (left.length === right.length && left.every((mark, index) => mark === right[index])) {
    return [];
  }
  return [
    `${owner}: the two locales mark different things — ` +
      `en marks [${left.join(", ")}] and ja marks [${right.join(", ")}]. ` +
      `A highlight in one language only is a fact half the readers are not shown.`,
  ];
}
