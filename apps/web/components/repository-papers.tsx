// The Papers surface: the register at `/repository/papers` and one paper page.
//
// ## Why this surface exists, and why it is not the sidebar that was planned
//
// The plan was "papers as traces" — a sidebar listing every paper the map
// cites, each drawing its line across the graph. That was built on an
// assumption nobody had measured, and the measurement (`paper-traces.ts`) says:
//
//     84 papers cited — 60 at a single node, 2 contiguous,
//     22 joinable through uncited nodes, 0 with no path at all
//
// **60 of 84 papers are a point, not a line.** A sidebar promising 84 traces
// would have drawn two. So this is a register with an address per paper, and a
// line is drawn only where the graph has one — which is the honest shape of the
// same idea, and the one that stays true as the register grows past 143.
//
// ## Server components throughout
//
// Same requirement as the Layers surface: D88.2's rule is that a control which
// only works after hydration has no address. Every affordance here is an
// `<a href>`, so the whole surface answers to `curl` as well as to a browser.
//
// ## The rule every count on this page follows
//
// A number is printed with its denominator, and the three `reports` axes are
// printed as three numbers rather than one. They were filled by three different
// rules — see `papers.ts` — and `simulation` is open on most rows while
// `hardware` is decided on nearly all of them. One combined figure would let the
// weakest axis ride on the strongest, which is the failure the field exists to
// avoid.
import type { PublicLocale } from "../lib/public-locale";
import type { PaperIndexCensus, PaperPage } from "../lib/repository/paper-pages";
import type { TraceShape } from "../lib/repository/paper-traces";
import type { SourceCoverageAxis, SourceCoverageStatus } from "../lib/repository/types";
import { canonicalPaperUrl } from "../lib/repository/papers";

const COPY = {
  en: {
    title: "Papers",
    lede: "One row per paper, and the only place its title, authors and year are written down. Every citation on this site — on a map node and on an Atlas record — is checked against these rows, so a paper cannot be two papers.",
    backToAtlas: "Atlas",
    backToPapers: "← Papers",
    layersLink: "Layers — how the pieces fit together",
    countLine: (n: number) => `${n} papers`,
    readLine: (read: number, total: number) =>
      `${read} of ${total} record what they report. The rest have not been read for it — that is an absence, not a claim that they report nothing.`,
    reachLine: (census: PaperIndexCensus) =>
      `${census.onMap} are cited by the map, ${census.inAtlas} by an Atlas record, and ${census.both} by both. That last number is where the two bibliographies actually meet.`,
    queuedLine: (n: number) =>
      n === 0
        ? "Nothing is waiting: every registered paper is cited somewhere."
        : `${n} are registered and cited nowhere yet — read and recorded, not yet placed. That is a queue, not a defect.`,
    reportsHeading: "What it reports",
    reportsNone:
      "Nobody has read this paper for what it reports. Absent here means unread, never “it reports nothing”.",
    basisAbstract: "Read from the abstract.",
    basisFullText: "Read from the full text.",
    basisCaveat:
      "An abstract can say a paper ran on hardware, and can rarely say it ran no numerics — so “simulation” stays open unless the abstract states it.",
    axis: { theory: "Theory", simulation: "Simulation", hardware: "Hardware" } as Record<
      SourceCoverageAxis,
      string
    >,
    status: {
      reported: "reported",
      absent: "not reported",
      unknown: "not established",
    } as Record<SourceCoverageStatus, string>,
    onMapHeading: "Where the map cites it",
    onMapNone: "No node on the map cites this paper.",
    inAtlasHeading: "Where the Atlas cites it",
    inAtlasNone: "No record in the Atlas cites this paper.",
    shapeHeading: "As a line on the map",
    // The four shapes, each said as the fact it is. `point` is by far the
    // commonest and must not read as a failure: one node citing a paper is a
    // normal, complete state of affairs.
    shape: {
      point:
        "One node cites this. There is no line to draw — a trace is a path, and a single citation is a place.",
      contiguous:
        "The nodes citing this are next to each other on the graph, so the citations do draw a connected line.",
      joinable:
        "The nodes citing this do not touch, but the graph connects them by passing through nodes this paper does not cite. Those are named below rather than drawn silently, because a line through an uncited node is a path the paper does not itself support.",
      scattered:
        "The nodes citing this sit in parts of the graph with no path between them. There is no line, and drawing one would invent a connection.",
    } as Record<TraceShape, string>,
    bridgeLabel: "Passing through, uncited:",
    bridgeBound: "At most — this is an upper bound from a greedy walk, not a proved minimum.",
    openSource: "Read the paper ↗",
    kind: { slot: "slot", method: "method", record: "record" },
    unread: "not read",
    citedNowhere: "cited nowhere yet",
    empty:
      "No paper is registered. Either nothing has been read into the register yet, or it failed to load — those are different things, and this page cannot tell them apart.",
    // Pluralised per count rather than written for the common case: the
    // commonest count on this list is 1, and "cited by 1 map nodes" is the
    // sentence a graph seeded one cluster at a time produces most often.
    citedByNodes: (n: number) => `cited by ${n} map ${n === 1 ? "node" : "nodes"}`,
    citedByRecords: (n: number) => `cited by ${n} Atlas ${n === 1 ? "record" : "records"}`,
  },
  ja: {
    title: "論文",
    lede: "論文ごとに 1 行、そしてその題名・著者・年が書かれている唯一の場所です。本サイトのすべての引用は — 地図のノード上のものも、アトラスの記録上のものも — この行と照合されます。ひとつの論文がふたつの論文になることはありません。",
    backToAtlas: "アトラス",
    backToPapers: "← 論文",
    layersLink: "階層 — 部品どうしの組み合わさり方",
    countLine: (n: number) => `${n} 件の論文`,
    readLine: (read: number, total: number) =>
      `${total} 件のうち ${read} 件について、何を報告しているかが記録されています。残りはまだそのために読まれていません。これは記載がないということであり、「何も報告していない」という主張ではありません。`,
    reachLine: (census: PaperIndexCensus) =>
      `${census.onMap} 件は地図から、${census.inAtlas} 件はアトラスの記録から、${census.both} 件は両方から引用されています。最後の数が、ふたつの文献目録が実際に重なっているところです。`,
    queuedLine: (n: number) =>
      n === 0
        ? "待機中のものはありません。登録済みの論文はすべてどこかから引用されています。"
        : `${n} 件は登録されていて、まだどこからも引用されていません。読んで記録した段階で、まだ配置していないということです。これは待ち行列であり、欠陥ではありません。`,
    reportsHeading: "何を報告しているか",
    reportsNone:
      "この論文が何を報告しているかについては、まだ誰も読んでいません。ここでの記載なしは未読を意味し、「何も報告していない」という意味ではありません。",
    basisAbstract: "要旨から読み取りました。",
    basisFullText: "本文から読み取りました。",
    basisCaveat:
      "要旨は、その論文が実機で動かしたことは述べられますが、数値計算を行っていないことはほとんど述べられません。そのため「数値計算」は、要旨に明記がない限り未確定のままにしています。",
    axis: { theory: "理論", simulation: "数値計算", hardware: "実機" } as Record<
      SourceCoverageAxis,
      string
    >,
    status: {
      reported: "報告あり",
      absent: "報告なし",
      unknown: "未確定",
    } as Record<SourceCoverageStatus, string>,
    onMapHeading: "地図のどこが引用しているか",
    onMapNone: "地図のどのノードもこの論文を引用していません。",
    inAtlasHeading: "アトラスのどこが引用しているか",
    inAtlasNone: "アトラスのどの記録もこの論文を引用していません。",
    shapeHeading: "地図の上の線として",
    shape: {
      point:
        "引用しているノードはひとつです。描くべき線はありません。軌跡とは経路であり、ひとつの引用は地点だからです。",
      contiguous:
        "この論文を引用しているノードはグラフ上で隣り合っており、引用がそのままつながった線を描きます。",
      joinable:
        "引用しているノードどうしは接していませんが、この論文が引用していないノードを経由すればグラフ上でつながります。それらを黙って描かず下に明記しているのは、引用のないノードを通る線が、その論文自身の裏づけを持たない経路だからです。",
      scattered:
        "引用しているノードは、互いに経路のない別々の部分に位置しています。線はありません。描けば、ないつながりを作り出すことになります。",
    } as Record<TraceShape, string>,
    bridgeLabel: "経由するノード（引用なし）:",
    bridgeBound: "多くともこの数です。貪欲な探索による上界であり、証明された最小値ではありません。",
    openSource: "論文を読む ↗",
    kind: { slot: "枠", method: "手法", record: "記録" },
    unread: "未読",
    citedNowhere: "まだ引用なし",
    empty: "登録されている論文がありません。まだ登録簿に何も読み込まれていないか、読み込みに失敗したかのいずれかです。このふたつは別のことですが、このページからは区別できません。",
    citedByNodes: (n: number) => `地図の ${n} 個のノードから引用`,
    citedByRecords: (n: number) => `アトラスの ${n} 件の記録から引用`,
  },
} as const;

/**
 * A union of both locales, never just `en`.
 *
 * `as const` gives every string a literal type, so the Japanese object is not
 * assignable to the English one and a `PapersCopy = (typeof COPY)["en"]` makes
 * every call site that passes `COPY[locale]` an error. Same shape as
 * `LayersCopy` next door, for the same reason.
 */
type PapersCopy = (typeof COPY)["en"] | (typeof COPY)["ja"];

const AXES: readonly SourceCoverageAxis[] = ["theory", "simulation", "hardware"];

function ReportsChips({ page, copy }: { page: PaperPage; copy: PapersCopy }) {
  const reports = page.paper.reports;
  if (!reports) return <span className="mj-papers-unread">{copy.unread}</span>;
  return (
    <span className="mj-papers-chips">
      {AXES.map((axis) => (
        <span
          key={axis}
          className="mj-papers-chip"
          data-axis={axis}
          data-status={reports[axis]}
          /* The status is in the text as well as in the attribute. A chip whose
             only difference from its neighbour is a border colour is not
             readable by a screen reader and not readable in a screenshot. */
        >
          {copy.axis[axis]} · {copy.status[reports[axis]]}
        </span>
      ))}
    </span>
  );
}

function CitationSites({
  sites,
  locale,
  copy,
  heading,
  empty,
  id,
}: {
  sites: PaperPage["nodes"];
  locale: PublicLocale;
  copy: PapersCopy;
  heading: string;
  empty: string;
  id: string;
}) {
  return (
    <section className="mj-layers-section" aria-labelledby={id}>
      <h2 id={id}>{heading}</h2>
      {sites.length === 0 ? (
        <p className="mj-layers-empty">{empty}</p>
      ) : (
        <ul className="mj-layers-list">
          {sites.map((site) => (
            <li key={site.href}>
              <a href={site.href}>{locale === "ja" ? site.labelJa : site.label}</a>
              <span className="mj-layers-item-kind">{copy.kind[site.kind]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One paper. */
export function PaperView({ page, locale }: { page: PaperPage; locale: PublicLocale }) {
  const copy = COPY[locale];
  const { paper, trace } = page;
  return (
    <article className="mj-layers-node mj-papers-page">
      <nav className="mj-layers-breadcrumb" aria-label={copy.title}>
        <a href="/repository">{copy.backToAtlas}</a>
        <span aria-hidden="true"> / </span>
        <a href="/repository/papers">{copy.title}</a>
      </nav>
      <header className="mj-layers-node-head">
        <h1>{paper.title}</h1>
        <p className="mj-papers-byline">
          {paper.authors} · {paper.year}
        </p>
        <p>
          <a
            className="mj-papers-source-link"
            href={canonicalPaperUrl(paper.id)}
            rel="noreferrer noopener"
            target="_blank"
          >
            {copy.openSource}
          </a>
        </p>
      </header>

      <section className="mj-layers-section" aria-labelledby={`reports-${page.slug}`}>
        <h2 id={`reports-${page.slug}`}>{copy.reportsHeading}</h2>
        {paper.reports ? (
          <>
            <ReportsChips page={page} copy={copy} />
            <p className="mj-layers-empty">
              {paper.reportsBasis === "full-text" ? copy.basisFullText : copy.basisAbstract}
              {paper.reportsBasis === "abstract" ? ` ${copy.basisCaveat}` : ""}
            </p>
          </>
        ) : (
          <p className="mj-layers-empty">{copy.reportsNone}</p>
        )}
      </section>

      {/* The shape is printed whenever the map cites this paper at all — and
          `point` is printed loudest, because it is the commonest answer and the
          one a reader would otherwise read as a broken feature. */}
      {trace ? (
        <section className="mj-layers-section" aria-labelledby={`shape-${page.slug}`}>
          <h2 id={`shape-${page.slug}`}>{copy.shapeHeading}</h2>
          <p className="mj-papers-shape" data-shape={trace.shape}>
            {copy.shape[trace.shape]}
          </p>
          {page.bridge.length > 0 ? (
            <>
              <p className="mj-layers-count">{copy.bridgeLabel}</p>
              <ul className="mj-layers-list">
                {page.bridge.map((site) => (
                  <li key={site.href}>
                    <a href={site.href}>{locale === "ja" ? site.labelJa : site.label}</a>
                    <span className="mj-layers-item-kind">{copy.kind[site.kind]}</span>
                  </li>
                ))}
              </ul>
              <p className="mj-layers-empty">{copy.bridgeBound}</p>
            </>
          ) : null}
        </section>
      ) : null}

      <CitationSites
        sites={page.nodes}
        locale={locale}
        copy={copy}
        heading={copy.onMapHeading}
        empty={copy.onMapNone}
        id={`map-${page.slug}`}
      />
      <CitationSites
        sites={page.records}
        locale={locale}
        copy={copy}
        heading={copy.inAtlasHeading}
        empty={copy.inAtlasNone}
        id={`atlas-${page.slug}`}
      />
      <p className="mj-layers-count">
        <a href="/repository/layers">{copy.layersLink}</a>
      </p>
    </article>
  );
}

/** The register, in one list. */
export function PaperIndexView({
  pages,
  census,
  locale,
}: {
  pages: readonly PaperPage[];
  census: PaperIndexCensus;
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
      {/* Four sentences rather than a dashboard. Each carries its own
          denominator, and none of them can be read as a percentage of a total
          it does not belong to. */}
      <section className="mj-papers-census" aria-label={copy.title}>
        <p className="mj-layers-count">{copy.countLine(census.papers)}</p>
        <p className="mj-layers-empty">{copy.readLine(census.read, census.papers)}</p>
        <p className="mj-layers-empty">{copy.reachLine(census)}</p>
        <p className="mj-layers-empty">{copy.queuedLine(census.queued)}</p>
      </section>
      {/* Unreachable on the authored register, which has 143 rows — and written
          anyway, because "the list is currently empty" and "the register failed
          to load" render identically as a blank page, and the reader cannot
          tell which they are looking at. Same rule every list on the Layers
          surface follows: an empty list says what the emptiness means. */}
      {pages.length === 0 ? <p className="mj-layers-empty">{copy.empty}</p> : null}
      <ul className="mj-papers-list">
        {pages.map((page) => (
          <li key={page.paper.id}>
            <a className="mj-papers-list-title" href={`/repository/papers/${page.slug}`}>
              {page.paper.title}
            </a>
            <p className="mj-papers-byline">
              {page.paper.authors} · {page.paper.year}
            </p>
            <p className="mj-papers-list-meta">
              <ReportsChips page={page} copy={copy} />
            </p>
            {/* A count, not a heading reused as one. "Where the map cites it: 1"
                is a section title with a number stapled on; "cited by 1 map
                node" is the sentence a reader is actually reading. */}
            <p className="mj-layers-count">
              {page.nodes.length === 0 && page.records.length === 0
                ? copy.citedNowhere
                : [
                    page.nodes.length > 0 ? copy.citedByNodes(page.nodes.length) : null,
                    page.records.length > 0 ? copy.citedByRecords(page.records.length) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </article>
  );
}
