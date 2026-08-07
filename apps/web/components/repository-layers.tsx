// The Layers surface: the index at `/repository/layers` and one node page.
//
// Server components throughout, and that is a requirement rather than a
// preference. Every affordance here is navigation — descend into a step, climb
// to what contains it, look sideways at what else fills the slot — and D88.2's
// rule is that a control which only works after hydration has no address: no
// link, no crawler, nothing for a reader with JS off, and it looks identical to
// a working one on a hydrated page. So every one of them is an `<a href>` or a
// `<details>`, and the whole surface is verifiable with `curl` **and** with a
// browser, which is the pair session 88 established is needed.
//
// ## What the shapes say
//
// The piece drawn on an entry page has notched edges because a register width
// either meets another one or does not. A layer's contract is prose — "a
// block-encoding of A and a unitary preparing |b⟩" — and no machine decides
// whether two of those meet. So the piece here carries the same visual grammar
// and deliberately makes **no** compatibility claim: it is a statement of what
// the slot is for, at the slot's own level, which is the thing §0.5.2 asked for
// and `SemanticPort` never got built to hold.
//
// ## The rule every list on this page follows
//
// A list that is empty says what the emptiness means. "No method is recorded
// here yet" is a fact about our graph; "nothing skips this layer" is a fact
// about the routes; and neither may render as silence, because silence in a
// panel reads as "there is nothing to say" — the same reason `knownGaps` prints
// a sentence on the 282 records nobody has reviewed.
import type { PublicLocale } from "../lib/public-locale";
import {
  alternativesTo,
  bypassersOf,
  capabilityOutlook,
  containersOf,
  contractFor,
  entriesFor,
  isCapability,
  isMethod,
  layerCensus,
  layerDepths,
  layerNode,
  methodsRealizing,
  realizedBy,
  refinementsOf,
  rootCapabilities,
  stepsOutlook,
  type LayerCorpusEntry,
  type LayerGraph,
  type LayerMethod,
  type LayerNode,
} from "../lib/repository/layers";

const COPY = {
  en: {
    indexHeading: "Layers",
    indexLead:
      "A record in the Atlas says what one circuit is. This says what a piece is made of, and what else could fill its place. Open a step to see the slot it fills and every method recorded for it; climb back out to see what that slot is a part of.",
    modelHeading: "How to read it",
    modelSlot:
      "A slot is something you are trying to achieve, written as what goes in and what comes out at that level — “solve Ax = b as a quantum state”, not a circuit.",
    modelMethod:
      "A method is a way to fill a slot. Methods that fill the same slot are alternatives, and they differ in what they assume, not only in how fast they are.",
    modelStep:
      "A method’s steps are slots, never one chosen method — so descending lands you on the options rather than on somebody’s preferred pipeline.",
    modelBypass:
      "Some routes make a whole slot unnecessary rather than filling it better. Those are marked, because a ladder that never says “you can skip this” reads as compulsory.",
    censusHeading: "What is here, counted",
    // Pluralised per count rather than written for the common case. Every
    // number on this surface is counted from the graph, so a hard-coded plural
    // is a sentence that goes wrong the first time a count reaches one — and a
    // graph seeded one cluster at a time passes through exactly that state.
    census: (nodes: number, capabilities: number, methods: number) =>
      `${nodes} ${nodes === 1 ? "node" : "nodes"} — ${capabilities} ${capabilities === 1 ? "slot" : "slots"} and ${methods} ${methods === 1 ? "method" : "methods"}.`,
    censusAnchored: (anchored: number, nodes: number, records: number) =>
      `${anchored} of the ${nodes} link to a record in the Atlas, between them naming ${records} ${records === 1 ? "record" : "records"}. The rest name papers and nothing else: this graph describes work the catalogue has not got yet, and the nodes with no record are the list of what a corpus pass has to go and read.`,
    censusOpen: (open: number, undecomposed: number) =>
      `${open} ${open === 1 ? "slot has" : "slots have"} no method recorded, and ${undecomposed} ${undecomposed === 1 ? "method has" : "methods have"} not been taken apart. Both are shown as what they are rather than left blank.`,
    /**
     * Rendered only when it is non-zero, and it is zero on a healthy catalogue.
     *
     * The sentence above asks a visitor to believe a number about our own
     * coverage. That number is computed against whatever the catalogue served
     * this request — which is the API in production, with a silent fall back to
     * the static corpus — so a short or mid-import catalogue would lower it
     * without saying anything. This is the alternative to a number that quietly
     * goes wrong.
     */
    censusUnresolved: (n: number) =>
      `${n} cross-${n === 1 ? "link points" : "links point"} at a record the catalogue did not return for this page, so the count above is lower than what this graph declares. That is a catalogue problem, not a gap in the graph.`,
    startHeading: "Start here",
    depth: (n: number) => `Layer ${n}`,
    kindCapability: "Slot",
    kindMethod: "Method",
    takes: "Takes",
    returns: "Returns",
    inherited: "Same contract as the slot it fills.",
    narrowed: "This method narrows the slot’s contract.",
    whyALayer: "Why this is a layer",
    waysHeading: "Ways to do this",
    waysNone:
      "No method is recorded here yet. The slot is real — something has to happen at this step — and nothing in this graph says how.",
    waysCount: (n: number) => (n === 1 ? "1 method recorded" : `${n} methods recorded`),
    partOfHeading: "This is a step inside",
    partOfNone: "Nothing in this graph needs this as a step, so it is where a reading starts.",
    skipHeading: "Routes that skip this layer",
    skipNone: "No recorded route avoids this step.",
    skipLead:
      "These do not fill the slot. They replace the span it belongs to, so this layer is not on their path at all.",
    fillsHeading: "What it fills",
    refinesLabel: "A narrower version of",
    conditionsHeading: "When it applies",
    conditionsNone: "No source we have read states a condition on this. That is an absence, not a green light.",
    costHeading: "Cost, as the source states it",
    costNone: "No complexity is recorded here.",
    contestedHeading: "Where the claim is contested",
    needsHeading: "What it needs",
    needsNone: "Nothing below this — it bottoms out here.",
    needsUndecomposed:
      "Nobody has taken this apart yet. That is a gap in this graph, not a claim that the method has no parts.",
    needsWays: (n: number) =>
      n === 0 ? "no method recorded" : n === 1 ? "1 method" : `${n} methods`,
    makesUnnecessaryHeading: "Slots it makes unnecessary",
    siblingsHeading: "Other ways to fill the same slot",
    siblingsNone: "Nothing else in this graph fills this slot.",
    alternativesLabel: "Different approaches",
    refinementsLabel: "Narrower versions of this one",
    variantOf: (label: string) => `a narrower version of ${label}`,
    atlasHeading: "In the Atlas",
    atlasNone:
      "No record in the Atlas covers this yet. The catalogue is 283 records of circuits and primitives; this part of the literature is not in it.",
    citationsHeading: "Sources",
    backToLayers: "← Layers",
    backToAtlas: "Atlas",
    layersLink: "Layers — how the pieces fit together",
    onLayers: "Where this sits",
    onLayersLead: "This record is named by the layer graph at:",
  },
  ja: {
    indexHeading: "階層",
    indexLead:
      "Atlas の各項目は、ひとつの回路が何であるかを述べます。この画面が述べるのは、ある部品が何から成り立っているか、そしてその場所を他に何が埋めうるかです。ステップを開けば、それが埋める枠と、そこに記録されたすべての手法が見えます。戻れば、その枠がどこの一部なのかが見えます。",
    modelHeading: "読み方",
    modelSlot:
      "枠とは、達成しようとしていることを、その水準での入力と出力として書いたものです。回路ではなく「Ax = b を量子状態として解く」といった記述になります。",
    modelMethod:
      "手法とは、枠を埋めるやり方です。同じ枠を埋める手法どうしは選択肢の関係にあり、速さだけでなく前提の置き方が異なります。",
    modelStep:
      "手法のステップは枠であって、選ばれた特定の手法ではありません。したがって下に降りると、誰かの好むパイプラインではなく選択肢そのものに到達します。",
    modelBypass:
      "枠をより上手に埋めるのではなく、枠そのものを不要にする経路もあります。それは明示します。「ここは飛ばせる」と決して言わない梯子は、必須の道筋として読まれてしまうからです。",
    censusHeading: "収録数（実測）",
    census: (nodes: number, capabilities: number, methods: number) =>
      `ノード${nodes}件。内訳は枠${capabilities}件と手法${methods}件です。`,
    censusAnchored: (anchored: number, nodes: number, records: number) =>
      `${nodes}件のうち${anchored}件が Atlas の項目に接続しており、指している項目は延べ${records}件です。残りは論文のみを挙げています。このグラフはカタログにまだ入っていない仕事を記述しており、項目のないノードこそ、これから読むべき文献の一覧です。`,
    censusOpen: (open: number, undecomposed: number) =>
      `手法が記録されていない枠が${open}件、分解されていない手法が${undecomposed}件あります。どちらも空欄にせず、その状態のまま表示します。`,
    censusUnresolved: (n: number) =>
      `このページの表示時にカタログが返さなかった項目を指す相互リンクが${n}件あります。そのため上の件数は、このグラフが宣言している数より少なくなっています。これはカタログ側の問題であって、グラフの欠落ではありません。`,
    startHeading: "ここから",
    depth: (n: number) => `第${n}層`,
    kindCapability: "枠",
    kindMethod: "手法",
    takes: "入力",
    returns: "出力",
    inherited: "埋める枠と同じ契約です。",
    narrowed: "この手法は枠の契約をより狭めています。",
    whyALayer: "これが階層である理由",
    waysHeading: "実現する手法",
    waysNone:
      "ここにはまだ手法が記録されていません。枠自体は実在します——この段階で何かが起きなければなりません——が、その方法をこのグラフは述べていません。",
    waysCount: (n: number) => `記録された手法${n}件`,
    partOfHeading: "これを内部に含むもの",
    partOfNone: "このグラフでこれをステップとして必要とするものはありません。読み始めの位置です。",
    skipHeading: "この階層を飛ばす経路",
    skipNone: "この段階を回避する経路は記録されていません。",
    skipLead:
      "これらは枠を埋めません。枠が属する区間ごと置き換えるため、この階層はそれらの経路上に存在しません。",
    fillsHeading: "埋める枠",
    refinesLabel: "より狭めた版：",
    conditionsHeading: "適用条件",
    conditionsNone: "参照した文献に条件の記載はありません。これは記載がないという事実であって、無条件という意味ではありません。",
    costHeading: "計算量（出典の記述のまま）",
    costNone: "計算量は記録されていません。",
    contestedHeading: "主張が争われている点",
    needsHeading: "必要とするもの",
    needsNone: "これより下はありません。ここで行き止まりです。",
    needsUndecomposed:
      "まだ分解されていません。これはこのグラフ側の欠落であって、この手法に部品がないという主張ではありません。",
    needsWays: (n: number) => (n === 0 ? "手法の記録なし" : `手法${n}件`),
    makesUnnecessaryHeading: "不要にする枠",
    siblingsHeading: "同じ枠を埋める他のやり方",
    siblingsNone: "このグラフでこの枠を埋めるものは他にありません。",
    alternativesLabel: "異なる方針",
    refinementsLabel: "これをより狭めた版",
    variantOf: (label: string) => `${label}をより狭めた版`,
    atlasHeading: "Atlas 内の項目",
    atlasNone:
      "これに対応する項目は Atlas にまだありません。カタログは回路と基本要素の283件で構成されており、この領域の文献は含まれていません。",
    citationsHeading: "出典",
    backToLayers: "← 階層",
    backToAtlas: "Atlas",
    layersLink: "階層 — 部品どうしの組み合わさり方",
    onLayers: "この項目の位置",
    onLayersLead: "この項目は階層グラフの次の箇所から参照されています：",
  },
} as const;

type LayersCopy = (typeof COPY)["en"] | (typeof COPY)["ja"];

function copyFor(locale: PublicLocale): LayersCopy {
  return locale === "ja" ? COPY.ja : COPY.en;
}

function label(node: LayerNode, locale: PublicLocale): string {
  return locale === "ja" ? node.labelJa : node.label;
}

function summary(node: LayerNode, locale: PublicLocale): string {
  return locale === "ja" ? node.summaryJa : node.summary;
}

function href(id: string): string {
  return `/repository/layers/${id}`;
}

/** The two-edged piece. Prose on both edges, and no verdict between them. */
function ContractPiece({
  graph,
  node,
  locale,
  copy,
}: {
  graph: LayerGraph;
  node: LayerNode;
  locale: PublicLocale;
  copy: LayersCopy;
}) {
  const resolved = contractFor(graph, node);
  if (!resolved) return null;
  const { contract, source } = resolved;
  const isJa = locale === "ja";
  return (
    <div className="mj-layers-piece">
      <div className="mj-layers-edge mj-layers-edge--in">
        <span className="mj-layers-edge-label">{copy.takes}</span>
        <p>{isJa ? contract.takesJa : contract.takes}</p>
      </div>
      <div className="mj-layers-edge mj-layers-edge--out">
        <span className="mj-layers-edge-label">{copy.returns}</span>
        <p>{isJa ? contract.returnsJa : contract.returns}</p>
      </div>
      {/* Said on every method, both ways round. A method that narrows the slot's
          contract is making a claim the slot does not make, and a reader
          choosing between siblings needs to see which of them moved it. */}
      {isMethod(node) ? (
        <p className="mj-layers-piece-note">
          {source === "inherited" ? copy.inherited : copy.narrowed}
        </p>
      ) : null}
    </div>
  );
}

function NodeLink({
  graph,
  node,
  locale,
  copy,
  note,
}: {
  graph: LayerGraph;
  node: LayerNode;
  locale: PublicLocale;
  copy: LayersCopy;
  note?: string;
}) {
  const parent = isMethod(node) && node.refines ? layerNode(graph, node.refines) : null;
  return (
    <li className="mj-layers-item">
      <a href={href(node.id)}>{label(node, locale)}</a>
      {/* An explicit space, not the span's margin. The margin separates them on
          screen and leaves them run together everywhere else — in the
          accessibility tree, in a copy-paste, and in `get_page_text`, where
          "LCHS with the improved kernela narrower version of…" is how this bug
          announced itself. */}
      {parent ? (
        <>
          {" "}
          <span className="mj-layers-item-kind">{copy.variantOf(label(parent, locale))}</span>
        </>
      ) : null}
      {note ? (
        <>
          {" "}
          <span className="mj-layers-item-kind">{note}</span>
        </>
      ) : null}
      <p>{summary(node, locale)}</p>
    </li>
  );
}

function EmptyNote({ children }: { children: string }) {
  return <p className="mj-layers-empty">{children}</p>;
}

function Citations({ node, copy }: { node: LayerNode; copy: LayersCopy }) {
  const citations = node.citations ?? [];
  if (citations.length === 0) return null;
  return (
    <section className="mj-layers-section" aria-labelledby={`sources-${node.id}`}>
      <h2 id={`sources-${node.id}`}>{copy.citationsHeading}</h2>
      <ul className="mj-layers-sources">
        {citations.map((citation) => (
          <li key={citation.url}>
            <a href={citation.url} rel="noreferrer noopener" target="_blank">
              {citation.title}
            </a>
            <span className="mj-layers-source-meta">
              {citation.authors} · {citation.year}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AtlasRecords({
  node,
  corpus,
  locale,
  copy,
}: {
  node: LayerNode;
  corpus: readonly LayerCorpusEntry[];
  locale: PublicLocale;
  copy: LayersCopy;
}) {
  const bySlug = new Map(corpus.map((entry) => [entry.slug, entry]));
  const slugs = entriesFor(node, new Set(bySlug.keys()));
  return (
    <section className="mj-layers-section" aria-labelledby={`atlas-${node.id}`}>
      <h2 id={`atlas-${node.id}`}>{copy.atlasHeading}</h2>
      {slugs.length === 0 ? (
        <EmptyNote>{copy.atlasNone}</EmptyNote>
      ) : (
        <ul className="mj-layers-records">
          {slugs.map((slug) => {
            const entry = bySlug.get(slug)!;
            return (
              <li key={slug}>
                <a href={`/repository/${slug}`}>{locale === "ja" ? entry.titleJa : entry.title}</a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** One capability page: the slot, its methods, what contains it, what skips it. */
function CapabilityView({
  graph,
  node,
  corpus,
  locale,
  copy,
}: {
  graph: LayerGraph;
  node: Extract<LayerNode, { kind: "capability" }>;
  corpus: readonly LayerCorpusEntry[];
  locale: PublicLocale;
  copy: LayersCopy;
}) {
  const methods = methodsRealizing(graph, node.id);
  const containers = containersOf(graph, node.id);
  const bypassers = bypassersOf(graph, node.id);
  return (
    <>
      <section className="mj-layers-section">
        <h2>{copy.whyALayer}</h2>
        <p>{locale === "ja" ? node.whyALayerJa : node.whyALayer}</p>
      </section>

      <section className="mj-layers-section" aria-labelledby={`ways-${node.id}`}>
        <h2 id={`ways-${node.id}`}>{copy.waysHeading}</h2>
        {methods.length === 0 ? (
          <EmptyNote>{copy.waysNone}</EmptyNote>
        ) : (
          <>
            <p className="mj-layers-count">{copy.waysCount(methods.length)}</p>
            <ul className="mj-layers-list">
              {methods.map((method) => (
                <NodeLink key={method.id} graph={graph} node={method} locale={locale} copy={copy} />
              ))}
            </ul>
          </>
        )}
      </section>

      {/* Its own section rather than a line in the one above, because it is the
          opposite claim: these routes do not fill the slot better, they remove
          it. Roadmap §9 already recorded that three routes replace three blocks
          at once, and that is the fact the whole surface exists to carry. */}
      <section className="mj-layers-section" aria-labelledby={`skip-${node.id}`}>
        <h2 id={`skip-${node.id}`}>{copy.skipHeading}</h2>
        {bypassers.length === 0 ? (
          <EmptyNote>{copy.skipNone}</EmptyNote>
        ) : (
          <>
            <p>{copy.skipLead}</p>
            <ul className="mj-layers-list">
              {bypassers.map((method) => (
                <NodeLink key={method.id} graph={graph} node={method} locale={locale} copy={copy} />
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="mj-layers-section" aria-labelledby={`part-${node.id}`}>
        <h2 id={`part-${node.id}`}>{copy.partOfHeading}</h2>
        {containers.length === 0 ? (
          <EmptyNote>{copy.partOfNone}</EmptyNote>
        ) : (
          <ul className="mj-layers-list">
            {containers.map((method) => (
              <NodeLink key={method.id} graph={graph} node={method} locale={locale} copy={copy} />
            ))}
          </ul>
        )}
      </section>

      <AtlasRecords node={node} corpus={corpus} locale={locale} copy={copy} />
      <Citations node={node} copy={copy} />
    </>
  );
}

/** One method page. */
function MethodView({
  graph,
  node,
  corpus,
  locale,
  copy,
}: {
  graph: LayerGraph;
  node: LayerMethod;
  corpus: readonly LayerCorpusEntry[];
  locale: PublicLocale;
  copy: LayersCopy;
}) {
  const isJa = locale === "ja";
  const capability = realizedBy(graph, node);
  const parent = node.refines ? layerNode(graph, node.refines) : null;
  const outlook = stepsOutlook(node);
  const alternatives = alternativesTo(graph, node);
  const refinements = refinementsOf(graph, node);
  const skipped = (node.bypasses ?? [])
    .map((id) => layerNode(graph, id))
    .filter((target): target is LayerNode => target !== null);

  return (
    <>
      <section className="mj-layers-section">
        <h2>{copy.fillsHeading}</h2>
        {capability ? (
          <ul className="mj-layers-list">
            <NodeLink graph={graph} node={capability} locale={locale} copy={copy} />
          </ul>
        ) : null}
        {parent ? (
          <p className="mj-layers-refines">
            {copy.refinesLabel} <a href={href(parent.id)}>{label(parent, locale)}</a>
          </p>
        ) : null}
      </section>

      <section className="mj-layers-section">
        <h2>{copy.conditionsHeading}</h2>
        {node.conditions ? (
          <p>{isJa ? node.conditionsJa : node.conditions}</p>
        ) : (
          <EmptyNote>{copy.conditionsNone}</EmptyNote>
        )}
      </section>

      <section className="mj-layers-section">
        <h2>{copy.costHeading}</h2>
        {node.cost ? <p>{isJa ? node.costJa : node.cost}</p> : <EmptyNote>{copy.costNone}</EmptyNote>}
      </section>

      {node.contested ? (
        <section className="mj-layers-section mj-layers-section--contested">
          <h2>{copy.contestedHeading}</h2>
          <p>{isJa ? node.contestedJa : node.contested}</p>
        </section>
      ) : null}

      <section className="mj-layers-section" aria-labelledby={`needs-${node.id}`}>
        <h2 id={`needs-${node.id}`}>{copy.needsHeading}</h2>
        {outlook === "decomposed" ? (
          <ol className="mj-layers-steps">
            {node.steps.map((stepId) => {
              const step = layerNode(graph, stepId);
              if (!step) return null;
              // The count is the branching factor, and printing it here is what
              // makes descending feel like a choice rather than a corridor.
              const ways = methodsRealizing(graph, stepId).length;
              return (
                <li key={stepId}>
                  <a href={href(stepId)}>{label(step, locale)}</a>{" "}
                  <span className="mj-layers-item-kind">{copy.needsWays(ways)}</span>
                  <p>{summary(step, locale)}</p>
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyNote>{outlook === "atomic" ? copy.needsNone : copy.needsUndecomposed}</EmptyNote>
        )}
      </section>

      {skipped.length > 0 ? (
        <section className="mj-layers-section" aria-labelledby={`skips-${node.id}`}>
          <h2 id={`skips-${node.id}`}>{copy.makesUnnecessaryHeading}</h2>
          <p>{copy.skipLead}</p>
          <ul className="mj-layers-list">
            {skipped.map((target) => (
              <NodeLink key={target.id} graph={graph} node={target} locale={locale} copy={copy} />
            ))}
          </ul>
        </section>
      ) : null}

      {/* Two lists, and they are a partition of the siblings — disjoint, and
          either may be zero. No sentence here counts one against the other:
          "and N more" was false on the record that motivated the interface
          panel, and the fix agreed then was to pin the property rather than the
          wording. Each list therefore stands alone or is absent. */}
      <section className="mj-layers-section" aria-labelledby={`siblings-${node.id}`}>
        <h2 id={`siblings-${node.id}`}>{copy.siblingsHeading}</h2>
        {alternatives.length === 0 && refinements.length === 0 ? (
          <EmptyNote>{copy.siblingsNone}</EmptyNote>
        ) : null}
        {alternatives.length > 0 ? (
          <>
            <h3>{copy.alternativesLabel}</h3>
            <ul className="mj-layers-list">
              {alternatives.map((method) => (
                <NodeLink key={method.id} graph={graph} node={method} locale={locale} copy={copy} />
              ))}
            </ul>
          </>
        ) : null}
        {refinements.length > 0 ? (
          <>
            <h3>{copy.refinementsLabel}</h3>
            <ul className="mj-layers-list">
              {refinements.map((method) => (
                <NodeLink key={method.id} graph={graph} node={method} locale={locale} copy={copy} />
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <AtlasRecords node={node} corpus={corpus} locale={locale} copy={copy} />
      <Citations node={node} copy={copy} />
    </>
  );
}

export function LayerNodeView({
  graph,
  node,
  corpus,
  locale,
}: {
  graph: LayerGraph;
  node: LayerNode;
  corpus: readonly LayerCorpusEntry[];
  locale: PublicLocale;
}) {
  const copy = copyFor(locale);
  const depth = layerDepths(graph).get(isCapability(node) ? node.id : node.realizes);
  return (
    <article className="mj-layers-node">
      <nav className="mj-layers-crumbs" aria-label={copy.indexHeading}>
        <a href="/repository/layers">{copy.backToLayers}</a>
        <a href="/repository">{copy.backToAtlas}</a>
      </nav>
      <header className="mj-layers-node-head">
        <p className="mj-layers-kicker">
          <span className="mj-layers-kind">
            {isCapability(node) ? copy.kindCapability : copy.kindMethod}
          </span>
          {depth === undefined ? null : <span>{copy.depth(depth)}</span>}
        </p>
        <h1>{label(node, locale)}</h1>
        <p className="mj-layers-lede">{summary(node, locale)}</p>
        <ContractPiece graph={graph} node={node} locale={locale} copy={copy} />
      </header>
      {isCapability(node) ? (
        <CapabilityView graph={graph} node={node} corpus={corpus} locale={locale} copy={copy} />
      ) : (
        <MethodView graph={graph} node={node} corpus={corpus} locale={locale} copy={copy} />
      )}
    </article>
  );
}

/**
 * The index: the model, the counted census, and every root opened one level.
 *
 * One level rather than the whole tree on purpose. The tree is the product and
 * it is also unreadable at a glance; what a reader needs on arrival is the shape
 * — a problem, the handful of routes that answer it, and the visible fact that
 * each route names further slots. The `<details>` per root is addressable and
 * needs no JavaScript.
 */
export function LayerIndexView({
  graph,
  corpus,
  locale,
  openRoot,
}: {
  graph: LayerGraph;
  corpus: readonly LayerCorpusEntry[];
  locale: PublicLocale;
  openRoot: string | null;
}) {
  const copy = copyFor(locale);
  const census = layerCensus(
    graph,
    new Set(corpus.map((entry) => entry.slug)),
  );
  const roots = rootCapabilities(graph);
  return (
    <section className="mj-layers-index" aria-labelledby="layers-heading">
      <nav className="mj-layers-crumbs" aria-label={copy.backToAtlas}>
        <a href="/repository">← {copy.backToAtlas}</a>
      </nav>
      {/* The other drawing of this same graph. Both views have an address, and
          neither is reachable only from the other — a reader who lands on
          `?view=list` from a bookmark can still get to the canvas. */}
      <div className="mj-strand-switch" role="group" aria-label={locale === "ja" ? "表示" : "View"}>
        <span className="mj-strand-switch-label">{locale === "ja" ? "表示" : "View"}</span>
        <a href="/repository/layers?view=strands">{locale === "ja" ? "ストランド" : "Strands"}</a>
        <span className="mj-strand-switch-on">{locale === "ja" ? "リスト" : "List"}</span>
      </div>
      <h1 id="layers-heading">{copy.indexHeading}</h1>
      <p className="mj-layers-lede">{copy.indexLead}</p>

      <section className="mj-layers-model">
        <h2>{copy.modelHeading}</h2>
        <ul>
          <li>{copy.modelSlot}</li>
          <li>{copy.modelMethod}</li>
          <li>{copy.modelStep}</li>
          <li>{copy.modelBypass}</li>
        </ul>
      </section>

      {/* Counted from the graph and the corpus in hand — not one of these
          numbers is written into the sentence. Same rule as the Atlas preface,
          and it matters more here: the honest reading of this surface today is
          that most of it has no record behind it, and a hard-coded number would
          stop saying so the moment the graph grew. */}
      <section className="mj-layers-census">
        <h2>{copy.censusHeading}</h2>
        <p>{copy.census(census.nodes, census.capabilities, census.methods)}</p>
        <p>{copy.censusAnchored(census.anchored, census.nodes, census.distinctEntries)}</p>
        <p>{copy.censusOpen(census.openCapabilities, census.undecomposedMethods)}</p>
        {/* Absent on a healthy catalogue, and that absence is correct: this is
            not a status field, it is the sentence that stops the number above
            from going quietly wrong when the catalogue serves less than the
            repo does. `check-layer-graph.mjs` proves the links resolve at build
            time; nothing proves it at read time. */}
        {census.unresolvedEntries > 0 ? (
          <p className="mj-layers-census-warn">{copy.censusUnresolved(census.unresolvedEntries)}</p>
        ) : null}
      </section>

      <h2 className="mj-layers-start">{copy.startHeading}</h2>
      <div className="mj-layers-roots">
        {roots.map((root) => {
          const methods = methodsRealizing(graph, root.id);
          return (
            <details
              key={root.id}
              className="mj-layers-root"
              open={openRoot === null ? roots[0]?.id === root.id : openRoot === root.id}
            >
              <summary>
                <span className="mj-layers-root-title">{label(root, locale)}</span>
                <span className="mj-layers-item-kind">
                  {capabilityOutlook(graph, root.id) === "open"
                    ? copy.needsWays(0)
                    : copy.waysCount(methods.length)}
                </span>
              </summary>
              <div className="mj-layers-root-body">
                <p>{summary(root, locale)}</p>
                <p className="mj-layers-root-link">
                  <a href={href(root.id)}>{label(root, locale)} →</a>
                </p>
                {methods.length === 0 ? (
                  <EmptyNote>{copy.waysNone}</EmptyNote>
                ) : (
                  <ul className="mj-layers-list">
                    {methods.map((method) => {
                      const steps = method.steps
                        .map((id) => layerNode(graph, id))
                        .filter((step): step is LayerNode => step !== null);
                      return (
                        <li key={method.id} className="mj-layers-item">
                          <a href={href(method.id)}>{label(method, locale)}</a>
                          <p>{summary(method, locale)}</p>
                          {steps.length > 0 ? (
                            <ul className="mj-layers-substeps">
                              {steps.map((step) => (
                                <li key={step.id}>
                                  <a href={href(step.id)}>{label(step, locale)}</a>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The strip an Atlas entry page shows when the layer graph names it.
 *
 * Renders nothing when no node does — unlike the panels on this surface, whose
 * emptiness is a finding. Here an absence is the default for 279 of 283 records
 * and saying so on every one of them would be noise, not honesty.
 */
export function EntryLayerLinks({
  graph,
  slug,
  locale,
}: {
  graph: LayerGraph;
  slug: string;
  locale: PublicLocale;
}) {
  const copy = copyFor(locale);
  const nodes = graph.nodes.filter((node) => (node.entries ?? []).includes(slug));
  if (nodes.length === 0) return null;
  return (
    <section className="mj-layers-entry-strip" aria-labelledby={`entry-layers-${slug}`}>
      <h2 id={`entry-layers-${slug}`}>{copy.onLayers}</h2>
      <p>{copy.onLayersLead}</p>
      <ul className="mj-layers-list">
        {nodes.map((node) => (
          <li key={node.id} className="mj-layers-item">
            <a href={href(node.id)}>{label(node, locale)}</a>{" "}
            <span className="mj-layers-item-kind">
              {isCapability(node) ? copy.kindCapability : copy.kindMethod}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
