// The preface on `/repository` — roadmap §0.5.1, owner direction 2026-08-06.
//
// > *"preface with explanation"* … *"the search bar and navigation should be
// > crystal clear and not too complicated"*
//
// ## Why a preface, when the page already had a heading and a sentence
//
// The page opened straight into a control bar over 283 cards. A reader arriving
// from a search engine had no way to learn, before touching a control, what kind
// of thing these records are or what the site is claiming about them — and the
// controls themselves cannot teach it, because a filter answers "which of these"
// and never "what are these".
//
// ## What it may and may not say
//
// **Every number here is counted from the corpus in hand.** Not one is written
// into a string. The rule is the one `repository-browser.tsx` already states for
// its topic counts: a number typed into a translated sentence is a second copy
// of a fact, it drifts the first time the corpus moves, and nothing fails when
// it does — least of all in a paragraph whose whole purpose is to be believed
// before anything else on the page.
//
// And it states what the catalogue is **not**. 163 of the records pin no gate
// sequence; a preface that described a database of runnable circuits would be
// selling the 120 and quietly including the other 163 in the count.
import type { PublicLocale } from "../lib/public-locale";
import type { PublicRepositoryListEntry } from "../lib/repository/types";
import { PUBLIC_REPOSITORY_CATEGORY_IDS, type PublicRepositoryCategory } from "../lib/repository/types";

/** Section copy per category. The label is the browse control's own wording. */
const KIND_COPY: Record<
  PublicRepositoryCategory,
  { label: string; labelJa: string; blurb: string; blurbJa: string }
> = {
  gates: {
    label: "Gates",
    labelJa: "ゲート",
    blurb:
      "Primitives, each with the circuit it stands for and — where one exists — its decomposition into basic gates. Its own section, because a gate is a different kind of object from a workflow.",
    blurbJa:
      "基本要素です。それぞれ対応する回路と、存在する場合は基本ゲートへの分解を持ちます。ゲートはワークフローとは別種のものなので、独立したセクションにしています。",
  },
  algorithms: {
    label: "Algorithms",
    labelJa: "アルゴリズム",
    blurb:
      "Methods and benchmark circuits. Some pin a gate sequence you can run and export; most are literature records that name a method and cite the paper it comes from.",
    blurbJa:
      "手法とベンチマーク回路です。実行・エクスポートできるゲート列を持つものもありますが、多くは手法を示し出典論文を引用する文献レコードです。",
  },
  operators: {
    label: "Operators",
    labelJa: "演算子",
    blurb:
      "Observables and Hamiltonians. You measure a state with one; you do not apply it and pass a register on, so they sit beside a pipeline rather than in it.",
    blurbJa:
      "オブザーバブルとハミルトニアンです。状態の測定に用いるものであり、適用してレジスタを次段に渡すものではないため、パイプラインの中ではなく傍らに位置します。",
  },
  states: {
    label: "States",
    labelJa: "状態",
    blurb:
      "Named preparations. Nothing goes in, and what comes out is a register another stage can take — which makes them where a composition starts.",
    blurbJa:
      "名前のついた状態準備です。入力はなく、出力は次段が受け取れるレジスタであるため、合成の起点になります。",
  },
};

const COPY = {
  en: {
    heading: "What is in the Atlas",
    lead: (total: number) =>
      `${total} published records of quantum circuits, algorithms, operators and states. Each one carries where it came from, how far it has been checked, and what it does not say — and those three are the point: this is a catalogue of evidence about circuits, not a library of code.`,
    structure: (withCircuit: number, total: number) =>
      `${withCircuit} of the ${total} pin an actual gate sequence, which is what can be simulated, costed and exported. The other ${total - withCircuit} are literature and operator records: they name a method and cite the work it comes from, and there is nothing to run. The catalogue says which is which on every card rather than averaging the two.`,
    compose:
      "Records also declare what they take and return, so you can see which ones meet. A shape match is not a proof that two things compose — a basis convention or an unstated assumption can still break it — so the site distinguishes “these fit” from “these could fit and nothing has established it”, and never rounds the second up to the first.",
    kinds: "The four kinds",
    entriesLabel: (n: number) => `${n} ${n === 1 ? "record" : "records"}`,
    layersLead:
      "A record says what one circuit is. It does not say what a piece is made of, or what else could fill its place — for that there is a second surface:",
    layersLink: "Layers — the slots a pipeline is made of, and what fills each",
  },
  ja: {
    heading: "Atlasに収録しているもの",
    lead: (total: number) =>
      `量子回路・アルゴリズム・演算子・状態に関する公開レコード${total}件です。各レコードは、出典、どこまで検証されているか、そして何を述べていないかを併記しています。この三つこそが要点です。これはコードのライブラリではなく、回路に関する根拠のカタログです。`,
    structure: (withCircuit: number, total: number) =>
      `${total}件のうち${withCircuit}件は実際のゲート列を持ち、シミュレーション・コスト算出・エクスポートの対象になります。残る${total - withCircuit}件は文献・演算子のレコードで、手法を示し出典を引用しますが、実行できるものはありません。カタログは両者を平均せず、各カードでどちらであるかを明示します。`,
    compose:
      "各レコードは入力と出力も宣言しているため、どれとどれが接続しうるかを見ることができます。形状の一致は合成可能であることの証明ではありません——基底の取り方や明示されていない前提によって成り立たなくなることがあります。そのため本サイトは「接続できる」と「接続しうるが未確認である」を区別し、後者を前者に切り上げることはしません。",
    kinds: "四つの種別",
    entriesLabel: (n: number) => `${n}件`,
    layersLead:
      "各項目は、ひとつの回路が何であるかを述べます。ある部品が何から成り立っているか、その場所を他に何が埋めうるかは述べません。そのための画面が別にあります。",
    layersLink: "階層 — パイプラインを構成する枠と、それを埋めるもの",
  },
} as const;

/**
 * The preface, and the four kinds as links into their sections.
 *
 * A server component taking the already-fetched listing: it adds no request, no
 * client JavaScript and no second source for any number on it. Each kind links
 * to `?category=` — the address §0.5.1's "separate gate section" ask turned out
 * to be missing, and the reason a section is a section rather than a tab.
 */
export function RepositoryPreface({
  entries,
  locale,
}: {
  entries: PublicRepositoryListEntry[];
  locale: PublicLocale;
}) {
  const copy = COPY[locale === "ja" ? "ja" : "en"];
  const isJapanese = locale === "ja";
  const total = entries.length;
  // `portableCircuit` rather than `visualization`: every record has a diagram,
  // and only some have a gate sequence a machine can act on. Counting the
  // diagrams would make the sentence below false in the flattering direction.
  const withCircuit = entries.filter((entry) => entry.portableCircuit).length;
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);

  return (
    <section className="mj-repo-preface" aria-labelledby="repository-preface-heading">
      <h2 id="repository-preface-heading">{copy.heading}</h2>
      <p>{copy.lead(total)}</p>
      <p>{copy.structure(withCircuit, total)}</p>
      <p>{copy.compose}</p>

      {/* Above the four kinds, not below them. The kinds list answers "which of
          these records do I want"; this answers "is a record even the thing I
          am looking for", and a reader who scrolls past the whole preface has
          at least been told the second surface exists. It is a plain link with
          an address — the gates section spent two sessions unreachable because
          the only route to it was a control with no href. */}
      <p className="mj-repo-preface-layers">
        {copy.layersLead} <a href="/repository/layers">{copy.layersLink}</a>
      </p>

      <h3 className="mj-repo-preface-kinds">{copy.kinds}</h3>
      <ul className="mj-repo-preface-list">
        {/* Ordered by the vocabulary, not by size: sorting by count would put
            `algorithms` first every time and read as a ranking of importance. A
            kind no record carries is dropped rather than linked to an empty
            section — same rule the topic and stance controls follow. */}
        {PUBLIC_REPOSITORY_CATEGORY_IDS.filter((kind) => counts.get(kind)).map((kind) => {
          const kindCopy = KIND_COPY[kind];
          return (
            <li key={kind}>
              <a href={`/repository?category=${kind}`}>
                {isJapanese ? kindCopy.labelJa : kindCopy.label}
              </a>{" "}
              <span className="mj-repo-preface-count">{copy.entriesLabel(counts.get(kind) ?? 0)}</span>
              <p>{isJapanese ? kindCopy.blurbJa : kindCopy.blurb}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
