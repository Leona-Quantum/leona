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
