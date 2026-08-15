import { generatePortableCircuitCode } from "../circuit-conversion";
import type { PortableCircuit, PortableCircuitGate } from "../circuit-frameworks";
import { makeReferenceEntry } from "./factory";
import type { PublicRepositoryEntry } from "./types";

type Step = PortableCircuit["steps"][number];

type CircuitFamily = {
  slug: string;
  title: string;
  titleJa: string;
  family: string;
  description: string;
  descriptionJa: string;
  tags: string[];
  /**
   * The narrowest width at which this circuit's motif is fully present and not
   * degenerate. Published together with SHOWCASE_WIDTH and nothing between.
   */
  minWidth: number;
  build: (width: number) => PortableCircuit;
};

/**
 * Every family publishes exactly TWO records: its own `minWidth`, and this.
 *
 * It used to publish eight — 2, 3, 4, 5, 6, 8, 12 and 16 — so 15 circuits
 * occupied 120 of 369 catalog records, and `/repository` shipped all 120 in its
 * HTML to draw 24 rows. Owner ruling (ai-ops issue 116): "records only need
 * amount of qubits that correspond to lowest needed to demonstrate all general
 * function of the algorithm, and one high [...] The rest of the variants can be
 * permanently deleted, as the user themselves can use our ai and studio to build
 * the other variants."
 *
 * The pair is chosen so the two together carry the whole claim: `minWidth` shows
 * the motif in its smallest honest form, and SHOWCASE_WIDTH shows that it scales.
 * The six widths in between were interpolation — each one derivable from the
 * other two by the reader, and by the studio.
 */
const SHOWCASE_WIDTH = 16;

/**
 * `minWidth` is 3 for fourteen of the fifteen families, and that is a result
 * rather than a default. Three is where a width-scaled motif first *repeats*:
 * `chain(w)` has two links, `ringEdges(w)` actually closes (at w=2 it emits no
 * closing edge, so a "ring" is indistinguishable from a line), the brickwork's
 * odd layer becomes non-empty, the parity oracle first includes one input qubit
 * and excludes another, and the swap network stops being SWAP-then-SWAP-back on
 * a single pair. At width 2 each of those either vanishes or collapses into a
 * Bell pair the corpus already publishes standalone.
 *
 * The exception is the Bell-pair ladder at 4, and it is the one width the owner
 * ruled on directly (ai-ops issue 124): "entry with 2q is bell state, 4q variant
 * is bell pair ladder". It shipped at 2 first, following his earlier example
 * ("Bell state: 2q and 16q"), and the flag on that PR is what produced the
 * ruling. Two rungs are what make it a ladder; one rung is the Bell pair this
 * corpus already publishes standalone as `bell-state-qiskit`, so at 2q the
 * family's smallest member was a second copy of another record under a different
 * name.
 *
 * He also offered to delete the family outright "if there is no substantive
 * difference in the use". There is: from 4 qubits up this is a bank of DISJOINT
 * pairs, and what it exercises is parallel two-qubit-gate structure — a compiler
 * and hardware property that a single Bell pair cannot exhibit at any width. One
 * pair is an entanglement example; several at once is a benchmark. So the family
 * stays and its floor moves.
 */
const widthsFor = (family: CircuitFamily): number[] =>
  family.minWidth === SHOWCASE_WIDTH ? [SHOWCASE_WIDTH] : [family.minWidth, SHOWCASE_WIDTH];
const angle = (index: number) => `${(index % 7) + 1}*pi/8`;
const single = (gate: PortableCircuitGate, qubit: number, param?: string): Step => ({
  gate,
  qubits: [qubit],
  ...(param ? { param } : {}),
});
const pair = (gate: "CX" | "CZ" | "SWAP", a: number, b: number): Step => ({ gate, qubits: [a, b] });
const all = (width: number, gate: PortableCircuitGate, param?: (qubit: number) => string): Step[] => (
  Array.from({ length: width }, (_, qubit) => single(gate, qubit, param?.(qubit)))
);
const chain = (width: number, gate: "CX" | "CZ" | "SWAP"): Step[] => (
  Array.from({ length: width - 1 }, (_, qubit) => pair(gate, qubit, qubit + 1))
);
const ringEdges = (width: number): Array<[number, number]> => [
  ...Array.from({ length: width - 1 }, (_, qubit) => [qubit, qubit + 1] as [number, number]),
  ...(width > 2 ? [[width - 1, 0] as [number, number]] : []),
];

const CIRCUIT_FAMILIES: CircuitFamily[] = [
  {
    slug: "benchmark-ghz-chain",
    title: "GHZ chain benchmark",
    titleJa: "GHZチェーン・ベンチマーク",
    family: "Entanglement benchmark",
    description: "A width-scaled GHZ preparation circuit with one Hadamard and a nearest-neighbor CNOT chain.",
    descriptionJa: "1つのHadamardと最近接CNOTチェーンで構成する、幅可変のGHZ状態準備回路です。",
    tags: ["GHZ", "entanglement", "benchmark"],
    minWidth: 3,
    build: (width) => ({ qubitCount: width, steps: [single("H", 0), ...chain(width, "CX")], measure: true }),
  },
  {
    slug: "benchmark-linear-cluster",
    title: "Linear cluster-state benchmark",
    titleJa: "線形クラスター状態ベンチマーク",
    family: "Graph-state benchmark",
    description: "A linear graph-state preparation circuit using one Hadamard per qubit and nearest-neighbor CZ edges.",
    descriptionJa: "各量子ビットのHadamardと最近接CZエッジで線形グラフ状態を準備する回路です。",
    tags: ["cluster state", "graph state", "CZ"],
    minWidth: 3,
    build: (width) => ({ qubitCount: width, steps: [...all(width, "H"), ...chain(width, "CZ")], measure: true }),
  },
  {
    slug: "benchmark-ring-graph",
    title: "Ring graph-state benchmark",
    titleJa: "リング・グラフ状態ベンチマーク",
    family: "Graph-state benchmark",
    description: "A cyclic graph-state preparation circuit with Hadamards followed by CZ interactions around a ring.",
    descriptionJa: "Hadamardの後にリング上のCZ相互作用を適用して巡回グラフ状態を準備する回路です。",
    tags: ["graph state", "ring", "entanglement"],
    minWidth: 3,
    build: (width) => ({ qubitCount: width, steps: [...all(width, "H"), ...ringEdges(width).map(([a, b]) => pair("CZ", a, b))], measure: true }),
  },
  {
    slug: "benchmark-bell-pair-ladder",
    title: "Bell-pair ladder benchmark",
    titleJa: "Bellペア・ラダー・ベンチマーク",
    family: "Entanglement benchmark",
    description: "A bank of disjoint Bell-pair preparations that exposes parallel two-qubit-gate structure.",
    descriptionJa: "互いに独立なBellペアを並列準備し、2量子ビットゲートの並列性を示す回路です。",
    tags: ["Bell pair", "parallelism", "CNOT"],
    minWidth: 4,
    build: (width) => ({
      qubitCount: width,
      steps: Array.from({ length: Math.floor(width / 2) }, (_, index) => [single("H", index * 2), pair("CX", index * 2, index * 2 + 1)]).flat(),
      measure: true,
    }),
  },
  {
    slug: "benchmark-hea-ry-cx",
    title: "RY-CX hardware-efficient ansatz",
    titleJa: "RY-CXハードウェア効率型アンサッツ",
    family: "VQE ansatz benchmark",
    description: "A reproducible hardware-efficient VQE layer with parameterized RY rotations and a linear CNOT entangler.",
    descriptionJa: "パラメータ付きRY回転と線形CNOTエンタングラーを用いる、再現可能なVQE層です。",
    tags: ["VQE", "hardware-efficient ansatz", "RY"],
    minWidth: 3,
    build: (width) => ({ qubitCount: width, steps: [...all(width, "RY", angle), ...chain(width, "CX")], measure: true }),
  },
  {
    slug: "benchmark-hea-rzry-cz",
    title: "RZ-RY-CZ hardware-efficient ansatz",
    titleJa: "RZ-RY-CZハードウェア効率型アンサッツ",
    family: "VQE ansatz benchmark",
    description: "A two-axis variational layer followed by a nearest-neighbor CZ entangling pattern.",
    descriptionJa: "2軸の変分回転に最近接CZエンタングル層を組み合わせたアンサッツです。",
    tags: ["VQE", "hardware-efficient ansatz", "CZ"],
    minWidth: 3,
    build: (width) => ({ qubitCount: width, steps: [...all(width, "RZ", angle), ...all(width, "RY", (q) => angle(q + 2)), ...chain(width, "CZ")], measure: true }),
  },
  {
    slug: "benchmark-ising-trotter",
    title: "Ising Trotter-step benchmark",
    titleJa: "Ising Trotterステップ・ベンチマーク",
    family: "Hamiltonian simulation",
    description: "A first-order nearest-neighbor ZZ evolution scaffold expressed as CNOT–RZ–CNOT blocks.",
    descriptionJa: "最近接ZZ時間発展をCNOT–RZ–CNOTブロックで表す一次Trotter回路です。",
    tags: ["Ising", "Trotter", "Hamiltonian simulation"],
    minWidth: 3,
    build: (width) => ({
      qubitCount: width,
      steps: ringEdges(width).flatMap(([a, b], index) => [pair("CX", a, b), single("RZ", b, angle(index)), pair("CX", a, b)]),
      measure: true,
    }),
  },
  {
    slug: "benchmark-qaoa-ring",
    title: "QAOA ring layer benchmark",
    titleJa: "QAOAリング層ベンチマーク",
    family: "QAOA / MaxCut",
    description: "A fixed-angle p=1 MaxCut-style QAOA layer on a cycle graph, including cost and mixer blocks.",
    descriptionJa: "サイクルグラフ上の固定角p=1 MaxCut型QAOA層で、コスト項とミキサー項を含みます。",
    tags: ["QAOA", "MaxCut", "cycle graph"],
    minWidth: 3,
    build: (width) => ({
      qubitCount: width,
      steps: [
        ...all(width, "H"),
        ...ringEdges(width).flatMap(([a, b]) => [pair("CX", a, b), single("RZ", b, "pi/4"), pair("CX", a, b)]),
        ...all(width, "RX", () => "pi/8"),
      ],
      measure: true,
    }),
  },
  {
    slug: "benchmark-bernstein-vazirani",
    title: "Bernstein–Vazirani all-ones oracle",
    titleJa: "Bernstein–Vazirani全1オラクル",
    family: "Oracle algorithm benchmark",
    description: "A fixed all-ones Bernstein–Vazirani instance with the last qubit used as the phase-kickback ancilla.",
    descriptionJa: "最後の量子ビットを位相キックバック補助ビットに用いる、秘密列が全1の固定BV回路です。",
    tags: ["Bernstein–Vazirani", "oracle", "query algorithm"],
    minWidth: 3,
    build: (width) => ({
      qubitCount: width,
      steps: [
        single("X", width - 1),
        ...all(width, "H"),
        ...Array.from({ length: width - 1 }, (_, qubit) => pair("CX", qubit, width - 1)),
        ...Array.from({ length: width - 1 }, (_, qubit) => single("H", qubit)),
      ],
      measure: true,
    }),
  },
  {
    slug: "benchmark-parity-oracle",
    title: "Alternating-parity oracle scaffold",
    titleJa: "交互パリティ・オラクル回路",
    family: "Oracle algorithm benchmark",
    description: "A deterministic parity-oracle circuit that marks alternating input wires through phase kickback.",
    descriptionJa: "交互の入力ワイヤを位相キックバックで符号化する、決定的なパリティ・オラクル回路です。",
    tags: ["Deutsch–Jozsa", "parity", "oracle"],
    minWidth: 3,
    build: (width) => ({
      qubitCount: width,
      steps: [
        single("X", width - 1),
        ...all(width, "H"),
        ...Array.from({ length: width - 1 }, (_, qubit) => qubit % 2 === 0 ? pair("CX", qubit, width - 1) : null).filter((step): step is Step => Boolean(step)),
        ...Array.from({ length: width - 1 }, (_, qubit) => single("H", qubit)),
      ],
      measure: true,
    }),
  },
  {
    slug: "benchmark-swap-network",
    title: "Linear SWAP-network benchmark",
    titleJa: "線形SWAPネットワーク・ベンチマーク",
    family: "Routing benchmark",
    description: "A forward-and-reverse nearest-neighbor SWAP network for testing routing and qubit-order preservation.",
    descriptionJa: "ルーティングと量子ビット順序の保持を確認する、往復の最近接SWAPネットワークです。",
    tags: ["SWAP", "routing", "compiler benchmark"],
    minWidth: 3,
    build: (width) => ({ qubitCount: width, steps: [single("X", 0), ...chain(width, "SWAP"), ...chain(width, "SWAP").reverse()], measure: true }),
  },
  {
    slug: "benchmark-clifford-brickwork",
    title: "Clifford brickwork benchmark",
    titleJa: "Cliffordブリックワーク・ベンチマーク",
    family: "Clifford circuit benchmark",
    description: "A deterministic H/S/CNOT brickwork circuit suited to stabilizer and compiler regression checks.",
    descriptionJa: "スタビライザー計算とコンパイラ回帰確認に適した、決定的なH/S/CNOTブリックワーク回路です。",
    tags: ["Clifford", "brickwork", "stabilizer"],
    minWidth: 3,
    build: (width) => ({
      qubitCount: width,
      steps: [
        ...all(width, "H"),
        ...Array.from({ length: width }, (_, q) => q % 2 ? single("S", q) : single("H", q)),
        ...Array.from({ length: Math.floor(width / 2) }, (_, q) => pair("CX", q * 2, q * 2 + 1)),
        ...Array.from({ length: Math.floor((width - 1) / 2) }, (_, q) => pair("CX", q * 2 + 1, q * 2 + 2)),
      ],
      measure: true,
    }),
  },
  {
    slug: "benchmark-occupation-seeded-vqe",
    title: "Occupation-seeded VQE ansatz",
    titleJa: "占有数初期化VQEアンサッツ",
    family: "VQE ansatz benchmark",
    description: "A Hartree–Fock-like computational-basis seed followed by tunable rotations and a CNOT chain.",
    descriptionJa: "Hartree–Fock型の計算基底初期状態に、調整可能な回転とCNOTチェーンを加えた回路です。",
    tags: ["VQE", "occupation seed", "ansatz"],
    minWidth: 3,
    build: (width) => ({
      qubitCount: width,
      steps: [
        ...Array.from({ length: Math.floor(width / 2) }, (_, q) => single("X", q)),
        ...all(width, "RY", angle),
        ...chain(width, "CX"),
        ...all(width, "RZ", (q) => angle(q + 3)),
      ],
      measure: true,
    }),
  },
  {
    slug: "benchmark-tfim-vqe",
    title: "Transverse-field Ising VQE layer",
    titleJa: "横磁場Ising VQE層",
    family: "VQE ansatz benchmark",
    description: "A problem-inspired layer combining ZZ interactions and transverse X rotations for a ring Ising model.",
    descriptionJa: "リングIsing模型向けにZZ相互作用と横方向X回転を組み合わせた問題着想型VQE層です。",
    tags: ["VQE", "TFIM", "problem-inspired ansatz"],
    minWidth: 3,
    build: (width) => ({
      qubitCount: width,
      steps: [
        ...all(width, "H"),
        ...ringEdges(width).flatMap(([a, b]) => [pair("CX", a, b), single("RZ", b, "pi/4"), pair("CX", a, b)]),
        ...all(width, "RX", () => "pi/8"),
      ],
      measure: true,
    }),
  },
  {
    slug: "benchmark-phase-feature-map",
    title: "Phase feature-map benchmark",
    titleJa: "位相特徴量マップ・ベンチマーク",
    family: "Quantum machine learning",
    description: "A fixed-data feature-map scaffold with Hadamards, local phase rotations, and pairwise ZZ encodings.",
    descriptionJa: "Hadamard、局所位相回転、ペアZZ符号化を組み合わせた固定データ特徴量マップです。",
    tags: ["feature map", "quantum kernel", "QML"],
    minWidth: 3,
    build: (width) => ({
      qubitCount: width,
      steps: [
        ...all(width, "H"),
        ...all(width, "RZ", angle),
        ...chain(width, "CX").flatMap((cx, index) => [cx, single("RZ", cx.qubits[1], angle(index + 2)), cx]),
      ],
      measure: true,
    }),
  },
];

const MQT_CITATION = {
  title: "MQT Bench: Benchmarking Software and Design Automation Tools for Quantum Computing",
  authors: "Nils Quetschlich, Lukas Burgholzer, Robert Wille",
  year: "2022",
  url: "https://arxiv.org/abs/2204.13719",
  relevance: "Defines a cross-level, scalable benchmark methodology; this entry is a Leona Quantum-authored portable scaffold, not a byte-for-byte upstream circuit.",
  relevanceJa: "抽象度と規模をまたぐベンチマーク方法論を示します。本項目はLeona Quantum独自の移植可能な回路で、上流回路の複製ではありません。",
};

function circuitEntry(spec: CircuitFamily, width: number): PublicRepositoryEntry {
  const portableCircuit = spec.build(width);
  const generated = generatePortableCircuitCode(portableCircuit);
  const gateCount = portableCircuit.steps.length;
  return makeReferenceEntry({
    slug: `${spec.slug}-${width}q`,
    title: `${spec.title} · ${width} qubits`,
    titleJa: `${spec.titleJa}・${width}量子ビット`,
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: spec.family,
    framework: "Qiskit",
    status: "verified_caveats",
    verification: "Portable construction and seven-target code generation checked; no simulator, hardware, or performance result is claimed.",
    verificationMethods: ["construction", "research_paper"],
    method: "Deterministic portable-gate construction plus catalog schema validation",
    result: `Pass · ${width} qubits and ${gateCount} pre-measurement operations emit non-empty Qiskit, PennyLane, Cirq, CUDA-Q, Amazon Braket, OpenQASM 3.0, and PyQuil source.`,
    caveat: "This is a parameterized Leona Quantum benchmark scaffold informed by the cited suite, not an upstream benchmark file or a hardware result.",
    exportStatus: "Seven deterministic framework exports available from the portable circuit model",
    provenance: "Leona Quantum portable benchmark expansion · MQT Bench methodology reference",
    updatedAt: "2026-07-18",
    description: spec.description,
    descriptionJa: spec.descriptionJa,
    introduction: `${spec.description} This ${width}-qubit record gives the repository a concrete, inspectable circuit at a known width rather than only a family-level description.`,
    introductionJa: `${spec.descriptionJa} この${width}量子ビット項目は、ファミリー説明だけでなく、幅が明確な検査可能な回路を提供します。`,
    explanation: `The circuit is stored once as a framework-neutral ordered gate graph and converted lazily when a framework is selected. The converter preserves gate order, numeric angle expressions, qubit indices, and terminal all-qubit measurement for its bounded gate set. It intentionally does not claim that downstream compiler decompositions or device behavior are identical. The cited MQT Bench work motivates scalable, cross-level benchmark families; this particular circuit is a Leona Quantum-authored scaffold and should be compared by width, operation count, transpiled depth, two-qubit count, and measured output behavior.`,
    explanationJa: `この回路はフレームワークに依存しない順序付きゲートグラフとして保存し、選択したフレームワークへ表示時に変換します。対応するゲートの範囲では、ゲート順、数値角度、量子ビット番号、末尾の全量子ビット測定を保持します。ただし、各コンパイラでの分解や実機での動作が同じになるとは限りません。MQT Bench論文は、規模を変えられる多層的なベンチマーク方法の出典です。この回路自体はLeona Quantum独自のサンプル実装です。量子ビット数、演算数、変換後の深さ、2量子ビット演算数、測定結果を比較してください。`,
    tags: [...spec.tags, `${width} qubits`, "seven-framework export"],
    resources: [
      { label: "Qubits", value: String(width) },
      { label: "Operations", value: String(gateCount) },
      { label: "Framework exports", value: "7" },
    ],
    metadata: [
      { label: "Circuit model", value: "Ordered portable gate graph" },
      { label: "Measurement", value: portableCircuit.measure ? "Terminal all-qubit" : "None" },
    ],
    sourceTitle: MQT_CITATION.title,
    sourceUrl: MQT_CITATION.url,
    sourceLicense: "Citation metadata; Leona Quantum-authored scaffold",
    wires: Array.from({ length: width }, (_, qubit) => `q${qubit}`),
    operations: portableCircuit.steps.map((step) => ({
      label: step.gate,
      qubits: step.qubits,
      tone: step.gate === "CX" || step.gate === "CZ" || step.gate === "SWAP" ? "accent" : step.gate.startsWith("R") ? "warn" : "neutral",
    })),
    outcomes: [],
    portableCircuit,
    code: generated.qiskit,
    filename: `${spec.slug}-${width}q.py`,
    language: "python",
    relatedSlugs: ["vqe-ground-state-energy", "bell-state-qiskit"],
    literature: [MQT_CITATION],
  });
}

type Concept = {
  slug: string;
  title: string;
  titleJa: string;
  summary: string;
  summaryJa: string;
  source?: { title: string; authors: string; year: string; url: string };
};

const VQE_SURVEY = {
  title: "VQE Method: A Short Survey and Recent Developments",
  authors: "Dmitry A. Fedorov, Bo Peng, Niranjan Govind, Yuri Alexeev",
  year: "2021",
  url: "https://arxiv.org/abs/2103.08505",
};

const VQE_METHODS: Concept[] = [
  { slug: "vqe-objective-loop", title: "VQE objective and optimization loop", titleJa: "VQE目的関数と最適化ループ", summary: "The canonical hybrid loop: prepare an ansatz, estimate a Hamiltonian expectation, and update parameters classically.", summaryJa: "アンサッツ準備、Hamiltonian期待値推定、古典パラメータ更新からなる標準ハイブリッドループです.", source: { title: "A variational eigenvalue solver on a quantum processor", authors: "Alberto Peruzzo, Jarrod McClean, Peter Shadbolt, Man-Hong Yung, Xiao-Qi Zhou, Peter J. Love, Alán Aspuru-Guzik, Jeremy L. O'Brien", year: "2013", url: "https://arxiv.org/abs/1304.3061" } },
  { slug: "vqe-hardware-efficient-ansatz", title: "Hardware-efficient VQE ansatz", titleJa: "ハードウェア効率型VQEアンサッツ", summary: "Alternating native one-qubit rotations and entanglers reduce compilation overhead but can change trainability.", summaryJa: "ネイティブ1量子ビット回転とエンタングラーを交互に使い、コンパイル負荷を抑える一方で学習性に影響します.", source: { title: "Hardware-efficient Variational Quantum Eigensolver for Small Molecules and Quantum Magnets", authors: "Abhinav Kandala, Antonio Mezzacapo, Kristan Temme, Maika Takita, Markus Brink, Jerry M. Chow, Jay M. Gambetta", year: "2017", url: "https://arxiv.org/abs/1704.05018" } },
  { slug: "vqe-uccsd-ansatz", title: "UCCSD VQE ansatz", titleJa: "UCCSD VQEアンサッツ", summary: "A chemistry-inspired unitary coupled-cluster ansatz truncated to single and double excitations.", summaryJa: "一重・二重励起に打ち切った化学着想型ユニタリ結合クラスター・アンサッツです.", source: { title: "Scalable Quantum Simulation of Molecular Energies", authors: "P. J. J. O'Malley, R. Babbush, I. D. Kivlichan, J. Romero, J. R. McClean, R. Barends, J. Kelly, P. Roushan, A. Tranter, N. Ding, B. Campbell, Y. Chen, Z. Chen, B. Chiaro, A. Dunsworth, A. G. Fowler, E. Jeffrey, A. Megrant, J. Y. Mutus, C. Neill, C. Quintana, D. Sank, A. Vainsencher, J. Wenner, T. C. White, P. V. Coveney, P. J. Love, H. Neven, A. Aspuru-Guzik, J. M. Martinis", year: "2015", url: "https://arxiv.org/abs/1512.06860" } },
  { slug: "vqe-generalized-excitations", title: "Generalized excitation VQE", titleJa: "一般化励起VQE", summary: "Generalized singles and doubles relax occupied-to-virtual restrictions to enlarge the variational manifold.", summaryJa: "占有軌道から仮想軌道への制約を緩和し、変分多様体を広げる一般化一重・二重励起です.", source: { title: "Generalized Unitary Coupled Cluster Wavefunctions for Quantum Computation", authors: "Joonho Lee, William J. Huggins, Martin Head-Gordon, K. Birgitta Whaley", year: "2018", url: "https://arxiv.org/abs/1810.02327" } },
  { slug: "vqe-k-upccgsd", title: "k-UpCCGSD ansatz", titleJa: "k-UpCCGSDアンサッツ", summary: "Repeated paired generalized doubles with generalized singles trade expressivity against shallower chemistry circuits.", summaryJa: "対になった一般化二重励起と一般化一重励起を反復し、表現力と回路深さを調整します.", source: { title: "Generalized Unitary Coupled Cluster Wavefunctions for Quantum Computation", authors: "Joonho Lee, William J. Huggins, Martin Head-Gordon, K. Birgitta Whaley", year: "2018", url: "https://arxiv.org/abs/1810.02327" } },
  { slug: "vqe-adapt", title: "ADAPT-VQE", titleJa: "ADAPT-VQE", summary: "An adaptive ansatz grows one operator at a time using measured energy gradients from a predefined pool.", summaryJa: "事前定義した演算子プールのエネルギー勾配を測定し、演算子を1つずつ追加する適応型アンサッツです.", source: { title: "An adaptive variational algorithm for exact molecular simulations on a quantum computer", authors: "Harper R. Grimsley, Sophia E. Economou, Edwin Barnes, Nicholas J. Mayhall", year: "2018", url: "https://arxiv.org/abs/1812.11173" } },
  { slug: "vqe-qubit-adapt", title: "Qubit-ADAPT-VQE", titleJa: "Qubit-ADAPT-VQE", summary: "Qubit-space Pauli generators replace fermionic excitation operators to seek shorter adaptive circuits.", summaryJa: "フェルミオン励起演算子を量子ビット空間のPauli生成子に置き換え、短い適応回路を目指します.", source: { title: "qubit-ADAPT-VQE: An adaptive algorithm for constructing hardware-efficient ansatze on a quantum processor", authors: "Ho Lun Tang, V. O. Shkolnikov, George S. Barron, Harper R. Grimsley, Nicholas J. Mayhall, Edwin Barnes, Sophia E. Economou", year: "2019", url: "https://arxiv.org/abs/1911.10205" } },
  // **Its own paper, found on a re-search (B5, s134).** This record was one of the
  // four W21-B left on `VQE_SURVEY` after a search came back empty. The empty
  // result was not a real absence: Sapova and Fedorov's carbon-monoxide-oxidation
  // paper is where the batching is introduced — *"we push forward the capabilities
  // of adaptive variational algorithms (ADAPT-VQE) by demonstrating that the
  // measurement overhead can be significantly reduced via adding multiple
  // operators at each step while keeping the ansatz compact"* — and A. K. Fedorov
  // is also an author of the survey this had been defaulting to, which is a good
  // guess at why the fallback looked plausible for so long.
  { slug: "vqe-batched-adapt", title: "Batched ADAPT-VQE", titleJa: "バッチ型ADAPT-VQE", summary: "Several high-gradient operators are appended per adaptive iteration to reduce optimization and measurement rounds.", summaryJa: "各適応反復で複数の高勾配演算子を追加し、最適化と測定のラウンド数を減らします.", source: { title: "Variational quantum eigensolver techniques for simulating carbon monoxide oxidation", authors: "M. D. Sapova, A. K. Fedorov", year: "2021", url: "https://arxiv.org/abs/2108.11167" } },
  { slug: "vqe-tetris-adapt", title: "TETRIS-ADAPT-VQE", titleJa: "TETRIS-ADAPT-VQE", summary: "Operators with disjoint support are packed into the same adaptive layer to reduce circuit depth.", summaryJa: "支持が重ならない演算子を同じ適応層に詰め込み、回路深さを抑えます.", source: { title: "TETRIS-ADAPT-VQE: An adaptive algorithm that yields shallower, denser circuit ansätze", authors: "Panagiotis G. Anastasiou, Yanzhu Chen, Nicholas J. Mayhall, Edwin Barnes, Sophia E. Economou", year: "2022", url: "https://arxiv.org/abs/2209.10562" } },
  { slug: "vqe-qcc", title: "Qubit coupled-cluster VQE", titleJa: "量子ビット結合クラスターVQE", summary: "Qubit coupled-cluster uses Pauli-word entanglers and a product-state reference directly in qubit space.", summaryJa: "Pauli語エンタングラーと積状態参照を量子ビット空間で直接用いる結合クラスター法です.", source: { title: "Qubit coupled-cluster method: A systematic approach to quantum chemistry on a quantum computer", authors: "Ilya G. Ryabinkin, Tzu-Ching Yen, Scott N. Genin, Artur F. Izmaylov", year: "2018", url: "https://arxiv.org/abs/1809.03827" } },
  { slug: "vqe-iterative-qcc", title: "Iterative qubit coupled cluster", titleJa: "反復量子ビット結合クラスター", summary: "Iterative QCC repeatedly dresses the Hamiltonian and selects new entanglers instead of fixing one deep circuit.", summaryJa: "Hamiltonianを反復的に変換して新しいエンタングラーを選び、固定された深い回路を避けます.", source: { title: "Iterative Qubit Coupled Cluster approach with efficient screening of generators", authors: "Ilya G. Ryabinkin, Robert A. Lang, Scott N. Genin, Artur F. Izmaylov", year: "2019", url: "https://arxiv.org/abs/1906.11192" } },
  { slug: "vqe-symmetry-preserving", title: "Symmetry-preserving VQE ansatz", titleJa: "対称性保持VQEアンサッツ", summary: "The ansatz is constrained to preserve selected particle-number, parity, or spin symmetries.", summaryJa: "粒子数、パリティ、スピンなど選択した対称性を保持するようアンサッツを制約します.", source: { title: "Efficient Symmetry-Preserving State Preparation Circuits for the Variational Quantum Eigensolver Algorithm", authors: "Bryan T. Gard, Linghua Zhu, George S. Barron, Nicholas J. Mayhall, Sophia E. Economou, Edwin Barnes", year: "2019", url: "https://arxiv.org/abs/1904.10910" } },
  { slug: "vqe-particle-conserving", title: "Particle-conserving VQE circuits", titleJa: "粒子数保存VQE回路", summary: "Givens-style or excitation-preserving blocks keep evolution inside a fixed-particle-number sector.", summaryJa: "Givens型または励起保存ブロックにより、固定粒子数セクター内で発展させます.", source: { title: "Quantum algorithms for electronic structure calculations: particle/hole Hamiltonian and optimized wavefunction expansions", authors: "Panagiotis Kl. Barkoutsos, Jerome F. Gonthier, Igor Sokolov, Nikolaj Moll, Gian Salis, Andreas Fuhrer, Marc Ganzhorn, Daniel J. Egger, Matthias Troyer, Antonio Mezzacapo, Stefan Filipp, Ivano Tavernelli", year: "2018", url: "https://arxiv.org/abs/1805.04340" } },
  { slug: "vqe-spin-adapted", title: "Spin-adapted VQE ansatz", titleJa: "スピン適応VQEアンサッツ", summary: "Spin-complemented generators reduce leakage from a target total-spin sector.", summaryJa: "スピン相補生成子を使い、目標全スピン・セクターからの漏れを抑えます." },
  { slug: "vqe-orbital-optimized", title: "Orbital-optimized VQE", titleJa: "軌道最適化VQE", summary: "Orbital rotations are optimized alongside circuit parameters to improve compact active-space descriptions.", summaryJa: "回路パラメータと同時に軌道回転を最適化し、コンパクトな活性空間表現を改善します.", source: { title: "Orbital optimized unitary coupled cluster theory for quantum computer", authors: "Wataru Mizukami, Kosuke Mitarai, Yuya O. Nakagawa, Takahiro Yamamoto, Tennin Yan, Yu-ya Ohnishi", year: "2019", url: "https://arxiv.org/abs/1910.11526" } },
  { slug: "vqe-vqd", title: "Variational quantum deflation", titleJa: "変分量子デフレーション", summary: "Overlap penalties against previously found states turn excited-state search into a sequence of VQE objectives.", summaryJa: "既知状態との重なり罰則を加え、励起状態探索を一連のVQE目的関数に変換します.", source: { title: "Variational Quantum Computation of Excited States", authors: "Oscar Higgott, Daochen Wang, Stephen Brierley", year: "2018", url: "https://arxiv.org/abs/1805.08138" } },
  { slug: "vqe-ssvqe", title: "Subspace-search VQE", titleJa: "部分空間探索VQE", summary: "One shared unitary transforms several orthogonal inputs while a weighted objective orders multiple eigenstates.", summaryJa: "共有ユニタリで複数の直交入力を変換し、重み付き目的関数で複数固有状態を順序付けます.", source: { title: "Subspace-search variational quantum eigensolver for excited states", authors: "Ken M Nakanishi, Kosuke Mitarai, Keisuke Fujii", year: "2018", url: "https://arxiv.org/abs/1810.09434" } },
  { slug: "vqe-mc-vqe", title: "Multistate contracted VQE", titleJa: "多状態縮約VQE", summary: "A contracted reference subspace is jointly entangled before a small effective Hamiltonian is diagonalized.", summaryJa: "縮約参照部分空間を共同でエンタングルし、小さな有効Hamiltonianを対角化します.", source: { title: "Quantum Computation of Electronic Transitions using a Variational Quantum Eigensolver", authors: "Robert M. Parrish, Edward G. Hohenstein, Peter L. McMahon, Todd J. Martinez", year: "2019", url: "https://arxiv.org/abs/1901.01234" } },
  { slug: "vqe-folded-spectrum", title: "Folded-spectrum VQE", titleJa: "折り畳みスペクトルVQE", summary: "Minimizing the squared shifted Hamiltonian targets eigenstates near a chosen energy shift.", summaryJa: "シフトしたHamiltonianの二乗を最小化し、指定エネルギー近傍の固有状態を狙います.", source: { title: "Folded Spectrum VQE : A quantum computing method for the calculation of molecular excited states", authors: "Lila Cadi Tazi, Alex J.W. Thom", year: "2023", url: "https://arxiv.org/abs/2305.04783" } },
  { slug: "vqe-penalty-excited-state", title: "Penalty-based excited-state VQE", titleJa: "罰則型励起状態VQE", summary: "Orthogonality or symmetry penalties augment the energy objective to exclude previously identified sectors.", summaryJa: "直交性または対称性の罰則をエネルギー目的に加え、既知セクターを除外します.", source: { title: "Penalty methods for variational quantum eigensolver", authors: "Kohdai Kuroiwa, Yuya O. Nakagawa", year: "2020", url: "https://arxiv.org/abs/2010.13951" } },
  { slug: "vqe-quantum-subspace-expansion", title: "Quantum subspace expansion", titleJa: "量子部分空間展開", summary: "Measured response operators around a VQE state define a generalized eigenproblem for excitations and mitigation.", summaryJa: "VQE状態周辺の応答演算子を測定し、励起と誤差緩和の一般化固有値問題を構成します.", source: { title: "Hybrid Quantum-Classical Hierarchy for Mitigation of Decoherence and Determination of Excited States", authors: "Jarrod R. McClean, Mollie E. Schwartz, Jonathan Carter, Wibe A. de Jong", year: "2016", url: "https://arxiv.org/abs/1603.05681" } },
  { slug: "vqe-qeom", title: "Quantum equation-of-motion VQE", titleJa: "量子運動方程式VQE", summary: "Commutator matrix elements over a VQE reference produce excitation energies through an equation-of-motion problem.", summaryJa: "VQE参照上の交換子行列要素から、運動方程式問題として励起エネルギーを求めます.", source: { title: "Quantum equation of motion for computing molecular excitation energies on a noisy quantum processor", authors: "Pauline J Ollitrault, Abhinav Kandala, Chun-Fu Chen, Panagiotis Kl Barkoutsos, Antonio Mezzacapo, Marco Pistoia, Sarah Sheldon, Stefan Woerner, Jay Gambetta, Ivano Tavernelli", year: "2019", url: "https://arxiv.org/abs/1910.12890" } },
  { slug: "vqe-variance-objective", title: "Variance-minimizing VQE", titleJa: "分散最小化VQE", summary: "Hamiltonian variance supplements or replaces energy to target eigenstates and diagnose convergence.", summaryJa: "Hamiltonian分散をエネルギーに追加または置換し、固有状態探索と収束診断に使います.", source: { title: "Variational quantum eigensolvers by variance minimization", authors: "Dan-Bo Zhang, Zhan-Hao Yuan, Tao Yin", year: "2020", url: "https://arxiv.org/abs/2006.15781" } },
  { slug: "vqe-cvar", title: "CVaR-VQE objective", titleJa: "CVaR-VQE目的関数", summary: "Conditional value-at-risk averages only a selected low-energy tail of samples for combinatorial objectives.", summaryJa: "組合せ最適化で、サンプルの低エネルギー側の選択部分だけを平均します.", source: { title: "Improving Variational Quantum Optimization using CVaR", authors: "Panagiotis Kl. Barkoutsos, Giacomo Nannicini, Anton Robert, Ivano Tavernelli, Stefan Woerner", year: "2019", url: "https://arxiv.org/abs/1907.04769" } },
  { slug: "vqe-imaginary-time", title: "Variational imaginary-time evolution", titleJa: "変分虚時間発展", summary: "McLachlan-style projected imaginary-time dynamics update parameters toward low-energy states.", summaryJa: "McLachlan型の射影虚時間ダイナミクスで低エネルギー状態へパラメータを更新します.", source: { title: "Theory of variational quantum simulation", authors: "Xiao Yuan, Suguru Endo, Qi Zhao, Ying Li, Simon Benjamin", year: "2018", url: "https://arxiv.org/abs/1812.08767" } },
  { slug: "vqe-natural-gradient", title: "Quantum natural-gradient VQE", titleJa: "量子自然勾配VQE", summary: "The Fubini–Study metric preconditions parameter updates according to circuit-state geometry.", summaryJa: "Fubini–Study計量で回路状態の幾何に基づきパラメータ更新を前処理します.", source: { title: "Quantum Natural Gradient", authors: "James Stokes, Josh Izaac, Nathan Killoran, Giuseppe Carleo", year: "2019", url: "https://arxiv.org/abs/1909.02108" } },
  { slug: "vqe-spsa-optimizer", title: "SPSA-optimized VQE", titleJa: "SPSA最適化VQE", summary: "Simultaneous perturbation estimates a stochastic gradient with two objective evaluations per iteration.", summaryJa: "同時摂動により、各反復2回の目的関数評価で確率的勾配を推定します.", source: { title: "Multivariate stochastic approximation using a simultaneous perturbation gradient approximation", authors: "J. C. Spall", year: "1992", url: "https://doi.org/10.1109/9.119632" } },
  { slug: "vqe-gradient-based", title: "Analytic-gradient VQE", titleJa: "解析勾配VQE", summary: "Parameter-shift or analytic derivative measurements supply gradients to a classical optimizer.", summaryJa: "パラメータシフトまたは解析微分測定で古典最適化器へ勾配を供給します.", source: { title: "Evaluating analytic gradients on quantum hardware", authors: "Maria Schuld, Ville Bergholm, Christian Gogolin, Josh Izaac, Nathan Killoran", year: "2018", url: "https://arxiv.org/abs/1811.11184" } },
  { slug: "vqe-layerwise-training", title: "Layerwise VQE training", titleJa: "層別VQE学習", summary: "Circuit depth grows in stages so each newly introduced layer can be initialized and optimized locally.", summaryJa: "回路深さを段階的に増やし、新しい各層を局所的に初期化・最適化します.", source: { title: "Layerwise learning for quantum neural networks", authors: "Andrea Skolik, Jarrod R. McClean, Masoud Mohseni, Patrick van der Smagt, Martin Leib", year: "2020", url: "https://arxiv.org/abs/2006.14904" } },
  { slug: "vqe-warm-start", title: "Warm-start VQE", titleJa: "ウォームスタートVQE", summary: "Classical approximations, smaller active spaces, or nearby geometries initialize the variational parameters.", summaryJa: "古典近似、小さな活性空間、近傍形状から変分パラメータを初期化します." },
  { slug: "vqe-active-space", title: "Active-space VQE workflow", titleJa: "活性空間VQEワークフロー", summary: "Frozen-core and active-orbital choices define the Hamiltonian size before variational optimization.", summaryJa: "凍結コアと活性軌道の選択により、変分最適化前のHamiltonian規模を定めます." },
  { slug: "vqe-qubit-tapering", title: "Symmetry-tapered VQE", titleJa: "対称性テーパリングVQE", summary: "Known Z2 symmetries remove qubits and constrain the variational search to a selected sector.", summaryJa: "既知のZ2対称性で量子ビットを削減し、選択セクターへ変分探索を制約します.", source: { title: "Tapering off qubits to simulate fermionic Hamiltonians", authors: "Sergey Bravyi, Jay M. Gambetta, Antonio Mezzacapo, Kristan Temme", year: "2017", url: "https://arxiv.org/abs/1701.08213" } },
  { slug: "vqe-measurement-grouping", title: "Measurement-grouped VQE", titleJa: "測定グループ化VQE", summary: "Commuting Pauli terms are partitioned into compatible bases to reduce distinct measurement circuits.", summaryJa: "可換Pauli項を互換基底に分割し、異なる測定回路数を減らします.", source: { title: "Measurement Optimization in the Variational Quantum Eigensolver Using a Minimum Clique Cover", authors: "Vladyslav Verteletskyi, Tzu-Ching Yen, Artur F. Izmaylov", year: "2019", url: "https://arxiv.org/abs/1907.03358" } },
  { slug: "vqe-classical-shadows", title: "Classical-shadow VQE estimation", titleJa: "古典シャドウVQE推定", summary: "Randomized measurements are reused to estimate many observables from a shared data set.", summaryJa: "ランダム測定を再利用し、共有データ集合から多数の観測量を推定します.", source: { title: "Predicting Many Properties of a Quantum System from Very Few Measurements", authors: "Hsin-Yuan Huang, Richard Kueng, John Preskill", year: "2020", url: "https://arxiv.org/abs/2002.08953" } },
  { slug: "vqe-symmetry-verification", title: "Symmetry-verified VQE", titleJa: "対称性検証VQE", summary: "Samples outside conserved symmetry sectors are rejected or reweighted as an error-mitigation step.", summaryJa: "保存対称性セクター外のサンプルを除外または再重み付けして誤差緩和します.", source: { title: "Low-cost error mitigation by symmetry verification", authors: "X. Bonet-Monroig, R. Sagastizabal, M. Singh, T.E. O'Brien", year: "2018", url: "https://arxiv.org/abs/1807.10050" } },
  { slug: "vqe-zero-noise-extrapolation", title: "Zero-noise-extrapolated VQE", titleJa: "ゼロノイズ外挿VQE", summary: "Energy estimates at amplified noise levels are extrapolated toward an inferred zero-noise limit.", summaryJa: "増幅した複数ノイズ水準のエネルギー推定をゼロノイズ極限へ外挿します.", source: { title: "Error mitigation for short-depth quantum circuits", authors: "Kristan Temme, Sergey Bravyi, Jay M. Gambetta", year: "2016", url: "https://arxiv.org/abs/1612.02058" } },
  { slug: "vqe-readout-mitigation", title: "Readout-mitigated VQE", titleJa: "読み出し誤差緩和VQE", summary: "Calibrated assignment errors are inverted or regularized before Pauli expectations are assembled.", summaryJa: "校正した割当誤差を逆補正または正則化し、Pauli期待値を組み立てます.", source: { title: "Mitigating measurement errors in multi-qubit experiments", authors: "Sergey Bravyi, Sarah Sheldon, Abhinav Kandala, David C. McKay, Jay M. Gambetta", year: "2020", url: "https://arxiv.org/abs/2006.14044" } },
];

function vqeEntry(concept: Concept): PublicRepositoryEntry {
  const source = concept.source ?? VQE_SURVEY;
  return makeReferenceEntry({
    slug: concept.slug,
    title: concept.title,
    titleJa: concept.titleJa,
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Variational quantum eigensolver",
    framework: "Qiskit",
    status: "verified_caveats",
    verification: "Literature-backed method record; algorithmic scope and evidence boundary reviewed, with no benchmark run claimed.",
    verificationMethods: ["research_paper"],
    method: "Primary-paper or VQE-survey curation",
    result: "Pass · method purpose, optimization role, and non-circuit status are explicit.",
    caveat: "This is a method reference, not a fixed executable circuit; the ansatz, Hamiltonian, optimizer, and measurement plan must be supplied for a run.",
    exportStatus: "Reference only · no fabricated framework conversion",
    provenance: "Leona Quantum VQE literature expansion",
    updatedAt: "2026-07-18",
    description: concept.summary,
    descriptionJa: concept.summaryJa,
    introduction: `${concept.summary} This record separates the reusable method idea from any one molecule, Hamiltonian, optimizer, or device.`,
    introductionJa: `${concept.summaryJa} この項目は再利用可能な手法の考え方を、特定の分子、Hamiltonian、最適化器、デバイスから分離して示します。`,
    explanation: `${concept.summary} In a complete experiment, the method must be paired with a defined qubit Hamiltonian, reference state, parameterized circuit, measurement grouping, classical optimizer, stopping rule, and error analysis. The catalog therefore treats it as a literature-backed algorithm record rather than pretending that one generic snippet is the paper's implementation. Use the cited source to recover assumptions and compare energy error, variance, circuit resources, measurement cost, optimizer evaluations, and robustness under the same instance and budget.`,
    explanationJa: `${concept.summaryJa} 完全な実験では、量子ビットHamiltonian、参照状態、パラメータ化回路、測定グループ、古典最適化器、停止条件、誤差解析を明示する必要があります。ここでは特定論文の実装ではなく、文献に基づく一般的なアルゴリズム例として掲載しています。同じ問題と計算予算で、エネルギー誤差、分散、回路資源、測定コスト、最適化の評価回数、ノイズ耐性を比較してください。`,
    tags: ["VQE", "variational algorithm", concept.title.toLowerCase()],
    resources: [
      { label: "Record type", value: "Literature method" },
      { label: "Execution", value: "Requires a concrete ansatz and Hamiltonian" },
    ],
    metadata: [
      { label: "Evidence", value: "Literature curation" },
      { label: "Conversion", value: "Not applicable until a circuit is supplied" },
    ],
    sourceTitle: source.title,
    sourceUrl: source.url,
    sourceLicense: "Citation metadata only; source publication terms apply",
    wires: ["hybrid objective", "quantum circuit", "classical update"],
    operations: [
      { label: "prepare", qubits: [1], tone: "accent" },
      { label: "measure H", qubits: [0, 1], tone: "warn" },
      { label: "update θ", qubits: [0, 2], tone: "ok" },
    ],
    outcomes: [],
    code: `METHOD: ${concept.title}\nSCOPE: ${concept.summary}\n\nThis is a literature method record, not a fixed circuit.\nSupply: Hamiltonian, reference state, ansatz, optimizer, measurement plan, and stopping rule.`,
    filename: `${concept.slug}.txt`,
    language: "text",
    relatedSlugs: ["vqe-ground-state-energy", "h2-molecular-hamiltonian"],
    literature: [{
      ...source,
      relevance: `Primary or survey context for ${concept.title}; consult the paper for assumptions and implementation details.`,
      relevanceJa: `${concept.titleJa}の一次資料またはレビューです。前提と実装詳細は原論文を参照してください。`,
    }],
  });
}

/**
 * What a deepening pass found when it went looking for a primary source.
 *
 * **Typed rather than prose, and the reason is the one `print-the-denominator`
 * keeps making.** These fifty records are one six-field table expanded by
 * `operatorEntry` — each carries two authored strings and all fifty cite the
 * same software-package paper — so "how much of this corpus says anything" is
 * the question about it, and a question answered in prose cannot be counted.
 * `check-ingredients.mjs --depth` counts these and prints the denominator.
 *
 * The four non-default values are outcomes of a *search*, not judgements of the
 * object. `dissolved` says the literature has no paper about this thing; it does
 * not say the thing is unimportant — the fermionic creation operator is in every
 * many-body calculation ever done.
 */
export const DEPTH_OUTCOMES = [
  /** Not yet looked at. The default, and the honest state of most of the table. */
  "template",
  /** A primary source about this object was found and read. */
  "deepened",
  /**
   * No paper's subject is this object, but real primary results sit one level up
   * — about *products* or *transformations* of it. Written in two registers so a
   * reader can see which sentence rests on which, per the owner's ai-ops#58
   * ruling that claims hold only at the level the paper states them. **A partial
   * deepening that blurs its own levels is worse than the stub**, because a stub
   * claims nothing.
   */
  "partial",
  /**
   * Searched, and there is nothing to cite beyond a definition. The record says
   * so rather than padding itself, and that sentence is the finding.
   */
  "dissolved",
  /**
   * A primary source exists, is the right one, and cannot be read — paywalled
   * with no free route. Content is limited to what the abstract states, the
   * register carries *reportsBasis: "abstract"*, and the gap is the owner's to
   * close if he wants it closed (he offered exactly this on ai-ops#44).
   */
  "abstract-only",
] as const;

export type DepthOutcome = (typeof DEPTH_OUTCOMES)[number];

/**
 * The content a deepening pass adds. Absent on a record nobody has deepened.
 *
 * **`tags` DOES reach the classifier, and this comment said the opposite for
 * about ten minutes.** The first draft claimed no field here could affect
 * classification. That was wrong: `depth.tags` is appended to the same `tags`
 * array `ingredients.ts` keys its join rules on, and the first deepened record
 * to use it added `"hubbard model"` — which an existing rule already matches, so
 * `operator-fermi-hubbard` was claimed by two join rules at once.
 * `check-ingredients.mjs` refused the build and named the record.
 *
 * Nothing shipped, and the episode is the argument for the guard rather than
 * against the field: a reviewer reading "no field here reaches the classifier"
 * would have believed it, because it was written by the person adding the
 * field. The checker did not.
 *
 * So, concretely, when adding `depth.tags`: they are additive and they are
 * evidence the rule tables read. Check them against `INGREDIENT_JOIN_RULES` and
 * `INGREDIENT_ABSTAIN_RULES` in `ingredients.ts`, or let the checker do it —
 * but do not assume they are inert. Everything else in this object (prose,
 * resources, metadata, source) genuinely is.
 */
type OperatorDepth = {
  outcome: Exclude<DepthOutcome, "template">;
  /** Replaces the shared OpenFermion citation. Must be registered in `paper-register.ts`. */
  source?: { title: string; authors: string; year: string; url: string };
  /** Extra tags. Additive — the title-cased tag the join rules read is untouched. */
  tags?: readonly string[];
  explanationMd?: string;
  explanationMdJa?: string;
  resources?: { label: string; value: string }[];
  metadata?: { label: string; value: string }[];
  /** What was actually checked, in the register the yardstick records use. */
  verification?: string;
  method?: string;
  result?: string;
};

type OperatorConcept = {
  slug: string;
  title: string;
  titleJa: string;
  form: string;
  role: string;
  roleJa: string;
  depth?: OperatorDepth;
};

const OPERATOR_CONCEPTS: OperatorConcept[] = [
  { slug: "operator-pauli-string", title: "Pauli-string observable", titleJa: "Pauli文字列観測量", form: "P = P₀ ⊗ ··· ⊗ Pₙ₋₁", role: "Basic measured term in a qubit Hamiltonian.", roleJa: "量子ビットHamiltonianを構成する基本測定項です。" },
  { slug: "operator-weighted-pauli-sum", title: "Weighted Pauli-sum Hamiltonian", titleJa: "重み付きPauli和Hamiltonian", form: "H = Σⱼ cⱼPⱼ", role: "Canonical qubit-space objective used by VQE.", roleJa: "VQEで使う標準的な量子ビット空間目的演算子です。" },
  { slug: "operator-electronic-structure", title: "Electronic-structure Hamiltonian", titleJa: "電子構造Hamiltonian", form: "H = Σ hₚq a†ₚa_q + 1/2 Σ hₚqrs a†ₚa†_q a_r a_s", role: "Second-quantized molecular energy operator.", roleJa: "分子エネルギーの第二量子化演算子です。" },
  { slug: "operator-one-body-fermion", title: "One-body fermionic operator", titleJa: "一体フェルミオン演算子", form: "O₁ = Σ hₚq a†ₚa_q", role: "Kinetic, external-potential, or orbital-rotation term.", roleJa: "運動、外部ポテンシャル、軌道回転の項です。" },
  { slug: "operator-two-body-fermion", title: "Two-body fermionic operator", titleJa: "二体フェルミオン演算子", form: "O₂ = 1/2 Σ hₚqrs a†ₚa†_q a_r a_s", role: "Electron-electron interaction term.", roleJa: "電子間相互作用項です。" },
  {
    slug: "operator-creation",
    title: "Fermionic creation operator",
    titleJa: "フェルミオン生成演算子",
    form: "a†ₚ",
    role: "Adds a fermion in spin orbital p subject to antisymmetry.",
    roleJa: "反対称性を満たしつつスピン軌道pへフェルミオンを追加します。",
    depth: {
      outcome: "partial",
      source: {
        title: "Fermionic quantum computation",
        authors: "Sergey B. Bravyi, Alexei Yu. Kitaev",
        year: "2002",
        url: "https://arxiv.org/abs/quant-ph/0003137",
      },
      tags: ["second quantization", "anticommutation"],
      verification: "Searched for a primary paper whose subject is this operator and found none; the definition is cited to a paper that states it while being about something else.",
      method:
        "A deliberate attempt was made to refute the expectation that this object has no primary source. arXiv:quant-ph/0003137 was read end to end; §2 Eqs. (1)–(2) state the operator's action and its anticommutation algebra.",
      result:
        "Partial · no paper's subject is this operator, and that sentence stands. The definition is sourced at the level a paper states it, per ai-ops#58.",
      resources: [
        { label: "Definition cited to", value: "Bravyi & Kitaev 2002, §2 Eqs. (1)–(2)" },
        { label: "Paper about this operator", value: "None found" },
        { label: "Read depth", value: "Full text of the cited paper" },
      ],
      metadata: [
        { label: "Algebra", value: "{aⱼ, a†ₖ} = δⱼₖ, {aⱼ, aₖ} = 0" },
        { label: "Order dependence", value: "Action carries a sign from the modes below" },
        { label: "Outcome", value: "Partial — see the record" },
      ],
      explanationMd: String.raw`**This record is written in two registers, and the division is the point.**

*What no source establishes.* No paper's subject is the fermionic creation operator. It was searched for — including in the mathematical-physics literature, where a paper about the operator algebra itself would most plausibly sit — and none was found. It is a textbook primitive: universally used, entirely correct, and not the result of anybody's paper. That sentence is the honest core of this record and is not replaced by the citation below.

*What a source does state.* Bravyi and Kitaev's *Fermionic quantum computation* is about a model of computation with local fermionic modes, not about this operator — but §2 of it states the definition, and a claim may be taken at the level a paper states it. Eq. (1) gives the action on occupation-number basis vectors,

$$a_j\,|n_0,\dots,n_{j-1},1,n_{j+1},\dots\rangle = (-1)^{\sum_{s<j} n_s}\,|n_0,\dots,n_{j-1},0,n_{j+1},\dots\rangle,$$

with $a_j$ annihilating any vector where mode $j$ is already empty, and $a^\dagger_j$ the Hermitian conjugate. Eq. (2) gives the algebra: $a_j a_k + a_k a_j = 0$, $a^\dagger_j a^\dagger_k + a^\dagger_k a^\dagger_j = 0$, and $a_j a^\dagger_k + a^\dagger_k a_j = \delta_{jk}$.

**The sign is the content.** The paper draws attention to it in its own words — the definition depends on the order of the modes — and that dependence is not bookkeeping. It is antisymmetry, it is why fermionic operators on disjoint sites fail to commute where qubit operators on disjoint sites succeed, and it is the reason every fermion-to-qubit encoding in this catalog exists at all. The operator alone is a definition; the sign it carries is what the rest of the shelf is about.

**Why the record stops here.** Real primary results exist one level up — about products of these operators, and about when a transformation of them is implementable — but none of them was read, so none is cited. A partial deepening that blurs which sentence rests on which source is worse than the stub it replaces, because a stub claims nothing.`,
      explanationMdJa: String.raw`**この記録は二つの語り口で書かれており、その区分こそが要点です。**

*どの出典も確立していないこと。* フェルミオン生成演算子そのものを主題とする論文は存在しません。演算子代数そのものを扱う論文が最もありそうな数理物理の文献も含めて探しましたが、見つかりませんでした。これは教科書的な基本要素です。普遍的に用いられ、完全に正しく、そして誰かの論文の成果ではありません。この一文が本記録の誠実な中核であり、以下の引用がこれに取って代わることはありません。

*ある出典が述べていること。* Bravyi と Kitaev の *Fermionic quantum computation* は局所フェルミオン・モードによる計算模型についての論文であって、この演算子についての論文ではありません。しかし §2 が定義を述べており、主張は論文が述べている水準で引用できます。式 (1) は占有数基底ベクトルへの作用を

$$a_j\,|n_0,\dots,n_{j-1},1,n_{j+1},\dots\rangle = (-1)^{\sum_{s<j} n_s}\,|n_0,\dots,n_{j-1},0,n_{j+1},\dots\rangle$$

と与え、モード $j$ が既に空のベクトルには $a_j$ が零を返し、$a^\dagger_j$ はその Hermite 共役です。式 (2) は代数を与えます。$a_j a_k + a_k a_j = 0$、$a^\dagger_j a^\dagger_k + a^\dagger_k a^\dagger_j = 0$、$a_j a^\dagger_k + a^\dagger_k a_j = \delta_{jk}$。

**符号が内容です。** 論文自身が注意を促しているとおり、定義はモードの順序に依存します。この依存は帳簿づけではありません。それが反対称性であり、互いに素なサイト上の量子ビット演算子が可換であるのにフェルミオン演算子がそうならない理由であり、本カタログのフェルミオン量子ビット符号化がそもそも存在する理由です。演算子そのものは定義にすぎず、それが担う符号こそが棚の残りが扱っているものです。

**ここで止める理由。** 一段上には実在の一次結果があります（これらの演算子の積について、またそれらの変換がいつ実装可能かについて）。しかしいずれも読んでいないため、いずれも引用しません。どの文がどの出典に依拠するかを曖昧にした部分的な深掘りは、置き換える先のスタブより悪いものです。スタブは何も主張しないからです。`,
    },
  },
  { slug: "operator-annihilation", title: "Fermionic annihilation operator", titleJa: "フェルミオン消滅演算子", form: "aₚ", role: "Removes a fermion from spin orbital p.", roleJa: "スピン軌道pからフェルミオンを除去します。" },
  { slug: "operator-number", title: "Orbital number operator", titleJa: "軌道数演算子", form: "nₚ = a†ₚaₚ", role: "Measures occupation of one spin orbital.", roleJa: "1つのスピン軌道の占有数を測定します。" },
  { slug: "operator-total-particle-number", title: "Total particle-number operator", titleJa: "全粒子数演算子", form: "N = Σₚ a†ₚaₚ", role: "Defines fixed-number sectors and symmetry checks.", roleJa: "固定粒子数セクターと対称性確認を定義します。" },
  { slug: "operator-fermionic-hopping", title: "Fermionic hopping operator", titleJa: "フェルミオン・ホッピング演算子", form: "Tₚq = a†ₚa_q + a†_q aₚ", role: "Moves amplitude between orbitals or lattice sites.", roleJa: "軌道または格子サイト間で振幅を移します。" },
  { slug: "operator-pairing", title: "Fermionic pairing operator", titleJa: "フェルミオン対形成演算子", form: "Δₚq = a†ₚa†_q + a_q aₚ", role: "Creates and annihilates correlated fermion pairs.", roleJa: "相関したフェルミオン対を生成・消滅します。" },
  {
    slug: "operator-coulomb",
    title: "Coulomb interaction operator",
    titleJa: "Coulomb相互作用演算子",
    form: "V = 1/2 Σ hₚqrs a†ₚa†_q a_r a_s",
    role: "Represents two-electron repulsion in an orbital basis.",
    roleJa: "軌道基底で二電子反発を表します。",
    depth: {
      outcome: "dissolved",
      verification: "Searched for a primary source about this object and found none; the two candidate rescues were checked and both turned out to be about something else.",
      method:
        "A deliberate attempt was made to refute the expectation that this object has no primary source, including the integral-evaluation literature and the analytic literature on the Coulomb singularity.",
      result:
        "Dissolved · no primary source about this object was found, and the record says so rather than citing a paper about an adjacent one.",
      resources: [
        { label: "Paper about this operator", value: "None found" },
        { label: "Outcome", value: "Dissolved — nothing to cite beyond a definition" },
        { label: "Near misses", value: "Two, both about adjacent objects" },
      ],
      metadata: [
        { label: "What it is", value: "Standard second quantization of a known interaction" },
        { label: "Instance data", value: "Required for execution" },
        { label: "Read depth", value: "Not applicable — no source claimed" },
      ],
      explanationMd: String.raw`**This record was searched and did not deepen. That is the finding, not a gap in the search.**

There is no primary research paper whose subject is $V = \tfrac{1}{2}\sum h_{pqrs}\,a^\dagger_p a^\dagger_q a_r a_s$. It is the standard second-quantized form of an interaction that was already known, written in the formalism of second quantization that was already established — textbook composition rather than a result. Nothing beyond the definition and the formula could be honestly added, so nothing was.

**Two near misses were checked and rejected, and the reasons are the useful part.**

*The integral literature is about the coefficients, not the operator.* There is a substantial and genuinely primary literature on evaluating the numbers $h_{pqrs}$ — Gaussian basis functions and the recurrence schemes built on them. Those papers are about computing matrix elements. Citing one here would claim this record documents an evaluation algorithm, which it does not.

*The analytic literature is about a different representation of the same physics.* The Coulomb cusp condition — the constraint the $1/|\mathbf{r}_i - \mathbf{r}_j|$ singularity imposes on exact wavefunctions — is a real theorem and it is not about this object. It concerns the first-quantized operator in real space; what this record holds is the already-integrated orbital-basis form, in which the singularity has been integrated away. The connection is real but indirect: the cusp is *why* finite orbital-basis expansions converge slowly. Citing it as though it were about this operator is precisely the slippage the catalog's sourcing rule forbids.

**So the record keeps its shared citation and its two authored strings**, and adds this note about why. A search that returns nothing is worth recording once so the next person does not repeat it, and an object that genuinely cannot carry more than a formula should not be padded until it looks like one that can.`,
      explanationMdJa: String.raw`**この記録は調査され、深まりませんでした。それが調査の不備ではなく結論です。**

$V = \tfrac{1}{2}\sum h_{pqrs}\,a^\dagger_p a^\dagger_q a_r a_s$ を主題とする一次研究論文は存在しません。これは既に知られていた相互作用を、既に確立していた第二量子化の形式で書いたものであり、成果ではなく教科書的な合成です。定義と式を超えて誠実に加えられるものがなかったため、何も加えていません。

**二つの惜しい候補を検討し、退けました。その理由が有用な部分です。**

*積分の文献は係数についてであって演算子についてではありません。* 数値 $h_{pqrs}$ の評価については、実質的で真に一次の文献群が存在します（Gauss 型基底関数とその上に築かれた漸化式）。それらは行列要素の計算についての論文です。ここで引用すれば、本記録が評価アルゴリズムを記述していると主張することになりますが、そうではありません。

*解析的な文献は同じ物理の別の表現についてです。* Coulomb カスプ条件——$1/|\mathbf{r}_i - \mathbf{r}_j|$ の特異性が厳密な波動関数に課す制約——は実在の定理ですが、この対象についてのものではありません。それは実空間の第一量子化演算子に関するもので、本記録が保持するのは既に積分された軌道基底の形であり、そこでは特異性は積分によって消えています。関係は実在しますが間接的です。カスプは有限の軌道基底展開の収束が遅い**理由**です。この演算子についてのものであるかのように引用することは、カタログの出典規則が禁じるまさにその滑りです。

**したがって本記録は共有の引用と二つの記述文字列を保持し**、その理由についてのこの注記を加えます。何も返さなかった調査は、次の人が繰り返さないよう一度記録する価値があり、式以上のものを担えない対象を、担える対象のように見えるまで水増しすべきではありません。`,
    },
  },
  {
    slug: "operator-fermi-hubbard",
    title: "Fermi–Hubbard Hamiltonian",
    titleJa: "Fermi–Hubbard Hamiltonian",
    form: "H = -tΣ⟨ij⟩σ(c†ᵢσcⱼσ+h.c.) + UΣᵢnᵢ↑nᵢ↓",
    role: "Correlated lattice-fermion benchmark Hamiltonian.",
    roleJa: "相関格子フェルミオンの標準ベンチマークHamiltonianです。",
    depth: {
      outcome: "abstract-only",
      source: {
        title: "Electron correlations in narrow energy bands",
        authors: "J. Hubbard",
        year: "1963",
        url: "https://doi.org/10.1098/rspa.1963.0204",
      },
      tags: ["lattice fermions", "electron correlation"],
      verification: "The correct primary source was identified and its abstract read directly; the full text is paywalled with no free route found, and nothing here is claimed from beyond the abstract.",
      method:
        "The DOI was opened in a browser after a curl request returned 403 — which on this publisher is a bot challenge and not evidence of a paywall. The rendered page gives the abstract and the sentence “You do not currently have access to this content.”",
      result:
        "Inconclusive on the paper's contents · abstract read and used; full text not read. The register records reportsBasis: \"abstract\" so the gap is countable rather than invisible.",
      resources: [
        { label: "Primary source", value: "Hubbard 1963, Proc. R. Soc. A 276" },
        { label: "Read depth", value: "Abstract only — full text paywalled" },
        { label: "Free route", value: "None found; pre-arXiv" },
      ],
      metadata: [
        { label: "Model", value: "Hopping t, on-site repulsion U" },
        { label: "Paper's method", value: "Hartree–Fock, then a Green function treatment" },
        { label: "Access", value: "Owner decision — he offered exactly this on ai-ops#44" },
      ],
      explanationMd: String.raw`**This record is limited by what could be read, and says so.** Hubbard's 1963 paper is the right primary source and its full text is paywalled, with no free preprint, author copy or open mirror found — it predates arXiv by nearly thirty years. The abstract was read directly from the publisher's page; everything below comes from it, and nothing is claimed from the body.

What the abstract states: that a main effect of correlation in $d$- and $f$-bands is to produce behaviour characteristic of the atomic or Heitler–London picture; that the paper introduces a simple approximate model for the interaction of electrons in narrow energy bands to study this; that Hartree–Fock is applied to that model and its results examined; that a Green function technique then yields an approximate solution to the correlation problem; that this solution reduces to the exact atomic solution in one limit and to the ordinary uncorrelated band picture in the opposite one; and that the condition for ferromagnetism of the solution is discussed, with a two-electron example given to clarify the physical meaning.

**The limiting behaviour is the part that matters for this catalog**, and it is in the abstract rather than needing the body: a model that interpolates between the atomic limit and the uncorrelated band limit is exactly a model with a tunable correlation strength, which is why the ratio $U/t$ became the standard dial and why this Hamiltonian is a benchmark rather than a curiosity.

**What is deliberately not here.** No equation number, no section reference, no statement about the paper's derivation or its notation, because the body was not read. The catalog's paper register records this source with *reportsBasis: "abstract"*, so the gap is a fact the corpus knows about itself rather than an absence a reader has to infer. Closing it needs the PDF, which is an owner decision — he offered precisely that on ai-ops#44, and this record is the first concrete instance of the offer being needed.`,
      explanationMdJa: String.raw`**この記録は読めた範囲に限定されており、そのことを明記します。** Hubbard の 1963 年論文は正しい一次資料ですが、全文はペイウォールの内側にあり、無料のプレプリント、著者版、オープンアクセスのミラーはいずれも見つかりませんでした。arXiv より三十年ほど前の論文です。要旨は出版社のページから直接読みました。以下はすべて要旨に基づくもので、本文からの主張は一切含みません。

要旨が述べていること。$d$ 帯および $f$ 帯における相関の主要な効果の一つが、原子的すなわち Heitler–London 的な描像に特徴的な振る舞いを生むこと。これを調べるため、狭いエネルギー帯における電子間相互作用の単純な近似模型を導入すること。その模型に Hartree–Fock 近似を適用して結果を検討すること。次に Green 関数の手法により相関問題の近似解を得ること。この解が一方の極限で厳密な原子解に、逆の極限で通常の無相関バンド描像に帰着すること。そして解の強磁性条件が議論され、物理的意味を明らかにするため二電子の例が検討されること。

**本カタログにとって重要なのは極限の振る舞いであり**、それは本文を要さず要旨にあります。原子極限と無相関バンド極限のあいだを補間する模型とは、まさに相関の強さを調整できる模型であり、比 $U/t$ が標準的なつまみとなった理由であり、このハミルトニアンが好奇の対象ではなくベンチマークである理由です。

**意図的に記載しないもの。** 式番号、節番号、論文の導出や記法に関する記述は一切ありません。本文を読んでいないからです。カタログの論文レジスタはこの出典を *reportsBasis: "abstract"* として記録しており、この欠落は読者が推測すべき不在ではなく、コーパス自身が把握している事実です。これを埋めるには PDF が必要で、それはオーナーの判断事項です。ai-ops#44 で本人がまさにその申し出をしており、本記録はその申し出が必要となった最初の具体例です。`,
    },
  },
  { slug: "operator-bose-hubbard", title: "Bose–Hubbard Hamiltonian", titleJa: "Bose–Hubbard Hamiltonian", form: "H = -tΣ⟨ij⟩(b†ᵢbⱼ+h.c.) + U/2Σᵢnᵢ(nᵢ-1)", role: "Interacting lattice-boson model.", roleJa: "相互作用する格子ボソン模型です。" },
  { slug: "operator-ising-cost", title: "Ising cost Hamiltonian", titleJa: "IsingコストHamiltonian", form: "H_C = Σᵢ hᵢZᵢ + ΣᵢⱼJᵢⱼZᵢZⱼ", role: "Diagonal optimization and spin-model objective.", roleJa: "対角な最適化・スピン模型目的演算子です。" },
  { slug: "operator-transverse-field-ising", title: "Transverse-field Ising Hamiltonian", titleJa: "横磁場Ising Hamiltonian", form: "H = -JΣZᵢZᵢ₊₁ - hΣXᵢ", role: "Non-commuting spin-chain ground-state benchmark.", roleJa: "非可換スピン鎖の基底状態ベンチマークです。" },
  { slug: "operator-xy-model", title: "XY spin Hamiltonian", titleJa: "XYスピンHamiltonian", form: "H = ΣJₓXᵢXⱼ + JᵧYᵢYⱼ", role: "Excitation-preserving spin-exchange model.", roleJa: "励起数を保存するスピン交換模型です。" },
  { slug: "operator-heisenberg", title: "Heisenberg Hamiltonian", titleJa: "Heisenberg Hamiltonian", form: "H = ΣJ(XᵢXⱼ + YᵢYⱼ + ZᵢZⱼ)", role: "Isotropic interacting-spin model.", roleJa: "等方的な相互作用スピン模型です。" },
  { slug: "operator-xyz-model", title: "XYZ spin Hamiltonian", titleJa: "XYZスピンHamiltonian", form: "H = Σ(JₓXX + JᵧYY + J_zZZ)", role: "Anisotropic extension of the Heisenberg model.", roleJa: "Heisenberg模型の異方的拡張です。" },
  {
    slug: "operator-kitaev-chain",
    title: "Kitaev-chain Hamiltonian",
    titleJa: "Kitaev鎖Hamiltonian",
    form: "H = -μΣnᵢ - tΣ(c†ᵢcᵢ₊₁+h.c.) + ΔΣ(cᵢcᵢ₊₁+h.c.)",
    role: "Topological superconducting-chain model.",
    roleJa: "トポロジカル超伝導鎖模型です。",
    depth: {
      outcome: "deepened",
      source: {
        title: "Unpaired Majorana fermions in quantum wires",
        authors: "A. Yu. Kitaev",
        year: "2001",
        url: "https://arxiv.org/abs/cond-mat/0010440",
      },
      tags: ["majorana", "topological superconductor", "p-wave"],
      verification: "Read against the primary source; the paper's own symbols and equation numbers are quoted rather than the community's conventional restatement.",
      method:
        "arXiv:cond-mat/0010440 was read end to end. The Hamiltonian, its two limiting cases, the bulk spectrum, the phase boundary and the ground-state splitting were located in the paper's own numbering.",
      result:
        "Pass, with one recorded discrepancy · the paper writes the hopping amplitude as w and carries a −1/2 offset on the number term; the form this catalog previously quoted uses t and drops the offset.",
      resources: [
        { label: "Primary source", value: "Kitaev 2001, Eq. (4)" },
        { label: "Topological phase", value: "2|w| > |μ|, Δ ≠ 0" },
        { label: "Ground-state splitting", value: "t ∝ e^(−L/l₀)" },
      ],
      metadata: [
        { label: "Paper's symbols", value: "w hopping, μ chemical potential, Δ = |Δ|e^(iθ)" },
        { label: "Unpaired modes", value: "b′ = c₁, b″ = c_2L" },
        { label: "Read depth", value: "Full text" },
      ],
      explanationMd: String.raw`Kitaev states the model as Eq. (4) of *Unpaired Majorana fermions in quantum wires*:

$$H_1 = \sum_j \left( -w(a^\dagger_j a_{j+1} + a^\dagger_{j+1} a_j) - \mu\left(a^\dagger_j a_j - \tfrac{1}{2}\right) + \Delta a_j a_{j+1} + \Delta^* a^\dagger_{j+1} a^\dagger_j \right)$$

and glosses it in the same sentence: $w$ is a hopping amplitude, $\mu$ a chemical potential, and $\Delta = |\Delta|e^{i\theta}$ the induced superconducting gap.

**The form this catalog quoted is the community's, not the paper's.** Two differences, both small and both worth stating rather than smoothing over: the paper writes the hopping amplitude as $w$ where the conventional restatement uses $t$, and it carries the $-\tfrac{1}{2}$ offset on the number term, which the conventional form drops. Neither changes the physics — the offset is a constant shift — but a record that quotes a paper should quote it.

**Two limits, and the whole point sits between them.** Kitaev works the model at two special parameter choices before the general case. At $|\Delta| = w = 0$, $\mu < 0$, the two Majorana operators of a site pair with each other and the chain is trivial. At $|\Delta| = w > 0$, $\mu = 0$, the Hamiltonian collapses to Eq. (7), $H_1 = iw\sum_j c_{2j}c_{2j+1}$ — Majorana operators now pair **across** sites, which leaves $b' = c_1$ and $b'' = c_{2L}$ appearing in no term of the Hamiltonian at all. Those are the unpaired Majorana fermions the title is about, and they are a consequence of the pairing pattern rather than an added ingredient.

**Where the phases are.** The bulk spectrum is Eq. (13), $\epsilon(q) = \pm\sqrt{(2w\cos q + \mu)^2 + 4|\Delta|^2\sin^2 q}$, and the paper places the trivial phase at $2|w| < |\mu|$ and the topological one at $2|w| > |\mu|$ with $\Delta \neq 0$. At finite length the two boundary modes interact through Eq. (15), $H_{\mathrm{eff}} = \tfrac{i}{2}t\,b'b''$ with $t \propto e^{-L/l_0}$ — so the two ground states differ in energy by an amount exponentially small in the chain length, and in fermionic parity, which is the abstract's own claim.

**Why the catalog holds it.** This is a quadratic fermionic Hamiltonian with a closed-form spectrum and an exactly-known phase boundary, which makes it a benchmark whose right answer is known at every size — the same property that makes the transverse-field Ising model one. It is joined to *Hamiltonian you can query* because it is a Pauli sum after a Jordan–Wigner mapping, not because any route in this map is about topological order.`,
      explanationMdJa: String.raw`Kitaev は論文 *Unpaired Majorana fermions in quantum wires* の式 (4) でこの模型を次のように書いています。

$$H_1 = \sum_j \left( -w(a^\dagger_j a_{j+1} + a^\dagger_{j+1} a_j) - \mu\left(a^\dagger_j a_j - \tfrac{1}{2}\right) + \Delta a_j a_{j+1} + \Delta^* a^\dagger_{j+1} a^\dagger_j \right)$$

同じ文で、$w$ はホッピング振幅、$\mu$ は化学ポテンシャル、$\Delta = |\Delta|e^{i\theta}$ は誘起された超伝導ギャップであると説明されています。

**本カタログがこれまで引用していた形は論文のものではなく、慣用形です。** 違いは二点あり、いずれも小さいものの、ならすのではなく明記します。論文はホッピング振幅を $t$ ではなく $w$ と書き、数演算子の項に $-\tfrac{1}{2}$ のオフセットを保持しています。慣用形はこれを落とします。物理は変わりません（定数シフトです）が、論文を引用する記録は論文の形で引用すべきです。

**二つの極限。** $|\Delta| = w = 0$、$\mu < 0$ では同一サイトの二つの Majorana 演算子が対を組み、鎖は自明です。$|\Delta| = w > 0$、$\mu = 0$ では式 (7) の $H_1 = iw\sum_j c_{2j}c_{2j+1}$ となり、Majorana 演算子は**サイトをまたいで**対を組みます。その結果 $b' = c_1$ と $b'' = c_{2L}$ はハミルトニアンのどの項にも現れません。これが表題の非対 Majorana フェルミオンであり、後から加えた要素ではなく対の組み方の帰結です。

**相の位置。** バルクのスペクトルは式 (13) の $\epsilon(q) = \pm\sqrt{(2w\cos q + \mu)^2 + 4|\Delta|^2\sin^2 q}$ で、論文は自明相を $2|w| < |\mu|$、トポロジカル相を $2|w| > |\mu|$ かつ $\Delta \neq 0$ に置いています。有限長では二つの境界モードが式 (15) の $H_{\mathrm{eff}} = \tfrac{i}{2}t\,b'b''$（$t \propto e^{-L/l_0}$）を通じて相互作用します。したがって二つの基底状態のエネルギー差は鎖長に対して指数的に小さく、フェルミオンパリティが異なります。これは要旨自身の主張です。

**カタログが保持する理由。** これは閉形式のスペクトルと厳密に既知の相境界を持つ二次形式のフェルミオン・ハミルトニアンであり、あらゆるサイズで正解が分かっているベンチマークになります。横磁場イジング模型と同じ性質です。Jordan–Wigner 写像の後に Pauli 和になるため *問い合わせ可能なハミルトニアン* に接続されているのであって、この地図のいずれかの経路がトポロジカル秩序を扱っているからではありません。`,
    },
  },
  { slug: "operator-maxcut-cost", title: "MaxCut cost operator", titleJa: "MaxCutコスト演算子", form: "C = 1/2 Σ(i,j)∈E (I - ZᵢZⱼ)", role: "QAOA objective for graph cuts.", roleJa: "グラフ分割に対するQAOA目的演算子です。" },
  { slug: "operator-qubo", title: "QUBO operator mapping", titleJa: "QUBO演算子写像", form: "xᵀQx, xᵢ ↦ (I-Zᵢ)/2", role: "Maps binary quadratic objectives into diagonal Pauli form.", roleJa: "二次バイナリ目的を対角Pauli形式へ写像します。" },
  { slug: "operator-constraint-penalty", title: "Constraint-penalty operator", titleJa: "制約罰則演算子", form: "H_penalty = λ(Ax-b)²", role: "Raises energy outside a feasible subspace.", roleJa: "実行可能部分空間外のエネルギーを上げます。" },
  { slug: "operator-dipole", title: "Molecular dipole operator", titleJa: "分子双極子演算子", form: "μ = -Σᵢrᵢ + Σ_AR_AZ_A", role: "Observable for molecular polarity and response.", roleJa: "分子極性と応答の観測量です。" },
  { slug: "operator-density", title: "Electronic density operator", titleJa: "電子密度演算子", form: "ρ(r) = Σₚq φ*ₚ(r)φ_q(r)a†ₚa_q", role: "Spatial electron-density observable.", roleJa: "空間電子密度の観測量です。" },
  { slug: "operator-spin-x-total", title: "Total spin-X operator", titleJa: "全スピンX演算子", form: "Sₓ = 1/2 Σᵢ Xᵢ", role: "Collective transverse spin observable.", roleJa: "集団横スピン観測量です。" },
  { slug: "operator-spin-y-total", title: "Total spin-Y operator", titleJa: "全スピンY演算子", form: "Sᵧ = 1/2 Σᵢ Yᵢ", role: "Collective quadrature spin observable.", roleJa: "集団直交スピン観測量です。" },
  { slug: "operator-spin-z-total", title: "Total spin-Z operator", titleJa: "全スピンZ演算子", form: "S_z = 1/2 Σᵢ Zᵢ", role: "Collective magnetization observable.", roleJa: "集団磁化観測量です。" },
  { slug: "operator-total-spin-squared", title: "Total-spin-squared operator", titleJa: "全スピン二乗演算子", form: "S² = Sₓ² + Sᵧ² + S_z²", role: "Labels total-spin sectors and spin contamination.", roleJa: "全スピン・セクターとスピン混入を判別します。" },
  { slug: "operator-fermion-parity", title: "Fermion-parity operator", titleJa: "フェルミオン・パリティ演算子", form: "Π = (-1)^N", role: "Z2 symmetry used for sectors and tapering.", roleJa: "セクター選択とテーパリングに使うZ2対称性です。" },
  { slug: "operator-jordan-wigner-creation", title: "Jordan–Wigner mapped creation operator", titleJa: "Jordan–Wigner生成演算子写像", form: "a†ₚ ↦ (Xₚ-iYₚ)/2 ⊗ Z₀···Zₚ₋₁", role: "Maps fermionic antisymmetry into a parity string.", roleJa: "フェルミオン反対称性をパリティ文字列へ写像します。" },
  {
    slug: "operator-jordan-wigner-number",
    title: "Jordan–Wigner number mapping",
    titleJa: "Jordan–Wigner数演算子写像",
    form: "nₚ ↦ (I-Zₚ)/2",
    role: "Local qubit representation of orbital occupation.",
    roleJa: "軌道占有数の局所量子ビット表現です。",
    depth: {
      outcome: "deepened",
      source: {
        title: "Fermionic quantum computation",
        authors: "Sergey B. Bravyi, Alexei Yu. Kitaev",
        year: "2002",
        url: "https://arxiv.org/abs/quant-ph/0003137",
      },
      tags: ["fermion-to-qubit", "occupation number"],
      verification: "Derived in one line from two statements the cited paper makes, with both located; the 1928 origin is named but not cited, because it was not read.",
      method:
        "arXiv:quant-ph/0003137 was read end to end. Eq. (24) and the §8 identity Bₖ = −i c_2k c_2k+1 = 1 − 2a†ₖaₖ were located, and the qubit form was derived from them rather than quoted from a secondary source.",
      result:
        "Pass · the mapping follows from Eq. (24) plus one Pauli identity. Jordan & Wigner 1928 is the historical origin and is deliberately NOT cited here — see the record.",
      resources: [
        { label: "Primary source", value: "Bravyi & Kitaev 2002, Eq. (24) and §8" },
        { label: "Derivation", value: "One line of Pauli algebra" },
        { label: "Historical origin", value: "Jordan & Wigner 1928 (not read)" },
      ],
      metadata: [
        { label: "Locality", value: "Diagonal — no Z string survives" },
        { label: "Contrast", value: "a†ₚ alone carries an O(m) Z string" },
        { label: "Read depth", value: "Full text of the cited paper" },
      ],
      explanationMd: String.raw`**Why the number operator is the cheap one.** Under Jordan–Wigner a single creation or annihilation operator drags a string of $Z$s across every mode below it, which is the whole reason the encoding costs $O(m)$ per fermionic gate. The number operator does not, and the cancellation is worth seeing rather than asserting.

Bravyi and Kitaev give the Majorana operators at Eq. (24),

$$c_{2k} = a_k + a^\dagger_k = \sigma^x[k]\prod_{j<k}\sigma^z[j], \qquad c_{2k+1} = \frac{a_k - a^\dagger_k}{i} = \sigma^y[k]\prod_{j<k}\sigma^z[j],$$

and state separately, in §8, the identity $B_k = -i\,c_{2k}c_{2k+1} = 1 - 2a^\dagger_k a_k$. Multiplying the two expressions in Eq. (24), the $Z$ strings are identical and square to the identity, so they cancel and leave $c_{2k}c_{2k+1} = \sigma^x\sigma^y[k] = i\sigma^z[k]$. Substituting into the §8 identity gives $1 - 2n_k = \sigma^z[k]$, that is

$$n_p \;\mapsto\; \frac{I - Z_p}{2}.$$

**One product, no string.** The strings cancel because both Majorana operators for mode $k$ carry the *same* prefix. That is why occupation is locally measurable under an encoding whose defining feature is nonlocality, and it is why a Hamiltonian written only in number operators — the Coulomb-repulsion diagonal of a Hubbard model, say — maps to a diagonal Pauli sum with no string cost at all.

**What this record deliberately does not cite.** Jordan and Wigner's 1928 *Über das Paulische Äquivalenzverbot* is where the transformation comes from, and it is not the source of the statement above, because it was not read. Its full text is behind a publisher paywall; a free scan of the whole 1928 volume exists but is in German and reached only through imperfect OCR of a 924-page file. Naming it as the origin costs nothing and claims nothing. Citing it for a qubit-form identity nobody here has read would be the failure this catalog most wants to avoid, and the identity is available from a paper that is free, in English, and was read end to end.`,
      explanationMdJa: String.raw`**数演算子が安価である理由。** Jordan–Wigner 変換のもとでは、生成・消滅演算子は単独ではそれより下のすべてのモードにわたる $Z$ の列を引きずります。これがフェルミオン・ゲート一つあたり $O(m)$ の費用がかかる理由そのものです。数演算子はそうならず、その相殺は主張するより見るほうが早いものです。

Bravyi と Kitaev は式 (24) で Majorana 演算子を

$$c_{2k} = a_k + a^\dagger_k = \sigma^x[k]\prod_{j<k}\sigma^z[j], \qquad c_{2k+1} = \frac{a_k - a^\dagger_k}{i} = \sigma^y[k]\prod_{j<k}\sigma^z[j]$$

と与え、別に §8 で $B_k = -i\,c_{2k}c_{2k+1} = 1 - 2a^\dagger_k a_k$ という関係を述べています。式 (24) の二つを掛けると $Z$ 列は同一で二乗すると恒等演算子になるため相殺し、$c_{2k}c_{2k+1} = \sigma^x\sigma^y[k] = i\sigma^z[k]$ が残ります。これを §8 の関係に代入すると $1 - 2n_k = \sigma^z[k]$、すなわち

$$n_p \;\mapsto\; \frac{I - Z_p}{2}$$

が得られます。

**積は一つ、列は残らない。** モード $k$ の二つの Majorana 演算子が**同じ**接頭列を持つため相殺します。だからこそ、非局所性を定義的特徴とする符号化のもとで占有数が局所的に測定可能になり、数演算子だけで書かれたハミルトニアン（たとえば Hubbard 模型の Coulomb 斥力の対角部分）は列の費用なしに対角 Pauli 和へ写ります。

**この記録が意図的に引用しないもの。** Jordan と Wigner の 1928 年の *Über das Paulische Äquivalenzverbot* は変換の出典ですが、上の記述の典拠ではありません。読んでいないからです。全文は出版社のペイウォールの内側にあり、1928 年の巻全体の無料スキャンは存在するもののドイツ語で、924 ページのファイルの不完全な OCR を通してしか読めません。起源として名を挙げることは何も費やさず何も主張しません。誰も読んでいない量子ビット形の等式の典拠として引用することは、本カタログが最も避けたい失敗にあたります。しかもその等式は、無料で、英語で、通読された論文から得られます。`,
    },
  },
  { slug: "operator-jordan-wigner-hopping", title: "Jordan–Wigner hopping mapping", titleJa: "Jordan–Wignerホッピング写像", form: "a†ₚa_q+h.c. ↦ Pauli strings with a Z parity chain", role: "Qubit representation of fermion transport.", roleJa: "フェルミオン移動の量子ビット表現です。" },
  { slug: "operator-parity-mapping", title: "Parity fermion-to-qubit mapping", titleJa: "パリティ・フェルミオン量子ビット写像", form: "occupation ↦ cumulative parity bits", role: "Alternative encoding that can expose removable symmetries.", roleJa: "除去可能な対称性を示しやすい代替符号化です。" },
  {
    slug: "operator-bravyi-kitaev-mapping",
    title: "Bravyi–Kitaev mapping",
    titleJa: "Bravyi–Kitaev写像",
    form: "occupation and parity stored in logarithmic update sets",
    role: "Balances locality of parity and occupation updates.",
    roleJa: "パリティと占有更新の局所性を両立します。",
    depth: {
      outcome: "deepened",
      source: {
        title: "Fermionic quantum computation",
        authors: "Sergey B. Bravyi, Alexei Yu. Kitaev",
        year: "2002",
        url: "https://arxiv.org/abs/quant-ph/0003137",
      },
      tags: ["fermion-to-qubit", "binary tree", "logarithmic locality"],
      verification: "Read against the primary source; the name this mapping is known by does not appear in it, and that is recorded rather than papered over.",
      method:
        "arXiv:quant-ph/0003137 was read end to end. The encoding, its inverse, the parity sum and the update operator were located in the paper's own numbering, and the paper was searched for the name the community gives it.",
      result:
        "Pass, with one recorded caveat · the paper defines the encoding at §5 Eqs. (19)–(22) and never calls it the “Bravyi–Kitaev transform”; that name is later community usage.",
      resources: [
        { label: "Primary source", value: "Bravyi & Kitaev 2002, §5 Eqs. (19)–(22)" },
        { label: "Cost per fermionic gate", value: "O(log m) qubit gates" },
        { label: "Cost it replaces", value: "O(m) under the standard encoding" },
      ],
      metadata: [
        { label: "Encoding", value: "xⱼ = Σ_{s ⪯ j} nₛ over a binary-tree partial order" },
        { label: "Name in the paper", value: "None — “encodings of the form…”" },
        { label: "Read depth", value: "Full text" },
      ],
      explanationMd: String.raw`**The paper never uses the name.** Bravyi and Kitaev define this encoding in §5, *Fast simulation procedures*, and call it nothing — the text says "encodings of the form" and draws a binary tree. *Bravyi–Kitaev transform* is what the community later called it. This record uses the common name because that is what a reader will search for, and states here that it is not the paper's own word, because a record that quotes a paper should not put a word in its mouth.

**The problem it solves is a bookkeeping cost.** Under the standard identification of $m$ fermionic modes with $m$ qubits, an annihilation operator carries the Jordan–Wigner sign $(-1)^{\sum_{s<j} n_s}$, and computing that string touches every qubit below $j$. Storing $y_j = \sum_{s<j} n_s$ instead fixes the read and breaks the write: changing one occupation number then forces an update to every $y_k$ above it. The paper states the trade in exactly those terms and resolves it by storing *partial* sums.

**The encoding.** Eq. (19) is

$$|n_0,\dots,n_{m-1}\rangle \mapsto |x_0\rangle \otimes \cdots \otimes |x_{m-1}\rangle, \qquad x_j = \sum_{s \preceq j} n_s,$$

where $\preceq$ is a partial order on binary strings that makes the index set a binary tree. The inverse is Eq. (20), $n_j = x_j - \sum_{s \in K(j)} x_s$, and the parity sum the sign needs is Eq. (21), $y_j = \sum_{s \in L(j)} x_s$.

**Where the logarithm comes from.** The paper's own sentence is that each $n_s$ enters only $O(\log m)$ of the $x_j$, and that the sums in Eqs. (20) and (21) each contain $O(\log m)$ terms. Both directions are therefore cheap at once, which is what neither the occupation encoding nor the parity encoding manages alone. The extraction operator is Eq. (22), built from controlled-$X$ and controlled-$Z$ gates over the sets $K(j)$, $L(j)$ and $\{k : k \succeq j\}$, and the paper states it costs $O(\log m)$ operations. The abstract puts the headline the same way: simulating one fermionic gate costs $O(m)$ qubit gates under the standard correspondence, and a different encoding reduces it to $O(\log m)$.

**Why this record does not join the map.** What it documents is a *transformation between representations*, and the map draws no process that performs one. The operator it publishes is the output of the mapping, not an object a route holds between two processes — which is what the ingredient shelf's *encoding* abstention says, and this record is one of the six it says it about.`,
      explanationMdJa: String.raw`**論文はこの名前を使っていません。** Bravyi と Kitaev はこの符号化を §5 *Fast simulation procedures* で定義していますが、名前を与えていません。本文は「encodings of the form」と述べ、二分木を描いているだけです。*Bravyi–Kitaev 変換* は後にコミュニティが付けた呼称です。本記録が通称を用いるのは読者がその語で探すからであり、それが論文自身の語ではないことをここに明記します。論文を引用する記録が、論文の言っていない言葉をその口に入れるべきではないからです。

**解決している問題は帳簿づけのコストです。** $m$ 個のフェルミオン・モードを $m$ 個の量子ビットと標準的に同一視すると、消滅演算子は Jordan–Wigner 符号 $(-1)^{\sum_{s<j} n_s}$ を伴い、この文字列の計算は $j$ より下のすべての量子ビットに触れます。代わりに $y_j = \sum_{s<j} n_s$ を保持すれば読み出しは解決しますが書き込みが壊れ、占有数を一つ変えるたびに上位のすべての $y_k$ を更新することになります。論文はこのトレードオフをまさにその言葉で述べ、**部分**和を保持することで解決します。

**符号化。** 式 (19) は

$$|n_0,\dots,n_{m-1}\rangle \mapsto |x_0\rangle \otimes \cdots \otimes |x_{m-1}\rangle, \qquad x_j = \sum_{s \preceq j} n_s$$

であり、$\preceq$ は添字集合を二分木にする二進文字列上の半順序です。逆変換は式 (20) の $n_j = x_j - \sum_{s \in K(j)} x_s$、符号に必要なパリティ和は式 (21) の $y_j = \sum_{s \in L(j)} x_s$ です。

**対数はどこから来るか。** 論文自身の文によれば、各 $n_s$ は $O(\log m)$ 個の $x_j$ にしか現れず、式 (20) と (21) の和はそれぞれ $O(\log m)$ 項しか含みません。したがって両方向が同時に安価になります。これは占有数符号化にもパリティ符号化にも単独では達成できないことです。取り出し演算子は式 (22) で、集合 $K(j)$、$L(j)$、$\{k : k \succeq j\}$ 上の制御 $X$ と制御 $Z$ から構成され、論文はその費用を $O(\log m)$ 回の操作としています。要旨も同じ形で述べています。標準的な対応では一つのフェルミオン・ゲートの模擬に $O(m)$ の量子ビット・ゲートを要し、別の符号化を使えば $O(\log m)$ に減ります。

**この記録が地図に接続されない理由。** これが記述しているのは**表現のあいだの変換**であり、地図はそれを行う工程を描いていません。ここで公開されている演算子は写像の出力であって、経路が二つの工程のあいだで保持する対象ではありません。材料棚の *encoding* 留保が述べているのはこのことで、本記録はその六件のうちの一つです。`,
    },
  },
  { slug: "operator-z2-symmetry-generator", title: "Z2 symmetry generator", titleJa: "Z2対称性生成子", form: "S = ⊗ᵢ Pᵢ, S²=I, [S,H]=0", role: "Defines conserved sectors and qubit tapering constraints.", roleJa: "保存セクターと量子ビット削減制約を定義します。" },
  { slug: "operator-reference-projector", title: "Reference-state projector", titleJa: "参照状態射影演算子", form: "Π_ref = |φ⟩⟨φ|", role: "Overlap, fidelity, and penalty observable.", roleJa: "重なり、忠実度、罰則の観測量です。" },
  { slug: "operator-deflation-projector", title: "Deflation projector", titleJa: "デフレーション射影演算子", form: "H' = H + β|ψ⟩⟨ψ|", role: "Penalizes an already found eigenstate.", roleJa: "既に求めた固有状態へ罰則を加えます。" },
  { slug: "operator-shifted-hamiltonian-square", title: "Shifted Hamiltonian square", titleJa: "シフトHamiltonian二乗", form: "(H-ωI)²", role: "Folded-spectrum objective around target energy ω.", roleJa: "目標エネルギーω周辺の折り畳みスペクトル目的です。" },
  { slug: "operator-hamiltonian-variance", title: "Hamiltonian variance operator", titleJa: "Hamiltonian分散演算子", form: "H² - ⟨H⟩²", role: "Eigenstate diagnostic and alternative objective.", roleJa: "固有状態診断と代替目的関数です。" },
  { slug: "operator-energy-gradient-commutator", title: "VQE gradient commutator", titleJa: "VQE勾配交換子", form: "∂E/∂θ|₀ = ⟨ψ|[H,A]|ψ⟩", role: "Ranks adaptive ansatz generators.", roleJa: "適応アンサッツ生成子を順位付けします。" },
  { slug: "operator-anti-hermitian-excitation", title: "Anti-Hermitian excitation generator", titleJa: "反Hermitian励起生成子", form: "τ - τ†", role: "Generator used in unitary coupled-cluster circuits.", roleJa: "ユニタリ結合クラスター回路で使う生成子です。" },
  { slug: "operator-ucc-singles-pool", title: "UCC singles operator pool", titleJa: "UCC一重励起演算子プール", form: "{a†_a a_i - a†_i a_a}", role: "Adaptive or fixed single-excitation generator set.", roleJa: "適応または固定の一重励起生成子集合です。" },
  { slug: "operator-ucc-doubles-pool", title: "UCC doubles operator pool", titleJa: "UCC二重励起演算子プール", form: "{a†_a a†_b a_j a_i - h.c.}", role: "Correlated double-excitation generator set.", roleJa: "相関二重励起の生成子集合です。" },
  { slug: "operator-qubit-adapt-pool", title: "Qubit-ADAPT Pauli pool", titleJa: "Qubit-ADAPT Pauliプール", form: "{iP_k}", role: "Qubit-space anti-Hermitian generator candidates.", roleJa: "量子ビット空間の反Hermitian生成子候補です。" },
  { slug: "operator-pauli-time-evolution", title: "Pauli time-evolution operator", titleJa: "Pauli時間発展演算子", form: "U_P(t) = exp(-itP)", role: "Primitive for Trotter simulation and problem-inspired ansätze.", roleJa: "Trotterシミュレーションと問題着想型アンサッツの基本要素です。" },
  { slug: "operator-trotter-product", title: "First-order Trotter product", titleJa: "一次Trotter積演算子", form: "e^{-itΣH_j} ≈ ∏_j e^{-itH_j}", role: "Product-formula approximation to Hamiltonian evolution.", roleJa: "Hamiltonian時間発展の積公式近似です。" },
  {
    slug: "operator-commuting-group",
    title: "Commuting observable group",
    titleJa: "可換観測量グループ",
    form: "G_k={P_j : [P_i,P_j]_qw=0}",
    role: "Measurement partition for shared basis estimation.",
    roleJa: "共有基底推定のための測定分割です。",
    depth: {
      outcome: "deepened",
      source: {
        title:
          "Measurement Optimization in the Variational Quantum Eigensolver Using a Minimum Clique Cover",
        authors: "Vladyslav Verteletskyi, Tzu-Ching Yen, Artur F. Izmaylov",
        year: "2019",
        url: "https://arxiv.org/abs/1907.03358",
      },
      tags: ["qubit-wise commutativity", "minimum clique cover"],
      verification: "Read against the primary source, which corrected this record's own stated form: full commutativity is the wrong relation and the paper gives the counterexample.",
      method:
        "arXiv:1907.03358 was read end to end, specifically to test whether an object record can say anything a method record citing the same paper does not.",
      result:
        "Pass, and one correction shipped · the form was [Pᵢ,Pⱼ]=0 and is now the qubit-wise commutator, because the paper shows plain commutativity does not give simultaneous single-qubit measurability.",
      resources: [
        { label: "Primary source", value: "Verteletskyi, Yen & Izmaylov 2019, §II A" },
        { label: "Relation", value: "Qubit-wise commutativity, Eq. (4)" },
        { label: "Not an equivalence relation", value: "Transitivity fails" },
      ],
      metadata: [
        { label: "Counterexample", value: "[x₁x₂, y₁y₂] = 0 but not qubit-wise" },
        { label: "Consequence", value: "No unique partition — hence clique cover" },
        { label: "Read depth", value: "Full text" },
      ],
      explanationMd: String.raw`**The relation is not the one this record used to state.** Its form was $G_k = \{P_j : [P_i,P_j] = 0\}$ — ordinary commutativity — and the cited paper shows that is the wrong condition. Two Pauli words that commute need not be simultaneously measurable by single-qubit projective measurements, and the paper's own counterexample is $[\hat{x}_1\hat{x}_2, \hat{y}_1\hat{y}_2] = 0$ while the two are not qubit-wise commuting. Their common eigenstates are entangled superpositions rather than product states, so no set of single-qubit measurements resolves both. The relation that does the work is the **qubit-wise commutator** of Eq. (4), which vanishes only when every single-qubit factor of $P_I$ commutes with its counterpart in $P_J$. Qubit-wise commuting implies commuting; the converse fails.

**The property worth knowing about this object is that it is not a partition.** Qubit-wise commutativity is reflexive and symmetric but **not transitive** — the paper's example is $[\hat{x}_1,\hat{y}_2]_{qw} = 0$ and $[\hat{y}_2,\hat{z}_1]_{qw} = 0$ while $[\hat{x}_1,\hat{z}_1]_{qw} \neq 0$. So it is not an equivalence relation, there are no equivalence classes, and a Hamiltonian has **no unique grouping** of its terms.

That is why the object is a *group* in the loose sense and never a partition, and it is the reason the optimization problem is a minimum clique cover over a graph rather than a sort into buckets. Represent each Pauli word as a vertex and join qubit-wise commuting pairs by an edge; a set of mutually measurable terms is then a clique, and the best grouping is a minimum cover by cliques — which the paper notes is NP-hard, hence the heuristics.

**Why this record exists beside the method record, which cites the same paper.** It was written to test whether it should. The answer is that the two carry different halves and neither is the other's summary: the algebraic facts above — which relation, why it is not transitive, why no unique grouping exists — are properties of the object and hold whatever procedure you use. What belongs to *vqe-measurement-grouping* instead is the procedure and its measured result: which heuristics were benchmarked, and that grouping reduced the operator count roughly threefold against the total number of Hamiltonian terms. **An object record that repeated the threefold figure would be restating the method from the object's side, and this one does not.**`,
      explanationMdJa: String.raw`**この関係は、本記録がこれまで記していたものではありません。** 従来の形は $G_k = \{P_j : [P_i,P_j] = 0\}$、すなわち通常の可換性でしたが、引用論文はそれが誤った条件であることを示しています。可換な二つの Pauli 語が単一量子ビットの射影測定で同時測定可能とは限らず、論文自身の反例は $[\hat{x}_1\hat{x}_2, \hat{y}_1\hat{y}_2] = 0$ でありながら両者が量子ビットごとには可換でない、というものです。共通固有状態が積状態ではなくもつれた重ね合わせになるため、いかなる単一量子ビット測定の組も両方を解決しません。実際に機能する関係は式 (4) の**量子ビットごとの交換子**であり、$P_I$ の各単一量子ビット因子が $P_J$ の対応factorと可換であるときにのみ零になります。量子ビットごとに可換ならば可換ですが、逆は成り立ちません。

**この対象について知る価値のある性質は、それが分割ではないということです。** 量子ビットごとの可換性は反射的かつ対称的ですが、**推移的ではありません**。論文の例は $[\hat{x}_1,\hat{y}_2]_{qw} = 0$ かつ $[\hat{y}_2,\hat{z}_1]_{qw} = 0$ でありながら $[\hat{x}_1,\hat{z}_1]_{qw} \neq 0$ です。したがって同値関係ではなく、同値類も存在せず、ハミルトニアンの項に**一意なグループ分けは存在しません**。

だからこそこの対象は緩い意味での「グループ」であって決して分割ではなく、最適化問題がバケツへの仕分けではなくグラフ上の最小クリーク被覆になるのです。各 Pauli 語を頂点とし、量子ビットごとに可換な対を辺で結ぶと、相互に測定可能な項の集合はクリークとなり、最良のグループ分けは最小クリーク被覆になります。論文はこれが NP 困難であることを述べており、ヒューリスティクスが用いられる理由がそこにあります。

**同じ論文を引用する手法の記録と並んで本記録が存在する理由。** それを検証するために書かれました。答えは、両者が異なる半分を担っており、どちらも他方の要約ではない、というものです。上の代数的事実——どの関係か、なぜ推移的でないか、なぜ一意なグループ分けが存在しないか——は対象の性質であり、どの手続きを使おうと成り立ちます。一方 *vqe-measurement-grouping* に属するのは手続きとその測定結果です。どのヒューリスティクスがベンチマークされたか、そしてグループ化によりハミルトニアンの全項数に対して演算子数がおよそ三分の一に減ったこと。**三分の一という数値を繰り返す対象記録は、手法を対象の側から述べ直しているだけであり、本記録はそれをしません。**`,
    },
  },
  {
    slug: "operator-one-rdm",
    title: "One-particle reduced density matrix",
    titleJa: "一粒子縮約密度行列",
    form: "γₚq = ⟨a†ₚa_q⟩",
    role: "Compact one-body state descriptor and orbital gradient input.",
    roleJa: "一体状態のコンパクトな記述と軌道勾配入力です。",
    depth: {
      outcome: "deepened",
      source: {
        title: "N-representability is QMA-complete",
        authors: "Yi-Kai Liu, Matthias Christandl, F. Verstraete",
        year: "2007",
        url: "https://arxiv.org/abs/quant-ph/0609125",
      },
      tags: ["n-representability", "reduced density matrix", "qma-complete"],
      verification: "Read against the primary source; the paper's own statement about the one-body case is used, and the condition it does not state is not stated here.",
      method:
        "arXiv:quant-ph/0609125 was read end to end. The one-body claim was taken from the paper's own closing discussion, and the complexity result was checked for which reduced density matrix it is about.",
      result:
        "Pass, with two claims refused · the paper says the one-body case is decidable from eigenvalues alone but does not give the explicit condition, so no explicit condition is quoted; and the QMA-completeness is about the TWO-body matrix.",
      resources: [
        { label: "Primary source", value: "Liu, Christandl & Verstraete 2007" },
        { label: "1-RDM consistency", value: "Decidable from eigenvalues alone" },
        { label: "2-RDM consistency", value: "QMA-complete" },
      ],
      metadata: [
        { label: "Why 1-body is easy", value: "Extreme points are free-fermion ground states" },
        { label: "Problem posed by", value: "Coulson, per this paper" },
        { label: "Read depth", value: "Full text" },
      ],
      explanationMd: String.raw`**The interesting fact about this object is a negative one about its neighbour.** Given a matrix $\gamma_{pq}$, when is it the one-body reduced density matrix of *some* antisymmetric $N$-fermion state? That is the $N$-representability question, and Liu, Christandl and Verstraete record that Coulson posed the problem and that its fermionic form takes its name from Coleman.

For the one-body case their paper is explicit, and the sentence is worth having exactly: *"checking consistency of 2-body reduced density operators of fermionic states is so hard, while checking consistency of 1-body reduced density operators is simple"* — and, they add, consistency in that case *"can be decided … based solely on the eigenvalues of the reduced density operators."*

**The reason is structural rather than lucky.** The paper gives it: the extreme points of the convex set of one-body density operators $\langle a^\dagger_i a_j\rangle$ are ground states of Hamiltonians containing only bilinear terms in $a^\dagger_i$ and $a_j$ — free fermions — and those diagonalize easily. So the one-body consistency problem inherits the tractability of the free-fermion problem, which is exactly why this object is a workable state descriptor and a workable orbital-gradient input.

**The neighbouring object is intractable, and the precise claim matters.** The paper's result is that deciding $N$-representability of the **two**-body reduced density matrix is QMA-complete, and hence NP-hard. Two qualifications that a shortened version of this sentence would lose: the result classifies the problem's difficulty rather than solving it, and it is about the 2-RDM specifically — the 1-RDM case remains the easy one described above. The paper separately notes that restricting to the diagonal elements of the 2-RDM leaves an NP-hard problem.

**One claim this record refuses to make.** The explicit one-body condition often quoted — occupation numbers in $[0,1]$ summing to $N$ — is *not* stated in the paper cited here, which says only that eigenvalues suffice. It may well be correct and it is attributed elsewhere to Coleman's 1963 paper, which is behind a paywall and was not read. So it is left out. Citing this source for a condition it does not state would be the exact failure the catalog's sourcing rule exists to prevent, and "decidable from the eigenvalues" is the true claim and is enough.

**Why it does not join the map.** It is measured. *observable-estimation* names the operator being measured in its contract prose, where a parameter lives and a state does not — this record is one of the seventeen the shelf's *observable* abstention covers.`,
      explanationMdJa: String.raw`**この対象について興味深い事実は、隣の対象についての否定的な事実です。** 行列 $\gamma_{pq}$ が与えられたとき、それが**何らかの**反対称 $N$ フェルミオン状態の一体縮約密度行列であるのはいつか。これが $N$ 表現可能性の問いであり、Liu、Christandl、Verstraete はこの問題を Coulson が提起したこと、フェルミオン版の名称が Coleman に由来することを記しています。

一体の場合について論文は明確です。*「フェルミオン状態の二体縮約密度演算子の整合性検査がこれほど難しい一方で、一体縮約密度演算子の整合性検査は簡単である」*、そしてその場合の整合性は*「縮約密度演算子の固有値のみに基づいて」*判定できる、と述べています。

**理由は偶然ではなく構造的です。** 論文はこう与えています。一体密度演算子 $\langle a^\dagger_i a_j\rangle$ の凸集合の端点は、$a^\dagger_i$ と $a_j$ の双一次項のみを含むハミルトニアン、すなわち自由フェルミオンの基底状態であり、それらは容易に対角化できます。したがって一体の整合性問題は自由フェルミオン問題の扱いやすさを受け継ぎます。この対象が実用的な状態記述子であり軌道勾配の入力である理由がこれです。

**隣の対象は困難であり、主張の正確さが重要です。** 論文の結果は、**二**体縮約密度行列の $N$ 表現可能性の判定が QMA 完全であり、したがって NP 困難であるというものです。短縮すると失われる限定が二つあります。この結果は問題の難しさを**分類**するものであって解決するものではないこと、そして対象は 2-RDM に固有であり、1-RDM は上述のとおり容易なままであることです。論文は別に、2-RDM の対角成分に制限しても NP 困難であることを述べています。

**この記録が拒む主張が一つあります。** しばしば引用される一体の明示的条件——占有数が $[0,1]$ に入り総和が $N$ になる——は、ここで引用した論文には**書かれていません**。論文が述べているのは固有値で足りるということだけです。この条件は正しい可能性が高く、他所では Coleman の 1963 年論文に帰されていますが、その論文はペイウォールの内側にあり読んでいません。したがって記載しません。述べていない条件の典拠としてこの出典を引くことは、本カタログの出典規則が防ごうとしている失敗そのものです。「固有値で判定できる」が真の主張であり、それで十分です。

**地図に接続されない理由。** これは測定される対象です。*observable-estimation* は測定される演算子を契約の散文の中で挙げており、そこはパラメータの居場所であって状態の居場所ではありません。本記録は棚の *observable* 留保が対象とする 17 件のうちの一つです。`,
    },
  },
  { slug: "operator-two-rdm", title: "Two-particle reduced density matrix", titleJa: "二粒子縮約密度行列", form: "Γₚqrs = ⟨a†ₚa†_q a_s a_r⟩", role: "Two-body correlation descriptor used in energy and response.", roleJa: "エネルギーと応答に使う二体相関記述です。" },
];

const OPENFERMION_SOURCE = {
  title: "OpenFermion: The Electronic Structure Package for Quantum Computers",
  authors: "Jarrod R. McClean, Kevin J. Sung, Ian D. Kivlichan, Yudong Cao, Chengyu Dai, E. Schuyler Fried, Craig Gidney, Brendan Gimby, Pranav Gokhale, Thomas Häner, Tarini Hardikar, Vojtěch Havlíček, Oscar Higgott, Cupjin Huang, Josh Izaac, Zhang Jiang, Xinle Liu, Sam McArdle, Matthew Neeley, Thomas O'Brien, Bryan O'Gorman, Isil Ozfidan, Maxwell D. Radin, Jhonathan Romero, Nicholas Rubin, Nicolas P. D. Sawaya, Kanav Setia, Sukin Sim, Damian S. Steiger, Mark Steudtner, Qiming Sun, Wei Sun, Daochen Wang, Fang Zhang, Ryan Babbush",
  year: "2017",
  url: "https://arxiv.org/abs/1710.07629",
};

/**
 * The record for one operator concept, deepened where a pass has deepened it.
 *
 * **The template half is not a defect to be apologised for.** Fifty operator
 * definitions that share a scaffold and differ in a formula and a sentence are
 * an honest way to publish fifty definitions. What was wrong was that nothing
 * said which of them had been *looked into* and which had not — so a record
 * carrying a real primary source read end to end was indistinguishable from one
 * carrying a software-package citation that states nothing about it. `depth`
 * makes that difference a fact the corpus knows about itself.
 */
function operatorEntry(concept: OperatorConcept): PublicRepositoryEntry {
  const depth = concept.depth;
  const source = depth?.source ?? OPENFERMION_SOURCE;
  return makeReferenceEntry({
    slug: concept.slug,
    title: concept.title,
    titleJa: concept.titleJa,
    category: "operators",
    categoryLabel: "Operators",
    categoryLabelJa: "演算子",
    algorithmFamily: "VQE Hamiltonians and observables",
    framework: "Qiskit",
    status: "verified_caveats",
    verification:
      depth?.verification ??
      "Definition and role checked against quantum-simulation literature; no circuit or coefficient data set is implied.",
    verificationMethods: ["research_paper"],
    method: depth?.method ?? "Mathematical-definition and literature curation",
    result:
      depth?.result ??
      "Pass · representative form, VQE role, and non-circuit conversion boundary are explicit.",
    caveat: "Indices, coefficients, basis conventions, mappings, and units are instance dependent and must be recorded in an executable experiment.",
    exportStatus: "Operator reference · circuit conversion not applicable",
    provenance: "Leona Quantum VQE operator expansion",
    updatedAt: "2026-07-18",
    description: `${concept.role} Representative form: ${concept.form}.`,
    descriptionJa: `${concept.roleJa} 代表形式: ${concept.form}。`,
    introduction: `${concept.title} is cataloged as an operator rather than a circuit. ${concept.role}`,
    introductionJa: `${concept.titleJa}は回路ではなく演算子として収録します。${concept.roleJa}`,
    explanation: `${concept.role} A representative mathematical form is ${concept.form}. To use this record in VQE, an implementation must specify index ordering, coefficient values and units, basis conventions, fermion-to-qubit mapping where applicable, symmetry sector, and measurement grouping. Those choices can change resource counts and even the physical interpretation. The catalog therefore preserves this as a sourced operator definition and refuses to fabricate seven circuit variants for an object that is not itself an ordered gate program.`,
    explanationJa: `${concept.roleJa} 代表的な数学形式は ${concept.form} です。VQEで使うには、添字順序、係数と単位、基底規約、必要な場合のフェルミオン量子ビット写像、対称性セクター、測定グループを明示する必要があります。これらは資源量や物理的解釈を変え得ます。そのため本カタログは出典付き演算子定義として保持し、順序付きゲートプログラムではない対象に7種類の回路を捏造しません。`,
    // **The third element is the tag `ingredients.ts` keys its rules on**, so it
    // stays exactly where it was and any deepening tags are appended after it.
    // Prepending would not break anything today — the rules match on membership,
    // not position — but the ordering is the only thing making it obvious to a
    // reader that this list has a load-bearing element in it.
    ...(depth?.explanationMd ? { explanationMd: depth.explanationMd } : {}),
    ...(depth?.explanationMdJa ? { explanationMdJa: depth.explanationMdJa } : {}),
    tags: [
      "VQE operator",
      "Hamiltonian",
      concept.title.toLowerCase(),
      ...(depth?.tags ?? []),
    ],
    resources: depth?.resources ?? [
      { label: "Representative form", value: concept.form },
      { label: "Record type", value: "Operator definition" },
    ],
    metadata: depth?.metadata ?? [
      { label: "Circuit", value: "Not supplied" },
      { label: "Instance data", value: "Required for execution" },
    ],
    sourceTitle: source.title,
    sourceUrl: source.url,
    sourceLicense: "Citation metadata only; source publication terms apply",
    wires: ["definition", "mapping", "measurement"],
    operations: [
      { label: "specify", qubits: [0], tone: "neutral" },
      { label: "map", qubits: [0, 1], tone: "accent" },
      { label: "group", qubits: [1, 2], tone: "warn" },
    ],
    outcomes: [],
    code: `OPERATOR: ${concept.title}\nREPRESENTATIVE FORM: ${concept.form}\nROLE: ${concept.role}\n\nThis is a mathematical operator record, not an executable circuit.`,
    filename: `${concept.slug}.txt`,
    language: "text",
    relatedSlugs: ["vqe-ground-state-energy", "pauli-x-operator"],
    literature: [
      depth?.source
        ? {
            ...depth.source,
            relevance: `Primary source for this record, read at the depth its ${depth.outcome} outcome states.`,
            relevanceJa: `本記録の一次資料です。読んだ深さは ${depth.outcome} の結果が示すとおりです。`,
          }
        : {
            ...OPENFERMION_SOURCE,
            relevance: "Provides open-source representations and transformations for fermionic and qubit operators used in quantum simulation.",
            relevanceJa: "量子シミュレーションで使うフェルミオン・量子ビット演算子の表現と変換を提供します。",
          },
    ],
  });
}

/**
 * How far each operator record has been looked into — the census, derived from
 * the table rather than maintained beside it.
 *
 * **Published because the number it produces is the one that decides what to do
 * with the other forty-two.** "Most of this corpus is a stub" and "we deepened
 * eight and here is what it cost" are different claims, and only the second is
 * checkable. `check-ingredients.mjs --depth` prints this with its denominator.
 */
export const OPERATOR_DEPTH_CENSUS: Readonly<Record<string, DepthOutcome>> = Object.freeze(
  Object.fromEntries(
    OPERATOR_CONCEPTS.map(
      (concept) => [concept.slug, concept.depth?.outcome ?? "template"] as const,
    ),
  ),
);

export const LITERATURE_EXPANSION_ENTRIES: PublicRepositoryEntry[] = [
  ...CIRCUIT_FAMILIES.flatMap((family) => widthsFor(family).map((width) => circuitEntry(family, width))),
  ...VQE_METHODS.map(vqeEntry),
  ...OPERATOR_CONCEPTS.map(operatorEntry),
];
