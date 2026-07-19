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
  build: (width: number) => PortableCircuit;
};

const WIDTHS = [2, 3, 4, 5, 6, 8, 12, 16];
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
  year: "2023",
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
    explanationJa: `この回路はフレームワーク中立の順序付きゲートグラフとして一度だけ保存され、選択時に遅延変換されます。限定ゲート集合の範囲で、ゲート順、数値角度、量子ビット番号、末尾の全量子ビット測定を保持します。一方、各コンパイラの分解や実機挙動が同一であるとは主張しません。MQT Bench論文は規模可変・多層のベンチマーク方法論の根拠であり、この具体回路はLeona Quantum独自の足場です。幅、演算数、変換後深さ、2量子ビット演算数、測定結果で比較してください。`,
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
  authors: "A. Tilly et al.",
  year: "2022",
  url: "https://arxiv.org/abs/2103.08505",
};

const VQE_METHODS: Concept[] = [
  { slug: "vqe-objective-loop", title: "VQE objective and optimization loop", titleJa: "VQE目的関数と最適化ループ", summary: "The canonical hybrid loop: prepare an ansatz, estimate a Hamiltonian expectation, and update parameters classically.", summaryJa: "アンサッツ準備、Hamiltonian期待値推定、古典パラメータ更新からなる標準ハイブリッドループです.", source: { title: "A variational eigenvalue solver on a photonic quantum processor", authors: "A. Peruzzo et al.", year: "2014", url: "https://arxiv.org/abs/1304.3061" } },
  { slug: "vqe-hardware-efficient-ansatz", title: "Hardware-efficient VQE ansatz", titleJa: "ハードウェア効率型VQEアンサッツ", summary: "Alternating native one-qubit rotations and entanglers reduce compilation overhead but can change trainability.", summaryJa: "ネイティブ1量子ビット回転とエンタングラーを交互に使い、コンパイル負荷を抑える一方で学習性に影響します.", source: { title: "Hardware-efficient variational quantum eigensolver for small molecules and quantum magnets", authors: "A. Kandala et al.", year: "2017", url: "https://arxiv.org/abs/1704.05018" } },
  { slug: "vqe-uccsd-ansatz", title: "UCCSD VQE ansatz", titleJa: "UCCSD VQEアンサッツ", summary: "A chemistry-inspired unitary coupled-cluster ansatz truncated to single and double excitations.", summaryJa: "一重・二重励起に打ち切った化学着想型ユニタリ結合クラスター・アンサッツです.", source: { title: "Scalable Quantum Simulation of Molecular Energies", authors: "P. J. J. O'Malley et al.", year: "2016", url: "https://arxiv.org/abs/1512.06860" } },
  { slug: "vqe-generalized-excitations", title: "Generalized excitation VQE", titleJa: "一般化励起VQE", summary: "Generalized singles and doubles relax occupied-to-virtual restrictions to enlarge the variational manifold.", summaryJa: "占有軌道から仮想軌道への制約を緩和し、変分多様体を広げる一般化一重・二重励起です." },
  { slug: "vqe-k-upccgsd", title: "k-UpCCGSD ansatz", titleJa: "k-UpCCGSDアンサッツ", summary: "Repeated paired generalized doubles with generalized singles trade expressivity against shallower chemistry circuits.", summaryJa: "対になった一般化二重励起と一般化一重励起を反復し、表現力と回路深さを調整します.", source: { title: "A Quantum Computing View on Unitary Coupled Cluster Theory", authors: "J. Lee et al.", year: "2019", url: "https://arxiv.org/abs/1810.02327" } },
  { slug: "vqe-adapt", title: "ADAPT-VQE", titleJa: "ADAPT-VQE", summary: "An adaptive ansatz grows one operator at a time using measured energy gradients from a predefined pool.", summaryJa: "事前定義した演算子プールのエネルギー勾配を測定し、演算子を1つずつ追加する適応型アンサッツです.", source: { title: "A Quantum-Classical Algorithm for Molecular Properties Near Term Quantum Devices", authors: "H. R. Grimsley et al.", year: "2019", url: "https://arxiv.org/abs/1812.11173" } },
  { slug: "vqe-qubit-adapt", title: "Qubit-ADAPT-VQE", titleJa: "Qubit-ADAPT-VQE", summary: "Qubit-space Pauli generators replace fermionic excitation operators to seek shorter adaptive circuits.", summaryJa: "フェルミオン励起演算子を量子ビット空間のPauli生成子に置き換え、短い適応回路を目指します.", source: { title: "Qubit-ADAPT-VQE: An Adaptive Algorithm for Constructing Hardware-Efficient Ansätze on a Quantum Processor", authors: "H. L. Tang et al.", year: "2021", url: "https://arxiv.org/abs/1911.10205" } },
  { slug: "vqe-batched-adapt", title: "Batched ADAPT-VQE", titleJa: "バッチ型ADAPT-VQE", summary: "Several high-gradient operators are appended per adaptive iteration to reduce optimization and measurement rounds.", summaryJa: "各適応反復で複数の高勾配演算子を追加し、最適化と測定のラウンド数を減らします." },
  { slug: "vqe-tetris-adapt", title: "TETRIS-ADAPT-VQE", titleJa: "TETRIS-ADAPT-VQE", summary: "Operators with disjoint support are packed into the same adaptive layer to reduce circuit depth.", summaryJa: "支持が重ならない演算子を同じ適応層に詰め込み、回路深さを抑えます." },
  { slug: "vqe-qcc", title: "Qubit coupled-cluster VQE", titleJa: "量子ビット結合クラスターVQE", summary: "Qubit coupled-cluster uses Pauli-word entanglers and a product-state reference directly in qubit space.", summaryJa: "Pauli語エンタングラーと積状態参照を量子ビット空間で直接用いる結合クラスター法です.", source: { title: "Qubit Coupled Cluster Method for Quantum Computations", authors: "I. G. Ryabinkin et al.", year: "2018", url: "https://arxiv.org/abs/1809.03827" } },
  { slug: "vqe-iterative-qcc", title: "Iterative qubit coupled cluster", titleJa: "反復量子ビット結合クラスター", summary: "Iterative QCC repeatedly dresses the Hamiltonian and selects new entanglers instead of fixing one deep circuit.", summaryJa: "Hamiltonianを反復的に変換して新しいエンタングラーを選び、固定された深い回路を避けます." },
  { slug: "vqe-symmetry-preserving", title: "Symmetry-preserving VQE ansatz", titleJa: "対称性保持VQEアンサッツ", summary: "The ansatz is constrained to preserve selected particle-number, parity, or spin symmetries.", summaryJa: "粒子数、パリティ、スピンなど選択した対称性を保持するようアンサッツを制約します." },
  { slug: "vqe-particle-conserving", title: "Particle-conserving VQE circuits", titleJa: "粒子数保存VQE回路", summary: "Givens-style or excitation-preserving blocks keep evolution inside a fixed-particle-number sector.", summaryJa: "Givens型または励起保存ブロックにより、固定粒子数セクター内で発展させます." },
  { slug: "vqe-spin-adapted", title: "Spin-adapted VQE ansatz", titleJa: "スピン適応VQEアンサッツ", summary: "Spin-complemented generators reduce leakage from a target total-spin sector.", summaryJa: "スピン相補生成子を使い、目標全スピン・セクターからの漏れを抑えます." },
  { slug: "vqe-orbital-optimized", title: "Orbital-optimized VQE", titleJa: "軌道最適化VQE", summary: "Orbital rotations are optimized alongside circuit parameters to improve compact active-space descriptions.", summaryJa: "回路パラメータと同時に軌道回転を最適化し、コンパクトな活性空間表現を改善します." },
  { slug: "vqe-vqd", title: "Variational quantum deflation", titleJa: "変分量子デフレーション", summary: "Overlap penalties against previously found states turn excited-state search into a sequence of VQE objectives.", summaryJa: "既知状態との重なり罰則を加え、励起状態探索を一連のVQE目的関数に変換します.", source: { title: "Calculation of excited states of molecules on a quantum computer", authors: "O. Higgott et al.", year: "2019", url: "https://arxiv.org/abs/1805.08138" } },
  { slug: "vqe-ssvqe", title: "Subspace-search VQE", titleJa: "部分空間探索VQE", summary: "One shared unitary transforms several orthogonal inputs while a weighted objective orders multiple eigenstates.", summaryJa: "共有ユニタリで複数の直交入力を変換し、重み付き目的関数で複数固有状態を順序付けます.", source: { title: "Subspace-search variational quantum eigensolver for excited states", authors: "K. M. Nakanishi et al.", year: "2019", url: "https://arxiv.org/abs/1810.09434" } },
  { slug: "vqe-mc-vqe", title: "Multistate contracted VQE", titleJa: "多状態縮約VQE", summary: "A contracted reference subspace is jointly entangled before a small effective Hamiltonian is diagonalized.", summaryJa: "縮約参照部分空間を共同でエンタングルし、小さな有効Hamiltonianを対角化します." },
  { slug: "vqe-folded-spectrum", title: "Folded-spectrum VQE", titleJa: "折り畳みスペクトルVQE", summary: "Minimizing the squared shifted Hamiltonian targets eigenstates near a chosen energy shift.", summaryJa: "シフトしたHamiltonianの二乗を最小化し、指定エネルギー近傍の固有状態を狙います." },
  { slug: "vqe-penalty-excited-state", title: "Penalty-based excited-state VQE", titleJa: "罰則型励起状態VQE", summary: "Orthogonality or symmetry penalties augment the energy objective to exclude previously identified sectors.", summaryJa: "直交性または対称性の罰則をエネルギー目的に加え、既知セクターを除外します." },
  { slug: "vqe-quantum-subspace-expansion", title: "Quantum subspace expansion", titleJa: "量子部分空間展開", summary: "Measured response operators around a VQE state define a generalized eigenproblem for excitations and mitigation.", summaryJa: "VQE状態周辺の応答演算子を測定し、励起と誤差緩和の一般化固有値問題を構成します.", source: { title: "Quantum subspace expansion method for error mitigation and excited states", authors: "J. R. McClean et al.", year: "2017", url: "https://arxiv.org/abs/1603.05681" } },
  { slug: "vqe-qeom", title: "Quantum equation-of-motion VQE", titleJa: "量子運動方程式VQE", summary: "Commutator matrix elements over a VQE reference produce excitation energies through an equation-of-motion problem.", summaryJa: "VQE参照上の交換子行列要素から、運動方程式問題として励起エネルギーを求めます." },
  { slug: "vqe-variance-objective", title: "Variance-minimizing VQE", titleJa: "分散最小化VQE", summary: "Hamiltonian variance supplements or replaces energy to target eigenstates and diagnose convergence.", summaryJa: "Hamiltonian分散をエネルギーに追加または置換し、固有状態探索と収束診断に使います." },
  { slug: "vqe-cvar", title: "CVaR-VQE objective", titleJa: "CVaR-VQE目的関数", summary: "Conditional value-at-risk averages only a selected low-energy tail of samples for combinatorial objectives.", summaryJa: "組合せ最適化で、サンプルの低エネルギー側の選択部分だけを平均します.", source: { title: "Improving Variational Quantum Optimization using CVaR", authors: "P. K. Barkoutsos et al.", year: "2020", url: "https://arxiv.org/abs/1907.04769" } },
  { slug: "vqe-imaginary-time", title: "Variational imaginary-time evolution", titleJa: "変分虚時間発展", summary: "McLachlan-style projected imaginary-time dynamics update parameters toward low-energy states.", summaryJa: "McLachlan型の射影虚時間ダイナミクスで低エネルギー状態へパラメータを更新します.", source: { title: "Variational Quantum Simulation of General Processes", authors: "X. Yuan et al.", year: "2019", url: "https://arxiv.org/abs/1812.08767" } },
  { slug: "vqe-natural-gradient", title: "Quantum natural-gradient VQE", titleJa: "量子自然勾配VQE", summary: "The Fubini–Study metric preconditions parameter updates according to circuit-state geometry.", summaryJa: "Fubini–Study計量で回路状態の幾何に基づきパラメータ更新を前処理します." },
  { slug: "vqe-spsa-optimizer", title: "SPSA-optimized VQE", titleJa: "SPSA最適化VQE", summary: "Simultaneous perturbation estimates a stochastic gradient with two objective evaluations per iteration.", summaryJa: "同時摂動により、各反復2回の目的関数評価で確率的勾配を推定します." },
  { slug: "vqe-gradient-based", title: "Analytic-gradient VQE", titleJa: "解析勾配VQE", summary: "Parameter-shift or analytic derivative measurements supply gradients to a classical optimizer.", summaryJa: "パラメータシフトまたは解析微分測定で古典最適化器へ勾配を供給します." },
  { slug: "vqe-layerwise-training", title: "Layerwise VQE training", titleJa: "層別VQE学習", summary: "Circuit depth grows in stages so each newly introduced layer can be initialized and optimized locally.", summaryJa: "回路深さを段階的に増やし、新しい各層を局所的に初期化・最適化します." },
  { slug: "vqe-warm-start", title: "Warm-start VQE", titleJa: "ウォームスタートVQE", summary: "Classical approximations, smaller active spaces, or nearby geometries initialize the variational parameters.", summaryJa: "古典近似、小さな活性空間、近傍形状から変分パラメータを初期化します." },
  { slug: "vqe-active-space", title: "Active-space VQE workflow", titleJa: "活性空間VQEワークフロー", summary: "Frozen-core and active-orbital choices define the Hamiltonian size before variational optimization.", summaryJa: "凍結コアと活性軌道の選択により、変分最適化前のHamiltonian規模を定めます." },
  { slug: "vqe-qubit-tapering", title: "Symmetry-tapered VQE", titleJa: "対称性テーパリングVQE", summary: "Known Z2 symmetries remove qubits and constrain the variational search to a selected sector.", summaryJa: "既知のZ2対称性で量子ビットを削減し、選択セクターへ変分探索を制約します." },
  { slug: "vqe-measurement-grouping", title: "Measurement-grouped VQE", titleJa: "測定グループ化VQE", summary: "Commuting Pauli terms are partitioned into compatible bases to reduce distinct measurement circuits.", summaryJa: "可換Pauli項を互換基底に分割し、異なる測定回路数を減らします." },
  { slug: "vqe-classical-shadows", title: "Classical-shadow VQE estimation", titleJa: "古典シャドウVQE推定", summary: "Randomized measurements are reused to estimate many observables from a shared data set.", summaryJa: "ランダム測定を再利用し、共有データ集合から多数の観測量を推定します." },
  { slug: "vqe-symmetry-verification", title: "Symmetry-verified VQE", titleJa: "対称性検証VQE", summary: "Samples outside conserved symmetry sectors are rejected or reweighted as an error-mitigation step.", summaryJa: "保存対称性セクター外のサンプルを除外または再重み付けして誤差緩和します." },
  { slug: "vqe-zero-noise-extrapolation", title: "Zero-noise-extrapolated VQE", titleJa: "ゼロノイズ外挿VQE", summary: "Energy estimates at amplified noise levels are extrapolated toward an inferred zero-noise limit.", summaryJa: "増幅した複数ノイズ水準のエネルギー推定をゼロノイズ極限へ外挿します." },
  { slug: "vqe-readout-mitigation", title: "Readout-mitigated VQE", titleJa: "読み出し誤差緩和VQE", summary: "Calibrated assignment errors are inverted or regularized before Pauli expectations are assembled.", summaryJa: "校正した割当誤差を逆補正または正則化し、Pauli期待値を組み立てます." },
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
    explanationJa: `${concept.summaryJa} 完全な実験では、量子ビットHamiltonian、参照状態、パラメータ化回路、測定グループ、古典最適化器、停止規則、誤差解析を明示する必要があります。そのため本カタログでは、一般的な1つのスニペットを論文実装と装うのではなく、文献に基づくアルゴリズム記録として扱います。同一問題と予算で、エネルギー誤差、分散、回路資源、測定コスト、最適化評価回数、ノイズ耐性を比較してください。`,
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

type OperatorConcept = {
  slug: string;
  title: string;
  titleJa: string;
  form: string;
  role: string;
  roleJa: string;
};

const OPERATOR_CONCEPTS: OperatorConcept[] = [
  { slug: "operator-pauli-string", title: "Pauli-string observable", titleJa: "Pauli文字列観測量", form: "P = P₀ ⊗ ··· ⊗ Pₙ₋₁", role: "Basic measured term in a qubit Hamiltonian.", roleJa: "量子ビットHamiltonianを構成する基本測定項です。" },
  { slug: "operator-weighted-pauli-sum", title: "Weighted Pauli-sum Hamiltonian", titleJa: "重み付きPauli和Hamiltonian", form: "H = Σⱼ cⱼPⱼ", role: "Canonical qubit-space objective used by VQE.", roleJa: "VQEで使う標準的な量子ビット空間目的演算子です。" },
  { slug: "operator-electronic-structure", title: "Electronic-structure Hamiltonian", titleJa: "電子構造Hamiltonian", form: "H = Σ hₚq a†ₚa_q + 1/2 Σ hₚqrs a†ₚa†_q a_r a_s", role: "Second-quantized molecular energy operator.", roleJa: "分子エネルギーの第二量子化演算子です。" },
  { slug: "operator-one-body-fermion", title: "One-body fermionic operator", titleJa: "一体フェルミオン演算子", form: "O₁ = Σ hₚq a†ₚa_q", role: "Kinetic, external-potential, or orbital-rotation term.", roleJa: "運動、外部ポテンシャル、軌道回転の項です。" },
  { slug: "operator-two-body-fermion", title: "Two-body fermionic operator", titleJa: "二体フェルミオン演算子", form: "O₂ = 1/2 Σ hₚqrs a†ₚa†_q a_r a_s", role: "Electron-electron interaction term.", roleJa: "電子間相互作用項です。" },
  { slug: "operator-creation", title: "Fermionic creation operator", titleJa: "フェルミオン生成演算子", form: "a†ₚ", role: "Adds a fermion in spin orbital p subject to antisymmetry.", roleJa: "反対称性を満たしつつスピン軌道pへフェルミオンを追加します。" },
  { slug: "operator-annihilation", title: "Fermionic annihilation operator", titleJa: "フェルミオン消滅演算子", form: "aₚ", role: "Removes a fermion from spin orbital p.", roleJa: "スピン軌道pからフェルミオンを除去します。" },
  { slug: "operator-number", title: "Orbital number operator", titleJa: "軌道数演算子", form: "nₚ = a†ₚaₚ", role: "Measures occupation of one spin orbital.", roleJa: "1つのスピン軌道の占有数を測定します。" },
  { slug: "operator-total-particle-number", title: "Total particle-number operator", titleJa: "全粒子数演算子", form: "N = Σₚ a†ₚaₚ", role: "Defines fixed-number sectors and symmetry checks.", roleJa: "固定粒子数セクターと対称性確認を定義します。" },
  { slug: "operator-fermionic-hopping", title: "Fermionic hopping operator", titleJa: "フェルミオン・ホッピング演算子", form: "Tₚq = a†ₚa_q + a†_q aₚ", role: "Moves amplitude between orbitals or lattice sites.", roleJa: "軌道または格子サイト間で振幅を移します。" },
  { slug: "operator-pairing", title: "Fermionic pairing operator", titleJa: "フェルミオン対形成演算子", form: "Δₚq = a†ₚa†_q + a_q aₚ", role: "Creates and annihilates correlated fermion pairs.", roleJa: "相関したフェルミオン対を生成・消滅します。" },
  { slug: "operator-coulomb", title: "Coulomb interaction operator", titleJa: "Coulomb相互作用演算子", form: "V = 1/2 Σ hₚqrs a†ₚa†_q a_r a_s", role: "Represents two-electron repulsion in an orbital basis.", roleJa: "軌道基底で二電子反発を表します。" },
  { slug: "operator-fermi-hubbard", title: "Fermi–Hubbard Hamiltonian", titleJa: "Fermi–Hubbard Hamiltonian", form: "H = -tΣ⟨ij⟩σ(c†ᵢσcⱼσ+h.c.) + UΣᵢnᵢ↑nᵢ↓", role: "Correlated lattice-fermion benchmark Hamiltonian.", roleJa: "相関格子フェルミオンの標準ベンチマークHamiltonianです。" },
  { slug: "operator-bose-hubbard", title: "Bose–Hubbard Hamiltonian", titleJa: "Bose–Hubbard Hamiltonian", form: "H = -tΣ⟨ij⟩(b†ᵢbⱼ+h.c.) + U/2Σᵢnᵢ(nᵢ-1)", role: "Interacting lattice-boson model.", roleJa: "相互作用する格子ボソン模型です。" },
  { slug: "operator-ising-cost", title: "Ising cost Hamiltonian", titleJa: "IsingコストHamiltonian", form: "H_C = Σᵢ hᵢZᵢ + ΣᵢⱼJᵢⱼZᵢZⱼ", role: "Diagonal optimization and spin-model objective.", roleJa: "対角な最適化・スピン模型目的演算子です。" },
  { slug: "operator-transverse-field-ising", title: "Transverse-field Ising Hamiltonian", titleJa: "横磁場Ising Hamiltonian", form: "H = -JΣZᵢZᵢ₊₁ - hΣXᵢ", role: "Non-commuting spin-chain ground-state benchmark.", roleJa: "非可換スピン鎖の基底状態ベンチマークです。" },
  { slug: "operator-xy-model", title: "XY spin Hamiltonian", titleJa: "XYスピンHamiltonian", form: "H = ΣJₓXᵢXⱼ + JᵧYᵢYⱼ", role: "Excitation-preserving spin-exchange model.", roleJa: "励起数を保存するスピン交換模型です。" },
  { slug: "operator-heisenberg", title: "Heisenberg Hamiltonian", titleJa: "Heisenberg Hamiltonian", form: "H = ΣJ(XᵢXⱼ + YᵢYⱼ + ZᵢZⱼ)", role: "Isotropic interacting-spin model.", roleJa: "等方的な相互作用スピン模型です。" },
  { slug: "operator-xyz-model", title: "XYZ spin Hamiltonian", titleJa: "XYZスピンHamiltonian", form: "H = Σ(JₓXX + JᵧYY + J_zZZ)", role: "Anisotropic extension of the Heisenberg model.", roleJa: "Heisenberg模型の異方的拡張です。" },
  { slug: "operator-kitaev-chain", title: "Kitaev-chain Hamiltonian", titleJa: "Kitaev鎖Hamiltonian", form: "H = -μΣnᵢ - tΣ(c†ᵢcᵢ₊₁+h.c.) + ΔΣ(cᵢcᵢ₊₁+h.c.)", role: "Topological superconducting-chain model.", roleJa: "トポロジカル超伝導鎖模型です。" },
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
  { slug: "operator-jordan-wigner-number", title: "Jordan–Wigner number mapping", titleJa: "Jordan–Wigner数演算子写像", form: "nₚ ↦ (I-Zₚ)/2", role: "Local qubit representation of orbital occupation.", roleJa: "軌道占有数の局所量子ビット表現です。" },
  { slug: "operator-jordan-wigner-hopping", title: "Jordan–Wigner hopping mapping", titleJa: "Jordan–Wignerホッピング写像", form: "a†ₚa_q+h.c. ↦ Pauli strings with a Z parity chain", role: "Qubit representation of fermion transport.", roleJa: "フェルミオン移動の量子ビット表現です。" },
  { slug: "operator-parity-mapping", title: "Parity fermion-to-qubit mapping", titleJa: "パリティ・フェルミオン量子ビット写像", form: "occupation ↦ cumulative parity bits", role: "Alternative encoding that can expose removable symmetries.", roleJa: "除去可能な対称性を示しやすい代替符号化です。" },
  { slug: "operator-bravyi-kitaev-mapping", title: "Bravyi–Kitaev mapping", titleJa: "Bravyi–Kitaev写像", form: "occupation and parity stored in logarithmic update sets", role: "Balances locality of parity and occupation updates.", roleJa: "パリティと占有更新の局所性を両立します。" },
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
  { slug: "operator-commuting-group", title: "Commuting observable group", titleJa: "可換観測量グループ", form: "G_k={P_j : [P_i,P_j]=0}", role: "Measurement partition for shared basis estimation.", roleJa: "共有基底推定のための測定分割です。" },
  { slug: "operator-one-rdm", title: "One-particle reduced density matrix", titleJa: "一粒子縮約密度行列", form: "γₚq = ⟨a†ₚa_q⟩", role: "Compact one-body state descriptor and orbital gradient input.", roleJa: "一体状態のコンパクトな記述と軌道勾配入力です。" },
  { slug: "operator-two-rdm", title: "Two-particle reduced density matrix", titleJa: "二粒子縮約密度行列", form: "Γₚqrs = ⟨a†ₚa†_q a_s a_r⟩", role: "Two-body correlation descriptor used in energy and response.", roleJa: "エネルギーと応答に使う二体相関記述です。" },
];

const OPENFERMION_SOURCE = {
  title: "OpenFermion: The Electronic Structure Package for Quantum Computers",
  authors: "J. R. McClean et al.",
  year: "2020",
  url: "https://arxiv.org/abs/1710.07629",
};

function operatorEntry(concept: OperatorConcept): PublicRepositoryEntry {
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
    verification: "Definition and role checked against quantum-simulation literature; no circuit or coefficient data set is implied.",
    verificationMethods: ["research_paper"],
    method: "Mathematical-definition and literature curation",
    result: "Pass · representative form, VQE role, and non-circuit conversion boundary are explicit.",
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
    tags: ["VQE operator", "Hamiltonian", concept.title.toLowerCase()],
    resources: [
      { label: "Representative form", value: concept.form },
      { label: "Record type", value: "Operator definition" },
    ],
    metadata: [
      { label: "Circuit", value: "Not supplied" },
      { label: "Instance data", value: "Required for execution" },
    ],
    sourceTitle: OPENFERMION_SOURCE.title,
    sourceUrl: OPENFERMION_SOURCE.url,
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
    literature: [{
      ...OPENFERMION_SOURCE,
      relevance: "Provides open-source representations and transformations for fermionic and qubit operators used in quantum simulation.",
      relevanceJa: "量子シミュレーションで使うフェルミオン・量子ビット演算子の表現と変換を提供します。",
    }],
  });
}

export const LITERATURE_EXPANSION_ENTRIES: PublicRepositoryEntry[] = [
  ...CIRCUIT_FAMILIES.flatMap((family) => WIDTHS.map((width) => circuitEntry(family, width))),
  ...VQE_METHODS.map(vqeEntry),
  ...OPERATOR_CONCEPTS.map(operatorEntry),
];
