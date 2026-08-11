"use client";

/**
 * The card — what the map says about one node, without leaving the map.
 *
 * A sibling of `map-info-popup.tsx` in every structural respect: the panel is a
 * *parameter* (`?card=`), so opening it is a link, closing it is a link, and the
 * server decides what is open from the query string alone. `curl` returns every
 * word of it and a reader with JavaScript off can open and shut it. What the
 * client adds — Escape, backdrop dismissal — is enhancement over markup that
 * already works without it.
 *
 * **It adds a destination and removes none.** The map's existing two targets per
 * name are untouched: a line still opens and shuts its lane, and a name still
 * goes to that node's own page. The card is a third control, and the node page
 * is the first link inside it — so the card is a preview that hands you onward
 * rather than a replacement that swallows the page.
 *
 * **Three levels of nesting, and that is his ceiling rather than a coincidence.**
 * The owner bounded this explicitly: *"don't go more than like 2-3 layers deep
 * though, that would be an unnecessary replacement for the user actually
 * navigating the map itself."* A section is level one, an item inside it is
 * level two, and level three is reached in exactly two places — a hop of Theory,
 * and one implementation — because he specified both as having contents of their
 * own and signed off on the second by name. Past that, an item's children are a
 * link to the map: a card that can traverse the graph has taken the map's job.
 *
 * This comment used to say **two**, which was a tightening nobody asked for. It
 * was written before he answered §2, and it would have ruled out the shape he
 * then approved — worth recording, because a self-imposed limit that outlives
 * its reason reads exactly like a requirement.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import type {
  Card,
  CardGap,
  CardImplementation,
  CardSectionId,
  CoverageAnswer,
  CardHop,
  CardIngredient,
  CardLink,
  CardRepetition,
  CardValue,
  ImplementationSectionId,
  MethodCard,
  OwnStepCard,
  ProcessCard,
} from "../lib/repository/card-content";
import { cardSections } from "../lib/repository/card-content";
import { LOOP_CLOSURE_COPY } from "../lib/repository/loop-closure-copy";
import { THEORY_MARKS, type TheoryMark, type TheorySpan } from "../lib/repository/theory-marks";
import { ownStepName } from "../lib/repository/converge-layout";
import type { PublicLocale } from "../lib/public-locale";
import { MathText } from "./math-text";

type Lang = "en" | "ja";

/** A card's own words, in one shape both locales must fill. */
interface Copy {
  /**
   * The locale these words are in.
   *
   * Carried so a component holding `copy` can reach the strings this file does
   * *not* own — `ownStepName`, whose single writer is the layout, because the
   * canvas prints the same phrase on the same hop and one fact wants one string.
   */
  lang: Lang;
  close: string;
  eyebrow: Record<"method" | "process" | "own-step", string>;
  openPage: string;
  /**
   * The control that opens the truncated map inside this card — the owner's
   * *"click the process to expand it further"* (W9). One string for both the
   * process card and the method card, because both controls do one thing: open
   * a map of just this, here, without leaving the card.
   */
  openInner: string;
  /** The way back from the truncated map to the card it opened from. */
  innerBack: string;
  realizes: string;
  /** The two directions of `refines`. See `Refinement` below for why they are chrome. */
  refines: string;
  refinedBy: string;
  noneFound: string;
  noField: string;
  /** The worklist line on the own-step card. See the `no-slot` arm of `Body`. */
  noSlotHere: string;
  sections: Record<CardSectionId, string>;
  /** The accessible name of the row of section names. */
  sectionsLabel: string;
  /**
   * The two things marked inside a hop's mathematics, named for the legend and
   * for a screen reader. See `theory-marks.ts` — they were two headings until
   * the owner moved them into the prose.
   */
  marks: Record<TheoryMark, string>;
  /** The way out of an opened hop, as an action rather than the step's name again. */
  openStep: string;
  /** The owner's five, inside one implementation. */
  implementationSections: Record<ImplementationSectionId, string>;
  /**
   * The worklist line under an empty Implementations section.
   *
   * A function rather than a template string, because the two counts pluralise
   * independently and one of them is routinely zero — a single format string
   * would have to say "1 papers" in one locale to stay one string.
   */
  leads: (simulation: number, hardware: number) => string;
  takes: string;
  returns: string;
  /** The paper list, below the sections rather than among them — the owner's §2 Q4. */
  references: string;
  narrowed: string;
  /**
   * The three words a multiplicity needs, and they are the node page's words.
   *
   * `repeatsBadge` is the count, `repeatsCoherent`/`repeatsMeasured` say what one
   * turn costs — two sentences because they are two facts, and a reader choosing
   * between a shot-based readout and a coherent one is choosing on the second.
   * Copied in substance rather than paraphrased: `repository-layers.tsx` already
   * says exactly this about exactly these records, and one fact should read as
   * one fact wherever it is drawn.
   */
  repeatsBadge: (count: string) => string;
  repeatsCoherent: string;
  repeatsMeasured: string;
  coverage: Record<CoverageAnswer, string>;
}

/**
 * The section ids live in `card-content.ts` now, beside the list that orders
 * them, and this file imports the type. It used to be declared here — which was
 * half of the reason the panel and the census could disagree about what a card
 * draws. A `Record<CardSectionId, string>` still means a section added there
 * without a title here is a **type error** in both locales rather than a heading
 * that renders as `undefined` on the map; what is new is that the *order* has
 * one writer as well as the membership.
 */
const COPY: Record<Lang, Copy> = {
  en: {
    lang: "en",
    close: "Close",
    eyebrow: { method: "Method", process: "Process", "own-step": "Unnamed step" },
    openPage: "Open the full record",
    openInner: "Expand it here — a map of just this",
    innerBack: "Back to the card",
    realizes: "Fills the slot",
    // The node page's own words for the same edge (`repository-layers.tsx`,
    // `refinesLabel`). One fact should read as one fact wherever it is drawn.
    refines: "A narrower version of",
    refinedBy: "Narrower versions",
    /**
     * The two gaps, and they say different things on purpose.
     *
     * `noneFound` is the owner's own phrasing — *"terse in text like 'none found
     * yet'"* — and it means a search that came back empty. `noField` cannot
     * borrow it: three of the sections he asked for have nothing anywhere to
     * hold them, and telling a reader "none found yet" about those would report
     * a thin literature when the truth is an unbuilt field. See the block
     * comment in `card-content.ts`.
     */
    noneFound: "None found yet.",
    noField: "No field holds this yet — the model is still being designed.",
    noSlotHere:
      "The method closes this stretch itself, and the vocabulary has no name for it yet. A named step here would be one worth finding.",
    /**
     * The owner's own section names, from `OWNER_TODO` §2.
     *
     * Kept as close to his words as a heading can be. *Requires* was "What it
     * needs" and *Performance* was "Cost, as the sources state it"; both are
     * renames of a section already at 63/63 and 42/63, and neither changes what
     * is read. *Theory* is new as a heading and old as content — it is the
     * chain, which was called "State to state".
     */
    sectionsLabel: "Sections of this card",
    sections: {
      "when-it-applies": "When it applies",
      input: "Input",
      theory: "Theory",
      output: "Output",
      requires: "Requires",
      example: "Example",
      performance: "Performance",
      contested: "Where the claim is contested",
      implementations: "Implementations",
      records: "In the repository",
      contract: "What it takes and returns",
      between: "Between these two states",
      "no-slot": "No named step covers this",
      "why-a-layer": "Why it is a layer at all",
      "filled-by": "Methods that fill it",
      "bypassed-by": "Routes that make it unnecessary",
      "classical-equivalents": "Classical equivalents",
    },
    // Singular. Each names one marked clause, so the legend reads as a key to
    // what is highlighted rather than as a heading over a list — which is the
    // whole difference between this and the two sections it replaced.
    marks: {
      approximation: "approximation",
      assumption: "assumption",
    },
    openStep: "Open this step",
    implementationSections: {
      about: "About",
      methods: "Methods",
      data: "Data",
      code: "Code",
      results: "Results",
    },
    leads: (simulation, hardware) => {
      const parts: string[] = [];
      if (simulation > 0) parts.push(`${simulation} report${simulation === 1 ? "s" : ""} numerics`);
      if (hardware > 0) parts.push(`${hardware} report${hardware === 1 ? "s" : ""} a hardware run`);
      return `Of the papers cited here, ${parts.join(" and ")} — nobody has written those up yet.`;
    },
    takes: "Takes",
    returns: "Returns",
    references: "References",
    narrowed: "narrowed",
    repeatsBadge: LOOP_CLOSURE_COPY.en.badge,
    repeatsCoherent: LOOP_CLOSURE_COPY.en.closure.coherent,
    repeatsMeasured: LOOP_CLOSURE_COPY.en.closure.measured,
    coverage: {
      covered: "Covered in the repository.",
      /**
       * Two answers where the owner asked for three.
       *
       * His third — *"deliberately not a repository thing, for this stated
       * reason"* — needs a field that does not exist, so the card cannot tell it
       * apart from "nobody has got to it". Saying so is the honest form: the
       * alternative is a sentence that quietly claims a judgement nobody made.
       */
      "not-yet":
        "No record covers this yet. Whether that is a gap or deliberate is not something anything on this record can say.",
      deliberate: "Deliberately not a repository record.",
    },
  },
  ja: {
    lang: "ja",
    close: "閉じる",
    eyebrow: { method: "手法", process: "工程", "own-step": "名前のない工程" },
    openPage: "詳細ページを開く",
    openInner: "ここで展開する — これだけの地図",
    innerBack: "カードに戻る",
    realizes: "満たすスロット",
    // The two directions must not read the same. The node page's string names the
    // *broader* method, so it stays as it is; the back-link says whose narrower
    // version the listed methods are, which is the opposite claim.
    refines: "より狭めた版",
    refinedBy: "これをより狭めた版",
    noneFound: "まだ見つかっていません。",
    noField: "これを保持する項目はまだありません。設計中です。",
    noSlotHere:
      "この区間は手法が自ら閉じており、まだ名前のある工程が当てられていません。ここに名前のある工程を見つける価値があります。",
    sectionsLabel: "このカードの項目",
    sections: {
      "when-it-applies": "適用条件",
      input: "入力",
      theory: "理論",
      output: "出力",
      requires: "必要なもの",
      example: "例",
      performance: "性能",
      contested: "主張が争われている点",
      implementations: "実装",
      records: "リポジトリ内",
      contract: "入力と出力",
      between: "この二つの状態のあいだ",
      "no-slot": "名前のある工程がまだありません",
      "why-a-layer": "なぜ層として立てるのか",
      "filled-by": "これを満たす手法",
      "bypassed-by": "これを不要にする経路",
      "classical-equivalents": "古典的な対応物",
    },
    marks: {
      approximation: "近似",
      assumption: "仮定",
    },
    openStep: "この工程を開く",
    implementationSections: {
      about: "概要",
      methods: "手順",
      data: "データ",
      code: "コード",
      results: "結果",
    },
    leads: (simulation, hardware) => {
      const parts: string[] = [];
      if (simulation > 0) parts.push(`${simulation} 件が数値実験を報告`);
      if (hardware > 0) parts.push(`${hardware} 件が実機での実行を報告`);
      return `ここで引用している文献のうち、${parts.join("、")}しています。まだ記述されていません。`;
    },
    takes: "入力",
    returns: "出力",
    references: "文献",
    narrowed: "限定",
    repeatsBadge: LOOP_CLOSURE_COPY.ja.badge,
    repeatsCoherent: LOOP_CLOSURE_COPY.ja.closure.coherent,
    repeatsMeasured: LOOP_CLOSURE_COPY.ja.closure.measured,
    coverage: {
      covered: "リポジトリに記録があります。",
      "not-yet":
        "対応する記録はまだありません。それが欠落なのか意図的なのかは、現在のデータからは判断できません。",
      deliberate: "意図的にリポジトリの対象外としています。",
    },
  },
};

/**
 * The gap note. Terse, loud, and never the same words for the two gaps.
 *
 * `note` overrides the sentence for the one section that has a better one to
 * say: the own-step card's *no named step covers this*, which is a worklist
 * entry rather than a failed search. The `data-gap` attribute is unchanged, so
 * a sweep still counts it as the gap it is.
 */
function Gap({ gap, copy, note }: { gap: CardGap; copy: Copy; note?: string }): React.ReactElement {
  return (
    <p className={`mj-card-gap mj-card-gap--${gap}`} data-gap={gap}>
      {note ?? (gap === "none-recorded" ? copy.noneFound : copy.noField)}
    </p>
  );
}

/**
 * One section — the first of the nesting levels, and no longer a disclosure.
 *
 * > *"card sections horizontally clickable, not a scroll."* — the owner
 *
 * Ten `<details>` in one scrolling column is the thing he was reading when he
 * wrote that: every section is a heading you scroll past to reach the next, and
 * a card with a long Theory buries the eight below it. So the sections became a
 * row of names with **one** section under them.
 *
 * **Every section still renders, and nine of them are `hidden`.** That is the
 * call `map-info-popup.tsx` already made for its five, for the same three
 * reasons: `curl` and a crawler get the whole card whatever `?sec=` says, a
 * reader with JavaScript off can reach any of it, and switching section is a
 * paint rather than a fetch for anyone who has the page. It costs a few
 * kilobytes and buys the card its address back.
 *
 * The gap note stays *inside* an empty section rather than replacing it, for the
 * reason it always did: a section that disappears when empty is
 * indistinguishable from a section nobody wrote.
 */
function Section({
  id,
  copy,
  value,
  showing,
  labelledBy,
  note,
  whenEmpty,
  children,
}: {
  id: CardSectionId;
  copy: Copy;
  value: CardValue<unknown>;
  showing: boolean;
  labelledBy: string;
  note?: string;
  /**
   * Drawn **after** the gap note when the section is empty.
   *
   * One caller: the worklist under an empty Implementations section. It needs
   * its own slot because `children` is discarded when a value is not held — and
   * that is right, since a body written for held content would otherwise render
   * against a value that is not there.
   *
   * Worth recording how this was found. The worklist was written, computed
   * correctly, covered by a passing test, and **drawn nowhere**, because the
   * test measured `card-content.ts` and the discard is in this file. Reading the
   * served page is what caught it: a value present in the layout is not a value
   * visible to a reader.
   */
  whenEmpty?: React.ReactNode;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      className={`mj-card-section${value.held ? "" : " mj-card-section--empty"}`}
      data-section={id}
      // The name is on the tab in the row above, not repeated here. A heading
      // over a single visible section, one line under the same word in the nav,
      // is the duplicate title the owner had just asked to be rid of one level
      // down — so the section is *named* to a screen reader by the control that
      // selected it and drawn without a heading.
      aria-labelledby={labelledBy}
      hidden={!showing}
    >
      <div className="mj-card-section-body">
        {value.held ? (
          children
        ) : (
          <>
            <Gap gap={value.gap} copy={copy} note={note} />
            {whenEmpty}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The id of one name in the row.
 *
 * It is what names the section below to a screen reader, so the section can be
 * drawn without a heading over it. Only one card is ever open — `?card=` is
 * single-valued by design — so a fixed prefix cannot collide with a second card,
 * and the section ids are unique within a card by construction.
 */
function navItemId(id: CardSectionId): string {
  return `mj-card-nav-${id}`;
}

/**
 * The row of section names — the owner's *"horizontally clickable, not a
 * scroll"*.
 *
 * **Links, not buttons, and not `PanelTabs`.** Studio's tab bar is a real ARIA
 * tab widget over client state; this is a set of addresses, and a row of things
 * that change the URL is a `<nav>` rather than a `tablist` — `aria-current` is
 * the word for "the one you are on" when the control is a link. Reusing
 * `PanelTabs` would have meant turning its buttons into anchors, which is a
 * change to Studio's widget and to what it announces.
 *
 * **It wraps rather than scrolling sideways.** Ten names in English measure
 * about 950px against roughly 656px of card, so they do not fit on one line at
 * any plausible padding — and a strip that scrolls horizontally to reach the
 * tenth name is a scroll, which is the thing being removed. Two rows of names a
 * reader can see all of is the honest answer to a list this long.
 *
 * **An empty section keeps its name and looks empty.** That was true of the
 * collapsed headings and is worth more here: a reader now sees all ten states at
 * once instead of scrolling to find out which are gaps.
 */
function SectionNav({
  sections,
  showing,
  hrefFor,
  copy,
}: {
  sections: readonly { id: CardSectionId; value: CardValue<unknown> }[];
  showing: CardSectionId | undefined;
  hrefFor: (id: string) => string | undefined;
  copy: Copy;
}): React.ReactElement {
  return (
    <nav className="mj-card-nav" aria-label={copy.sectionsLabel}>
      {sections.map((section) => {
        const className = `mj-card-nav-item${section.value.held ? "" : " mj-card-nav-item--empty"}`;
        const href = hrefFor(section.id);
        // A name with no address is drawn as a name. The addresses are built
        // from this same list, so a missing one cannot happen — and if it ever
        // does, an unclickable word is the truthful drawing of it. The wrong
        // answer here is a fallback href, which would silently send a reader
        // somewhere they did not ask to go.
        return section.id === showing || href === undefined ? (
          <span
            key={section.id}
            className={section.id === showing ? `${className} is-showing` : className}
            id={navItemId(section.id)}
            aria-current={section.id === showing ? "true" : undefined}
          >
            {copy.sections[section.id]}
          </span>
        ) : (
          <a key={section.id} className={className} id={navItemId(section.id)} href={href}>
            {copy.sections[section.id]}
          </a>
        );
      })}
    </nav>
  );
}

/** The second nesting level, and the last: a named thing with its one-line summary. */
function LinkList({ items }: { items: readonly CardLink[] }): React.ReactElement {
  return (
    <ul className="mj-card-list">
      {items.map((item) => (
        <li key={item.id}>
          <a href={item.href}>{item.label}</a>
          {item.summary ? (
            <p className="mj-card-list-blurb">
              <MathText source={item.summary} />
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * *Requires* — the same list, plus the count for the seven ingredients a source
 * says are needed more than once.
 *
 * **This is where most of `repeats` lives**, which was the surprise: 7 of the 10
 * records key a `feeds` step rather than a hop, so the three readouts' ε^-2 and
 * HHL's two κ's are facts about an *ingredient*. A count drawn only on the chain
 * would have left every one of them exactly where it was — nowhere.
 *
 * The badge is a `<span>` beside the name rather than a line under it because
 * the multiplicity is part of what the ingredient *is* here: a state preparation
 * run once and a state preparation run O(1/ε²) times are the same node and not
 * the same cost, and the reader is scanning the list for exactly that.
 */
function IngredientList({
  items,
  copy,
}: {
  items: readonly CardIngredient[];
  copy: Copy;
}): React.ReactElement {
  return (
    <ul className="mj-card-list">
      {items.map(({ link, repetition }) => (
        <li key={link.id}>
          {/* The space is deliberate and the node page has the same one: an
              `inline-block` badge is not guaranteed to be announced apart from
              the name before it, and "Quantum linear solveruns once per time
              step" is what a reader without the margin gets. */}
          <a href={link.href}>{link.label}</a>{" "}
          {repetition ? <RepeatBadge repetition={repetition} copy={copy} /> : null}
          {link.summary ? (
            <p className="mj-card-list-blurb">
              <MathText source={link.summary} />
            </p>
          ) : null}
          {repetition ? <RepeatNote repetition={repetition} copy={copy} /> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * How many times, in the source's own phrase.
 *
 * `data-closure` is on the element rather than only in the class because the
 * closure is the fact a sweep wants to count — a measured loop and a coherent
 * one at the same count are different prices — and a class name is a styling
 * hook that a restyle is free to rename.
 */
function RepeatBadge({
  repetition,
  copy,
}: {
  repetition: CardRepetition;
  copy: Copy;
}): React.ReactElement {
  return (
    <span
      className={`mj-card-repeat mj-card-repeat--${repetition.closure}`}
      data-closure={repetition.closure}
    >
      {copy.repeatsBadge(repetition.count)}
    </span>
  );
}

/** What one turn costs, then why it turns that many times. Two facts, in order. */
function RepeatNote({
  repetition,
  copy,
}: {
  repetition: CardRepetition;
  copy: Copy;
}): React.ReactElement {
  return (
    <p className="mj-card-repeat-note">
      {repetition.closure === "measured" ? copy.repeatsMeasured : copy.repeatsCoherent}{" "}
      {repetition.note}
    </p>
  );
}

/**
 * **Theory**, which is the chain with the mathematics inside it.
 *
 * The owner's §2 answer, in his own words on the question of whether the chain
 * is Theory's spine or a section beside it: *"go with your preference"* — and
 * the preference he was shown is this one, *"Theory renders the chain as its
 * spine, each hop collapsible and empty until the mathematics is written."*
 *
 * So the hop, not the method, is the unit. Each is shut by default and its
 * summary carries the part that is known — the two states and the slot — which
 * means this reads at exactly the density the flat `<ol>` used to, and opens
 * into the three things a source would add. **Every one of those is empty
 * today**, and each says *no field holds this yet* rather than *none found yet*,
 * because the field is the next piece of work rather than a thin literature.
 *
 * That is the whole argument for doing it this way: Theory is honest on day one
 * and fills in hop by hop, instead of shipping as one section reading "pending"
 * until 63 methods' worth of mathematics is written.
 */
function Theory({ hops, copy }: { hops: readonly CardHop[]; copy: Copy }): React.ReactElement {
  return (
    <ol className="mj-card-trace">
      {hops.map((hop, index) => (
        <li key={`${hop.from}>${hop.to}#${index}`}>
          <details className="mj-card-hop" data-hop={`${hop.from}>${hop.to}`}>
            <summary>
              <span className="mj-card-trace-states">
                {hop.from} → {hop.to}
              </span>
              {hop.via ? (
                <span className="mj-card-hop-via">{hop.via.label}</span>
              ) : (
                <span className="mj-card-trace-own">{ownStepName(copy.lang)}</span>
              )}
              {hop.narrowed ? <span className="mj-card-trace-tag">{copy.narrowed}</span> : null}
              {/* On the summary, so a shut chain already says which of its hops
                  is inside a loop — that is the one thing about this chain a
                  reader would otherwise have to open every hop to learn. The
                  space is the same one the ingredient list carries: a margin is
                  not a word separator to a screen reader. */}{" "}
              {hop.repetition ? <RepeatBadge repetition={hop.repetition} copy={copy} /> : null}
            </summary>
            <div className="mj-card-hop-body">
              {/* **The mathematics first, and no heading over it.** Opening a hop
                  used to print the slot's name again — the same string the
                  summary one line above already carries — and then three
                  headings over three gaps. The owner's answer was both halves at
                  once: *"remove the duplicate title after opening the hops"*,
                  and the two other headings gone because their content belongs
                  inside this prose as marks. What is left is what a reader
                  opened the hop for. */}
              {hop.theory.held ? (
                <TheoryProse spans={hop.theory.value} copy={copy} />
              ) : (
                <Gap gap={hop.theory.gap} copy={copy} />
              )}
              {/* Below the mathematics, because it is a fact about running the
                  hop rather than about what the hop is. The badge above already
                  gave the count; this is what one turn costs and why it turns
                  that many times. */}
              {hop.repetition ? <RepeatNote repetition={hop.repetition} copy={copy} /> : null}
              {/* The way onward, now **below** the mathematics and labelled as an
                  action rather than repeating the step's name. It stays inside
                  the disclosure rather than on the summary because a `<summary>`
                  containing an anchor swallows the click on some engines and
                  toggles instead of following it — so a reader hunting the
                  slot's own page would get the wrong destination, and this
                  summary's job is to toggle. */}
              {hop.via ? (
                <p className="mj-card-hop-onward">
                  <a href={hop.via.href}>{copy.openStep}</a>
                </p>
              ) : null}
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}

/**
 * The mathematics of one hop, with what it approximates and what it assumes
 * marked where they occur.
 *
 * **The owner asked for exactly this and the argument for it is in
 * `theory-marks.ts`**: *"assumptions and approximations will be colored/bolded
 * highlighted/commented within the mathematics, so no need for the sections."*
 *
 * Three things make a coloured span say what it means rather than only that it
 * is special. It carries a name no reader has to guess — the legend below, drawn
 * only when this hop actually marks something, because a legend for marks that
 * are not on the page is furniture. It is distinguishable without colour, by the
 * underline, since a reader who cannot separate the two hues would otherwise be
 * told a clause is *notable* and never which kind. And it says its kind to a
 * screen reader in words, because a colour is not read aloud at all.
 */
function TheoryProse({
  spans,
  copy,
}: {
  spans: readonly TheorySpan[];
  copy: Copy;
}): React.ReactElement {
  const marked = THEORY_MARKS.filter((mark) => spans.some((span) => span.mark === mark));
  return (
    <>
      <p className="mj-card-hop-math">
        {spans.map((span, index) =>
          span.mark === null ? (
            <span key={index}>
              <MathText source={span.text} />
            </span>
          ) : (
            <span
              key={index}
              className={`mj-card-hop-mark mj-card-hop-mark--${span.mark}`}
              data-mark={span.mark}
            >
              <span className="sr-only">{copy.marks[span.mark]}: </span>
              <MathText source={span.text} />
            </span>
          ),
        )}
      </p>
      {marked.length > 0 ? (
        <p className="mj-card-hop-key">
          {/* No separator between them: the row is a flex with a gap, and a
              space written inside a marked span is a space wearing that mark's
              underline. */}
          {marked.map((mark) => (
            <span key={mark} className={`mj-card-hop-mark mj-card-hop-mark--${mark}`}>
              {copy.marks[mark]}
            </span>
          ))}
        </p>
      ) : null}
    </>
  );
}

function Refinement({ card, copy }: { card: MethodCard; copy: Copy }): React.ReactElement | null {
  if (card.refines === null && card.refinedBy.length === 0) return null;
  return (
    <p className="mj-card-refinement">
      {card.refines ? (
        <span className="mj-card-refines">
          {copy.refines}: <a href={card.refines.href}>{card.refines.label}</a>
        </span>
      ) : null}
      {card.refinedBy.length > 0 ? (
        <span className="mj-card-refined-by">
          {copy.refinedBy}:{" "}
          {card.refinedBy.map((child, index) => (
            <span key={child.id}>
              {index > 0 ? ", " : null}
              <a href={child.href}>{child.label}</a>
            </span>
          ))}
        </span>
      ) : null}
    </p>
  );
}

/**
 * The implementations tree — the shape the owner approved, and the one place
 * this card goes three levels deep.
 *
 * *"Say yes and I build it."* — *"yes."* Section, then one entry per
 * implementation, then his five sub-sections: About, Methods, Data, Code,
 * Results. The paper is an **attribute** of the entry rather than the root of
 * the tree, because one paper can hold two implementations and one
 * implementation can be described by two papers — a tree rooted at papers
 * cannot express either case without duplicating a node.
 *
 * **Three levels is his ceiling, not a breach of it.** The bound he set was
 * *"don't go more than like 2-3 layers deep though, that would be an
 * unnecessary replacement for the user actually navigating the map itself"* —
 * and this file previously wrote that down as two, which was a tightening
 * nobody asked for. Three is what he bounded and what he signed off. The
 * sub-sections are plain blocks rather than a third `<details>`: a reader who
 * has opened an implementation wants to read it, not to open five more things.
 */
function Implementations({
  entries,
  copy,
}: {
  entries: readonly CardImplementation[];
  copy: Copy;
}): React.ReactElement {
  return (
    <ul className="mj-card-list mj-card-implementations">
      {entries.map((entry) => (
        <li key={entry.id}>
          <details className="mj-card-implementation" data-implementation={entry.id}>
            <summary>{entry.label}</summary>
            <div className="mj-card-implementation-body">
              {/* Zero papers is a real value — his "implementations that aren't
                  papers but proven to be run" — so this draws nothing rather
                  than a gap note when there are none. */}
              {entry.papers.length > 0 ? (
                <ul className="mj-card-list">
                  {entry.papers.map((paper) => (
                    <li key={paper.url}>
                      <a href={paper.url} rel="noreferrer">
                        {paper.title}
                      </a>
                      <p className="mj-card-list-blurb">
                        {paper.authors} · {paper.year}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
              {entry.sections.map((section) => (
                <div key={section.id} className="mj-card-hop-slot" data-implementation-section={section.id}>
                  <p className="mj-card-hop-slot-name">{copy.implementationSections[section.id]}</p>
                  {section.value.held ? (
                    <p>
                      <MathText source={section.value.value} />
                    </p>
                  ) : (
                    <Gap gap={section.value.gap} copy={copy} />
                  )}
                </div>
              ))}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

/**
 * What the register says the cited papers report, printed under an empty
 * Implementations section.
 *
 * `W5-card-spec.md`'s rule for an empty card is that it is a **worklist**, not a
 * gap report — the owner's *"while populating 'what would have to exist to
 * connect them', we may come across papers that provide the connections"*. This
 * is that rule applied to this section: the gap note stays, and beside it goes
 * the one fact that makes the gap actionable.
 *
 * Draws nothing when no cited paper has been read for it, because a count of
 * zero and an absence of counting are different facts and only one of them is
 * a lead.
 */
function Leads({
  leads,
  copy,
}: {
  leads: CardValue<{ simulation: number; hardware: number }>;
  copy: Copy;
}): React.ReactElement | null {
  if (!leads.held) return null;
  const { simulation, hardware } = leads.value;
  // Nothing to say when the read papers report neither. The gap note above has
  // already said the section is empty, and "0 of them report numerics" adds a
  // number where the honest answer is silence.
  if (simulation === 0 && hardware === 0) return null;
  return <p className="mj-card-leads">{copy.leads(simulation, hardware)}</p>;
}

/** The contract, drawn as one half of itself. See the `input`/`output` note below. */
function ContractHalf({
  contract,
  half,
  copy,
}: {
  contract: CardValue<{ takes: string; returns: string }>;
  half: "takes" | "returns";
  copy: Copy;
}): React.ReactElement | null {
  if (!contract.held) return null;
  return (
    <p>
      <MathText source={half === "takes" ? contract.value.takes : contract.value.returns} />
    </p>
  );
}

/**
 * What goes inside a section, given its id.
 *
 * **A `switch` over the id union, and that is the point of the shape.** The
 * order and the membership come from `cardSections`; this decides only what the
 * body draws. A section added there with no arm here is a TypeScript error at
 * the `never` below — so the failure mode is a build that stops, rather than a
 * heading that opens onto nothing.
 */
function Body({ card, id, copy }: { card: Card; id: CardSectionId; copy: Copy }): React.ReactNode {
  switch (id) {
    case "when-it-applies":
      return card.kind === "method" && card.whenItApplies.held ? (
        <p>
          <MathText source={card.whenItApplies.value} />
        </p>
      ) : null;
    // **One contract, drawn twice.** The owner asked for Input and Output as two
    // of his seven; the graph holds one `contract` record with `takes` and
    // `returns` on it. Splitting the *drawing* is his ask. Splitting the *value*
    // would be two answers to "is the contract recorded" that could disagree.
    case "input":
      return card.kind === "own-step" || card.kind === "method" || card.kind === "process" ? (
        <ContractHalf contract={card.contract} half="takes" copy={copy} />
      ) : null;
    case "output":
      return <ContractHalf contract={card.contract} half="returns" copy={copy} />;
    case "theory":
      return card.kind === "method" && card.trace.held ? (
        <Theory hops={card.trace.value} copy={copy} />
      ) : null;
    case "requires":
      return card.kind === "method" && card.ingredients.held ? (
        <IngredientList items={card.ingredients.value} copy={copy} />
      ) : null;
    case "performance":
      return card.kind === "method" && card.cost.held ? (
        <p>
          <MathText source={card.cost.value} />
        </p>
      ) : null;
    case "contested":
      return card.kind === "method" && card.contested.held ? (
        <p>
          <MathText source={card.contested.value} />
        </p>
      ) : null;
    case "records":
      return card.kind !== "own-step" && card.records.held ? (
        <ul className="mj-card-list">
          {card.records.value.map((record) => (
            <li key={record.slug}>
              <a href={record.href}>{record.title}</a>
              {record.description ? <p className="mj-card-list-blurb">{record.description}</p> : null}
            </li>
          ))}
        </ul>
      ) : null;
    case "contract":
      return card.contract.held ? (
        <dl className="mj-card-dl">
          <div>
            <dt>{copy.takes}</dt>
            <dd>
              <MathText source={card.contract.value.takes} />
            </dd>
          </div>
          <div>
            <dt>{copy.returns}</dt>
            <dd>
              <MathText source={card.contract.value.returns} />
            </dd>
          </div>
        </dl>
      ) : null;
    case "between":
      return card.kind === "own-step" ? (
        <ol className="mj-card-trace">
          <li>
            <code>{card.from}</code>
            <span aria-hidden="true"> ⟶ </span>
            <code>{card.to}</code>
            <span className="mj-card-trace-own">{ownStepName(copy.lang)}</span>
          </li>
        </ol>
      ) : null;
    case "why-a-layer":
      return card.kind === "process" && card.whyALayer.held ? (
        <p>
          <MathText source={card.whyALayer.value} />
        </p>
      ) : null;
    case "filled-by":
      return card.kind === "process" && card.filledBy.held ? <LinkList items={card.filledBy.value} /> : null;
    case "bypassed-by":
      return card.kind === "process" && card.bypassedBy.held ? (
        <LinkList items={card.bypassedBy.value} />
      ) : null;
    case "example":
      return card.kind === "method" && card.example.held ? (
        <>
          {card.example.value.text ? (
            <p>
              <MathText source={card.example.value.text} />
            </p>
          ) : null}
          {/* Not localised, and the card says why by not offering a second one:
              the identifiers are the record's own symbols. `<pre>` rather than a
              prose block because whitespace is the only structure pseudocode
              has. */}
          {card.example.value.pseudocode ? (
            <pre className="mj-card-pseudocode">
              <code>{card.example.value.pseudocode}</code>
            </pre>
          ) : null}
        </>
      ) : null;
    case "implementations":
      return card.kind === "method" && card.implementations.held ? (
        <Implementations entries={card.implementations.value} copy={copy} />
      ) : null;
    // The last one holding nothing anywhere: the classical column the owner
    // asked for beside `bypasses`, which still has no field. It draws its gap
    // note and no body, and the note is `no-field-yet` — an unbuilt field, never
    // a thin literature.
    case "classical-equivalents":
    case "no-slot":
      return null;
    default: {
      const unreachable: never = id;
      return unreachable;
    }
  }
}

export function MapCardPanel({
  card,
  closeHref,
  section,
  sectionHrefs,
  locale,
  figure = null,
  innerHref = null,
  innerCloseHref = null,
}: {
  card: Card | null;
  closeHref: string;
  /**
   * Which section `?sec=` named, or null for the card's own first.
   *
   * Resolved on the server, against the list this card actually has — see
   * `parseCardSection` in `lib/repository/map-card.ts` for why it is a parameter
   * at all and why a value naming nothing falls back rather than blanking.
   */
  section: CardSectionId | null;
  /** One address per section of this card, built by the component that has the card. */
  sectionHrefs: Record<string, string>;
  locale: PublicLocale;
  /**
   * The truncated map (`?inner=`), server-rendered, or null when none is open.
   *
   * Markup rather than data, for the reason `sectionHrefs` is a map rather
   * than a function: this is a client component, and the figure is a join of
   * the graph, the vocabulary and the layout that only the server component
   * holding all three can make. When it is non-null the sections are `hidden`
   * — still in the document for `curl`, a crawler and a reader with
   * JavaScript off, exactly like the nine sections `?sec=` is not showing.
   *
   * **This panel never renders a second `MapCardPanel`**, and the truncated
   * map cannot make it: every name inside the figure is a `withCard` link that
   * retargets *this* panel's own `?card=` (dropping `inner` and `iopen` — the
   * owner's reset), so a card inside a card — the second map the whole design
   * is bounded against — has no code path that produces it.
   */
  figure?: React.ReactNode;
  /**
   * The control that opens the truncated map, or null on a card that must not
   * have one. The parent decides, because the parent holds the graph: a
   * process card whose slot the layout can draw, and a method card with an
   * interior, get an address; the own-step card gets null.
   *
   * **A state card must never get one.** The owner, verbatim: *"Opening states
   * doesn't have this functionality — you can only go back to where you were,
   * since you can't click into states further."* The `Card` union has no state
   * kind today (`method | process | own-step`), so the refusal is structural
   * rather than enforced — this comment is the tripwire for the session that
   * adds one: when the state card lands (W5 slice three), it passes null here,
   * and a test pinning that belongs beside it.
   */
  innerHref?: string | null;
  /** Back from the truncated map to the card it opened from — same section,
   * `?inner=` and `?iopen=` gone. Null whenever `figure` is. */
  innerCloseHref?: string | null;
}): React.ReactElement {
  const lang: Lang = locale === "ja" ? "ja" : "en";
  const copy = COPY[lang];
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const open = card !== null;

  // Read off `window.location` rather than `closeHref`, for the reason
  // `map-info-popup.tsx` records: `InfiniteCanvas` writes the live viewport into
  // the URL with a debounced `replaceState`, so after a pan the server-rendered
  // `closeHref` names somewhere the reader is no longer standing.
  const closeRef = useRef<() => void>(() => undefined);
  closeRef.current = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("card");
    // Everything that only means something *inside* the card goes with it —
    // the same four deletions `withCard(base, null)` makes, because Escape and
    // the backdrop are the close link by another gesture. Leaving `inner` or
    // `iopen` behind would strand an address claiming a truncated map inside a
    // card that is shut, and the next `?card=` would inherit an expansion the
    // reader never made there.
    url.searchParams.delete("sec");
    url.searchParams.delete("inner");
    url.searchParams.delete("iopen");
    router.push(`${url.pathname}${url.search}`, { scroll: false });
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const titleId = "mj-card-title";
  // **Read once.** The row of names and the sections under it are two drawings
  // of one list, and session 114's defect was exactly two lists of the same
  // sections that nothing compared. `showing` falls back to the first section
  // rather than to nothing: `?sec=` naming something this card does not have is
  // a stale link, and a stale link must not blank a card that opened fine.
  const sections = card === null ? [] : cardSections(card);
  const showing = sections.find((entry) => entry.id === section) ?? sections[0];
  return (
    <div
      className="mj-card-backdrop"
      role="presentation"
      hidden={!open}
      // mousedown, not click: a drag that starts inside the panel (selecting a
      // sentence) and ends over the backdrop fires `click` on the backdrop and
      // would dismiss a panel somebody is reading.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      <div
        // The one width step the truncated map gets (W9 step 5): a wider panel
        // while a figure is inside, from CSS alone. The owner asked to *"expand
        // the screen of this now truncated map"*; a size **parameter** was
        // considered and deliberately not built — no address until he asks for
        // one, and a class the server sets from `?inner=` is already
        // curl-visible and JavaScript-free.
        className={figure === null ? "mj-card" : "mj-card mj-card--inner"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
      >
        <a className="mj-icon-button mj-card-close" href={closeHref} aria-label={copy.close} title={copy.close}>
          ×
        </a>
        {card === null ? null : (
          <>
            <p className="mj-card-eyebrow">{copy.eyebrow[card.kind]}</p>
            <h2 id={titleId}>{card.label}</h2>
            <p className="mj-card-lede">
              <MathText source={card.summary} />
            </p>
            {card.kind === "method" ? <Refinement card={card} copy={copy} /> : null}
            {/* **First, and not last.** The card is a preview; the record is the
                page. A panel that buries the way onward is the "replacement for
                navigating the map" the owner ruled out. */}
            <p className="mj-card-onward">
              <a href={card.pageHref}>{copy.openPage}</a>
              {card.kind === "method" && card.realizes ? (
                <span className="mj-card-realizes">
                  {copy.realizes}: <a href={card.realizes.href}>{card.realizes.label}</a>
                </span>
              ) : null}
              {/* The truncated map's open control — the owner's step (2),
                  *"click the process to expand it further"*. Only while no
                  figure is open: with one open, this address is where the
                  reader already is, and a control that goes nowhere teaches
                  distrust of the row it sits in. Null on every card that must
                  not have one — see the prop's comment, which is where the
                  state-card exclusion is recorded. */}
              {innerHref !== null && figure === null ? (
                <a className="mj-card-expand" href={innerHref}>
                  {copy.openInner}
                </a>
              ) : null}
            </p>

            {/* The truncated map, when one is open (`?inner=`). The sections
                below stay in the document, `hidden` — the same rule the nine
                unshowing sections already follow — so `curl` gets the whole
                card *and* the figure whatever the address says. */}
            {figure !== null ? (
              <div className="mj-card-inner">
                {innerCloseHref !== null ? (
                  <p className="mj-card-inner-back">
                    <a href={innerCloseHref}>{copy.innerBack}</a>
                  </p>
                ) : null}
                {figure}
              </div>
            ) : null}

            {/* **The order is read, not written here.** `cardSections` is the
                one list, and until session 114 this file held a second one in a
                different order that nothing compared against it — so a section
                could have left the drawing while the census went on counting it.
                The owner's §2 answer is an order, which is exactly the thing
                that had no single writer. It is read once, here, and both the
                row of names and the sections under it are built from it. */}
            <div className="mj-card-sections" hidden={figure !== null}>
              <SectionNav
                sections={sections}
                showing={showing?.id}
                hrefFor={(id) => sectionHrefs[id]}
                copy={copy}
              />

              <div className="mj-card-body" role="region" aria-labelledby={titleId} tabIndex={0}>
                {sections.map((section) => (
                  <Section
                    key={section.id}
                    id={section.id}
                    copy={copy}
                    value={section.value}
                    showing={section.id === showing?.id}
                    labelledBy={navItemId(section.id)}
                    note={section.id === "no-slot" ? copy.noSlotHere : undefined}
                    // **The worklist behind the gap.** An empty Implementations
                    // section says "none found yet", which a reader takes for a
                    // verdict on the literature. This says what the register
                    // already knows — how many of the papers cited here report
                    // numerics or a hardware run — so the emptiness reads as work
                    // nobody has done rather than as an absence of work to do.
                    whenEmpty={
                      section.id === "implementations" && card.kind === "method" ? (
                        <Leads leads={card.implementationLeads} copy={copy} />
                      ) : undefined
                    }
                  >
                    <Body card={card} id={section.id} copy={copy} />
                  </Section>
                ))}

                {/* **References, below the sections and not among them.** The owner
                    was asked whether a reference list should be an eighth section
                    and said *"confirm, it isn't needed for papers to be their own
                    section"*. They are 63/63 on methods, so they are never a gap,
                    and a collapsible heading over a list that is always full is a
                    control with one state.

                    The own stretch carries none: it is a piece of a route rather
                    than a node, so a paper list there would claim a search that has
                    no subject. */}
                {card.kind !== "own-step" && card.papers.held ? (
                  <section className="mj-card-references">
                    <h3>{copy.references}</h3>
                    <ul className="mj-card-list">
                      {card.papers.value.map((paper) => (
                        <li key={paper.url}>
                          <a href={paper.url} rel="noreferrer">
                            {paper.title}
                          </a>
                          <p className="mj-card-list-blurb">
                            {paper.authors} · {paper.year}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {card.kind === "process" ? (
                  <p className="mj-card-coverage" data-coverage={card.coverage}>
                    {copy.coverage[card.coverage]}
                  </p>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
