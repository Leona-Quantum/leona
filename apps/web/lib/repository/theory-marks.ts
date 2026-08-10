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
 * Never throws and never drops text: an input that `validateTheory` would reject
 * still comes back as spans, with the malformed part left as the plain prose it
 * looks like. Parsing and validation are separate on purpose — the gate belongs
 * at the build, and a renderer that throws on bad data takes a page down over a
 * typo somebody could have seen.
 */
export function parseTheory(source: string): readonly TheorySpan[] {
  const spans: TheorySpan[] = [];
  let cursor = 0;
  for (const match of source.matchAll(MARK_PATTERN)) {
    const [whole, kind = "", body = ""] = match;
    const start = match.index;
    if (!isMark(kind)) continue;
    if (start > cursor) spans.push({ mark: null, text: source.slice(cursor, start) });
    spans.push({ mark: kind, text: body.trim() });
    cursor = start + whole.length;
  }
  if (cursor < source.length) spans.push({ mark: null, text: source.slice(cursor) });
  // Empty *plain* runs go — a mark at either end of the prose otherwise leaves a
  // zero-length span beside it, which draws an empty element nobody can see and
  // nobody reports. An empty *marked* run stays, because `validateTheory` below
  // is the only thing that can tell an author about `[[approximation: ]]` and it
  // reads this list to do it. So the rule is not "drop what is empty", it is
  // "drop what says nothing and is not a defect".
  return spans.filter((span) => span.text !== "" || span.mark !== null);
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
 * Empty means well-formed. The three failures are the three ways `[[` and `]]`
 * can be written by hand and be wrong, and each is reported with the offending
 * text so a 400-word note does not have to be re-read to find it.
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
  // Counting delimiters catches both an unclosed mark and a stray closer. The
  // regex above is non-greedy and simply skips an unterminated `[[`, so without
  // this the text after it renders unmarked and nothing says why.
  const opens = (source.match(/\[\[/g) ?? []).length;
  const closes = (source.match(/\]\]/g) ?? []).length;
  if (opens !== closes) {
    errors.push(`${owner}: ${opens} '[[' and ${closes} ']]' — a mark is unclosed`);
  }
  // Nesting has no meaning: a clause is one kind or the other, and a renderer
  // asked to draw an approximation inside an assumption has to pick one anyway.
  if (/\[\[[^\]]*\[\[/.test(source)) {
    errors.push(`${owner}: marks are nested — a clause is one kind or the other`);
  }
  for (const span of parseTheory(source)) {
    if (span.mark !== null && span.text === "") {
      errors.push(`${owner}: an empty [[${span.mark}: …]] marks nothing`);
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
