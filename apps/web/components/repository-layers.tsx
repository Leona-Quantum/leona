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
  stateTraffic,
  stepsOutlook,
  type LayerCorpusEntry,
  type LayerGraph,
  type LayerMethod,
  type LayerNode,
} from "../lib/repository/layers";
import {
  CONVERGE_OPEN_MAX,
  figureHref,
  layoutConverge,
  layoutConvergeForMethod,
} from "../lib/repository/converge-layout";
import { convergeNotes } from "../lib/repository/converge-notes";
import { LOOP_CLOSURE_COPY } from "../lib/repository/loop-closure-copy";
import { IDENTITY, type Viewport } from "../lib/repository/canvas-viewport";
import { absenceOf, cardFor, exampleRunNote } from "../lib/repository/card-content";
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
import { MathText } from "./math-text";
import { ConvergeCanvas } from "./repository-converge-map";
import { CanvasContinuity } from "./canvas-continuity";
import { InfiniteCanvas } from "./infinite-canvas";

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
    // The owner's fifth section, and the empty note is his instruction rather
    // than a default: *"build the field for all, populate on demand, and let the
    // card say 'none written yet' for the rest rather than pretend"*. So this
    // section draws on every method page, and on most of them it draws the note.
    //
    // Authored here rather than read from a shared module, unlike
    // `LOOP_CLOSURE_COPY` above. That one was extracted because it is a *claim*
    // — two sentences about what a loop costs, which would say different things
    // about one record on two pages if either copy were edited. A heading is not
    // a claim, and this page and the card already head the same sections
    // differently on purpose (the card's own comment records the divergence).
    exampleHeading: "Example",
    exampleNone:
      "Nobody has written one yet. The field exists for every method — this is a worklist entry, not a claim that the method is too simple to need one.",
    costHeading: "Cost, as the source states it",
    costNone: "No complexity is recorded here.",
    implementationsHeading: "Implementations",
    // **"Absent is not zero", and the note has to say so**, because this is the
    // section a reader is most likely to misread as a verdict. The schema on
    // `LayerMethod.implementations` is explicit that absent means nobody has
    // written this method's implementations down and does **not** mean none
    // exist — and the paper register already knows better, recording per paper
    // whether it reports numerics or a hardware run.
    implementationsNone:
      "Nobody has written one up yet. That is a gap in this record, not a statement that the method has never been run — the paper register already records, per paper, which sources report numerics or a hardware run.",
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
    //
    // **Read from `loop-closure-copy.ts` rather than written here**, since the
    // map card began drawing the same records: two copies of one claim drift the
    // first time either is edited, and these two pages are one click apart.
    repeatsBadge: LOOP_CLOSURE_COPY.en.badge,
    repeatsCoherent: LOOP_CLOSURE_COPY.en.closure.coherent,
    repeatsMeasured: LOOP_CLOSURE_COPY.en.closure.measured,
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
    // A record count was typed here, not counted, and this component never sees
    // the corpus — so the number could only ever be a copy of one kept somewhere
    // else. The sentence's work is the *kind* of thing the catalogue holds, and
    // that is what tells a reader why this gap exists; the size of it never did.
    atlasNone:
      "No record in the Atlas covers this yet. The catalogue is circuits and primitives; this part of the literature is not in it.",
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
    // Rewritten in session 110, because it was false on all 63 method pages.
    // It described a *chain* — "each line along the row is one step of this
    // method" — and a method's page has never drawn one. It draws the fan of
    // ways through the slot this method fills, so the lines beside it are its
    // alternatives, not its steps. Its steps are what is drawn *inside* it.
    zoomReadingMethod:
      "A circle is an object you are holding. This method is drawn heavier, opened into its own steps; the other lines between the same two ends are the alternatives recorded for the same slot.",
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
    exampleHeading: "例",
    exampleNone:
      "まだ誰も書いていません。この欄はすべての手法に用意してあります。これは作業待ちの項目であって、例を要しないほど単純だという主張ではありません。",
    costHeading: "計算量（出典の記述のまま）",
    costNone: "計算量は記録されていません。",
    implementationsHeading: "実装",
    implementationsNone:
      "まだ誰も書き起こしていません。これはこのレコードの欠落であって、この手法が一度も実行されたことがないという主張ではありません。どの文献が数値計算や実機実行を報告しているかは、論文レジスタが論文ごとにすでに記録しています。",
    contestedHeading: "主張が争われている点",
    needsHeading: "必要とするもの",
    needsNone: "これより下はありません。ここで行き止まりです。",
    needsUndecomposed:
      "まだ分解されていません。これはこのグラフ側の欠落であって、この手法に部品がないという主張ではありません。",
    needsWays: (n: number) => (n === 0 ? "手法の記録なし" : `手法${n}件`),
    repeatsBadge: LOOP_CLOSURE_COPY.ja.badge,
    repeatsCoherent: LOOP_CLOSURE_COPY.ja.closure.coherent,
    repeatsMeasured: LOOP_CLOSURE_COPY.ja.closure.measured,
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
      "これに対応する項目は Atlas にまだありません。カタログは回路と基本要素で構成されており、この領域の文献は含まれていません。",
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
      "円は、手にしている対象です。この手法は太く描かれ、その内側に自身の各段階が開かれています。同じ両端のあいだに並ぶほかの線は、同じ枠に記録されている別のやり方です。",
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
        <p>
          <MathText source={isJa ? contract.takesJa : contract.takes} />
        </p>
      </div>
      <div className="mj-layers-edge mj-layers-edge--out">
        <span className="mj-layers-edge-label">{copy.returns}</span>
        <p>
          <MathText source={isJa ? contract.returnsJa : contract.returns} />
        </p>
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
 * It is the index's own engine (`layoutConverge`), so there is one
 * geometry for one picture. What the page adds around it is the thing a drawing
 * cannot carry: the two states **written out**. Their names are in `<title>` on
 * the canvas, which is a hover — and there is no hover on a phone. Naming them
 * here in prose, as links, is the same fact in a form every reader gets.
 */
/** One frozen empty set rather than a fresh `new Set()` per render. */
const EMPTY_OPEN: ReadonlySet<string> = new Set<string>();

function ProcessZoom({
  graph,
  node,
  locale,
  copy,
  viewport,
  open,
  droppedOpen,
  at,
}: {
  graph: LayerGraph;
  node: LayerNode;
  locale: PublicLocale;
  copy: LayersCopy;
  viewport: Viewport;
  open: ReadonlySet<string>;
  /** How many of the reader's `?open=` values `CONVERGE_OPEN_MAX` refused. */
  droppedOpen: number;
  at: string | null;
}) {
  const notes = convergeNotes(locale);
  const resolved = contractFor(graph, node);
  // **The same drawing as the index, of the same subject.** That is what makes
  // arriving here read as a zoom rather than as a different screen: the strand a
  // reader clicked on the index carries `view-transition-name: mj-fig-<id>`, and
  // so does this figure, so the browser morphs one into the other.
  //
  // It used to be `layoutProcessZoom` — the retired map's engine — and the two
  // pictures did not match, so the pairing animated a shape into a drawing that
  // did not look like it. There is one canvas now, everywhere.
  //
  // A **method** is drawn as the slot it fills, with itself open. A method is
  // not a place you can stand: it is one way through a slot, so its own figure
  // is that slot, opened at it.
  //
  // ## Why a method goes through a different entry point (session 110)
  //
  // That paragraph was the intent and the code did not achieve it. Passing the
  // slot to `layoutConverge` and adding the method to `open` works only when the
  // slot's plan happens to be a fan. `linear-ode-solve` and `nonlinear-ode-solve`
  // are not atomic, so their plan is a **state chain** whose lanes are slots —
  // and the method's id then matched no lane at all.
  //
  // Measured on `dev` immediately before this changed: **45 of 63** method pages
  // drew a figure with their own method nowhere on it, **43 of 63** drew a figure
  // byte-identical to another method's page, and **not one** of the corpus's ten
  // `via` pins was drawn on the page of the method that authored it. For four of
  // `linear-ode-solve`'s seven the figure was not merely generic but false —
  // `lchs-route`'s page drew `time-discretization → quantum-linear-solve`, and
  // `lchs-route` does not go that way.
  //
  // `layoutConvergeForMethod` asks the other question: not "what does every route
  // through this slot pass through" but "which of the ways through it is this
  // one". The answer to that is always the fan.
  const diagram = isMethod(node)
    ? layoutConvergeForMethod({
        graph,
        vocabulary: STATE_VOCABULARY,
        method: node,
        locale,
        // Everything else the reader had expanded on the way here survives the
        // click, instead of the figure resetting to the one line the URL names.
        // The method's own id is added by the entry point — it is not optional,
        // so it is not the caller's to forget.
        open: new Set(open),
        at,
      })
    : layoutConverge({
        graph,
        vocabulary: STATE_VOCABULARY,
        focus: node,
        locale,
        open: new Set(open),
        at,
      });
  // An unresolvable contract or an empty layout means the graph does not have
  // the two ends this figure is *about*. Drawing a picture of that would be
  // inventing one; the sections below still say everything they always said.
  if (!resolved || !diagram || diagram.empty) return null;
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
      {/* The reader's own size, and their own position. A figure can be wider
          than the column — *"they can zoom in and out of the page on their
          own"*, owner, session 92 — and it is now a viewport they can move
          rather than a set of sizes they can pick, with `?at=` carrying where
          they are so the page can be shared from there. */}
      {/* `CanvasContinuity` was on the index and not here, so one gesture had
          two behaviours: opening a line on `/repository/layers` bent the curves
          in place, and the identical click on this page replaced the document.
          Nothing chose that — the index grew the wrapper and this figure did not
          — and it is the kind of split a reader reads as the second one being
          broken. Same wrapper, same `?at=`, same behaviour. */}
      <CanvasContinuity renderedAt={at}>
        <InfiniteCanvas
          initial={viewport}
          label={copy.zoomHeading}
          locale={locale === "ja" ? "ja" : "en"}
        >
          <ConvergeCanvas
            diagram={diagram}
            locale={locale}
            title={label(node, locale)}
            // What the reader clicked to get here. The index draws this same
            // subject under this same name, which is the pairing.
            subjectId={node.id}
          />
        </InfiniteCanvas>
      </CanvasContinuity>
      <figcaption className="mj-layers-zoom-caption">
        {from && to ? (
          <p className="mj-layers-zoom-ends">
            {copy.zoomFrom} <a href={href(from.id)}>{stateLabel(from, locale)}</a> {copy.zoomTo}{" "}
            <a href={href(to.id)}>{stateLabel(to, locale)}</a>
          </p>
        ) : null}
        <p>
          {/* Chosen from what was **drawn**, not from the node's kind. Those two
              agree today — a method always gets a fan and a slot's picture is
              whichever its expansion asks for — and they agreed before too,
              wrongly: the sentence for a method described a chain and a method
              page has never drawn one. Reading `diagram.grain` is how the
              caption stays true if either rule moves, and it is what
              `repository-converge-view.tsx` already does. */}
          {unfilled
            ? copy.zoomUnfilled
            : diagram.grain === "states"
              ? copy.zoomReadingSlot
              : isCapability(node)
                ? copy.zoomReadingSlot
                : copy.zoomReadingMethod}{" "}
          {copy.zoomNames}
        </p>
        <p>
          {diagram.collapsedCount > 0 ? copy.zoomDeeper(diagram.collapsedCount) : copy.zoomAllShallow}{" "}
          {/* No open set, and that is right rather than an omission: a write-up
              page is not a reading position on the figure, so there is nothing
              to carry. Every link that *is* on the figure passes one. */}
          <a href={figureHref(mapId, [])}>{copy.stateOnMap}</a>
        </p>
        {/* The two limits this figure can hit, said out loud — and until now
            said on the index only. The page resolved `?open=` against the very
            same cap and dropped the count on the floor, and never read
            `depthCapped` at all, so one URL was honest on one surface and
            silent on the other. Same engine, same two caps, same sentences:
            they come from `converge-notes.ts` rather than from either
            component's own copy table. */}
        {droppedOpen > 0 ? <p>{notes.droppedOpen(droppedOpen, CONVERGE_OPEN_MAX)}</p> : null}
        {diagram.cappedCount > 0 ? <p>{notes.cappedInside(diagram.cappedCount)}</p> : null}
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
      <p>
        <MathText source={summary(node, locale)} />
      </p>
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
        <p>
          <MathText source={locale === "ja" ? node.whyALayerJa : node.whyALayer} />
        </p>
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
          <p><MathText source={(isJa ? node.conditionsJa : node.conditions) ?? ""} /></p>
        ) : (
          <EmptyNote>{copy.conditionsNone}</EmptyNote>
        )}
      </section>

      {/* **Before Cost, because the owner's order puts Example before
          Performance** — his seven were Input, Theory, Output, Requires,
          Example, Performance, Implementations (`card-content.ts`). This page's
          order is not the card's and never was, but where his order says
          something about two sections this page draws, it is followed.

          Methods only. A capability is a slot rather than a procedure, so there
          is nothing to work an example of, and `LayerMethod.example` is typed
          on the method for that reason. */}
      {isMethod(node) ? (
        <section className="mj-layers-section">
          <h2>{copy.exampleHeading}</h2>
          {node.example?.text || node.example?.pseudocode ? (
            <>
              {node.example.text ? (
                <>
                  <p>
                    <MathText source={(isJa ? node.example.textJa : node.example.text) ?? ""} />
                  </p>
                  {/* Whose run it is and what kind — the same line the card draws,
                      from the same function, because this page and the card are two
                      renderers of one field and a note on only one of them is worse
                      than none. All three runs in the graph are classical
                      simulations, and a section headed "Example" with numbers under
                      it reads as a quantum execution unless something says otherwise. */}
                  {exampleRunNote(node.example.run, isJa) ? (
                    <p className="mj-card-run-note">{exampleRunNote(node.example.run, isJa)}</p>
                  ) : null}
                </>
              ) : null}
              {/* **Why there is no run, when the record says so — and the card has
                  drawn this for longer than this page has.**

                  A method with pseudocode and no prose has a non-empty Example
                  section, so the `EmptyNote` below never fires and the account of
                  the missing half had nowhere to go on this page. That is the exact
                  hole `CardExample.textReason` was added to fill on the card, and
                  this page was reading the node directly and therefore missing it.
                  Twelve linear-ODE methods hit it at once when #19 took their
                  worked examples off: a reader saw a listing and, about the run,
                  nothing at all — which is indistinguishable from nobody having
                  looked, and somebody had.

                  Same shape and same markers as the card's, so a sweep counting
                  explained gaps sees both surfaces. */}
              {!node.example.text && absenceOf(node, "example.text", isJa) ? (
                <p className="mj-card-gap mj-card-gap--none-recorded" data-gap="none-recorded" data-explained="true">
                  <MathText source={absenceOf(node, "example.text", isJa) ?? ""} />
                </p>
              ) : null}
              {/* Not localised, and this page says why by not offering a second
                  one: the identifiers are the record's own symbols. Same class
                  as the card's listing, because it is the same listing and the
                  rule it needs is the same one — keep the whitespace, and scroll
                  a long line inside its own box rather than widening the page.
                  Nothing reads this class as a marker; it is presentation. */}
              {node.example.pseudocode ? (
                <pre className="mj-card-pseudocode">
                  <code>{node.example.pseudocode}</code>
                </pre>
              ) : null}
            </>
          ) : (
            <EmptyNote>{copy.exampleNone}</EmptyNote>
          )}
        </section>
      ) : null}

      <section className="mj-layers-section">
        <h2>{copy.costHeading}</h2>
        {node.cost ? (
          <p>
            <MathText source={(isJa ? node.costJa : node.cost) ?? ""} />
          </p>
        ) : (
          <EmptyNote>{copy.costNone}</EmptyNote>
        )}
      </section>

      {/* **After Cost, which closes the owner's seven on this page**: his order
          is Input, Theory, Output, Requires, Example, Performance,
          Implementations, and the section comment above already follows it for
          Example-before-Performance. This is the seventh, and until now the page
          stopped at the sixth.

          **This is the same hole 396 closed for `example`, one field along.**
          `implementations` was drawn only by `map-card-panel.tsx`, so an
          implementation was reachable through the map card and invisible to
          anyone who arrived at the method page — authored content that ships and
          is never seen. It was not noticed earlier because the count was zero:
          nothing rendered because nothing existed, which looks exactly like a
          section that is working.

          Methods only, for the reason `example` is methods only — a capability
          is a slot rather than a procedure, and `LayerMethod.implementations` is
          typed on the method. */}
      {isMethod(node) ? (
        <section className="mj-layers-section">
          <h2>{copy.implementationsHeading}</h2>
          {node.implementations?.length ? (
            <ul className="mj-card-list mj-card-implementations">
              {node.implementations.map((implementation) => (
                <li key={implementation.id}>
                  <h3>{isJa ? implementation.labelJa : implementation.label}</h3>
                  {/* Zero papers is a real value — the owner's "implementations
                      that aren't papers but proven to be run" — so the list is
                      rendered only when there is one, never as an empty stub. */}
                  {implementation.papers?.length ? (
                    <ul className="mj-card-list">
                      {implementation.papers.map((paper) => (
                        <li key={paper.url}>
                          <a href={paper.url} rel="noreferrer">
                            {paper.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {/* The owner's five sub-sections, in the order he approved
                      them. Each is drawn only when written: an absent one means
                      nobody has read that part of the source out, and a heading
                      over nothing would say the opposite. */}
                  {(
                    [
                      ["about", implementation.about, implementation.aboutJa],
                      ["methods", implementation.methods, implementation.methodsJa],
                      ["data", implementation.data, implementation.dataJa],
                      ["code", implementation.code, implementation.codeJa],
                      ["results", implementation.results, implementation.resultsJa],
                    ] as const
                  ).map(([key, en, ja]) =>
                    en ? (
                      <p key={key}>
                        <MathText source={(isJa ? ja : en) ?? ""} />
                      </p>
                    ) : null,
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>{copy.implementationsNone}</EmptyNote>
          )}
        </section>
      ) : null}

      {node.contested ? (
        <section className="mj-layers-section mj-layers-section--contested">
          <h2>{copy.contestedHeading}</h2>
          <p><MathText source={(isJa ? node.contestedJa : node.contested) ?? ""} /></p>
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
                  <p>
                    <MathText source={summary(step, locale)} />
                  </p>
                  {repetition ? (
                    <p className="mj-layers-repeat-note">
                      {repetition.closure === "measured"
                        ? copy.repeatsMeasured
                        : copy.repeatsCoherent}{" "}
                      <MathText source={isJa ? repetition.noteJa : repetition.note} />
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
  viewport = IDENTITY,
  open,
  droppedOpen = 0,
  at = null,
}: {
  graph: LayerGraph;
  node: LayerNode;
  corpus: readonly LayerCorpusEntry[];
  locale: PublicLocale;
  viewport?: Viewport;
  /** The reader's own `?open=`, carried in from the page they came from. */
  open?: ReadonlySet<string>;
  /**
   * And how many of it the cap refused. Not derivable from `open` — the values
   * are gone by the time they arrive here — so the count travels with them or
   * the figure cannot say what it left out.
   */
  droppedOpen?: number;
  /** The reader's own `?at=`, raw, so every address this page emits keeps it. */
  at?: string | null;
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
        <p className="mj-layers-lede">
          <MathText source={summary(node, locale)} />
        </p>
        <ContractPiece graph={graph} node={node} locale={locale} copy={copy} />
      </header>
      {/* Before the prose, not after it. A reader who clicked a name on the map
          came here to see this one thing drawn; the write-up is what they read
          once they have found it. */}
      <ProcessZoom
        graph={graph}
        node={node}
        locale={locale}
        copy={copy}
        viewport={viewport}
        open={open ?? EMPTY_OPEN}
        droppedOpen={droppedOpen}
        at={at}
      />
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
        <a href={figureHref(null, [])}>{copy.stateOnMap}</a>
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
 * What is here, counted — the only place on this site the graph's own census is
 * printed.
 *
 * Converge is the only surface now, but this stayed its own function rather
 * than being inlined into `ConvergeView` when the other three views were
 * retired: it used to be reachable from two views — the default and
 * `LayerIndexView`'s `?view=list` — and the census restated on both was the
 * same failure `ViewSwitch` existed to prevent for links, one layer down, with
 * numbers instead. One function, called once now, is what one function called
 * twice was already supposed to buy.
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

/**
 * The strip an Atlas entry page shows when the layer graph names it.
 *
 * Renders nothing when no node does — unlike the panels on this surface, whose
 * emptiness is a finding. Here an absence is the default for most records (279
 * of the then-283, measured 2026-07) and saying so on every one of them would
 * be noise, not honesty.
 */
/**
 * One node's contract, drawn on the record page.
 *
 * Absent rather than empty when the node states none: a record page that
 * printed "Takes —" would be asserting the map had looked and found nothing,
 * when the truth is that nobody has written it yet.
 */
function EntryNodeContract({
  graph,
  corpus,
  locale,
  nodeId,
  copy,
}: {
  graph: LayerGraph;
  corpus: readonly LayerCorpusEntry[];
  locale: PublicLocale;
  nodeId: string;
  copy: ReturnType<typeof copyFor>;
}) {
  const card = cardFor(
    { graph, vocabulary: STATE_VOCABULARY, corpus, locale, register: PAPER_REGISTER },
    nodeId,
  );
  if (card === null || !card.contract.held) return null;
  return (
    <p className="mj-layers-item-contract">
      <span className="mj-layers-item-contract-label">{copy.takes}</span>{" "}
      <MathText source={card.contract.value.takes} />{" "}
      <span className="mj-layers-item-contract-label">{copy.returns}</span>{" "}
      <MathText source={card.contract.value.returns} />
    </p>
  );
}

/**
 * Where a record sits on the map — and, since W23, what the map KNOWS about it.
 *
 * Ruling `27267f`: a method card and its repository record are one subject. This
 * is the record-page half of that. It used to be a bare list of links, so a
 * reader on `/repository/<slug>` could see that the graph named their record and
 * had to follow the link to find out anything it said.
 *
 * The **contract** is read through `cardFor`, the same composer the map card
 * uses, rather than off the node here — one subject, one source per field
 * (`W23-record-join.md` §4: the contract is node-authored). A second reader
 * would be a second thing to keep in step.
 */
export function EntryLayerLinks({
  graph,
  slug,
  locale,
  corpus = [],
}: {
  graph: LayerGraph;
  slug: string;
  locale: PublicLocale;
  corpus?: readonly LayerCorpusEntry[];
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
            <EntryNodeContract
              graph={graph}
              corpus={corpus}
              locale={locale}
              nodeId={node.id}
              copy={copy}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
