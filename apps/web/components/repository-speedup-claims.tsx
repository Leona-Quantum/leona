// Whose claim is the speedup class: `/repository/claims`.
//
// ## What this page is for
//
// Every Zoo-parity record shows a speedup class, and that class is a quotation
// from the Quantum Algorithm Zoo rather than something this repository derived.
// The owner's ruling on that (EshMis/ai-ops#18) was to keep the classes, keep
// track of which are second-hand, and prefer the primary source wherever it can
// be found. This page is where that tracking becomes readable.
//
// Seven records now say the primary source does **not** state the class. That was
// the finding, and it lived only inside each record's caveat and inside a lint
// script's census comment — reachable by nobody.
//
// ## Two rules the layout follows
//
// **The denominator is the first sentence, and the finding is second.** "Seven
// records disagree with the Zoo" reads as seven out of seven unless the unchecked
// majority is on the page beside them. `speedupClaimCensus` has no accessor that
// returns the finding without the rest, so this ordering cannot quietly rot.
//
// **One census sentence, not a stat grid.** The owner has already said, of the
// Atlas description, the information card and the Papers index: *"I don't like
// all the numbers"*. So the counts appear in prose once and never again.
//
// ## Server component, every affordance an href
//
// Same rule as the Layers and Papers surfaces: a control that only works after
// hydration has no address. Everything here answers to `curl`.
import type { PublicLocale } from "../lib/public-locale";
import {
  speedupCensusSentence,
  type SpeedupAbsentRow,
  type SpeedupClaimCensus,
  type SpeedupClaimRow,
} from "../lib/repository/speedup-claims";

const COPY = {
  en: {
    title: "Whose claim is the speedup",
    lede:
      "Every algorithm record here shows a speedup class, and that class is quoted from an outside index rather than"
      + " derived here. This page says, for each one, whether the paper behind it states the same thing.",
    backToAtlas: "Atlas",
    papersLink: "Papers — every source behind the Atlas and the map",
    absentHeading: "Checked, and the paper does not state it",
    absentLede:
      "Each of these is the narrow claim that a named paper does not contain a named result — not that the class is"
      + " wrong. The index may have taken it from a source this record does not cite. What was read is printed"
      + " beside each one, because “the paper does not say it” is only ever as wide as the text somebody opened.",
    reportedHeading: "Checked, and the paper states it",
    reportedLede: "The source's own words, not a paraphrase.",
    uncheckedHeading: "Not checked against the primary source",
    uncheckedLede:
      "Nobody has asked these papers whether they support the class shown on the record. Listed rather than counted:"
      + " a page that showed only the finished half of an audit would be a smaller claim pretending to be a whole one.",
    zooSays: "The index files it as",
    paperSays: "The paper behind it",
    read: "What was read",
    noneAbsent: "No record has been checked and found unsupported.",
    noneUnchecked: "Every record has been checked against its primary source.",
  },
  ja: {
    title: "速度向上は誰の主張か",
    lede:
      "本サイトのアルゴリズム記録には速度向上の区分が示されていますが、これは外部の索引からの引用であって、ここで導いたものではありません。"
      + "このページは、その根拠となる論文が同じことを述べているかどうかを一件ずつ示します。",
    backToAtlas: "アトラス",
    papersLink: "論文 — アトラスと地図の背後にあるすべての資料",
    absentHeading: "照合の結果、論文に記載がなかったもの",
    absentLede:
      "いずれも、特定の論文に特定の結果が含まれていないという限定的な主張であり、区分が誤りだという主張ではありません。"
      + "索引が、この記録の引用しない別の資料から採った可能性もあります。何を読んだかを各件に併記します。"
      + "「論文に記載がない」と言えるのは、実際に開いた本文の範囲に限られるからです。",
    reportedHeading: "照合の結果、論文に記載があったもの",
    reportedLede: "言い換えではなく、資料自身の言葉です。",
    uncheckedHeading: "一次資料と未照合のもの",
    uncheckedLede:
      "これらの論文が記録の区分を裏づけるかどうかは、まだ誰も確認していません。件数ではなく一覧として示します。"
      + "監査の終わった半分だけを見せるページは、小さな主張を全体のように見せることになるからです。",
    zooSays: "索引による区分",
    paperSays: "根拠となる論文",
    read: "読んだ範囲",
    noneAbsent: "照合の結果、裏づけを欠くと判明した記録はありません。",
    noneUnchecked: "すべての記録が一次資料と照合済みです。",
  },
} as const;

function RowHead({ row, locale }: { row: SpeedupClaimRow; locale: PublicLocale }) {
  return (
    <>
      <a className="mj-papers-list-title" href={`/repository/${row.slug}`}>
        {locale === "ja" ? row.titleJa : row.title}
      </a>
      <p className="mj-papers-byline">
        {row.source.authors} · {row.source.year}
      </p>
    </>
  );
}

export function SpeedupClaimsView({
  census,
  locale,
}: {
  census: SpeedupClaimCensus;
  locale: PublicLocale;
}) {
  const copy = COPY[locale];
  return (
    <article className="mj-layers-index mj-papers-index">
      <nav className="mj-layers-breadcrumb" aria-label={copy.title}>
        <a href="/repository">{copy.backToAtlas}</a>
      </nav>
      <header className="mj-layers-node-head">
        <h1>{copy.title}</h1>
        <p>{copy.lede}</p>
      </header>
      {/* The one place counts appear. Everything below is named rather than
          tallied — see the header for why. */}
      <section className="mj-papers-census" aria-label={copy.title}>
        <p className="mj-layers-empty">{speedupCensusSentence(census, locale)}</p>
      </section>

      <section aria-labelledby="mj-claims-absent">
        <h2 id="mj-claims-absent">{copy.absentHeading}</h2>
        <p className="mj-layers-empty">{copy.absentLede}</p>
        {/* Unreachable while seven records say `absent`, and written anyway: an
            empty list and a failed load render identically, and the reader cannot
            tell which they are looking at. */}
        {census.absent.length === 0 ? <p className="mj-layers-empty">{copy.noneAbsent}</p> : null}
        <ul className="mj-papers-list">
          {census.absent.map((row: SpeedupAbsentRow) => (
            <li key={row.slug}>
              <RowHead row={row} locale={locale} />
              <p className="mj-papers-list-meta">
                {copy.zooSays}: <strong>{row.speedup}</strong> — {row.zooName}
              </p>
              <p className="mj-papers-list-meta">
                {copy.paperSays}: {row.source.title}
              </p>
              <p className="mj-papers-list-meta">
                {copy.read}: {row.read}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="mj-claims-reported">
        <h2 id="mj-claims-reported">{copy.reportedHeading}</h2>
        <p className="mj-layers-empty">{copy.reportedLede}</p>
        <ul className="mj-papers-list">
          {census.reported.map((row) => (
            <li key={row.slug}>
              <RowHead row={row} locale={locale} />
              <p className="mj-papers-list-meta">
                {copy.zooSays}: <strong>{row.speedup}</strong> — {row.zooName}
              </p>
              <blockquote className="mj-papers-list-meta">{row.quote}</blockquote>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="mj-claims-unchecked">
        <h2 id="mj-claims-unchecked">{copy.uncheckedHeading}</h2>
        <p className="mj-layers-empty">{copy.uncheckedLede}</p>
        {census.unchecked.length === 0 ? (
          <p className="mj-layers-empty">{copy.noneUnchecked}</p>
        ) : null}
        <ul className="mj-papers-list">
          {census.unchecked.map((row) => (
            <li key={row.slug}>
              <RowHead row={row} locale={locale} />
              <p className="mj-papers-list-meta">
                {copy.zooSays}: <strong>{row.speedup}</strong> — {row.zooName}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <nav className="mj-layers-breadcrumb" aria-label={copy.papersLink}>
        <a href="/repository/papers">{copy.papersLink}</a>
      </nav>
    </article>
  );
}
