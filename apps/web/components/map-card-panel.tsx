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
 * **Two levels of nesting, and that is a ceiling rather than a coincidence.**
 * The owner bounded this explicitly: *"don't go more than like 2-3 layers deep
 * though, that would be an unnecessary replacement for the user actually
 * navigating the map itself."* A section is level one, an item inside it is
 * level two, and an item's own children are a link to the map rather than a
 * third `<details>`. A card that can traverse the graph has taken the map's job.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import type {
  Card,
  CardGap,
  CoverageAnswer,
  CardHop,
  CardLink,
  CardValue,
  MethodCard,
  OwnStepCard,
  ProcessCard,
} from "../lib/repository/card-content";
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
  noneFound: string;
  noField: string;
  /** The worklist line on the own-step card. See `OwnStepSections`. */
  noSlotHere: string;
  sections: Record<CardSectionId, string>;
  takes: string;
  returns: string;
  narrowed: string;
  coverage: Record<CoverageAnswer, string>;
}

/**
 * Every section id a card can draw, and the reason it is written out here.
 *
 * `cardSections` in `card-content.ts` produces exactly these, and a `Record` of
 * them means a section added there without a title here is a **type error** in
 * both locales rather than a heading that renders as `undefined` on the map.
 */
type CardSectionId =
  | "contract"
  | "trace"
  | "when-it-applies"
  | "cost"
  | "approximations"
  | "assumptions"
  | "contested"
  | "ingredients"
  | "theory-trace"
  | "implementations"
  | "papers"
  | "records"
  | "between"
  | "no-slot"
  | "why-a-layer"
  | "filled-by"
  | "bypassed-by"
  | "classical-equivalents";

const COPY: Record<Lang, Copy> = {
  en: {
    lang: "en",
    close: "Close",
    eyebrow: { method: "Method", process: "Process", "own-step": "Unnamed step" },
    openPage: "Open the full record",
    realizes: "Fills the slot",
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
    sections: {
      contract: "What it takes and returns",
      trace: "State to state",
      "when-it-applies": "When it applies",
      cost: "Cost, as the sources state it",
      approximations: "Approximations made",
      assumptions: "Assumptions needed",
      contested: "Where the claim is contested",
      ingredients: "What it needs",
      "theory-trace": "The theory, state to state",
      implementations: "Implementations",
      papers: "Papers",
      records: "In the repository",
      between: "Between these two states",
      "no-slot": "No named step covers this",
      "why-a-layer": "Why it is a layer at all",
      "filled-by": "Methods that fill it",
      "bypassed-by": "Routes that make it unnecessary",
      "classical-equivalents": "Classical equivalents",
    },
    takes: "Takes",
    returns: "Returns",
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
    noneFound: "まだ見つかっていません。",
    noField: "これを保持する項目はまだありません。設計中です。",
    noSlotHere:
      "この区間は手法が自ら閉じており、まだ名前のある工程が当てられていません。ここに名前のある工程を見つける価値があります。",
    sections: {
      contract: "入力と出力",
      trace: "状態から状態へ",
      "when-it-applies": "適用条件",
      cost: "文献が述べる計算量",
      approximations: "用いた近似",
      assumptions: "必要な仮定",
      contested: "主張が争われている点",
      ingredients: "必要なもの",
      "theory-trace": "状態間の理論",
      implementations: "実装",
      papers: "文献",
      records: "リポジトリ内",
      between: "この二つの状態のあいだ",
      "no-slot": "名前のある工程がまだありません",
      "why-a-layer": "なぜ層として立てるのか",
      "filled-by": "これを満たす手法",
      "bypassed-by": "これを不要にする経路",
      "classical-equivalents": "古典的な対応物",
    },
    takes: "入力",
    returns: "出力",
    narrowed: "限定",
    coverage: {
      covered: "リポジトリに記録があります。",
      "not-yet":
        "対応する記録はまだありません。それが欠落なのか意図的なのかは、現在のデータからは判断できません。",
      deliberate: "意図的にリポジトリの対象外としています。",
    },
  },
};

/** The gap note. Terse, loud, and never the same words for the two gaps. */
function Gap({ gap, copy }: { gap: CardGap; copy: Copy }): React.ReactElement {
  return (
    <p className={`mj-card-gap mj-card-gap--${gap}`} data-gap={gap}>
      {gap === "none-recorded" ? copy.noneFound : copy.noField}
    </p>
  );
}

/**
 * One section — the first of the two nesting levels.
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
  children,
}: {
  id: CardSectionId;
  copy: Copy;
  value: CardValue<unknown>;
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
        {value.held ? children : <Gap gap={value.gap} copy={copy} />}
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

function Trace({ hops, copy }: { hops: readonly CardHop[]; copy: Copy }): React.ReactElement {
  return (
    <ol className="mj-card-trace">
      {hops.map((hop, index) => (
        <li key={`${hop.from}>${hop.to}#${index}`}>
          <span className="mj-card-trace-states">
            {hop.from} → {hop.to}
          </span>
          {hop.via ? (
            <a href={hop.via.href}>{hop.via.label}</a>
          ) : (
            <span className="mj-card-trace-own">{ownStepName(copy.lang)}</span>
          )}
          {hop.narrowed ? <span className="mj-card-trace-tag">{copy.narrowed}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * The card for the stretch a method performs itself.
 *
 * **Short on purpose.** It answers the three questions the drawing raises and
 * stops: which two states, which method, and why there is no name on it. The
 * temptation is to pad it out with the method's cost and papers so it looks like
 * the others — those belong to the method, which is one click away and named
 * here, and copying them onto a piece of it is the duplication rule's exact
 * shape.
 *
 * The last line is the **worklist** `W5-card-spec.md` asks for: the owner's
 * *"while populating 'what would have to exist to connect them', we may come
 * across papers that provide the connections"*. It says a named step is wanted
 * here rather than that something is broken here.
 */
function OwnStepSections({ card, copy }: { card: OwnStepCard; copy: Copy }): React.ReactElement {
  return (
    <>
      <details className="mj-card-section" data-section="between" open>
        <summary>{copy.sections.between}</summary>
        <div className="mj-card-section-body">
          <ol className="mj-card-trace">
            <li>
              <code>{card.from}</code>
              <span aria-hidden="true"> ⟶ </span>
              <code>{card.to}</code>
              <span className="mj-card-trace-own">{ownStepName(copy.lang)}</span>
            </li>
          </ol>
        </div>
      </details>
      <Section id="contract" copy={copy} value={card.contract}>
        {card.contract.held ? (
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
        ) : null}
      </Section>
      <details className="mj-card-section mj-card-section--empty" data-section="no-slot" open>
        <summary>{copy.sections["no-slot"]}</summary>
        <div className="mj-card-section-body">
          <p className="mj-card-gap mj-card-gap--none-recorded" data-gap="none-recorded">
            {copy.noSlotHere}
          </p>
        </div>
      </details>
    </>
  );
}

function MethodSections({ card, copy }: { card: MethodCard; copy: Copy }): React.ReactElement {
  return (
    <>
      <Section id="contract" copy={copy} value={card.contract}>
        {card.contract.held ? (
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
        ) : null}
      </Section>
      <Section id="when-it-applies" copy={copy} value={card.whenItApplies}>
        {card.whenItApplies.held ? <p>{card.whenItApplies.value}</p> : null}
      </Section>
      <Section id="trace" copy={copy} value={card.trace}>
        {card.trace.held ? <Trace hops={card.trace.value} copy={copy} /> : null}
      </Section>
      <Section id="theory-trace" copy={copy} value={card.theoryTrace} />
      <Section id="cost" copy={copy} value={card.cost}>
        {card.cost.held ? <p>{card.cost.value}</p> : null}
      </Section>
      <Section id="approximations" copy={copy} value={card.approximations} />
      <Section id="assumptions" copy={copy} value={card.assumptions} />
      <Section id="contested" copy={copy} value={card.contested}>
        {card.contested.held ? <p>{card.contested.value}</p> : null}
      </Section>
      <Section id="ingredients" copy={copy} value={card.ingredients}>
        {card.ingredients.held ? <LinkList items={card.ingredients.value} /> : null}
      </Section>
      <Section id="implementations" copy={copy} value={card.implementations} />
    </>
  );
}

function ProcessSections({ card, copy }: { card: ProcessCard; copy: Copy }): React.ReactElement {
  return (
    <>
      <Section id="contract" copy={copy} value={card.contract}>
        {card.contract.held ? (
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
        ) : null}
      </Section>
      <Section id="why-a-layer" copy={copy} value={card.whyALayer}>
        {card.whyALayer.held ? <p>{card.whyALayer.value}</p> : null}
      </Section>
      <Section id="filled-by" copy={copy} value={card.filledBy}>
        {card.filledBy.held ? <LinkList items={card.filledBy.value} /> : null}
      </Section>
      <Section id="bypassed-by" copy={copy} value={card.bypassedBy}>
        {card.bypassedBy.held ? <LinkList items={card.bypassedBy.value} /> : null}
      </Section>
      <Section id="classical-equivalents" copy={copy} value={card.classicalEquivalents} />
    </>
  );
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
              {card.kind === "own-step" ? (
                <OwnStepSections card={card} copy={copy} />
              ) : card.kind === "method" ? (
                <MethodSections card={card} copy={copy} />
              ) : (
                <ProcessSections card={card} copy={copy} />
              )}

              {/* Papers and records belong to a node. The own stretch is not one
                  — it is a piece of a route — so it carries neither, and the
                  honest thing is to draw no section rather than one saying "none
                  found yet", which would claim a search that has no subject. */}
              {card.kind === "own-step" ? null : (
                <>
                  <Section id="papers" copy={copy} value={card.papers}>
                {card.papers.held ? (
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
                ) : null}
              </Section>

              <Section id="records" copy={copy} value={card.records}>
                {card.records.held ? (
                  <ul className="mj-card-list">
                    {card.records.value.map((record) => (
                      <li key={record.slug}>
                        <a href={record.href}>{record.title}</a>
                        {record.description ? (
                          <p className="mj-card-list-blurb">{record.description}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Section>
                </>
              )}
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
