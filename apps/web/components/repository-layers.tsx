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
import { ViewSwitch } from "./repository-view-switch";
import type { PublicLocale } from "../lib/public-locale";
import {
  alternativesTo,
  bypassersOf,
  capabilityOutlook,
  containersOf,
  contractFor,
  entriesFor,
  foldedAgainst,
  isCapability,
  isMethod,
  layerCensus,
  layerDepths,
  layerNode,
  methodsRealizing,
  realizedBy,
  refinementsOf,
  repetitionOf,
  rootCapabilities,
  stateTraffic,
  stepsOutlook,
  type LayerCorpusEntry,
  type LayerGraph,
  type LayerMethod,
  type LayerNode,
} from "../lib/repository/layers";
import { layoutProcessZoom } from "../lib/repository/process-layout";
import { PAPER_REGISTER } from "../lib/repository/paper-register";
import { paperTraces } from "../lib/repository/paper-traces";
import { indexPapers, paperIdFromUrl, paperSlug } from "../lib/repository/papers";
import { SOURCE_COVERAGE_AXES } from "../lib/repository/types";
import { STATE_VOCABULARY } from "../lib/repository/state-vocabulary";
import {
  kindsOf,
  layerState,
  specializationsOf,
  type LayerState,
  type StateVocabulary,
} from "../lib/repository/states";
import { ProcessCanvas } from "./repository-process-map";
import { mapHref, ZoomControl, type MapZoom } from "./repository-process-view";

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
    // The badge says the multiplicity; the closure says what one turn costs.
    // They are two sentences because they are two facts, and a reader deciding
    // between shot-based and coherent readout is deciding on the second one.
    repeatsBadge: (count: string) => `runs ${count}`,
    // NOT "so nothing is prepared again" — that was wrong, and wrong against two
    // of this graph's own records: HHL prepares |b⟩ afresh in every one of its
    // O(κ) amplification rounds, and amplitude estimation runs the preparation
    // forwards and backwards on every iteration. What a coherent loop never pays
    // is a readout.
    repeatsCoherent:
      "The loop stays coherent: nothing is measured between turns. The preparation may still be reapplied every turn — what the loop never pays is a readout and a restart from classical data. The price is depth, and a success probability that multiplies down the chain.",
    repeatsMeasured:
      "The loop closes through a measurement: every turn ends in a readout and starts from a fresh preparation. The price is a count of runs, not a depth.",
    repeatsHeading: "Steps it runs more than once",
    loopHeading: "Routes that run this slot many times",
    loopLead:
      "For these routes this slot is inside a loop, so its cost is multiplied rather than paid once. That multiplier is usually the largest single term in what the route costs.",
    loopUnpinnedLabel: "No multiplicity recorded",
    loopUnpinnedLead:
      "These routes take this step and no source we have read says how often. That is an absence, not a claim that they take it once.",
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
    papersLead: (cited: number, total: number) =>
      `Every claim here rests on a source. This graph cites ${cited} papers; they and the ${total - cited} the Atlas cites alone are registered in one place, with what each reports and everywhere it is cited from.`,
    papersLink: "Papers",
    sourceOutLabel: "open the paper itself",
    // Printed on every citation, including the ones nobody has read for this.
    // The owner's theory-vs-experimentation question is answered here, on the
    // map, rather than one navigation away.
    reportsAxis: { theory: "theory", simulation: "simulation", hardware: "hardware" },
    reportsStatus: { reported: "yes", absent: "no", unknown: "?" },
    reportsUnread: "nobody has read this paper for what it reports",
    backToLayers: "← Layers",
    backToAtlas: "Atlas",
    layersLink: "Layers — how the pieces fit together",
    onLayers: "Where this sits",
    onLayersLead: "This record is named by the layer graph at:",
    kindState: "State",
    stateLede:
      "A state is an object you can be holding, named once so that two routes reaching the same thing are drawn as reaching the same thing. It says nothing about how you got here or where you can go next — that is entirely in the processes below.",
    stateKindsHeading: "This is a kind of",
    stateKindsNone:
      "This state is not recorded as a kind of anything else. It stands on its own in the vocabulary.",
    stateKindsLead:
      "Anything that asks for one of these will accept this, because it is narrower. The reverse does not hold.",
    stateNarrowerHeading: "Narrower kinds of this",
    stateNarrowerNone: "No state in the vocabulary is recorded as a narrower kind of this one.",
    stateArrivingHeading: "Work that arrives here",
    stateArrivingNone:
      "No recorded process returns this. Either it is where a reader starts — a problem, a matrix, a machine — or it is an object this graph names and no route yet reaches.",
    stateArrivingOnlyNarrowed:
      "No contract in this graph returns this. It is reached only by narrowing, below — which is a real arrival, and the reason the state is named at all.",
    stateLeavingHeading: "Work that starts here",
    stateLeavingNone: "No recorded process takes this as its input. Nothing in this graph leaves from here.",
    stateLeavingOnlyAccepted:
      "No process asks for this by name. The ones below ask for something broader, and this is a kind of it — so they take it as it stands.",
    stateAcceptedHeading: "Also accepted where something broader is wanted",
    stateAcceptedLead:
      "These ask for an object this one is a kind of. Narrowing composes in that direction and only that direction: handing on something broader than a process asks for would be a skipped conversion.",
    stateNarrowedHeading: "Routes that reach it by narrowing",
    stateNarrowedLead:
      "These do not declare it in a contract. They record that one of their steps lands on something narrower than the slot promises, and this is that narrower thing.",
    stateOnMap: "See it on the map",
    zoomHeading: "This one, drawn",
    zoomFrom: "From",
    zoomTo: "to",
    zoomReadingSlot:
      "A circle is an object you are holding. Each line between the two ends is one recorded way through this slot; where a way is built from smaller slots, those are its own lines.",
    zoomReadingMethod:
      "A circle is an object you are holding. Each line along the row is one step of this method — a slot, with its own ways through it — and the two ends are what you start and finish holding.",
    zoomUnfilled:
      "The line is drawn broken because no method is recorded for this slot. The two ends are still what it would take and return.",
    zoomDeeper: (n: number) =>
      `${n} ${n === 1 ? "line here has ways" : "lines here have ways"} through that this figure does not open. The map opens them in place.`,
    zoomAllShallow: "Nothing drawn here has a recorded way through it that this figure leaves shut.",
    zoomNames: "Circles are named on hover, and each one is a link.",
    zoomLabel: "Size",
    zoomFit: "Fit",
    zoomPercent: (n: number) => `${n}%`,
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
    repeatsBadge: (count: string) => `実行回数：${count}`,
    repeatsCoherent:
      "反復はコヒーレントに閉じます。回と回の間で測定は行われません。準備ユニタリ自体は毎回適用され直すことがありますが、読み出しと、古典的なデータからの再出発は生じません。代価は深さと、連鎖のあいだ掛け合わされていく成功確率です。",
    repeatsMeasured:
      "反復は測定を挟んで閉じます。1 回ごとに読み出しで終わり、次は新たな準備から始まります。代価は深さではなく実行回数です。",
    repeatsHeading: "複数回実行する手順",
    loopHeading: "この枠を何度も実行する経路",
    loopLead:
      "これらの経路では、この枠は反復の内側にあります。したがってその費用は 1 回分ではなく、回数分だけ掛かります。多くの場合、この倍率が経路全体の費用のなかで最大の項になります。",
    loopUnpinnedLabel: "回数の記録なし",
    loopUnpinnedLead:
      "これらの経路はこの手順を踏みますが、回数を述べた出典は確認できていません。これは記録の欠落であって、1 回だけ踏むという主張ではありません。",
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
    papersLead: (cited: number, total: number) =>
      `ここでの主張はすべて出典に基づいています。この図が引用しているのは ${cited} 件で、それらとアトラスのみが引用する ${total - cited} 件は、一箇所に登録されています。各論文が何を報告しているか、どこから引用されているかも併せて記録しています。`,
    papersLink: "論文",
    sourceOutLabel: "論文そのものを開く",
    reportsAxis: { theory: "理論", simulation: "数値計算", hardware: "実機" },
    reportsStatus: { reported: "あり", absent: "なし", unknown: "未確定" },
    reportsUnread: "この論文が何を報告しているかは、まだ誰も読んでいません",
    backToLayers: "← 階層",
    backToAtlas: "Atlas",
    layersLink: "階層 — 部品どうしの組み合わさり方",
    onLayers: "この項目の位置",
    onLayersLead: "この項目は階層グラフの次の箇所から参照されています：",
    kindState: "対象",
    stateLede:
      "対象とは、手にしている当のものです。名前をひとつに定めてあるため、同じものに到達する二つの経路は、同じものに到達しているものとして描かれます。どうやってここへ来たか、ここからどこへ行けるかについては何も述べません。それはすべて下に並ぶ処理の側にあります。",
    stateKindsHeading: "これが属する種類",
    stateKindsNone: "この対象は、他の何かの一種としては記録されていません。語彙のなかで単独に立っています。",
    stateKindsLead:
      "これらのいずれかを要求する処理は、この対象を受け取れます。より狭いからです。逆は成り立ちません。",
    stateNarrowerHeading: "これをより狭めた種類",
    stateNarrowerNone: "これをより狭めた種類として記録されている対象はありません。",
    stateArrivingHeading: "ここへ到達する処理",
    stateArrivingNone:
      "これを返す処理は記録されていません。読み手が最初から手にしている対象——問題、行列、装置——であるか、あるいはこのグラフが名前を与えたもののどの経路もまだ到達していない対象です。",
    stateArrivingOnlyNarrowed:
      "このグラフの契約でこれを返すものはありません。到達は下の「狭めること」によってのみ起こります。それも実際の到達であり、この対象に名前がある理由そのものです。",
    stateLeavingNone: "これを入力として受け取る処理は記録されていません。ここから出発するものはこのグラフにありません。",
    stateLeavingOnlyAccepted:
      "この対象を名指しで要求する処理はありません。下に挙げるものはより広い対象を要求しており、これはその一種です。したがって、そのまま受け取られます。",
    stateAcceptedHeading: "より広い対象を要求する箇所でも受け取られる",
    stateAcceptedLead:
      "これらは、この対象が属する種類を要求します。狭めることはその向きにのみ合成でき、逆向きには合成できません。要求より広い対象を渡すことは、変換をひとつ飛ばしていることになります。",
    stateLeavingHeading: "ここから出発する処理",
    stateNarrowedHeading: "狭めることで到達する経路",
    stateNarrowedLead:
      "これらは契約でこの対象を宣言しているわけではありません。ステップのひとつが枠の約束よりも狭い対象に着地することを記録しており、その狭い対象がこれです。",
    stateOnMap: "地図上で見る",
    zoomHeading: "この処理の図",
    zoomFrom: "入力：",
    zoomTo: "→",
    zoomReadingSlot:
      "円は、手にしている対象です。両端のあいだに引かれた各線が、この枠を通る記録済みの一つのやり方です。より小さな枠から組み立てられているやり方では、その枠が線として並びます。",
    zoomReadingMethod:
      "円は、手にしている対象です。行に並ぶ各線がこの手法の一段階——それぞれ通り道をもつ枠——であり、両端が、始めと終わりに手にしている対象です。",
    zoomUnfilled:
      "この枠に手法が記録されていないため、線は破線で描かれています。両端は、それでもこの枠が受け取り返すはずの対象です。",
    zoomDeeper: (n: number) =>
      `この図が開いていない通り道をもつ線が ${n} 本あります。地図ではその場で開けます。`,
    zoomAllShallow: "この図が閉じたままにしている通り道は、ここにはありません。",
    zoomNames: "円の名前はホバーで表示され、それぞれがリンクです。",
    zoomLabel: "表示倍率",
    zoomFit: "全体表示",
    zoomPercent: (n: number) => `${n}%`,
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

/**
 * The zoomed figure: this process, its two states, and the first level of it.
 *
 * The owner asked for this in session 92 and got half of it in 93 — a name on the
 * map became a link to a page, and the page was the text write-up it had always
 * been. *"Clicking on the label of a process zooms in with the first level of the
 * process expanded with connection to the two states before and after, with the
 * original process label in the top right like the strand visualization."*
 *
 * It is the map's own engine at depth one (`layoutProcessZoom`), so there is one
 * geometry for one picture. What the page adds around it is the thing a drawing
 * cannot carry: the two states **written out**. Their names are in `<title>` on
 * the canvas, which is a hover — and there is no hover on a phone. Naming them
 * here in prose, as links, is the same fact in a form every reader gets.
 */
function ProcessZoom({
  graph,
  node,
  locale,
  copy,
  zoom,
}: {
  graph: LayerGraph;
  node: LayerNode;
  locale: PublicLocale;
  copy: LayersCopy;
  zoom: MapZoom | null;
}) {
  const resolved = contractFor(graph, node);
  const diagram = layoutProcessZoom(graph, STATE_VOCABULARY, node.id, locale === "ja" ? "ja" : "en");
  // An unresolvable contract or an empty layout means the graph does not have
  // the two ends this figure is *about*. Drawing a picture of that would be
  // inventing one; the sections below still say everything they always said.
  if (!resolved || diagram.width === 0) return null;
  const from = layerState(STATE_VOCABULARY, resolved.contract.from);
  const to = layerState(STATE_VOCABULARY, resolved.contract.to);
  const unfilled = isCapability(node) && capabilityOutlook(graph, node.id) === "open";
  const mapId = isCapability(node) ? node.id : node.realizes;

  return (
    <figure className="mj-layers-zoom" aria-labelledby={`zoom-${node.id}`}>
      {/* The label the card used to wear as a heading, kept as a heading because
          it is the accessible name of this figure, and taken out of the visual
          flow because *"clicking on labels shouldn't feel like it shows a
          completely different screen"* — and a strapline over a framed panel is
          exactly how a screen announces itself. The reader arrived here by
          clicking this thing's name; being told "this one, drawn" is a caption
          for a picture they are already looking at. Screen readers still get it,
          which is the whole reason it is `sr-only` rather than deleted. */}
      <h2 className="mj-layers-zoom-heading sr-only" id={`zoom-${node.id}`}>
        {copy.zoomHeading}
      </h2>
      {/* The reader's own size. A figure can be 1,233px wide in an 868px column:
          *"they can zoom in and out of the page on their own"*, owner, session
          92. It applies to this figure and stops at this page — the map below is
          a different drawing at a different natural width. */}
      <ZoomControl
        current={zoom}
        hrefFor={(next) => (next === null ? href(node.id) : `${href(node.id)}?zoom=${next}`)}
        copy={copy}
      />
      <ProcessCanvas
        diagram={diagram}
        locale={locale === "ja" ? "ja" : "en"}
        title={label(node, locale)}
        scale={zoom === null ? null : zoom / 100}
        // The same figure the map draws for this slot, so arriving here moves
        // that figure rather than replacing the screen it was on. A method's
        // page is drawn through `soleMethodLens` and is a genuinely different
        // picture, so it pairs with nothing on the map and gets the page-level
        // zoom instead — which is the honest animation for "a different figure".
        subjectId={node.id}
      />
      <figcaption className="mj-layers-zoom-caption">
        {from && to ? (
          <p className="mj-layers-zoom-ends">
            {copy.zoomFrom} <a href={href(from.id)}>{stateLabel(from, locale)}</a> {copy.zoomTo}{" "}
            <a href={href(to.id)}>{stateLabel(to, locale)}</a>
          </p>
        ) : null}
        <p>
          {unfilled ? copy.zoomUnfilled : isCapability(node) ? copy.zoomReadingSlot : copy.zoomReadingMethod}{" "}
          {copy.zoomNames}
        </p>
        <p>
          {diagram.collapsedCount > 0 ? copy.zoomDeeper(diagram.collapsedCount) : copy.zoomAllShallow}{" "}
          {/* No open set, and that is right rather than an omission: a write-up
              page is not a reading position on the map, so there is nothing to
              carry. Every link that *is* on the map passes one — see `mapHref`,
              where leaving it out was a live defect. */}
          <a href={mapHref(mapId)}>{copy.stateOnMap}</a>
        </p>
      </figcaption>
    </figure>
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

/**
 * The sources behind a node — each now an address on this site as well as a
 * link off it.
 *
 * Two links per citation, deliberately. The title goes to `/repository/papers/…`
 * because that page is the only place that says what the paper reports and
 * everywhere else it is cited from; the arrow goes to the paper itself, because
 * a reader who wants the PDF should not have to make two hops for it. Both are
 * `<a href>`, so `curl` sees the same surface a browser does.
 *
 * The theory/simulation/hardware line is printed **here**, on the map, rather
 * than only on the paper page. That distinction was the owner's ask, and a fact
 * a reader has to navigate away to see is a fact the map does not have.
 * `unread` is printed rather than omitted — an absence that renders as silence
 * reads as "nothing to say", which is the one thing it does not mean.
 */
function Citations({ node, copy, locale }: { node: LayerNode; copy: LayersCopy; locale: PublicLocale }) {
  const citations = node.citations ?? [];
  if (citations.length === 0) return null;
  const register = indexPapers(PAPER_REGISTER);
  return (
    <section className="mj-layers-section" aria-labelledby={`sources-${node.id}`}>
      <h2 id={`sources-${node.id}`}>{copy.citationsHeading}</h2>
      <ul className="mj-layers-sources">
        {citations.map((citation) => {
          // A citation whose url the register cannot key on already fails
          // `check-paper-register.mjs`, so this branch is unreachable on a
          // green tree. It renders the plain external link rather than a dead
          // internal one, because a broken tree is exactly when a page must
          // still render.
          const paperId = paperIdFromUrl(citation.url);
          const paper = paperId ? register.get(paperId) : undefined;
          return (
            <li key={citation.url}>
              {paper ? (
                <a href={`/repository/papers/${paperSlug(paper.id)}`}>{citation.title}</a>
              ) : (
                <a href={citation.url} rel="noreferrer noopener" target="_blank">
                  {citation.title}
                </a>
              )}
              {paper ? (
                <a
                  className="mj-layers-source-out"
                  href={citation.url}
                  rel="noreferrer noopener"
                  target="_blank"
                  aria-label={`${citation.title} — ${copy.sourceOutLabel}`}
                >
                  ↗
                </a>
              ) : null}
              <span className="mj-layers-source-meta">
                {citation.authors} · {citation.year}
              </span>
              <span className="mj-layers-source-meta">
                {paper?.reports
                  ? SOURCE_COVERAGE_AXES.map(
                      (axis) => `${copy.reportsAxis[axis]} ${copy.reportsStatus[paper.reports![axis]]}`,
                    ).join(" · ")
                  : copy.reportsUnread}
              </span>
            </li>
          );
        })}
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
        /* A title and a sentence, not a bare link.
           *"when people see specific algorithms on the map, they see the content
           of the atlas repository entry and can click around in there and export
           etc etc."* — owner, session 94. This is the first half: enough of the
           record to know what is behind the link before following it. The second
           half is the record's own page, which is where the code, the
           verification and the export live and where they stay — a copy of them
           here would be a second thing to keep in step with the first. */
        <ul className="mj-layers-records">
          {slugs.map((slug) => {
            const entry = bySlug.get(slug)!;
            const blurb = locale === "ja" ? entry.descriptionJa : entry.description;
            return (
              <li key={slug}>
                <a href={`/repository/${slug}`}>{locale === "ja" ? entry.titleJa : entry.title}</a>
                {blurb ? <p className="mj-layers-record-blurb">{blurb}</p> : null}
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

      {/* How often the routes above pay for this slot — the comparison that
          motivated the whole annotation, and it is only answerable here rather
          than on any one method page: paying once per time step is not a
          property of backward Euler, it is what backward Euler is relative to an
          all-at-once encoding.

          Drawn only where some route repeats it. The second list is headed "no
          multiplicity recorded" and never "runs it once", because that is what
          the graph says about those routes — nothing. */}
      <LoopComparison graph={graph} node={node} locale={locale} copy={copy} />

      <AtlasRecords node={node} corpus={corpus} locale={locale} copy={copy} />
      <Citations node={node} copy={copy} locale={locale} />
    </>
  );
}

/**
 * "Some routes run this slot many times; these others record nothing about how
 * often." Renders nothing at all when no route repeats the slot.
 */
function LoopComparison({
  graph,
  node,
  locale,
  copy,
}: {
  graph: LayerGraph;
  node: Extract<LayerNode, { kind: "capability" }>;
  locale: PublicLocale;
  copy: LayersCopy;
}) {
  const { unpinned, repeated } = foldedAgainst(graph, node.id);
  if (repeated.length === 0) return null;
  const isJa = locale === "ja";
  return (
    <section className="mj-layers-section" aria-labelledby={`loop-${node.id}`}>
      <h2 id={`loop-${node.id}`}>{copy.loopHeading}</h2>
      <p>{copy.loopLead}</p>
      <ul className="mj-layers-list">
        {repeated.map(({ method, repetition }) => (
          <li key={method.id} className="mj-layers-loop-row">
            <a href={href(method.id)}>{label(method, locale)}</a>{" "}
            <span
              className={`mj-layers-repeat mj-layers-repeat--${repetition.closure}`}
              data-closure={repetition.closure}
            >
              {copy.repeatsBadge(isJa ? repetition.countJa : repetition.count)}
            </span>
            <p>
              {repetition.closure === "measured" ? copy.repeatsMeasured : copy.repeatsCoherent}
            </p>
          </li>
        ))}
      </ul>
      {unpinned.length > 0 ? (
        <>
          <h3>{copy.loopUnpinnedLabel}</h3>
          <p>{copy.loopUnpinnedLead}</p>
          <ul className="mj-layers-list">
            {unpinned.map((method) => (
              <NodeLink key={method.id} graph={graph} node={method} locale={locale} copy={copy} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
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
              // How often this route takes this hop, where a source says. Absent
              // prints nothing at all — never "once". A route that has not been
              // measured must not be made to look like one that folds.
              const repetition = repetitionOf(node, stepId);
              return (
                <li key={stepId}>
                  <a href={href(stepId)}>{label(step, locale)}</a>{" "}
                  <span className="mj-layers-item-kind">{copy.needsWays(ways)}</span>
                  {repetition ? (
                    <span
                      className={`mj-layers-repeat mj-layers-repeat--${repetition.closure}`}
                      data-closure={repetition.closure}
                    >
                      {copy.repeatsBadge(isJa ? repetition.countJa : repetition.count)}
                    </span>
                  ) : null}
                  <p>{summary(step, locale)}</p>
                  {repetition ? (
                    <p className="mj-layers-repeat-note">
                      {repetition.closure === "measured"
                        ? copy.repeatsMeasured
                        : copy.repeatsCoherent}{" "}
                      {isJa ? repetition.noteJa : repetition.note}
                    </p>
                  ) : null}
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
      <Citations node={node} copy={copy} locale={locale} />
    </>
  );
}

export function LayerNodeView({
  graph,
  node,
  corpus,
  locale,
  zoom = null,
}: {
  graph: LayerGraph;
  node: LayerNode;
  corpus: readonly LayerCorpusEntry[];
  locale: PublicLocale;
  zoom?: MapZoom | null;
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
      {/* Before the prose, not after it. A reader who clicked a name on the map
          came here to see this one thing drawn; the write-up is what they read
          once they have found it. */}
      <ProcessZoom graph={graph} node={node} locale={locale} copy={copy} zoom={zoom} />
      {isCapability(node) ? (
        <CapabilityView graph={graph} node={node} corpus={corpus} locale={locale} copy={copy} />
      ) : (
        <MethodView graph={graph} node={node} corpus={corpus} locale={locale} copy={copy} />
      )}
    </article>
  );
}

function stateLabel(state: LayerState, locale: PublicLocale): string {
  return locale === "ja" ? state.labelJa : state.label;
}

function stateSummary(state: LayerState, locale: PublicLocale): string {
  return locale === "ja" ? state.summaryJa : state.summary;
}

function StateList({
  states,
  locale,
  empty,
  lead,
}: {
  states: readonly LayerState[];
  locale: PublicLocale;
  empty: string;
  lead?: string;
}) {
  if (states.length === 0) return <EmptyNote>{empty}</EmptyNote>;
  return (
    <>
      {lead ? <p>{lead}</p> : null}
      <ul className="mj-layers-list">
        {states.map((state) => (
          <li className="mj-layers-item" key={state.id}>
            <a href={href(state.id)}>{stateLabel(state, locale)}</a>
            <p>{stateSummary(state, locale)}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * A state's own page — the thing a circle on the map is a link to.
 *
 * It exists because the map draws every state as an `<a href>` and until now
 * every one of those was a 404: `layers/[id]` only ever resolved node ids, and
 * `validateLayerGraph` guarantees a state id is never a node id, so the two
 * facts together made every circle on the surface a dead end.
 *
 * What it says is deliberately narrow. A state is not a step, so this page never
 * describes a journey: it names the object, says what it is a kind of and what
 * kinds it has, and then lists the processes that touch it at either end — which
 * is the Markov framing the vocabulary is built on, rendered rather than
 * asserted.
 */
export function LayerStateView({
  graph,
  vocabulary,
  state,
  locale,
}: {
  graph: LayerGraph;
  vocabulary: StateVocabulary;
  state: LayerState;
  locale: PublicLocale;
}) {
  const copy = copyFor(locale);
  const index = new Map(vocabulary.states.map((entry) => [entry.id, entry]));
  // `kindsOf` includes the state itself — it answers "what does this satisfy?",
  // and a state satisfies itself. On this page the reader is being told what
  // *else* it is, so the state itself comes out.
  const broader = [...kindsOf(vocabulary, state.id)]
    .filter((id) => id !== state.id)
    .map((id) => index.get(id))
    .filter((entry): entry is LayerState => entry !== undefined);
  const narrower = specializationsOf(vocabulary, state.id);
  const traffic = stateTraffic(graph, vocabulary, state.id);
  return (
    <article className="mj-layers-node">
      <nav className="mj-layers-crumbs" aria-label={copy.indexHeading}>
        <a href="/repository/layers">{copy.backToLayers}</a>
        <a href="/repository/layers?view=map">{copy.stateOnMap}</a>
        <a href="/repository">{copy.backToAtlas}</a>
      </nav>
      <header className="mj-layers-node-head">
        <p className="mj-layers-kicker">
          <span className="mj-layers-kind">{copy.kindState}</span>
        </p>
        <h1>{stateLabel(state, locale)}</h1>
        <p className="mj-layers-lede">{stateSummary(state, locale)}</p>
        <p className="mj-layers-piece-note">{copy.stateLede}</p>
      </header>
      <section className="mj-layers-section" aria-labelledby={`kinds-${state.id}`}>
        <h2 id={`kinds-${state.id}`}>{copy.stateKindsHeading}</h2>
        <StateList
          states={broader}
          locale={locale}
          empty={copy.stateKindsNone}
          lead={broader.length > 0 ? copy.stateKindsLead : undefined}
        />
      </section>
      <section className="mj-layers-section" aria-labelledby={`narrower-${state.id}`}>
        <h2 id={`narrower-${state.id}`}>{copy.stateNarrowerHeading}</h2>
        <StateList states={narrower} locale={locale} empty={copy.stateNarrowerNone} />
      </section>
      <section className="mj-layers-section" aria-labelledby={`arriving-${state.id}`}>
        <h2 id={`arriving-${state.id}`}>{copy.stateArrivingHeading}</h2>
        {traffic.arriving.length === 0 ? (
          <EmptyNote>
            {traffic.narrowedInto.length > 0
              ? copy.stateArrivingOnlyNarrowed
              : copy.stateArrivingNone}
          </EmptyNote>
        ) : (
          <ul className="mj-layers-list">
            {traffic.arriving.map((node) => (
              <NodeLink graph={graph} node={node} locale={locale} copy={copy} key={node.id} />
            ))}
          </ul>
        )}
      </section>
      {traffic.narrowedInto.length === 0 ? null : (
        <section className="mj-layers-section" aria-labelledby={`narrowed-${state.id}`}>
          <h2 id={`narrowed-${state.id}`}>{copy.stateNarrowedHeading}</h2>
          <p>{copy.stateNarrowedLead}</p>
          <ul className="mj-layers-list">
            {traffic.narrowedInto.map((node) => (
              <NodeLink graph={graph} node={node} locale={locale} copy={copy} key={node.id} />
            ))}
          </ul>
        </section>
      )}
      <section className="mj-layers-section" aria-labelledby={`leaving-${state.id}`}>
        <h2 id={`leaving-${state.id}`}>{copy.stateLeavingHeading}</h2>
        {traffic.leaving.length === 0 ? (
          <EmptyNote>
            {traffic.acceptedBy.length > 0 ? copy.stateLeavingOnlyAccepted : copy.stateLeavingNone}
          </EmptyNote>
        ) : (
          <ul className="mj-layers-list">
            {traffic.leaving.map((node) => (
              <NodeLink graph={graph} node={node} locale={locale} copy={copy} key={node.id} />
            ))}
          </ul>
        )}
      </section>
      {traffic.acceptedBy.length === 0 ? null : (
        <section className="mj-layers-section" aria-labelledby={`accepted-${state.id}`}>
          <h2 id={`accepted-${state.id}`}>{copy.stateAcceptedHeading}</h2>
          <p>{copy.stateAcceptedLead}</p>
          <ul className="mj-layers-list">
            {traffic.acceptedBy.map((node) => (
              <NodeLink graph={graph} node={node} locale={locale} copy={copy} key={node.id} />
            ))}
          </ul>
        </section>
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
/**
 * What is here, counted — the only place on this site the graph's own census is
 * printed.
 *
 * **Exported and rendered from two views deliberately.** It lived inside
 * `LayerIndexView`, which is `?view=list` — not the default, and one of the
 * three views OWNER_TODO §5 proposes retiring. So the numbers that say how
 * complete this graph honestly is were reachable only from the surface most
 * likely to be deleted, and a reader on the default view was never shown them.
 *
 * Written once rather than copied onto converge, for the reason `ViewSwitch`
 * exists: four hand-written copies of one control is how `?view=converge`
 * shipped invisible. A census restated in two places is the same failure with
 * numbers, and numbers drift more quietly than links do.
 *
 * Counted from the graph and the corpus in hand — not one of these figures is
 * written into a sentence.
 */
export function LayerCensusPanel({
  graph,
  corpus,
  locale,
}: {
  graph: LayerGraph;
  corpus: readonly LayerCorpusEntry[];
  locale: PublicLocale;
}) {
  const copy = copyFor(locale);
  const census = layerCensus(graph, new Set(corpus.map((entry) => entry.slug)), STATE_VOCABULARY);
  return (
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
      {/* Counted here rather than written, and linked, because the sentence
          above is about what this graph documents and this one is about what
          it documents it *from*. A reader who wants the second is otherwise
          stuck opening node pages one at a time. */}
      <p>
        {copy.papersLead(paperTraces(graph).length, PAPER_REGISTER.papers.length)}{" "}
        <a href="/repository/papers">{copy.papersLink}</a>
      </p>
    </section>
  );
}

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
  const roots = rootCapabilities(graph);
  return (
    <section className="mj-layers-index" aria-labelledby="layers-heading">
      <nav className="mj-layers-crumbs" aria-label={copy.backToAtlas}>
        <a href="/repository">← {copy.backToAtlas}</a>
      </nav>
      {/* The other drawings of this same graph. Every view has an address and
          none is reachable only from another — a reader who lands here from a
          bookmark can still get to any canvas.

          The whole control comes from `ViewSwitch`, not just its words. Sharing
          the labels was not enough: four copies of the *markup* each listed the
          views they knew about, and when `?view=converge` shipped only its own
          copy gained the entry, so the default view had no link to it and the
          owner could not find the surface at all. One list, one place. */}
      <ViewSwitch current="list" locale={locale} />
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

      <LayerCensusPanel graph={graph} corpus={corpus} locale={locale} />

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
