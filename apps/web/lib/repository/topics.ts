// The closed topic vocabulary for /repository, and the rules that assign it (R2).
//
// ## Why a closed vocabulary at all
//
// As of 2026-07, the corpus carried 307 distinct free-text `tags` across 283 entries, and **217
// of them — 71% — were used by exactly one entry.** A label one record wears is
// a keyword, not a facet: nothing can be filtered by it and nothing is grouped
// by it. Worse, the set had eight case-splits, and two of them hid real records
// from a reader who filtered on the obvious spelling: `Clifford` (8 entries) and
// `clifford` (7), `Hamiltonian simulation` (8) and `hamiltonian simulation` (4).
//
// So the free tags stay as displayed keywords — they are often the most precise
// thing on a card — and they stop being the mechanism anyone filters with.
//
// ## Three facets, and only one of them is allowed to be sparse
//
// - `role` — what kind of object this record IS. Exhaustive: every entry has
//   exactly one, and an entry that resolves to none fails the build.
// - `method` — the technique. Near-exhaustive and the facet that actually
//   groups the corpus.
// - `domain` — the problem area. **Deliberately sparse, and this is the honest
//   part of R2.** This corpus is overwhelmingly primitives and benchmark
//   circuits: a width-scaled RY-CZ ansatz is not "for chemistry", it is a
//   circuit that chemistry workflows happen to use. Assigning every entry a
//   domain would answer "what do you have for portfolio optimisation" with a
//   p=1 MaxCut layer on a cycle graph and let the reader believe the corpus has
//   portfolio content. A filter that claims coverage the data does not have is
//   worse than an absent filter, because the visitor cannot see it is lying.
//   Entries with no defensible domain carry none, and the browse control says
//   how many that is. **As of 2026-07, 53 of the then-283 carried one — 19%.**
//
// ### The line a benchmark has to cross to earn a domain
//
// Decided against the corpus rather than in the abstract, because the cases are
// genuinely close:
//
// - **The record names a problem the domain studies → domain.** The TFIM VQE
//   benchmarks name the transverse-field Ising model; the QAOA ring benchmarks
//   name MaxCut on a cycle graph. A visitor filtering `materials` or
//   `optimization` gets a real, if small, instance of that problem.
// - **The record names a technique borrowed from the domain → no domain.** The
//   occupation-seeded VQE benchmarks describe "a Hartree–Fock-like
//   computational-basis seed", which is chemistry vocabulary attached to an
//   initialisation pattern. There is no molecule in them. Eight synthetic
//   circuits answering a `chemistry` filter would be precisely the false
//   coverage this facet exists to avoid.
//
// The consequence a reader must be able to see is that a domain does not imply
// an application, so the browse control and the entry page always render the
// `role` chip beside the domain: "10 for optimization" is eight benchmark
// circuits, one algorithm reference and one adiabatic pattern, and it says so.
//
// ## Assigned by rule, not by hand
//
// Every assignment comes from `TOPIC_RULES` below, matched against evidence the
// entry already carries. Three reasons, in order of how much they matter:
//
// 1. **It is re-runnable.** The owner has said the corpus population may be
//    revamped wholesale. The hand-written labels would be discarded with it; a
//    rule table classifies whatever the corpus becomes.
// 2. **It is reviewable.** A reader can see *why* an entry is tagged
//    `chemistry` — some rule said so, and the rule is four lines long.
// 3. **It fails loudly.** A family with no rule produces an entry with no role,
//    and `scripts/check-repository-data.mjs` fails. A hand-labelled corpus is
//    silent about the record nobody got to.
//
// Same shape as `deriveVerificationMethods` in ../public-repository.ts, which
// has classified the verification tier this way since session 60.

// The only import in this file, and it is one predicate. `families.ts` imports
// nothing at all, so this cannot become a cycle; and the alternative — a second
// copy of the `-Nq` pattern here — is the drift this directory has already paid
// for twice (see `PUBLIC_REPOSITORY_CATEGORY_IDS`).
// The `.ts` is load-bearing: `node --test` resolves specifiers literally, and an
// extensionless one here takes every test that imports this module down with a
// module-not-found — which is how the extension got left off once already.
import { parseWidthSlug } from "./families.ts";

export type TopicFacet = "role" | "method" | "domain";

export interface Topic {
  id: string;
  facet: TopicFacet;
  label: string;
  labelJa: string;
  /** What belongs here — and, where a reader would guess wrong, what does not. */
  definition: string;
  definitionJa: string;
}

/**
 * The vocabulary. Adding a member is a deliberate act; there is no path by which
 * a new string arrives from the data.
 */
export const PUBLIC_REPOSITORY_TOPICS = [
  // --- role: what kind of object this record is -----------------------------
  {
    id: "gate-primitive",
    facet: "role",
    label: "Gate",
    labelJa: "ゲート",
    definition: "A single named gate, with its matrix, its identities, and where hardware charges for it.",
    definitionJa: "単一の名前付きゲート。行列、恒等式、およびハードウェア上の代価を記載します。",
  },
  {
    id: "state",
    facet: "role",
    label: "State",
    labelJa: "状態",
    definition: "A named quantum state and a circuit that prepares it.",
    definitionJa: "名前の付いた量子状態と、それを準備する回路です。",
  },
  {
    id: "operator",
    facet: "role",
    label: "Operator",
    labelJa: "演算子",
    definition: "A Hamiltonian, observable, or measurement operator — something to measure, not something to run.",
    definitionJa: "ハミルトニアン・観測量・測定演算子。実行するものではなく、測定する対象です。",
  },
  {
    id: "benchmark-circuit",
    facet: "role",
    label: "Benchmark circuit",
    labelJa: "ベンチマーク回路",
    definition:
      "A fixed, width-scaled circuit published to be measured against. It is a yardstick, not a solution to a problem.",
    definitionJa:
      "測定の基準として公開された、幅をスケールさせた固定回路です。問題の解ではなく物差しです。",
  },
  {
    id: "algorithm-reference",
    facet: "role",
    label: "Algorithm",
    labelJa: "アルゴリズム",
    definition: "An algorithm or primitive described at reference depth, with its inputs, costs and caveats.",
    definitionJa: "入力・コスト・注意点を含め、リファレンスとして記述されたアルゴリズムまたはプリミティブです。",
  },

  // --- method: the technique ------------------------------------------------
  {
    id: "variational",
    facet: "method",
    label: "Variational",
    labelJa: "変分",
    definition: "A parameterised circuit whose parameters a classical optimiser moves.",
    definitionJa: "古典最適化器がパラメータを更新する、パラメータ化回路です。",
  },
  {
    id: "qaoa",
    facet: "method",
    label: "QAOA",
    labelJa: "QAOA",
    definition: "Alternating cost and mixer layers over a combinatorial objective.",
    definitionJa: "組合せ目的関数に対し、コスト層とミキサー層を交互に適用します。",
  },
  {
    id: "trotterization",
    facet: "method",
    label: "Product formula",
    labelJa: "積公式",
    definition: "Time evolution approximated by alternating the exponentials of non-commuting terms.",
    definitionJa: "非可換項の指数関数を交互に適用して時間発展を近似します。",
  },
  {
    id: "phase-estimation",
    facet: "method",
    label: "Phase estimation",
    labelJa: "位相推定",
    definition: "Reading an eigenphase into a register, including the Fourier transform behind it.",
    definitionJa: "固有位相をレジスタに読み出す手法。その基礎となるフーリエ変換を含みます。",
  },
  {
    id: "amplitude-amplification",
    facet: "method",
    label: "Amplitude amplification",
    labelJa: "振幅増幅",
    definition: "Boosting the amplitude of marked states by reflection, Grover and its generalisations.",
    definitionJa: "反射によりマークされた状態の振幅を増幅します。Groverとその一般化を含みます。",
  },
  {
    id: "block-encoding",
    facet: "method",
    label: "Block encoding",
    labelJa: "ブロック符号化",
    definition: "Embedding a non-unitary matrix in a larger unitary — LCU, QSVT, QSP.",
    definitionJa: "非ユニタリ行列をより大きなユニタリに埋め込みます。LCU・QSVT・QSPなど。",
  },
  {
    id: "oracle-query",
    facet: "method",
    label: "Oracle query",
    labelJa: "オラクル問合せ",
    definition: "Algorithms whose cost is counted in calls to a black-box function.",
    definitionJa: "ブラックボックス関数への呼び出し回数でコストを数えるアルゴリズムです。",
  },
  {
    id: "quantum-walk",
    facet: "method",
    label: "Quantum walk",
    labelJa: "量子ウォーク",
    definition: "Coin-and-shift evolution on a graph.",
    definitionJa: "グラフ上のコイン演算とシフト演算による発展です。",
  },
  {
    id: "stabilizer",
    facet: "method",
    label: "Stabilizer",
    labelJa: "スタビライザー",
    definition:
      "Clifford circuits, graph and cluster states, and syndrome measurement — the classically simulable corner.",
    definitionJa:
      "Clifford回路、グラフ状態・クラスター状態、シンドローム測定。古典的にシミュレート可能な領域です。",
  },
  {
    id: "measurement-based",
    facet: "method",
    label: "Measurement-based",
    labelJa: "測定型",
    definition: "Computation driven by measuring a prepared resource state.",
    definitionJa: "準備した資源状態を測定することで計算を進めます。",
  },
  {
    id: "state-preparation",
    facet: "method",
    label: "State preparation",
    labelJa: "状態準備",
    definition: "Getting a named state into a register.",
    definitionJa: "指定された状態をレジスタに用意します。",
  },
  {
    id: "adiabatic",
    facet: "method",
    label: "Adiabatic",
    labelJa: "断熱",
    definition: "Slowly deforming an easy ground state into a hard one.",
    definitionJa: "容易な基底状態を、目的の基底状態へゆっくり変形させます。",
  },
  {
    id: "quantum-kernel",
    facet: "method",
    label: "Feature map",
    labelJa: "特徴マップ",
    definition: "Encoding classical data into a state so that overlaps act as a kernel.",
    definitionJa: "古典データを状態に符号化し、その重なりをカーネルとして用います。",
  },
  {
    id: "fermionic-encoding",
    facet: "method",
    label: "Fermionic encoding",
    labelJa: "フェルミオン符号化",
    definition: "Mapping fermionic modes onto qubits — Jordan–Wigner and its relatives.",
    definitionJa: "フェルミオンモードを量子ビットへ写像します。Jordan-Wigner変換など。",
  },
  {
    id: "routing",
    facet: "method",
    label: "Routing",
    labelJa: "ルーティング",
    definition: "Moving states across a connectivity graph; what a compiler spends qubits on.",
    definitionJa: "結合グラフ上で状態を移動させる操作。コンパイラが量子ビットを費やす対象です。",
  },
  {
    id: "error-correction",
    facet: "method",
    label: "Error correction",
    labelJa: "誤り訂正",
    definition: "Codes, syndromes, decoders, and the magic states fault tolerance consumes.",
    definitionJa: "符号・シンドローム・デコーダ、および誤り耐性が消費するマジックステートです。",
  },

  // --- domain: the problem area, and deliberately sparse --------------------
  {
    id: "chemistry",
    facet: "domain",
    label: "Chemistry",
    labelJa: "化学",
    definition: "Molecular electronic structure: ground-state energies of molecules.",
    definitionJa: "分子の電子状態。分子の基底状態エネルギーを対象とします。",
  },
  {
    id: "materials",
    facet: "domain",
    label: "Materials & magnetism",
    labelJa: "物性・磁性",
    definition: "Spin models, lattice Hamiltonians, and correlated electrons.",
    definitionJa: "スピン模型、格子ハミルトニアン、強相関電子系です。",
  },
  {
    id: "optimization",
    facet: "domain",
    label: "Optimization",
    labelJa: "最適化",
    definition: "Combinatorial objectives — cuts, assignments, schedules.",
    definitionJa: "組合せ最適化の目的関数。カット・割当・スケジューリングなど。",
  },
  {
    id: "machine-learning",
    facet: "domain",
    label: "Machine learning",
    labelJa: "機械学習",
    definition: "Classification and regression over encoded classical data.",
    definitionJa: "符号化された古典データに対する分類・回帰です。",
  },
  {
    id: "finance",
    facet: "domain",
    label: "Finance",
    labelJa: "金融",
    definition: "Pricing, risk, and Monte-Carlo estimation.",
    definitionJa: "プライシング、リスク、モンテカルロ推定です。",
  },
  {
    id: "linear-algebra",
    facet: "domain",
    label: "Linear systems",
    labelJa: "線形システム",
    definition: "Solving Ax = b and applying functions of a matrix.",
    definitionJa: "Ax = b を解くこと、および行列関数の適用です。",
  },
  {
    id: "communication",
    facet: "domain",
    label: "Communication",
    labelJa: "通信",
    definition: "Moving information between parties using entanglement.",
    definitionJa: "エンタングルメントを用いて当事者間で情報を移動させます。",
  },
  {
    id: "metrology",
    facet: "domain",
    label: "Metrology",
    labelJa: "計測",
    definition: "Sensing and interferometry beyond the shot-noise limit.",
    definitionJa: "ショットノイズ限界を超えるセンシングと干渉計測です。",
  },
  {
    id: "cryptography",
    facet: "domain",
    label: "Cryptography",
    labelJa: "暗号",
    definition: "Period finding and factoring — what breaks, and under which assumptions.",
    definitionJa: "位数発見と素因数分解。何がどの仮定のもとで破られるかを扱います。",
  },
] as const satisfies readonly Topic[];

export type TopicId = (typeof PUBLIC_REPOSITORY_TOPICS)[number]["id"];

/** Vocabulary by id. Built from the array, never restated. */
export const TOPICS_BY_ID: ReadonlyMap<TopicId, Topic> = new Map(
  PUBLIC_REPOSITORY_TOPICS.map((topic) => [topic.id, topic]),
);

export function topicsInFacet(facet: TopicFacet): readonly Topic[] {
  return PUBLIC_REPOSITORY_TOPICS.filter((topic) => topic.facet === facet);
}

export function isTopicId(value: unknown): value is TopicId {
  return typeof value === "string" && TOPICS_BY_ID.has(value as TopicId);
}

/**
 * The evidence a rule may read.
 *
 * Deliberately narrow. `description` and `title` are prose a content pass
 * rewrites without thinking about classification, so a rule that keys off a
 * phrase in them silently reclassifies records when the copy is edited. Family,
 * category and the free tags are the fields that were written *as* labels.
 */
export interface TopicEvidence {
  slug: string;
  category: string;
  algorithmFamily: string;
  tags: readonly string[];
}

interface TopicRule {
  /** Exact `algorithmFamily`. */
  family?: string;
  /** Any of these, case-insensitively, in `tags`. */
  tagAny?: readonly string[];
  /** Any of these as an exact slug. */
  slugAny?: readonly string[];
  topics: readonly TopicId[];
}

/**
 * Family → role, and the baseline method for that family.
 *
 * Exhaustive over the 57 families the corpus carries. A family with no entry
 * here yields a record with no role, which `check-repository-data.mjs` refuses —
 * so adding entries in a new family is a decision somebody has to make, rather
 * than a silent gap that looks like a working catalogue.
 */
const FAMILY_RULES: readonly TopicRule[] = [
  // Operators.
  { family: "VQE Hamiltonians and observables", topics: ["operator"] },
  { family: "Spin Hamiltonians", topics: ["operator", "materials"] },
  { family: "Fermionic Hamiltonians", topics: ["operator", "fermionic-encoding"] },
  { family: "Pauli operator", topics: ["operator"] },
  { family: "Quantum error correction", topics: ["operator", "error-correction", "stabilizer"] },
  { family: "Stabilizer / error-syndrome measurement", topics: ["operator", "stabilizer", "error-correction"] },

  // Gates.
  { family: "Single-qubit gate", topics: ["gate-primitive"] },
  { family: "Controlled gate", topics: ["gate-primitive"] },
  { family: "Two-qubit gate", topics: ["gate-primitive"] },
  { family: "Multi-controlled gate", topics: ["gate-primitive"] },
  { family: "Multi-qubit gate", topics: ["gate-primitive"] },
  { family: "Rotation gate", topics: ["gate-primitive"] },
  { family: "Phase gate", topics: ["gate-primitive"] },
  { family: "Universal single-qubit gate", topics: ["gate-primitive"] },

  // States.
  { family: "Bell / entanglement", topics: ["state", "state-preparation"] },
  { family: "GHZ / entanglement", topics: ["state", "state-preparation"] },
  { family: "Multipartite entanglement", topics: ["state", "state-preparation"] },
  { family: "Symmetric superposition states", topics: ["state", "state-preparation"] },
  { family: "Superposition state", topics: ["state", "state-preparation"] },
  { family: "Thermal state preparation", topics: ["state", "state-preparation"] },
  { family: "Mixed-state entanglement", topics: ["state"] },
  { family: "Stabilizer states", topics: ["state", "stabilizer", "state-preparation"] },
  { family: "Measurement-based computing", topics: ["state", "stabilizer", "measurement-based"] },
  { family: "Magic state distillation", topics: ["state", "error-correction", "state-preparation"] },
  { family: "Quantum metrology states", topics: ["state", "state-preparation", "metrology"] },

  // Benchmark circuits — a yardstick, not an application. No domain by design.
  { family: "VQE ansatz benchmark", topics: ["benchmark-circuit", "variational"] },
  { family: "Entanglement benchmark", topics: ["benchmark-circuit", "state-preparation"] },
  { family: "Graph-state benchmark", topics: ["benchmark-circuit", "stabilizer", "state-preparation"] },
  { family: "Oracle algorithm benchmark", topics: ["benchmark-circuit", "oracle-query"] },
  { family: "Hamiltonian simulation", topics: ["benchmark-circuit", "trotterization", "materials"] },
  { family: "QAOA / MaxCut", topics: ["benchmark-circuit", "qaoa", "optimization"] },
  { family: "Routing benchmark", topics: ["benchmark-circuit", "routing"] },
  { family: "Clifford circuit benchmark", topics: ["benchmark-circuit", "stabilizer"] },

  // Algorithm references.
  { family: "Variational quantum eigensolver", topics: ["algorithm-reference", "variational"] },
  { family: "Variational quantum algorithm", topics: ["algorithm-reference", "variational", "chemistry"] },
  { family: "Quantum machine learning", topics: ["algorithm-reference", "quantum-kernel", "machine-learning"] },
  { family: "Entanglement and communication", topics: ["algorithm-reference", "communication"] },
  { family: "Quantum query algorithm", topics: ["algorithm-reference", "oracle-query"] },
  { family: "Eigenvalue estimation", topics: ["algorithm-reference", "phase-estimation"] },
  { family: "Kitaev iterative phase estimation", topics: ["algorithm-reference", "phase-estimation"] },
  { family: "Quantum Fourier transform", topics: ["algorithm-reference", "phase-estimation"] },
  { family: "Fourier transform primitive", topics: ["algorithm-reference", "phase-estimation"] },
  { family: "Quantum counting (QPE + Grover)", topics: ["algorithm-reference", "phase-estimation", "amplitude-amplification"] },
  { family: "Generalized Grover / amplitude amplification", topics: ["algorithm-reference", "amplitude-amplification"] },
  { family: "Amplitude amplification", topics: ["algorithm-reference", "amplitude-amplification", "oracle-query"] },
  { family: "Amplitude estimation", topics: ["algorithm-reference", "amplitude-amplification", "phase-estimation", "finance"] },
  { family: "Hidden-period / factoring", topics: ["algorithm-reference", "phase-estimation", "cryptography"] },
  { family: "Quantum linear algebra", topics: ["algorithm-reference", "block-encoding", "linear-algebra"] },
  { family: "Block encoding · polynomial matrix transformation", topics: ["algorithm-reference", "block-encoding", "linear-algebra"] },
  { family: "Block encoding · LCU", topics: ["algorithm-reference", "block-encoding"] },
  { family: "Single-qubit polynomial transformation", topics: ["algorithm-reference", "block-encoding"] },
  { family: "Product-formula Hamiltonian simulation", topics: ["algorithm-reference", "trotterization"] },
  { family: "Hamiltonian simulation · product formula", topics: ["algorithm-reference", "trotterization", "materials"] },
  { family: "Ground-state preparation · variational imaginary time", topics: ["algorithm-reference", "variational", "chemistry"] },
  { family: "Optimization · time-dependent Hamiltonian", topics: ["algorithm-reference", "adiabatic", "optimization"] },
  { family: "Quantum walk", topics: ["algorithm-reference", "quantum-walk"] },
  { family: "QAOA", topics: ["algorithm-reference", "qaoa", "optimization"] },
  // Zoo-parity intake (entries-zoo-parity.ts). Six families the catalog had no
  // rule for, because it had no record of that shape: the two differential-equation
  // families the map has drawn since W14 with nothing in the repository pointing at
  // them, and four subject areas the Quantum Algorithm Zoo carries that no Leona
  // record covered. Each reuses an existing topic id — new *families*, not new
  // vocabulary, so the facet filters and their tests are untouched.
  { family: "Quantum differential equations · linear", topics: ["algorithm-reference", "linear-algebra"] },
  { family: "Quantum differential equations · nonlinear", topics: ["algorithm-reference", "linear-algebra"] },
  { family: "Topological invariants", topics: ["algorithm-reference", "materials"] },
  { family: "Markov-chain sampling", topics: ["algorithm-reference", "optimization"] },
  { family: "Quantum sampling algorithm", topics: ["algorithm-reference", "state-preparation"] },
  { family: "Optimization · decoded interferometry", topics: ["algorithm-reference", "optimization"] },
  // Classiq-parity intake (entries-classiq-parity.ts). Three more families, same rule as
  // above: new family strings over existing topic ids, so the facet vocabulary and its
  // tests do not move. Benchmarking protocols and image processing are subject areas the
  // Zoo has no section for at all — they are work, not results, which is the whole reason
  // the Classiq half of the parity question needed its own index.
  { family: "Quantum benchmarking protocol", topics: ["algorithm-reference", "stabilizer"] },
  { family: "Quantum image processing", topics: ["algorithm-reference", "machine-learning"] },
  // A fourth, added because the obvious existing family was the wrong one. A literature
  // record about simulating a named physical model — the Fermi-Hubbard chain, the kicked
  // rotator — reads as "Hamiltonian simulation", but that family's rule stamps the record
  // `benchmark-circuit`, which says *this is one of our benchmark circuits* and quietly
  // takes it out of the map-eligible denominator (see ./map-eligibility.ts). The two
  // families that do carry `algorithm-reference` both say "product formula", and neither
  // of these papers' abstracts claims one. So: the role these records actually have, over
  // existing topic ids, asserting no method.
  { family: "Hamiltonian simulation · model systems", topics: ["algorithm-reference", "materials"] },
  { family: "Optimization · Ising encoding", topics: ["algorithm-reference", "optimization"] },
  // Zoo-parity intake, second pass (W22). Two more families over existing topic ids,
  // for the two subject areas that account for most of the Zoo entries this catalog
  // still had no record of. Neither could reuse a family already here without saying
  // something false about the record.
  //
  // `Computational number theory` covers the Zoo's largest gap by far — 11 of the 21
  // uncovered entries sit in "Algebraic and Number Theoretic Algorithms". The obvious
  // existing family, `Hidden-period / factoring`, carries the topic `cryptography`,
  // which is right for Shor and wrong for the zeta function of a curve; the machinery
  // these papers share is period finding and Fourier sampling, so `phase-estimation`
  // is the facet that is actually true of all of them.
  //
  // `PromiseBQP-complete problem` is a family the corpus genuinely lacked a shape for.
  // These records are not "here is a faster way to do X" — they are "this innocuous
  // matrix or combinatorial question is exactly as hard as quantum computation itself",
  // and the algorithm inside them is phase estimation applied to a spectral quantity.
  // Filing them under a method family would state the method as the subject.
  { family: "Computational number theory", topics: ["algorithm-reference", "phase-estimation"] },
  { family: "PromiseBQP-complete problem", topics: ["algorithm-reference", "phase-estimation"] },
];

/**
 * Refinements that vary *within* a family, keyed off labels rather than prose.
 *
 * These may only ADD. A rule that could remove a topic would make the order of
 * this array load-bearing, and the reason an entry carries a tag would stop
 * being readable from any one rule.
 *
 * The 50-entry operator family is why this mechanism exists at all: it holds
 * Pauli-string observables (no domain — a Pauli string is not about anything),
 * molecular electronic-structure Hamiltonians (chemistry), and lattice models
 * (materials), and no single family-level rule is right for all three.
 */
const REFINEMENT_RULES: readonly TopicRule[] = [
  { tagAny: ["electronic-structure hamiltonian", "molecular hamiltonian", "quantum chemistry", "chemistry", "molecular dipole operator", "uccsd vqe ansatz", "k-upccgsd ansatz", "coupled cluster"], topics: ["chemistry"] },
  { tagAny: ["uccsd vqe ansatz", "k-upccgsd ansatz", "generalized excitation vqe"], topics: ["fermionic-encoding"] },
  { tagAny: ["jordan-wigner", "fermionic simulation", "one-body fermionic operator", "two-body fermionic operator", "fermionic creation operator", "fermionic annihilation operator", "number operator"], topics: ["fermionic-encoding"] },
  { tagAny: ["hubbard model", "strongly correlated electrons", "ising model", "spin hamiltonian", "heisenberg model", "xxz chain", "spin system", "TFIM", "transverse field ising"], topics: ["materials"] },
  { tagAny: ["maxcut", "optimization", "annealing", "combinatorial"], topics: ["optimization"] },
  { tagAny: ["machine learning", "classification", "quantum kernel", "feature map", "QML"], topics: ["machine-learning", "quantum-kernel"] },
  { tagAny: ["finance", "monte carlo", "risk"], topics: ["finance"] },
  { tagAny: ["linear systems", "PDE", "condition number"], topics: ["linear-algebra"] },
  { tagAny: ["communication", "networking", "dense coding", "teleportation"], topics: ["communication"] },
  { tagAny: ["metrology", "interferometry", "heisenberg limit"], topics: ["metrology"] },
  { tagAny: ["error correction", "syndrome", "surface code", "fault tolerance", "fault tolerant", "magic state", "decoder"], topics: ["error-correction"] },
  { tagAny: ["stabilizer", "clifford", "graph state", "cluster state"], topics: ["stabilizer"] },
  { tagAny: ["trotter", "product formula", "time evolution", "hamiltonian simulation"], topics: ["trotterization"] },
  { tagAny: ["amplitude amplification", "grover", "counting"], topics: ["amplitude-amplification"] },
  { tagAny: ["phase estimation", "qft", "fourier transform", "eigenvalue"], topics: ["phase-estimation"] },
  { tagAny: ["oracle", "query", "hidden string", "phase kickback"], topics: ["oracle-query"] },
  { tagAny: ["routing", "connectivity", "swap network"], topics: ["routing"] },
  { tagAny: ["state preparation", "ground state"], topics: ["state-preparation"] },
  { tagAny: ["variational", "vqe", "ansatz", "adapt-vqe"], topics: ["variational"] },
  { tagAny: ["measurement-based computing", "one-way"], topics: ["measurement-based"] },
  { tagAny: ["adiabatic"], topics: ["adiabatic"] },
  { tagAny: ["quantum walk"], topics: ["quantum-walk"] },
  { tagAny: ["block encoding", "lcu", "qsvt", "qsp", "quantum signal processing"], topics: ["block-encoding"] },
];

/**
 * Per-slug corrections, for records the rules read correctly and still land
 * somewhere a domain expert would not. Corrections REPLACE the derived set.
 *
 * **Empty, and that is a measurement rather than an omission.** Every published
 * entry is classified by the tables above; none needed a hand
 * correction. `deriveVerificationMethods` needed sixteen, which is the honest
 * comparison — that classifier reads free prose, and this one reads fields that
 * were written as labels.
 *
 * A stale entry here would be invisible, so `scripts/check-repository-data.mjs`
 * fails on any slug listed here that the corpus does not carry. This list held
 * one such entry within an hour of being written.
 */
export const TOPIC_OVERRIDES: Readonly<Record<string, readonly TopicId[]>> = {};

const ROLE_IDS: ReadonlySet<string> = new Set(
  topicsInFacet("role").map((topic) => topic.id),
);

function matches(rule: TopicRule, evidence: TopicEvidence): boolean {
  if (rule.family !== undefined && rule.family !== evidence.algorithmFamily) return false;
  if (rule.slugAny && !rule.slugAny.includes(evidence.slug)) return false;
  if (rule.tagAny) {
    const lower = evidence.tags.map((tag) => tag.toLowerCase());
    const wanted = rule.tagAny.map((tag) => tag.toLowerCase());
    if (!wanted.some((tag) => lower.includes(tag))) return false;
  }
  // A rule with no predicate at all would tag the whole corpus. Never silently.
  return rule.family !== undefined || rule.slugAny !== undefined || rule.tagAny !== undefined;
}

/**
 * Every topic this entry's own labels support, in vocabulary order.
 *
 * Vocabulary order rather than match order so that two entries carrying the same
 * topics render them identically — a chip row whose sequence depends on which
 * rule fired first reads as though the order means something.
 */
export function deriveTopics(evidence: TopicEvidence): TopicId[] {
  const override = TOPIC_OVERRIDES[evidence.slug];
  if (override) return [...override];

  const found = new Set<TopicId>();
  for (const rule of [...FAMILY_RULES, ...REFINEMENT_RULES]) {
    if (!matches(rule, evidence)) continue;
    for (const topic of rule.topics) found.add(topic);
  }
  // A width-family member is a benchmark circuit whatever its family says.
  //
  // `FAMILY_RULES` is exhaustive over families and every rule assigns exactly one
  // role, so the one thing it cannot express is a family whose members do not
  // all share a role — and there is exactly one such family. **"Quantum machine
  // learning" holds nine records: `quantum-kernel-svm`, which is an algorithm
  // reference, and `benchmark-phase-feature-map-{2,3,4,5,6,8,12,16}q`, which are
  // one circuit at eight widths.** All nine were labelled `algorithm-reference`,
  // so the browse chip said "Algorithm" on eight yardsticks, `?topic=` returned
  // them, and the layer surface counted them as records a map node could anchor.
  //
  // The correction is not a per-slug override, because that is eight hand-written
  // labels a repopulation would discard. `parseWidthSlug` is the same predicate
  // `families.ts` folds the browse list with, and it is the definition of the
  // thing: a `-16q` sibling of a `-2q` is published to be measured against.
  // Measured before adding this — every one of the 120 width-suffixed slugs is a
  // family member and no family member lacks the suffix — so this reclassifies
  // exactly the eight and touches nothing else.
  //
  // It REPLACES rather than adds, unlike `REFINEMENT_RULES`, because a role is
  // exactly-one and two roles is the same failure as none.
  if (parseWidthSlug(evidence.slug) !== null) {
    for (const role of ROLE_IDS) found.delete(role as TopicId);
    found.add("benchmark-circuit");
  }
  return PUBLIC_REPOSITORY_TOPICS.filter((topic) => found.has(topic.id)).map((topic) => topic.id);
}

/** The one topic in the `role` facet, or null when no rule claimed this entry. */
export function roleOf(topics: readonly TopicId[]): TopicId | null {
  return topics.find((topic) => ROLE_IDS.has(topic)) ?? null;
}

export function topicsInFacetOf(topics: readonly TopicId[], facet: TopicFacet): TopicId[] {
  return topics.filter((topic) => TOPICS_BY_ID.get(topic)?.facet === facet);
}
