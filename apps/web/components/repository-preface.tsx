// The preface on `/repository` — roadmap §0.5.1, owner direction 2026-08-06.
//
// > *"preface with explanation"* … *"the search bar and navigation should be
// > crystal clear and not too complicated"*
//
// ## Why a preface, when the page already had a heading and a sentence
//
// The page opened straight into a control bar over the whole corpus of cards
// (283 of them, measured 2026-07). A reader arriving
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
// ## Why the counted paragraphs are gone (session 110)
//
// > *"I don't like all the numbers in the atlas description, information card,
// > papers, etc. No need to mention entries, the atlas description can be 1-2
// > short sentences. The map can be 1 sentence. The papers can be 1 sentence.
// > Atlas page title card something like 'The Quantum Atlas'."* — owner
//
// The rule above is not repealed and must not be: any number that *does* appear
// on this page still has to be counted rather than typed. What changed is that
// the owner does not want the numbers on the front door at all, and a rule about
// how to write a number is silent on whether to write one.
//
// So three paragraphs went, and each for a reason worth recording so a later
// session does not restore them as an improvement:
//
// - **the counted lead and the runnable/literature split** — the owner's ask,
//   directly. The split is still stated where a reader can act on it: every card
//   in the browser says which of the two it is, which is where the claim was
//   always doing its work.
// - **the composition paragraph** — it was a second copy. The same claim is made
//   at `components/repository-interface.tsx:73`, on the panel that actually shows
//   two things meeting, in the one place a reader is about to draw the wrong
//   conclusion from. Here it argued about a page where nothing is composing.
//
// **The counts still run**; they just decide rather than print. `counts` below
// is what drops a kind with no records instead of linking to an empty section.
// A count used as a predicate is not a claim a reader has to believe.
import type { PublicLocale } from "../lib/public-locale";
import type { PublicRepositoryListEntry } from "../lib/repository/types";
import { PUBLIC_REPOSITORY_CATEGORY_IDS, type PublicRepositoryCategory } from "../lib/repository/types";

/**
 * "About the Atlas" — the box above everything else on `/repository`.
 *
 * > *"The atlas page on the website has link to 'about the atlas', and it opens
 * > up a page that BRIEFLY explains the atlas repository surface and then the map
 * > surface. these are not technical, they are hype, revolutionary, and simply
 * > understandable. It also has a brief sentence about the map, hypes it up, and
 * > a link to the 'interactive quantum map'. Those two sentences are in the same
 * > collapsible box. Then the search bar and rest of the atlas repository below."*
 * > — owner, session-109 inbox
 *
 * ## Why this is quieter than "hype" sounds
 *
 * `docs/ui/copy.md` binds the whole product: *"Tone: technical, calm. Zero
 * exclamation marks, no emoji."* The owner asked for the opposite register on
 * this one box, and the two are reconcilable exactly once — by putting the
 * confidence in the **claim** rather than in the punctuation. "The first drawing
 * of quantum algorithms as one connected structure rather than a bibliography"
 * is a large thing to say; it does not need a mark after it to be large.
 *
 * Relayed to the owner in `memory/OWNER_TODO.md` §4 rather than decided quietly:
 * if this should be louder than the tone rule allows, the tone rule is what has
 * to change, and that is the owner's call.
 *
 * ## Why `<details>` and not the map's `?about=` box
 *
 * The owner said *"collapsible box"*, and this one has nothing to address: it is
 * three short lines with no sections, so a URL parameter would name a state
 * nobody would ever link to. `<details>` needs no JavaScript, and a reader who
 * never opens it still gets the search bar immediately below — which is the
 * ordering the owner specified.
 *
 * ## Why it is now open by default, having been shut
 *
 * It was shut because it was long: two dense paragraphs above a search bar is a
 * wall, and *"a returning reader came here to search"*. Session 110 cut it to
 * three sentences at the owner's instruction, and that justification went with
 * the length — three lines are not a wall. What replaced it matters more: the
 * counted preface that used to sit under this box and carry the description is
 * gone too, so shut-by-default would now leave a first-time reader with a title,
 * a search bar, and no sentence anywhere saying what the thing is.
 *
 * The `open` attribute is markup, not script: `curl` gets it, a reader with
 * JavaScript off can still collapse it, and nothing about the address changes.
 */
const ABOUT_COPY: Record<
  PublicLocale,
  {
    summary: string;
    repository: string;
    map: string;
    mapLink: string;
    papers: string;
    papersLink: string;
    claims: string;
    claimsLink: string;
  }
> = {
  en: {
    summary: "About the Atlas",
    repository:
      "Every quantum algorithm worth knowing about, written down the same way: what it takes, what it returns, what it costs, and who proved it. Where the sources disagree, we say so.",
    map: "The Map draws the same corpus as one connected structure — every method is a route, and the routes share their steps.",
    // "Open the Map", not "Open the interactive map" (ai-ops#78). This link is
    // where the four names met: it sent a reader who had just read "the
    // interactive map" to a page headed "Layers". Both ends now say Map.
    mapLink: "Open the Map",
    papers: "Every source behind both surfaces, and what each one actually reports.",
    papersLink: "See the papers",
    claims:
      "A speedup class on a record is quoted from an outside index, not derived here — and on some records the"
      + " paper behind it does not state the same thing.",
    claimsLink: "See whose claim it is",
  },
  ja: {
    summary: "量子アトラスについて",
    repository:
      "知る価値のある量子アルゴリズムを、何を取り、何を返し、どれだけかかり、誰が証明したのか、すべて同じ形式で記述しています。出典どうしが食い違うところは、そのまま記録します。",
    map: "地図は同じ収録内容を、工程を共有しあう経路のつながりとしてひとつの構造に描いた図です。",
    mapLink: "地図を開く",
    papers: "どちらの画面も依拠している出典と、それぞれが実際に報告している内容です。",
    papersLink: "論文を見る",
    claims:
      "記録に示された速度向上の区分は外部の索引からの引用であって、ここで導いたものではありません。"
      + "根拠となる論文が同じことを述べていない記録もあります。",
    claimsLink: "誰の主張かを見る",
  },
};

/**
 * Server component, no state, no client JavaScript. Rendered above
 * `RepositoryPreface` so the order on the page is: what this is → which kinds of
 * record there are → the controls.
 *
 * Three surfaces, one sentence each, and the two that are not this page carry
 * their link inline rather than in a list. The links are the load-bearing part:
 * `/repository/layers` and `/repository/papers` used to be reachable from the
 * counted preface below, and that preface's paragraphs are gone — so if these
 * two anchors went with them, the map and the paper register would be reachable
 * only from a detail page, which is the exact failure the gates section spent
 * two sessions in.
 */
export function AboutTheAtlas({ locale }: { locale: PublicLocale }) {
  const copy = ABOUT_COPY[locale === "ja" ? "ja" : "en"];
  return (
    <details className="mj-repo-section" open>
      <summary>{copy.summary}</summary>
      {/* `mj-repo-section-body` and not a new rule: the inset that lines the
          prose up under the summary already exists on this pattern, and a
          second class doing the same job is how one disclosure ends up
          looking different from every other one on the site. */}
      <div className="mj-repo-section-body">
        <p>{copy.repository}</p>
        <p>
          {copy.map} <a href="/repository/layers">{copy.mapLink}</a>
        </p>
        <p>
          {copy.papers} <a href="/repository/papers">{copy.papersLink}</a>
        </p>
        {/* A route nothing links to is a route nobody reaches, and this one
            carries the finding the corpus produced rather than a navigation
            convenience. It sits here rather than in the site nav on purpose:
            seven records against thirty-one nobody has checked is a real result
            and not yet a headline. */}
        <p>
          {copy.claims} <a href="/repository/claims">{copy.claimsLink}</a>
        </p>
      </div>
    </details>
  );
}

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
    kinds: "The four kinds",
    folders: "Browse by folder",
  },
  ja: {
    kinds: "四つの種別",
    folders: "フォルダで見る",
  },
} as const;

/**
 * The four kinds, as links into their sections.
 *
 * A server component taking the already-fetched listing: it adds no request and
 * no client JavaScript. Each kind links to `?category=` — the address §0.5.1's
 * "separate gate section" ask turned out to be missing, and the reason a section
 * is a section rather than a tab.
 *
 * **`entries` is still the argument even though no number is printed**, and that
 * is the point of keeping it: the listing decides which kinds appear. A kind the
 * corpus has no record of is dropped rather than linked to an empty section, and
 * the only way to know that is to count. What the owner asked to lose was the
 * numbers a reader is shown, not the ones the page thinks with.
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
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);

  return (
    <section className="mj-repo-preface" aria-labelledby="repository-preface-heading">
      <h2 id="repository-preface-heading" className="mj-repo-preface-kinds">
        {copy.kinds}
      </h2>
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
              </a>
              <p>{isJapanese ? kindCopy.blurbJa : kindCopy.blurb}</p>
            </li>
          );
        })}
      </ul>
      {/* The folder tree's only entrance.
          The hierarchy the owner picked (EshMis/ai-ops#15) is a public surface at
          `/repository/folders`, and a surface nothing links to is one no reader and no
          crawler will ever reach — the same defect `?category=` had before §0.5.1, and
          it looks identical to not having built it. One link, here, because this
          section is already the "what kinds of thing are these" answer and browsing
          down is the next question after it. */}
      <p className="mj-repo-preface-kinds">
        <a href="/repository/folders">{copy.folders}</a>
      </p>
    </section>
  );
}
