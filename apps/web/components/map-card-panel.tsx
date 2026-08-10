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
  CardLink,
  CardValue,
  HopSlotId,
  ImplementationSectionId,
  MethodCard,
  OwnStepCard,
  ProcessCard,
} from "../lib/repository/card-content";
import { cardSections, HOP_SLOTS } from "../lib/repository/card-content";
import { ownStepName } from "../lib/repository/converge-layout";
import type { PublicLocale } from "../lib/public-locale";

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
  realizes: string;
  /** The two directions of `refines`. See `Refinement` below for why they are chrome. */
  refines: string;
  refinedBy: string;
  noneFound: string;
  noField: string;
  /** The worklist line on the own-step card. See the `no-slot` arm of `Body`. */
  noSlotHere: string;
  sections: Record<CardSectionId, string>;
  /** The three slots inside a hop of Theory. See `CardHop` in `card-content.ts`. */
  hopSlots: Record<HopSlotId, string>;
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
    hopSlots: {
      theory: "The mathematics",
      approximations: "Approximations made here",
      assumptions: "Assumptions needed here",
    },
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
    hopSlots: {
      theory: "数理",
      approximations: "ここで用いた近似",
      assumptions: "ここで必要な仮定",
    },
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
 * One section — the first of the nesting levels.
 *
 * `open` defaults to whether the section holds anything, so a card opens showing
 * what it has and folded over what it does not. The gap note is *inside* the
 * collapsed section rather than replacing it, because a section that disappears
 * when empty is indistinguishable from a section nobody wrote.
 */
function Section({
  id,
  copy,
  value,
  note,
  children,
}: {
  id: CardSectionId;
  copy: Copy;
  value: CardValue<unknown>;
  note?: string;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <details
      className={`mj-card-section${value.held ? "" : " mj-card-section--empty"}`}
      data-section={id}
      open={value.held}
    >
      <summary>{copy.sections[id]}</summary>
      <div className="mj-card-section-body">
        {value.held ? children : <Gap gap={value.gap} copy={copy} note={note} />}
      </div>
    </details>
  );
}

/** The second nesting level, and the last: a named thing with its one-line summary. */
function LinkList({ items }: { items: readonly CardLink[] }): React.ReactElement {
  return (
    <ul className="mj-card-list">
      {items.map((item) => (
        <li key={item.id}>
          <a href={item.href}>{item.label}</a>
          {item.summary ? <p className="mj-card-list-blurb">{item.summary}</p> : null}
        </li>
      ))}
    </ul>
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
            </summary>
            <div className="mj-card-hop-body">
              {/* The link out of the hop, inside the disclosure rather than on
                  the summary. A `<summary>` that contains an anchor swallows the
                  click on some engines and toggles instead of following it, so a
                  reader hunting the slot's own page gets the wrong destination —
                  and this summary's job is to toggle. */}
              {hop.via ? (
                <p className="mj-card-hop-onward">
                  <a href={hop.via.href}>{hop.via.label}</a>
                </p>
              ) : null}
              {HOP_SLOTS.map((slot) => (
                <div key={slot} className="mj-card-hop-slot" data-hop-slot={slot}>
                  <p className="mj-card-hop-slot-name">{copy.hopSlots[slot]}</p>
                  {hop[slot].held ? (
                    <p>{hop[slot].value}</p>
                  ) : (
                    <Gap gap={hop[slot].gap} copy={copy} />
                  )}
                </div>
              ))}
            </div>
          </details>
        </li>
      ))}
    </ol>
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
                    <p>{section.value.value}</p>
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
}): React.ReactElement {
  return (
    <>
      <Gap gap="none-recorded" copy={copy} />
      {leads.held && (leads.value.simulation > 0 || leads.value.hardware > 0) ? (
        <p className="mj-card-leads">
          {copy.leads(leads.value.simulation, leads.value.hardware)}
        </p>
      ) : null}
    </>
  );
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
    <p>{half === "takes" ? contract.value.takes : contract.value.returns}</p>
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
      return card.kind === "method" && card.whenItApplies.held ? <p>{card.whenItApplies.value}</p> : null;
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
        <LinkList items={card.ingredients.value} />
      ) : null;
    case "performance":
      return card.kind === "method" && card.cost.held ? <p>{card.cost.value}</p> : null;
    case "contested":
      return card.kind === "method" && card.contested.held ? <p>{card.contested.value}</p> : null;
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
            <dd>{card.contract.value.takes}</dd>
          </div>
          <div>
            <dt>{copy.returns}</dt>
            <dd>{card.contract.value.returns}</dd>
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
      return card.kind === "process" && card.whyALayer.held ? <p>{card.whyALayer.value}</p> : null;
    case "filled-by":
      return card.kind === "process" && card.filledBy.held ? <LinkList items={card.filledBy.value} /> : null;
    case "bypassed-by":
      return card.kind === "process" && card.bypassedBy.held ? (
        <LinkList items={card.bypassedBy.value} />
      ) : null;
    case "example":
      return card.kind === "method" && card.example.held ? (
        <>
          {card.example.value.text ? <p>{card.example.value.text}</p> : null}
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
      return card.kind !== "method" ? null : card.implementations.held ? (
        <Implementations entries={card.implementations.value} copy={copy} />
      ) : (
        // **The worklist behind the gap.** An empty section says "none found
        // yet", which a reader takes for a verdict on the literature. This says
        // what the register already knows — how many of the papers cited here
        // report numerics or a hardware run — so the emptiness reads as work
        // nobody has done rather than as an absence of work to do.
        <Leads leads={card.implementationLeads} copy={copy} />
      );
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
  locale,
}: {
  card: Card | null;
  closeHref: string;
  locale: PublicLocale;
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
        className="mj-card"
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
            <p className="mj-card-lede">{card.summary}</p>
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
            </p>

            <div className="mj-card-body" role="region" aria-labelledby={titleId} tabIndex={0}>
              {/* **The order is read, not written here.** `cardSections` is the
                  one list, and until session 114 this file held a second one in
                  a different order that nothing compared against it — so a
                  section could have left the drawing while the census went on
                  counting it. The owner's §2 answer is an order, which is
                  exactly the thing that had no single writer. */}
              {cardSections(card).map((section) => (
                <Section
                  key={section.id}
                  id={section.id}
                  copy={copy}
                  value={section.value}
                  note={section.id === "no-slot" ? copy.noSlotHere : undefined}
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
          </>
        )}
      </div>
    </div>
  );
}
