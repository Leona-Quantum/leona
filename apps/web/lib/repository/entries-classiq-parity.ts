// Classiq-parity intake: catalog records for the algorithms the Classiq library
// demonstrates and this repository did not carry.
//
// The sibling of ./entries-zoo-parity.ts, and it exists for the half of the
// owner's sentence the Zoo cannot answer. The Zoo is a survey of *results*;
// Classiq's library is a catalogue of *work* — 61 of its 103 publication
// directories are applications, and this repository covered **2 of those 61**
// when `scripts/check-classiq-parity.mjs` first read it. Deep on algorithms,
// near-empty on applied: finance, logistics, chemistry at scale, CFD, telecom,
// cyber.
//
// ## What a record here covers, and what it must never say
//
// Classiq publishes **demonstrations** — a notebook plus a pinned Qmod model. A
// record here documents **the algorithm the demonstration demonstrates**, cited
// to that algorithm's own primary paper. It does **not** reproduce the demo:
// nothing in Leona runs Qmod, and a record that implied otherwise would be
// exactly the claim `scripts/check-repository-data.mjs` exists to refuse. So no
// field describes the notebook, the Qmod model, or Classiq's platform — the
// index gives this file a directory path and a file list, and nothing about
// their contents, which is the honest limit of what a pinned tree can tell you.
//
// ## One difference from the Zoo batch, and it is a real one
//
// Several of these papers report experiments or simulations of their own, where
// the Zoo's query-complexity entries almost never did. Where an abstract says so
// this file says so — attributed to the paper, never in the record's own voice —
// and the caveat still states that nothing was constructed or run for the record.
// That is the same rule applied to a different literature, not a relaxed one.
//
// Adding a record: append a concept, add its paper to ./paper-register.ts FIRST,
// give its family a rule in ./topics.ts if it has none, and regenerate
// services/api/catalog_bootstrap/manifest.json in the same PR.
import { makeReferenceEntry } from "./factory";
import type { PublicRepositoryEntry } from "./types";

type ClassiqAlgorithm = {
  slug: string;
  title: string;
  titleJa: string;
  /** Must resolve to a rule in ./topics.ts — an entry with no role fails the build. */
  family: string;
  /** The publication directory this covers, verbatim from the pinned index. */
  classiqPath: string;
  classiqCategory: string;
  /** Classiq's own shelf between the category and the entry; null when there is none. */
  classiqGroup: string | null;
  classiqName: string;
  problem: string;
  problemJa: string;
  idea: string;
  ideaJa: string;
  /** Empty when the read sources state no bound — `complexityBasis` says which were read. */
  complexity: string;
  complexityBasis: string;
  caveat: string;
  caveatJa: string;
  tags: string[];
  source: { id: string; title: string; authors: string; year: string; url: string };
  literature?: Array<{
    title: string;
    authors: string;
    year: string;
    url: string;
    relevance: string;
    relevanceJa: string;
  }>;
  relatedSlugs: string[];
};

const CLASSIQ_ALGORITHMS: ClassiqAlgorithm[] = [
  {
    slug: "quantum-volume-benchmark",
    title: "Quantum volume from randomized model circuits",
    titleJa: "ランダムなモデル回路による量子ボリューム",
    family: "Quantum benchmarking protocol",
    classiqPath: "applications/benchmarking/quantum_volume",
    classiqCategory: "applications",
    classiqGroup: "benchmarking",
    classiqName: "quantum_volume",
    problem:
      "Measure, as a single number, how large a random circuit of equal width and depth a given quantum computer successfully implements, so that progress toward improved system-wide gate error rates can be measured and compared across near-term devices.",
    problemJa:
      "ある量子計算機が、幅と深さの等しいランダム回路をどこまで大きく実行できるかを単一の数値として測定し、システム全体のゲート誤り率の改善の進み具合を近未来の装置どうしで測定・比較できるようにする問題です。",
    idea:
      "Cross, Bishop, Sheldon, Nation and Gambetta introduce quantum volume, a single-number metric that can be measured using a concrete protocol on near-term quantum computers of modest size (n ≲ 50). It quantifies the largest random circuit of equal width and depth that the computer successfully implements, so a device raises its score only by handling greater width and greater depth together: the authors call it a pragmatic way to measure and compare progress toward improved system-wide gate error rates for near-term quantum computation and error-correction experiments. The paper links the quantum volume to system error rates, states that it is empirically reduced by uncontrolled interactions within the system, and names the system properties expected to come with higher quantum volumes — high-fidelity operations, high connectivity, large calibrated gate sets, and circuit rewriting toolchains. The authors report measuring the metric on several state-of-the-art transmon devices and finding values as high as 16.",
    ideaJa:
      "Cross、Bishop、Sheldon、Nation、Gambetta は、量子ボリュームという単一の数値による指標を提案しています。これは、規模の限られた近未来の量子計算機（n ≲ 50）に対して具体的なプロトコルによって測定できる指標です。量子ボリュームは、その計算機が実行できる幅と深さの等しいランダム回路の最大の大きさを表すため、装置は幅と深さをともに伸ばすことによってしか値を上げられません。著者らはこれを、近未来の量子計算と誤り訂正の実験に向けて、システム全体のゲート誤り率の改善の進み具合を測定し比較するための実際的な方法であると述べています。論文は量子ボリュームをシステムの誤り率と結び付け、系内の制御されていない相互作用によって経験的に値が下がると述べ、さらに、より高い量子ボリュームを備えると期待されるシステムの性質として、忠実度の高い操作、高い結合度、較正されたゲートセットの豊富さ、回路書き換えのツールチェーンを挙げています。著者らは、いくつかの最先端のトランズモン方式の装置についてこの指標を測定し、最大で16の値を得たと報告しています。",
    complexity: "",
    complexityBasis:
      'The abstract of arXiv:1811.12926 states no cost, running time or speedup bound, and correctly so: quantum volume is a figure of merit for a device, not an algorithm with a complexity. What it states instead is a definition — "It quantifies the largest random circuit of equal width and depth that the computer successfully implements" — and a measurement, quoted here in two pieces: "We introduce a single-number metric, quantum volume, that can be measured using a concrete protocol on near-term quantum computers of modest size" and "and measure it on several state-of-the-art transmon devices, finding values as high as 16." Both pieces are verbatim; what falls between them is the size regime, which the abstract writes as TeX and which this record renders in Unicode as n ≲ 50, so it is stated outside the quotation marks rather than inside them. The Classiq index entry this record covers, applications/benchmarking/quantum_volume, gives a directory path and a file list and states no bound. Those are the only sources read for this field, and the complexity field is left empty on purpose rather than filled with a bound written from memory.',
    caveat:
      "This record documents the protocol the Classiq entry at applications/benchmarking/quantum_volume demonstrates. It does not reproduce that demonstration: nothing in Leona runs Qmod, and the index entry read here gives that directory path and a file list, nothing about what those files contain. Nothing was measured for this record either — no circuit was built, compiled, simulated or executed, no device was benchmarked, and no quantum volume was computed for anything, including for any circuit in this catalog. The values as high as 16 are the authors' own measurement, reported in 2018 on several state-of-the-art transmon devices and carried here as the paper's claim: this record did not repeat that measurement, did not read the data behind it, and says nothing about any machine available now or about any measurement made since. The abstract names a concrete protocol but does not state it, so this record carries no success criterion, no circuit count, no confidence level, and no definition of when a circuit counts as successfully implemented; those are in the paper, not here. The stated regime is near-term computers of modest size, n ≲ 50, and nothing here extends the metric beyond it. The list of properties expected to come with higher quantum volumes is the authors' expectation, and the reduction by uncontrolled interactions is described as empirical, so neither is a proved relation. Finally, a device metric is not an algorithm result: nothing here says what any algorithm costs on a machine of a given quantum volume, what such a machine makes feasible, or how the number relates to error-corrected performance; the abstract mentions error-correction experiments only as one of the settings the improved gate error rates it speaks of are for.",
    caveatJa:
      "本項目は、Classiq の applications/benchmarking/quantum_volume が実演しているプロトコルを記述したものです。その実演を再現するものではありません。Leona に Qmod を実行する仕組みはなく、ここで参照した索引項目が与えるのは当該のディレクトリのパスとファイルの一覧だけで、それらのファイルの中身については何も分かりません。本記録のために測定したものもありません。回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、装置のベンチマークも行っておらず、本カタログの回路を含め、いかなる対象についても量子ボリュームを算出していません。最大で16という値は、著者らがいくつかの最先端のトランズモン方式の装置について2018年に報告した測定であり、論文の主張としてそのまま記しています。本記録はこれを追試しておらず、背後のデータも参照しておらず、現在利用できる機器についても、その後になされた測定についても何も述べていません。要旨は「具体的なプロトコル」に言及するのみでその内容を示していないため、本記録は成功の判定基準も、回路の本数も、信頼水準も、どのような場合に回路が正しく実行されたとみなすかの定義も保持していません。これらは論文にあり、ここにはありません。対象として述べられている範囲は規模の限られた近未来の計算機、すなわち n ≲ 50 であり、本記録はこの指標をその外へ拡張しません。より高い量子ボリュームを備えると期待される性質の一覧は著者らの見込みであり、制御されていない相互作用による低下も経験的なものとされているため、いずれも証明された関係ではありません。最後に、装置の指標はアルゴリズムの結果ではありません。ある量子ボリュームの機器上で任意のアルゴリズムがどれだけのコストになるか、そのような機器で何が実行可能になるか、この数値が誤り訂正後の性能とどう関係するかについて、本記録は何も述べていません。要旨が誤り訂正の実験に触れているのも、そこでいうゲート誤り率の改善が何のためのものかを示す文脈においてのみです。",
    tags: ["quantum volume", "benchmarking", "random circuits", "device metric", "transmon"],
    source: {
      id: "arxiv:1811.12926",
      title: "Validating quantum computers using randomized model circuits",
      authors: "Andrew W. Cross, Lev S. Bishop, Sarah Sheldon, Paul D. Nation, Jay M. Gambetta",
      year: "2018",
      url: "https://arxiv.org/abs/1811.12926",
    },
    literature: [
      {
        title: "Validating quantum computers using randomized model circuits",
        authors: "Andrew W. Cross, Lev S. Bishop, Sarah Sheldon, Paul D. Nation, Jay M. Gambetta",
        year: "2018",
        url: "https://arxiv.org/abs/1811.12926",
        relevance:
          "Primary source: it introduces the quantum volume metric, states that it can be measured by a concrete protocol on near-term computers of modest size (n ≲ 50), defines it as the largest random circuit of equal width and depth the computer successfully implements, links it to system error rates, and reports measured values as high as 16 on several state-of-the-art transmon devices. Consult it for the protocol itself — the model circuits, the success criterion, the number of circuits and the confidence level — none of which the abstract states.",
        relevanceJa:
          "一次資料です。量子ボリュームという指標を提案し、規模の限られた近未来の計算機（n ≲ 50）に対して具体的なプロトコルで測定できると述べ、幅と深さの等しいランダム回路のうち計算機が実行できる最大のものとして定義し、システムの誤り率と結び付け、いくつかの最先端のトランズモン方式の装置で最大16という測定値を報告しています。プロトコルそのもの、すなわちモデル回路、成功の判定基準、回路の本数、信頼水準は要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["benchmark-clifford-brickwork-8q", "benchmark-swap-network-8q", "surface-code-memory"],
  },
  {
    slug: "randomized-benchmarking-protocol",
    title: "Robust randomized benchmarking of quantum processes",
    titleJa: "量子プロセスのロバストなランダム化ベンチマーキング",
    family: "Quantum benchmarking protocol",
    classiqPath: "applications/benchmarking/randomized_benchmarking",
    classiqCategory: "applications",
    classiqGroup: "benchmarking",
    classiqName: "randomized_benchmarking",
    problem:
      "Estimate an average error rate for a set of operations (gates) on a quantum information processor, under a noise model general enough to allow errors that depend on both the time and the gate at which they occur.",
    problemJa:
      "量子情報処理装置において、生じる時刻にもゲートにも依存しうる誤差を許す一般的なノイズモデルのもとで、一組の操作（ゲート）に対する平均誤り率を推定する問題です。",
    idea:
      "The paper describes a simple randomized benchmarking protocol for quantum information processors and, from a perturbative expansion of the errors, obtains a sequence of models for the observable fidelity decay. What the protocol returns is an estimate of an average error rate for a set of operations (gates), and the paper states that it is able to prove this estimate efficient and reliable under a general noise model that allows for both time- and gate-dependent errors. The paper also determines the conditions under which the estimate remains valid, and reports that it illustrates the protocol through numerical examples. The abstract stops there: it does not say what separates one model in that sequence from the next, or how an observed decay is matched against them.",
    ideaJa:
      "本論文は、量子情報処理装置に対する単純なランダム化ベンチマーキングのプロトコルを記述し、誤差の摂動展開から、観測される忠実度減衰に対するモデルの列を導いています。プロトコルが返すのは一組の操作（ゲート）に対する平均誤り率の推定値であり、論文は、時間依存とゲート依存の双方の誤差を許す一般的なノイズモデルのもとで、この推定が効率的かつ信頼できることを証明できたと述べています。さらに、推定が有効であり続けるための条件を定め、数値例によってプロトコルを例示したと報告しています。要旨の記述はここまでであり、モデルの列において各モデルが互いにどう異なるのか、観測された減衰をそれらとどのように照合するのかは述べられていません。",
    complexity: "",
    complexityBasis:
      'The abstract of arXiv:1009.3639, the only source read for this record, states no bound. Its cost claim is qualitative: "We are able to prove that the protocol provides an efficient and reliable estimate of an average error-rate for a set operations (gates) under a general noise model that allows for both time and gate-dependent errors" — quoted as the abstract has it, "a set operations" included. It quotes no number at all: not a count of the operations applied, not a number of repetitions or measurements, not a qubit or gate count, and no scaling in any of them; and the conditions under which the estimate remains valid are determined inside the paper rather than in the abstract. The field is therefore empty on purpose, rather than filled with a plausible bound written from memory.',
    caveat:
      "This is a literature record. No circuit was written, compiled, simulated or run for it, no processor or simulator was benchmarked here, and no error rate was measured; the record documents the algorithm, and does not reproduce or verify any published demonstration of it. The abstract carries no numbers, so nothing here bounds what the protocol costs to run — not how many operations it applies, not how many repetitions or measurements it needs, not how many qubits it touches. The abstract also does not describe how the protocol is built: not what is randomized, not over which set of gates, not what exactly the average error rate is averaged over, and not what the conditions are under which the estimate remains valid. The paper determines those conditions; they are not restated here. What the protocol returns is one number for a set of operations, and nothing here establishes what that number implies about an individual gate or about any particular physical error mechanism. The paper reports that it illustrates the protocol through numerical examples; those are the paper's own numerics, reported as its claim and not run again for this record.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで回路を記述・コンパイル・シミュレーション・実行したことはなく、実機やシミュレータのベンチマークも行っておらず、誤り率を測定してもいません。アルゴリズムそのものを記した記録であり、公開されている実演を再現・検証したものではありません。要旨には数値が一切示されていないため、プロトコルの実行コストは本項目からは何も分かりません。操作を何回適用するのか、繰り返しや測定が何回必要か、量子ビットを何個使うのかは、いずれも示されていません。要旨は、プロトコルをどのように構成するのか、すなわち何を乱択するのか、どのゲート集合を対象とするのか、平均誤り率が何について平均された量なのか、推定が有効であり続けるための条件が何かも述べていません。この条件は論文の中で定められており、ここで再掲したものではありません。プロトコルが返すのは一組の操作に対する1つの数値であり、それが個々のゲートや個々の物理的な誤りの機構について何を意味するかは、本項目では確立していません。論文は数値例によってプロトコルを例示したと報告していますが、それは論文自身の主張として記した数値計算であり、本記録のために実行し直したものではありません。",
    tags: ["randomized benchmarking", "fidelity decay", "average error rate", "noise model", "gate characterization"],
    source: {
      id: "arxiv:1009.3639",
      title: "Robust randomized benchmarking of quantum processes",
      authors: "Easwar Magesan, J. M. Gambetta, Joseph Emerson",
      year: "2010",
      url: "https://arxiv.org/abs/1009.3639",
    },
    literature: [
      {
        title: "Robust randomized benchmarking of quantum processes",
        authors: "Easwar Magesan, J. M. Gambetta, Joseph Emerson",
        year: "2010",
        url: "https://arxiv.org/abs/1009.3639",
        relevance:
          "Primary source: it describes the protocol, obtains a sequence of models for the observable fidelity decay from a perturbative expansion of the errors, and states a proof that the resulting estimate of an average error rate is efficient and reliable under a noise model allowing time- and gate-dependent errors. Consult it for how the protocol is constructed, for the conditions under which the estimate remains valid, and for the numerical examples: the abstract mentions the last two without stating either, says nothing about the first, and quotes no cost figure of any kind.",
        relevanceJa:
          "一次資料です。プロトコルを記述し、誤差の摂動展開から観測される忠実度減衰に対するモデルの列を導き、時間依存およびゲート依存の誤差を許すノイズモデルのもとで平均誤り率の推定が効率的かつ信頼できることを証明したと述べています。プロトコルの具体的な構成、推定が有効であり続けるための条件、数値例については、要旨は後の2つに言及するのみで内容を述べておらず、構成には何も触れていません。コストに関する数値も一切ないため、これらは原論文で確認してください。",
      },
    ],
    relatedSlugs: ["benchmark-clifford-brickwork-8q", "surface-code-memory", "shor-code-error-correction"],
  },
  {
    slug: "heat-equation-solver",
    title: "Quantum and classical algorithms for the heat equation",
    titleJa: "熱方程式に対する量子アルゴリズムと古典アルゴリズム",
    family: "Quantum differential equations · linear",
    classiqPath: "applications/CFD/heat_eq_qsvt",
    classiqCategory: "applications",
    classiqGroup: "CFD",
    classiqName: "heat_eq_qsvt",
    problem:
      "Solve the heat equation in a rectangular region of spatial dimension d, in the sense of approximately computing the amount of heat in a given region.",
    problemJa:
      "空間次元 d の矩形領域における熱方程式について、与えられた領域内の熱量を近似的に計算するという意味で解を求める問題です。",
    idea:
      "Quantum computers are predicted to outperform classical ones for solving partial differential equations, perhaps exponentially, and this paper puts that prediction against a prototypical PDE: the heat equation in a rectangular region, with the answer taken to be the amount of heat in a given region, computed approximately. It compares in detail the complexities of ten classical and quantum algorithms for that task. The quantum route the abstract reports on applies amplitude estimation to an accelerated classical random walk, and for spatial dimension d ≥ 2 the paper finds that route gives an at most quadratic quantum speedup. An alternative route, built on a quantum algorithm for linear equations, is on the paper's accounting never faster than the best classical algorithms. The abstract reports only those two findings; the complexities of the ten algorithms it compares are inside the paper.",
    ideaJa:
      "偏微分方程式の求解では量子計算機が古典計算機を、場合によっては指数的に上回ると予想されており、本論文はこの予想を、代表的な偏微分方程式である矩形領域の熱方程式について検討しています。ここでの答えは、与えられた領域内の熱量を近似的に計算した値とされ、この課題に対して古典と量子を合わせた10のアルゴリズムの計算量が詳細に比較されています。要旨が取り上げる量子的な方法は、加速された古典ランダムウォークに振幅推定を適用するものであり、空間次元 d ≥ 2 においてこの方法が与える高速化は高々二次であるとされています。線形方程式に対する量子アルゴリズムに基づくもう一つの方法は、論文の比較によれば、最良の古典アルゴリズムより速くなることはありません。要旨が報告しているのはこの2つの結果だけであり、比較された10のアルゴリズムの計算量は論文の中にあります。",
    complexity:
      "An at most quadratic quantum speedup for spatial dimension d ≥ 2, from an approach that applies amplitude estimation to an accelerated classical random walk; the alternative approach, based on a quantum algorithm for linear equations, is never faster than the best classical algorithms. The abstract states the comparison only in those terms: it quotes no complexity expression, no dependence on the error or the discretization, and no qubit or gate count, and the complexities of the ten algorithms it compares are given inside the paper.",
    complexityBasis:
      'abstract of arXiv:2004.06516 (TeX rendered into Unicode: the abstract writes the inequality in inline math mode, here written d ≥ 2): "We find that, for spatial dimension d ≥ 2, there is an at most quadratic quantum speedup using an approach based on applying amplitude estimation to an accelerated classical random walk. However, an alternative approach based on a quantum algorithm for linear equations is never faster than the best classical algorithms." The same abstract fixes the task — "approximately computing the amount of heat in a given region" — and says the paper compares "the complexities of ten classical and quantum algorithms for solving it". It carries no big-O expression, no constant, and no resource count, which is why none appears above.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it, no heat-equation instance was solved, and no timing or resource figure was produced here; the record documents the algorithm, and does not reproduce or verify any published demonstration of it. The result above is a complexity comparison inside the paper's own statement of the problem — the heat equation on a rectangular region, with the amount of heat in a given region as the quantity to be approximated — and it does not carry over to other output quantities, other domain shapes, or other boundary and initial conditions, on which the abstract says nothing. The at-most-quadratic finding bounds the advantage rather than promising it, and the abstract quotes no complexity expression, no constant factors, and no dependence on the error or the grid, nor does it address state preparation, readout, or hardware feasibility. The verdict on the linear-equations route is a comparison against the best classical algorithms as the paper reckons them, which is a statement about a state of the art rather than a proven lower bound. The abstract reports a comparison of ten algorithms, not an experiment: no run, on hardware or in simulation, is claimed by it, and none was performed for this record.",
    caveatJa:
      "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、具体的な熱方程式の問題例も解いておらず、所要時間や資源量の数値も出していません。アルゴリズムそのものを記した記録であり、公開されている実演を再現・検証したものではありません。上記の結果は、論文自身が定めた問題設定、すなわち矩形領域の熱方程式について与えられた領域内の熱量を近似的に求めるという設定における計算量の比較であり、別の出力量、別の領域形状、別の境界条件や初期条件には及びません。これらについて要旨は何も述べていません。「高々二次」は利得の上界であって保証ではなく、要旨には計算量の式も定数因子も、誤差や格子への依存性も示されておらず、状態準備、読み出し、実機での実現可能性にも触れていません。線形方程式に基づく方法についての判断は、論文が捉えた最良の古典アルゴリズムとの比較であり、証明された下界ではありません。また要旨が報告しているのは10のアルゴリズムの計算量の比較であって実験ではなく、実機でもシミュレーションでも実行は主張されておらず、本記録のためにも実行していません。",
    tags: ["heat equation", "pde", "amplitude estimation", "random walk", "complexity comparison"],
    source: {
      id: "arxiv:2004.06516",
      title: "Quantum vs. classical algorithms for solving the heat equation",
      authors: "Noah Linden, Ashley Montanaro, Changpeng Shao",
      year: "2020",
      url: "https://arxiv.org/abs/2004.06516",
    },
    literature: [
      {
        title: "Quantum vs. classical algorithms for solving the heat equation",
        authors: "Noah Linden, Ashley Montanaro, Changpeng Shao",
        year: "2020",
        url: "https://arxiv.org/abs/2004.06516",
        relevance:
          "Primary source: the detailed comparison of ten classical and quantum algorithms for the heat equation in a rectangular region, and the origin of both findings quoted here — the at most quadratic speedup for d ≥ 2 from amplitude estimation applied to an accelerated classical random walk, and the finding that the linear-equations route is never faster than the best classical algorithms. Consult it for the complexities themselves, for the assumptions they rest on, and for the other algorithms in the comparison; the abstract states none of that.",
        relevanceJa:
          "一次資料です。矩形領域の熱方程式について古典と量子を合わせた10のアルゴリズムの計算量を詳細に比較しており、ここで引用した2つの結果、すなわち加速された古典ランダムウォークへの振幅推定の適用による d ≥ 2 での高々二次の高速化と、線形方程式に基づく方法が最良の古典アルゴリズムより速くなることはないという結論の出所です。計算量そのもの、それが依拠する仮定、比較対象となった他のアルゴリズムについては要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "amplitude-estimation",
      "hhl-linear-systems",
      "linear-differential-equations",
      "quantum-singular-value-transformation",
    ],
  },
  {
    slug: "protein-folding-variational",
    title: "Protein folding on a tetrahedral lattice by a variational quantum algorithm",
    titleJa: "変分量子アルゴリズムによる四面体格子上のタンパク質折り畳み",
    family: "Variational quantum algorithm",
    classiqPath: "applications/chemistry/protein_folding/protein_folding_with_qaoa",
    classiqCategory: "applications",
    classiqGroup: "chemistry/protein_folding",
    classiqName: "protein_folding_with_qaoa",
    problem:
      "Predict the three-dimensional structure a protein takes from its primary sequence of amino acids, posed here on the model Hamiltonian the paper defines for a chain of N monomers placed on a tetrahedral lattice.",
    problemJa:
      "アミノ酸の一次配列からタンパク質の三次元構造を予測する問題です。ここでは、四面体格子上に置かれた N 個のモノマーからなる鎖について論文が定めるモデル Hamiltonian の上で扱われています。",
    idea:
      "The paper presents a model Hamiltonian with O(N⁴) scaling, together with a corresponding quantum variational algorithm, for the folding of a polymer chain with N monomers on a tetrahedral lattice. The abstract states that the model reflects many physico-chemical properties of the protein, reducing the gap between coarse-grained representations and mere lattice models. The optimisation scheme, which the authors describe as robust and versatile, brings together variational quantum algorithms specifically adapted to classical cost functions and evolutionary strategies (genetic algorithms). The paper reports simulating the folding of the 10 amino acid Angiotensin peptide on 22 qubits, and applying the same method to the folding of a 7 amino acid neuropeptide using 9 qubits on an IBM Q 20-qubit quantum computer.",
    ideaJa:
      "論文は、四面体格子上の N 個のモノマーからなる高分子鎖の折り畳みに対して、O(N⁴) でスケールするモデル Hamiltonian と、それに対応する量子変分アルゴリズムを示しています。要旨によれば、このモデルはタンパク質の物理化学的性質を多く反映しており、粗視化表現と単なる格子モデルとの隔たりを縮めるものです。最適化の枠組みは、著者らが頑健かつ汎用的と述べるもので、古典的なコスト関数に合わせて調整された変分量子アルゴリズムと進化戦略（遺伝的アルゴリズム）を組み合わせています。論文は、この手法で 10 アミノ酸残基のアンジオテンシンペプチドの折り畳みを 22 量子ビットでシミュレートし、同じ手法を 7 アミノ酸残基の神経ペプチドの折り畳みに適用して、IBM Q の 20 量子ビット量子計算機上で 9 量子ビットを用いて実行したと報告しています。",
    complexity:
      "O(N⁴) scaling for the model Hamiltonian of a polymer chain with N monomers on a tetrahedral lattice. The abstract states no running time for the variational algorithm, no query or gate count, and no speed-up factor against classical folding methods; its only concrete figures are qubit counts for two named instances, 22 qubits for the 10 amino acid Angiotensin peptide and 9 qubits for a 7 amino acid neuropeptide on an IBM Q 20-qubit quantum computer. On the classical side it states that the problem is intrinsically NP-hard even reduced to its simplest Hydrophobic-Polar model, while classical algorithms provide practical solutions by sampling the conformation space of small proteins.",
    complexityBasis:
      'abstract of arXiv:1908.02163 (TeX rendered into Unicode: the abstract\'s script-O written O, its exponent as a superscript, and its italic N as plain N): "we present a model Hamiltonian with O(N⁴) scaling and a corresponding quantum variational algorithm for the folding of a polymer chain with N monomers on a tetrahedral lattice". The qubit figures are from the same abstract: "to simulate the folding of the 10 amino acid Angiotensin peptide on 22 qubits", and "The same method is also successfully applied to the study of the folding of a 7 amino acid neuropeptide using 9 qubits on an IBM Q 20-qubit quantum computer". The classical statements are from "Although classical algorithms provide practical solutions, sampling the conformation space of small proteins, they cannot tackle the intrinsic NP-hard complexity of the problem, even reduced to its simplest Hydrophobic-Polar model". The abstract states no running time and no comparison of running times, so none is recorded here.',
    caveat:
      "Nothing here was built, compiled, simulated or run, and no peptide structure was predicted: this record documents the algorithm as its paper states it and does not reproduce any implementation of it. The O(N⁴) figure is the scaling of the model Hamiltonian in the number of monomers, not a running time and not a speed-up, and the abstract does not say which quantity of the Hamiltonian grows that way — its number of terms, of qubits, or of couplings. The abstract gives no time complexity for the variational optimisation, no gate count, no circuit depth, no ansatz, no iteration count and no accuracy, and it claims no advantage over classical folding methods, so nothing here supports one. Its NP-hard remark is about the folding problem itself and about what classical algorithms cannot tackle; it does not say that this algorithm escapes that complexity, and nothing here claims it does. The 22-qubit folding of the Angiotensin peptide and the 9-qubit run on the IBM Q machine are the paper's own reported experiments, at 10 and 7 amino acids respectively, and neither was repeated or checked here; the abstract names hardware only for the 7 amino acid case, so this record does not say on what platform the 22-qubit result was obtained, and neither experiment establishes that the method reaches proteins of biological size. A lattice model Hamiltonian is a reduction of the folding problem, so solving it answers the model rather than the structure-prediction problem itself, and the claim that this model reflects many physico-chemical properties of the protein, reducing the gap between coarse-grained representations and mere lattice models, is the abstract's rather than anything checked here. The abstract calls the second application successful without stating a criterion, and it does not say how close either reported fold is to the true structure. The NISQ premise is stated in the abstract as evidence that such algorithms can accelerate energy optimization in frustrated systems, not as a proof, and no noise model, error rate or error-correction requirement is given anywhere in it.",
    caveatJa:
      "ここでは構成・コンパイル・シミュレーション・実行のいずれも行っておらず、具体的なペプチドの構造も予測していません。本項目は論文が述べるアルゴリズムを記録したものであり、その実装を再現したものではありません。O(N⁴) はモノマー数に対するモデル Hamiltonian のスケーリングであって、実行時間でも高速化でもありません。また、そのように増えるのが Hamiltonian の項の数なのか、量子ビット数なのか、結合の数なのかは、要旨に記載がありません。要旨には変分最適化の時間計算量、ゲート数、回路深さ、アンサッツ、反復回数、精度のいずれも示されておらず、古典的な折り畳み手法に対する優位も主張されていないため、本記録からもそのような主張は導けません。要旨の NP 困難への言及は、折り畳み問題そのものと、古典アルゴリズムがその困難さを扱いきれないことについての記述であって、このアルゴリズムがその困難さを免れると述べたものではなく、本記録もそのようには主張しません。アンジオテンシンペプチドの 22 量子ビットでの折り畳みと IBM Q の実機での 9 量子ビットの実行は論文自身が報告する実験であり、対象はそれぞれ 10 残基と 7 残基です。いずれもここで追試も検証もしていません。要旨が実機を明示しているのは 7 残基の場合だけであるため、22 量子ビットの結果がどの環境で得られたかについて本記録は述べません。また、いずれの実験も生物学的な大きさのタンパク質にこの手法が届くことを示すものではありません。格子上のモデル Hamiltonian は折り畳み問題の簡約であるため、それを解いて得られる答えはモデルについてのものであり、構造予測問題そのものについてのものではありません。このモデルがタンパク質の物理化学的性質を多く反映し、粗視化表現と単なる格子モデルとの隔たりを縮めるという点も要旨の主張であって、ここで検証したものではありません。要旨は二つ目の適用を成功と述べていますが判定基準は示しておらず、報告された二つの折り畳みが真の構造にどれだけ近いかも記載がありません。NISQ という前提も、そうしたアルゴリズムがフラストレート系のエネルギー最適化を加速しうるという証拠として述べられているだけで証明ではなく、ノイズモデル・誤り率・誤り訂正の要件はいずれも要旨に示されていません。",
    tags: ["protein folding", "variational", "lattice model", "chemistry", "nisq"],
    source: {
      id: "arxiv:1908.02163",
      title: "Resource-Efficient Quantum Algorithm for Protein Folding",
      authors: "Anton Robert, Panagiotis Kl. Barkoutsos, Stefan Woerner, Ivano Tavernelli",
      year: "2019",
      url: "https://arxiv.org/abs/1908.02163",
    },
    literature: [
      {
        title: "Resource-Efficient Quantum Algorithm for Protein Folding",
        authors: "Anton Robert, Panagiotis Kl. Barkoutsos, Stefan Woerner, Ivano Tavernelli",
        year: "2019",
        url: "https://arxiv.org/abs/1908.02163",
        relevance:
          "Primary source: it states the O(N⁴) model Hamiltonian for a polymer chain of N monomers on a tetrahedral lattice, the corresponding quantum variational algorithm, and the optimisation scheme that combines variational quantum algorithms adapted to classical cost functions with evolutionary strategies. It also reports the two experiments quoted here, the 10 amino acid Angiotensin peptide on 22 qubits and the 7 amino acid neuropeptide on 9 qubits of an IBM Q 20-qubit machine. Consult it for the encoding of a conformation into qubits, the ansatz and optimiser settings, the platform the 22-qubit result was obtained on, and the accuracy of the reported folds, none of which the abstract states.",
        relevanceJa:
          "一次資料です。四面体格子上の N 個のモノマーからなる高分子鎖に対する O(N⁴) のモデル Hamiltonian、対応する量子変分アルゴリズム、および古典的なコスト関数に合わせた変分量子アルゴリズムと進化戦略を組み合わせた最適化の枠組みが述べられています。ここで引用した二つの実験、すなわち 10 アミノ酸残基のアンジオテンシンペプチドを 22 量子ビットで扱った例と、7 アミノ酸残基の神経ペプチドを IBM Q の 20 量子ビット機の 9 量子ビットで扱った例も報告されています。配座を量子ビットへ符号化する方法、アンサッツと最適化器の設定、22 量子ビットの結果が得られた環境、報告された折り畳みの精度は要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["vqe-ground-state-energy", "qaoa-maxcut-ring", "quantum-adiabatic-evolution"],
  },
  {
    slug: "molecular-energy-phase-estimation",
    title: "Molecular ground-state energies by phase estimation",
    titleJa: "位相推定による分子の基底状態エネルギー",
    family: "Eigenvalue estimation",
    classiqPath: "applications/chemistry/qpe_for_molecules",
    classiqCategory: "applications",
    classiqGroup: "chemistry",
    classiqName: "qpe_for_molecules",
    problem:
      "Compute the ground-state energy of an atom or molecule, a calculation whose time the paper states scales exponentially with system size on a classical computer.",
    problemJa:
      "原子や分子の基底状態エネルギーを求める問題です。論文によれば、この計算は古典計算機では系の大きさに対して指数的に時間が増大します。",
    idea:
      "Phase estimation obtains an eigenvalue of the molecular Hamiltonian as a phase: an approximate ground state is prepared, the phase it acquires under evolution by the Hamiltonian is carried onto a separate readout register by controlled operations, and measuring that register returns the energy. The paper describes mappings of the molecular wave function to the quantum bits, and an adiabatic method for the preparation of a good approximate ground-state wave function, which it demonstrates for a stretched hydrogen molecule. Readout uses a recursive phase-estimation algorithm, which the paper reports reduces the number of quantum bits required for the readout register from about 20 to 4. The paper reports carrying out calculations of the water and lithium hydride molecular ground-state energies on a quantum computer simulator with this construction.",
    ideaJa:
      "位相推定は、分子 Hamiltonian の固有値を位相として取り出します。近似的な基底状態を準備し、Hamiltonian による時間発展でその状態が獲得する位相を制御演算によって別の読み出しレジスタへ移し、そのレジスタを測定することでエネルギーが得られます。論文は、分子の波動関数を量子ビットへ写す方法と、良い近似基底状態波動関数を準備する断熱的手法を述べ、後者については引き伸ばした水素分子で実演しています。読み出しには再帰的な位相推定アルゴリズムを用いており、これにより読み出しレジスタに必要な量子ビット数がおよそ 20 から 4 に減ると論文は報告しています。またこの構成により、水分子と水素化リチウムの基底状態エネルギーの計算を量子計算機シミュレータ上で行ったと報告しています。",
    complexity:
      "Polynomial in place of exponential: the abstract states that the calculation time for the energy of atoms and molecules scales exponentially with system size on a classical computer but polynomially using quantum algorithms, that the number of quantum bits required scales linearly with the number of basis functions, and that the number of gates required grows polynomially with the number of quantum bits. No exponent, constant factor or target accuracy is attached to either polynomial. The one concrete count in the abstract is for readout: the recursive algorithm reduces the number of quantum bits required for the readout register from about 20 to 4.",
    complexityBasis:
      'abstract of arXiv:quant-ph/0604193, quoted as written (the abstract contains no TeX): "The calculation time for the energy of atoms and molecules scales exponentially with system size on a classical computer but polynomially using quantum algorithms"; "The number of quantum bits required scales linearly with the number of basis functions, and the number of gates required grows polynomially with the number of quantum bits"; and "The recursive algorithm reduces the number of quantum bits required for the readout register from about 20 to 4". The abstract gives no exponent for either polynomial and no constant factor, so none is recorded here.',
    caveat:
      "Nothing here was built, compiled, simulated or run, and no molecular energy was computed: this record documents the algorithm as its paper states it and does not reproduce any implementation of it. The water and lithium hydride ground-state energies are the paper's own results, and the abstract states they were carried out on a quantum computer simulator rather than on quantum hardware, which makes them a check of the construction in classical simulation and not a measured speed-up; the abstract gives no basis sets, no achieved accuracy and no run times, so nothing here fixes what those calculations delivered. The scaling claims are asymptotic and unquantified: the polynomial has no exponent, the linear qubit count has no constant, and neither figure accounts for error correction, so no resource estimate for a molecule of interest follows from them. The reduction from about 20 to 4 applies to the readout register only and bounds nothing about the register that holds the wave function. Phase estimation returns the ground-state energy only insofar as the prepared state overlaps the true ground state; the abstract calls the adiabatically prepared state a good approximate ground-state wave function and demonstrates the preparation for one stretched hydrogen molecule, without stating an overlap, a success probability or a preparation cost. The exponential classical scaling is asserted in the abstract and is not proved here, so this record does not establish it as a lower bound on classical computation.",
    caveatJa:
      "ここでは構成・コンパイル・シミュレーション・実行のいずれも行っておらず、分子のエネルギーを計算してもいません。本項目は論文が述べるアルゴリズムを記録したものであり、その実装を再現したものではありません。水分子と水素化リチウムの基底状態エネルギーは論文自身の結果であり、要旨はこれを量子計算機シミュレータ上で行ったと述べていて、実機での結果ではありません。したがってこれらは古典シミュレーションによる構成の確認であって、測定された高速化ではありません。基底関数系、達成された精度、所要時間はいずれも示されていないため、これらの計算が何を達成したのかは本記録からは確定しません。スケーリングに関する主張は漸近的で定量化されていません。多項式の指数は示されず、量子ビット数の線形性にも定数が付されておらず、いずれの数値も誤り訂正を含まないため、対象となる分子に対する資源見積りは導けません。およそ 20 から 4 への削減は読み出しレジスタに限った話であり、波動関数を保持するレジスタについては何も示していません。位相推定が基底状態エネルギーを返すのは、準備した状態が真の基底状態と重なりを持つ範囲においてです。要旨は断熱的に準備した状態を「良い近似基底状態波動関数」と呼び、引き伸ばした水素分子 1 例で実演したと述べるにとどまり、重なりの大きさも成功確率も準備コストも示していません。古典側の指数的スケーリングも要旨における主張であって、ここで証明したものではないため、本記録は古典計算の下界を確立するものではありません。",
    tags: ["quantum chemistry", "phase estimation", "ground state energy", "state preparation", "eigenvalue"],
    source: {
      id: "arxiv:quant-ph/0604193",
      title: "Simulated Quantum Computation of Molecular Energies",
      authors: "Alán Aspuru-Guzik, Anthony D. Dutoi, Peter J. Love, Martin Head-Gordon",
      year: "2006",
      url: "https://arxiv.org/abs/quant-ph/0604193",
    },
    literature: [
      {
        title: "Simulated Quantum Computation of Molecular Energies",
        authors: "Alán Aspuru-Guzik, Anthony D. Dutoi, Peter J. Love, Martin Head-Gordon",
        year: "2006",
        url: "https://arxiv.org/abs/quant-ph/0604193",
        relevance:
          "Primary source: it states the polynomial-versus-exponential scaling claim, the linear qubit count in the number of basis functions, the polynomial gate count, and the recursive phase-estimation readout that it reports cuts the readout register from about 20 qubits to 4. It also describes the mappings of the molecular wave function to the qubits and the adiabatic ground-state preparation demonstrated for a stretched hydrogen molecule, and reports the water and lithium hydride calculations on a quantum computer simulator. Consult it for the basis sets, the accuracy of those two energies and the cost of the adiabatic preparation, none of which the abstract states.",
        relevanceJa:
          "一次資料です。多項式と指数の対比、基底関数の数に対する量子ビット数の線形性、ゲート数の多項式的増加、および読み出しレジスタをおよそ 20 量子ビットから 4 に減らすと報告される再帰的位相推定による読み出しが述べられています。分子の波動関数を量子ビットへ写す方法、引き伸ばした水素分子で実演された断熱的な基底状態準備、量子計算機シミュレータ上での水分子と水素化リチウムの計算も報告されています。基底関数系、これら二つのエネルギーの精度、断熱的準備のコストは要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "quantum-phase-estimation",
      "iterative-phase-estimation",
      "vqe-ground-state-energy",
      "quantum-adiabatic-evolution",
    ],
  },
  {
    slug: "option-pricing-amplitude-estimation",
    title: "Option pricing by amplitude estimation",
    titleJa: "振幅推定によるオプション価格評価",
    family: "Amplitude estimation",
    classiqPath: "applications/finance/option_pricing",
    classiqCategory: "applications",
    classiqGroup: "finance",
    classiqName: "option_pricing",
    problem:
      "Price an option, or a portfolio of options — vanilla contracts, multi-asset contracts, and path-dependent contracts such as barrier options — on a gate-based quantum computer, in the setting where the paper takes classical Monte Carlo methods as its point of comparison.",
    problemJa:
      "バニラオプション、複数資産のオプション、バリアオプションのような経路依存型オプションを含むオプション、またはそのポートフォリオの価格を、ゲート方式の量子計算機上で求める問題です。論文が比較の対象としているのは古典的なモンテカルロ法です。",
    idea:
      "Stamatopoulos, Egger, Sun, Zoufal, Iten, Shen and Woerner present a methodology to price options and portfolios of options on a gate-based quantum computer using amplitude estimation, which they describe as an algorithm that provides a quadratic speedup compared to classical Monte Carlo methods. The estimator itself is the subject of this catalog's amplitude-estimation record; what this paper adds is the construction around it on the finance side, and the emphasis it puts on the implementation of the quantum circuits required to build the input states and operators that amplitude estimation needs to price the different option types. The contracts it covers are vanilla options, multi-asset options and path-dependent options such as barrier options. The paper reports simulation results that highlight how the circuits it implements price the different option contracts, and it examines the performance of those option-pricing circuits on quantum hardware using the IBM Q Tokyo quantum device. The authors also report employing a simple error-mitigation scheme that they state significantly reduces the errors arising from noisy two-qubit gates.",
    ideaJa:
      "Stamatopoulos、Egger、Sun、Zoufal、Iten、Shen、Woerner は、ゲート方式の量子計算機上で振幅推定を用いてオプションおよびオプションのポートフォリオの価格を求める方法論を示しています。著者らは振幅推定を、古典的なモンテカルロ法に対して二次の高速化を与えるアルゴリズムであると述べています。推定器そのものは本カタログの振幅推定の項目が扱う対象であり、この論文が加えているのは金融側の構成、とりわけ、振幅推定が各種のオプションを価格付けするために必要とする入力状態と演算子を構成する量子回路の実装です。扱われている契約は、バニラオプション、複数資産のオプション、およびバリアオプションのような経路依存型のオプションです。論文は、実装した回路がそれぞれの契約をどのように価格付けするかを示すシミュレーション結果を報告し、さらに IBM Q Tokyo の実機を用いてこれらの価格付け回路の性能を調べています。著者らはまた、雑音のある2量子ビットゲートに起因する誤差を大幅に低減できると述べる簡潔な誤り緩和の手法を用いたと報告しています。",
    complexity:
      "A quadratic speedup compared to classical Monte Carlo methods, stated in that form and in no other: the abstract attaches the speedup to amplitude estimation itself, and gives no error scaling, no query count, no qubit count and no gate count for the option-pricing circuits, so nothing here says how many samples or oracle calls pricing a given contract to a given accuracy would take, nor at what accuracy the two methods cross over.",
    complexityBasis:
      'abstract of arXiv:1905.02666: "We present a methodology to price options and portfolios of options on a gate-based quantum computer using amplitude estimation, an algorithm which provides a quadratic speedup compared to classical Monte Carlo methods." That is the only comparative claim the abstract makes; the rest of it states results rather than bounds — simulation results, a run on the IBM Q Tokyo quantum device, and an error-mitigation scheme — and attaches no figure to any of them. The Classiq index entry this record covers, applications/finance/option_pricing, gives a directory path and a file list and states no bound. Those are the only sources read for this field.',
    caveat:
      "This record documents the algorithm the Classiq entry at applications/finance/option_pricing demonstrates. It does not reproduce that demonstration: nothing in Leona runs Qmod, and the index entry read here gives that directory path and a file list, nothing about what those files contain. Nothing was run for this record either — no circuit was built, compiled, simulated or executed, no option was priced, and no figure in this record is a measurement made here. The simulation results and the IBM Q Tokyo run are the paper's own claims, reported as such: this record did not repeat them, did not read the figures behind them, and does not establish what accuracy was reached, on how many qubits, or for which contract. The error-mitigation scheme is the authors' and is mitigation rather than error correction, so nothing here bounds a fault-tolerant cost. The quadratic speedup is the abstract's own statement about amplitude estimation against classical Monte Carlo, and the abstract states no error scaling and no resource count, so nothing here bears on whether pricing a real contract is cheaper on a quantum computer than on a classical one. The cost of building the input states and operators the paper puts its emphasis on is not stated in the abstract and is not carried by this record, and neither is any model assumption about the underlying assets. The hardware run is the one this 2019 paper reports, and this record makes no claim about any machine available now.",
    caveatJa:
      "本項目は、Classiq の applications/finance/option_pricing が実演しているアルゴリズムを記述したものです。その実演を再現するものではありません。Leona に Qmod を実行する仕組みはなく、ここで参照した索引項目が与えるのは当該のディレクトリのパスとファイルの一覧だけで、それらのファイルの中身については何も分かりません。本記録のために実行したものもありません。回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、オプションの価格を求めたこともなく、本記録に載る数値のうちここで測定したものは一つもありません。シミュレーション結果と IBM Q Tokyo での実行は論文自身の主張であり、そのように報告しています。本記録はそれらを追試しておらず、背後の図表も参照しておらず、どの契約について、何量子ビットで、どの程度の精度に達したのかを確認していません。誤り緩和の手法は著者らによるものであり、誤り訂正ではないため、フォールトトレラントなコストを限定するものではありません。二次の高速化は、振幅推定を古典的なモンテカルロ法と比較した要旨自身の記述であり、要旨は誤差のスケーリングも資源量も示していないため、現実の契約の価格付けが量子計算機のほうが安上がりかどうかについては何も述べていません。論文が重点を置く入力状態と演算子の構成コストは要旨に記載がなく、本記録も保持していません。原資産に関するモデルの仮定についても同様です。実機での実行は2019年の本論文が報告しているものであり、現在利用できる機器について本記録は何も主張しません。",
    tags: ["option pricing", "amplitude estimation", "monte carlo", "finance", "derivatives"],
    source: {
      id: "arxiv:1905.02666",
      title: "Option Pricing using Quantum Computers",
      authors: "Nikitas Stamatopoulos, Daniel J. Egger, Yue Sun, Christa Zoufal, Raban Iten, Ning Shen, Stefan Woerner",
      year: "2019",
      url: "https://arxiv.org/abs/1905.02666",
    },
    literature: [
      {
        title: "Option Pricing using Quantum Computers",
        authors: "Nikitas Stamatopoulos, Daniel J. Egger, Yue Sun, Christa Zoufal, Raban Iten, Ning Shen, Stefan Woerner",
        year: "2019",
        url: "https://arxiv.org/abs/1905.02666",
        relevance:
          "Primary source: it states the methodology for pricing options and portfolios of options on a gate-based quantum computer with amplitude estimation, the quadratic speedup over classical Monte Carlo it attributes to that estimator, the contract types covered (vanilla, multi-asset, and path-dependent such as barrier options), the simulation results, the run on the IBM Q Tokyo quantum device, and the error-mitigation scheme for noisy two-qubit gates. Consult it for the circuits that build the input states and operators, for the accuracies and qubit counts behind the simulations and the hardware run, and for the mitigation scheme itself — the abstract states none of them.",
        relevanceJa:
          "一次資料です。ゲート方式の量子計算機上で振幅推定を用いてオプションおよびそのポートフォリオを価格付けする方法論、その推定器に帰される古典的なモンテカルロ法に対する二次の高速化、扱う契約の種類（バニラ、複数資産、およびバリアオプションのような経路依存型）、シミュレーション結果、IBM Q Tokyo の実機での実行、雑音のある2量子ビットゲートに対する誤り緩和の手法が述べられています。入力状態と演算子を構成する回路、シミュレーションと実機実行の背後にある精度や量子ビット数、および誤り緩和の手法そのものは要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["amplitude-estimation", "amplitude-amplification", "quantum-phase-estimation", "quantum-counting"],
  },
  {
    slug: "quantum-edge-detection",
    title: "Quantum edge detection on an amplitude-encoded image",
    titleJa: "振幅符号化された画像に対する量子エッジ検出",
    family: "Quantum image processing",
    classiqPath: "applications/image_processing/quantum_hadamard_edge_detection",
    classiqCategory: "applications",
    classiqGroup: "image_processing",
    classiqName: "quantum_hadamard_edge_detection",
    problem:
      "Detect the edges of a digital image: the pixel positions at which the image values change sharply. Processing digital images keeps growing in volume, with matching demands on data storage, transmission and processing power.",
    problemJa:
      "デジタル画像について、画素値が急激に変化する位置、すなわちエッジを検出する問題です。画像処理は扱う量が増え続けており、保存・転送・処理能力への要求もそれに応じて高まっています。",
    idea:
      "The whole image is carried by a single pure quantum state: the authors encode the pixel values in the probability amplitudes and the pixel positions in the computational basis states, so the register's basis states carry the position index and its amplitudes carry the picture. They state that this representation reduces the required number of qubits compared to existing implementations, and that the image processing algorithms they present provide exponential speed-up over their classical counterparts. Edge detection is then reduced to one operation on one qubit, a count that does not grow with the picture; the abstract's own wording is that the algorithm completes the task with only one single-qubit operation, independent of the size of the image. The paper reports more than a proposal — it says the algorithm was both proposed and implemented — and its title names theory and experiment together.",
    ideaJa:
      "画像全体が1つの純粋状態に符号化されます。著者らは画素値を確率振幅に、画素位置を計算基底状態に符号化しており、レジスタの基底状態が位置の索引を担い、その振幅が画像そのものを担います。著者らは、この画像表現が既存の実装よりも必要な量子ビット数を減らすこと、そして提示する画像処理アルゴリズムが古典的な対応物に対して指数的な高速化を与えることを述べています。エッジ検出はこの符号化の上で1量子ビット演算1回に帰着します。要旨自身の表現によれば、このアルゴリズムは画像のサイズによらず、1量子ビット演算1回だけで処理を完了します。論文は提案にとどまらず実装まで行ったと報告しており、表題も理論と実験の双方を掲げています。",
    complexity:
      "One single-qubit operation for the edge-detection step, independent of the size of the image; for the image processing algorithms the paper presents, an exponential speed-up over their classical counterparts. The qubit claim is comparative rather than absolute — the representation reduces the required number of qubits compared to existing implementations — and the abstract states no gate count for preparing the encoded image or for reading the result back out.",
    complexityBasis:
      'abstract of arXiv:1801.01465: "we propose and implement a quantum algorithm that completes the task with only one single-qubit operation, independent of the size of the image"; the speed-up clause is "we present image processing algorithms that provide exponential speed-up over their classical counterparts"; the qubit clause is "Our quantum image representation reduces the required number of qubits compared to existing implementations". That abstract states no running time, gate count, circuit depth or error bound, and the Classiq index entry read for this record gives the directory path and its file name only, with no bound of any kind.',
    caveat:
      "This is a literature record: nothing was built, compiled, simulated or run for it, and no image was processed here. It documents the algorithm the Classiq demonstration demonstrates and does not reproduce that demonstration — nothing in Leona runs Qmod, and the index entry read here gives the directory path applications/image_processing/quantum_hadamard_edge_detection and one file name, nothing about what that file contains. The one single-qubit operation is quoted for the edge-detection step: the abstract states no cost for preparing the amplitude-encoded state from a classical image, for the measurements needed to read an edge map back out, or for classical post-processing, and a readout that must recover per-pixel information is where an advantage held inside the register can be lost. The exponential speed-up is asserted for the image processing algorithms the paper presents, against their classical counterparts, with no complexity expression, constant factor or error model given. The abstract does not name which single-qubit operation the algorithm uses, and this record does not supply one from any other source. The experiment is the paper's own report and was not checked here; the abstract states no hardware platform, no image size, and no accuracy achieved.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで何かを構成・コンパイル・シミュレーション・実行したことはなく、画像を処理したこともありません。記録しているのは Classiq のデモンストレーションが示すアルゴリズムそのものであって、デモの再現ではありません。Leona に Qmod を実行する仕組みはなく、ここで参照した索引項目が与えるのはディレクトリ applications/image_processing/quantum_hadamard_edge_detection とファイル名だけで、その中身については何も分かりません。「1量子ビット演算1回」はエッジ検出の段階について述べられた値です。古典的な画像から振幅符号化された状態を準備するコスト、エッジの結果を読み出すために必要な測定、古典的な後処理について要旨は何も述べておらず、画素ごとの情報を取り出す読み出しは、レジスタの内部で成り立つ優位性が失われうる箇所です。指数的な高速化は、論文が示す画像処理アルゴリズムを古典的な対応物と比べた主張であり、計算量の式も定数因子も誤差モデルも示されていません。要旨は用いる1量子ビット演算の名前を挙げておらず、本記録でも他の情報源からそれを補うことはしません。実験は論文自身の報告であってここで検証したものではなく、要旨には用いた装置も画像サイズも達成された精度も記載がありません。",
    tags: ["image processing", "edge detection", "amplitude encoding", "single-qubit operation"],
    source: {
      id: "arxiv:1801.01465",
      title: "Quantum Image Processing and Its Application to Edge Detection: Theory and Experiment",
      authors:
        "Xi-Wei Yao, Hengyan Wang, Zeyang Liao, Ming-Cheng Chen, Jian Pan, Jun Li, Kechao Zhang, Xingcheng Lin, Zhehui Wang, Zhihuang Luo, Wenqiang Zheng, Jianzhong Li, Meisheng Zhao, Xinhua Peng, Dieter Suter",
      year: "2018",
      url: "https://arxiv.org/abs/1801.01465",
    },
    literature: [
      {
        title: "Quantum Image Processing and Its Application to Edge Detection: Theory and Experiment",
        authors:
          "Xi-Wei Yao, Hengyan Wang, Zeyang Liao, Ming-Cheng Chen, Jian Pan, Jun Li, Kechao Zhang, Xingcheng Lin, Zhehui Wang, Zhihuang Luo, Wenqiang Zheng, Jianzhong Li, Meisheng Zhao, Xinhua Peng, Dieter Suter",
        year: "2018",
        url: "https://arxiv.org/abs/1801.01465",
        relevance:
          "Primary source. It sets out the quantum image representation this record describes — pixel values in the probability amplitudes, pixel positions in the computational basis states — claims a reduced qubit requirement against existing implementations and an exponential speed-up for the image processing algorithms it presents, and reports the edge-detection algorithm as both proposed and implemented, completing the task with one single-qubit operation independent of image size. Consult it for the state-preparation and readout procedures, for which single-qubit operation is used, and for the experiment's platform, image sizes and accuracy, none of which the abstract states.",
        relevanceJa:
          "一次資料です。本項目が述べる量子画像表現、すなわち画素値を確率振幅に、画素位置を計算基底状態に対応させる表現を提示し、既存の実装より必要な量子ビット数が少ないこと、および示された画像処理アルゴリズムが指数的な高速化を与えることを主張しています。エッジ検出のアルゴリズムについては、提案と実装の双方を行い、画像サイズによらず1量子ビット演算1回で処理が完了すると報告しています。状態準備と読み出しの手順、用いる1量子ビット演算、実験に用いた装置・画像サイズ・精度は要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["hhl-linear-systems", "amplitude-estimation", "quantum-fourier-transform"],
  },
  {
    slug: "ising-formulations-np-problems",
    title: "Ising formulations of NP-complete and NP-hard problems",
    titleJa: "NP完全・NP困難問題のIsing定式化",
    family: "Optimization · Ising encoding",
    classiqPath: "applications/logistics/traveling_salesman_problem",
    classiqCategory: "applications",
    classiqGroup: "logistics",
    classiqName: "traveling_salesman_problem",
    problem:
      "Given a hard combinatorial problem, rewrite it as an Ising spin model whose lowest-energy spin configurations are exactly that problem's solutions, so that a machine which minimizes energy can be pointed at the problem at all.",
    problemJa:
      "困難な組合せ問題を、最低エネルギーのスピン配置がその問題の解にちょうど対応するようなIsingスピン模型へ書き直し、エネルギーを最小化する装置にその問題を渡せるようにする、という課題です。",
    idea:
      "An Ising formulation restates a combinatorial problem in the language of ±1 spins: the problem's degrees of freedom become spins, and its constraints and objective are carried by the couplings and fields of an Ising Hamiltonian whose ground states are the problem's solutions. The paper provides such formulations for many NP-complete and NP-hard problems, including all of Karp's 21 NP-complete problems, collecting and extending mappings to the Ising model from partitioning, covering and satisfiability. It reports that in each case the required number of spins is at most cubic in the size of the problem, so the encoding itself stays polynomial across the problems it covers. The stated purpose is downstream of the encoding: the author writes that the work may be useful in designing adiabatic quantum optimization algorithms, which makes the formulation the input such an algorithm consumes rather than an algorithm in its own right.",
    ideaJa:
      "Ising定式化は、組合せ問題を ±1 のスピンの言葉で書き直すものです。問題の自由度をスピンに対応させ、制約と目的関数をIsingハミルトニアンの結合と局所磁場に担わせることで、基底状態が問題の解に対応するようにします。この論文は、Karp の21個のNP完全問題すべてを含む多くのNP完全・NP困難問題についてそのような定式化を与えており、分割・被覆・充足可能性からIsing模型への写像を集約し拡張したものだと述べています。またいずれの場合も必要なスピン数は問題サイズの高々3乗であると報告しており、扱う問題の範囲において符号化そのものは多項式に収まります。目的は符号化の先にあり、著者はこの研究が断熱量子最適化アルゴリズムの設計に有用でありうると述べています。つまりこの定式化は、そうしたアルゴリズムが入力として受け取るものであって、それ自体が解法なのではありません。",
    complexity:
      "At most cubic in the size of the problem, counted in spins — an encoding size, not a running time. No speedup is claimed: the abstract states no time to solution, no query or gate count and no comparison with classical solvers, and its only forward-looking statement is that the work may be useful in designing adiabatic quantum optimization algorithms.",
    complexityBasis:
      'abstract of arXiv:1302.5843: "In each case, the required number of spins is at most cubic in the size of the problem." The scope of "each case" is set by the preceding clause, "Ising formulations for many NP-complete and NP-hard problems, including all of Karp\'s 21 NP-complete problems". The same abstract states no running time and no classical comparison; its closing claim is "This work may be useful in designing adiabatic quantum optimization algorithms." The Classiq index entry read for this record gives the directory path and its file names only, and states no bound.',
    caveat:
      "This is a literature record: no Hamiltonian was constructed, no instance was encoded, and nothing was compiled, simulated, annealed or run here. It documents the algorithm the Classiq demonstration demonstrates and does not reproduce that demonstration — nothing in Leona runs Qmod, and the index entry read here gives the directory path applications/logistics/traveling_salesman_problem and its two file names, nothing about what those files contain. What the paper supplies is an encoding, not a solver: an Ising formulation fixes what a ground state means and says nothing about how long any method — adiabatic evolution, annealing, a variational ansatz, or a classical heuristic — needs to reach it, so no speedup over classical optimization follows from anything quoted here, and the problems remain NP-hard after the mapping. The cubic figure is an upper bound stated across the problems the paper covers, with no per-problem spin count, no constant factor, and nothing about the coupling graph, the coupling precision, or the penalty weights a device would need to realize a given formulation. The abstract names Karp's 21 NP-complete problems as a class and does not name the travelling salesman problem individually, so this record does not claim on the abstract's authority that the problem named by the demonstration's directory is among those enumerated there; a reader who needs that formulation should look it up in the paper itself.",
    caveatJa:
      "本項目は文献に基づく記録です。ここでハミルトニアンを構成したことも、具体的な事例を符号化したことも、コンパイル・シミュレーション・アニーリング・実行を行ったこともありません。記録しているのは Classiq のデモンストレーションが示すアルゴリズムそのものであって、デモの再現ではありません。Leona に Qmod を実行する仕組みはなく、ここで参照した索引項目が与えるのはディレクトリ applications/logistics/traveling_salesman_problem と2つのファイル名だけで、その中身については何も分かりません。論文が与えるのは符号化であって解法ではありません。Ising定式化は基底状態が何を意味するかを定めるだけで、断熱発展、アニーリング、変分アンサッツ、古典ヒューリスティクスのいずれについても、そこへ到達するのに要する時間には触れていません。したがってここで引用した内容から古典的な最適化に対する高速化は導かれず、写像を経ても問題がNP困難であることは変わりません。「高々3乗」は論文が扱う問題群にわたる上界であり、問題ごとのスピン数も定数因子も示されておらず、特定の定式化を実機で実現するために必要な結合グラフ、結合強度の精度、ペナルティ係数についても述べられていません。要旨は Karp の21個のNP完全問題をひとまとまりとして挙げるだけで巡回セールスマン問題を個別に名指してはいないため、デモのディレクトリ名が示す問題がそこに列挙されているとは、要旨を根拠として本記録では主張しません。その定式化が必要な読者は論文本文で確認してください。",
    tags: ["ising model", "np-complete", "combinatorial optimization", "spin encoding", "adiabatic"],
    source: {
      id: "arxiv:1302.5843",
      title: "Ising formulations of many NP problems",
      authors: "Andrew Lucas",
      year: "2013",
      url: "https://arxiv.org/abs/1302.5843",
    },
    literature: [
      {
        title: "Ising formulations of many NP problems",
        authors: "Andrew Lucas",
        year: "2013",
        url: "https://arxiv.org/abs/1302.5843",
        relevance:
          "Primary source. It collects and extends mappings to the Ising model from partitioning, covering and satisfiability into formulations for many NP-complete and NP-hard problems, including all of Karp's 21, and states that the required number of spins is at most cubic in the size of the problem in every case. Consult it for the individual constructions, their penalty terms and weights, and for which problems it treats: the abstract names them only as a class.",
        relevanceJa:
          "一次資料です。分割・被覆・充足可能性からIsing模型への写像を集約・拡張し、Karp の21個をすべて含む多くのNP完全・NP困難問題に対する定式化を与えたうえで、いずれの場合も必要なスピン数が問題サイズの高々3乗であると述べています。個々の構成、ペナルティ項とその重み、そしてどの問題を扱っているかは、要旨では問題群としてしか示されていないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "qaoa-maxcut-ring",
      "quantum-adiabatic-evolution",
      "quantum-simulated-annealing",
      "operator-qubo",
    ],
  },
  {
    slug: "quantum-portfolio-optimization",
    title: "Quantum algorithm for portfolio optimization",
    titleJa: "ポートフォリオ最適化のための量子アルゴリズム",
    family: "Quantum linear algebra",
    classiqPath: "applications/finance/portfolio_optimization_hhl",
    classiqCategory: "applications",
    classiqGroup: "finance",
    classiqName: "portfolio_optimization_hhl",
    problem:
      "Given quantum access to a historical record of asset returns, determine the optimal risk-return tradeoff curve of a portfolio and provide a way to sample from the optimal portfolio.",
    problemJa:
      "資産収益の履歴データへの量子的なアクセスが与えられたとき、ポートフォリオの最適なリスク・リターンのトレードオフ曲線を求め、最適なポートフォリオからサンプリングする手段を与える問題です。",
    idea:
      "Rebentrost and Lloyd present a quantum algorithm for portfolio optimization, addressing in turn the market-data input, the processing of that data by quantum operations, and the output of financially relevant results. Given quantum access to the historical record of returns, the algorithm determines the optimal risk-return tradeoff curve and allows one to sample from the optimal portfolio. The authors state that the algorithm can in principle attain a run time of poly(log N), where N is the size of the historical return dataset — rendered here from the abstract's own inline TeX — against poly(N) for the direct classical algorithms it compares to, which determine the risk-return curve and other properties of the optimal portfolio. They do not present this as an unqualified speedup: the abstract closes by discussing potential quantum speedups in light of recent works on efficient classical sampling approaches, flagging the comparison rather than asserting it outright. The abstract does not describe how the market-data input, the quantum operations that process it, or the output step are constructed; those mechanics are left to the paper.",
    ideaJa:
      "Rebentrost と Lloyd は、ポートフォリオ最適化のための量子アルゴリズムを提案しています。論文は、市場データの入力、そのデータを量子操作によって処理する過程、そして金融上意味のある結果の出力という順に議論しています。収益の履歴記録への量子的なアクセスが与えられると、このアルゴリズムは最適なリスク・リターンのトレードオフ曲線を求め、最適なポートフォリオからのサンプリングを可能にします。著者らは、このアルゴリズムが原理的には poly(log N) の実行時間を達成しうると述べています。ここで N は収益の履歴データセットの大きさであり、これは要旨自身のインライン TeX 表記から書き改めたものです。比較対象となる、リスク・リターン曲線その他の最適ポートフォリオの性質を求める直接的な古典アルゴリズムは poly(N) の時間を要するとされています。著者らはこれを無条件の高速化として提示しているわけではなく、要旨の末尾では、効率的な古典サンプリング手法に関する近年の研究を踏まえて量子的な高速化の可能性を論じるとしており、この比較には留保が付されています。市場データの入力、それを処理する量子操作、出力の段階がどのように構成されるかについて、要旨は述べておらず、これらの詳細は論文に委ねられています。",
    complexity:
      "In principle poly(log N), where N is the size of the historical return dataset — rendered from the abstract's inline TeX poly(log(N)) — against poly(N) for the direct classical algorithms the abstract compares it to. The abstract states this only as an order in N: it gives no constant, no dependence on any error or precision parameter, and no qubit or gate count, and it qualifies the comparison itself by pointing to recent work on efficient classical sampling approaches rather than treating the gap as settled.",
    complexityBasis:
      'The abstract of arXiv:1811.03975, the only source read for this record, opens by stating the contribution — "We present a quantum algorithm for portfolio optimization" — and the setting: "Given quantum access to the historical record of returns, the algorithm determines the optimal risk-return tradeoff curve and allows one to sample from the optimal portfolio." Its complexity claim is: "The algorithm can in principle attain a run time of ${\\rm poly}(\\log(N))$, where $N$ is the size of the historical return dataset." (TeX rendered into Unicode/plain notation for the reader: ${\\rm poly}(\\log(N))$ is poly(log N).) It compares this to "Direct classical algorithms for determining the risk-return curve and other properties of the optimal portfolio take time ${\\rm poly}(N)$" (rendered poly(N)) and immediately qualifies the comparison: "we discuss potential quantum speedups in light of the recent works on efficient classical sampling approaches." The Classiq index entry this record covers, applications/finance/portfolio_optimization_hhl, gives a directory path and a file list and states no bound of its own. Beyond the two run-time orders quoted above, the abstract carries no constant, no big-O for any other step, and no dependence on error or precision, which is why none appears above.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it; no historical return dataset was processed, and no risk-return curve was computed here. The record documents the algorithm the abstract describes and does not reproduce or verify any demonstration of it. The Classiq index entry this record covers, applications/finance/portfolio_optimization_hhl, gives only a directory path and a file list, nothing about their contents. The poly(log N) run time is stated only in principle and only as an order in N, the size of the historical return dataset: the abstract gives no constant, no dependence on any error or precision parameter, no qubit or gate count, and nothing about state preparation, readout, or hardware feasibility. It also presupposes quantum access to the historical record of returns, an input model the abstract states but does not specify further. The poly(N) figure for the direct classical algorithms is likewise an order only, with the same missing detail. Neither number is an experimental or simulated result: the abstract reports no run, on hardware or in simulation, and none was performed for this record. Finally, the comparison between the quantum and classical run times is not presented as a settled speedup: the abstract itself says the potential quantum speedups are discussed in light of recent works on efficient classical sampling approaches, so the comparison is against algorithms known to the authors at the time, not a proven separation, and this record repeats that qualification rather than asserting a speedup on its own.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、収益の履歴データセットを処理したことも、リスク・リターン曲線を計算したこともありません。本記録は要旨が述べるアルゴリズムそのものを記したものであり、その実演を再現・検証するものではありません。本記録が対象とする Classiq の索引項目 applications/finance/portfolio_optimization_hhl が与えるのは、ディレクトリのパスとファイルの一覧のみであり、それらの中身については何も分かりません。poly(log N) という実行時間はあくまで「原理的には」の話であり、N すなわち収益の履歴データセットの大きさに関する位数としてのみ述べられています。要旨は定数因子も、誤差や精度に関するいかなる依存性も、量子ビット数やゲート数も、状態準備・読み出し・実機での実現可能性についても何も述べていません。また、収益の履歴記録への量子的なアクセスという入力モデルを前提としていますが、要旨はそれ以上の詳細を述べていません。比較対象となる直接的な古典アルゴリズムの poly(N) という数値も同様に位数のみであり、同じく詳細を欠いています。いずれの数値も実験やシミュレーションの結果ではありません。要旨はいかなる実行も、実機でもシミュレーションでも報告しておらず、本記録のためにも実行していません。最後に、量子と古典の実行時間の比較は確定した高速化として提示されているわけではありません。要旨自身が、効率的な古典サンプリング手法に関する近年の研究を踏まえて量子的な高速化の可能性を論じると述べており、この比較は著者らが当時把握していたアルゴリズムとの比較であって証明された分離ではなく、本記録もこの留保をそのまま引き継ぎ、独自に高速化を主張するものではありません。",
    tags: ["portfolio optimization", "quantum finance", "risk-return tradeoff", "quantum sampling", "run-time speedup"],
    source: {
      id: "arxiv:1811.03975",
      title: "Quantum computational finance: quantum algorithm for portfolio optimization",
      authors: "Patrick Rebentrost, Seth Lloyd",
      year: "2018",
      url: "https://arxiv.org/abs/1811.03975",
    },
    literature: [
      {
        title: "Quantum computational finance: quantum algorithm for portfolio optimization",
        authors: "Patrick Rebentrost, Seth Lloyd",
        year: "2018",
        url: "https://arxiv.org/abs/1811.03975",
        relevance:
          "Primary source: it presents the quantum algorithm for portfolio optimization, states the poly(log N) run time it can in principle attain against poly(N) for the direct classical algorithms it compares to, and gives the input assumption of quantum access to the historical record of returns. Consult it for how the market-data input, the quantum processing, and the output step are actually constructed, for any constant factors or error dependence, and for the classical sampling works the abstract's discussion of potential speedups refers to — none of which the abstract itself states.",
        relevanceJa:
          "一次資料です。ポートフォリオ最適化のための量子アルゴリズムを提示し、原理的に到達しうる poly(log N) の実行時間を、比較対象となる直接的な古典アルゴリズムの poly(N) と対比して述べ、収益の履歴記録への量子的なアクセスという入力の前提を与えています。市場データの入力、量子処理、出力の段階が実際にどのように構成されるか、定数因子や誤差への依存性、そして量子的な高速化の可能性の議論が参照している古典サンプリングの研究については、要旨に記載がないため原論文で確認してください。",
      },
    ],
    relatedSlugs: ["hhl-linear-systems", "quantum-phase-estimation", "option-pricing-amplitude-estimation", "amplitude-estimation"],
  },
  {
    slug: "hybrid-hhl-portfolio-optimization",
    title: "Hybrid HHL++ for portfolio optimization",
    titleJa: "ポートフォリオ最適化のための Hybrid HHL++",
    family: "Quantum linear algebra",
    classiqPath: "applications/finance/hybrid_hhl_for_portfolio_optimization",
    classiqCategory: "applications",
    classiqGroup: "finance",
    classiqName: "hybrid_hhl_for_portfolio_optimization",
    problem:
      "Adapt the Harrow-Hassidim-Lloyd (HHL) quantum linear-systems algorithm, most of whose components current noisy quantum hardware cannot reach, into a form that near-term devices can actually execute, and demonstrate it on an application.",
    problemJa:
      "現行世代のノイズを伴う量子ハードウェアではその構成要素の大半に手が届かない Harrow-Hassidim-Lloyd（HHL）量子線形方程式アルゴリズムを、近未来の装置が実際に実行できる形に適応させ、あるアプリケーションにおいて実演する問題です。",
    idea:
      "Yalovetzky, Minssen, Herman and Pistoia work on the gap between near-term-friendly proposals for the Harrow-Hassidim-Lloyd (HHL) algorithm — a quantum linear-algebra primitive whose components the abstract says are largely out of reach of noisy intermediate-scale quantum devices — and the circuits that can actually run on noisy hardware today. Building on the Hybrid HHL algorithm proposed by Lee and colleagues, the authors propose two modifications that together give their algorithm, Hybrid HHL++: a novel algorithm for choosing a scaling factor for the linear-system matrix that maximizes the use of the ancillary qubits allocated to HHL's phase-estimation component, and a heuristic for compressing the HHL circuit. They demonstrate the modified algorithm by running it on Quantinuum System Model H-series trapped-ion quantum computers, solving different instances of small-scale portfolio-optimization problems, which the abstract calls the largest experimental demonstrations of HHL for an application to date. The abstract frames this against the broader difficulty of application-oriented benchmarking of current quantum hardware, which it says the limited scale of most quantum-algorithmic demonstrations makes hard to perform.",
    ideaJa:
      "Yalovetzky、Minssen、Herman、Pistoia は、Harrow-Hassidim-Lloyd（HHL）アルゴリズム——要旨によれば、その構成要素の大半がノイズを伴う中規模量子デバイスの手の届かないところにある量子線形代数の基本アルゴリズム——について、近未来向けに提案された実装と、実際にノイズのある実機で動かせる回路との間の隔たりに取り組んでいます。Lee らが提案した Hybrid HHL アルゴリズムを土台として、著者らはこれに2つの修正を加え、あわせて Hybrid HHL++ と呼ぶ自分たちのアルゴリズムを得ています。すなわち、HHL の位相推定部分に割り当てられる補助量子ビットの利用を最大化するように線形方程式の係数行列のスケーリング因子を定める新しいアルゴリズムと、HHL 回路を圧縮するためのヒューリスティックです。著者らは、修正版の Hybrid HHL を Quantinuum System Model H シリーズのトラップイオン量子計算機上で実行し、小規模なポートフォリオ最適化問題のさまざまな問題例を解くことでこれを実演しており、要旨はこれを、あるアプリケーションに対する HHL のこれまでで最大の実験的実演であるとしています。要旨はこれを、現行の量子ハードウェアに対するアプリケーション指向のベンチマーキングという、より広い課題の文脈に位置づけており、ほとんどの量子アルゴリズムの実演が小規模にとどまっていることがこのベンチマーキングを困難にしていると述べています。",
    complexity: "",
    complexityBasis:
      'The abstract of arXiv:2110.15958, the only source read for this record, states no complexity bound: no big-O expression, no run time, no qubit or gate count, and no scaling with the size of the linear system, the condition number, or any error parameter. What it states is a design contribution — "we propose two modifications to the Hybrid HHL algorithm proposed by Lee etal. leading to our algorithm Hybrid HHL++" — namely "a novel algorithm for determining a scaling factor for the linear system matrix that maximizes the utility of the amount of ancillary qubits allocated to the phase estimation component of HHL" and "a heuristic for compressing the HHL circuit" — and a hardware claim: "We demonstrate the efficacy of our work by running our modified Hybrid HHL on Quantinuum System Model H-series trapped-ion quantum computers to solve different problem instances of small-scale portfolio optimization problems, leading to the largest experimental demonstrations of HHL for an application to date." The Classiq index entry this record covers, applications/finance/hybrid_hhl_for_portfolio_optimization, gives a directory path and a file list and states no bound either. The field is therefore left empty on purpose rather than filled with a bound written from memory.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it; no linear system was solved, no scaling factor was computed, and no circuit-compression heuristic was applied here. The record documents the algorithm the abstract describes and does not reproduce or verify the paper's own hardware demonstration. The Classiq index entry this record covers, applications/finance/hybrid_hhl_for_portfolio_optimization, gives only a directory path and a file list, nothing about their contents. The abstract states no complexity bound of any kind for Hybrid HHL++: no big-O expression, no run time, no qubit or gate count, and no dependence on the size of the linear system, the condition number, or any error parameter. What it states instead is a pair of design contributions — a method for choosing a scaling factor for the linear-system matrix, and a heuristic for compressing the HHL circuit — and a hardware result: the modified algorithm was run on Quantinuum System Model H-series trapped-ion quantum computers on different instances of small-scale portfolio-optimization problems. That hardware run is the paper's own reported result, at the scale it reports, and it was not repeated, re-run, or checked for this record; nothing here says what small-scale means in qubit count, circuit depth, or problem size, and nothing here evaluates the result against any later hardware or any later version of the paper. The claim that this is the largest experimental demonstration of HHL for an application to date is the paper's own comparison against the state of the art it knew of at the time, not a proven or independently checked ranking, and this record makes no claim about what has been demonstrated since. The abstract also builds on the Hybrid HHL algorithm proposed by Lee and colleagues without describing that prior algorithm, and this record does not describe or evaluate it either; nor does the abstract detail how the scaling-factor algorithm or the compression heuristic work, what properties they preserve, or what they cost — those specifics are in the paper, not here.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、線形方程式を解いたことも、スケーリング因子を計算したことも、回路圧縮のヒューリスティックを適用したこともありません。本記録は要旨が述べるアルゴリズムを記したものであり、論文自身によるハードウェア実演を再現・検証するものではありません。本記録が対象とする Classiq の索引項目 applications/finance/hybrid_hhl_for_portfolio_optimization が与えるのは、ディレクトリのパスとファイルの一覧のみであり、それらの中身については何も分かりません。要旨は Hybrid HHL++ について、いかなる種類の計算量の限界も述べていません。ビッグオー記法による式も、実行時間も、量子ビット数やゲート数も、線形方程式の規模・条件数・誤差パラメータへの依存性も示されていません。代わりに述べられているのは、線形方程式の係数行列のスケーリング因子を定める手法と HHL 回路を圧縮するヒューリスティックという2つの設計上の貢献、そしてハードウェアに関する結果、すなわち修正版のアルゴリズムを Quantinuum System Model H シリーズのトラップイオン量子計算機上で、小規模なポートフォリオ最適化問題のさまざまな問題例について実行したという結果です。このハードウェア実行は論文自身が報告した結果であり、論文が報告する規模のものであって、本記録のために再実行・再現・検証したものではありません。「小規模」が量子ビット数、回路の深さ、問題の大きさのどれを指すのかはここには示されておらず、その後の実機や論文の後続バージョンに対してこの結果を評価したものでもありません。「あるアプリケーションに対する HHL のこれまでで最大の実験的実演である」という主張は、論文が把握していた当時の最先端との比較であり、証明された、あるいは独立に検証された順位付けではなく、本記録はそれ以降に何が実演されたかについて何も主張しません。要旨はまた、Lee らが提案した Hybrid HHL アルゴリズムを土台としていますが、その先行アルゴリズムの内容までは説明しておらず、本記録もこれを説明・評価していません。スケーリング因子を定めるアルゴリズムや圧縮のヒューリスティックがどのように動作するのか、どのような性質を保つのか、どれほどのコストがかかるのかについても要旨は詳述しておらず、これらの詳細は論文にあり、ここにはありません。",
    tags: ["hhl algorithm", "linear systems", "portfolio optimization", "hybrid quantum-classical", "trapped-ion hardware"],
    source: {
      id: "arxiv:2110.15958",
      title: "Solving Linear Systems on Quantum Hardware with Hybrid HHL++",
      authors: "Romina Yalovetzky, Pierre Minssen, Dylan Herman, Marco Pistoia",
      year: "2021",
      url: "https://arxiv.org/abs/2110.15958",
    },
    literature: [
      {
        title: "Solving Linear Systems on Quantum Hardware with Hybrid HHL++",
        authors: "Romina Yalovetzky, Pierre Minssen, Dylan Herman, Marco Pistoia",
        year: "2021",
        url: "https://arxiv.org/abs/2110.15958",
        relevance:
          "Primary source: it proposes the two modifications, the scaling-factor algorithm and the circuit-compression heuristic, that define Hybrid HHL++ on top of the Hybrid HHL algorithm of Lee and colleagues, and it reports running the modified algorithm on Quantinuum System Model H-series trapped-ion hardware to solve small-scale portfolio-optimization instances, calling this the largest experimental demonstration of HHL for an application to date. Consult it for how the scaling-factor algorithm and the compression heuristic actually work, for the size and structure of the portfolio-optimization instances solved, and for any complexity or resource analysis, none of which the abstract states.",
        relevanceJa:
          "一次資料です。Lee らの Hybrid HHL アルゴリズムを土台として、スケーリング因子を定めるアルゴリズムと回路圧縮のヒューリスティックという2つの修正を提案し、これらをあわせて Hybrid HHL++ と定めています。修正版のアルゴリズムを Quantinuum System Model H シリーズのトラップイオン実機上で実行し、小規模なポートフォリオ最適化の問題例を解いたと報告しており、これをあるアプリケーションに対する HHL のこれまでで最大の実験的実演であるとしています。スケーリング因子を定めるアルゴリズムや圧縮のヒューリスティックが実際にどのように動作するのか、解かれたポートフォリオ最適化の問題例の規模や構造、計算量や資源に関する解析については要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["hhl-linear-systems", "quantum-phase-estimation", "iterative-phase-estimation", "quantum-singular-value-transformation"],
  },
  {
    slug: "rainbow-options-amplitude-loading",
    title: "Quantum amplitude loading for rainbow options pricing",
    titleJa: "レインボーオプション価格付けのための量子振幅ロード",
    family: "Amplitude estimation",
    classiqPath: "applications/finance/rainbow_options",
    classiqCategory: "applications",
    classiqGroup: "finance",
    classiqName: "rainbow_options",
    problem:
      "Price rainbow options — a type of path-independent multi-asset derivative — on a quantum computer.",
    problemJa:
      "レインボーオプション——経路に依存しない複数資産デリバティブの一種——を量子計算機で価格付けする問題です。",
    idea:
      "Cibrario, Samimi Golan, Ranieri, Dri, Ippoliti, Cohen, Mattia, Montrucchio, Naveh and Corbelletto introduce what the abstract calls a novel approach to pricing rainbow options — a type of path-independent multi-asset derivative — with quantum computers. Leveraging the Iterative Quantum Amplitude Estimation method, they present an end-to-end quantum circuit implementation, and say they emphasize efficiency by delaying the transition to price space. They also analyze two different amplitude-loading techniques for handling exponential functions. The authors validate their quantum pricing model with experiments on the IBM QASM simulator, which the abstract frames as a contribution to the evolving field of quantum finance. The abstract does not describe the circuit's cost or the two amplitude-loading techniques beyond naming them, and it does not state the size of the simulated instances or the accuracy the validation achieved.",
    ideaJa:
      "Cibrario、Samimi Golan、Ranieri、Dri、Ippoliti、Cohen、Mattia、Montrucchio、Naveh、Corbelletto は、要旨が「新しいアプローチ」と呼ぶ、量子計算機によるレインボーオプション——経路に依存しない複数資産デリバティブの一種——の価格付け手法を提案しています。反復量子振幅推定（Iterative Quantum Amplitude Estimation）法を活用し、価格空間への変換を遅らせることで効率性を重視したとする、エンドツーエンドの量子回路実装を提示しています。また、指数関数を扱うための2種類の異なる振幅ロード手法を分析しています。著者らは、IBM QASM シミュレータ上での実験によって自分たちの量子価格付けモデルを検証しており、要旨はこれを量子金融という発展中の分野への貢献と位置づけています。要旨は回路のコストや2種類の振幅ロード手法の中身までは述べておらず、シミュレーションした問題例の規模や検証で達成された精度についても述べていません。",
    complexity: "",
    complexityBasis:
      'The abstract of arXiv:2402.05574, the only source read for this record, states no complexity bound: no big-O expression, no qubit or gate count, and no run time. What it states is a method and a validation. The method: "Leveraging the Iterative Quantum Amplitude Estimation method, we present an end-to-end quantum circuit implementation, emphasizing efficiency by delaying the transition to price space." and "Moreover, we analyze two different amplitude loading techniques for handling exponential functions." The validation: "Experiments on the IBM QASM simulator validate our quantum pricing model, contributing to the evolving field of quantum finance." The Classiq index entry this record covers, applications/finance/rainbow_options, gives a directory path and a file list and states no bound either. The field is therefore left empty on purpose rather than filled with a bound written from memory.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it; no rainbow option was priced, and no amplitude-loading technique was implemented here. The record documents the approach the abstract describes and does not reproduce or verify the paper's own demonstration. The Classiq index entry this record covers, applications/finance/rainbow_options, gives only a directory path and a file list, nothing about their contents — and the index lists that path under three named methods, bruteforce, direct and integration, each as a notebook and a pinned model, none of which this record describes. The abstract states no complexity bound of any kind: no qubit count, no gate count, no circuit depth, and no run time, so nothing here says what the end-to-end circuit costs to build or to run, nor what accuracy the amplitude loading achieves, nor how the two amplitude-loading techniques it analyzes compare to each other — those specifics, if given, are in the paper. The abstract reports one experiment, on the IBM QASM simulator, and calls it a validation of the pricing model; that is the paper's own reported simulation, at whatever instance size and precision the paper used, and it was not repeated, re-run, or checked for this record. A simulator run is not a hardware result: the abstract states no run on quantum hardware, and this record makes no claim about hardware feasibility.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、レインボーオプションの価格を計算したことも、振幅ロード手法を実装したこともありません。本記録は要旨が述べる手法を記したものであり、論文自身の実演を再現・検証するものではありません。本記録が対象とする Classiq の索引項目 applications/finance/rainbow_options が与えるのは、ディレクトリのパスとファイルの一覧のみであり、それらの中身については何も分かりません。この索引は、当該のパスの下に bruteforce・direct・integration という3つの手法名を掲げ、それぞれノートブックと固定されたモデルとして一覧していますが、本記録はそのいずれの中身も記述していません。要旨はいかなる種類の計算量の限界も述べていません。量子ビット数も、ゲート数も、回路の深さも、実行時間も示されていないため、エンドツーエンドの回路の構成・実行にどれほどのコストがかかるか、振幅ロードがどれほどの精度を達成するか、分析された2種類の振幅ロード手法が互いにどう比較されるかについて、本記録は何も述べられません。これらの詳細は、示されているとすれば論文の中にあります。要旨は IBM QASM シミュレータ上での実験を1件報告し、これを価格付けモデルの検証としていますが、これは論文自身が報告したシミュレーションであり、論文が用いた問題例の規模と精度によるものであって、本記録のために再実行・再現・検証したものではありません。シミュレータでの実行は実機での結果ではなく、要旨は量子ハードウェア上での実行を一切報告しておらず、本記録も実機での実現可能性について何も主張しません。",
    tags: ["rainbow options", "amplitude estimation", "quantum finance", "amplitude loading", "option pricing"],
    source: {
      id: "arxiv:2402.05574",
      title: "Quantum Amplitude Loading for Rainbow Options Pricing",
      authors:
        "Francesca Cibrario, Or Samimi Golan, Giacomo Ranieri, Emanuele Dri, Mattia Ippoliti, Ron Cohen, Christian Mattia, Bartolomeo Montrucchio, Amir Naveh, Davide Corbelletto",
      year: "2024",
      url: "https://arxiv.org/abs/2402.05574",
    },
    literature: [
      {
        title: "Quantum Amplitude Loading for Rainbow Options Pricing",
        authors:
          "Francesca Cibrario, Or Samimi Golan, Giacomo Ranieri, Emanuele Dri, Mattia Ippoliti, Ron Cohen, Christian Mattia, Bartolomeo Montrucchio, Amir Naveh, Davide Corbelletto",
        year: "2024",
        url: "https://arxiv.org/abs/2402.05574",
        relevance:
          "Primary source: it introduces the amplitude-loading approach to pricing rainbow options, describes the end-to-end quantum circuit built on Iterative Quantum Amplitude Estimation, names the two amplitude-loading techniques for exponential functions it analyzes, and reports validating the model with experiments on the IBM QASM simulator. Consult it for the circuit's cost, for how the two amplitude-loading techniques compare, and for the size and precision of the simulated instances, none of which the abstract states.",
        relevanceJa:
          "一次資料です。反復量子振幅推定に基づくエンドツーエンドの量子回路を構築し、レインボーオプションの価格付けに対する振幅ロードの手法を導入しています。分析対象とした指数関数向けの2種類の振幅ロード手法を挙げ、IBM QASM シミュレータ上での実験によってこのモデルを検証したと報告しています。回路のコスト、2種類の振幅ロード手法の比較、シミュレーションした問題例の規模と精度については要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["amplitude-estimation", "option-pricing-amplitude-estimation", "iterative-phase-estimation", "quantum-phase-estimation"],
  },
  {
    slug: "asian-option-pricing-karhunen-loeve",
    title: "Asian option pricing via the Karhunen-Loève expansion",
    titleJa: "Karhunen-Loève 展開によるアジアンオプションの価格付け",
    family: "Amplitude estimation",
    classiqPath: "applications/finance/brownian_chebyshev_polynomials",
    classiqCategory: "applications",
    classiqGroup: "finance",
    classiqName: "brownian_chebyshev_polynomials",
    problem:
      "Price discretely monitored Asian options over T monitoring points, where the underlying asset is modeled by a geometric Brownian motion.",
    problemJa:
      "原資産が幾何ブラウン運動としてモデル化される場合に、T 個のモニタリング時点にわたって離散的にモニタリングされるアジアンオプションを価格付けする問題です。",
    idea:
      "Prakash, Sun, Chakrabarti, Che, Dandapani, Herman, Kumar, Sureshbabu, Wood, Kerenidis and Pistoia consider the problem of pricing discretely monitored Asian options over T monitoring points, with the underlying asset modeled by a geometric Brownian motion, and give two quantum algorithms for it. Both achieve complexity poly-logarithmic in T and polynomial in 1/ε, where ε is the additive approximation error. One is obtained from an O(log T)-qubit semi-digital quantum encoding of the Brownian motion that allows exponentiation of the stochastic process; the other from analyzing classical Monte Carlo algorithms inspired by that same semi-digital encoding. The better of the two, the abstract states, reaches complexity Õ(1/ε³), where the tilde suppresses factors that are only poly-logarithmic in T and 1/ε. The authors state that their methods generalize to pricing options where the underlying asset price is a smooth function of a sub-Gaussian process and the payoff depends on the weighted time-average of that price. The abstract's title refers to the Karhunen-Loève expansion; it does not use the term Chebyshev polynomials anywhere, so this record makes no claim connecting the two algorithms it describes to any Chebyshev-polynomial construction.",
    ideaJa:
      "Prakash、Sun、Chakrabarti、Che、Dandapani、Herman、Kumar、Sureshbabu、Wood、Kerenidis、Pistoia は、原資産が幾何ブラウン運動としてモデル化されるもとで、T 個のモニタリング時点にわたって離散的にモニタリングされるアジアンオプションの価格付け問題を検討し、これに対する2つの量子アルゴリズムを与えています。いずれも T に関して多重対数、1/ε に関して多項式の計算量を達成します。ここで ε は加法的な近似誤差です。一方は、確率過程の指数化を可能にするブラウン運動の O(log T) 量子ビットのセミデジタル量子符号化から得られ、他方は、同じセミデジタル符号化に着想を得た古典モンテカルロアルゴリズムの解析から得られています。要旨によれば、両者のうちより優れた方は Õ(1/ε³) という計算量に達し、このチルダは T と 1/ε についてのみ多重対数的な因子を抑制しています。著者らは、自分たちの手法が、原資産価格が劣ガウス過程の滑らかな関数としてモデル化され、ペイオフが原資産価格の重み付き時間平均に依存するようなオプションの価格付けにも一般化されると述べています。要旨のタイトルは Karhunen-Loève 展開に言及していますが、「チェビシェフ多項式」という語はどこにも用いられていないため、本記録は、ここに記した2つのアルゴリズムをいかなるチェビシェフ多項式による構成とも結び付けて主張することはありません。",
    complexity:
      "Poly-logarithmic in T and polynomial in 1/ε for both quantum algorithms given, where T is the number of monitoring points and ε is the additive approximation error; the better of the two reaches Õ(1/ε³), with the tilde suppressing factors that are poly-logarithmic in T and 1/ε. One algorithm is built from an O(log T)-qubit semi-digital quantum encoding of the Brownian motion. The abstract states no further constant, no explicit qubit or gate count for the Monte-Carlo-derived algorithm, and no total circuit-resource count for either.",
    complexityBasis:
      'The abstract of arXiv:2402.10132, the only source read for this record, sets up the task — "We consider the problem of pricing discretely monitored Asian options over $T$ monitoring points where the underlying asset is modeled by a geometric Brownian motion" — and states the headline bound: "We provide two quantum algorithms with complexity poly-logarithmic in $T$ and polynomial in $1/\\epsilon$, where $\\epsilon$ is the additive approximation error." (TeX rendered into Unicode/plain notation for the reader: $T$ is T and $1/\\epsilon$ is 1/ε.) One algorithm comes from "an $O(\\log T)$-qubit semi-digital quantum encoding of the Brownian motion that allows for exponentiation of the stochastic process" (rendered O(log T)-qubit), the other "by analyzing classical Monte Carlo algorithms inspired by the semi-digital encodings." The abstract names the better of the two: "The best quantum algorithm obtained using this approach has complexity $\\widetilde{O}(1/\\epsilon^{3})$ where the $\\widetilde{O}$ suppresses factors poly-logarithmic in $T$ and $1/\\epsilon$" (rendered Õ(1/ε³), the tilde marking exactly the suppression the abstract states). Beyond these expressions the abstract gives no further constant, no total qubit or gate count for either algorithm, and no cost figure for the Monte-Carlo-derived one beyond its complexity order. The Classiq index entry this record covers, applications/finance/brownian_chebyshev_polynomials, gives a directory path and a file list and states no bound of its own; its name refers to Chebyshev polynomials, a term this abstract never uses, so this field carries no claim about any Chebyshev-polynomial construction.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it; no Asian option was priced, and no semi-digital encoding of a Brownian motion was constructed here. The record documents the algorithms the abstract describes and does not reproduce or verify any demonstration of them. The Classiq index entry this record covers, applications/finance/brownian_chebyshev_polynomials, gives only a directory path and a file list, nothing about their contents; the directory's own name refers to Chebyshev polynomials, and nothing in the abstract read for this record uses that term or otherwise describes a Chebyshev-polynomial construction, so this record makes no claim connecting the two. The poly-logarithmic-in-T, polynomial-in-1/ε bound and the sharper Õ(1/ε³) figure for the better algorithm are stated only as complexity orders: the abstract gives no constant factor, no explicit qubit or gate count for the Monte-Carlo-derived algorithm beyond its order, no state-preparation or readout cost, and nothing about hardware feasibility. Both bounds are for the specific task the abstract states — discretely monitored Asian options over T monitoring points under a geometric Brownian motion — and the further claim that the methods generalize to a smooth function of a sub-Gaussian process with a weighted time-average payoff is the authors' own generalization claim, not separately bounded in the abstract and not evaluated here. The abstract reports no experiment and no simulation of either algorithm: no run, on hardware or in simulation, is claimed by it, and none was performed for this record.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、アジアンオプションの価格を計算したことも、ブラウン運動のセミデジタル符号化を構成したこともありません。本記録は要旨が述べるアルゴリズムを記したものであり、その実演を再現・検証するものではありません。本記録が対象とする Classiq の索引項目 applications/finance/brownian_chebyshev_polynomials が与えるのは、ディレクトリのパスとファイルの一覧のみであり、それらの中身については何も分かりません。このディレクトリの名前自体はチェビシェフ多項式に言及していますが、本記録のために読んだ要旨はこの語を一切用いておらず、チェビシェフ多項式による構成についても何も述べていないため、本記録は両者を結び付ける主張を行いません。T に関して多重対数、1/ε に関して多項式という限界、および、より優れたアルゴリズムに対する Õ(1/ε³) というより鋭い数値は、いずれも計算量の位数としてのみ示されています。要旨は定数因子も、モンテカルロ由来のアルゴリズムに対する位数を超えた具体的な量子ビット数やゲート数も、状態準備や読み出しのコストも、実機での実現可能性についても何も述べていません。いずれの限界も、要旨が定める具体的な課題、すなわち幾何ブラウン運動のもとで T 個のモニタリング時点にわたって離散的にモニタリングされるアジアンオプションについてのものであり、原資産価格が劣ガウス過程の滑らかな関数であり、ペイオフが重み付き時間平均に依存するオプションへの一般化という主張は著者ら自身によるものであって、要旨の中で別途限界が示されているわけではなく、本記録もこれを検証していません。要旨はいずれのアルゴリズムについても実験やシミュレーションを報告しておらず、実機でもシミュレーションでも実行は主張されておらず、本記録のためにも実行していません。",
    tags: ["asian options", "geometric brownian motion", "quantum encoding", "option pricing", "monte carlo"],
    source: {
      id: "arxiv:2402.10132",
      title: "Quantum option pricing via the Karhunen-Loève expansion",
      authors:
        "Anupam Prakash, Yue Sun, Shouvanik Chakrabarti, Charlie Che, Aditi Dandapani, Dylan Herman, Niraj Kumar, Shree Hari Sureshbabu, Ben Wood, Iordanis Kerenidis, Marco Pistoia",
      year: "2024",
      url: "https://arxiv.org/abs/2402.10132",
    },
    literature: [
      {
        title: "Quantum option pricing via the Karhunen-Loève expansion",
        authors:
          "Anupam Prakash, Yue Sun, Shouvanik Chakrabarti, Charlie Che, Aditi Dandapani, Dylan Herman, Niraj Kumar, Shree Hari Sureshbabu, Ben Wood, Iordanis Kerenidis, Marco Pistoia",
        year: "2024",
        url: "https://arxiv.org/abs/2402.10132",
        relevance:
          "Primary source: it states the poly-logarithmic-in-T, polynomial-in-1/ε bound for both quantum algorithms, the O(log T)-qubit semi-digital encoding behind one of them, the Õ(1/ε³) complexity of the better algorithm, and the claimed generalization to sub-Gaussian processes with weighted time-average payoffs. Consult it for the Karhunen-Loève expansion the title refers to, for how the semi-digital encoding and the Monte Carlo algorithm it inspires are actually built, for any constant factors, and for whether a Chebyshev-polynomial construction — named in the Classiq directory this record covers but not in this abstract — appears anywhere in the paper.",
        relevanceJa:
          "一次資料です。両方の量子アルゴリズムに対する T について多重対数、1/ε について多項式の限界、そのうち一方の背後にある O(log T) 量子ビットのセミデジタル符号化、より優れたアルゴリズムの Õ(1/ε³) という計算量、そして劣ガウス過程・重み付き時間平均ペイオフへの一般化の主張を述べています。タイトルが言及する Karhunen-Loève 展開の内容、セミデジタル符号化とそれに着想を得たモンテカルロアルゴリズムが実際にどう構成されるか、定数因子、そして本記録が対象とする Classiq のディレクトリ名にはあるがこの要旨にはないチェビシェフ多項式による構成が論文のどこかに現れるかどうかについては、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["amplitude-estimation", "option-pricing-amplitude-estimation", "quantum-phase-estimation", "iterative-phase-estimation"],
  },
  {
    slug: "tensor-hypercontraction-block-encoding",
    title: "Tensor hypercontraction block encoding for quantum chemistry",
    titleJa: "量子化学のためのテンソル超収縮ブロックエンコーディング",
    family: "Eigenvalue estimation",
    classiqPath: "applications/chemistry/tensor_hypercontraction",
    classiqCategory: "applications",
    classiqGroup: "chemistry",
    classiqName: "tensor_hypercontraction",
    problem:
      "Represent the spectrum of a quantum chemistry Hamiltonian, given in an arbitrary (for example molecular) orbital basis, as a block-encoded quantum circuit cheap enough to support phase estimation of a molecular eigenvalue.",
    problemJa:
      "量子化学ハミルトニアンのスペクトルを、任意の(例えば分子)軌道基底で与えられた形から、位相推定によって分子固有値を求めるのに十分安価なブロックエンコード量子回路として表現するという問題です。",
    idea:
      "Lee, Berry, Gidney, Huggins, McClean, Wiebe and Babbush describe quantum circuits that block encode the spectra of quantum chemistry Hamiltonians in a basis of N arbitrary, for example molecular, orbitals. Their key insight is to factorize the Hamiltonian by a method the authors call tensor hypercontraction (THC), transforming the Coulomb operator into an isospectral diagonal form defined by the THC factors in a non-orthogonal basis; they then use qubitization to simulate the resulting non-orthogonal THC Hamiltonian in a way that the authors say avoids most complications of that non-orthogonal basis. The authors state that repeating these block-encoding circuits, combined with phase estimation, lets one sample in the molecular eigenbasis. They report that their construction is the lowest complexity shown for quantum computations of chemistry within an arbitrary basis, and that, up to logarithmic factors, it matches the scaling of the most efficient prior block encodings — ones that can work only with orthogonal basis functions diagonalizing the Coulomb operator, such as the plane wave dual basis. The authors also reanalyze and reduce the cost of several of the best prior algorithms for these simulations, to give what they describe as a clear comparison to their own construction. They report compiling their algorithm for challenging finite-sized molecules such as FeMoCo, finding it requires the least fault-tolerant resources of any known approach, and, having laid out and optimized the surface-code resources the compilation needs, report that FeMoCo can be simulated using about four million physical qubits and under four days of runtime, under stated assumptions on cycle time and gate error rate.",
    ideaJa:
      "Lee、Berry、Gidney、Huggins、McClean、Wiebe、Babbush は、N 個の任意の(例えば分子)軌道からなる基底で量子化学ハミルトニアンのスペクトルをブロックエンコードする量子回路を示しています。彼らの鍵となる着眼点は、テンソル超収縮(THC)と呼ぶ手法によってハミルトニアンを因数分解し、THC 因子によって定まる非直交基底のもとでクーロン演算子を等スペクトルな対角形に変換することです。続いて量子ビット化を用いてこの非直交 THC ハミルトニアンをシミュレートしますが、著者らはこの方法が非直交基底に伴う複雑さの大半を回避すると述べています。著者らは、これらのブロックエンコード回路を繰り返し用いることと位相推定を組み合わせれば、分子固有基底でのサンプリングが可能になると述べています。彼らは、この構成が任意基底での量子化学計算についてこれまでに示された中で最も低い計算量であると報告し、対数因子を除けば、直交基底関数(例えば平面波双対基底)によってクーロン演算子を対角化することしかできない従来の最も効率的なブロックエンコーディングのスケーリングと一致すると述べています。著者らはまた、これらのシミュレーションに対する従来の最良のアルゴリズムのいくつかについてコストを再解析し削減することで、自分たちの手法との明確な比較を可能にしたとしています。彼らは、FeMoCo のような困難な有限サイズの分子に対して自分たちのアルゴリズムをコンパイルし、既知のいかなる手法よりも少ないフォールトトレラント資源しか必要としないことを見出したと報告しており、そのコンパイルに必要な表面符号の資源を設計・最適化した結果、FeMoCo は約400万個の物理量子ビットと4日未満の実行時間でシミュレートできると報告しています(サイクル時間1マイクロ秒、物理ゲート誤り率0.1%以下という前提のもとで)。",
    complexity:
      "Õ(N) Toffoli complexity for the block-encoding circuits, in a basis of N orbitals, with O(λ/ε) repetitions of those circuits needed for phase estimation to sample in the molecular eigenbasis, where λ is the 1-norm of the Hamiltonian coefficients and ε is the target precision. The abstract states this is the lowest complexity shown for quantum computations of chemistry within an arbitrary basis, and that up to logarithmic factors it matches the scaling of the most efficient prior block encodings restricted to an orthogonal basis.",
    complexityBasis:
      'The abstract of arXiv:2011.03494 states, in the raw TeX as fetched from the abs page: "We describe quantum circuits with only $\\widetilde{\\cal O}(N)$ Toffoli complexity that block encode the spectra of quantum chemistry Hamiltonians in a basis of $N$ arbitrary (e.g., molecular) orbitals." Rendered into Unicode for the reader (script-O with a tilde becomes Õ, the italic N stays N), this is Õ(N) Toffoli complexity in a basis of N orbitals. The same abstract continues: "With ${\\cal O}(\\lambda / \\epsilon)$ repetitions of these circuits one can use phase estimation to sample in the molecular eigenbasis, where $\\lambda$ is the 1-norm of Hamiltonian coefficients and $\\epsilon$ is the target precision." — rendered here as O(λ/ε) repetitions for 1-norm λ and target precision ε. It further states "This is the lowest complexity that has been shown for quantum computations of chemistry within an arbitrary basis." and that "up to logarithmic factors, this matches the scaling of the most efficient prior block encodings that can only work with orthogonal basis functions diagonalizing the Coloumb operator (e.g., the plane wave dual basis)" (the misspelling of Coulomb there is the abstract\'s own). The Classiq index entry for applications/chemistry/tensor_hypercontraction gives a directory path and a file list and states no bound; it was read and adds nothing to this field.',
    caveat:
      "This is a literature record. Nothing was built, compiled, simulated or run for it, and no chemistry Hamiltonian was block encoded or simulated; the record documents the algorithm as its abstract states it and does not reproduce or verify the Classiq demonstration. The index entry read for this record, applications/chemistry/tensor_hypercontraction, gives that directory path and a file list — tensor_hypercontraction.ipynb and tensor_hypercontraction.qmod — and nothing about what those files contain. The Õ(N) Toffoli complexity bounds only the block-encoding circuits themselves, in a basis of N orbitals; it carries no constant factor, and the abstract's own qualifier that its scaling matches prior work only up to logarithmic factors is a reminder that the tilde notation hides polylogarithmic factors rather than a claim that they vanish. The O(λ/ε) repetition count bounds how many block-encoding circuits phase estimation needs to sample in the molecular eigenbasis, for 1-norm λ of the Hamiltonian coefficients and target precision ε; the abstract states no relationship between λ and the size or identity of any specific molecule, so nothing here converts either bound into a qubit count, a gate count or a wall-clock time for a given system. The claim that this is the lowest complexity shown for quantum computations of chemistry within an arbitrary basis is a comparison against prior published algorithms, including the authors' own reanalysis of prior costs, not a proven lower bound over all possible algorithms; the same is true of the claim that the scaling matches the most efficient prior orthogonal-basis block encodings up to logarithmic factors. The about four million physical qubits and under four days of runtime for FeMoCo are the paper's own reported compilation and surface-code resource estimate for that one named, finite-sized molecule, made under stated assumptions of 1 microsecond cycle times and physical gate error rates no worse than 0.1%; this is an estimate from compiling the algorithm, not a run on hardware or in a full circuit simulation, it was not reproduced or checked for this record, and it says nothing about any other molecule or about resource requirements under different assumptions.",
    caveatJa:
      "本項目は文献に基づく記録です。ここでは何も構築・コンパイル・シミュレーション・実行しておらず、いかなる化学ハミルトニアンもブロックエンコードもシミュレーションもしていません。本記録は要旨が述べるとおりにアルゴリズムを記載したものであり、Classiq の実演を再現または検証したものではありません。本記録のために参照した索引項目 applications/chemistry/tensor_hypercontraction は、そのディレクトリのパスとファイル一覧—tensor_hypercontraction.ipynb と tensor_hypercontraction.qmod—を与えるのみで、それらのファイルの中身については何も示していません。Õ(N) の Toffoli 計算量が束縛するのは N 個の軌道からなる基底におけるブロックエンコード回路そのものだけであり、定数因子は含まれません。また、対数因子を除いて一致するという要旨自身の限定は、チルダ記法が対数因子を隠していることの注意であって、それが消えるという主張ではありません。O(λ/ε) という繰り返し回数が束縛するのは、分子固有基底でサンプリングするために位相推定が必要とするブロックエンコード回路の回数であり、λ はハミルトニアン係数の1-ノルム、ε は目標精度です。要旨は λ と特定の分子の大きさや種類との関係を何も述べていないため、本記録はいずれの束縛も特定の系に対する量子ビット数・ゲート数・実時間には変換していません。「任意基底での量子化学計算についてこれまでに示された中で最も低い計算量である」という主張は、著者ら自身によるコストの再解析を含め、既存の公表されたアルゴリズムとの比較であって、あらゆる可能なアルゴリズムに対して証明された下界ではありません。対数因子を除いて従来の最も効率的な直交基底ブロックエンコーディングと一致するという主張についても同様です。約400万個の物理量子ビットと4日未満という実行時間は、FeMoCo という1つの具体的な有限サイズ分子について、1マイクロ秒のサイクル時間および0.1%以下の物理ゲート誤り率という前提のもとで、著者ら自身がコンパイルと表面符号資源の見積りから報告した数値であり、実機や完全な回路シミュレーションでの実行結果ではありません。本記録のために再現・検証したものではなく、他のいかなる分子についても、異なる前提のもとでの資源要件についても、何も述べていません。",
    tags: ["tensor hypercontraction", "block encoding", "phase estimation", "quantum chemistry", "toffoli complexity"],
    source: {
      id: "arxiv:2011.03494",
      title: "Even more efficient quantum computations of chemistry through tensor hypercontraction",
      authors: "Joonho Lee, Dominic W. Berry, Craig Gidney, William J. Huggins, Jarrod R. McClean, Nathan Wiebe, Ryan Babbush",
      year: "2020",
      url: "https://arxiv.org/abs/2011.03494",
    },
    literature: [
      {
        title: "Even more efficient quantum computations of chemistry through tensor hypercontraction",
        authors: "Joonho Lee, Dominic W. Berry, Craig Gidney, William J. Huggins, Jarrod R. McClean, Nathan Wiebe, Ryan Babbush",
        year: "2020",
        url: "https://arxiv.org/abs/2011.03494",
        relevance:
          "Primary source: it states the Õ(N) Toffoli complexity of the block-encoding circuits, the O(λ/ε) repetition count phase estimation needs to sample in the molecular eigenbasis, the tensor hypercontraction factorization and qubitization construction, and the FeMoCo compilation and surface-code resource estimate. Consult it for the derivation of the complexity bounds, the definition of λ for a specific molecule, the treatment of the non-orthogonal basis, and the reanalysis of prior algorithms' costs, none of which the abstract states in detail.",
        relevanceJa:
          "一次資料です。ブロックエンコード回路の Õ(N) という Toffoli 計算量、分子固有基底でサンプリングするために位相推定が必要とする O(λ/ε) という繰り返し回数、テンソル超収縮による因数分解と量子ビット化による構成、および FeMoCo のコンパイルと表面符号資源の見積りが述べられています。計算量の導出、特定の分子に対する λ の定義、非直交基底の扱い、従来アルゴリズムのコストの再解析については要旨に詳細が示されていないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "molecular-energy-phase-estimation",
      "quantum-phase-estimation",
      "quantum-singular-value-transformation",
      "h2-molecular-hamiltonian",
    ],
  },
  {
    slug: "protein-folding-quantum-walk",
    title: "QFold: protein folding by quantum walk",
    titleJa: "QFold：量子ウォークによるタンパク質折り畳み",
    family: "Quantum walk",
    classiqPath: "applications/chemistry/protein_folding/protein_folding_with_quantum_walk",
    classiqCategory: "applications",
    classiqGroup: "chemistry/protein_folding",
    classiqName: "protein_folding_with_quantum_walk",
    problem:
      "Predict the three-dimensional structure of a protein from its amino-acid sequence, addressed here by parameterizing the protein in terms of the torsion angles of its amino acids rather than by a lattice-model simplification.",
    problemJa:
      "アミノ酸配列からタンパク質の三次元構造を予測する問題です。ここでは、格子モデルによる簡略化ではなく、アミノ酸のねじれ角によるパラメータ化によってタンパク質を表現する形で扱われています。",
    idea:
      "Casares, Campos and Martin-Delgado present QFold, a hybrid quantum algorithm for predicting the three-dimensional structure of proteins, by combining recent deep learning advances with the well known technique of quantum walks applied to a Metropolis algorithm. The authors describe QFold as fully scalable, and state that, in contrast to previous quantum approaches, it does not require a lattice model simplification, relying instead on what they call the much more realistic assumption of parameterizing the protein in terms of torsion angles of the amino acids. They compare QFold against its classical analog for different annealing schedules and report finding a polynomial quantum advantage. The authors also report implementing a minimal realization of the quantum Metropolis step of QFold on the IBMQ Casablanca quantum system.",
    ideaJa:
      "Casares、Campos、Martin-Delgado は、深層学習の最近の進展と、メトロポリスアルゴリズムに適用されたよく知られた量子ウォークの技法を組み合わせることで、タンパク質の三次元構造を予測するハイブリッド量子アルゴリズム QFold を提案しています。著者らは QFold を完全にスケーラブルであると述べ、従来の量子的手法とは異なり格子モデルによる簡略化を必要とせず、代わりにアミノ酸のねじれ角によるパラメータ化というより現実的な仮定に依拠していると述べています。彼らは QFold を、さまざまな焼きなましスケジュールについてその古典的な対応アルゴリズムと比較し、多項式的な量子優位性を見出したと報告しています。著者らはまた、QFold の量子メトロポリスの部分を最小限に実現したものを IBMQ Casablanca 量子システム上に実装したと報告しています。",
    complexity:
      "A polynomial quantum advantage over the classical analog algorithm, found by comparing the two across different annealing schedules. The abstract states no exponent, no big-O expression, and no other resource count for either algorithm.",
    complexityBasis:
      'The abstract of arXiv:2101.10279, the only source read for this record, states: "We compare it with its classical analog for different annealing schedules and find a polynomial quantum advantage". It names no exponent, no big-O expression, and no other quantitative bound — not a qubit count, not a gate count, not a query count — for either algorithm; that clause is the entirety of the abstract\'s complexity content. The Classiq index entry for applications/chemistry/protein_folding/protein_folding_with_quantum_walk gives a directory path and a file list (qfold.ipynb, qfold.qmod) and states no bound either.',
    caveat:
      "This is a literature record. Nothing was built, compiled, simulated or run for it, and no protein structure was predicted or folded; the record documents the algorithm as its abstract states it and does not reproduce or verify the Classiq demonstration. The index entry read for this record, applications/chemistry/protein_folding/protein_folding_with_quantum_walk, gives that directory path and a file list — qfold.ipynb and qfold.qmod — and nothing about what those files contain. The polynomial quantum advantage the abstract reports is a comparison against the algorithm's own classical analog, over different annealing schedules, as the authors measure it; the abstract states no exponent for either the quantum or classical scaling, no constant factor, no qubit count, no gate count, and it does not say what quantity — running time, number of Metropolis steps, or something else — the advantage is measured in, so none of that is recorded here. Calling QFold fully scalable, and calling torsion-angle parameterization the much more realistic assumption, are the authors' own characterizations, not independently checked for this record. The IBMQ Casablanca run the abstract reports is described as a minimal realization of the quantum Metropolis step, not a full run of QFold end to end, and it is the paper's own reported experiment, at whatever size that minimal realization used — a size the abstract does not state — carried here as the paper's claim rather than repeated or checked. Nothing here says how large a protein QFold could fold on present or any specific hardware, and nothing here compares QFold's classical-analog comparison to any other protein-folding algorithm outside the paper.",
    caveatJa:
      "本項目は文献に基づく記録です。ここでは何も構築・コンパイル・シミュレーション・実行しておらず、いかなるタンパク質構造も予測していません。本記録は要旨が述べるとおりにアルゴリズムを記載したものであり、Classiq の実演を再現または検証したものではありません。本記録のために参照した索引項目 applications/chemistry/protein_folding/protein_folding_with_quantum_walk は、そのディレクトリのパスとファイル一覧—qfold.ipynb と qfold.qmod—を与えるのみで、それらのファイルの中身については何も示していません。要旨が報告する多項式的な量子優位性は、著者らの測り方によれば、さまざまな焼きなましスケジュールにわたってこのアルゴリズム自身の古典的対応アルゴリズムと比較したものです。要旨は量子側にも古典側にも指数を示しておらず、定数因子も、量子ビット数も、ゲート数も示していません。また、優位性が何(実行時間か、メトロポリスのステップ数か、それ以外か)によって測られているのかも述べていないため、これらは本記録には記載していません。「完全にスケーラブル」という表現や、ねじれ角によるパラメータ化を「はるかに現実的な仮定」とする記述は、著者ら自身の特徴づけであり、本記録が独自に検証したものではありません。要旨が報告する IBMQ Casablanca での実行は、量子メトロポリスのステップを最小限に実現したものであって QFold 全体を通した実行ではなく、論文自身が報告する実験です。その最小実現がどの規模で行われたかは要旨に記載がなく、本記録でも追試・検証していません。QFold が現在ないし特定のハードウェア上でどれほど大きなタンパク質を折り畳めるのかについて、本記録は何も述べておらず、QFold の古典的対応アルゴリズムとの比較を、論文の外にある他のタンパク質折り畳みアルゴリズムと比較するものでもありません。",
    tags: ["protein folding", "quantum walk", "metropolis algorithm", "torsion angles", "hybrid algorithm"],
    source: {
      id: "arxiv:2101.10279",
      title: "QFold: Quantum Walks and Deep Learning to Solve Protein Folding",
      authors: "P A M Casares, Roberto Campos, M A Martin-Delgado",
      year: "2021",
      url: "https://arxiv.org/abs/2101.10279",
    },
    literature: [
      {
        title: "QFold: Quantum Walks and Deep Learning to Solve Protein Folding",
        authors: "P A M Casares, Roberto Campos, M A Martin-Delgado",
        year: "2021",
        url: "https://arxiv.org/abs/2101.10279",
        relevance:
          "Primary source: it names QFold, states that it combines deep learning with quantum walks applied to a Metropolis algorithm, that it parameterizes the protein by torsion angles rather than a lattice model, and reports a polynomial quantum advantage over its classical analog together with a minimal quantum-Metropolis realization on IBMQ Casablanca. Consult it for how QFold is constructed — the deep-learning component, the quantum-walk step, the annealing schedules compared, and the size of the IBMQ Casablanca realization — none of which the abstract states.",
        relevanceJa:
          "一次資料です。QFold という名称、深層学習とメトロポリスアルゴリズムに適用された量子ウォークを組み合わせていること、格子モデルではなくねじれ角によってタンパク質をパラメータ化していること、古典的対応アルゴリズムに対する多項式的な量子優位性、および IBMQ Casablanca 上での量子メトロポリスの最小実現について述べています。QFold がどのように構成されているか、すなわち深層学習の部分、量子ウォークのステップ、比較された焼きなましスケジュール、IBMQ Casablanca での実現の規模については要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "protein-folding-variational",
      "quantum-walk-line",
      "welded-tree-traversal",
      "element-distinctness",
    ],
  },
  {
    slug: "projection-based-embedding-vqe",
    title: "Projection-based embedding for VQE-in-DFT",
    titleJa: "VQE-in-DFT のための射影に基づく埋め込み",
    family: "Variational quantum eigensolver",
    classiqPath: "applications/chemistry/projection_based_embedding",
    classiqCategory: "applications",
    classiqGroup: "chemistry",
    classiqName: "projection_based_embedding",
    problem:
      "Simulate strongly correlated chemical systems on near-term quantum hardware, whose noise and limited size otherwise confine such simulations to small chemical systems, by embedding a quantum treatment of a strongly correlated fragment within a larger classical calculation.",
    problemJa:
      "近未来の量子ハードウェア上で強相関化学系をシミュレートする問題です。ノイズと規模の制約のため、そうしたシミュレーションは通常小さな化学系に限られますが、ここでは強相関のあるフラグメントに対する量子的な扱いを、より大きな古典計算の中に埋め込むことで対処しています。",
    idea:
      "Rossmannek, Pavošević, Rubio and Tavernelli combine the variational quantum eigensolver (VQE) with density functional theory (DFT) through a quantum embedding approach, using the projection-based embedding method to couple the two — a method the authors state is not limited to VQE. The resulting VQE-in-DFT method treats a strongly correlated fragment of a chemical system with VQE while treating the remainder with DFT, addressing the current limitation of near-term quantum devices to small chemical systems. The authors report implementing the method efficiently on a real quantum device and applying it to simulate the triple-bond breaking process in butyronitrile. They present the results as showing that the developed method is a promising approach for simulating systems with a strongly correlated fragment on a quantum computer, and state that the developments and their implementation will benefit chemical areas including computer-aided drug design and the study of metalloenzymes with a strongly correlated fragment.",
    ideaJa:
      "Rossmannek、Pavošević、Rubio、Tavernelli は、量子埋め込みのアプローチを通じて変分量子固有値ソルバー(VQE)と密度汎関数理論(DFT)を組み合わせ、両者を結びつけるために射影に基づく埋め込み手法を用いています。著者らはこの手法が VQE に限定されるものではないと述べています。得られる VQE-in-DFT 手法は、化学系の強相関フラグメントを VQE で扱い、残りの部分を DFT で扱うことで、近未来の量子デバイスが小さな化学系に限られるという現状の制約に対処します。著者らは、この手法を実機の量子デバイス上で効率的に実装し、ブチロニトリルにおける三重結合の解離過程をシミュレートするために用いたと報告しています。彼らはこの結果を、強相関フラグメントを持つ系を量子計算機上でシミュレートするための有望な手法であることを示すものと位置づけ、この開発とそれに付随する実装が、計算機支援による創薬設計や、強相関フラグメントを持つ金属酵素の研究を含む、さまざまな化学分野に役立つだろうと述べています。",
    complexity: "",
    complexityBasis:
      'The abstract of arXiv:2302.03052, the only source read for this record, states no cost, running time, qubit count, gate count or speedup bound anywhere in it. Its claims are architectural and qualitative: it says quantum computing "has emerged as a promising platform for simulating strongly correlated systems in chemistry" while near-term hardware limitations mean "their application is currently limited only to small chemical systems", and that the developed VQE-in-DFT method "is then implemented efficiently on a real quantum device" without stating what that efficiency consists of in qubits, gates, or time. The Classiq index entry for applications/chemistry/projection_based_embedding gives a directory path and a single file, projected_based_embedding_tutorial.ipynb, and states no bound either. The complexity field is therefore left empty on purpose rather than filled with a bound written from memory.',
    caveat:
      "This is a literature record. Nothing was built, compiled, simulated or run for it, and no molecule was simulated; the record documents the algorithm as its abstract states it and does not reproduce or verify the Classiq demonstration. The index entry read for this record, applications/chemistry/projection_based_embedding, gives that directory path and a single file, projected_based_embedding_tutorial.ipynb, and nothing about what it contains. The abstract states no cost, running time, qubit count, gate count or speedup bound for the projection-based embedding method, for VQE-in-DFT, or for the reported real-device run, so none is recorded above; this record makes no efficiency or scaling claim of its own for the method. The triple-bond-breaking simulation of butyronitrile on a real quantum device is the paper's own reported experiment; the abstract does not state the device used, the number of qubits, the accuracy achieved, or how the strongly correlated fragment was chosen or sized, and none of that was checked or repeated for this record. The description of VQE-in-DFT as a promising approach, and the claim that the developments will benefit drug design and the study of metalloenzymes, are the authors' own framing and expectation for future work, not a demonstrated result for either application; nothing here establishes that the method has been applied to drug design or to a metalloenzyme system. Projection-based embedding is stated to combine VQE with DFT and to not be limited to VQE, but the abstract does not say what else it composes with, so this record makes no claim about any other combination.",
    caveatJa:
      "本項目は文献に基づく記録です。ここでは何も構築・コンパイル・シミュレーション・実行しておらず、いかなる分子もシミュレートしていません。本記録は要旨が述べるとおりにアルゴリズムを記載したものであり、Classiq の実演を再現または検証したものではありません。本記録のために参照した索引項目 applications/chemistry/projection_based_embedding は、そのディレクトリのパスと単一のファイル projected_based_embedding_tutorial.ipynb を与えるのみで、その中身については何も示していません。要旨は、射影に基づく埋め込み手法についても、VQE-in-DFT についても、報告されている実機での実行についても、コスト・実行時間・量子ビット数・ゲート数・高速化のいずれも述べていないため、上記には何も記載しておらず、本記録はこの手法について独自の効率性やスケーリングの主張も行いません。ブチロニトリルの三重結合解離のシミュレーションを実機の量子デバイス上で行ったというのは論文自身が報告する実験であり、要旨は使用した装置、量子ビット数、達成された精度、強相関フラグメントをどのように選び大きさを定めたかのいずれも述べておらず、本記録のために検証も再現もしていません。VQE-in-DFT を有望な手法とする記述、および今後の開発が創薬設計や金属酵素の研究に役立つだろうという主張は、著者ら自身の見方と今後の展望であって、いずれかの応用について実際に示された結果ではありません。本記録は、この手法が創薬設計や金属酵素系に実際に適用されたことを示すものではありません。射影に基づく埋め込みは VQE と DFT を組み合わせ、VQE に限定されないと述べられていますが、要旨は他に何と組み合わせられるかを述べていないため、本記録は他のいかなる組み合わせについても主張しません。",
    tags: ["variational quantum eigensolver", "quantum embedding", "density functional theory", "strongly correlated systems", "quantum chemistry"],
    source: {
      id: "arxiv:2302.03052",
      title: "Quantum Embedding Method for the Simulation of Strongly Correlated Systems on Quantum Computers",
      authors: "Max Rossmannek, Fabijan Pavošević, Angel Rubio, Ivano Tavernelli",
      year: "2023",
      url: "https://arxiv.org/abs/2302.03052",
    },
    literature: [
      {
        title: "Quantum Embedding Method for the Simulation of Strongly Correlated Systems on Quantum Computers",
        authors: "Max Rossmannek, Fabijan Pavošević, Angel Rubio, Ivano Tavernelli",
        year: "2023",
        url: "https://arxiv.org/abs/2302.03052",
        relevance:
          "Primary source: it states the projection-based embedding method for combining VQE with DFT, the resulting VQE-in-DFT method, its implementation on a real quantum device, and its use to simulate triple-bond breaking in butyronitrile. Consult it for the device used, the number of qubits, the accuracy achieved, and how the strongly correlated fragment was selected, none of which the abstract states.",
        relevanceJa:
          "一次資料です。VQE と DFT を組み合わせる射影に基づく埋め込み手法、得られる VQE-in-DFT 手法、実機の量子デバイス上での実装、およびブチロニトリルにおける三重結合解離のシミュレーションへの利用が述べられています。使用した装置、量子ビット数、達成された精度、強相関フラグメントの選び方については要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "vqe-ground-state-energy",
      "vqe-active-space",
      "vqe-orbital-optimized",
      "operator-electronic-structure",
    ],
  },
  {
    slug: "quantum-kernel-fraud-detection",
    title: "Quantum kernel anomaly detection for credit card fraud",
    titleJa: "量子カーネルによる異常検知を用いたクレジットカード不正検知",
    family: "Quantum machine learning",
    classiqPath: "applications/finance/credit_card_fraud",
    classiqCategory: "applications",
    classiqGroup: "finance",
    classiqName: "credit_card_fraud",
    problem:
      "Detect anomalous, potentially fraudulent, transactions in a credit-card dataset, framed as an anomaly-detection task and compared against classical kernel-based benchmarks such as one-class support vector machines.",
    problemJa:
      "クレジットカードのデータセットにおける異常(不正)な取引を検出する問題です。異常検知タスクとして定式化され、one-class サポートベクターマシンなどのカーネルに基づく古典的なベンチマークと比較されています。",
    idea:
      "Kyriienko and Magnusson develop quantum protocols for anomaly detection and apply them to credit card fraud detection. They first establish classical benchmarks from supervised and unsupervised machine learning methods, choosing average precision as their metric for detecting anomalous data, and focus on kernel-based approaches — basing their unsupervised modelling on one-class support vector machines (OC-SVM) — for ease of direct comparison to the quantum protocols. They then employ quantum kernels of different type for the same anomaly-detection task, and report that quantum fraud detection can challenge equivalent classical protocols as the number of features grows, where the number of features equals the number of qubits used for data embedding. Running simulations with registers up to 20 qubits, they find that quantum kernels with a re-uploading structure give better average precision than the classical benchmarks, with the advantage increasing with system size, reaching a quantum-classical separation of 15% in average precision at 20 qubits. The authors discuss the prospects of fraud detection on near- and mid-term quantum hardware and describe possible future improvements.",
    ideaJa:
      "Kyriienko と Magnusson は、異常検知のための量子プロトコルを開発し、それをクレジットカードの不正検知に適用しています。まず、教師あり・教師なし機械学習手法に基づく古典的なベンチマークを確立し、異常データを検出するための頑健な指標として average precision を選んでいます。彼らはカーネルに基づく手法に焦点を当て、教師なしモデリングを one-class サポートベクターマシン(OC-SVM)に基づかせることで、量子プロトコルとの直接比較を容易にしています。続いて、同じ異常検知タスクに対して異なる種類の量子カーネルを用い、特徴量の数(データ埋め込みに用いる量子ビット数に等しい)が増えるにつれて、量子的な不正検知が同等の古典的プロトコルに対抗しうると報告しています。最大20量子ビットのレジスタでシミュレーションを行った結果、再アップロード構造を持つ量子カーネルは古典的なベンチマークよりも良い average precision を示し、その優位性はシステムの規模とともに増大し、20量子ビットにおいて average precision で15%の量子・古典間の分離に達したと報告しています。著者らは、近未来ないし中期的な量子ハードウェアによる不正検知の展望について論じ、今後の改善の可能性についても述べています。",
    complexity: "",
    complexityBasis:
      'The abstract of arXiv:2208.01203, the only source read for this record, states no computational complexity bound anywhere in it — no query count, no gate count, no circuit depth, and no asymptotic scaling in the number of qubits or features. Its quantitative content is a simulated statistical-performance result, not a complexity bound: "Performing simulations with registers up to 20 qubits, we find that quantum kernels with re-uploading demonstrate better average precision, with the advantage increasing with system size." The same abstract adds, "Specifically, at 20 qubits we reach the quantum-classical separation of average precision being equal to 15%." Average precision is a classification-quality metric, not a running-time or resource bound, so it is not recorded in the complexity field. The abstract\'s only complexity-flavored remark is qualitative and unquantified: it observes that quantum FD "can challenge equivalent classical protocols at increasing number of features (equal to the number of qubits for data embedding)" without stating a rate, an exponent, or any other scaling expression. The Classiq index entry for applications/finance/credit_card_fraud gives a directory path and a file list (credit_card_fraud.ipynb, credit_card_fraud.qmod) and states no bound either. The complexity field is therefore left empty on purpose.',
    caveat:
      "This is a literature record. Nothing was built, compiled, simulated or run for it, and no fraud-detection model was trained or evaluated; the record documents the algorithm as its abstract states it and does not reproduce or verify the Classiq demonstration. The index entry read for this record, applications/finance/credit_card_fraud, gives that directory path and a file list — credit_card_fraud.ipynb and credit_card_fraud.qmod — and nothing about what those files contain. Every quantitative result in the abstract is from the authors' own simulations, run on classical hardware simulating quantum registers up to 20 qubits, not from any quantum device; the 15% average-precision separation is reported specifically at 20 qubits, and the abstract does not say whether, or how, that separation continues to grow beyond that size, nor does it give a formula for the trend it calls increasing with system size. Average precision is a statistical classification-quality metric on whatever dataset and train/test split the paper used; the abstract does not name the dataset, its size, its class balance, or any other detail needed to judge how the 15% figure would transfer to a different fraud dataset. The abstract states no computational complexity for either the classical or quantum protocol — no query count, no circuit depth, no training cost, no gate count — so nothing here bounds what either approach costs to run, only what accuracy metric one produced in the reported simulation. The comparison to classical protocols is against the authors' own classical benchmarks, built from supervised and unsupervised machine learning methods with one-class support vector machines representing the unsupervised case, not a canonical or independently chosen baseline. The abstract discusses prospects for near- and mid-term quantum hardware only as a discussion of prospects, not as a report that fraud detection was run on such hardware, and no hardware run of any kind is claimed by it or was performed for this record.",
    caveatJa:
      "本項目は文献に基づく記録です。ここでは何も構築・コンパイル・シミュレーション・実行しておらず、いかなる不正検知モデルも学習・評価していません。本記録は要旨が述べるとおりにアルゴリズムを記載したものであり、Classiq の実演を再現または検証したものではありません。本記録のために参照した索引項目 applications/finance/credit_card_fraud は、そのディレクトリのパスとファイル一覧—credit_card_fraud.ipynb と credit_card_fraud.qmod—を与えるのみで、それらのファイルの中身については何も示していません。要旨にあるすべての数値結果は、量子デバイスではなく、最大20量子ビットのレジスタを古典計算機上でシミュレートした著者ら自身のシミュレーションによるものです。15%という average precision の分離は20量子ビットにおいて具体的に報告された値であり、要旨はその分離が20量子ビットを超えてどのように、あるいはどの程度増え続けるのかを述べておらず、「システムの規模とともに増大する」という傾向の式も与えていません。average precision は、論文が用いたデータセットと訓練・テストの分割における統計的な分類品質の指標であり、要旨はデータセットの名称、大きさ、クラスの偏りなど、15%という数値が別の不正検知データセットにどの程度当てはまるかを判断するために必要な情報を何も示していません。要旨は古典側・量子側いずれのプロトコルについても計算量、すなわちクエリ数、回路深さ、学習コスト、ゲート数のいずれも述べていないため、本記録は両者の実行コストについて何も束縛せず、報告されたシミュレーションでどの精度指標が得られたかのみを記しています。古典的プロトコルとの比較は、教師あり・教師なし機械学習手法から構築された著者ら自身の古典的ベンチマークとの比較であり、one-class サポートベクターマシンが教師なしの場合を代表しているにすぎず、標準的あるいは独立に選ばれた基準ではありません。要旨が近未来・中期的な量子ハードウェアについて論じているのはあくまで展望としての議論であって、そうしたハードウェア上で不正検知を実行したという報告ではなく、いかなる種類のハードウェア実行も本記録では主張しておらず、本記録のためにも行っていません。",
    tags: ["quantum kernel", "anomaly detection", "fraud detection", "quantum machine learning", "one-class svm"],
    source: {
      id: "arxiv:2208.01203",
      title: "Unsupervised quantum machine learning for fraud detection",
      authors: "Oleksandr Kyriienko, Einar B. Magnusson",
      year: "2022",
      url: "https://arxiv.org/abs/2208.01203",
    },
    literature: [
      {
        title: "Unsupervised quantum machine learning for fraud detection",
        authors: "Oleksandr Kyriienko, Einar B. Magnusson",
        year: "2022",
        url: "https://arxiv.org/abs/2208.01203",
        relevance:
          "Primary source: it describes the classical benchmarks (supervised and unsupervised methods including OC-SVM), the quantum-kernel protocols including re-uploading, and reports the simulated average-precision separation of 15% at 20 qubits. Consult it for the dataset used, the specific quantum kernels compared, the circuit constructions, and any results beyond 20 simulated qubits, none of which the abstract states.",
        relevanceJa:
          "一次資料です。教師あり・教師なし手法(OC-SVM を含む)による古典的ベンチマーク、再アップロードを含む量子カーネルのプロトコル、および20量子ビットにおける15%という average precision の分離のシミュレーション結果が述べられています。使用したデータセット、比較された具体的な量子カーネル、回路の構成、20量子ビットを超える結果については要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["quantum-kernel-svm", "benchmark-phase-feature-map-8q", "option-pricing-amplitude-estimation"],
  },
  {
    slug: "derivative-pricing-resource-threshold",
    title: "Resource threshold for quantum advantage in derivative pricing",
    titleJa: "デリバティブ価格付けにおける量子優位性のための資源閾値",
    family: "Amplitude estimation",
    classiqPath: "applications/finance/autocallable_options",
    classiqCategory: "applications",
    classiqGroup: "finance",
    classiqName: "autocallable_options",
    problem:
      "Bound the quantum-computing resources a fault-tolerant quantum computer would need to price derivatives — autocallable and Target Accrual Redemption Forward (TARF) instruments serving as the paper's benchmark use cases — at a scale offering a quantum advantage over classical pricing.",
    problemJa:
      "フォールトトレラント量子計算機がデリバティブ—本論文のベンチマーク対象となるオートコーラブル商品と Target Accrual Redemption Forward(TARF)商品—を、古典的手法に対して量子優位性をもたらす規模で価格付けするために必要となる計算資源を見積もる問題です。",
    idea:
      "Chakrabarti, Krishnakumar, Mazzola, Stamatopoulos, Woerner and Zeng give an upper bound on the resources required for valuable quantum advantage in pricing derivatives, presenting what they describe as the first complete resource estimates for useful quantum derivative pricing. They use autocallable and Target Accrual Redemption Forward (TARF) derivatives together as their benchmark use cases. The authors report uncovering blocking challenges in known approaches to quantum derivative pricing, and introduce a new method they call the re-parameterization method to avoid them, which combines pre-trained variational circuits with fault-tolerant quantum computing to, in their words, dramatically reduce resource requirements. For the benchmark use cases they examine — autocallable and TARF derivatives together, without the abstract stating a separate figure for either instrument alone — they report a requirement of 8k logical qubits and a T-depth of 54 million, and estimate that reaching quantum advantage would require executing that program at the order of a second. The authors state that these resource requirements are out of reach of current systems, and offer them as a roadmap for further improvements in algorithms, implementations and planned hardware architectures.",
    ideaJa:
      "Chakrabarti、Krishnakumar、Mazzola、Stamatopoulos、Woerner、Zeng は、デリバティブの価格付けにおいて価値のある量子優位性を得るために必要な資源の上界を示し、有用な量子デリバティブ価格付けについて初めての完全な資源見積りであると述べています。彼らはオートコーラブル商品と Target Accrual Redemption Forward(TARF)商品を合わせてベンチマーク対象として用いています。著者らは、既知の手法における障壁となる課題を明らかにしたと報告し、それらを回避する新しい手法として再パラメータ化法(re-parameterization method)を導入しています。この手法は、事前学習された変分回路とフォールトトレラント量子計算を組み合わせることで、彼らの言葉で言えば資源要件を劇的に削減します。検討したベンチマーク対象—オートコーラブル商品と TARF 商品を合わせたもの、要旨はいずれか一方の商品単独の数値を示していません—について、8千の論理量子ビットと5400万の T-深さが必要であると報告し、量子優位性に到達するにはこのプログラムを1秒程度のオーダーで実行する必要があると見積もっています。著者らは、ここで示した資源要件は現行のシステムでは手が届かないものであると述べつつ、これらがアルゴリズム・実装・計画されているハードウェアアーキテクチャのさらなる改善への道筋となることを期待すると述べています。",
    complexity:
      "8k logical qubits and a T-depth of 54 million, and execution at the order of a second to reach quantum advantage, reported by the abstract for the benchmark use cases the paper examines — autocallable and Target Accrual Redemption Forward (TARF) derivatives together. The abstract states this figure for the two benchmark use cases jointly and does not disaggregate it between the two derivative types, so it is not stated here as a resource bound specific to autocallable options alone.",
    complexityBasis:
      'The abstract of arXiv:2012.03819 states: "We find that the benchmark use cases we examine require 8k logical qubits and a T-depth of 54 million." The benchmark use cases are named earlier in the same abstract: "we give the first complete resource estimates for useful quantum derivative pricing, using autocallable and Target Accrual Redemption Forward (TARF) derivatives as benchmark use cases". The abstract does not state the 8k logical qubits and T-depth of 54 million separately for autocallable pricing and separately for TARF pricing, and does not say whether the figure is a total, a maximum, or a per-instrument number; it is stated once, for the benchmark use cases the paper examines as a set. The abstract also states: "We estimate that quantum advantage would require executing this program at the order of a second." The Classiq index entry for applications/finance/autocallable_options gives a directory path and a file list (partial_exponential_state_preparation.ipynb, partial_exponential_state_preparation.qmod, quantum_autocallable_option_pricing.ipynb, quantum_autocallable_option_pricing.qmod) and states no bound. Because the abstract\'s resource figure is not disaggregated between the two benchmark use cases, this record reports it as covering both together rather than assigning it to autocallable pricing specifically.',
    caveat:
      "This is a literature record. Nothing was built, compiled, simulated or run for it, and no derivative was priced; the record documents the algorithm and its resource estimate as the abstract states them and does not reproduce or verify the Classiq demonstration. The index entry read for this record, applications/finance/autocallable_options, gives that directory path and a file list — partial_exponential_state_preparation.ipynb, partial_exponential_state_preparation.qmod, quantum_autocallable_option_pricing.ipynb and quantum_autocallable_option_pricing.qmod — and nothing about what those files contain. The single resource figure the abstract states, 8k logical qubits and a T-depth of 54 million, is reported for the benchmark use cases the paper examines as a set — autocallable and Target Accrual Redemption Forward (TARF) derivatives together — and the abstract does not say whether that figure is a total across both instruments, a shared maximum, or specific to one of them; this record therefore does not claim it as the resource cost of pricing an autocallable option on its own, and a reader who needs an autocallable-specific figure, if the paper reports one, must consult the paper rather than this record. The 8k qubits and T-depth of 54 million are themselves resource estimates from designing and compiling the re-parameterization method, not a measurement on hardware or in a full circuit simulation; the abstract states plainly that these resource requirements are out of reach of current systems. The estimate that quantum advantage would require executing the program at the order of a second is likewise the authors' own estimate of a threshold, not an achieved runtime, and the abstract does not state what classical baseline or market-data assumptions that threshold is compared against, what pricing model or contract parameters (maturity, number of underlying assets, strike or barrier levels) were assumed, or what error tolerance the estimate targets. The re-parameterization method is described as combining pre-trained variational circuits with fault-tolerant quantum computing; the abstract does not state the cost of that pre-training, the classical resources it requires, or how it was validated. The paper's framing as an upper bound on required resources, and the claim that the method dramatically reduces resource requirements, are comparisons against the known approaches the authors identify as blocked, not proofs that no cheaper quantum method exists.",
    caveatJa:
      "本項目は文献に基づく記録です。ここでは何も構築・コンパイル・シミュレーション・実行しておらず、いかなるデリバティブも価格付けしていません。本記録は要旨が述べるとおりにアルゴリズムとその資源見積りを記載したものであり、Classiq の実演を再現または検証したものではありません。本記録のために参照した索引項目 applications/finance/autocallable_options は、そのディレクトリのパスとファイル一覧—partial_exponential_state_preparation.ipynb、partial_exponential_state_preparation.qmod、quantum_autocallable_option_pricing.ipynb、quantum_autocallable_option_pricing.qmod—を与えるのみで、それらのファイルの中身については何も示していません。要旨が示す唯一の資源数値、すなわち8千の論理量子ビットと5400万の T-深さは、論文が検討するベンチマーク対象、すなわちオートコーラブル商品と Target Accrual Redemption Forward(TARF)商品をまとめて指したものとして報告されており、要旨はこの数値が両商品を合計したものなのか、両者に共通する最大値なのか、あるいはどちらか一方に固有のものなのかを述べていません。したがって本記録は、この数値をオートコーラブルオプション単独の価格付けコストとして主張するものではなく、オートコーラブルに固有の数値が論文にあるとしても、それを必要とする読者は本記録ではなく原論文を参照する必要があります。8千量子ビットと5400万の T-深さそのものも、再パラメータ化法を設計・コンパイルしたことによる資源見積りであって、実機での測定や完全な回路シミュレーションによるものではなく、要旨はこれらの資源要件が現行のシステムでは手が届かないものであるとはっきり述べています。量子優位性に到達するにはこのプログラムを1秒程度のオーダーで実行する必要があるという見積りも、同じく著者ら自身によるしきい値の見積りであって達成された実行時間ではなく、要旨は、その閾値がどの古典的な基準や市場データの前提と比較されているのか、どのような価格付けモデルや契約条件(満期、原資産の数、権利行使価格やバリア水準)が仮定されているのか、どの誤差許容度を目標としているのかを述べていません。再パラメータ化法は事前学習された変分回路とフォールトトレラント量子計算を組み合わせるものと説明されていますが、要旨はその事前学習のコスト、それに要する古典的資源、あるいはどのように検証されたかを述べていません。必要資源の上界であるという論文の位置づけや、この手法が資源要件を劇的に削減するという主張は、著者らが障壁があるとみなした既知の手法との比較であって、それより安価な量子的手法が存在しないことの証明ではありません。",
    tags: ["derivative pricing", "resource estimation", "fault-tolerant quantum computing", "variational circuits", "autocallable options"],
    source: {
      id: "arxiv:2012.03819",
      title: "A Threshold for Quantum Advantage in Derivative Pricing",
      authors: "Shouvanik Chakrabarti, Rajiv Krishnakumar, Guglielmo Mazzola, Nikitas Stamatopoulos, Stefan Woerner, William J. Zeng",
      year: "2020",
      url: "https://arxiv.org/abs/2012.03819",
    },
    literature: [
      {
        title: "A Threshold for Quantum Advantage in Derivative Pricing",
        authors: "Shouvanik Chakrabarti, Rajiv Krishnakumar, Guglielmo Mazzola, Nikitas Stamatopoulos, Stefan Woerner, William J. Zeng",
        year: "2020",
        url: "https://arxiv.org/abs/2012.03819",
        relevance:
          "Primary source: it states the re-parameterization method combining pre-trained variational circuits with fault-tolerant quantum computing, names autocallable and TARF derivatives as its benchmark use cases, and reports the 8k logical qubit / 54 million T-depth resource estimate and the order-of-a-second execution estimate for quantum advantage. Consult it for the resource figures broken out (if given) by derivative type, the pricing models and contract parameters assumed, the pre-training cost, and the classical baseline the advantage threshold is compared against, none of which the abstract states.",
        relevanceJa:
          "一次資料です。事前学習された変分回路とフォールトトレラント量子計算を組み合わせる再パラメータ化法、ベンチマーク対象としてのオートコーラブル商品と TARF 商品、8千論理量子ビット・5400万 T-深さという資源見積り、および量子優位性のための1秒程度のオーダーという実行時間の見積りが述べられています。商品種別ごとの資源数値の内訳(示されている場合)、想定されている価格付けモデルや契約条件、事前学習のコスト、優位性のしきい値が比較されている古典的基準については要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "option-pricing-amplitude-estimation",
      "amplitude-estimation",
      "amplitude-amplification",
      "vqe-hardware-efficient-ansatz",
    ],
  },
  {
    slug: "adapt-qaoa",
    title: "ADAPT-QAOA: an iterative, problem-tailored QAOA",
    titleJa: "ADAPT-QAOA：反復的で問題適応型のQAOA",
    family: "QAOA",
    classiqPath: "applications/optimization/adapt_qaoa",
    classiqCategory: "applications",
    classiqGroup: "optimization",
    classiqName: "adapt_qaoa",
    problem:
      "Find a better parameterized ansatz for the quantum approximate optimization algorithm (QAOA) applied to combinatorial optimization problems such as Max-Cut, where the standard, fixed-form QAOA ansatz is not known to be optimal and no systematic method exists for improving on it.",
    problemJa:
      "MaxCutなどの組合せ最適化問題に量子近似最適化アルゴリズム（QAOA）を適用する際、標準的な固定形式のQAOAアンサッツが最適であるとは限らず、それを改善する体系的な方法も存在しないという状況で、より良いパラメータ化されたアンサッツを見つける問題です。",
    idea:
      "Zhu, Tang, Barron, Calderon-Vargas, Mayhall, Barnes and Economou address the fixed, potentially suboptimal form of the standard QAOA ansatz by developing an iterative version of QAOA that is problem-tailored and that can also be adapted to specific hardware constraints. Rather than fixing the ansatz's structure in advance, their algorithm builds it up step by step for the specific problem instance being solved. The authors simulate the algorithm on a class of Max-Cut graph problems and report that it converges much faster than the standard QAOA, while simultaneously reducing the required number of CNOT gates and optimization parameters. They connect this improvement to the concept of shortcuts to adiabaticity, and state that they provide evidence for that connection rather than a proof of it. The abstract frames the underlying motivation as addressing a documented gap: evidence that the standard ansatz is not optimal, without a systematic approach existing for finding a better one.",
    ideaJa:
      "Zhu、Tang、Barron、Calderon-Vargas、Mayhall、Barnes、Economou は、標準的なQAOAアンサッツが固定された形式を持ち最適でない可能性があるという問題に対し、問題に合わせて調整され、特定のハードウェア制約にも適応できる反復的なQAOAを開発することで対応しています。アンサッツの構造をあらかじめ固定するのではなく、彼らのアルゴリズムは解こうとしている個々の問題例に応じて段階的にそれを構築します。著者らはこのアルゴリズムを一群のMaxCutグラフ問題についてシミュレートし、標準的なQAOAよりもはるかに速く収束し、同時に必要なCNOTゲート数と最適化パラメータ数を削減すると報告しています。著者らはこの改善を断熱過程への近道（shortcuts to adiabaticity）という概念と結び付けていますが、これは証明ではなく、その関連性についての証拠を提示すると述べています。要旨は根底にある動機を、標準アンサッツが最適でないという証拠はあるが、それを改善する体系的な方法は存在しないという、明示された空白に対応するものとして述べています。",
    complexity: "",
    complexityBasis:
      'The abstract of arXiv:2005.10258, the only source read for this record, states no complexity expression, no qubit count and no formal speedup bound. Its performance claim is comparative and empirical: "We simulate the algorithm on a class of Max-Cut graph problems and show that it converges much faster than the standard QAOA, while simultaneously reducing the required number of CNOT gates and optimization parameters." The word "speedup" used elsewhere in the abstract names this same convergence comparison, not a proven separation from any classical or standard-QAOA running-time bound: "We provide evidence that this speedup is connected to the concept of shortcuts to adiabaticity." No number of gates, parameters, graphs or qubits is quoted anywhere in the abstract, and the comparison throughout is to "the standard QAOA" on the graph class simulated, not to a stated general bound. The Classiq index entry this record covers, applications/optimization/adapt_qaoa, gives a directory path and a file list and states no bound. The field is left empty on purpose rather than filled with a bound written from memory.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it, and no Max-Cut instance was solved here; the record documents the algorithm as its paper states it and does not reproduce or verify the Classiq demonstration at applications/optimization/adapt_qaoa, which the index gives here only as that directory path and a file list, adapt_qaoa.ipynb and adapt_qaoa.qmod, with nothing about their contents. The abstract's central finding is a comparison, not a proven bound: the iterative algorithm is reported to converge much faster than the standard QAOA on the simulated instances, which is a claim about fewer optimization iterations to convergence, not a proven separation in any complexity class, and the comparison is qualitative — the abstract quotes no iteration count, no number of graphs, no graph size, and no running time for either algorithm. The reduction in the number of CNOT gates and optimization parameters is likewise a comparison against the standard QAOA ansatz on the same problems, with no gate count or parameter count given as a number. Everything reported was simulated, on a class of Max-Cut graph problems, so this is the paper's own simulation, at whatever scale the paper used, not repeated or checked here; the abstract does not say how many qubits or how many graph instances were simulated. The abstract calls the improvement a speedup and connects it to the concept of shortcuts to adiabaticity, but frames that connection as evidence the paper provides, not as a theorem. Nothing here establishes that the iterative ansatz outperforms the standard ansatz outside the Max-Cut graph class simulated, that it scales favorably as the problem grows, or that it succeeds on any hardware; the abstract states no hardware experiment and this record reports none.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで回路を構成・コンパイル・シミュレーション・実行したことはなく、具体的なMaxCut問題例も解いていません。本項目は論文が述べるアルゴリズムを記録したものであり、Classiq の applications/optimization/adapt_qaoa における実演を再現・検証するものではありません。ここで参照した索引項目が与えるのは当該ディレクトリのパスとファイルの一覧（adapt_qaoa.ipynb と adapt_qaoa.qmod）だけであり、それらの中身については何も分かりません。要旨の中心的な知見は比較であって、証明された上界・下界ではありません。反復的なアルゴリズムはシミュレートされた事例において標準的なQAOAよりもはるかに速く収束すると報告されていますが、これは収束までの最適化の反復回数が少ないという主張であって、いかなる計算量クラスにおいても証明された分離ではなく、比較は定性的なものです。要旨には反復回数、グラフの数、グラフの規模、いずれのアルゴリズムについても実行時間の数値は示されていません。CNOTゲート数と最適化パラメータ数の削減も同様に、同じ問題に対する標準的なQAOAアンサッツとの比較であり、ゲート数やパラメータ数が具体的な数値として示されているわけではありません。報告されているのはすべて一群のMaxCutグラフ問題に対するシミュレーションであり、これは論文自身が用いた規模でのシミュレーションであって、本項目のために再実行・検証したものではありません。要旨は何量子ビットを用いたか、何個のグラフ事例をシミュレートしたかも述べていません。要旨はこの改善を「speedup」と呼び、断熱過程への近道という概念と結び付けていますが、これは論文が提示する証拠として位置づけられており、定理としてではありません。本項目は、シミュレートされたMaxCutグラフのクラスを超えて反復的なアンサッツが標準的なアンサッツより優れていること、問題規模が大きくなっても良好にスケールすること、あるいはいかなる実機上でも成功することを何ら示していません。要旨は実機での実験について何も述べておらず、本項目もそのような実験を報告していません。",
    tags: ["QAOA", "adaptive ansatz", "combinatorial optimization", "max-cut", "shortcuts to adiabaticity"],
    source: {
      id: "arxiv:2005.10258",
      title:
        "An adaptive quantum approximate optimization algorithm for solving combinatorial problems on a quantum computer",
      authors:
        "Linghua Zhu, Ho Lun Tang, George S. Barron, F. A. Calderon-Vargas, Nicholas J. Mayhall, Edwin Barnes, Sophia E. Economou",
      year: "2020",
      url: "https://arxiv.org/abs/2005.10258",
    },
    literature: [
      {
        title:
          "An adaptive quantum approximate optimization algorithm for solving combinatorial problems on a quantum computer",
        authors:
          "Linghua Zhu, Ho Lun Tang, George S. Barron, F. A. Calderon-Vargas, Nicholas J. Mayhall, Edwin Barnes, Sophia E. Economou",
        year: "2020",
        url: "https://arxiv.org/abs/2005.10258",
        relevance:
          "Primary source: it develops the iterative, problem-tailored QAOA ansatz, reports from simulation on a class of Max-Cut graph problems that it converges much faster than the standard QAOA while reducing the required CNOT gate and parameter counts, and connects the improvement to shortcuts to adiabaticity. Consult it for the ansatz-growing procedure itself, the graph instances and sizes simulated, and the numerical results the abstract does not quote.",
        relevanceJa:
          "一次資料です。反復的で問題に合わせて調整されたQAOAアンサッツを開発し、一群のMaxCutグラフ問題についてのシミュレーションから、標準的なQAOAよりもはるかに速く収束し、必要なCNOTゲート数とパラメータ数を削減すると報告し、この改善を断熱過程への近道と結び付けています。アンサッツを段階的に構築する手順そのもの、シミュレートされたグラフの事例と規模、要旨が数値として示していない結果については原論文で確認してください。",
      },
    ],
    relatedSlugs: ["vqe-adapt", "vqe-qubit-adapt", "qaoa-maxcut-ring", "operator-maxcut-cost"],
  },
  {
    slug: "qaoa-in-qaoa",
    title: "QAOA-in-QAOA (QAOA²) for large-scale MaxCut",
    titleJa: "大規模MaxCutのためのQAOA-in-QAOA（QAOA²）",
    family: "QAOA",
    classiqPath: "applications/optimization/qaoa_in_qaoa",
    classiqCategory: "applications",
    classiqGroup: "optimization",
    classiqName: "qaoa_in_qaoa",
    problem:
      "Solve large-scale Maximum Cut (MaxCut) problems on near-term quantum hardware by decomposing the graph into many subgraph problems that can be solved in parallel, and determine how such a decomposition compares to a purely classical alternative for the same task.",
    problemJa:
      "大規模な最大カット（MaxCut）問題を、グラフを並列に解ける多数の部分グラフ問題へと分割することによって近未来の量子ハードウェア上で解き、この分割手法が同じ課題に対する純粋に古典的な代替手法とどのように比較されるかを明らかにする問題です。",
    idea:
      "Esposito and Danzig present an implementation of QAOA-in-QAOA (QAOA²), a divide-and-conquer heuristic that solves large-scale MaxCut problems by splitting the graph into many subgraph problems that can be solved in parallel, each still handled by QAOA. Their implementation is built on the Classiq platform and is executed on an HPE-Cray EX supercomputer, using the Message Passing Interface (MPI) and the SLURM workload manager to run the framework at scale. Alongside the quantum route, the authors investigate the limits of the Goemans-Williamson (GW) algorithm as a purely classical alternative to QAOA, to see whether QAOA² could benefit from solving certain sub-graphs classically instead. They report results from large-scale simulations of up to 33 qubits, which they say show the advantage of QAOA in certain cases, the efficiency of their implementation, and the adequacy of the workflow for preparing real quantum devices. For the graphs they considered, however, the authors report that the best choice of sub-graphs does not significantly improve results and is still outperformed by GW.",
    ideaJa:
      "Esposito と Danzig は、QAOA-in-QAOA（QAOA²）という分割統治型のヒューリスティックの実装を示しています。これは、グラフを並列に解ける多数の部分グラフ問題に分割し、各部分問題を引き続きQAOAで扱うことで大規模なMaxCut問題を解く手法です。彼らの実装はClassiqのプラットフォーム上に構築されており、Message Passing Interface（MPI）とSLURMワークロードマネージャを用いてHPE-Cray EXスーパーコンピュータ上でこの枠組みを大規模に実行しています。量子的な手法と並行して、著者らは、Goemans-Williamson（GW）アルゴリズムをQAOAに対する純粋に古典的な代替手法として、その限界を調査し、QAOA²が一部の部分グラフを古典的に解くことで恩恵を受けられるかどうかを検討しています。著者らは最大33量子ビットの大規模シミュレーションの結果を報告しており、これらの結果はある場合にはQAOAの優位性を示し、実装の効率性、そして実機の量子デバイスに向けたワークフローの妥当性を示すものであると述べています。しかし、対象としたグラフについては、部分グラフの最良の選び方でも結果は有意には改善せず、依然としてGWに劣ると著者らは報告しています。",
    complexity: "",
    complexityBasis:
      'The abstract of arXiv:2406.17383, the only source read for this record, states no complexity expression, no big-O bound and no formal speedup. Its scale and outcome statements are both empirical, from simulation: "Results from large-scale simulations of up to 33 qubits are presented, showing the advantage of QAOA in certain cases and the efficiency of the implementation, as well as the adequacy of the workflow in the preparation of real quantum devices." Its comparison against the classical alternative is stated for the specific graphs studied, not as a general bound: "For the considered graphs, the best choice for the sub-graphs does not significantly improve results and is still outperformed by GW." GW is fixed earlier in the same abstract as "the Goemans-Williamson (GW) algorithm as a purely classical alternative to QAOA". No qubit count is given for any single subgraph, no runtime is quoted for either the quantum or the classical route, and no scaling law is stated in the number of qubits, subgraphs, or graph size. The Classiq index entry this record covers, applications/optimization/qaoa_in_qaoa, gives a directory path and a file list and states no bound. The field is left empty on purpose rather than filled with a bound written from memory.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it, and no MaxCut instance was solved here; the record documents the method as its paper states it and does not reproduce or verify the Classiq demonstration at applications/optimization/qaoa_in_qaoa, which the index gives here only as that directory path and a file list, qaoa_in_qaoa.ipynb and qaoa_in_qaoa.qmod, with nothing about their contents. The paper's own abstract states that its implementation is built on the Classiq platform and run on an HPE-Cray EX supercomputer; that is a fact about the cited paper's reported method, not a description of what the pinned notebook and Qmod file in this directory contain or do, which remains unknown here. Everything the abstract reports was reached by the paper's own large-scale simulations, at whatever configurations the paper used, and none of it was repeated, rerun, or checked for this record. The up to 33 qubits figure is the largest scale the abstract reports reaching in those simulations, not a bound that holds at every scale, and it is not broken down by how many qubits any single subgraph used; the abstract quotes no runtime, no qubit count for a single QAOA call, and no gate or circuit-depth figure for either the quantum or the classical route. Both outcome statements in the abstract are comparisons from the paper's own simulated results, not proven bounds: the advantage of QAOA in certain cases is stated only for cases the paper does not enumerate in the abstract, and the finding that, for the considered graphs, the best choice of sub-graphs does not significantly improve results and is still outperformed by the classical Goemans-Williamson algorithm is a comparison against that specific classical algorithm on those specific graphs, not a general statement about QAOA versus classical MaxCut solvers. Nothing here reruns that comparison, checks which graphs were considered, or extends the finding to any other graph, solver, or scale. The abstract also mentions the adequacy of the workflow in the preparation of real quantum devices; that is preparation, and the abstract does not say the framework was executed on a quantum device, so this record does not either.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで回路を構成・コンパイル・シミュレーション・実行したことはなく、具体的なMaxCut問題例も解いていません。本項目は論文が述べる手法を記録したものであり、Classiq の applications/optimization/qaoa_in_qaoa における実演を再現・検証するものではありません。ここで参照した索引項目が与えるのは当該ディレクトリのパスとファイルの一覧（qaoa_in_qaoa.ipynb と qaoa_in_qaoa.qmod）だけであり、それらの中身については何も分かりません。論文自身の要旨は、その実装がClassiqのプラットフォーム上に構築され、HPE-Cray EXスーパーコンピュータ上で実行されたと述べていますが、これは引用した論文が報告する手法についての事実であって、このディレクトリに置かれたノートブックとQmodファイルの中身がどのようなものかを説明するものではなく、それらは本項目にとって依然として不明です。要旨が報告する内容はすべて、論文自身が行った大規模シミュレーションによって得られたものであり、論文が用いた構成において得られたものです。そのいずれも本項目のために再実行・追試・検証したものではありません。「最大33量子ビット」という数値は、それらのシミュレーションの中で到達した最大の規模であり、あらゆる規模で成り立つ上界ではありません。また、個々の部分グラフが何量子ビットを用いたかの内訳も示されていません。要旨には、実行時間、単一のQAOA呼び出しに使われた量子ビット数、量子・古典いずれの手法についてもゲート数や回路深さの数値は一切示されていません。要旨に述べられている2つの結論はいずれも、論文自身のシミュレーション結果からの比較であって証明された上界・下界ではありません。「ある場合にはQAOAに優位性がある」という記述は、要旨では列挙されていない一部の場合についてのみ述べられており、また「対象としたグラフについては、部分グラフの最良の選び方でも結果は有意には改善せず、依然として古典的なGoemans-Williamsonアルゴリズムに劣る」という結果は、その特定の古典アルゴリズムと特定のグラフ集合との比較であって、QAOAと古典的なMaxCutソルバー全般についての一般的な主張ではありません。本項目はこの比較を再実行しておらず、対象とされたグラフが何であったかも確認しておらず、この結果を他のグラフ、他のソルバー、他の規模へ拡張してもいません。要旨はまた、実機の量子デバイスに向けたワークフローの妥当性にも触れていますが、これは準備段階についての記述であり、要旨はこの枠組みが量子デバイス上で実行されたとは述べていないため、本項目もそのようには述べません。",
    tags: ["QAOA", "maxcut", "divide-and-conquer", "goemans-williamson", "large-scale simulation"],
    source: {
      id: "arxiv:2406.17383",
      title: "Hybrid Classical-Quantum Simulation of MaxCut using QAOA-in-QAOA",
      authors: "Aniello Esposito, Tamuz Danzig",
      year: "2024",
      url: "https://arxiv.org/abs/2406.17383",
    },
    literature: [
      {
        title: "Hybrid Classical-Quantum Simulation of MaxCut using QAOA-in-QAOA",
        authors: "Aniello Esposito, Tamuz Danzig",
        year: "2024",
        url: "https://arxiv.org/abs/2406.17383",
        relevance:
          "Primary source: it presents an implementation of QAOA-in-QAOA (QAOA²) for large-scale MaxCut, reports large-scale simulations of up to 33 qubits, and finds that for the graphs it considers, the best choice of sub-graphs does not significantly improve results and is still outperformed by the classical Goemans-Williamson algorithm. Consult it for the decomposition procedure, the graphs and scales tested, and the numerical results the abstract summarizes but does not quote.",
        relevanceJa:
          "一次資料です。大規模なMaxCutのためのQAOA-in-QAOA（QAOA²）の実装を示し、最大33量子ビットの大規模シミュレーションを報告し、対象としたグラフについては部分グラフの最良の選び方でも結果は有意には改善せず、古典的なGoemans-Williamsonアルゴリズムに依然として劣ると結論しています。分割の手順、試験されたグラフと規模、要旨が要約するにとどめている数値結果については原論文で確認してください。",
      },
    ],
    relatedSlugs: ["qaoa-maxcut-ring", "operator-maxcut-cost", "ising-formulations-np-problems", "quantum-simulated-annealing"],
  },
  {
    slug: "low-autocorrelation-binary-sequences-problem",
    title: "QAOA scaling on the low autocorrelation binary sequences (LABS) problem",
    titleJa: "低自己相関二値系列（LABS）問題に対するQAOAのスケーリング",
    family: "QAOA",
    classiqPath: "applications/optimization/low_autocorrelation_binary_sequences_problem",
    classiqCategory: "applications",
    classiqGroup: "optimization",
    classiqName: "low_autocorrelation_binary_sequences_problem",
    problem:
      "Given the low autocorrelation binary sequences (LABS) problem, an optimization problem that is classically intractable even for moderately sized instances, determine whether QAOA can act as an algorithmic component that provides an advantage over the best classical exact solvers.",
    problemJa:
      "低自己相関二値系列（LABS）問題、すなわち規模が中程度であっても古典的に扱いにくい最適化問題に対して、QAOAが最良の古典的厳密解法に対する優位性をもたらすアルゴリズム的な構成要素となりうるかを明らかにする問題です。",
    idea:
      "Shaydulin et al. investigate numerically whether QAOA can tackle classically intractable problems, an open question they say remains unclear despite QAOA's standing as a leading candidate algorithm for optimization on quantum computers. They target the low autocorrelation binary sequences (LABS) problem, which they describe as classically intractable even for moderately sized instances, and run noiseless simulations with up to 40 qubits. From those simulations they observe that the runtime of QAOA with fixed parameters scales better than branch-and-bound solvers, which they identify as the state-of-the-art exact solvers for LABS, and they report that combining QAOA with quantum minimum finding gives the best empirical scaling of any algorithm for the LABS problem that they compare against. Beyond simulation, they report experimental progress executing QAOA for the LABS problem on Quantinuum trapped-ion processors, using an algorithm-specific error detection scheme. They summarize all of this as evidence for the utility of QAOA as an algorithmic component that enables quantum speedups, framing it as evidence rather than as a proof.",
    ideaJa:
      "Shaydulin らは、QAOAが量子計算機における最適化のための有力な候補アルゴリズムとされているにもかかわらず、古典的に扱いにくい問題に対処できるかどうかは依然として不明であると述べ、これを数値的に検証しています。対象としたのは低自己相関二値系列（LABS）問題であり、著者らはこれを、規模が中程度であっても古典的に扱いにくい問題と説明した上で、最大40量子ビットのノイズなしシミュレーションを実行しています。これらのシミュレーションから、固定パラメータを用いたQAOAの実行時間は、LABSに対する最先端の厳密解法であるとする分枝限定法（branch-and-bound）ソルバーよりも良くスケールすると観測したと報告しています。さらに、QAOAと量子最小値探索を組み合わせることで、比較対象としたLABS問題向けのあらゆるアルゴリズムの中で最良の経験的スケーリングが得られると報告しています。シミュレーションにとどまらず、著者らはアルゴリズム固有の誤り検出方式を用いて、Quantinuumのトラップイオン方式プロセッサ上でLABS問題に対しQAOAを実行する実験的な進展も報告しています。著者らはこれらすべてを、QAOAが量子的な高速化を可能にするアルゴリズム的構成要素として有用であることの証拠であるとまとめていますが、これは証明ではなく証拠として位置づけられています。",
    complexity: "",
    complexityBasis:
      'The abstract of arXiv:2308.02342, the only source read for this record, states no complexity expression, no big-O bound and no formula for how the runtime scales; its scaling claims are empirical observations from simulation. It states the task and its classical difficulty as: "we perform an extensive numerical investigation of QAOA on the low autocorrelation binary sequences (LABS) problem, which is classically intractable even for moderately sized instances." Its central runtime claim is: "We perform noiseless simulations with up to 40 qubits and observe that the runtime of QAOA with fixed parameters scales better than branch-and-bound solvers, which are the state-of-the-art exact solvers for LABS." This is a comparison against a named state of the art, not a proven bound on either side, and the abstract names branch-and-bound solvers as that state of the art rather than stating their complexity. A second, related claim is that "The combination of QAOA with quantum minimum finding gives the best empirical scaling of any algorithm for the LABS problem" — again an empirical scaling claim, not a formula, and "best" is relative to the algorithms compared, which the abstract does not enumerate. The abstract separately reports a hardware result: "We demonstrate experimental progress in executing QAOA for the LABS problem using an algorithm-specific error detection scheme on Quantinuum trapped-ion processors." It summarizes all of the above as "evidence for the utility of QAOA as an algorithmic component that enables quantum speedups" — evidence, in the abstract\'s own word, not a proof. No qubit-count formula, no big-O expression, and no constant factor is quoted anywhere in the abstract; the largest simulated size it states is up to 40 qubits. The Classiq index entry this record covers, applications/optimization/low_autocorrelation_binary_sequences_problem, gives a directory path and a file list and states no bound. The field is left empty on purpose rather than filled with a bound written from memory.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it, and no LABS instance was solved here; the record documents the algorithm as its paper states it and does not reproduce or verify the Classiq demonstration at applications/optimization/low_autocorrelation_binary_sequences_problem, which the index gives here only as that directory path and a file list, evidence_scaling_labs.ipynb and evidence_scaling_labs.qmod, with nothing about their contents. The abstract's characterization of the LABS problem as classically intractable even for moderately sized instances is the paper's own framing of the task, not a complexity-theoretic proof carried by this record. The abstract's central claim, that the runtime of QAOA with fixed parameters scales better than branch-and-bound solvers, is a comparison against a named state of the art observed in the paper's own noiseless simulations with up to 40 qubits — the paper's own simulation, at that scale, not repeated or rerun for this record — and it is not a proven complexity bound on QAOA or a proven lower bound on branch-and-bound solvers; the abstract quotes no scaling formula, no exponent, and no constant for either side of that comparison, and does not say at what problem sizes within that 40-qubit range the comparison was observed to hold. The related claim that combining QAOA with quantum minimum finding gives the best empirical scaling of any algorithm for the LABS problem is again empirical and comparative — best among whichever algorithms the paper compared, which the abstract does not enumerate — and empirical is the abstract's own qualifier, not this record's addition. Separately, the abstract reports experimental progress executing QAOA for the LABS problem on Quantinuum trapped-ion processors using an algorithm-specific error detection scheme; that hardware run is likewise the paper's own reported experiment, not repeated or checked here, and progress is the abstract's own word, not a claim that the LABS problem was solved on that hardware at the 40-qubit scale simulated, or at any stated scale. The paper's own summary of its results is that they provide evidence for the utility of QAOA as an algorithmic component that enables quantum speedups; evidence is the abstract's word, and nothing here upgrades it to a proof or to a guaranteed speedup for any instance, size, or hardware beyond what it states.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで回路を構成・コンパイル・シミュレーション・実行したことはなく、LABS問題の具体例も解いていません。本項目は論文が述べるアルゴリズムを記録したものであり、Classiq の applications/optimization/low_autocorrelation_binary_sequences_problem における実演を再現・検証するものではありません。ここで参照した索引項目が与えるのは当該ディレクトリのパスとファイルの一覧（evidence_scaling_labs.ipynb と evidence_scaling_labs.qmod）だけであり、それらの中身については何も分かりません。LABS問題を「規模が中程度であっても古典的に扱いにくい」と特徴づけているのは論文自身の課題設定であり、本項目が担保する計算複雑性理論上の証明ではありません。要旨の中心的な主張、すなわち固定パラメータを用いたQAOAの実行時間が分枝限定法ソルバーよりも良くスケールするという主張は、論文自身が行った最大40量子ビットのノイズなしシミュレーションにおいて観測された、名指しされた最先端手法との比較です。これは論文自身のシミュレーションであり、その規模において得られたものであって、本項目のために再実行・追試したものではありません。また、QAOAについて証明された計算量上界でも、分枝限定法ソルバーについて証明された下界でもありません。要旨はこの比較のいずれの側についてもスケーリングの式も指数も定数も示しておらず、40量子ビットという範囲内のどの問題サイズでこの比較が成り立つと観測されたのかも述べていません。QAOAと量子最小値探索を組み合わせることで、LABS問題向けのあらゆるアルゴリズムの中で最良の経験的スケーリングが得られるという関連する主張も、同様に経験的・比較的なものであり、「最良」とは論文が比較した何らかのアルゴリズム群の中でのことで、それらが何であるかは要旨に列挙されていません。「経験的」という語も論文自身の限定であり、本項目が付け加えたものではありません。これとは別に、要旨はアルゴリズム固有の誤り検出方式を用いてQuantinuumのトラップイオン方式プロセッサ上でLABS問題に対しQAOAを実行する実験的な進展を報告しています。この実機での実行も同様に論文自身が報告する実験であって、本項目のために追試・検証したものではなく、「進展」は要旨自身の語であり、シミュレーションされた40量子ビットの規模で、あるいは他のいかなる規模で、LABS問題がその実機上で解かれたという主張ではありません。論文自身による結果の総括は、QAOAが量子的な高速化を可能にするアルゴリズム的構成要素として有用であることの証拠を提供するというものであり、「証拠」は要旨自身の語です。本項目はこれを証明や、要旨が述べる範囲を超えたいかなる事例・規模・実機における高速化の保証へと格上げするものではありません。",
    tags: ["QAOA", "LABS problem", "branch-and-bound", "quantum minimum finding", "trapped-ion hardware"],
    source: {
      id: "arxiv:2308.02342",
      title:
        "Evidence of Scaling Advantage for the Quantum Approximate Optimization Algorithm on a Classically Intractable Problem",
      authors:
        "Ruslan Shaydulin, Changhao Li, Shouvanik Chakrabarti, Matthew DeCross, Dylan Herman, Niraj Kumar, Jeffrey Larson, Danylo Lykov, Pierre Minssen, Yue Sun, Yuri Alexeev, Joan M. Dreiling, John P. Gaebler, Thomas M. Gatterman, Justin A. Gerber, Kevin Gilmore, Dan Gresh, Nathan Hewitt, Chandler V. Horst, Shaohan Hu, Jacob Johansen, Mitchell Matheny, Tanner Mengle, Michael Mills, Steven A. Moses, Brian Neyenhuis, Peter Siegfried, Romina Yalovetzky, Marco Pistoia",
      year: "2023",
      url: "https://arxiv.org/abs/2308.02342",
    },
    literature: [
      {
        title:
          "Evidence of Scaling Advantage for the Quantum Approximate Optimization Algorithm on a Classically Intractable Problem",
        authors:
          "Ruslan Shaydulin, Changhao Li, Shouvanik Chakrabarti, Matthew DeCross, Dylan Herman, Niraj Kumar, Jeffrey Larson, Danylo Lykov, Pierre Minssen, Yue Sun, Yuri Alexeev, Joan M. Dreiling, John P. Gaebler, Thomas M. Gatterman, Justin A. Gerber, Kevin Gilmore, Dan Gresh, Nathan Hewitt, Chandler V. Horst, Shaohan Hu, Jacob Johansen, Mitchell Matheny, Tanner Mengle, Michael Mills, Steven A. Moses, Brian Neyenhuis, Peter Siegfried, Romina Yalovetzky, Marco Pistoia",
        year: "2023",
        url: "https://arxiv.org/abs/2308.02342",
        relevance:
          "Primary source: it runs noiseless simulations of QAOA with up to 40 qubits on the LABS problem, reports that fixed-parameter QAOA's runtime scales better than branch-and-bound solvers (the state-of-the-art exact LABS solvers), reports that combining QAOA with quantum minimum finding gives the best empirical scaling among the algorithms it compares, and reports experimental progress executing QAOA for LABS on Quantinuum trapped-ion processors with an algorithm-specific error detection scheme. Consult it for the scaling data itself, the sizes at which each comparison was measured, and the error detection scheme, none of which the abstract quotes numerically.",
        relevanceJa:
          "一次資料です。LABS問題に対してQAOAの最大40量子ビットのノイズなしシミュレーションを行い、固定パラメータQAOAの実行時間がLABSに対する最先端の厳密解法である分枝限定法ソルバーよりも良くスケールすると報告し、QAOAと量子最小値探索を組み合わせることで比較対象アルゴリズムの中で最良の経験的スケーリングが得られると報告し、さらにアルゴリズム固有の誤り検出方式を用いてQuantinuumのトラップイオン方式プロセッサ上でLABS問題に対するQAOAの実行における実験的な進展を報告しています。スケーリングのデータそのもの、各比較が測定された規模、誤り検出方式の詳細は要旨に数値として示されていないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["qaoa-maxcut-ring", "operator-ising-cost", "ising-formulations-np-problems", "quantum-simulated-annealing"],
  },
  {
    slug: "cooling-systems-optimization",
    title: "Quantum Simulation-Based Optimization (QuSO) for cooling system design",
    titleJa: "冷却システム設計のための量子シミュレーションに基づく最適化（QuSO）",
    family: "QAOA",
    classiqPath: "applications/automotive/cooling_systems_optimization",
    classiqCategory: "applications",
    classiqGroup: "automotive",
    classiqName: "cooling_systems_optimization",
    problem:
      "Evaluate candidate designs for a simplified cooling system within an engineering design process that normally requires numerous computationally intensive numerical simulations, in a way that avoids the data input/output overhead that otherwise erodes any quantum speedup on such simulation tasks.",
    problemJa:
      "通常は多数の計算負荷の高い数値シミュレーションを必要とする工学設計プロセスにおいて、簡略化された冷却システムの設計候補を評価する問題です。ここでは、そうしたシミュレーション課題における量子的な高速化を損なってしまう、量子計算機へのデータの入出力に伴うオーバーヘッドを回避することが目指されています。",
    idea:
      "Hölscher, Müller, Samimi and Danzig start from a tension in the literature: quantum algorithms promise substantial speedups for specific tasks relevant to engineering simulations, but those advantages quickly vanish once the cost of data input and output on quantum computers is considered. They build on the recently introduced Quantum Simulation-Based Optimization (QuSO) framework, which they describe as circumventing that limitation by treating simulations as subproblems within a larger optimization problem rather than running each simulation as a standalone computation with its own input/output cost. The authors adapt and implement QuSO for a simplified cooling system design problem, validate its correctness in statevector simulations, and present a detailed gate-level complexity analysis for a single QuSO iteration, expressing the scaling in terms of problem parameters and QAOA depth and iterations. They show that the cost function of the design problem can be coherently computed over a superposition of exponentially many configurations using circuits of polynomial complexity, but they state plainly that this does not by itself yield a speedup for a single simulation instance; instead, they say it enables potential advantages that could arise from the subsequent QAOA-based search over configurations. The authors describe the study as a proof-of-concept for integrating fault-tolerant quantum subroutines with simulation-based optimization in engineering workflows, and say it is meant to clarify both the promise and the practical limitations of that integration.",
    ideaJa:
      "Hölscher、Müller、Samimi、Danzig は、先行研究にある緊張関係、すなわち量子アルゴリズムは工学シミュレーションに関連する特定の課題に対して大幅な高速化を約束する一方で、量子計算機へのデータの入出力コストを考慮するとその優位性は急速に失われてしまうという点から出発しています。著者らは、最近提案されたQuantum Simulation-Based Optimization（QuSO）という枠組みを土台にしており、これはシミュレーションをより大きな最適化問題の中の部分問題として扱うことで、各シミュレーションを独立した入出力コストを伴う個別の計算として実行するのではなく、この制約を回避するものだと説明しています。著者らはQuSOを簡略化された冷却システムの設計問題に合わせて調整・実装し、その正しさをステートベクトルシミュレーションで検証し、単一のQuSO反復についての詳細なゲートレベルの計算量解析を示しています。そのスケーリングは問題のパラメータとQAOAの深さおよび反復回数によって表現されています。著者らは、設計問題のコスト関数が、多項式複雑性を持つ回路を用いて指数関数的に多くの配置の重ね合わせにわたってコヒーレントに計算できることを示していますが、これ自体は単一のシミュレーション事例に対して高速化をもたらすものではないとはっきり述べています。その代わりに、その後に続くQAOAに基づく配置探索から生じうる潜在的な優位性を可能にするものだと述べています。著者らはこの研究を、耐故障性の量子サブルーチンをシミュレーションに基づく最適化と工学ワークフローに統合するための概念実証と位置づけており、その統合の見込みと実際上の限界の両方を明らかにすることを目的としていると述べています。",
    complexity:
      "For a single QuSO iteration, the paper's gate-level complexity analysis shows that the cost function can be coherently computed, over a superposition of exponentially many configurations, using circuits of polynomial complexity — but the abstract states this does not yield a speedup for a single simulation instance; any advantage is left as a potential one arising from the subsequent QAOA-based search over many such iterations, not a speedup proven here. The abstract also states that it expresses the scaling in terms of problem parameters and QAOA depth and iterations, without giving that expression itself, so no explicit formula, exponent, or constant for that scaling is recorded above.",
    complexityBasis:
      'abstract of arXiv:2504.15460, the only source read for this record: "Here we adapt and implement QuSO for a simplified cooling system design problem, validate correctness in statevector simulations, and present a detailed gate-level complexity analysis for a single QuSO iteration." Its scaling statement names the variables but not the formula: "We express the scaling in terms of problem parameters and QAOA depth and iterations." Its complexity finding is: "We show that the cost function can be coherently computed over a superposition of exponentially many configurations using circuits of polynomial complexity." And its speedup finding, quoted in full because upgrading it would misstate the paper: "This does not yield a speedup for a single simulation instance, but it enables potential advantages arising from the subsequent QAOA-based search over configurations." No exponent, no explicit function of the problem parameters, QAOA depth or iteration count, and no qubit or gate count is quoted anywhere in the abstract; "polynomial complexity" and "exponentially many configurations" are the only complexity-class descriptors it gives, and "potential advantages" is the abstract\'s own hedge on the one place it points to an advantage at all. The Classiq index entry this record covers, applications/automotive/cooling_systems_optimization, gives a directory path and a file list — cooling_systems_optimization.ipynb, the only file listed — and states no bound. This record fills the complexity field with the paper\'s stated complexity class rather than leaving it empty, because the abstract does give one, but every clause above is carried with the hedge the abstract itself attaches to it.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it, and no cooling-system design was evaluated here; the record documents the framework as its paper states it and does not reproduce or verify the Classiq demonstration at applications/automotive/cooling_systems_optimization, which the index gives here only as that directory path and a single listed file, cooling_systems_optimization.ipynb, with nothing about its contents. The central complexity finding — that the cost function can be coherently computed over a superposition of exponentially many configurations using circuits of polynomial complexity — is a statement about the gate-level structure of a single QuSO iteration, quoted from the paper's own gate-level complexity analysis, and it comes with the paper's own immediate qualification that this does not yield a speedup for a single simulation instance. This record does not soften or drop that qualification: nothing here claims a proven speedup for running one simulation instance on a quantum computer, and the abstract states none. The only advantage the abstract offers is described as potential, and located downstream, in a subsequent QAOA-based search over configurations that this record does not describe further because the abstract does not detail it — no QAOA circuit depth, no iteration count, and no comparison against a classical search are stated for that step. The abstract says it expresses the scaling of the single-iteration analysis in terms of problem parameters and QAOA depth and iterations, but does not give that expression, so this record carries no formula, no exponent, and no constant for it. The statevector simulations that validate correctness, and the gate-level complexity analysis itself, are the paper's own reported work, at whatever problem size the paper used, and neither was repeated or checked for this record; the abstract states no execution on quantum hardware. Finally, the authors describe the whole study as a proof-of-concept, explicitly meant to clarify both promise and practical limitations, so nothing here should be read as a claim that the approach is ready for, or has been shown to work on, a cooling system beyond the simplified problem the paper adapted QuSO for.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで回路を構成・コンパイル・シミュレーション・実行したことはなく、冷却システムの設計を評価してもいません。本項目は論文が述べる枠組みを記録したものであり、Classiq の applications/automotive/cooling_systems_optimization における実演を再現・検証するものではありません。ここで参照した索引項目が与えるのは当該ディレクトリのパスと、記載された唯一のファイルである cooling_systems_optimization.ipynb だけであり、その中身については何も分かりません。中心となる計算量に関する知見、すなわちコスト関数が多項式複雑性を持つ回路を用いて指数関数的に多くの配置の重ね合わせにわたってコヒーレントに計算できるという知見は、単一のQuSO反復のゲートレベルの構造についての記述であり、論文自身のゲートレベルの計算量解析から引用したものです。そしてこれには、論文自身による直後の限定、すなわちこれは単一のシミュレーション事例に対して高速化をもたらすものではないという限定が伴っています。本項目はこの限定を弱めたり省いたりしていません。ここでは、単一のシミュレーション事例を量子計算機上で実行することについて証明された高速化を主張しておらず、要旨もそのようには述べていません。要旨が示す唯一の優位性は「潜在的」なものとされており、その後に続くQAOAに基づく配置探索という下流の段階に位置づけられています。要旨はこの段階を詳細に述べていないため、本項目もこれ以上詳しく記述していません。すなわち、QAOA回路の深さも、反復回数も、古典的な探索との比較も、この段階については示されていません。要旨は、単一反復の解析のスケーリングを問題パラメータとQAOAの深さおよび反復回数によって表現すると述べていますが、その式自体は示していないため、本項目もその式・指数・定数のいずれも記載していません。正しさを検証するステートベクトルシミュレーションと、ゲートレベルの計算量解析そのものは、論文自身が報告する作業であり、論文が用いた問題規模において行われたものです。いずれも本項目のために追試・検証したものではなく、要旨は量子実機での実行についても何も述べていません。最後に、著者らはこの研究全体を概念実証と位置づけ、見込みと実際上の限界の両方を明らかにすることを明示的な目的としているため、本項目のいかなる記述も、この手法が論文がQuSOを適用した簡略化された問題を超えて、実際の冷却システムに対して利用可能である、あるいは有効であることが示されたという主張として読まれるべきではありません。",
    tags: ["QAOA", "quantum simulation-based optimization", "engineering design", "gate-level complexity", "proof-of-concept"],
    source: {
      id: "arxiv:2504.15460",
      title: "Quantum Simulation-Based Optimization for Cooling System Design",
      authors: "Leonhard Hölscher, Lukas Müller, Or Samimi, Tamuz Danzig",
      year: "2025",
      url: "https://arxiv.org/abs/2504.15460",
    },
    literature: [
      {
        title: "Quantum Simulation-Based Optimization for Cooling System Design",
        authors: "Leonhard Hölscher, Lukas Müller, Or Samimi, Tamuz Danzig",
        year: "2025",
        url: "https://arxiv.org/abs/2504.15460",
        relevance:
          "Primary source: it adapts and implements the Quantum Simulation-Based Optimization (QuSO) framework for a simplified cooling system design problem, validates correctness in statevector simulations, presents a gate-level complexity analysis for a single QuSO iteration, and states that the resulting polynomial-complexity circuits do not yield a speedup for a single simulation instance, only a potential downstream advantage from a QAOA-based search. Consult it for the scaling expression in problem parameters and QAOA depth/iterations, the gate-level analysis itself, and the QuSO framework this paper builds on but does not originate.",
        relevanceJa:
          "一次資料です。Quantum Simulation-Based Optimization（QuSO）という枠組みを簡略化された冷却システムの設計問題に合わせて調整・実装し、その正しさをステートベクトルシミュレーションで検証し、単一のQuSO反復についてのゲートレベルの計算量解析を示し、得られる多項式複雑性の回路は単一のシミュレーション事例に対しては高速化をもたらさず、QAOAに基づく探索による下流での潜在的な優位性のみをもたらすと述べています。問題パラメータとQAOAの深さ・反復回数によるスケーリングの式そのもの、ゲートレベルの解析そのもの、そしてこの論文が土台とするが着想の起点ではないQuSOという枠組みについては、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["qaoa-maxcut-ring", "operator-ising-cost", "quantum-simulated-annealing", "ising-formulations-np-problems"],
  },
  {
    slug: "workflow-scheduling-qubo",
    title: "Workflow scheduling by QUBO modeling",
    titleJa: "QUBOモデリングによるワークフロースケジューリング",
    family: "Optimization · Ising encoding",
    classiqPath: "applications/logistics/task_scheduling_problem",
    classiqCategory: "applications",
    classiqGroup: "logistics",
    classiqName: "task_scheduling_problem",
    problem:
      "Schedule a workflow of tasks — an instance of the workflow scheduling problem, a known NP-hard class of scheduling problems — for an industrial use case, in a way that can be represented and solved by quantum, classical, and hybrid quantum-classical algorithms.",
    problemJa:
      "産業上のユースケースについて、タスクからなるワークフローをスケジューリングする問題です。これはワークフロースケジューリング問題、すなわち既知のNP困難なスケジューリング問題のクラスの一例であり、量子・古典・量子古典ハイブリッドのアルゴリズムによって表現し解くことが目指されています。",
    idea:
      "Pakhomchik, Yudin, Perelshtein, Alekseyenko and Yarkoni investigate the workflow scheduling problem, which they describe as a known NP-hard class of scheduling problems, using problem instances they derive from an industrial use case. They compare several quantum, classical, and hybrid quantum-classical algorithms against those instances. To make the problem solvable by quantum and hybrid methods, they develop a novel QUBO formulation to represent the scheduling problem, and they show how the resulting QUBO's complexity depends on the input problem. To manage that complexity for their specific application, they derive and present a decomposition method, which they say mitigates the complexity, and they report that they demonstrate the effectiveness of the approach. The abstract does not say which of the compared algorithms performs best, or by how much.",
    ideaJa:
      "Pakhomchik、Yudin、Perelshtein、Alekseyenko、Yarkoni は、既知のNP困難なスケジューリング問題のクラスであると説明するワークフロースケジューリング問題を、産業上のユースケースから導出した問題例を用いて検討しています。著者らは、これらの問題例に対していくつかの量子・古典・量子古典ハイブリッドのアルゴリズムを比較しています。量子的手法およびハイブリッド手法で解けるようにするため、著者らはスケジューリング問題を表現する新規のQUBO定式化を開発し、得られるQUBOの複雑性が入力問題にどのように依存するかを示しています。この複雑性を今回の応用に特有の形で扱うため、著者らは分解法を導出・提示しており、これが複雑性を緩和すると述べ、この手法の有効性を実証したと報告しています。要旨は、比較したアルゴリズムのうちどれが最も優れているか、どの程度優れているかについては述べていません。",
    complexity: "",
    complexityBasis:
      'The abstract of arXiv:2205.04844, the only source read for this record, states no complexity expression, no big-O bound and no resource count for the algorithm it presents. It names the general problem class as "a known NP-hard class of scheduling problems", presented as an established fact about workflow scheduling in general, not a bound this paper proves. It also states that "the QUBO complexity depends on the input problem", naming a dependency without stating what it is: no formula, no scaling law, and no measure of QUBO size (variable count, term count) is quoted. Its comparison claim is: "We derive problem instances from an industrial use case and compare against several quantum, classical, and hybrid quantum-classical algorithms" — naming that a comparison was run but stating no outcome, no winner, and no number for any of the algorithms compared. Its closing claim is that the authors "demonstrate the effectiveness of the approach", stated without a metric, a number, or a comparison figure. The Classiq index entry this record covers, applications/logistics/task_scheduling_problem, gives a directory path and a file list and states no bound. The field is left empty on purpose rather than filled with a bound written from memory.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it, and no workflow-scheduling instance was solved here; the record documents the method as its paper states it and does not reproduce or verify the Classiq demonstration at applications/logistics/task_scheduling_problem, which the index gives here only as that directory path and a file list, task_scheduling_problem.ipynb and task_scheduling_problem.qmod, with nothing about their contents. The abstract calls workflow scheduling a known NP-hard class of scheduling problems; that is presented as an established fact about the problem class, not a proof this paper derives, and this record does not extend it into a claim about the hardness of the specific QUBO or decomposition the paper builds. The abstract states that the QUBO complexity depends on the input problem, without giving the dependency as a formula, an exponent, or a variable or term count for the QUBO; nothing here fills in that dependency from outside the abstract. The abstract states that a comparison was run against several quantum, classical, and hybrid quantum-classical algorithms on problem instances derived from an industrial use case, but it does not say which algorithm performed best, by how much, or on what instance sizes; this record does not supply an outcome the abstract withholds, and in particular makes no claim that any quantum or hybrid method here outperforms, or is outperformed by, any classical algorithm. The decomposition method is described only as mitigating the QUBO's complexity for this specific application, with no bound on the mitigation and no size at which it was tested, and the claim that the authors demonstrate the effectiveness of the approach is stated without a metric, so this record does not say what the demonstrated effectiveness consisted of. The abstract states no simulation and no hardware execution in so many words; deriving problem instances and comparing algorithms could have been done by any of several methods the abstract does not specify, so this record does not classify that comparison as simulated or as run on hardware beyond what the abstract itself states.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで回路を構成・コンパイル・シミュレーション・実行したことはなく、具体的なワークフロースケジューリングの問題例も解いていません。本項目は論文が述べる手法を記録したものであり、Classiq の applications/logistics/task_scheduling_problem における実演を再現・検証するものではありません。ここで参照した索引項目が与えるのは当該ディレクトリのパスとファイルの一覧（task_scheduling_problem.ipynb と task_scheduling_problem.qmod）だけであり、それらの中身については何も分かりません。要旨はワークフロースケジューリングを既知のNP困難なスケジューリング問題のクラスと呼んでいますが、これは問題クラス一般についての既に確立された事実として述べられているのであって、本論文が導いた証明ではありません。本項目も、これを論文が構築した具体的なQUBOや分解法の困難性についての主張へと拡張していません。要旨は、QUBOの複雑性が入力問題に依存すると述べていますが、その依存関係を式、指数、あるいはQUBOの変数数や項数として与えてはいません。本項目もこの依存関係を要旨の外から補ってはいません。要旨は、産業上のユースケースから導出した問題例に対して、いくつかの量子・古典・量子古典ハイブリッドのアルゴリズムを比較したと述べていますが、どのアルゴリズムが最も優れていたか、どの程度優れていたか、どのような規模の問題例で比較したかは述べていません。本項目は要旨が示していない結果を補ってはおらず、特に、ここでのいかなる量子的またはハイブリッドな手法が何らかの古典アルゴリズムに優る、あるいは劣るという主張も行っていません。分解法については、今回の応用に特有の形でQUBOの複雑性を緩和するとのみ説明されており、緩和の程度についての上界も、それが検証された規模も示されていません。また、著者らが手法の有効性を実証したという主張も指標を伴わずに述べられているため、本項目も実証された有効性の内容が何であったかを述べていません。要旨は、シミュレーションや実機での実行についてそれと分かる形では何も述べていません。問題例の導出とアルゴリズムの比較はいくつかの方法のいずれによっても行われた可能性があり、要旨はその方法を特定していないため、本項目もこの比較を、要旨自体が述べる以上にシミュレーションによるものとも実機によるものとも分類していません。",
    tags: ["QUBO", "workflow scheduling", "NP-hard", "decomposition method", "industrial use case"],
    source: {
      id: "arxiv:2205.04844",
      title: "Solving workflow scheduling problems with QUBO modeling",
      authors: "A. I. Pakhomchik, S. Yudin, M. R. Perelshtein, A. Alekseyenko, S. Yarkoni",
      year: "2022",
      url: "https://arxiv.org/abs/2205.04844",
    },
    literature: [
      {
        title: "Solving workflow scheduling problems with QUBO modeling",
        authors: "A. I. Pakhomchik, S. Yudin, M. R. Perelshtein, A. Alekseyenko, S. Yarkoni",
        year: "2022",
        url: "https://arxiv.org/abs/2205.04844",
        relevance:
          "Primary source: it investigates the workflow scheduling problem as a known NP-hard class, derives problem instances from an industrial use case, compares several quantum, classical, and hybrid quantum-classical algorithms against them, develops a novel QUBO representation whose complexity it shows depends on the input problem, and presents a decomposition method to mitigate that complexity. Consult it for the QUBO formulation itself, the decomposition method, the industrial instances, and the comparison's outcome, none of which the abstract states.",
        relevanceJa:
          "一次資料です。ワークフロースケジューリング問題を既知のNP困難なクラスとして検討し、産業上のユースケースから問題例を導出し、いくつかの量子・古典・量子古典ハイブリッドのアルゴリズムをそれらに対して比較し、複雑性が入力問題に依存することを示す新規のQUBO表現を開発し、その複雑性を緩和する分解法を提示しています。QUBO定式化そのもの、分解法、産業上の問題例、比較の結果については要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["operator-qubo", "ising-formulations-np-problems", "operator-ising-cost", "quantum-simulated-annealing"],
  },
  {
    slug: "quantum-vulnerability-analysis",
    title: "Quantum vulnerability analysis for patch prioritization",
    titleJa: "パッチ優先順位付けのための量子脆弱性分析",
    family: "Optimization · Ising encoding",
    classiqPath: "applications/cybersecurity/patching_management",
    classiqCategory: "applications",
    classiqGroup: "cybersecurity",
    classiqName: "patching_management",
    problem:
      "Given a network's vulnerabilities and how their connectivity creates kill-chains — paths to security compromise — decide which vulnerabilities to prioritize for patching, so that those paths are removed.",
    problemJa:
      "あるネットワークの脆弱性と、それらの結びつきが生み出すキルチェーン(セキュリティ侵害に至る経路)が与えられたとき、それらの経路が除去されるように、どの脆弱性を優先的にパッチ適用すべきかを決定する問題です。",
    idea:
      "Carney introduces vulnerability graphs, related to attack graphs, providing background theory and a method for solving significant cybersecurity problems with quantum computing. As a worked example, the paper prioritizes patches by expressing the connectivity of various vulnerabilities on a network as a QUBO and solving it with quantum annealing. The paper proves that the resulting solution removes all kill-chains — paths to security compromise — on the network. It reports that the quantum computer's solve time is almost constant, compared with an exponential increase in classical solve time, for vulnerability graphs of the density expected in the real world. The author presents this as a novel example of advantageous quantum vulnerability analysis.",
    ideaJa:
      "Carney は、攻撃グラフに関連する脆弱性グラフを導入し、量子コンピューティングによって重要なサイバーセキュリティ上の問題を解くための背景理論と方法を示しています。具体例として、本論文はネットワーク上の様々な脆弱性の結びつきを QUBO として表現し、それを量子アニーリングで解くことでパッチの優先順位付けを行っています。この解がネットワーク上のすべてのキルチェーン(セキュリティ侵害に至る経路)を除去することを、論文は証明しています。現実世界で想定される密度の脆弱性グラフについて、量子コンピュータの求解時間はほぼ一定である一方、古典的な求解時間は指数関数的に増加すると報告されています。著者は、これを量子脆弱性分析が優位性を持つことを示す新規な例として提示しています。",
    complexity:
      "No proven asymptotic bound. The paper reports, as an experimental finding for vulnerability graphs of the density expected in the real world, that the quantum computer's solve time is almost constant while the classical solve time increases exponentially; the abstract gives no formula, no growth rate, and no qubit, gate, or annealing-time count for either quantity.",
    complexityBasis:
      'The abstract of arXiv:2211.13740 states no big-O expression or resource count. Its cost claim is "The results demonstrate that the quantum computer\'s solve time is almost constant compared to the exponential increase in classical solve time for vulnerability graphs of expected real world density." That is reported as a finding, not derived as a formula: no growth rate, no constant, and no qubit, gate, or annealing-time count accompanies it anywhere in the abstract. The same abstract separately states, "Such a solution is then proved to remove all kill-chains (paths to security compromise) on a network." That is a correctness claim about coverage, not a cost bound, and is not treated as a complexity figure here. The Classiq index entry this record covers, applications/cybersecurity/patching_management, gives a directory path and a file list and states no bound of its own. Those are the only sources read for this field, and the complexity field above is left as a qualitative finding rather than filled with a numeric bound written from memory.',
    caveat:
      "This is a literature record. Nothing was built, compiled, simulated, run or measured for it: no vulnerability graph was constructed, no QUBO was formed or solved, and no quantum annealer or classical solver was run for this record. It documents the algorithm the paper describes and does not reproduce or verify the demonstration at applications/cybersecurity/patching_management; the pinned index read for this record gives only that directory path and the file list patch_min_vertex_cover.ipynb and patch_min_vertex_cover.qmod, nothing about what those files contain. The near-constant-versus-exponential solve-time finding is the paper's own reported result, stated for vulnerability graphs of the density expected in the real world; it is an experimental finding, not a proven asymptotic bound, and the abstract gives no formula, no growth rate, no problem-size variable, and no qubit, gate, or annealing-time count to go with it, so none of those figures is repeated here. The claim that the QUBO solution removes all kill-chains is stated by the abstract as proved, but the abstract does not say what the proof assumes, what counts as a kill-chain in the formal model, or how a vulnerability graph is built from a real network, so this record states none of that either. The abstract does not name what hardware or simulator produced the reported quantum-computer solve time, and this record does not guess at it. There is no comparison here against any state of the art beyond the classical baseline the paper itself measured against, and that comparison is the paper's own, not verified or repeated for this record.",
    caveatJa:
      "本項目は文献に基づく記録です。ここでは何も構築・コンパイル・シミュレーション・実行・測定していません。脆弱性グラフを構成したことも、QUBO を作成・求解したことも、量子アニーラーや古典ソルバーを本記録のために実行したこともありません。本記録は論文が記述するアルゴリズムを記したものであり、applications/cybersecurity/patching_management における実演を再現・検証するものではありません。本記録のために参照した索引項目が与えるのは当該ディレクトリのパスとファイル一覧(patch_min_vertex_cover.ipynb と patch_min_vertex_cover.qmod)だけであり、それらのファイルの中身については何も分かりません。「求解時間がほぼ一定である一方、古典の求解時間は指数関数的に増加する」という知見は論文自身が報告した結果であり、現実世界で想定される密度の脆弱性グラフについて述べられたものです。これは実験的な知見であって証明された漸近的な限界ではなく、要旨には式も増加率も問題サイズを表す変数も、量子ビット数・ゲート数・アニーリング時間のいずれの数値も付随していないため、本記録もそれらを補っていません。QUBO の解がすべてのキルチェーンを除去するという主張は要旨において証明済みとされていますが、その証明が何を仮定しているか、形式モデルにおいて何をキルチェーンとみなすか、実際のネットワークからどのように脆弱性グラフを構築するかについて要旨は述べておらず、本記録もこれらを述べていません。報告されている量子コンピュータの求解時間を生成した実機やシミュレータが何であるかは要旨に明記されておらず、本記録も推測していません。ここには、論文自身が比較した古典的な基準を超える最先端との比較は何もなく、その比較自体も論文自身のものであって、本記録のために検証・再現したものではありません。",
    tags: ["vulnerability graphs", "qubo", "quantum annealing", "kill-chain elimination", "patch prioritization"],
    source: {
      id: "arxiv:2211.13740",
      title: "Cutting Medusa's Path -- Tackling Kill-Chains with Quantum Computing",
      authors: "Mark Carney",
      year: "2022",
      url: "https://arxiv.org/abs/2211.13740",
    },
    literature: [
      {
        title: "Cutting Medusa's Path -- Tackling Kill-Chains with Quantum Computing",
        authors: "Mark Carney",
        year: "2022",
        url: "https://arxiv.org/abs/2211.13740",
        relevance:
          "Primary source: it introduces vulnerability graphs, related to attack graphs, as the background for a QUBO-and-quantum-annealing method that prioritizes patches, proves that the resulting solution removes all kill-chains on a network, and reports that the quantum computer's solve time is almost constant against exponentially increasing classical solve time for vulnerability graphs of real-world density. Consult it for the proof, the formal definition of a kill-chain, and how a vulnerability graph is built from a network — none of which the abstract states.",
        relevanceJa:
          "一次資料です。攻撃グラフに関連する脆弱性グラフを導入し、QUBO と量子アニーリングによってパッチを優先順位付けする方法の背景を示した上で、その解がネットワーク上のすべてのキルチェーンを除去することを証明し、現実世界の密度の脆弱性グラフについて量子コンピュータの求解時間がほぼ一定である一方、古典の求解時間は指数関数的に増加すると報告しています。証明の内容、キルチェーンの形式的な定義、ネットワークから脆弱性グラフを構築する方法については要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "operator-qubo",
      "operator-ising-cost",
      "ising-formulations-np-problems",
      "quantum-simulated-annealing",
    ],
  },
  {
    slug: "linear-kinetic-plasma-encoding",
    title: "Encoding of linear kinetic plasma problems in quantum circuits via data compression",
    titleJa: "データ圧縮による線形運動論的プラズマ問題の量子回路への符号化",
    family: "Quantum differential equations · linear",
    classiqPath: "applications/plasma/vlasov_ampere",
    classiqCategory: "applications",
    classiqGroup: "plasma",
    classiqName: "vlasov_ampere",
    problem:
      "Encode a linear kinetic plasma problem — modeling electrostatic linear waves, driven by a spatially localized external current, in a one-dimensional Maxwellian electron plasma — into a quantum circuit that solves the resulting linear system.",
    problemJa:
      "線形の運動論的プラズマ問題、すなわち空間的に局在した外部電流によって駆動される、一次元マクスウェル分布の電子プラズマにおける静電的な線形波を、その結果得られる線形方程式系を解く量子回路へと符号化する問題です。",
    idea:
      "Novikau, Dodin and Startsev propose an algorithm for encoding linear kinetic plasma problems in quantum circuits, focusing on electrostatic linear waves in a one-dimensional Maxwellian electron plasma. The waves are described by the linearized Vlasov-Ampère system with a spatially localized external current that drives plasma oscillations. The authors formulate this system as a boundary-value problem and cast it as a linear vector equation Aψ = b, to be solved using the quantum signal processing algorithm. Because that algorithm requires the matrix A to be encoded in a quantum circuit as a subblock of a unitary matrix, the authors propose a way to encode A in a compressed form, and discuss how the resulting circuit scales with the problem size and the desired precision.",
    ideaJa:
      "Novikau、Dodin、Startsev は、線形の運動論的プラズマ問題を量子回路へ符号化するアルゴリズムを提案しており、一次元マクスウェル分布の電子プラズマにおける静電的な線形波に焦点を当てています。これらの波は、プラズマ振動を駆動する空間的に局在した外部電流を伴う線形化された Vlasov-Ampère 系によって記述されます。著者らはこの系を境界値問題として定式化し、線形ベクトル方程式 Aψ = b の形にまとめた上で、量子信号処理アルゴリズムを用いて解くとしています。このアルゴリズムは行列 A をユニタリ行列の部分ブロックとして量子回路に符号化することを要求するため、著者らは A を圧縮した形で回路に符号化する方法を提案し、得られる回路が問題サイズと所望の精度に応じてどのように規模を増すかについて論じています。",
    complexity: "",
    complexityBasis:
      'The abstract of arXiv:2403.11989, the only source read for this record, states no complexity bound. Its closest approach to a cost claim is the closing sentence, "We propose how to encode $A$ in a circuit in a compressed form and discuss how the resulting circuit scales with the problem size and the desired precision." That sentence promises a discussion of scaling, not a scaling law: it names the two quantities the circuit scales with — problem size and desired precision — but gives no big-O expression, no exponent, and no qubit or gate count for either. The sentence before it states, "The latter requires encoding of the matrix $A$ in a quantum circuit as a subblock of a unitary matrix." This establishes that the method is a block encoding of A, again without a size figure. The Classiq index entry this record covers, applications/plasma/vlasov_ampere, gives a directory path and a file list and states no bound. Those are the only sources read for this field, and the complexity field is left empty on purpose rather than filled with a bound written from memory.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it, no plasma system was modeled, and no matrix was encoded; the record documents the algorithm the paper proposes and does not reproduce or verify the demonstration at applications/plasma/vlasov_ampere. The pinned index read for this record gives only that directory path and the file list vlasov_ampere.ipynb, vlasov_ampere.qmod and vlasov_ampere_qiskit.ipynb, nothing about what those files contain. The abstract states no complexity bound: it promises a discussion of how the resulting circuit scales with the problem size and the desired precision, but does not give that scaling here, so this record carries no formula, no exponent, and no qubit or gate count, and none is invented in its place. The abstract also does not state what the quantum signal processing algorithm itself costs, only that it is the method used to solve the linear vector equation once the matrix is encoded; the encoding scheme, the boundary conditions, and the physical parameters of the plasma are likewise not stated beyond what is quoted above. No experiment, simulation, or hardware run of any kind is claimed by the abstract, and none was performed for this record.",
    caveatJa:
      "本項目は文献に基づく記録です。ここでは回路の構成・コンパイル・シミュレーション・実行はいずれも行っておらず、プラズマ系のモデル化も行列の符号化も行っていません。本記録は論文が提案するアルゴリズムを記したものであり、applications/plasma/vlasov_ampere における実演を再現・検証するものではありません。本記録のために参照した索引項目が与えるのは当該ディレクトリのパスとファイル一覧(vlasov_ampere.ipynb、vlasov_ampere.qmod、vlasov_ampere_qiskit.ipynb)だけであり、それらのファイルの中身については何も分かりません。要旨は計算量の限界を一切示していません。得られる回路が問題サイズと所望の精度に応じてどのように規模を増すかを論じるとは述べていますが、その規模の増し方自体はここに示されていないため、本記録も式・指数・量子ビット数やゲート数のいずれも持たず、それらを補ってもいません。量子信号処理アルゴリズム自体のコストについても要旨は述べておらず、行列が符号化された後にその線形ベクトル方程式を解く手法であるという以上のことは分かりません。符号化方式、境界条件、プラズマの物理パラメータについても、上記に引用した以上のことは述べられていません。いかなる実験・シミュレーション・実機実行も要旨は主張しておらず、本記録のためにも行っていません。",
    tags: ["kinetic plasma", "vlasov-ampere system", "quantum signal processing", "block encoding", "boundary-value problem"],
    source: {
      id: "arxiv:2403.11989",
      title: "Encoding of linear kinetic plasma problems in quantum circuits via data compression",
      authors: "Ivan Novikau, Ilya Y. Dodin, Edward A. Startsev",
      year: "2024",
      url: "https://arxiv.org/abs/2403.11989",
    },
    literature: [
      {
        title: "Encoding of linear kinetic plasma problems in quantum circuits via data compression",
        authors: "Ivan Novikau, Ilya Y. Dodin, Edward A. Startsev",
        year: "2024",
        url: "https://arxiv.org/abs/2403.11989",
        relevance:
          "Primary source: it proposes the algorithm for encoding linear kinetic plasma problems — electrostatic linear waves in a one-dimensional Maxwellian electron plasma, described by the linearized Vlasov-Ampère system — as a linear vector equation Aψ = b solved by quantum signal processing, and proposes a compressed encoding of the matrix A. Consult it for the scaling of the resulting circuit with problem size and precision, which the abstract promises to discuss but does not itself state.",
        relevanceJa:
          "一次資料です。線形の運動論的プラズマ問題、すなわち線形化された Vlasov-Ampère 系で記述される一次元マクスウェル分布電子プラズマの静電的な線形波を符号化するアルゴリズムを提案し、それを線形ベクトル方程式 Aψ = b として量子信号処理により解くとし、行列 A を圧縮した形で符号化する方法を提案しています。得られる回路が問題サイズと精度に応じてどう規模を増すかは、要旨では論じると述べるにとどまり内容は示されていないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "linear-differential-equations",
      "hhl-linear-systems",
      "quantum-signal-processing",
      "quantum-singular-value-transformation",
    ],
  },
  {
    slug: "quantum-transport-method",
    title: "Fail-safe quantum algorithm for the transport equation",
    titleJa: "輸送方程式に対するフェイルセーフな量子アルゴリズム",
    family: "Quantum differential equations · linear",
    classiqPath: "applications/CFD/qlbm",
    classiqCategory: "applications",
    classiqGroup: "CFD",
    classiqName: "qlbm",
    problem:
      "Solve the transport equation — for variable grid sizes and discrete particle velocities, in two and three spatial dimensions — on a fault-tolerant universal quantum computer, including the reflection of particles at the walls, edges and corners of obstacles.",
    problemJa:
      "可変の格子サイズと離散化された粒子速度を持つ、二次元および三次元空間における輸送方程式を、フォールトトレラントな汎用量子計算機の上で解く問題です。障害物の壁・辺・角における粒子の反射を含みます。",
    idea:
      "Schalkers and Möller present a scalable algorithm for solving the transport equation in two and three spatial dimensions, for variable grid sizes and discrete velocities, on a fault-tolerant universal quantum computer. As a proof of concept of their quantum transport method (QTM), they describe a full-circuit start-to-end implementation in Qiskit and present numerical results for 2D flows. The QTM rests on a novel streaming approach that the authors say reduces the number of CNOT gates needed compared with state-of-the-art quantum streaming methods, a novel object-encoding method that makes the CNOT-gate cost of encoding a wall independent of the wall's size, and a novel encoding of the particles' discrete velocities that gives a linear speed-up in the cost of reflecting a particle's velocity and makes that cost independent of the number of velocities encoded. The paper's main contribution, by the authors' own description, is a detailed, fail-safe implementation of the reflection step that can be readily implemented on a physical quantum computer, handles a variety of initial conditions and particle velocities, and produces physically correct behavior around the walls, edges and corners of obstacles. Combining these pieces, the authors present a fail-safe, start-to-end quantum algorithm for the transport equation usable for a multitude of flow configurations, and report that it scales quadratically in the number of qubits needed to encode the grid and the number needed to encode the discrete velocities in a single spatial dimension, which they call superior to state-of-the-art approaches in the literature.",
    ideaJa:
      "Schalkers と Möller は、可変の格子サイズと離散化された速度を持つ二次元および三次元空間の輸送方程式を、フォールトトレラントな汎用量子計算機の上で解くスケーラブルなアルゴリズムを提示しています。彼らの量子輸送法(QTM)の概念実証として、Qiskit によるフルサーキットの一気通貫実装を記述し、二次元流れに対する数値結果を示しています。QTM は、最先端の量子ストリーミング手法と比べて必要な CNOT ゲート数を削減するという新規なストリーミング手法、壁を符号化するのに必要な CNOT ゲート数のコストを壁の大きさに依存しなくするという新規なオブジェクト符号化手法、そして粒子の速度を反射させるコストに線形の高速化をもたらし、そのコストを符号化された速度の数に依存しなくするという粒子の離散速度に対する新規な符号化に基づいています。著者ら自身の記述によれば、論文の主な貢献は、物理的な量子計算機上ですぐに実装できる反射ステップのフェイルセーフな実装を詳細に記述したことであり、多様な初期条件と粒子速度に対応し、障害物の壁・辺・角の周囲で物理的に正しい振る舞いをもたらします。これらを組み合わせることで、著者らは多数の流れの設定に使える、フェイルセーフで一気通貫の輸送方程式に対する量子アルゴリズムを提示し、格子を符号化するのに必要な量子ビット数と、単一の空間次元において離散速度を符号化するのに必要な量子ビット数について二次的に規模が増すと報告しており、これを文献における最先端の手法よりも優れていると呼んでいます。",
    complexity:
      "Quadratic scaling, per the paper's own comparison, in the number of qubits needed to encode the grid and the number needed to encode the discrete velocities, stated for a single spatial dimension; the abstract calls this scaling superior to state-of-the-art approaches in the literature. Three further findings in the same abstract are each attached to a different subroutine and are qualitative rather than numeric: the streaming approach is said to reduce the number of CNOT gates against state-of-the-art quantum streaming methods; the object-encoding method for walls is said to make the CNOT-gate cost of encoding a wall independent of the wall's size; and the velocity encoding is said to give a linear speed-up in the cost of reflecting a particle's velocity and to make that cost independent of the number of velocities encoded. None of the four is accompanied by an explicit formula, a constant, or an error dependence in the abstract.",
    complexityBasis:
      'The abstract of arXiv:2211.14269 states four separate scaling claims, each attached by the abstract to a different piece of the algorithm; this record keeps them separate rather than merging them into one figure. The qubit-count claim: "We finally show that our approach is quadratic in the amount of qubits necessary to encode the grid and the amount of qubits necessary to encode the discrete velocities in a single spatial dimension, which makes our approach superior to state-of-the-art approaches known in the literature." On the streaming approach: "Our QTM is based on a novel streaming approach which leads to a reduction in the amount of CNOT gates required in comparison to state-of-the-art quantum streaming methods." On wall encoding: "As a second highlight we present a novel object encoding method, that reduces the complexity of the amount of CNOT gates required to encode walls, which now becomes independent of the size of the wall." On velocity encoding: "Finally we present a novel quantum encoding of the particles\' discrete velocities that enables a linear speed-up in the costs of reflecting the velocity of a particle, which now becomes independent of the amount of velocities encoded." None of the four is a big-O expression with an explicit exponent or constant beyond the words "quadratic" and "linear" themselves, and none carries an error or precision dependence. The Classiq index entry this record covers, applications/CFD/qlbm, gives a directory path and a file list and states no bound of its own.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it, no transport-equation instance was solved, and no flow was computed; the record documents the algorithm the paper presents and does not reproduce or verify the demonstration at applications/CFD/qlbm. The pinned index read for this record gives only that directory path and the file list qlbm.ipynb and qlbm.qmod, nothing about what those files contain. Every scaling claim above is the paper's own statement about its own algorithm, not a number produced for this record: the quadratic qubit-count scaling is stated for a single spatial dimension only, and the abstract does not say what it becomes in two or three dimensions, does not give a constant factor, and does not state how either bound depends on precision or on the physical parameters of the flow. The claims about CNOT-gate reduction, wall-size independence, and velocity-count independence are each qualitative — the abstract states a direction of improvement, not a formula — so nothing here quantifies by how much any of the three improves, or over what baseline beyond the general phrase state-of-the-art. The comparisons the abstract calls superior are the paper's own comparisons against a state of the art it does not name in detail, not a proven lower bound. The abstract does report the paper's own experiment: a full-circuit start-to-end implementation in Qiskit with numerical results for 2D flows; that is the paper's reported simulation, at the size and configuration the paper reports, and it is not repeated or checked here. The fail-safe reflection-step implementation the abstract calls the paper's main contribution is described only at the level the abstract states — that it handles a variety of initial conditions and particle velocities and produces physically correct behavior around walls, edges and corners — with no further detail on what fail-safe means operationally.",
    caveatJa:
      "本項目は文献に基づく記録です。ここでは回路の構成・コンパイル・シミュレーション・実行はいずれも行っておらず、具体的な輸送方程式の問題例も解いておらず、流れの計算も行っていません。本記録は論文が提示するアルゴリズムを記したものであり、applications/CFD/qlbm における実演を再現・検証するものではありません。本記録のために参照した索引項目が与えるのは当該ディレクトリのパスとファイル一覧(qlbm.ipynb、qlbm.qmod)だけであり、それらのファイルの中身については何も分かりません。上記の規模に関する主張はいずれも論文自身がその論文自身のアルゴリズムについて述べたものであり、本記録のために算出した数値ではありません。二次的な量子ビット数の規模は単一の空間次元についてのみ述べられており、二次元・三次元でどうなるかは要旨に述べられておらず、定数因子も、精度や流れの物理パラメータへの依存性も示されていません。CNOT ゲート削減、壁の大きさへの非依存性、速度数への非依存性に関する主張はいずれも定性的なものであり、要旨は改善の方向性を述べるのみで式は示していないため、これら3つがそれぞれどれだけ改善するのか、また「最先端」という一般的な表現以外にどのような基準と比較しているのかは、本記録では定量化されていません。要旨が優れていると呼んでいる比較は、論文自身による、詳細を明示しない最先端との比較であって、証明された下界ではありません。要旨は論文自身の実験、すなわち Qiskit によるフルサーキットの一気通貫実装と二次元流れに対する数値結果を報告していますが、これは論文自身が報告したシミュレーションであり、論文が報告する規模と設定においてのものであって、本記録のために再現・検証したものではありません。要旨が論文の主な貢献と呼ぶフェイルセーフな反射ステップの実装については、多様な初期条件と粒子速度に対応し、壁・辺・角の周囲で物理的に正しい振る舞いをもたらすという、要旨が述べる水準でのみ記述されており、フェイルセーフであることの運用上の意味についてのそれ以上の詳細はありません。",
    tags: ["transport equation", "fault-tolerant quantum computing", "cnot reduction", "particle reflection", "qubit encoding"],
    source: {
      id: "arxiv:2211.14269",
      title: "Efficient and fail-safe quantum algorithm for the transport equation",
      authors: "Merel A. Schalkers, Matthias Möller",
      year: "2022",
      url: "https://arxiv.org/abs/2211.14269",
    },
    literature: [
      {
        title: "Efficient and fail-safe quantum algorithm for the transport equation",
        authors: "Merel A. Schalkers, Matthias Möller",
        year: "2022",
        url: "https://arxiv.org/abs/2211.14269",
        relevance:
          "Primary source: it presents the quantum transport method (QTM), a fail-safe, start-to-end algorithm for the transport equation, and reports that the approach is quadratic in the qubits needed to encode the grid and the discrete velocities in a single spatial dimension, that its streaming approach reduces CNOT gates against state-of-the-art quantum streaming methods, that its wall-encoding method makes CNOT cost independent of wall size, and that its velocity encoding gives a linear speed-up in reflection cost independent of the number of velocities. Consult it for the two- and three-dimensional scaling, the constants involved, and the Qiskit implementation and its 2D numerical results, none of which the abstract itself states in detail.",
        relevanceJa:
          "一次資料です。輸送方程式に対するフェイルセーフで一気通貫のアルゴリズムである量子輸送法(QTM)を提示し、単一の空間次元において格子と離散速度を符号化するのに必要な量子ビット数について二次的であること、ストリーミング手法が最先端の量子ストリーミング手法に比べて CNOT ゲートを削減すること、壁の符号化手法が CNOT コストを壁の大きさに依存しなくすること、速度の符号化が反射コストに線形の高速化をもたらし速度数に依存しなくすることを報告しています。二次元・三次元での規模、関係する定数、Qiskit 実装とその二次元数値結果の詳細については要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["linear-differential-equations", "heat-equation-solver", "hhl-linear-systems"],
  },
  {
    slug: "correlated-fermion-simulation",
    title: "Quantum algorithms to simulate many-body physics of correlated fermions",
    titleJa: "相関フェルミオンの多体物理を量子シミュレーションするアルゴリズム",
    family: "Hamiltonian simulation · model systems",
    classiqPath: "applications/physical_systems/fermi_hubbard_model_1D",
    classiqCategory: "applications",
    classiqGroup: "physical_systems",
    classiqName: "fermi_hubbard_model_1D",
    problem:
      "Simulate strongly correlated fermionic systems — notoriously hard for classical computers — on a quantum computer with 2D or linear (1D) nearest-neighbor qubit-qubit couplings, of the kind typical of superconducting transmon qubit arrays, including preparing the relevant quantum states and evolving the system in time, with the Fermi-Hubbard model as a worked example.",
    problemJa:
      "古典計算機では扱いが極めて困難な、強く相関したフェルミオン系を、超伝導トランズモン量子ビット配列に典型的な、2次元または線形(1次元)の最近接量子ビット結合を持つ量子計算機上でシミュレーションする問題です。関連する量子状態の準備や系の時間発展を含み、Fermi-Hubbard モデルを具体例として扱います。",
    idea:
      "Jiang, Sung, Kechedzhi, Smelyanskiy and Boixo discuss quantum simulation of strongly correlated fermionic systems, following Feynman's proposal to use a quantum computer for a problem notoriously hard on classical ones, and focus specifically on 2D and linear geometry with nearest-neighbor qubit-qubit couplings, typical for superconducting transmon qubit arrays. They improve an existing algorithm for preparing an arbitrary Slater determinant by exploiting a unitary symmetry, and present a quantum algorithm to prepare an arbitrary fermionic Gaussian state with O(N²) gates and O(N) circuit depth; both algorithms, the authors say, are optimal in that the number of parameters in the circuit equals the number needed to describe the state. They also propose an algorithm for the 2D fermionic Fourier transform on a 2D qubit array with O(N^1.5) gates and O(√N) circuit depth, which they identify as the minimum depth required for quantum information to travel across the array. Separately, they present methods to simulate each time step of the evolution of the 2D Fermi-Hubbard model, again on a 2D qubit array, with O(N) gates and O(√N) circuit depth. The authors close by discussing how these algorithms can be used to determine the ground-state properties and phase diagrams of strongly correlated quantum systems, with the Hubbard model as their example.",
    ideaJa:
      "Jiang、Sung、Kechedzhi、Smelyanskiy、Boixo は、Feynman の提案に従い、古典計算機では notoriously に困難な問題に量子計算機を用いるという立場から、強く相関したフェルミオン系の量子シミュレーションについて論じ、超伝導トランズモン量子ビット配列に典型的な、最近接量子ビット結合を持つ2次元および線形の幾何に焦点を当てています。彼らは、ユニタリ対称性を利用することで任意のスレーター行列式を準備する既存のアルゴリズムを改良し、任意のフェルミオン・ガウス状態を O(N²) ゲート・O(N) 回路深さで準備する量子アルゴリズムを提示しています。著者らによれば、両アルゴリズムは、回路のパラメータ数が状態を記述するのに必要なパラメータ数と等しいという意味で最適です。さらに、2次元量子ビット配列上での2次元フェルミオン・フーリエ変換を O(N^1.5) ゲート・O(√N) 回路深さで実装するアルゴリズムを提案しており、これを量子情報が配列を横断するのに必要な最小の深さであるとしています。これとは別に、2次元 Fermi-Hubbard モデルの発展の各時間ステップを、やはり2次元量子ビット配列上で、O(N) ゲート・O(√N) 回路深さでシミュレーションする手法を示しています。著者らは最後に、これらのアルゴリズムを、ハバードモデルを例として、強く相関した量子系の基底状態の性質や相図を決定するためにどのように使えるかを論じています。",
    complexity:
      "Three separate bounds, each attached to the subroutine the abstract attaches it to, not merged into one figure for the algorithm as a whole: preparing an arbitrary fermionic Gaussian state costs O(N²) gates and O(N) circuit depth; the 2D fermionic Fourier transform on a 2D qubit array costs O(N^1.5) gates and O(√N) circuit depth, described as the minimum depth needed for quantum information to cross the array; and simulating each time step of the 2D Fermi-Hubbard model, again on a 2D qubit array, costs O(N) gates and O(√N) circuit depth. None of the three is a total cost for a full simulation, and none is stated by the abstract specifically for the one-dimensional (linear) geometry the Classiq directory covered here demonstrates: the abstract names linear geometry as within its scope but attaches no gate or depth bound to it.",
    complexityBasis:
      'The abstract of arXiv:1711.05395 states three separate gate-count and depth bounds, each attached by the abstract itself to a different subroutine; this record keeps them attached to those subroutines rather than folding them into one figure for the whole algorithm. On Gaussian state preparation: "We also present a quantum algorithm to prepare an arbitrary fermionic Gaussian state with $O(N^2)$ gates and $O(N)$ circuit depth." On the 2D fermionic Fourier transform: "we propose an algorithm to implement the 2-dimensional (2D) fermionic Fourier transformation on a 2D qubit array with only $O(N^{1.5})$ gates and" — the abstract then gives the depth bound in TeX using a square root, rendered here as O(√N) since it is written outside quotation marks — and resumes: "circuit depth, which is the minimum depth required for quantum information to travel across the qubit array." On the Fermi-Hubbard time step: "We also present methods to simulate each time step in the evolution of the 2D Fermi-Hubbard model---again on a 2D qubit array---with $O(N)$ gates and" — again a TeX square-root depth bound, rendered O(√N) outside quotes — before: "circuit depth." All three bounds are stated for a 2D qubit array. The same abstract separately states, "We focus specifically on 2D and linear geometry with nearest neighbor qubit-qubit couplings, typical for superconducting transmon qubit arrays." That sentence puts linear (one-dimensional) geometry within the paper\'s scope but attaches no gate or depth bound to it anywhere in the abstract. The Classiq directory this record covers, applications/physical_systems/fermi_hubbard_model_1D, demonstrates the one-dimensional case, so none of the three quoted bounds is claimed here to describe it. The index entry itself gives only a directory path and a file list and states no bound of its own.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it, no fermionic state was prepared, and no Fermi-Hubbard evolution was carried out; the record documents the algorithms the paper presents and does not reproduce or verify the demonstration at applications/physical_systems/fermi_hubbard_model_1D. The pinned index read for this record gives only that directory path and the file list fermi_hubbard_1D.ipynb and fermi_hubbard_1D.qmod, nothing about what those files contain. The three gate-count and depth bounds quoted above are each the abstract's own figure for a specific subroutine — Gaussian state preparation, the 2D fermionic Fourier transform, and one Fermi-Hubbard time step — and this record keeps them attached to those subroutines rather than reporting one figure for the whole algorithm. Critically, none of the three is stated by the abstract for the one-dimensional geometry that the Classiq directory here demonstrates: all three are given for a 2D qubit array, and while the abstract does name linear (1D) geometry as within the paper's scope, it attaches no gate or depth bound to that case anywhere in the text this record read. None of the bounds includes a constant factor, an error tolerance, or a qubit count beyond the variable N itself, and the abstract does not say what N counts in physical terms — sites, orbitals, or qubits — beyond calling the parameter counts of the Gaussian-state and Slater-determinant circuits optimal in the sense that they equal the number of parameters needed to describe the corresponding states. The improvement to the existing Slater-determinant algorithm, described as exploiting a unitary symmetry, carries no bound at all in the abstract. The closing sentence about determining ground-state properties and phase diagrams using the Hubbard model as an example is a stated direction of use, not a result, and nothing here quantifies it.",
    caveatJa:
      "本項目は文献に基づく記録です。ここでは回路の構成・コンパイル・シミュレーション・実行はいずれも行っておらず、フェルミオン状態の準備も Fermi-Hubbard 発展の実行も行っていません。本記録は論文が提示するアルゴリズム群を記したものであり、applications/physical_systems/fermi_hubbard_model_1D における実演を再現・検証するものではありません。本記録のために参照した索引項目が与えるのは当該ディレクトリのパスとファイル一覧(fermi_hubbard_1D.ipynb、fermi_hubbard_1D.qmod)だけであり、それらのファイルの中身については何も分かりません。上記に引用した3つのゲート数・深さの限界は、それぞれフェルミオン・ガウス状態の準備、2次元フェルミオン・フーリエ変換、Fermi-Hubbard の1時間ステップという特定のサブルーチンについての要旨自身の数値であり、本記録はアルゴリズム全体について1つの数値にまとめることなく、それぞれをそのサブルーチンに結び付けたまま扱っています。重要な点として、この3つのいずれも、ここで扱う Classiq のディレクトリが実演している一次元の幾何については述べられていません。3つとも2次元の量子ビット配列について与えられた数値であり、要旨は線形(1次元)の幾何を論文の対象範囲に含めると述べてはいるものの、本記録が読んだ範囲では、その場合についてゲート数や深さの限界を一切示していません。いずれの限界にも定数因子や誤差の許容度は含まれておらず、変数 N 自体を超える量子ビット数も示されていません。要旨は N が物理的に何を数えるのか、すなわちサイト数か軌道数か量子ビット数かについても、ガウス状態やスレーター行列式の回路のパラメータ数がそれぞれの状態を記述するのに必要なパラメータ数と等しいという意味で最適であると呼んでいる以上のことは述べていません。既存のスレーター行列式アルゴリズムに対する改良は、ユニタリ対称性を利用したものと記述されていますが、要旨には限界が一切示されていません。基底状態の性質や相図をハバードモデルを例として決定するために使えるという末尾の文は、利用の方向性を述べたものであって結果ではなく、本記録もこれを定量化していません。",
    tags: ["correlated fermions", "fermionic gaussian state", "fermionic fourier transform", "fermi-hubbard model", "2d qubit array"],
    source: {
      id: "arxiv:1711.05395",
      title: "Quantum algorithms to simulate many-body physics of correlated fermions",
      authors: "Zhang Jiang, Kevin J. Sung, Kostyantyn Kechedzhi, Vadim N. Smelyanskiy, Sergio Boixo",
      year: "2017",
      url: "https://arxiv.org/abs/1711.05395",
    },
    literature: [
      {
        title: "Quantum algorithms to simulate many-body physics of correlated fermions",
        authors: "Zhang Jiang, Kevin J. Sung, Kostyantyn Kechedzhi, Vadim N. Smelyanskiy, Sergio Boixo",
        year: "2017",
        url: "https://arxiv.org/abs/1711.05395",
        relevance:
          "Primary source: it presents three separate subroutines with the gate-count and circuit-depth bounds quoted above — fermionic Gaussian state preparation, the 2D fermionic Fourier transform, and one time step of 2D Fermi-Hubbard evolution — an improved Slater-determinant preparation algorithm, and a discussion of using these algorithms for ground-state properties and phase diagrams via the Hubbard model. Consult it for what happens in the one-dimensional (linear) geometry the abstract names but does not bound, for the meaning of N, and for the Slater-determinant improvement, none of which the abstract itself gives beyond what is quoted here.",
        relevanceJa:
          "一次資料です。上記に引用したゲート数・回路深さの限界を伴う3つのサブルーチン、すなわちフェルミオン・ガウス状態の準備、2次元フェルミオン・フーリエ変換、2次元 Fermi-Hubbard 発展の1時間ステップを提示するとともに、改良されたスレーター行列式の準備アルゴリズムと、これらのアルゴリズムをハバードモデルを介した基底状態の性質・相図の決定に用いる議論を示しています。要旨が言及しつつ限界を示していない線形(1次元)の幾何でどうなるか、N が何を意味するか、スレーター行列式の改良の内容については、要旨がここで引用した以上のことを述べていないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "operator-fermi-hubbard",
      "fermi-hubbard-operator",
      "trotter-suzuki-simulation",
      "quantum-fourier-transform",
    ],
  },
  {
    slug: "risk-analysis-amplitude-estimation",
    title: "Value at Risk by quantum amplitude estimation",
    titleJa: "量子振幅推定によるバリュー・アット・リスクの評価",
    family: "Amplitude estimation",
    classiqPath: "applications/finance/value_at_risk",
    classiqCategory: "applications",
    classiqGroup: "finance",
    classiqName: "value_at_risk",
    problem:
      "Evaluate risk measures of a financial position — Value at Risk and Conditional Value at Risk among them — where the classical route is a Monte Carlo simulation over sampled realisations of the uncertainty.",
    problemJa:
      "金融ポジションのリスク指標、なかでもバリュー・アット・リスクと条件付きバリュー・アット・リスクを評価する問題です。古典的な手法では、不確実性の実現値を標本抽出するモンテカルロ・シミュレーションによって求められます。",
    idea:
      "Woerner and Egger present a quantum algorithm that, they state, analyzes risk more efficiently than the Monte Carlo simulations traditionally used on classical computers. The algorithm employs quantum amplitude estimation to evaluate risk measures such as Value at Risk and Conditional Value at Risk on a gate-based quantum computer, and the paper additionally shows how to implement it and how to trade off the convergence rate against the circuit depth. That trade-off is the substance of the result: at the shortest possible circuit depth — one the authors describe as growing polynomially in the number of qubits representing the uncertainty — the convergence rate is O(M⁻²ᐟ³), which the paper notes is already faster than classical Monte Carlo simulations converging at O(M⁻¹ᐟ²); allowing the depth to grow faster, but still polynomially, brings the rate toward the optimum of O(M⁻¹). The authors demonstrate the algorithm on two toy models, using real hardware such as the IBM Q Experience to measure the financial risk in a Treasury-bill faced by a possible interest rate increase in the first, and simulating the algorithm for a two-asset portfolio of government debt with different maturity dates in the second. They report that both models confirm the improved convergence rate over Monte Carlo methods, and that they also evaluate the impact of cross-talk and energy relaxation errors using simulations.",
    ideaJa:
      "Woerner と Egger は、古典計算機で従来用いられてきたモンテカルロ・シミュレーションよりも効率的にリスクを分析する量子アルゴリズムを提示したと述べています。このアルゴリズムは量子振幅推定を用いて、バリュー・アット・リスクや条件付きバリュー・アット・リスクといったリスク指標をゲート方式の量子計算機上で評価するもので、論文はさらに、その実装方法と、収束率と回路深さのあいだの折り合いの付け方を示しています。この折り合いこそが結果の中身です。取りうる最も浅い回路深さ、すなわち著者らが不確実性を表す量子ビット数について多項式的に増大すると述べる深さにおいて、収束率は O(M⁻²ᐟ³) となり、論文はこれが O(M⁻¹ᐟ²) で収束する古典的なモンテカルロ・シミュレーションよりすでに速いと述べています。深さの増大をより速く、ただし多項式の範囲で許すと、収束率は最適値である O(M⁻¹) に近づきます。著者らは2つの単純化されたモデルでアルゴリズムを実演しており、1つ目では IBM Q Experience のような実機を用いて、金利上昇の可能性が財務省短期証券にもたらす金融リスクを測定し、2つ目ではシミュレーションによって、満期の異なる国債からなる2資産ポートフォリオの金融リスクを扱っています。著者らは、いずれのモデルでもモンテカルロ法に対する収束率の改善が確認されたこと、またシミュレーションによってクロストークとエネルギー緩和の誤差の影響も評価したことを報告しています。",
    complexity:
      "A convergence rate of O(M⁻²ᐟ³) at the shortest possible circuit depth, which the abstract describes as growing polynomially in the number of qubits representing the uncertainty, against O(M⁻¹ᐟ²) for classical Monte Carlo; allowing the depth to grow faster but still polynomially brings the rate toward the optimum of O(M⁻¹), which the abstract characterises as a near quadratic speed-up compared to Monte Carlo methods for slowly increasing circuit depths. The abstract states the result only in those terms: it gives no gate count, no qubit count, no dependence on the number of risk factors, and no constant factor.",
    complexityBasis:
      'abstract of arXiv:1806.06893 (TeX rendered into Unicode: the abstract writes the rates in inline math mode as $O(M^{-2/3})$, $O(M^{-1/2})$ and $O(M^{-1})$, written above as O(M⁻²ᐟ³), O(M⁻¹ᐟ²) and O(M⁻¹)): "The shortest possible circuit depth - growing polynomially in the number of qubits representing the uncertainty - leads to a convergence rate of $O(M^{-2/3})$." and "This is already faster than classical Monte Carlo simulations which converge at a rate of $O(M^{-1/2})$." and "If we allow the circuit depth to grow faster, but still polynomially, the convergence rate quickly approaches the optimum of $O(M^{-1})$." The comparison is the abstract\'s own: "Thus, for slowly increasing circuit depths our algorithm provides a near quadratic speed-up compared to Monte Carlo methods." The same abstract fixes what is being computed — "We employ quantum amplitude estimation to evaluate risk measures such as Value at Risk and Conditional Value at Risk on a gate-based quantum computer." — and quotes no gate count, no qubit count and no constant anywhere. The Classiq index entry this record covers, applications/finance/value_at_risk, gives a directory path and a file list and states no bound. Those are the only sources read for this field.',
    caveat:
      "This is a literature record. No circuit was written, compiled, simulated or run for it, no risk measure was computed here, and no portfolio or instrument was priced; the record documents the algorithm and does not reproduce or verify any published demonstration of it. The index entry read here gives the directory path applications/finance/value_at_risk and its two file names, nothing about what those files contain. Every rate above is a convergence rate in M, the abstract's own variable, and a rate is not a running time: nothing here says how many gates, how many qubits, or how much depth a given instance costs, how the cost depends on the number of risk factors or on the distribution being loaded, or what it takes to prepare the state that represents the uncertainty in the first place — the abstract states none of that, and loading a distribution is where a quantum advantage of this shape is most often lost. The near quadratic speed-up is stated for slowly increasing circuit depths and is a comparison against Monte Carlo methods as the authors reckon them, not a lower bound on any classical approach, and the shortest-depth rate is quoted with its own condition attached rather than as the algorithm's cost in general. The two toy models are the paper's own: the T-bill measurement on real hardware such as the IBM Q Experience and the simulated two-asset government-debt portfolio were reported by the authors in 2018 at the sizes they describe, and neither was repeated, re-measured or checked for this record, which says nothing about any machine available now. That both models confirm the improved convergence rate is the authors' reading of their own results on two toy models, not evidence about instruments, portfolios or risk measures beyond them. The cross-talk and energy relaxation errors were evaluated by the authors using simulations, so nothing here establishes how the algorithm behaves under any other noise, on any other device, or at any scale where a risk calculation would matter to a reader.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで回路を記述・コンパイル・シミュレーション・実行したことはなく、リスク指標を計算してもおらず、ポートフォリオや金融商品の評価も行っていません。アルゴリズムそのものを記した記録であり、公開されている実演を再現・検証したものではありません。ここで参照した索引項目が与えるのは applications/finance/value_at_risk というディレクトリのパスと2つのファイル名だけで、それらのファイルの中身については何も分かりません。上に挙げた各値は、いずれも要旨自身の変数 M についての収束率であり、収束率は実行時間ではありません。個々の問題例にゲートが何個、量子ビットが何個、どれだけの深さが必要か、コストがリスク要因の数や読み込む分布にどう依存するか、そして不確実性を表す状態をそもそもどのように準備するかについて、本記録は何も述べていません。要旨がいずれも述べていないためであり、分布の読み込みは、この形の量子的優位が失われやすい箇所でもあります。「ほぼ二次」の高速化は回路深さがゆるやかに増大する場合について述べられたものであり、著者らが捉えたモンテカルロ法との比較であって、古典的手法一般に対する下界ではありません。最も浅い深さでの収束率も、その条件を伴った値として引用しており、アルゴリズム一般のコストとして記したものではありません。2つの単純化されたモデルは論文自身のものです。IBM Q Experience のような実機での財務省短期証券の測定と、シミュレーションによる満期の異なる国債の2資産ポートフォリオは、著者らが2018年にその規模で報告したものであり、本記録のために追試も再測定も検証も行っておらず、現在利用できる機器については何も述べていません。両モデルで収束率の改善が確認されたという点も、2つの単純化されたモデルについての著者ら自身の読み取りであって、それを超える金融商品・ポートフォリオ・リスク指標についての証拠ではありません。クロストークとエネルギー緩和の誤差は著者らがシミュレーションによって評価したものであるため、それ以外のノイズのもとで、別の装置上で、あるいは読者にとって意味のある規模において、このアルゴリズムがどう振る舞うかは本記録からは分かりません。",
    tags: ["value at risk", "risk analysis", "amplitude estimation", "monte carlo", "finance"],
    source: {
      id: "arxiv:1806.06893",
      title: "Quantum Risk Analysis",
      authors: "Stefan Woerner, Daniel J. Egger",
      year: "2018",
      url: "https://arxiv.org/abs/1806.06893",
    },
    literature: [
      {
        title: "Quantum Risk Analysis",
        authors: "Stefan Woerner, Daniel J. Egger",
        year: "2018",
        url: "https://arxiv.org/abs/1806.06893",
        relevance:
          "Primary source: it presents the algorithm, employs quantum amplitude estimation to evaluate risk measures such as Value at Risk and Conditional Value at Risk on a gate-based quantum computer, states the convergence rates at the shortest possible circuit depth and at faster-growing polynomial depths, and reports the two toy models — the T-bill on real hardware such as the IBM Q Experience, and the simulated two-asset government-debt portfolio. Consult it for how the uncertainty is loaded, how the risk measure is read out of the amplitude, what the circuit depths actually are, and for the cross-talk and energy relaxation study; the abstract states none of those.",
        relevanceJa:
          "一次資料です。アルゴリズムを提示し、量子振幅推定によってバリュー・アット・リスクや条件付きバリュー・アット・リスクといったリスク指標をゲート方式の量子計算機上で評価すること、取りうる最も浅い回路深さの場合とより速く増大する多項式深さの場合の収束率、そして2つの単純化されたモデル、すなわち IBM Q Experience のような実機での財務省短期証券の例と、シミュレーションによる2資産の国債ポートフォリオの例を報告しています。不確実性をどのように読み込むか、リスク指標を振幅からどのように読み出すか、回路深さが実際にどれほどか、クロストークとエネルギー緩和の検討については要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "amplitude-estimation",
      "option-pricing-amplitude-estimation",
      "amplitude-amplification",
      "quantum-counting",
    ],
  },
  {
    slug: "quantum-kicked-rotator-simulation",
    title: "Quantum simulation of the kicked rotator model",
    titleJa: "キックされた回転子モデルの量子シミュレーション",
    family: "Hamiltonian simulation · model systems",
    classiqPath: "applications/physical_systems/quantum_chaos",
    classiqCategory: "applications",
    classiqGroup: "physical_systems",
    classiqName: "quantum_chaos",
    problem:
      "Simulate the quantum kicked rotator model — used to study quantum chaos, localization and the Anderson transition — with a quantum algorithm that scales better than classical simulation of the same model.",
    problemJa:
      "量子カオス、局在、アンダーソン転移を調べるために用いられる量子キックドローターモデルを、そのモデルの古典的シミュレーションよりもよくスケールする量子アルゴリズムでシミュレートする問題です。",
    idea:
      "Georgeot and Shepelyansky present a quantum algorithm that simulates the quantum kicked rotator model exponentially faster than classical algorithms. They state that this result shows that important physical problems of quantum chaos, localization and the Anderson transition can be modelled efficiently on a quantum computer. They also report a second, related result: a similar algorithm simulates efficiently classical chaos in certain area-preserving maps. The abstract states both results at the level of an asymptotic comparison — exponentially faster, and efficiently — without describing how either algorithm is built, what resource it is measured in, or what base or regime the exponential or the efficient scaling holds over; those specifics, if given at all, are in the paper and not in the abstract read for this record.",
    ideaJa:
      "Georgeot と Shepelyansky は、量子キックドローターモデルを古典アルゴリズムより指数的に高速にシミュレートする量子アルゴリズムを提示しています。著者らは、この結果が、量子カオス、局在、アンダーソン転移という重要な物理的問題を量子計算機上で効率的にモデル化できることを示すと述べています。さらに、関連する第二の結果として、類似のアルゴリズムがある種の面積保存写像における古典カオスを効率的にシミュレートすると報告しています。要旨はいずれの結果も「指数的に」「効率的に」という漸近的な比較の水準で述べるにとどまり、どちらのアルゴリズムがどのように構成されているか、どの資源で測っているか、指数や効率的なスケーリングがどのような底やパラメータ領域で成り立つかは記していません。これらの詳細は、もし示されているとしても論文の中にあり、本記録が読んだ要旨にはありません。",
    complexity:
      "Exponentially faster than classical algorithms, for simulating the quantum kicked rotator model — a statement about the cost of simulating that one dynamical system, not a bound on solving a decision, search, or optimization problem. The abstract gives no big-O expression, no base for the exponential, no qubit or gate count, and no error dependence; a second, separate claim — that a similar algorithm simulates classical chaos in certain area-preserving maps efficiently — is likewise unquantified.",
    complexityBasis:
      'The abstract of arXiv:quant-ph/0010005 states no big-O expression, qubit count, or gate count. Its cost claim is: "We present a quantum algorithm which simulates the quantum kicked rotator model exponentially faster than classical algorithms." That is a claim about simulating a model, not about solving a decision or optimization problem, and the abstract does not say faster in which resource or with what base. The abstract separately states "important physical problems of quantum chaos, localization and Anderson transition can be modelled efficiently on a quantum computer", which names the problems the simulation bears on without attaching a bound to any of them, and "We also show that a similar algorithm simulates efficiently classical chaos in certain area-preserving maps", whose efficiently is likewise left undefined. The Classiq index entry this record covers, applications/physical_systems/quantum_chaos, gives a directory path and a file list and states no bound. Those are the only sources read for this field.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it, and no instance of the kicked rotator model was computed here; the record documents the algorithm as its abstract states it and does not reproduce or verify any published demonstration of it. The index entry read for this record gives only a directory path, applications/physical_systems/quantum_chaos, and a file list, nothing about what those files contain. The exponential speedup the abstract states is for simulating one specific dynamical system, the quantum kicked rotator model, against unnamed classical algorithms for the same task; it is not a claim about solving quantum chaos, localization or the Anderson transition as decision or optimization problems, and the abstract states no base for the exponential, no error dependence, no qubit or gate count, and no regime of validity. What an exponentially faster simulation of a model gives a reader is the ability to compute the model's own dynamics — the same quantities a classical simulation of the kicked rotator would compute, only faster in an unspecified resource — and nothing more: it does not by itself establish a proof about the underlying physics of chaos, localization or the Anderson transition, and the abstract's claim that these can be modelled efficiently is the authors' inference from having an efficient simulator, not a separate, independently bounded result about any of the three phenomena. The second finding, that a similar algorithm efficiently simulates classical chaos in certain area-preserving maps, is stated with the same lack of quantitative detail — no maps are named, no error or resource bound is given, and efficiently is not defined in the abstract. The abstract reports no numerical experiment, no simulation run and no hardware result of the paper's own, so none is carried here, and no comparison against a specific classical algorithm's proven complexity is made — the comparison is against classical algorithms as a class, which is a comparison against a general reference point rather than a proven lower bound for any one classical method.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで回路を構成・コンパイル・シミュレーション・実行したことはなく、キックドローターモデルの具体例を計算したこともありません。本記録は要旨が述べるアルゴリズムをそのまま記述したものであり、公開されている実演を再現・検証したものではありません。本記録が参照した索引項目が与えるのは、applications/physical_systems/quantum_chaos というディレクトリのパスとファイルの一覧だけで、それらのファイルの中身については何も分かりません。要旨が述べる指数的な高速化は、量子キックドローターモデルという一つの力学系をシミュレートする際に、名指しされていない古典アルゴリズム群と比べたものであり、量子カオス・局在・アンダーソン転移を決定問題や最適化問題として解くという主張ではありません。要旨は、指数の底、誤差への依存性、量子ビット数やゲート数、成り立つパラメータ領域のいずれも示していません。あるモデルを指数的に高速にシミュレートできるということが読者に与えるのは、そのモデル自身の力学を計算する能力、すなわち古典的なシミュレーションが計算するのと同じ量を、何らかの未特定の資源についてより速く計算できるということだけであり、それ以上のものではありません。カオス・局在・アンダーソン転移という物理そのものについての証明を与えるものではなく、要旨が述べる「効率的にモデル化できる」という主張は、効率的なシミュレータを得たことからの著者らの推論であって、三つの現象それぞれについて別個に評価された結果ではありません。第二の結果、すなわち類似のアルゴリズムがある種の面積保存写像における古典カオスを効率的にシミュレートするという主張も同様に定量的な詳細を欠いており、対象となる写像の名前も、誤差や資源の評価も示されておらず、「効率的」の定義も要旨にはありません。要旨は論文自身による数値実験、シミュレーションの実行、実機での結果のいずれも報告していないため、本記録にもそれらはありません。また、特定の古典アルゴリズムの証明された計算量との比較でもなく、「古典アルゴリズム」という一般的な参照点との比較であるため、いずれかの古典的手法に対する証明された下界ではありません。",
    tags: ["quantum chaos", "kicked rotator", "localization", "anderson transition", "exponential speedup"],
    source: {
      id: "arxiv:quant-ph/0010005",
      title: "Exponential Gain in Quantum Computing of Quantum Chaos and Localization",
      authors: "B. Georgeot, D. L. Shepelyansky",
      year: "2000",
      url: "https://arxiv.org/abs/quant-ph/0010005",
    },
    literature: [
      {
        title: "Exponential Gain in Quantum Computing of Quantum Chaos and Localization",
        authors: "B. Georgeot, D. L. Shepelyansky",
        year: "2000",
        url: "https://arxiv.org/abs/quant-ph/0010005",
        relevance:
          "Primary source: it presents the quantum algorithm that simulates the quantum kicked rotator model exponentially faster than classical algorithms, states that this makes quantum chaos, localization and the Anderson transition efficiently modellable on a quantum computer, and reports a related algorithm for efficiently simulating classical chaos in certain area-preserving maps. Consult it for how either algorithm is constructed, what resource the speedup is measured in, and any qubit, gate or error bound, none of which the abstract states.",
        relevanceJa:
          "一次資料です。量子キックドローターモデルを古典アルゴリズムより指数的に高速にシミュレートする量子アルゴリズムを提示し、これにより量子カオス・局在・アンダーソン転移を量子計算機上で効率的にモデル化できると述べ、さらにある種の面積保存写像における古典カオスを効率的にシミュレートする関連アルゴリズムを報告しています。いずれのアルゴリズムがどのように構成されているか、高速化がどの資源で測られているか、量子ビット数・ゲート数・誤差の評価については要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "trotter-suzuki-simulation",
      "hamiltonian-simulation-ising",
      "quantum-adiabatic-evolution",
      "quantum-fourier-transform",
    ],
  },
  {
    slug: "wave-equation-simulation",
    title: "Quantum algorithm for simulating the wave equation",
    titleJa: "波動方程式をシミュレートする量子アルゴリズム",
    family: "Quantum differential equations · linear",
    classiqPath: "applications/physical_systems/maxwell_equation",
    classiqCategory: "applications",
    classiqGroup: "physical_systems",
    classiqName: "maxwell_equation",
    problem:
      "Simulate the wave equation under Dirichlet and Neumann boundary conditions on a quantum computer, using Hamiltonian simulation and quantum linear system algorithms as subroutines.",
    problemJa:
      "ディリクレ境界条件およびノイマン境界条件のもとでの波動方程式を、Hamiltonian シミュレーションと量子線形方程式アルゴリズムを部分手続きとして用いる量子アルゴリズムによって、量子計算機上でシミュレートする問題です。",
    idea:
      "Costa, Jordan and Ostrander present a quantum algorithm for simulating the wave equation under Dirichlet and Neumann boundary conditions. The algorithm uses Hamiltonian simulation and quantum linear system algorithms as subroutines, and relies on factorizations of discretized Laplacian operators. The authors state that this factorization allows for improved scaling in truncation errors and improved scaling for state preparation, relative to general-purpose linear differential-equation algorithms; the abstract gives this comparison in qualitative terms only, without a complexity expression for either side. The authors also state that they consider using the same Hamiltonian-simulation approach for Klein-Gordon equations and Maxwell's equations — the abstract goes no further than naming this as something considered, with no algorithm described and no result reported for either equation.",
    ideaJa:
      "Costa、Jordan、Ostrander は、ディリクレ境界条件およびノイマン境界条件のもとでの波動方程式をシミュレートする量子アルゴリズムを提示しています。このアルゴリズムは Hamiltonian シミュレーションと量子線形方程式アルゴリズムを部分手続きとして用い、離散化されたラプラシアン演算子の因数分解に依拠しています。著者らは、この因数分解により、汎用的な線形微分方程式アルゴリズムと比べて、打ち切り誤差のスケーリングと状態準備のスケーリングの双方が改善されると述べています。要旨はこの比較を定性的な言葉でのみ示しており、どちらの側についても計算量の式は与えていません。著者らはまた、同じ Hamiltonian シミュレーションの手法をクライン・ゴルドン方程式とマクスウェル方程式にも用いることを検討していると述べていますが、要旨はこれを「検討している」ことの言及にとどめており、いずれの方程式についてもアルゴリズムの記述や結果の報告はありません。",
    complexity:
      "Improved scaling in truncation error and improved scaling for the cost of state preparation, relative to general-purpose linear differential-equation algorithms, for the wave-equation algorithm this abstract presents. The abstract states this comparison only in those qualitative terms — no complexity expression, exponent, or constant is given for the wave-equation algorithm or for the general-purpose algorithms it is compared against, and no bound at all is given for the separately mentioned, merely considered use of the same approach for Klein-Gordon or Maxwell's equations.",
    complexityBasis:
      'The abstract of arXiv:1711.05394 states no big-O expression, qubit count, or gate count. Its complexity claim is comparative and qualitative: "It relies on factorizations of discretized Laplacian operators to allow for improved scaling in truncation errors and improved scaling for state preparation relative to general purpose linear differential equation algorithms." The abstract also names the subroutines the algorithm is built from — "The algorithm uses Hamiltonian simulation and quantum linear system algorithms as subroutines" — without quoting a cost for either. On the further, separately mentioned use of the same approach, the abstract states only "We also consider using Hamiltonian simulation for Klein-Gordon equations" and, in the same sentence, Maxwell\'s equations — naming both as something considered, with no algorithm described and no result or bound given for either. The Classiq index entry this record covers, applications/physical_systems/maxwell_equation, gives a directory path and a file list (maxwell_2d_simulation.ipynb) and states no bound. Those are the only sources read for this field.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it, no wave-equation instance was solved, and no timing or resource figure was produced here; the record documents the algorithm the abstract states and does not reproduce or verify any published demonstration of it. The index entry read for this record is at applications/physical_systems/maxwell_equation and gives that directory path and a file list, maxwell_2d_simulation.ipynb, nothing about what the file contains. This Classiq directory pairs with a paper whose subject, on its own abstract, is the wave equation, not Maxwell's equations: the abstract's only sentence naming Maxwell's equations is that the authors also consider using Hamiltonian simulation for Klein-Gordon equations and Maxwell's equations, with no algorithm described, no complexity stated, and no result reported for either equation. This record accordingly documents the wave-equation algorithm and treats the Maxwell connection as exactly that tentative — a stated intention to consider the approach, not a demonstrated algorithm for Maxwell's equations — and it should not be read as a record of a quantum algorithm for Maxwell's equations. The improved-scaling claim that is stated concretely applies to the wave-equation algorithm only, is qualitative rather than quantified — no exponent, no constant, no explicit dependence on the error tolerance or the discretization is given — and is a comparison against general-purpose linear differential-equation algorithms as a class, which is a comparison against a stated point of reference rather than a proven lower bound on that class. The abstract states no experiment, simulation run, or hardware result for the wave-equation algorithm, so none is carried here, and nothing here supports a claim about state preparation cost, readout, or hardware feasibility beyond the qualitative improved scaling for state preparation the abstract itself gives.",
    caveatJa:
      "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、具体的な波動方程式の問題例も解いておらず、所要時間や資源量の数値も出していません。本記録は要旨が述べるアルゴリズムを記述したものであり、公開されている実演を再現・検証したものではありません。本記録が参照した索引項目は applications/physical_systems/maxwell_equation にあり、そのディレクトリのパスとファイルの一覧 maxwell_2d_simulation.ipynb を与えるのみで、ファイルの中身については何も分かりません。この Classiq のディレクトリと組になっている論文は、要旨に即して見る限り、その主題が波動方程式であってマクスウェル方程式ではありません。マクスウェル方程式に言及する要旨中の一文は、著者らがクライン・ゴルドン方程式とマクスウェル方程式についても Hamiltonian シミュレーションを用いることを検討しているというものにとどまり、アルゴリズムの記述も、計算量の記載も、いずれの方程式についての結果の報告もありません。したがって本記録は波動方程式のアルゴリズムを記述するものとし、マクスウェルとのつながりは要旨が示す通りの、検討しているという意向の表明にとどめて扱っており、アルゴリズムとして実演されたものではありません。本記録はマクスウェル方程式のための量子アルゴリズムについての記録として読まれるべきではありません。具体的に述べられているスケーリング改善の主張は波動方程式のアルゴリズムにのみ適用され、定量化されておらず、指数も定数も、誤差許容度や離散化への明示的な依存性も示されていません。また、これは汎用的な線形微分方程式アルゴリズムという括りとの比較であって、その括り全体に対する証明された下界ではなく、示された参照点との比較にすぎません。要旨は波動方程式アルゴリズムについて実験、シミュレーションの実行、実機での結果のいずれも報告していないため、本記録にもそれらはありません。また、要旨自身が与える定性的な状態準備のスケーリングの改善を超えて、状態準備のコスト、読み出し、実機での実現可能性について本記録が主張することもありません。",
    tags: ["wave equation", "hamiltonian simulation", "linear systems", "boundary conditions", "laplacian discretization"],
    source: {
      id: "arxiv:1711.05394",
      title: "Quantum Algorithm for Simulating the Wave Equation",
      authors: "Pedro C.S. Costa, Stephen Jordan, Aaron Ostrander",
      year: "2017",
      url: "https://arxiv.org/abs/1711.05394",
    },
    literature: [
      {
        title: "Quantum Algorithm for Simulating the Wave Equation",
        authors: "Pedro C.S. Costa, Stephen Jordan, Aaron Ostrander",
        year: "2017",
        url: "https://arxiv.org/abs/1711.05394",
        relevance:
          "Primary source: it presents the wave-equation algorithm built from Hamiltonian simulation and quantum linear system subroutines, states that factoring the discretized Laplacian improves the scaling of truncation error and of state preparation relative to general-purpose linear differential-equation algorithms, and states that Klein-Gordon equations and Maxwell's equations are considered as further uses of the same Hamiltonian-simulation approach. Consult it for the complexity expressions themselves, for the wave-equation algorithm's qubit and gate counts, and for whatever it says about Klein-Gordon and Maxwell's equations beyond the sentence the abstract gives.",
        relevanceJa:
          "一次資料です。Hamiltonian シミュレーションと量子線形方程式の部分手続きから構成される波動方程式のアルゴリズムを示し、離散化されたラプラシアンを因数分解することで、汎用的な線形微分方程式アルゴリズムに比べて打ち切り誤差と状態準備のスケーリングが改善されると述べ、同じ Hamiltonian シミュレーションの手法のさらなる応用としてクライン・ゴルドン方程式とマクスウェル方程式を検討していると述べています。計算量の式そのもの、波動方程式アルゴリズムの量子ビット数・ゲート数、クライン・ゴルドン方程式とマクスウェル方程式について要旨の一文を超えて論文が述べている内容は、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "linear-differential-equations",
      "hhl-linear-systems",
      "heat-equation-solver",
      "hamiltonian-simulation-ising",
    ],
  },
  {
    slug: "coarse-grained-vqe-intermolecular-interactions",
    title: "Coarse-grained variational quantum eigensolver for intermolecular interactions",
    titleJa: "分子間相互作用のための粗視化変分量子固有値ソルバー",
    family: "Variational quantum eigensolver",
    classiqPath: "applications/chemistry/quantum_drude_oscillator",
    classiqCategory: "applications",
    classiqGroup: "chemistry",
    classiqName: "quantum_drude_oscillator",
    problem:
      "Determine the ground state of weakly-interacting, non-covalently bonded molecules — the weakly-bound intermolecular regime that variational quantum algorithms applied to strongly-bound, covalently-bonded systems with full molecular-orbital bases had left largely unexplored — using a coarse-grained representation of the electronic response suited to a VQA.",
    problemJa:
      "強く結合した共有結合系に対して完全な分子軌道基底を用いる変分量子アルゴリズムでは、これまで大きく手つかずのままであった弱く結合した分子間相互作用の領域について、VQA に適した電子応答の粗視化表現を用いて、弱く相互作用する非共有結合分子の基底状態を求める問題です。",
    idea:
      "Anderson, Kiffner, Barkoutsos, Tavernelli, Crain and Jaksch develop a coarse-grained representation of the electronic response that they state is ideally suited for determining the ground state of weakly interacting molecules using a variational quantum algorithm. Their construction requires qubit numbers that grow linearly with the number of molecules, and they derive scaling behaviour for the number of circuits and measurements required, stating that this compares favourably to traditional variational quantum eigensolver methods — the abstract attaches this favourable comparison to circuits and measurements specifically, separately from the linear qubit count. The authors demonstrate the method on IBM superconducting quantum processors, showing its capability to resolve the dispersion energy as a function of separation for a pair of non-polar molecules, and state that this establishes a means by which quantum computers can model Van der Waals interactions directly from zero-point quantum fluctuations. Within this coarse-grained approximation, they conclude that current-generation quantum hardware is capable of probing energies in this weakly bound but chemically ubiquitous and biologically important regime. They also report performing experiments on simulated and real quantum computers for systems of three, four and five oscillators, and for oscillators with anharmonic onsite binding potentials, stating that the consequences of the latter are unexamined in large systems by classical computational methods but can be incorporated here with low computational overhead.",
    ideaJa:
      "Anderson、Kiffner、Barkoutsos、Tavernelli、Crain、Jaksch は、変分量子アルゴリズム (VQA) を用いて弱く相互作用する分子の基底状態を求めるのに適していると述べる、電子応答の粗視化表現を開発しています。彼らの構成では、必要な量子ビット数は分子の数に対して線形に増加し、必要な回路数と測定数についてはスケーリングの振る舞いを導出し、これが従来の変分量子固有値ソルバー法と比べて有利であると述べています。要旨はこの有利な比較を、線形な量子ビット数とは別に、回路数と測定数に固有のものとして述べています。著者らは IBM の超伝導量子プロセッサ上でこの手法を実演し、一対の非極性分子について分離距離の関数として分散エネルギーを分解できる能力を示し、これにより量子計算機がゼロ点量子ゆらぎから直接ファンデルワールス相互作用をモデル化できる手段が確立されると述べています。この粗視化近似のもとで、著者らは、現行世代の量子ハードウェアが、この弱く結合しているが化学的にありふれ生物学的にも重要な領域のエネルギーを探ることが可能であると結論づけています。さらに、シミュレートされた量子計算機と実機の双方で、3個・4個・5個の振動子からなる系、および非調和なオンサイト結合ポテンシャルを持つ振動子について実験を行ったと報告し、後者の帰結は古典的な計算手法では大規模な系において検討されていないが、ここでは低い計算オーバーヘッドで取り込めると述べています。",
    complexity:
      "Qubit numbers that grow linearly with the number of molecules. Separately, the abstract states that scaling behaviour for the number of circuits and the number of measurements required is derived and compares favourably to traditional variational quantum eigensolver methods, but it gives no explicit function of either quantity and no exponent or constant for the qubit scaling beyond linearly.",
    complexityBasis:
      'The abstract of arXiv:2110.00968 states two separate scaling claims, each attached to a different resource. On qubits: "We require qubit numbers that grow linearly with the number of molecules". On a different pair of resources, scaling is derived but not given as an explicit function: "and derive scaling behaviour for the number of circuits and measurements required, which compare favourably to traditional variational quantum eigensolver methods." No exponent, big-O expression, or constant accompanies either claim, and compare favourably states a direction of comparison, not a bound: what the number of circuits or measurements actually is, as a function of system size, is not given. The Classiq index entry this record covers, applications/chemistry/quantum_drude_oscillator, gives a directory path and a file list and states no bound. Those are the only sources read for this field.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it, no molecule was represented on a quantum processor, and no dispersion energy was computed here; the record documents the algorithm the abstract states and does not reproduce or verify any published demonstration of it. The index entry read for this record is at applications/chemistry/quantum_drude_oscillator and gives that directory path and a file list, quantum_drude_oscillator.ipynb and quantum_drude_oscillator.qmod, nothing about what those files contain; the abstract itself never names a Drude oscillator or any other specific coarse-grained model by name, so this record follows the abstract's own vocabulary — a coarse-grained representation of the electronic response, and oscillators — rather than asserting a model name the abstract does not use. The two scaling claims are kept separate because the abstract attaches them to different resources: the linear-in-the-number-of-molecules claim is for qubit count only, and the favourable-comparison claim is for the number of circuits and measurements only, with no explicit function given for either and no statement connecting the two. Neither claim carries an accuracy target, a convergence guarantee, an ansatz description, or an optimizer, and comparing favourably to traditional variational quantum eigensolver methods is a comparison against a named class of methods, not a proven bound against any one of them. The demonstration on IBM superconducting quantum processors, the resolved dispersion energy for a pair of non-polar molecules, and the experiments on systems of three, four and five oscillators and on oscillators with anharmonic potentials are the paper's own reported experiments, at the sizes it reports, run partly in simulation and partly on real hardware as the abstract states; none of them was repeated, checked, or extended here. The conclusion that current-generation quantum hardware is capable of probing energies in this regime is stated by the authors as holding within their coarse-grained approximation, and it is their conclusion from their own reported experiments, not an independent finding of this record; the abstract does not state the achieved accuracy against a reference calculation, so no accuracy claim is carried here either.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで回路を構成・コンパイル・シミュレーション・実行したことはなく、量子プロセッサ上で分子を表現したことも、分散エネルギーを計算したこともありません。本記録は要旨が述べるアルゴリズムを記述したものであり、公開されている実演を再現・検証したものではありません。本記録が参照した索引項目は applications/chemistry/quantum_drude_oscillator にあり、そのディレクトリのパスとファイルの一覧 quantum_drude_oscillator.ipynb、quantum_drude_oscillator.qmod を与えるのみで、それらのファイルの中身については何も分かりません。要旨自体は「ドルーデ振動子」あるいはそれに類する特定の粗視化モデルの名称を一度も用いていないため、本記録は要旨自体の語彙、すなわち電子応答の粗視化表現、振動子、に従っており、要旨が用いていないモデル名を主張することはしていません。二つのスケーリングに関する主張は、要旨がそれぞれ異なる資源に結び付けているため別々に扱っています。分子数に対して線形であるという主張は量子ビット数のみについてのものであり、有利な比較という主張は回路数と測定数のみについてのもので、いずれについても明示的な関数は与えられておらず、両者を結び付ける記述もありません。いずれの主張にも、精度の目標も、収束の保証も、アンサッツの記述も、最適化器の指定もなく、従来の変分量子固有値ソルバー法と比べて有利というのは名指しされた手法の一群との比較であって、そのいずれか一つに対する証明された評価ではありません。IBM の超伝導量子プロセッサ上での実演、一対の非極性分子についての分散エネルギーの分解、3個・4個・5個の振動子からなる系および非調和ポテンシャルを持つ振動子についての実験は、いずれも論文自身が報告する実験であり、要旨が述べる通り一部はシミュレーションで、一部は実機で行われたもので、それぞれが報告する規模のものです。これらはいずれも本記録のために追試・検証・拡張したものではありません。現行世代の量子ハードウェアがこの領域のエネルギーを探ることが可能であるという結論は、著者らがこの粗視化近似のもとで成り立つとして述べたものであり、著者ら自身の実験からの著者らの結論であって、本記録が独自に確認したものではありません。要旨は参照計算に対する達成精度を述べていないため、精度についての主張も本記録にはありません。",
    tags: ["variational quantum eigensolver", "coarse graining", "intermolecular interactions", "van der waals", "dispersion energy"],
    source: {
      id: "arxiv:2110.00968",
      title: "Coarse grained intermolecular interactions on quantum processors",
      authors: "Lewis W. Anderson, Martin Kiffner, Panagiotis Kl. Barkoutsos, Ivano Tavernelli, Jason Crain, Dieter Jaksch",
      year: "2021",
      url: "https://arxiv.org/abs/2110.00968",
    },
    literature: [
      {
        title: "Coarse grained intermolecular interactions on quantum processors",
        authors: "Lewis W. Anderson, Martin Kiffner, Panagiotis Kl. Barkoutsos, Ivano Tavernelli, Jason Crain, Dieter Jaksch",
        year: "2021",
        url: "https://arxiv.org/abs/2110.00968",
        relevance:
          "Primary source: it develops the coarse-grained electronic-response representation for weakly-interacting molecules, states the linear qubit scaling with the number of molecules and the derived, favourably-compared scaling for circuits and measurements, and reports the IBM superconducting-processor demonstration resolving the dispersion energy of a pair of non-polar molecules and further experiments on systems of three to five oscillators and on anharmonic oscillators. Consult it for the explicit circuit- and measurement-scaling functions, the coarse-grained model's construction, and the accuracy of the reported dispersion energies, none of which the abstract states.",
        relevanceJa:
          "一次資料です。弱く相互作用する分子のための電子応答の粗視化表現を開発し、分子数に対する量子ビット数の線形なスケーリングと、回路数・測定数について導出され有利に比較されるスケーリングを述べ、一対の非極性分子の分散エネルギーを分解する IBM 超伝導プロセッサでの実演、および3個から5個の振動子からなる系や非調和振動子についてのさらなる実験を報告しています。回路数・測定数の明示的なスケーリング関数、粗視化モデルの構成、報告された分散エネルギーの精度は要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["vqe-ground-state-energy", "vqe-hardware-efficient-ansatz", "vqe-measurement-grouping", "operator-coulomb"],
  },
  {
    slug: "environment-assisted-quantum-walk",
    title: "Environment-assisted quantum walks in photosynthetic energy transfer",
    titleJa: "光合成エネルギー移動における環境支援量子ウォーク",
    family: "Quantum walk",
    classiqPath: "applications/chemistry/quantum_walk_fmo",
    classiqCategory: "applications",
    classiqGroup: "chemistry",
    classiqName: "quantum_walk_fmo",
    problem:
      "Determine the role quantum dynamical effects play in the efficiency of exciton (energy) transfer within photosynthetic molecular arrays — such as the Fenna-Matthews-Olson (FMO) protein complex, whose long-lived coherence had recently been demonstrated experimentally — that interact with a thermal bath.",
    problemJa:
      "熱浴と相互作用する光合成分子アレイ、たとえば長寿命のコヒーレンスが最近実験的に示されたフェナ・マシューズ・オルソン (FMO) タンパク質複合体において、量子力学的効果が励起子（エネルギー）移動の効率にどのような役割を果たすかを明らかにする問題です。",
    idea:
      "Mohseni, Rebentrost, Lloyd and Aspuru-Guzik develop a theoretical framework for studying the role of quantum interference effects in the energy-transfer dynamics of molecular arrays that interact with a thermal bath, working within the Lindblad formalism. To do this, they generalize continuous-time quantum walks to non-unitary and temperature-dependent dynamics in Liouville space, derived from a microscopic Hamiltonian. They explore the different physical effects of coherence and decoherence processes through a universal measure of the energy-transfer efficiency and its susceptibility. Applying the framework to the Fenna-Matthews-Olson (FMO) protein complex — for which direct evidence of long-lived coherence had recently been demonstrated experimentally, citing Engel et al., Nature 446, 782 (2007) — they demonstrate that an effective interplay between the free Hamiltonian and thermal fluctuations in the environment leads to a substantial increase in the complex's energy-transfer efficiency, from about 70% to 99%. That figure is the paper's own result about the physical efficiency of energy transfer within the FMO complex, obtained from the generalized quantum-walk framework the paper develops; it is not a claim about the running time, resource cost, or speedup of an algorithm, and the abstract states none of those for the framework itself.",
    ideaJa:
      "Mohseni、Rebentrost、Lloyd、Aspuru-Guzik は、熱浴と相互作用する分子アレイのエネルギー移動ダイナミクスにおいて量子干渉効果が果たす役割を調べるための理論的枠組みを、Lindblad 形式のもとで構築しています。そのために、微視的な Hamiltonian から導かれる Liouville 空間における非ユニタリかつ温度に依存する力学へと、連続時間量子ウォークを一般化しています。コヒーレンスと脱コヒーレンス過程のさまざまな物理的効果を、エネルギー移動効率とその感受性に対する普遍的な尺度を通じて調べています。長寿命のコヒーレンスの直接的な証拠が最近実験的に示された（Engel et al., Nature 446, 782 (2007) を引用）フェナ・マシューズ・オルソン (FMO) タンパク質複合体にこの枠組みを適用し、自由 Hamiltonian と環境の熱ゆらぎとの効果的な相互作用が、この複合体のエネルギー移動効率をおよそ70%から99%へと大幅に増大させることを示しています。この数値は、論文が構築した一般化された量子ウォークの枠組みから得られた、FMO 複合体内でのエネルギー移動の物理的効率についての論文自身の結果であり、アルゴリズムの実行時間、資源コスト、高速化についての主張ではありません。要旨は枠組み自体についてそれらのいずれも述べていません。",
    complexity: "",
    complexityBasis:
      'The abstract of arXiv:0805.2741 states no algorithmic complexity, running time, gate count, or qubit count. Its one quantitative result is a physical efficiency figure for a specific molecular complex: "we demonstrate that for the FMO complex an effective interplay between free Hamiltonian and thermal fluctuations in the environment leads to a substantial increase in energy transfer efficiency from about 70% to 99%." That is a result about the transfer efficiency of the FMO complex itself, obtained from the paper\'s theoretical framework, not a bound on the cost of the generalized quantum walk or of any other algorithm; the abstract states no runtime, no query count, and no comparison of computational cost for the framework it develops. The Classiq index entry this record covers, applications/chemistry/quantum_walk_fmo, gives a directory path and a file list and states no bound. Those are the only sources read for this field, and the complexity field is left empty on purpose rather than filled with an efficiency figure that is not a complexity bound.',
    caveat:
      "This is a literature record. No circuit was built, compiled, simulated or run for it, and no energy-transfer efficiency was computed here; the record documents the theoretical framework the abstract states and does not reproduce or verify any published demonstration of it. The index entry read for this record is at applications/chemistry/quantum_walk_fmo and gives that directory path and a file list, quantum_walk_fmo.ipynb and quantum_walk_fmo.qmod, nothing about what those files contain. The Fenna-Matthews-Olson (FMO) complex is squarely within the abstract's scope — the abstract names it directly and reports a result specifically about it — but the 70%-to-99% figure is a physical result about that complex's own energy-transfer efficiency, computed from the paper's generalized continuous-time-quantum-walk framework, and it is not an algorithmic speedup, a running time, or a resource bound for any computation; the abstract states none of the latter for the framework at all. The experimental citation in the abstract, to Engel et al., Nature 446, 782 (2007), is for a different, earlier finding — direct evidence of long-lived coherence in the FMO complex's dynamics — and is not the source of the 70%-to-99% figure, which the present paper's abstract presents as its own theoretical demonstration. The generalization of continuous-time quantum walks to non-unitary, temperature-dependent Lindblad dynamics is the paper's methodological contribution, and the abstract does not state that this framework is intended to run as an algorithm on a quantum computer, does not give a circuit or gate representation of it, and does not compare its cost to that of any classical method for computing the same efficiency. Nothing here, therefore, supports a claim that the paper demonstrates a quantum-computational advantage: what it demonstrates, on the abstract's own terms, is a physical mechanism — the interplay of a molecule's free Hamiltonian with thermal fluctuations — that raises transfer efficiency in one named complex, reported as the paper's own finding and not repeated or checked here.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで回路を構成・コンパイル・シミュレーション・実行したことはなく、エネルギー移動効率を計算したこともありません。本記録は要旨が述べる理論的枠組みを記述したものであり、公開されている実演を再現・検証したものではありません。本記録が参照した索引項目は applications/chemistry/quantum_walk_fmo にあり、そのディレクトリのパスとファイルの一覧 quantum_walk_fmo.ipynb、quantum_walk_fmo.qmod を与えるのみで、それらのファイルの中身については何も分かりません。フェナ・マシューズ・オルソン (FMO) 複合体は要旨の範囲に明確に含まれており、要旨はこれを直接名指しし、それについての結果を報告しています。しかし70%から99%という数値は、この論文が構築した一般化連続時間量子ウォークの枠組みから計算された、この複合体自身のエネルギー移動効率についての物理的な結果であって、いかなる計算についてもアルゴリズムの高速化、実行時間、資源の評価ではありません。要旨は枠組み自体についてこれらのいずれも述べていません。要旨中の実験についての引用、Engel et al., Nature 446, 782 (2007) は、FMO 複合体のダイナミクスにおける長寿命コヒーレンスの直接的証拠という、別の、より早い時期の知見についてのものであり、70%から99%という数値の出所ではありません。この数値は、本論文の要旨が自らの理論的な実証として提示しているものです。連続時間量子ウォークを非ユニタリかつ温度に依存する Lindblad 力学へ一般化したことが本論文の方法論上の貢献であり、要旨は、この枠組みが量子計算機上でアルゴリズムとして実行されることを意図しているとは述べておらず、その回路表現やゲート表現も与えておらず、同じ効率を計算する古典的な手法とのコスト比較も行っていません。したがって、本記録は論文が量子計算上の優位性を示しているという主張を裏付けるものではありません。要旨自身の言葉で論文が示しているのは、ある分子の自由 Hamiltonian と熱ゆらぎとの相互作用が、名指しされた一つの複合体における移動効率を高めるという物理的な機構であり、これは論文自身の知見として報告されているものであって、本記録のために追試・検証したものではありません。",
    tags: ["quantum walk", "photosynthesis", "energy transfer", "lindblad dynamics", "fmo complex"],
    source: {
      id: "arxiv:0805.2741",
      title: "Environment-Assisted Quantum Walks in Photosynthetic Energy Transfer",
      authors: "Masoud Mohseni, Patrick Rebentrost, Seth Lloyd, Alán Aspuru-Guzik",
      year: "2008",
      url: "https://arxiv.org/abs/0805.2741",
    },
    literature: [
      {
        title: "Environment-Assisted Quantum Walks in Photosynthetic Energy Transfer",
        authors: "Masoud Mohseni, Patrick Rebentrost, Seth Lloyd, Alán Aspuru-Guzik",
        year: "2008",
        url: "https://arxiv.org/abs/0805.2741",
        relevance:
          "Primary source: it develops the Lindblad-formalism theoretical framework and the generalization of continuous-time quantum walks to non-unitary, temperature-dependent Liouville-space dynamics, and reports the resulting increase in the FMO complex's energy-transfer efficiency from about 70% to 99%. Consult it for the universal efficiency-and-susceptibility measure, the microscopic Hamiltonian the dynamics are derived from, and the derivation connecting the free-Hamiltonian/thermal-fluctuation interplay to the reported efficiency figure, none of which the abstract states in detail.",
        relevanceJa:
          "一次資料です。Lindblad 形式による理論的枠組みと、連続時間量子ウォークを非ユニタリかつ温度に依存する Liouville 空間での力学へ一般化したことを示し、その結果として得られる FMO 複合体のエネルギー移動効率のおよそ70%から99%への増大を報告しています。エネルギー移動効率とその感受性に対する普遍的な尺度、力学の導出元となる微視的 Hamiltonian、自由 Hamiltonian と熱ゆらぎとの相互作用を報告された効率の数値に結びつける導出については、要旨に詳細な記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["quantum-walk-line", "welded-tree-traversal", "element-distinctness", "gibbs-state-sampling"],
  },
  // The one record in this file written from a full-text read of a PDF rather
  // than from an arXiv abstract, because the owner supplied the PDF himself on
  // ai-ops#42 after an earlier session could not reach the paper. Everything
  // below comes from that document, Sci Rep 15, 28508 (2025), and the numbers are
  // the paper's own prose figures rather than its tables — see the caveat for why.
  //
  // Note what this record is NOT: the demonstration sits under Classiq's
  // `optimization` shelf beside thirteen QAOA demonstrations, and it is not one
  // of them. The paper's method has no cost Hamiltonian and no mixer. It says
  // only that it is "based on variational optimization methods similar to" VQE
  // and QAOA, and that similarity is not a citation.
  {
    slug: "quantum-forward-kinematics-inverse-solve",
    title: "Quantum computation for robot posture optimization",
    titleJa: "ロボット姿勢最適化のための量子計算",
    family: "Optimization · variational kinematics",
    classiqPath: "applications/optimization/robust_posture_optimization",
    classiqCategory: "applications",
    classiqGroup: "optimization",
    classiqName: "robust_posture_optimization",
    problem:
      "Given a target position for a robot manipulator's end effector, find joint angles that reach"
      + " it — the inverse kinematics problem, which has no analytical solution for a general"
      + " 6-degree-of-freedom arm and admits many joint configurations at once for a redundant one.",
    problemJa:
      "ロボットマニピュレータの手先に目標位置が与えられたとき、そこへ到達する関節角度を求める逆運動学の問題です。一般の6自由度アームでは解析解が存在せず、冗長なアームでは同じ手先位置を与える関節配置が複数存在します。",
    idea:
      "The method turns a qubit into a link. A qubit's state is a point on the Bloch sphere, so one"
      + " qubit can carry the posture of one robot link: applying RX, RY and RZ rotation gates"
      + " orients it, and the expectation values measured along X, Y and Z are coordinates on that"
      + " sphere, which a classical computer multiplies by the link's length and sums to give the"
      + " end-effector position. That is forward kinematics on a quantum circuit. Inverse kinematics"
      + " is then a loop around it: the circuit computes the end-effector position for a set of joint"
      + " angles, the difference from the target is evaluated classically, and COBYLA adjusts the"
      + " angles until the difference falls below a threshold. The paper's second contribution is to"
      + " replace independent per-qubit rotations with the two-qubit RXX, RYY and RZZ gates, which"
      + " entangle the qubit for a parent link with the qubit for its child. The authors argue this"
      + " represents the physical fact that rotating a parent link moves the child, and report that"
      + " it converges in fewer iterations and to a better solution. On their two-joint"
      + " six-degree-of-freedom model they report that after 30 iterations the total error was about"
      + " 1.85 m without entanglement and 1.18 m with it, which they describe as a 36% reduction in"
      + " overall positional error, and that the entangled circuit reached nearly the same accuracy"
      + " in 10 iterations (1.17 m) as in 30 (1.21 m) — from which they infer that entanglement"
      + " contributes most strongly to the early phase of the optimisation. Repeating the comparison"
      + " on a 64-qubit superconducting machine, they report the total error after 30 iterations"
      + " falling from about 1.84 m to 1.04 m, which they call a roughly 43% improvement, and note"
      + " that hardware accuracy is below the simulation's because of noise. Because the posture of"
      + " a link costs exactly one qubit, they state that a three-link manipulator needs three qubits"
      + " and a sixteen-link humanoid sixteen, which they call well within present-day hardware.",
    ideaJa:
      "この手法は、1つの量子ビットを1本のリンクに対応させます。量子ビットの状態はBloch球面上の点であるため、1量子ビットでロボットの1リンクの姿勢を表現できます。RX・RY・RZの回転ゲートを作用させて向きを定めると、X・Y・Z方向に測定した期待値がその球面上の座標となり、古典計算機がこれにリンク長を掛けて総和をとることで手先位置が得られます。これが量子回路上での順運動学です。逆運動学はその周りのループとして構成されます。まず与えられた関節角度に対して回路が手先位置を計算し、目標との差を古典側で評価し、COBYLAが差が閾値を下回るまで角度を更新します。第二の貢献は、量子ビットごとに独立な回転ゲートを、2量子ビットに作用するRXX・RYY・RZZゲートで置き換えた点です。これにより親リンクの量子ビットと子リンクの量子ビットが量子もつれ状態になります。著者らは、これが親リンクの回転が子リンクを動かすという物理的事実を表現していると論じ、より少ない反復回数でより良い解に収束すると報告しています。1リンクの姿勢がちょうど1量子ビットで済むため、3リンクのマニピュレータには3量子ビット、16リンクのヒューマノイドには16量子ビットが必要であるとし、これは現在のハードウェアで十分に実現可能な範囲だと述べています。",
    complexity: "",
    complexityBasis:
      "The full text of doi:10.1038/s41598-025-12109-0 was read for this record — the publisher PDF"
      + " the owner supplied, not an abstract — and it states no complexity bound of any kind: no"
      + " asymptotic scaling in the number of links or degrees of freedom, no gate or query count,"
      + " no iteration bound, and no comparison of running time against a classical inverse-"
      + " kinematics solver. What it reports instead are measured iteration counts and positional"
      + " errors for one two-joint six-degree-of-freedom arm, which are quoted in this record's"
      + " explanation and bounded by its caveat. The paper's only resource statement is a qubit"
      + " count: one qubit per link, so three qubits for a three-link manipulator and sixteen for a"
      + " sixteen-link humanoid. The Classiq index entry this record covers gives the directory path"
      + " applications/optimization/robust_posture_optimization and two file names, and states no"
      + " bound.",
    caveat:
      "This is a literature record. No circuit was constructed, compiled, simulated or run for it,"
      + " no robot model was posed, and no inverse kinematics problem was solved here; the figures"
      + " below are the paper's reports of its own experiments, attributed to it and not reproduced."
      + " Everything is measured on a single model — one two-link arm with three rotational degrees"
      + " of freedom at each of two joints, with a target at (0.6, 1.0, 0.2) — so nothing here"
      + " establishes behaviour at the sixteen-link scale the paper names as feasible. The reported"
      + " gains are comparisons against the same method without entanglement and against a SciPy"
      + " optimisation of the same objective, not against the analytical or numerical solvers used"
      + " in production robotics, and the paper claims no speedup: it states no running time for any"
      + " configuration, and the improvements it does report are in accuracy and iteration count."
      + " **Two numbers in the paper do not agree with each other, and this record does not pick"
      + " one.** Its Results section says the error 'remains at 0.5 m after 30 iterations when no"
      + " entanglement is used', while its Discussion gives 'approximately 1.85 m' for what reads as"
      + " the same condition; the paper does not reconcile them. Relatedly, Tables 3 and 4 are"
      + " captioned as sums of squared errors while the Discussion describes the same figures as"
      + " Euclidean error in metres, so this record quotes only the prose figures and a reader who"
      + " needs the per-axis values should open the tables in the PDF rather than trust a"
      + " transcription of them. The authors state two limitations themselves: the method cannot be"
      + " applied to robots with only prismatic joints, because the formulation represents rotational"
      + " joints, and the entanglement captures only a unidirectional parent-to-child dependency"
      + " rather than a bidirectional interaction. Finally, the demonstration's directory is named"
      + " robust_posture_optimization, but neither the notebook's title nor the paper's uses the word"
      + " robust, and nothing read here reports a robustness result.",
    caveatJa:
      "本項目は文献に基づく記録です。ここで回路の構成・コンパイル・シミュレーション・実行を行ったことはなく、ロボットモデルを設定したことも、逆運動学の問題を解いたこともありません。以下の数値は論文が自らの実験について報告したものであり、その帰属は論文にあり、本記録が再現したものではありません。すべての測定は単一のモデル、すなわち2つの関節がそれぞれ3つの回転自由度をもつ2リンクアーム1体、目標位置 (0.6, 1.0, 0.2) に対して行われており、論文が実現可能と述べる16リンク規模での挙動については何も示されていません。報告されている改善は、同じ手法でもつれを用いない場合との比較、および同じ目的関数をSciPyで最適化した場合との比較であって、実運用のロボット工学で用いられる解析的あるいは数値的なソルバとの比較ではありません。また論文は高速化を主張していません。いずれの構成についても実行時間を述べておらず、報告されている改善は精度と反復回数に関するものです。**論文中の2つの数値は互いに整合しておらず、本記録はどちらかを選ぶことはしません。** 結果の節では、もつれを用いない場合の誤差は「30回の反復の後も0.5 mのまま」とされる一方、考察の節では同じ条件と読める場合について「およそ1.85 m」とされており、論文はこの相違を説明していません。関連して、表3および表4の見出しは誤差の二乗和とされていますが、考察では同じ数値がメートル単位のユークリッド誤差として説明されています。そのため本記録は本文中の記述のみを引用しており、軸ごとの値を必要とする読者は、転記を信頼せずPDFの表を直接参照してください。著者ら自身が2つの限界を挙げています。第一に、定式化が回転関節を表現するものであるため、直動関節のみで動作するロボットには適用できません。第二に、もつれが捉えているのは親から子への一方向の依存関係のみであり、双方向の相互作用ではありません。最後に、デモのディレクトリ名は robust_posture_optimization ですが、ノートブックの表題にも論文の表題にも robust の語はなく、ここで読んだ範囲にロバスト性に関する結果の報告はありません。",
    tags: [
      "inverse kinematics",
      "robotics",
      "variational hybrid",
      "entangling gates",
      "bloch sphere encoding",
    ],
    source: {
      id: "doi:10.1038/s41598-025-12109-0",
      title: "Quantum computation for robot posture optimization",
      authors: "Takuya Otani, Atsuo Takanishi, Nobuyuki Hara, Yutaka Takita, Koichi Kimura",
      year: "2025",
      url: "https://doi.org/10.1038/s41598-025-12109-0",
    },
    literature: [
      {
        title: "Quantum computation for robot posture optimization",
        authors: "Takuya Otani, Atsuo Takanishi, Nobuyuki Hara, Yutaka Takita, Koichi Kimura",
        year: "2025",
        url: "https://doi.org/10.1038/s41598-025-12109-0",
        relevance:
          "Primary source, and the demonstration's only reference — the Classiq notebook cites this"
          + " paper and nothing else. Read in full text rather than in abstract. It supplies the"
          + " Bloch-sphere encoding of a link's posture, the forward-kinematics circuit, the COBYLA"
          + " loop that closes inverse kinematics around it, and the RXX/RYY/RZZ construction that"
          + " entangles a parent link's qubit with its child's. It reports a Fujitsu 40-qubit"
          + " mpiQulacs simulation and a run on the 64-qubit superconducting machine of the RIKEN"
          + " RQC-Fujitsu Collaboration Center. Consult it for the D-H parameters of the model arm"
          + " in its Table 1, for the per-axis figures in Tables 3 and 4, and for the derivation"
          + " relating the RXX rotation angle to concurrence — and note that it states no complexity"
          + " bound and no comparison against a production inverse-kinematics solver.",
        relevanceJa:
          "一次資料であり、デモが挙げる唯一の参考文献です。Classiqのノートブックはこの論文のみを引用しています。要旨ではなく全文を読みました。リンクの姿勢をBloch球面上に符号化する方法、順運動学の回路、その周りで逆運動学を閉じるCOBYLAのループ、そして親リンクの量子ビットと子リンクの量子ビットをもつれさせるRXX・RYY・RZZの構成を与えています。富士通の40量子ビットmpiQulacsによるシミュレーションと、理研RQC-富士通連携センターの64量子ビット超伝導量子計算機での実行を報告しています。モデルアームのD-Hパラメータは表1、軸ごとの数値は表3および表4、RXXの回転角と concurrence を関係づける議論については、原論文で確認してください。なお、計算量の上界は述べられておらず、実運用の逆運動学ソルバとの比較も行われていません。",
      },
    ],
    relatedSlugs: [
      "vqe-ground-state-energy",
      "qaoa-combinatorial-optimization",
      "vqe-hardware-efficient-ansatz",
    ],
  },
];

/** The Classiq directory each record covers — read by scripts/check-classiq-parity.mjs. */
export const CLASSIQ_PARITY_COVERAGE: ReadonlyArray<{ slug: string; classiqPath: string }> =
  CLASSIQ_ALGORITHMS.map((concept) => ({ slug: concept.slug, classiqPath: concept.classiqPath }));

function classiqEntry(concept: ClassiqAlgorithm): PublicRepositoryEntry {
  const complexityLine = concept.complexity === ""
    ? "Not stated by the sources read"
    : concept.complexity;
  const shelf = concept.classiqGroup === null
    ? concept.classiqCategory
    : `${concept.classiqCategory} · ${concept.classiqGroup}`;
  return makeReferenceEntry({
    slug: concept.slug,
    title: concept.title,
    titleJa: concept.titleJa,
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: concept.family,
    framework: "Qiskit",
    status: "verified_caveats",
    verification:
      "Literature record · the algorithm a Classiq library entry demonstrates, checked against that"
      + " algorithm's primary reference on its arXiv abs page",
    verificationMethods: ["research_paper"],
    method:
      "Curation only. The Classiq library publishes this subject as the directory"
      + ` \`${concept.classiqPath}\`, pinned in scripts/classiq-parity/classiq-index.json; this record`
      + " documents the algorithm that entry demonstrates, not the demonstration. The primary"
      + " reference's title, authors and submission year were read from its arXiv abs page, and the"
      + ` complexity claim taken from a clause of that paper's abstract (${concept.complexityBasis}).`
      + " No circuit was constructed, simulated or run, and no Qmod model was executed.",
    result:
      "Pass · the record's problem statement and primary reference agree with the sources named above.",
    caveat: concept.caveat,
    exportStatus: "Literature reference · no circuit supplied",
    provenance: "Leona Quantum Classiq-parity intake",
    updatedAt: "2026-08-12",
    description: concept.problem,
    descriptionJa: concept.problemJa,
    introduction: `${concept.problem} ${concept.idea}`,
    introductionJa: `${concept.problemJa}${concept.ideaJa}`,
    explanation:
      `${concept.idea} The Classiq library carries this subject under ${shelf}. ${
        concept.complexity === ""
          ? `The sources read state no complexity bound for this record (${concept.complexityBasis}).`
          : `Reported cost: ${concept.complexity}.`
      }`,
    explanationJa:
      `${concept.ideaJa}Classiqのライブラリでは「${shelf}」の下に収録されています。${
        concept.complexity === ""
          ? "参照した出典は本記録に対する計算量の上界を述べていません。"
          : `報告されている計算量は ${concept.complexity} です。`
      }`,
    tags: concept.tags,
    resources: [
      { label: "Record type", value: "Literature reference" },
      { label: "Classiq library entry", value: concept.classiqName },
      { label: "Reported cost", value: complexityLine },
    ],
    metadata: [
      { label: "Classiq publication directory", value: concept.classiqPath },
      { label: "Classiq shelf", value: shelf },
      { label: "Complexity basis", value: concept.complexityBasis },
      { label: "Circuit", value: "Not supplied" },
    ],
    sourceTitle: concept.source.title,
    sourceUrl: concept.source.url,
    sourceLicense: "Citation metadata only; source publication terms apply",
    wires: ["problem", "algorithm", "readout"],
    operations: [
      { label: "encode", qubits: [0], tone: "neutral" },
      { label: "transform", qubits: [0, 1], tone: "accent" },
      { label: "measure", qubits: [1, 2], tone: "warn" },
    ],
    outcomes: [],
    code:
      `ALGORITHM: ${concept.title}\n`
      + `PROBLEM: ${concept.problem}\n`
      + `IDEA: ${concept.idea}\n`
      + `REPORTED COST: ${complexityLine}\n`
      + `BASIS: ${concept.complexityBasis}\n`
      + `DEMONSTRATED BY: the Classiq library entry ${concept.classiqPath}\n`
      + `PRIMARY SOURCE: ${concept.source.authors} (${concept.source.year}), ${concept.source.title} — ${concept.source.url}\n\n`
      + "This is a literature reference record, not an executable circuit.",
    filename: `${concept.slug}.txt`,
    language: "text",
    relatedSlugs: concept.relatedSlugs,
    // Same rule as the Zoo file: a concept that already cites its own source keeps
    // its own wording rather than being cited twice under two `relevance` strings.
    literature: (concept.literature ?? []).some((cited) => cited.url === concept.source.url)
      ? concept.literature ?? []
      : [
        {
          title: concept.source.title,
          authors: concept.source.authors,
          year: concept.source.year,
          url: concept.source.url,
          relevance: `Primary reference for ${concept.title.toLowerCase()}; the source of this record's cost claim.`,
          relevanceJa: `${concept.titleJa}の主要文献であり、本記録の計算量の出典です。`,
        },
        ...(concept.literature ?? []),
      ],
  });
}

export const CLASSIQ_PARITY_ENTRIES: PublicRepositoryEntry[] = CLASSIQ_ALGORITHMS.map(classiqEntry);
