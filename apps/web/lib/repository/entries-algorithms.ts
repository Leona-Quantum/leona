import type { PublicRepositoryEntry } from "./types";
import { makeReferenceEntry } from "./factory";

// Populated by the catalog-expansion batches (2026-07-16 Owner Inbox: grow the
// public repository to 60+ records). Entries use makeReferenceEntry from
// ./factory; scripts/check-repository-data.mjs validates every record.
export const ALGORITHM_ENTRIES: PublicRepositoryEntry[] = [
  makeReferenceEntry({
    slug: "quantum-fourier-transform",
    title: "Quantum Fourier Transform",
    titleJa: "量子フーリエ変換",
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Fourier transform primitive",
    framework: "Qiskit",
    status: "verified_caveats",
    verification: "Construction checked against the QFT definition · 3-qubit instance verified by hand",
    verificationMethods: ["construction", "small_instance", "research_paper", "textbook_citation"],
    method:
      "The circuit follows the standard Hadamard + controlled-phase + qubit-reversal decomposition. It is checked against the closed-form QFT definition for a 3-qubit register, including the |0...0> edge case where the transform must reduce to independent Hadamards.",
    result:
      "Pass · for input |0> the circuit produces the uniform superposition over all 8 basis states exactly as required, and the general amplitude formula matches the analytic QFT definition.",
    caveat:
      "This record verifies the exact-QFT construction and a small hand-worked case; it does not benchmark the approximate QFT variant or run on hardware.",
    exportStatus: "Native Qiskit · Cirq variant included",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description: "The unitary that maps computational basis states to Fourier-basis phase patterns, and the phase-estimation primitive behind Shor's and HHL's speedups.",
    descriptionJa: "計算基底状態をフーリエ基底の位相パターンへ写すユニタリ変換で、ShorやHHLの高速化を支える位相推定の基本要素です。",
    introduction:
      "The QFT is the quantum analogue of the discrete Fourier transform, acting on amplitudes rather than a classical vector. It underlies period finding, phase estimation, and several Hamiltonian-simulation techniques.",
    introductionJa:
      "QFTは古典ベクトルではなく振幅に作用する離散フーリエ変換の量子版で、周期発見・位相推定・いくつかのハミルトニアンシミュレーション手法の基盤となります。",
    explanation:
      "QFT on n qubits maps |j> to a uniform-magnitude superposition whose phases encode j via e^{2 pi i jk/N}. It is built from Hadamards and controlled phase rotations in O(n^2) gates, or O(n log n) with the Coppersmith approximation.",
    explanationJa:
      "n量子ビットのQFTは|j>を、位相がe^{2 pi i jk/N}でjを符号化する一様振幅の重ね合わせへ写します。アダマールと制御位相回転でO(n^2)ゲート、Coppersmithの近似版ではO(n log n)で構成されます。",
    explanationMd: String.raw`The Quantum Fourier Transform on $n$ qubits ($N=2^n$ basis states) is the unitary

$$
\mathrm{QFT}_N|j\rangle = \frac{1}{\sqrt{N}}\sum_{k=0}^{N-1} e^{2\pi i jk/N}|k\rangle .
$$

Unlike the classical discrete Fourier transform, which returns a full length-$N$ output vector, the QFT acts on the amplitudes of an $n$-qubit register and its output can only be sampled through measurement — it is a resource for building algorithms, not a way to read out a classical spectrum for free.

**Circuit structure.** The standard decomposition applies, for each qubit $j$ (most significant first), a Hadamard followed by controlled phase gates $R_k=\mathrm{diag}(1,e^{2\pi i/2^k})$ controlled by the less significant qubits, and finishes with a reversal of qubit order (implemented as $\lfloor n/2\rfloor$ SWAPs, or by relabeling wires in software). This gives exactly $n$ Hadamards and $n(n-1)/2$ controlled-phase gates: $O(n^2)$ gates total. Coppersmith's approximate QFT drops controlled rotations with angle smaller than $2\pi/2^m$ for a cutoff $m$, reducing the gate count to $O(n\log n)$ while introducing only exponentially small error for many downstream uses (period finding, phase estimation).

**Small worked instance.** Take $n=3$ ($N=8$) and the input $|j=0\rangle = |000\rangle$. Every phase factor $e^{2\pi i \cdot 0 \cdot k/8}=1$, so

$$
\mathrm{QFT}_8|000\rangle = \frac{1}{\sqrt8}\sum_{k=0}^{7}|k\rangle,
$$

exactly the state produced by applying $H$ to each of the three qubits independently — a directly checkable identity, since no controlled phase can fire when every control qubit is $|0\rangle$. For $j=1$, $\mathrm{QFT}_8|001\rangle=\frac{1}{\sqrt8}\sum_k e^{2\pi i k/8}|k\rangle$, i.e. the amplitudes trace out the eight 8th roots of unity in order — exactly the classical DFT of a Kronecker delta at index 1.

**Where it is used.** The QFT (or its inverse) is the last step of quantum phase estimation, the core of Shor's period-finding routine, and a building block for quantum arithmetic and some Hamiltonian-simulation schemes.`,
    explanationMdJa: String.raw`$n$量子ビット（$N=2^n$個の基底状態）に対する量子フーリエ変換は次のユニタリです。

$$
\mathrm{QFT}_N|j\rangle = \frac{1}{\sqrt{N}}\sum_{k=0}^{N-1} e^{2\pi i jk/N}|k\rangle .
$$

古典の離散フーリエ変換が長さ$N$の出力ベクトルをそのまま返すのに対し、QFTは$n$量子ビットレジスタの振幅に作用し、出力は測定によってサンプリングするしかありません。無料で古典スペクトルを読み出す手段ではなく、アルゴリズムを構成するための資源です。

**回路構造。** 標準的な分解では、各量子ビット$j$（最上位から）にアダマールを適用し、続いて下位ビットを制御とする制御位相ゲート$R_k=\mathrm{diag}(1,e^{2\pi i/2^k})$を適用し、最後に量子ビットの順序を反転します（$\lfloor n/2\rfloor$回のSWAP、あるいはソフトウェア上での配線ラベルの付け替えで実装）。これによりちょうど$n$個のアダマールと$n(n-1)/2$個の制御位相ゲート、合計$O(n^2)$ゲートとなります。Coppersmithの近似QFTはカットオフ$m$より小さい角度$2\pi/2^m$の制御回転を省略し、周期発見や位相推定など多くの用途で指数的に小さい誤差のみでゲート数を$O(n\log n)$に削減します。

**小規模な具体例。** $n=3$（$N=8$）、入力$|j=0\rangle=|000\rangle$とすると、すべての位相因子$e^{2\pi i \cdot 0 \cdot k/8}=1$なので

$$
\mathrm{QFT}_8|000\rangle = \frac{1}{\sqrt8}\sum_{k=0}^{7}|k\rangle
$$

となり、これは3つの量子ビットそれぞれに独立に$H$を適用した状態と厳密に一致します（すべての制御ビットが$|0\rangle$なので制御位相は作動しません）。$j=1$では$\mathrm{QFT}_8|001\rangle=\frac{1}{\sqrt8}\sum_k e^{2\pi i k/8}|k\rangle$となり、振幅は8個の8乗根をその順に並べたもの——インデックス1のクロネッカーのデルタの古典DFTそのものです。

**用途。** QFT（またはその逆）は量子位相推定の最終段階であり、Shorの周期発見の核であり、量子算術やいくつかのハミルトニアンシミュレーション手法の構成要素です。`,
    tags: ["fourier transform", "phase estimation", "qft", "circuit primitive"],
    resources: [
      { label: "Qubits", value: "3 shown (n general)" },
      { label: "Depth", value: "O(n²) gates exact · O(n log n) approximate" },
      { label: "Gate count (n=3)", value: "3 H + 3 CP + 1 SWAP" },
    ],
    metadata: [
      { label: "Formula", value: "QFT|j⟩ = (1/√N) Σ_k e^{2πijk/N}|k⟩" },
      { label: "Exact gate count", value: "O(n²)" },
      { label: "Approximate variant", value: "O(n log n), Coppersmith 2002" },
    ],
    sourceTitle: "An approximate Fourier transform useful in quantum factoring",
    sourceUrl: "https://arxiv.org/abs/quant-ph/0201067",
    wires: ["q[0]", "q[1]", "q[2]"],
    operations: [
      { label: "H×3", qubits: [0, 1, 2], tone: "accent" },
      { label: "Controlled phases", qubits: [0, 1, 2], tone: "warn" },
      { label: "Swap (reversal)", qubits: [0, 2], tone: "ok" },
    ],
    outcomes: [
      { label: "Uniform across 8 outcomes (|0⟩ input)", probability: 0.125 },
      { label: "8th-root-of-unity phase pattern (|1⟩ input)", probability: 0.125 },
    ],
    code: String.raw`from qiskit import QuantumCircuit
import numpy as np

def qft(n):
    qc = QuantumCircuit(n, name="QFT")
    for j in range(n):
        qc.h(j)
        for k in range(j + 1, n):
            qc.cp(np.pi / 2 ** (k - j), k, j)
    for i in range(n // 2):
        qc.swap(i, n - i - 1)
    return qc

qc = QuantumCircuit(3, 3)
qc.append(qft(3), [0, 1, 2])
qc.measure(range(3), range(3))`,
    filename: "quantum_fourier_transform.py",
    language: "python",
    extraVariants: [
      {
        framework: "Cirq",
        status: "native",
        language: "python",
        filename: "quantum_fourier_transform.py",
        code: String.raw`import cirq

def qft_circuit(qubits):
    n = len(qubits)
    circuit = cirq.Circuit()
    for j in range(n):
        circuit.append(cirq.H(qubits[j]))
        for k in range(j + 1, n):
            circuit.append(cirq.CZPowGate(exponent=1 / 2 ** (k - j))(qubits[k], qubits[j]))
    for i in range(n // 2):
        circuit.append(cirq.SWAP(qubits[i], qubits[n - i - 1]))
    return circuit

qubits = cirq.LineQubit.range(3)
circuit = qft_circuit(qubits)`,
      },
    ],
    relatedSlugs: ["shor-period-finding", "quantum-phase-estimation", "qft-resource-screen", "iterative-phase-estimation"],
    literature: [
      {
        title: "An approximate Fourier transform useful in quantum factoring",
        authors: "Don Coppersmith",
        year: "2002",
        url: "https://arxiv.org/abs/quant-ph/0201067",
        relevance: "Introduces the approximate QFT that drops small-angle controlled rotations, giving O(n log n) gates.",
        relevanceJa: "小角度の制御回転を省略してO(n log n)ゲートで済む近似QFTを導入します。",
      },
      {
        title: "Quantum Computation and Quantum Information",
        authors: "Michael A. Nielsen, Isaac L. Chuang",
        year: "2010 (10th anniversary edition)",
        url: "https://doi.org/10.1017/CBO9780511976667",
        relevance: "Standard textbook derivation of the QFT circuit and its role in phase estimation (Ch. 5).",
        relevanceJa: "QFT回路とその位相推定における役割（第5章）についての標準的な教科書解説です。",
      },
    ],
    classicalComparison: {
      baseline: "The classical fast Fourier transform (FFT) computes a full length-N output vector explicitly in O(N log N) arithmetic operations.",
      baselineJa: "古典高速フーリエ変換(FFT)は長さNの出力ベクトル全体をO(N log N)の算術演算で明示的に計算します。",
      quantumClaim: "The QFT transforms the amplitudes of an n = log N qubit register with O(n²) gates, but the output is only accessible through sampling, not as a free classical vector.",
      quantumClaimJa: "QFTはn = log N量子ビットレジスタの振幅をO(n²)ゲートで変換しますが、出力はサンプリングでしか取得できず、無料の古典ベクトルにはなりません。",
      practicalRead: "Compare circuit depth, approximation cutoff, state preparation cost, and the actual downstream measurement objective against the classical FFT cost for the same task.",
      practicalReadJa: "回路深さ、近似打ち切り、状態準備コスト、実際の下流測定目的を、同じタスクでの古典FFTコストと比較してください。",
    },
    industryUseCases: [
      "Subroutine inside Shor's factoring and discrete-log algorithms",
      "Phase estimation for chemistry and eigenvalue problems",
      "Quantum signal processing and spectral filtering",
    ],
    industryUseCasesJa: ["Shorの因数分解・離散対数アルゴリズムのサブルーチン", "化学・固有値問題のための位相推定", "量子信号処理とスペクトルフィルタリング"],
  }),
  makeReferenceEntry({
    slug: "quantum-counting",
    title: "Quantum counting",
    titleJa: "量子カウンティング",
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Quantum counting (QPE + Grover)",
    framework: "Qiskit",
    status: "verified_caveats",
    verification: "Construction checked against QPE-on-Grover-operator · 2-qubit toy count verified by hand",
    verificationMethods: ["construction", "small_instance", "research_paper"],
    method:
      "The circuit combines phase estimation with a Grover iterator whose eigenphase encodes the marked-item fraction M/N. The eigenphase for a hand-chosen toy instance (N=4, M=1) is computed analytically and compared against the circuit structure.",
    result:
      "Pass · for N=4, M=1 the Grover operator's eigenphase works out to θ=π/3, matching the expected sin²(θ/2)=M/N=1/4 relation used by the circuit.",
    caveat:
      "This record verifies the construction and a hand-derived toy eigenphase; it does not include a hardware or simulator run producing measured counting statistics.",
    exportStatus: "Native Qiskit · framework conversions available as review requests",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description: "Estimates how many items in an unstructured search space satisfy an oracle, without checking them one by one.",
    descriptionJa: "オラクルを満たす項目数を、一つずつ確認することなく推定するアルゴリズムです。",
    introduction:
      "Quantum counting combines Grover's amplitude amplification with phase estimation: instead of finding a marked item, it estimates how many marked items exist.",
    introductionJa:
      "量子カウンティングはGroverの振幅増幅と位相推定を組み合わせ、対象項目を見つける代わりに対象項目の個数を推定します。",
    explanation:
      "The Grover iterator has eigenvalues e^{±iθ} with sin²(θ/2)=M/N. Running phase estimation on the iterator recovers θ, and hence an estimate of M, using O(√(N/M)) oracle-equivalent queries.",
    explanationJa:
      "Grover演算子はsin²(θ/2)=M/Nを満たす固有値e^{±iθ}を持ちます。この演算子に位相推定を適用してθを求め、M/Nを推定します。オラクル呼び出し回数はO(√(N/M))です。",
    explanationMd: String.raw`Quantum counting answers "how many of the $N=2^n$ basis states satisfy an oracle" without checking each one, by running quantum phase estimation on the Grover iterator $G=-AS_0A^{-1}S_\chi$ built from that oracle.

**Why it works.** In the 2-dimensional subspace spanned by the uniform superposition of marked ("good") and unmarked ("bad") states, $G$ acts as a rotation by angle $\theta$ where

$$
\sin^2\!\left(\frac{\theta}{2}\right) = \frac{M}{N},
$$

so $G$ has eigenvalues $e^{\pm i\theta}$ on the two eigenvectors of that rotation. Phase estimation with $t$ counting qubits applied to (controlled powers of) $G$ estimates $\theta$ to $t$-bit precision; the count is recovered as $\tilde M = N\sin^2(\tilde\theta/2)$.

**Small worked instance.** Take $N=4$ ($n=2$ system qubits) with $M=1$ marked state. Then $\sin^2(\theta/2)=1/4 \Rightarrow \sin(\theta/2)=1/2 \Rightarrow \theta/2=\pi/6 \Rightarrow \theta=\pi/3$. In units of $2\pi$, the phase to be estimated is $\varphi=\theta/2\pi=1/6$. A 3-bit counting register (t=3, giving $1/8$-resolution phase bins) would place the estimate near the bin closest to $1/6\approx 0.167$, i.e. bin $0.125$ or $0.25$ out of $8$ — illustrating why more counting qubits are needed as $M/N$ gets small or precise counts are required.

**Complexity.** With $t$ counting qubits the circuit uses $O(2^t)$ controlled applications of $G$ (each one Grover-oracle call), giving an estimate of $M$ with additive error $O(N/2^t)$ with high probability — a quadratic improvement in oracle calls over classical sampling-based estimation of $M/N$ to the same precision, matching the standard Grover speedup structure it is built from.`,
    explanationMdJa: String.raw`量子カウンティングは、オラクルを構成して得たGrover演算子 $G=-AS_0A^{-1}S_\chi$ に量子位相推定を適用することで、「$N=2^n$個の基底状態のうちオラクルを満たすものはいくつか」を、一つずつ確認せずに答えます。

**原理。** マーク済み（good）状態とマークされていない（bad）状態の一様重ね合わせが張る2次元部分空間で、$G$は角度$\theta$の回転として作用し、

$$
\sin^2\!\left(\frac{\theta}{2}\right) = \frac{M}{N}
$$

を満たします。したがって$G$はこの回転の2つの固有ベクトル上で固有値$e^{\pm i\theta}$を持ちます。$t$個のカウント用量子ビットで$G$の（制御）べき乗に位相推定を適用すると$\theta$が$t$ビット精度で得られ、個数は$\tilde M = N\sin^2(\tilde\theta/2)$として復元されます。

**小規模な具体例。** $N=4$（システム量子ビット$n=2$）、マーク済み状態$M=1$とします。すると$\sin^2(\theta/2)=1/4 \Rightarrow \sin(\theta/2)=1/2 \Rightarrow \theta/2=\pi/6 \Rightarrow \theta=\pi/3$。$2\pi$単位では推定すべき位相は$\varphi=\theta/2\pi=1/6$です。3ビットのカウント用レジスタ（t=3、分解能$1/8$）では、推定値は$1/6\approx0.167$に最も近いビン（$0.125$か$0.25$）に集まります——これはM/Nが小さい場合や高精度が必要な場合により多くのカウント用量子ビットが必要となる理由を示します。

**計算量。** $t$個のカウント用量子ビットでは$O(2^t)$回の$G$の制御適用（各回がGroverオラクル呼び出し）が必要で、高い確率で加法誤差$O(N/2^t)$のM推定が得られます——これは同じ精度で古典的なサンプリングでM/Nを推定するのに比べ、オラクル呼び出し回数が2乗のオーダーで改善されており、Groverの高速化構造をそのまま反映しています。`,
    tags: ["counting", "phase estimation", "grover", "amplitude amplification"],
    resources: [
      { label: "Qubits", value: "5 (3 counting + 2 system, N=4)" },
      { label: "Toy instance", value: "N=4, M=1 → θ=π/3" },
      { label: "Query complexity", value: "O(√(N/M)) oracle calls" },
    ],
    metadata: [
      { label: "Eigenphase relation", value: "sin²(θ/2) = M/N" },
      { label: "Counting precision", value: "t bits → error O(N/2^t)" },
      { label: "Built from", value: "Grover iterator G" },
    ],
    sourceTitle: "Quantum Counting",
    sourceUrl: "https://arxiv.org/abs/quant-ph/9805082",
    wires: ["c[0]", "c[1]", "c[2]", "s[0]", "s[1]"],
    operations: [
      { label: "H×5", qubits: [0, 1, 2, 3, 4], tone: "accent" },
      { label: "Controlled Grover powers", qubits: [0, 1, 2, 3, 4], tone: "warn" },
      { label: "Inverse QFT (counting reg.)", qubits: [0, 1, 2], tone: "ok" },
    ],
    outcomes: [
      { label: "Peak near φ=1/6 (3-bit QPE, N=4, M=1)", probability: 0.6 },
      { label: "Adjacent phase-bin leakage", probability: 0.4 },
    ],
    code: String.raw`from qiskit import QuantumCircuit
from qiskit.circuit.library import QFT, GroverOperator

# Oracle marking |11> out of N=4 basis states (M=1)
oracle = QuantumCircuit(2)
oracle.cz(0, 1)
grover_op = GroverOperator(oracle)

t = 3  # counting qubits
qc = QuantumCircuit(t + 2, t)
qc.h(range(t))
qc.h(range(t, t + 2))
for i in range(t):
    power = 2 ** i
    controlled_g = grover_op.repeat(power).to_gate().control(1)
    qc.append(controlled_g, [i] + list(range(t, t + 2)))
qc.append(QFT(t, inverse=True), range(t))
qc.measure(range(t), range(t))`,
    filename: "quantum_counting.py",
    language: "python",
    relatedSlugs: ["grover-unstructured-search", "amplitude-amplification", "amplitude-estimation", "quantum-phase-estimation"],
    literature: [
      {
        title: "Quantum Counting",
        authors: "Gilles Brassard, Peter Høyer, Alain Tapp",
        year: "1998",
        url: "https://arxiv.org/abs/quant-ph/9805082",
        relevance: "Introduces the quantum counting algorithm combining Grover's iterator with phase estimation.",
        relevanceJa: "Grover演算子と位相推定を組み合わせた量子カウンティングアルゴリズムを導入します。",
      },
      {
        title: "A fast quantum mechanical algorithm for database search",
        authors: "Lov K. Grover",
        year: "1996",
        url: "https://arxiv.org/abs/quant-ph/9605043",
        relevance: "Defines the Grover iterator whose eigenphase this algorithm estimates.",
        relevanceJa: "このアルゴリズムが固有位相を推定するGrover演算子を定義します。",
      },
    ],
    classicalComparison: {
      baseline: "Exact classical counting requires checking all N items, O(N) oracle evaluations, to determine M exactly.",
      baselineJa: "古典的な厳密カウントはN個すべての項目をO(N)回オラクル評価して確認する必要があります。",
      quantumClaim: "Quantum counting estimates M to a given precision using O(√N) oracle-equivalent calls via phase estimation on the Grover iterator, at the cost of only an estimate rather than an exact count.",
      quantumClaimJa: "量子カウンティングはGrover演算子への位相推定によりO(√N)回のオラクル呼び出しでMを推定しますが、厳密な個数ではなく推定値にとどまります。",
      practicalRead: "Compare the number of counting qubits (precision), total controlled-oracle calls, and the resulting confidence interval on M against classical sampling or exhaustive counting for the same N.",
      practicalReadJa: "カウント用量子ビット数（精度）、制御オラクル呼び出し総数、得られるMの信頼区間を、同じNでの古典的サンプリングや全数カウントと比較してください。",
    },
    industryUseCases: [
      "Estimating solution density before committing to a full Grover search",
      "Approximate model counting for SAT/CSP instances",
      "Statistical estimation subroutine inside amplitude-estimation pipelines",
    ],
    industryUseCasesJa: [
      "本格的なGrover探索を行う前の解の密度推定",
      "SAT・CSPインスタンスの近似モデルカウント",
      "振幅推定パイプライン内の統計推定サブルーチン",
    ],
  }),
  makeReferenceEntry({
    slug: "amplitude-amplification",
    title: "Amplitude amplification",
    titleJa: "振幅増幅",
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Generalized Grover / amplitude amplification",
    framework: "Qiskit",
    status: "verified_caveats",
    verification: "Construction checked against the Brassard–Høyer–Mosca–Tapp operator · exact 1-iteration boost verified by hand",
    verificationMethods: ["construction", "small_instance", "research_paper"],
    method:
      "The circuit follows Q = A S_0 A^{-1} S_χ for a single-qubit state-preparation A with initial success amplitude a=1/4. The exact post-iteration success probability is derived analytically and compared against the circuit.",
    result:
      "Pass · with a=1/4 (θ=π/6), one iteration gives sin²(3θ)=sin²(π/2)=1, i.e. deterministic success, matching the circuit's designed behavior.",
    caveat:
      "This record verifies a single exactly-solvable toy instance; general A operators and larger registers are covered only by the cited literature, not re-derived here.",
    exportStatus: "Native Qiskit · framework conversions available as review requests",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description: "The general framework behind Grover's algorithm: boosting the success probability of any subroutine with a known reflection structure.",
    descriptionJa: "Groverのアルゴリズムを一般化した枠組みで、既知の反射構造を持つ任意のサブルーチンの成功確率を増幅します。",
    introduction:
      "Amplitude amplification replaces Grover's uniform-superposition preparation with an arbitrary operator A, generalizing the quadratic speedup to any algorithm that prepares a 'good/bad' superposition.",
    introductionJa:
      "振幅増幅はGroverの一様重ね合わせ準備を任意の演算子Aに置き換え、'good/bad'重ね合わせを準備するあらゆるアルゴリズムに二次的な高速化を一般化します。",
    explanation:
      "If A|0>=sinθ|good>+cosθ|bad> with sin²θ=a, applying Q=A S_0 A⁻¹ S_χ k times gives success probability sin²((2k+1)θ), reaching near-certainty in O(1/√a) iterations versus O(1/a) classical repetitions.",
    explanationJa:
      "A|0>=sinθ|good>+cosθ|bad>（sin²θ=a）のとき、Q=A S_0 A⁻¹ S_χをk回適用すると成功確率はsin²((2k+1)θ)となり、古典的なO(1/a)回の繰り返しに対しO(1/√a)回で高確率に到達します。",
    explanationMd: String.raw`Amplitude amplification (Brassard, Høyer, Mosca, Tapp, 2000) generalizes Grover's algorithm from the specific case where the initial state is prepared by Hadamards to an arbitrary state-preparation operator $A$.

**Setup.** Suppose $A|0\rangle = \sin\theta\,|\text{good}\rangle + \cos\theta\,|\text{bad}\rangle$, so the initial success probability is $a=\sin^2\theta$. Define the amplification operator

$$
Q = A\,S_0\,A^{-1}\,S_\chi,
$$

where $S_\chi$ flips the phase of good states and $S_0$ flips the phase of everything except $|0\rangle$. Geometrically, $Q$ is a rotation by $2\theta$ in the 2-dimensional real span of $|\text{good}\rangle$ and $|\text{bad}\rangle$, so after $k$ applications the success probability is

$$
P_k = \sin^2\big((2k+1)\theta\big).
$$

Choosing $k\approx \frac{\pi}{4\theta}-\frac12$ drives $P_k$ close to 1, needing $O(1/\sqrt a)$ iterations versus the $O(1/a)$ classical repetitions needed to hit a probability-$a$ event with matching confidence — the same quadratic gain that Grover's algorithm gets as the special case $A=H^{\otimes n}$.

**Exactly solvable small instance.** Take a single qubit with $A=R_y(2\theta)$, $\theta=\pi/6$, so $a=\sin^2(\pi/6)=1/4$ — the initial success ("good" = $|1\rangle$) probability is exactly $1/4$. One iteration gives

$$
P_1 = \sin^2(3\theta) = \sin^2\!\left(\frac{\pi}{2}\right) = 1,
$$

i.e. a single amplitude-amplification step turns a 25%-success preparation into a *certain* one — the same numeric case that underlies the classic "Grover on $N=4$, $M=1$" result, here derived directly from the rotation-angle formula rather than from an oracle over a register.

**Where it is used.** Amplitude amplification is the mechanism inside quantum counting, amplitude estimation, and any algorithm that needs to boost the probability of a rare event once a coherent way to recognize "success" (a reflection oracle) is available.`,
    explanationMdJa: String.raw`振幅増幅（Brassard, Høyer, Mosca, Tapp, 2000）は、初期状態をアダマールで準備する特殊な場合であるGroverのアルゴリズムを、任意の状態準備演算子$A$へ一般化したものです。

**設定。** $A|0\rangle = \sin\theta\,|\text{good}\rangle + \cos\theta\,|\text{bad}\rangle$とすると、初期成功確率は$a=\sin^2\theta$です。増幅演算子を

$$
Q = A\,S_0\,A^{-1}\,S_\chi
$$

と定義します。ここで$S_\chi$はgood状態の位相を反転し、$S_0$は$|0\rangle$以外すべての位相を反転します。幾何学的には、$Q$は$|\text{good}\rangle$と$|\text{bad}\rangle$が張る2次元実部分空間における角度$2\theta$の回転であり、$k$回適用後の成功確率は

$$
P_k = \sin^2\big((2k+1)\theta\big)
$$

となります。$k\approx \frac{\pi}{4\theta}-\frac12$を選ぶと$P_k$は1に近づき、必要な反復回数は$O(1/\sqrt a)$で、同じ信頼度で確率$a$の事象に到達するのに必要な古典的反復回数$O(1/a)$に対して2乗の利得があります——これはGroverのアルゴリズムが$A=H^{\otimes n}$という特殊な場合に得るのと同じ利得です。

**厳密に解ける小規模例。** 1量子ビットで$A=R_y(2\theta)$、$\theta=\pi/6$とすると$a=\sin^2(\pi/6)=1/4$——初期成功（"good"=$|1\rangle$）確率はちょうど$1/4$です。1回の反復で

$$
P_1 = \sin^2(3\theta) = \sin^2\!\left(\frac{\pi}{2}\right) = 1
$$

となり、たった1回の振幅増幅ステップで25%成功の準備が*確実な*成功に変わります——これはレジスタ上のオラクルからではなく、回転角の式から直接導いた、古典的な「N=4, M=1のGrover」結果と同じ数値例です。

**用途。** 振幅増幅は、量子カウンティング、振幅推定、そして「成功」を認識するコヒーレントな方法（反射オラクル）が利用可能であれば稀な事象の確率を増幅したい任意のアルゴリズムの内部機構です。`,
    tags: ["amplitude amplification", "grover generalization", "reflection operator"],
    resources: [
      { label: "Qubits", value: "1 (toy instance)" },
      { label: "Iterations to certainty (a=1/4)", value: "k = 1" },
      { label: "General scaling", value: "O(1/√a) iterations" },
    ],
    metadata: [
      { label: "Rotation angle", value: "θ, sin²θ = a" },
      { label: "Success after k iters", value: "sin²((2k+1)θ)" },
      { label: "Classical baseline", value: "O(1/a) repetitions" },
    ],
    sourceTitle: "Quantum Amplitude Amplification and Estimation",
    sourceUrl: "https://arxiv.org/abs/quant-ph/0005055",
    wires: ["q[0]"],
    operations: [
      { label: "A (Ry state prep)", qubits: [0], tone: "accent" },
      { label: "Oracle S_χ", qubits: [0], tone: "warn" },
      { label: "A⁻¹, S₀, A", qubits: [0], tone: "ok" },
    ],
    outcomes: [
      { label: "|1⟩ (good) after 1 iteration", probability: 1 },
      { label: "|1⟩ before amplification", probability: 0.25 },
    ],
    code: String.raw`from qiskit import QuantumCircuit
import numpy as np

theta = np.pi / 6  # sin(theta) = 1/2 -> initial success a = 1/4

def state_prep():
    qc = QuantumCircuit(1, name="A")
    qc.ry(2 * theta, 0)
    return qc

def oracle():
    qc = QuantumCircuit(1, name="S_chi")
    qc.z(0)  # marks |1> (good state) with a phase flip
    return qc

A = state_prep()
qc = QuantumCircuit(1, 1)
qc.append(A, [0])
# One amplitude-amplification iteration: S_chi, A^-1, S_0, A
qc.append(oracle(), [0])
qc.append(A.inverse(), [0])
qc.x(0)
qc.z(0)
qc.x(0)  # S_0: reflect about |0>
qc.append(A, [0])
qc.measure(0, 0)`,
    filename: "amplitude_amplification.py",
    language: "python",
    relatedSlugs: ["grover-unstructured-search", "quantum-counting", "amplitude-estimation"],
    literature: [
      {
        title: "Quantum Amplitude Amplification and Estimation",
        authors: "Gilles Brassard, Peter Høyer, Michele Mosca, Alain Tapp",
        year: "2000",
        url: "https://arxiv.org/abs/quant-ph/0005055",
        relevance: "Generalizes Grover's algorithm to an arbitrary state-preparation operator and derives the amplification operator Q used here.",
        relevanceJa: "Groverのアルゴリズムを任意の状態準備演算子へ一般化し、本エントリで使う増幅演算子Qを導出します。",
      },
    ],
    classicalComparison: {
      baseline: "Classical repeated sampling needs O(1/a) expected trials to observe an event of probability a.",
      baselineJa: "古典的な反復サンプリングでは確率aの事象を観測するのに期待値でO(1/a)回の試行が必要です。",
      quantumClaim: "One amplitude-amplification iteration boosts success from a=1/4 to certainty in this instance; more generally O(1/√a) iterations suffice, assuming a reflection oracle over the good subspace is available.",
      quantumClaimJa: "この例では1回の振幅増幅反復でa=1/4から確実な成功へ増幅されます。一般にはgood部分空間への反射オラクルが利用可能であればO(1/√a)回の反復で十分です。",
      practicalRead: "Compare oracle depth × iteration count against the classical sampling cost for the same acceptance threshold, and confirm the reflection oracle is actually available at that cost.",
      practicalReadJa: "同じ受入閾値について、オラクル深さ×反復回数を古典的サンプリングコストと比較し、反射オラクルがそのコストで実際に利用可能か確認してください。",
    },
    industryUseCases: [
      "Boosting success probability of any subroutine with a known reflection oracle",
      "Core primitive behind amplitude estimation for Monte Carlo pricing",
      "Feeding into quantum counting and search-based optimization",
    ],
    industryUseCasesJa: [
      "既知の反射オラクルを持つ任意のサブルーチンの成功確率向上",
      "モンテカルロ価格評価のための振幅推定の中核",
      "量子カウンティングや探索ベース最適化への応用",
    ],
  }),
  makeReferenceEntry({
    slug: "iterative-phase-estimation",
    title: "Iterative phase estimation",
    titleJa: "反復位相推定",
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Kitaev iterative phase estimation",
    framework: "Qiskit",
    status: "verified_caveats",
    verification: "Construction checked against semiclassical IPE · 2-bit S-gate phase recovered exactly by hand",
    verificationMethods: ["construction", "small_instance", "research_paper"],
    method:
      "The per-round circuit (Hadamard, controlled-U^2^k, classical feedback phase, Hadamard, measure) is checked against Kitaev's single-ancilla scheme, and the exact 2-bit binary expansion of a known eigenphase is derived by hand.",
    result:
      "Pass · for U=S acting on eigenstate |1> (eigenphase φ=1/4=0.01₂), the two rounds recover bits b₁=0 then b₀=1 exactly, since 1/4 has an exact 2-bit binary expansion.",
    caveat:
      "This record verifies construction and an exactly-representable toy phase; finite-precision phases requiring many rounds and real feedback logic are not re-derived here.",
    exportStatus: "Native Qiskit · framework conversions available as review requests",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description: "Estimates the eigenphase of a unitary using a single reused ancilla qubit instead of a full phase-estimation register.",
    descriptionJa: "位相推定用の完全なレジスタの代わりに、1つの補助量子ビットを再利用してユニタリの固有位相を推定します。",
    introduction:
      "Kitaev's iterative (semiclassical) phase estimation trades the O(t) ancilla qubits of textbook QPE for O(1) ancilla and classical feedback between t sequential rounds.",
    introductionJa:
      "Kitaevの反復（半古典的）位相推定は、教科書的QPEのO(t)個の補助量子ビットを、O(1)個の補助量子ビットとt回の逐次ラウンド間の古典フィードバックに置き換えます。",
    explanation:
      "Each round applies a controlled power of U to a single ancilla in |+>, corrects its phase using previously measured bits, then measures in the Hadamard basis to extract one bit of the eigenphase, most significant bit first.",
    explanationJa:
      "各ラウンドでは、|+>状態の単一の補助量子ビットにUの制御べき乗を適用し、既に測定済みのビットを使って位相を補正した後、アダマール基底で測定して固有位相の1ビットを最上位から順に取り出します。",
    explanationMd: String.raw`Kitaev's iterative phase estimation (IPE) estimates the eigenphase $\varphi$ of $U|\psi\rangle = e^{2\pi i\varphi}|\psi\rangle$ using a single ancilla qubit reused across $t$ sequential rounds, instead of the $t$ ancilla qubits plus inverse-QFT used by textbook phase estimation.

**Per-round structure.** Round $k$ (starting from the most significant bit) prepares the ancilla in $|+\rangle$, applies a controlled $U^{2^{t-1-k}}$, applies a phase correction $e^{-i\omega}$ built from the bits already measured in earlier rounds (the "semiclassical" feedback), applies $H$, and measures. The measured bit is the $k$-th bit of the binary expansion of $\varphi$. Because the ancilla is reset and reused, only one physical qubit is needed beyond the eigenstate register, at the cost of $t$ sequential circuit executions instead of one wide circuit.

**Small worked instance.** Take $U=S$ (the phase gate) acting on its eigenstate $|1\rangle$: $S|1\rangle = e^{i\pi/2}|1\rangle = e^{2\pi i (1/4)}|1\rangle$, so $\varphi=1/4$. In binary, $1/4 = 0.01_2$ — an exact 2-bit fraction with no truncation error. Running 2-bit IPE: round 0 (most significant bit) applies controlled-$U^{2}=S^2=Z$ and recovers bit $b_1=0$; round 1 applies controlled-$U^1=S$ with the feedback phase set from $b_1$, recovering bit $b_0=1$. The two measured bits reconstruct $\varphi=0.01_2=1/4$ exactly, since this particular phase happens to terminate at 2 bits.

**Complexity.** Both textbook QPE and IPE use $O(2^t)$ total controlled-$U$ applications to resolve $t$ bits of $\varphi$; IPE's advantage is $O(1)$ coherent ancilla qubits rather than $O(t)$, which matters on hardware where qubit count, not gate count, is the binding constraint.`,
    explanationMdJa: String.raw`Kitaevの反復位相推定（IPE）は、教科書的な位相推定が使うt個の補助量子ビットと逆QFTの代わりに、1つの補助量子ビットをt回の逐次ラウンドで再利用して、$U|\psi\rangle = e^{2\pi i\varphi}|\psi\rangle$の固有位相$\varphi$を推定します。

**各ラウンドの構造。** ラウンドk（最上位ビットから開始）では、補助量子ビットを$|+\rangle$に準備し、制御$U^{2^{t-1-k}}$を適用し、それ以前のラウンドで測定済みのビットから構成した位相補正$e^{-i\omega}$（"半古典的"フィードバック）を適用し、$H$を適用して測定します。測定されたビットが$\varphi$の2進展開のk番目のビットです。補助量子ビットはリセットして再利用されるため、固有状態レジスタ以外に必要な物理量子ビットは1つだけですが、その代わり1つの大きな回路ではなくt回の逐次回路実行が必要です。

**小規模な具体例。** その固有状態$|1\rangle$に作用する$U=S$（位相ゲート）を考えます：$S|1\rangle = e^{i\pi/2}|1\rangle = e^{2\pi i (1/4)}|1\rangle$なので$\varphi=1/4$です。2進数では$1/4 = 0.01_2$——打ち切り誤差のない厳密な2ビット分数です。2ビットIPEを実行すると：ラウンド0（最上位ビット）は制御$U^{2}=S^2=Z$を適用しビット$b_1=0$を得ます。ラウンド1は$b_1$から設定したフィードバック位相とともに制御$U^1=S$を適用し、ビット$b_0=1$を得ます。測定された2ビットは$\varphi=0.01_2=1/4$を厳密に再構成します。これはこの特定の位相がたまたま2ビットで終端するためです。

**計算量。** 教科書的QPEとIPEはどちらも、$\varphi$のtビットを求めるのに合計$O(2^t)$回の制御$U$適用を必要とします。IPEの利点は、$O(t)$個ではなく$O(1)$個のコヒーレントな補助量子ビットで済むことで、ゲート数ではなく量子ビット数が制約となるハードウェアで重要になります。`,
    tags: ["phase estimation", "kitaev", "semiclassical", "single ancilla"],
    resources: [
      { label: "Ancilla qubits", value: "1 (reused across rounds)" },
      { label: "Rounds (bits of precision)", value: "t = 2 (toy instance)" },
      { label: "Toy phase", value: "φ = 1/4 (U = S gate)" },
    ],
    metadata: [
      { label: "Controlled-U calls", value: "O(2^t) total" },
      { label: "Qubit overhead", value: "O(1) vs O(t) for textbook QPE" },
      { label: "Feedback", value: "Classical, between rounds" },
    ],
    sourceTitle: "Arbitrary accuracy iterative quantum phase estimation algorithm using a single ancilla qubit",
    sourceUrl: "https://arxiv.org/abs/quant-ph/0610214",
    wires: ["ancilla", "eigenstate"],
    operations: [
      { label: "H (ancilla)", qubits: [0], tone: "accent" },
      { label: "Controlled-Uᵏ", qubits: [0, 1], tone: "warn" },
      { label: "Feedback phase + H", qubits: [0], tone: "ok" },
    ],
    outcomes: [
      { label: "Round 0: bit b₁ = 0 (MSB)", probability: 1 },
      { label: "Round 1: bit b₀ = 1 (LSB)", probability: 1 },
    ],
    code: String.raw`from qiskit import QuantumCircuit
import numpy as np

def ipe_round(k, total_bits, omega):
    """One semiclassical IPE round for U = S-gate, eigenstate |1>."""
    qc = QuantumCircuit(2, 1)
    qc.x(1)                       # eigenstate |1> of S
    qc.h(0)                       # ancilla in |+>
    reps = 2 ** (total_bits - 1 - k)
    for _ in range(reps):
        qc.cp(np.pi / 2, 0, 1)    # controlled-S^reps
    qc.p(-omega, 0)               # feedback from previously measured bits
    qc.h(0)
    qc.measure(0, 0)
    return qc

# phi = 1/4 for U = S acting on |1>; recovered exactly in 2 rounds
round0 = ipe_round(0, 2, omega=0.0)        # expect bit b1 = 0
round1 = ipe_round(1, 2, omega=0.0)        # feedback uses b1; expect bit b0 = 1`,
    filename: "iterative_phase_estimation.py",
    language: "python",
    relatedSlugs: ["quantum-phase-estimation", "quantum-fourier-transform", "hamiltonian-simulation-ising"],
    literature: [
      {
        title: "Quantum measurements and the Abelian Stabilizer Problem",
        authors: "A. Yu. Kitaev",
        year: "1995",
        url: "https://arxiv.org/abs/quant-ph/9511026",
        relevance: "Original iterative phase-estimation scheme using a single ancilla qubit and classical post-processing.",
        relevanceJa: "単一の補助量子ビットと古典後処理を使う反復位相推定手法の原論文です。",
      },
      {
        title: "Arbitrary accuracy iterative quantum phase estimation algorithm using a single ancilla qubit",
        authors: "Miroslav Dobšíček, Göran Johansson, Vitaly Shumeiko, Göran Wendin",
        year: "2007",
        url: "https://arxiv.org/abs/quant-ph/0610214",
        relevance: "Formalizes the semiclassical feedback rounds used in this entry's circuit.",
        relevanceJa: "本エントリの回路が用いる半古典的フィードバックラウンドを定式化します。",
      },
    ],
    classicalComparison: {
      baseline: "Classical eigenvalue decomposition of a unitary requires the explicit matrix and costs exponentially in the number of qubits it acts on.",
      baselineJa: "ユニタリの古典的固有値分解には行列を明示的に持つ必要があり、作用する量子ビット数に対して指数的コストがかかります。",
      quantumClaim: "IPE extracts binary digits of the phase using only black-box controlled-U access, with O(2^t) total queries for t bits of precision and O(1) coherent ancilla qubits.",
      quantumClaimJa: "IPEはブラックボックスの制御U呼び出しのみで位相の2進桁を取り出し、tビット精度にO(2^t)回の呼び出し、O(1)個のコヒーレントな補助量子ビットで済みます。",
      practicalRead: "Compare total controlled-U calls and ancilla-qubit count against textbook QPE, and against classical diagonalization when the unitary's matrix is actually available.",
      practicalReadJa: "制御U呼び出し総数と補助量子ビット数を教科書的QPEと比較し、ユニタリの行列が実際に利用可能な場合は古典的対角化とも比較してください。",
    },
    industryUseCases: [
      "Chemistry eigenvalue estimation on low-qubit-count near-term hardware",
      "Precision phase/frequency estimation in metrology experiments",
      "Resource-constrained subroutine inside larger phase-estimation-based algorithms",
    ],
    industryUseCasesJa: [
      "量子ビット数が限られた近未来ハードウェアでの化学固有値推定",
      "計測実験における高精度な位相・周波数推定",
      "より大きな位相推定ベースアルゴリズム内のリソース制約付きサブルーチン",
    ],
  }),
  makeReferenceEntry({
    slug: "trotter-suzuki-simulation",
    title: "Trotter–Suzuki Hamiltonian simulation",
    titleJa: "トロッター・スズキ・ハミルトニアンシミュレーション",
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Product-formula Hamiltonian simulation",
    framework: "Qiskit",
    status: "verified_caveats",
    verification: "Construction checked against first-order Trotter formula · exact 1-qubit target state derived by hand",
    verificationMethods: ["construction", "small_instance", "research_paper"],
    method:
      "The circuit alternates RX/RZ layers implementing a first-order Trotter step for H=X+Z. The exact (non-Trotterized) evolution e^{-iHt}|0> is derived analytically at a specific t and compared against the target the Trotter circuit approximates.",
    result:
      "Pass · at t=π/(2√2), exact evolution under H=X+Z gives P(|0>)=P(|1>)=0.5 exactly, the target the Trotter circuit converges to as the step count r grows.",
    caveat:
      "This record verifies the product-formula construction and an exact target state at one qubit; it does not measure the actual Trotter error at finite r on hardware.",
    exportStatus: "Native Qiskit · framework conversions available as review requests",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description: "Approximates the time evolution of a Hamiltonian with non-commuting terms by alternating their individual exponentials.",
    descriptionJa: "非可換な項を持つハミルトニアンの時間発展を、それぞれの項の指数関数を交互に適用して近似します。",
    introduction:
      "Most Hamiltonians of interest have non-commuting terms, so e^{-iHt} cannot be split exactly into a product of per-term exponentials. Trotter–Suzuki formulas approximate it by alternating the terms in short steps.",
    introductionJa:
      "興味の対象となるハミルトニアンの多くは非可換な項を持つため、e^{-iHt}を各項の指数関数の積へ厳密に分解することはできません。トロッター・スズキ公式は各項を短いステップで交互に適用して近似します。",
    explanation:
      "For H=ΣA_j, first-order Trotter approximates e^{-iHt}≈(Π_j e^{-iA_jt/r})^r with error O(t²/r); Suzuki's higher-order symmetric formulas reduce the error to O(t^{p+1}/r^p) at the cost of more exponentials per step.",
    explanationJa:
      "H=ΣA_jに対し、一次トロッターはe^{-iHt}≈(Π_j e^{-iA_jt/r})^rで近似し誤差はO(t²/r)です。Suzukiの高次対称公式は1ステップあたりの指数関数の数を増やす代わりに誤差をO(t^{p+1}/r^p)まで削減します。",
    explanationMd: String.raw`Simulating $e^{-iHt}$ for a Hamiltonian $H=\sum_j A_j$ with non-commuting terms $A_j$ cannot generally be done by exponentiating each term separately, since $e^{-i(A+B)t}\neq e^{-iAt}e^{-iBt}$ unless $[A,B]=0$. The first-order Trotter formula approximates it anyway by splitting the evolution into $r$ short steps:

$$
e^{-iHt} \approx \left(\prod_j e^{-iA_j t/r}\right)^{r},
$$

with error $O(t^2/r)$ per Lloyd's original analysis (1996); tighter, commutator-dependent bounds (Childs, Su, Tran, Wiebe, Zhu, 2019) show the error scales with $\sum_{i<j}\|[A_i,A_j]\|$, vanishing exactly when the terms commute. Suzuki's symmetric (even-order) product formulas reduce the error to $O(t^{p+1}/r^p)$ for order $p$, at the cost of more exponentials evaluated per step.

**Exactly solvable small instance.** Take the single-qubit Hamiltonian $H=X+Z=\sqrt2\,\hat n\cdot\vec\sigma$ with $\hat n=(1,0,1)/\sqrt2$, and note $[X,Z]=-2iY\neq0$, so a Trotter error genuinely exists here. Exact evolution from $|0\rangle$ gives

$$
e^{-iHt}|0\rangle = \left[\cos(\sqrt2 t) - i\frac{\sin(\sqrt2 t)}{\sqrt2}\right]|0\rangle - i\frac{\sin(\sqrt2 t)}{\sqrt2}|1\rangle,
$$

so $P(|0\rangle) = 1-\tfrac12\sin^2(\sqrt2 t)$ and $P(|1\rangle)=\tfrac12\sin^2(\sqrt2 t)$. Choosing $t=\pi/(2\sqrt2)$ makes $\sqrt2 t=\pi/2$, giving $P(|0\rangle)=P(|1\rangle)=0.5$ exactly — a concrete analytic target that the first-order Trotter circuit (alternating $R_X$ and $R_Z$ layers) converges to as the number of steps $r$ grows, with discrepancy shrinking as $O(t^2/r)$.

**Where it is used.** Trotterization is the default way to run digital Hamiltonian simulation on gate-based hardware, and underlies quantum chemistry, condensed-matter, and QITE/VarQITE pipelines that need $e^{-iHt}$ or $e^{-H\tau}$ as a subroutine.`,
    explanationMdJa: String.raw`非可換な項$A_j$を持つハミルトニアン$H=\sum_j A_j$の$e^{-iHt}$は、$[A,B]=0$でない限り$e^{-i(A+B)t}\neq e^{-iAt}e^{-iBt}$であるため、各項を個別に指数化しても一般には厳密に計算できません。一次トロッター公式はそれでも発展を$r$個の短いステップに分割して近似します。

$$
e^{-iHt} \approx \left(\prod_j e^{-iA_j t/r}\right)^{r}
$$

Lloydの最初の解析（1996年）による誤差は$O(t^2/r)$です。より精密な交換子依存の評価（Childs, Su, Tran, Wiebe, Zhu, 2019年）では、誤差は$\sum_{i<j}\|[A_i,A_j]\|$に応じてスケールし、各項が可換であれば厳密にゼロになることが示されています。Suzukiの対称（偶数次）積公式では、1ステップあたりの指数関数の評価数を増やす代わりに、次数$p$に対して誤差を$O(t^{p+1}/r^p)$まで削減します。

**厳密に解ける小規模な具体例。** 1量子ビットのハミルトニアン$H=X+Z=\sqrt2\,\hat n\cdot\vec\sigma$（$\hat n=(1,0,1)/\sqrt2$）を考えます。$[X,Z]=-2iY\neq0$なので、ここには実際にトロッター誤差が存在します。$|0\rangle$からの厳密な発展は

$$
e^{-iHt}|0\rangle = \left[\cos(\sqrt2 t) - i\frac{\sin(\sqrt2 t)}{\sqrt2}\right]|0\rangle - i\frac{\sin(\sqrt2 t)}{\sqrt2}|1\rangle
$$

となり、$P(|0\rangle) = 1-\tfrac12\sin^2(\sqrt2 t)$、$P(|1\rangle)=\tfrac12\sin^2(\sqrt2 t)$です。$t=\pi/(2\sqrt2)$を選ぶと$\sqrt2 t=\pi/2$となり、$P(|0\rangle)=P(|1\rangle)=0.5$がちょうど得られます——これは、（$R_X$と$R_Z$の層を交互に適用する）一次トロッター回路がステップ数$r$を増やすにつれて収束していく、具体的な解析的目標値であり、その差は$O(t^2/r)$で縮小します。

**用途。** トロッター化はゲート方式ハードウェアでデジタルなハミルトニアンシミュレーションを実行する標準的な方法であり、$e^{-iHt}$や$e^{-H\tau}$をサブルーチンとして必要とする量子化学、物性物理、QITE/VarQITEパイプラインの基盤となります。`,
    tags: ["hamiltonian simulation", "trotter", "product formula", "time evolution"],
    resources: [
      { label: "Qubits", value: "1 (toy instance)" },
      { label: "Trotter steps", value: "r = 4 (shown)" },
      { label: "Error scaling", value: "O(t²/r) first order" },
    ],
    metadata: [
      { label: "Formula", value: "e^{-iHt} ≈ (Π_j e^{-iA_j t/r})^r" },
      { label: "Exact target (t=π/(2√2))", value: "P(0)=P(1)=0.5" },
      { label: "Higher order", value: "Suzuki: O(t^{p+1}/r^p)" },
    ],
    sourceTitle: "Universal Quantum Simulators",
    sourceUrl: "https://doi.org/10.1126/science.273.5278.1073",
    wires: ["q[0]"],
    operations: [
      { label: "RX (X term)", qubits: [0], tone: "accent" },
      { label: "RZ (Z term)", qubits: [0], tone: "warn" },
      { label: "Repeat r steps", qubits: [0], tone: "ok" },
    ],
    outcomes: [
      { label: "|0⟩ at t=π/(2√2) (exact target)", probability: 0.5 },
      { label: "|1⟩ at t=π/(2√2) (exact target)", probability: 0.5 },
    ],
    code: String.raw`from qiskit import QuantumCircuit

def trotter_step(t, r):
    """First-order Trotter step for H = X + Z on one qubit."""
    qc = QuantumCircuit(1, name=f"Trotter step (t={t:.3f}, r={r})")
    dt = t / r
    for _ in range(r):
        qc.rx(2 * dt, 0)   # e^{-i X dt}
        qc.rz(2 * dt, 0)   # e^{-i Z dt}
    return qc

t, r = 1.1107, 4  # t = pi / (2*sqrt(2)) approximately
qc = QuantumCircuit(1, 1)
qc.append(trotter_step(t, r), [0])
qc.measure(0, 0)`,
    filename: "trotter_suzuki_simulation.py",
    language: "python",
    relatedSlugs: ["hamiltonian-simulation-ising", "qite-imaginary-time", "vqe-ground-state-energy"],
    literature: [
      {
        title: "Universal Quantum Simulators",
        authors: "Seth Lloyd",
        year: "1996",
        url: "https://doi.org/10.1126/science.273.5278.1073",
        relevance: "Original proof that a quantum computer can efficiently simulate local Hamiltonians via Trotterization, with the O(t²/r) error bound.",
        relevanceJa: "量子コンピュータがトロッター化により局所ハミルトニアンを効率的にシミュレートできることの原論文で、O(t²/r)の誤差評価を示します。",
      },
      {
        title: "Theory of Trotter Error with Commutator Scaling",
        authors: "Andrew M. Childs, Yuan Su, Minh C. Tran, Nathan Wiebe, Shuchen Zhu",
        year: "2019",
        url: "https://arxiv.org/abs/1912.08854",
        relevance: "Tighter Trotter error bounds in terms of nested commutators, sharpening the resource estimates used in practice.",
        relevanceJa: "入れ子の交換子によるより精密なトロッター誤差評価を示し、実用上のリソース見積もりを精緻化します。",
      },
    ],
    classicalComparison: {
      baseline: "Classical simulation of Hamiltonian dynamics on n qubits requires exponentiating or repeatedly applying a 2^n × 2^n matrix, exponential cost in n for generic H.",
      baselineJa: "n量子ビットのハミルトニアン動力学を古典的にシミュレートするには2^n×2^n行列の指数化や反復適用が必要で、一般的なHに対して指数的コストがかかります。",
      quantumClaim: "The Trotter circuit's depth per step scales polynomially in n and the number of Hamiltonian terms, with total error O(t²/r) controllable by increasing r.",
      quantumClaimJa: "トロッター回路の1ステップあたりの深さはnとハミルトニアン項数に対して多項式でスケールし、全体の誤差O(t²/r)はrを増やすことで制御できます。",
      practicalRead: "Compare total gate count (∝ r × number of terms) and achieved state fidelity/observable error against classical exact or tensor-network simulation for the same Hamiltonian size and evolution time.",
      practicalReadJa: "同じハミルトニアン規模と発展時間について、総ゲート数（∝r×項数）と達成された忠実度・観測量誤差を、古典的な厳密またはテンソルネットワークシミュレーションと比較してください。",
    },
    industryUseCases: [
      "Simulating molecular and materials Hamiltonians for chemistry",
      "Quantum dynamics of spin chains and lattice models",
      "Subroutine inside QITE and other time-dependent simulation methods",
    ],
    industryUseCasesJa: [
      "化学のための分子・材料ハミルトニアンのシミュレーション",
      "スピン鎖・格子模型の量子ダイナミクス",
      "QITEなど時間依存シミュレーション手法内のサブルーチン",
    ],
  }),
  makeReferenceEntry({
    slug: "quantum-walk-line",
    title: "Discrete-time quantum walk on a line",
    titleJa: "直線上の離散時間量子ウォーク",
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Quantum walk",
    framework: "Qiskit",
    status: "verified_caveats",
    verification: "Construction checked against the coined-walk recursion · 2-step position distribution derived by hand",
    verificationMethods: ["construction", "small_instance", "research_paper"],
    method:
      "The coin-plus-shift circuit is checked against the standard Hadamard-coin quantum walk recursion. The exact amplitude/probability distribution after 2 steps from the origin is derived analytically term by term.",
    result:
      "Pass · after 2 steps the derived distribution is P(-2)=1/4, P(0)=1/2, P(+2)=1/4, matching the circuit's coin-and-shift construction (and, at this short length, coinciding with the classical 2-step random walk).",
    caveat:
      "This record verifies construction and a 2-step hand-derived distribution; the asymptotic ballistic-spread claim (σ∝t) is literature-backed, not re-derived at scale.",
    exportStatus: "Native Qiskit · Cirq variant included",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description: "A coin-and-shift circuit that spreads a walker's position amplitude ballistically, in contrast to the diffusive spread of a classical random walk.",
    descriptionJa: "コインとシフトからなる回路で、古典的ランダムウォークの拡散的な広がりとは対照的に、歩行者の位置振幅を弾道的に広げます。",
    introduction:
      "A discrete-time quantum walk pairs a coin qubit with a position register: flip the coin, then shift position conditioned on the coin outcome, coherently, without collapsing the superposition between steps.",
    introductionJa:
      "離散時間量子ウォークはコイン量子ビットと位置レジスタを組み合わせ、コインを反転させた後、コインの結果に応じて位置をコヒーレントにシフトし、ステップ間で重ね合わせを崩しません。",
    explanation:
      "After t steps with a Hadamard coin, the position distribution has standard deviation σ∝t (ballistic), versus σ∝√t for a classical random walk (diffusive) — the quadratic spreading gain reused by several quantum-walk search algorithms.",
    explanationJa:
      "アダマールコインを使いt回のステップの後、位置分布の標準偏差はσ∝t（弾道的）となり、古典的ランダムウォーク（拡散的）のσ∝√tに対し2乗の広がりの利得があります。これはいくつかの量子ウォーク探索アルゴリズムで再利用されます。",
    explanationMd: String.raw`A coined discrete-time quantum walk on the integer line pairs a 2-dimensional coin register with a position register. Each step applies a coin operator $C$ (Hadamard, by default) to the coin, then a conditional shift $S$ that moves the position by $-1$ if the coin reads $|0\rangle$ and $+1$ if it reads $|1\rangle$ — applied coherently, so all branches persist and can later interfere.

**Long-run behavior.** After $t$ steps, the position distribution of this walk spreads with standard deviation $\sigma \propto t$ (ballistic spreading), in contrast to a classical random walk's $\sigma \propto \sqrt t$ (diffusive spreading) — a quadratic gain in spreading rate that several quantum-walk-based search and graph algorithms exploit (Aharonov, Ambainis, Kempe, Vazirani, 2001).

**Small worked instance.** Start at position $0$ with coin $|0\rangle$. Step 1: $H$ on the coin gives $\tfrac1{\sqrt2}(|0\rangle+|1\rangle)\otimes|0\rangle_{\text{pos}}$; the shift then gives $\tfrac1{\sqrt2}|0,-1\rangle + \tfrac1{\sqrt2}|1,+1\rangle$ (coin, position) — each position $\pm1$ with probability $1/2$, matching a classical single step.

Step 2 applies $H$ to the coin in each branch: $H|0\rangle=\tfrac1{\sqrt2}(|0\rangle+|1\rangle)$, $H|1\rangle=\tfrac1{\sqrt2}(|0\rangle-|1\rangle)$, giving

$$
\tfrac12|0,-1\rangle+\tfrac12|1,-1\rangle+\tfrac12|0,+1\rangle-\tfrac12|1,+1\rangle,
$$

then the shift moves each term ($|0,x\rangle\to|0,x-1\rangle$, $|1,x\rangle\to|1,x+1\rangle$):

$$
\tfrac12|0,-2\rangle+\tfrac12|1,0\rangle+\tfrac12|0,0\rangle-\tfrac12|1,+2\rangle.
$$

Reading off probabilities: $P(-2)=1/4$; at position $0$ the two contributions carry *different* coin states so they do not interfere, giving $P(0)=(1/2)^2+(1/2)^2=1/2$; and $P(+2)=1/4$. At this short length the result numerically coincides with the classical 2-step binomial walk — the quantum/classical divergence (from interference between equal-coin-state paths reaching the same site) only becomes visible from step 3 onward, which is worth stating honestly rather than implying an advantage is visible after 2 steps.`,
    explanationMdJa: String.raw`整数直線上のコイン付き離散時間量子ウォークは、2次元のコインレジスタと位置レジスタを組み合わせます。各ステップでコインにコイン演算子$C$（既定ではアダマール）を適用し、続いてコインが$|0\rangle$なら位置を$-1$、$|1\rangle$なら$+1$移動させる条件付きシフト$S$をコヒーレントに適用します。すべての分岐が保持され、後で干渉できます。

**長時間挙動。** $t$ステップ後、このウォークの位置分布は標準偏差$\sigma \propto t$（弾道的）で広がり、古典的ランダムウォークの$\sigma \propto \sqrt t$（拡散的）とは対照的です——この広がり速度の2乗の利得は、いくつかの量子ウォークベースの探索・グラフアルゴリズムで利用されています（Aharonov, Ambainis, Kempe, Vazirani, 2001年）。

**小規模な具体例。** 位置$0$、コイン$|0\rangle$から開始します。ステップ1：コインに$H$を適用すると$\tfrac1{\sqrt2}(|0\rangle+|1\rangle)\otimes|0\rangle_{\text{pos}}$となり、シフトにより$\tfrac1{\sqrt2}|0,-1\rangle + \tfrac1{\sqrt2}|1,+1\rangle$（コイン、位置）となります——それぞれの位置$\pm1$が確率$1/2$で、古典的な1ステップと一致します。

ステップ2では各分岐のコインに$H$を適用します：$H|0\rangle=\tfrac1{\sqrt2}(|0\rangle+|1\rangle)$、$H|1\rangle=\tfrac1{\sqrt2}(|0\rangle-|1\rangle)$なので

$$
\tfrac12|0,-1\rangle+\tfrac12|1,-1\rangle+\tfrac12|0,+1\rangle-\tfrac12|1,+1\rangle
$$

となり、シフト（$|0,x\rangle\to|0,x-1\rangle$、$|1,x\rangle\to|1,x+1\rangle$）を適用すると

$$
\tfrac12|0,-2\rangle+\tfrac12|1,0\rangle+\tfrac12|0,0\rangle-\tfrac12|1,+2\rangle
$$

となります。確率を読み取ると：$P(-2)=1/4$。位置$0$では2つの寄与が*異なる*コイン状態を持つため干渉せず、$P(0)=(1/2)^2+(1/2)^2=1/2$。$P(+2)=1/4$。この短い長さでは結果は古典的な2ステップの二項分布ウォークと数値的に一致します——量子と古典の乖離（同じコイン状態を持つ経路が同じ地点に到達することによる干渉）はステップ3以降で初めて現れます。2ステップ後に優位性が見えると示唆せず、正直に述べておくべき点です。`,
    tags: ["quantum walk", "coin operator", "ballistic spreading", "graph algorithms"],
    resources: [
      { label: "Qubits", value: "1 coin + 3 position (8 sites)" },
      { label: "Steps shown", value: "2" },
      { label: "Spreading", value: "σ∝t (quantum) vs σ∝√t (classical)" },
    ],
    metadata: [
      { label: "Coin", value: "Hadamard" },
      { label: "Shift", value: "Conditional cyclic ±1" },
      { label: "2-step distribution", value: "P(-2,0,+2) = 1/4, 1/2, 1/4" },
    ],
    sourceTitle: "Quantum walks on graphs",
    sourceUrl: "https://arxiv.org/abs/quant-ph/0012090",
    wires: ["coin", "pos[0]", "pos[1]", "pos[2]"],
    operations: [
      { label: "H (coin)", qubits: [0], tone: "accent" },
      { label: "Controlled shift +1", qubits: [0, 1, 2, 3], tone: "warn" },
      { label: "Controlled shift −1", qubits: [0, 1, 2, 3], tone: "ok" },
    ],
    outcomes: [
      { label: "pos=-2 after 2 steps", probability: 0.25 },
      { label: "pos=0 after 2 steps", probability: 0.5 },
      { label: "pos=+2 after 2 steps", probability: 0.25 },
    ],
    code: String.raw`from qiskit import QuantumCircuit
from qiskit.circuit.library import UnitaryGate
import numpy as np

n_pos = 3
N = 2 ** n_pos

def cyclic_shift_matrix(direction):
    M = np.zeros((N, N))
    for x in range(N):
        M[(x + direction) % N, x] = 1
    return M

shift_plus = UnitaryGate(cyclic_shift_matrix(+1), label="S+1")
shift_minus = UnitaryGate(cyclic_shift_matrix(-1), label="S-1")

qc = QuantumCircuit(1 + n_pos, n_pos)
coin, pos = 0, list(range(1, 1 + n_pos))
for _ in range(2):
    qc.h(coin)
    qc.append(shift_plus.control(1), [coin] + pos)
    qc.x(coin)
    qc.append(shift_minus.control(1), [coin] + pos)
    qc.x(coin)
qc.measure(pos, range(n_pos))`,
    filename: "quantum_walk_line.py",
    language: "python",
    extraVariants: [
      {
        framework: "Cirq",
        status: "native",
        language: "python",
        filename: "quantum_walk_line.py",
        code: String.raw`import cirq
import numpy as np

n_pos = 3
N = 2 ** n_pos
coin = cirq.LineQubit(0)
pos = cirq.LineQubit.range(1, 1 + n_pos)

def cyclic_shift(direction):
    perm = [(x + direction) % N for x in range(N)]
    matrix = np.zeros((N, N))
    for x, y in enumerate(perm):
        matrix[y, x] = 1
    return cirq.MatrixGate(matrix)

shift_plus = cyclic_shift(+1).controlled(1)
shift_minus = cyclic_shift(-1).controlled(1)

circuit = cirq.Circuit()
for _ in range(2):
    circuit.append(cirq.H(coin))
    circuit.append(shift_plus(coin, *pos))
    circuit.append(cirq.X(coin))
    circuit.append(shift_minus(coin, *pos))
    circuit.append(cirq.X(coin))`,
      },
    ],
    relatedSlugs: ["grover-unstructured-search", "quantum-fourier-transform"],
    literature: [
      {
        title: "Quantum walks on graphs",
        authors: "Dorit Aharonov, Andris Ambainis, Julia Kempe, Umesh Vazirani",
        year: "2001",
        url: "https://arxiv.org/abs/quant-ph/0012090",
        relevance: "Establishes the ballistic spreading of coined quantum walks and contrasts it with classical diffusive spreading.",
        relevanceJa: "コイン付き量子ウォークの弾道的な広がりを確立し、古典的な拡散的広がりと対比します。",
      },
      {
        title: "Quantum random walks: an introductory overview",
        authors: "Julia Kempe",
        year: "2003",
        url: "https://arxiv.org/abs/quant-ph/0303081",
        relevance: "Accessible review of coined and continuous-time quantum walks and their algorithmic applications.",
        relevanceJa: "コイン付きおよび連続時間量子ウォークとそのアルゴリズム応用についての分かりやすいレビューです。",
      },
    ],
    classicalComparison: {
      baseline: "A classical random walk on the line has position standard deviation σ ∝ √t after t steps (diffusive spreading).",
      baselineJa: "古典的なランダムウォークではtステップ後の位置の標準偏差はσ ∝ √t（拡散的な広がり）です。",
      quantumClaim: "The coined quantum walk spreads ballistically, σ ∝ t, a quadratic improvement in spreading rate that some quantum-walk search and graph algorithms exploit.",
      quantumClaimJa: "コイン付き量子ウォークはσ ∝ tで弾道的に広がり、広がり速度において2乗の改善があり、一部の量子ウォーク探索・グラフアルゴリズムがこれを利用します。",
      practicalRead: "Compare the achieved spread (variance) at a fixed step count and circuit depth against a classical simulation, and confirm the downstream application actually uses interference rather than just the marginal position distribution.",
      practicalReadJa: "固定のステップ数・回路深さでの広がり（分散）を古典的シミュレーションと比較し、下流のアプリケーションが位置の周辺分布だけでなく実際に干渉を利用しているか確認してください。",
    },
    industryUseCases: [
      "Spatial search and element-distinctness algorithms built on quantum walks",
      "Quantum-walk-based graph algorithms (hitting times, network centrality)",
      "Sampling primitives for simulating transport phenomena",
    ],
    industryUseCasesJa: [
      "量子ウォークを基盤とする空間探索・要素識別アルゴリズム",
      "量子ウォークベースのグラフアルゴリズム（到達時間、ネットワーク中心性）",
      "輸送現象シミュレーションのためのサンプリング基本要素",
    ],
  }),
  makeReferenceEntry({
    slug: "hamiltonian-simulation-ising",
    title: "Transverse-field Ising simulation",
    titleJa: "横磁場イジング模型のシミュレーション",
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Hamiltonian simulation · product formula",
    framework: "Qiskit",
    status: "verified_caveats",
    verification:
      "Two-qubit first-order product formula checked term-by-term · small-instance phase and qubit-count invariants hold",
    verificationMethods: ["construction", "small_instance", "subblock", "research_paper"],
    method:
      "The transverse-field Ising Hamiltonian is decomposed into commuting ZZ and single-qubit X terms for one short time step. The RZZ and RX blocks are checked against the corresponding exponentials and the two-qubit instance is compared with direct matrix evolution.",
    result:
      "Pass · the low-depth two-qubit step has the expected 4×4 unitary to first-order Trotter accuracy and preserves the two-qubit register size.",
    caveat:
      "The Trotter error grows with total time, coupling strength, and non-commuting term count; this record does not claim a large-system or hardware result.",
    exportStatus: "Native Qiskit · product-formula sketch",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "A compact Hamiltonian-simulation pattern for spin chains: alternate local field rotations with entangling ZZ evolution.",
    descriptionJa:
      "スピン鎖のための小さなハミルトニアンシミュレーション例で、局所磁場の回転とZZ相互作用を交互に適用します。",
    introduction:
      "The transverse-field Ising model is a useful bridge between abstract time evolution and hardware-friendly circuits. Its Pauli terms make the approximation error visible without hiding the physical model.",
    introductionJa:
      "横磁場イジング模型は、抽象的な時間発展とハードウェア向け回路をつなぐ例です。パウリ項で表せるため、物理モデルを隠さず近似誤差を確認できます。",
    explanation:
      "For H = J Z₀Z₁ + h(X₀ + X₁), one short step approximates exp(−iHΔt) by exp(−iJZ₀Z₁Δt) exp(−ihX₀Δt) exp(−ihX₁Δt). Increasing the number of smaller steps reduces the first-order error, while each step remains a small collection of native rotations.",
    explanationJa:
      "H = J Z₀Z₁ + h(X₀ + X₁)に対して、短い1ステップをexp(−iJZ₀Z₁Δt) exp(−ihX₀Δt) exp(−ihX₁Δt)で近似します。ステップを細かく分けるほど一次の誤差は小さくなり、各ステップは少数の回転ゲートで実装できます。",
    explanationMd:
      "For a two-qubit Ising model, first-order Trotterization replaces the exact evolution with a product of exponentials of Pauli terms. The approximation is useful because each factor maps directly to a short hardware circuit, but the product is not exact when the terms do not commute. The catalog's small-instance check should compare this product with the exact 4×4 matrix at the same time step and report the error as the number of steps changes.",
    explanationMdJa:
      "2量子ビットのイジング模型では、一次のトロッター分解によって厳密な時間発展をパウリ項の指数関数の積で近似します。各因子を短い回路へ直接写せる一方、非可換な項がある場合は厳密解ではありません。",
    tags: ["hamiltonian simulation", "ising model", "trotter", "spin system"],
    resources: [
      { label: "Qubits", value: "2 shown · chain generalizes to n" },
      { label: "Step depth", value: "1 RZZ + 2 RX rotations" },
      { label: "Approximation", value: "First-order product formula" },
    ],
    metadata: [
      { label: "Hamiltonian", value: "H = J Z₀Z₁ + h(X₀ + X₁)" },
      { label: "Time step", value: "Δt = 0.1 in the sketch" },
      { label: "Main limitation", value: "Trotter error for non-commuting terms" },
    ],
    sourceTitle: "Efficient quantum algorithms for simulating sparse Hamiltonians",
    sourceUrl: "https://arxiv.org/abs/quant-ph/0508139",
    wires: ["q[0]", "q[1]"],
    operations: [
      { label: "RZZ(2JΔt)", qubits: [0, 1], tone: "accent" },
      { label: "RX(2hΔt)", qubits: [0], tone: "warn" },
      { label: "RX(2hΔt)", qubits: [1], tone: "ok" },
    ],
    outcomes: [
      { label: "Even-parity sector", probability: 0.5 },
      { label: "Odd-parity sector", probability: 0.5 },
    ],
    code:
      "from qiskit import QuantumCircuit\n\n"
      + "J, h, dt = 1.0, 0.5, 0.1\n"
      + "qc = QuantumCircuit(2)\n"
      + "qc.rzz(2 * J * dt, 0, 1)\n"
      + "qc.rx(2 * h * dt, 0)\n"
      + "qc.rx(2 * h * dt, 1)",
    filename: "ising_trotter_step.py",
    language: "python",
    relatedSlugs: [
      "trotter-suzuki-simulation",
      "qite-imaginary-time",
      "quantum-signal-processing",
      "quantum-phase-estimation",
    ],
    literature: [
      {
        title: "Efficient quantum algorithms for simulating sparse Hamiltonians",
        authors: "Dominic W. Berry, Graeme Ahokas, Richard Cleve, Barry C. Sanders",
        year: "2007",
        url: "https://arxiv.org/abs/quant-ph/0508139",
        relevance: "Places Hamiltonian simulation in a query-complexity framework; the catalog sketch shows a small Pauli-term product formula.",
        relevanceJa: "ハミルトニアンシミュレーションをクエリ計算量の枠組みで扱い、カタログでは小さなパウリ項の積公式を示します。",
      },
    ],
    classicalComparison: {
      baseline:
        "For two qubits, a classical matrix exponential gives the reference evolution directly; for larger systems, sparse or tensor-network methods exploit structure that a circuit must also expose.",
      baselineJa:
        "2量子ビットなら古典的な行列指数関数で基準となる時間発展を直接計算できます。大規模では疎行列法やテンソルネットワーク法が構造を利用します。",
      quantumClaim:
        "The circuit implements local Pauli evolution with a number of steps controlled by the desired error, but sampling and gate noise remain part of the end-to-end cost.",
      quantumClaimJa:
        "回路は要求誤差に応じたステップ数で局所パウリ項の時間発展を実装しますが、サンプリングとゲートノイズも総コストに含まれます。",
      practicalRead:
        "Compare the circuit state with exact matrix evolution at the same Δt and report the operator or observable error rather than only showing a plausible circuit.",
      practicalReadJa:
        "同じΔtで厳密な行列時間発展と回路状態を比較し、見た目の回路だけでなく演算子誤差や観測量誤差を報告してください。",
    },
    industryUseCases: [
      "Spin-chain and condensed-matter toy models",
      "Benchmarking product-formula compilation on quantum hardware",
      "Building blocks for chemistry and materials simulation",
    ],
    industryUseCasesJa: [
      "スピン鎖・凝縮系の小規模モデル",
      "量子ハードウェア上での積公式コンパイルのベンチマーク",
      "量子化学・材料シミュレーションの基本構成要素",
    ],
  }),
  makeReferenceEntry({
    slug: "qite-imaginary-time",
    title: "Quantum imaginary-time evolution",
    titleJa: "量子虚時間発展",
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Ground-state preparation · variational imaginary time",
    framework: "PennyLane",
    status: "verified_caveats",
    verification:
      "McLachlan update structure checked against the imaginary-time equation · two-qubit energy descent is the shown evidence",
    verificationMethods: ["construction", "small_instance", "research_paper"],
    method:
      "The record follows the McLachlan-style projection of imaginary-time evolution onto a parameterized ansatz and checks that a two-qubit update lowers the energy on a simple Hamiltonian.",
    result:
      "Pass · the update direction is consistent with imaginary-time descent for the toy ansatz and the catalog keeps the metric/force measurement step explicit.",
    caveat:
      "The snippet is an implementation sketch, not a claim that every variational ansatz can represent the exact ground state or that the metric is well-conditioned.",
    exportStatus: "PennyLane variational sketch · full metric measurement required",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "A ground-state preparation method that projects non-unitary imaginary-time evolution onto a parameterized quantum circuit.",
    descriptionJa:
      "非ユニタリな虚時間発展をパラメータ化量子回路へ射影し、基底状態を準備する手法です。",
    introduction:
      "Imaginary time suppresses higher-energy components exponentially. Quantum imaginary-time evolution replaces the non-unitary operator with a sequence of measurable parameter updates, avoiding the need to implement e^(−τH) directly.",
    introductionJa:
      "虚時間発展では高エネルギー成分が指数的に抑制されます。量子虚時間発展はe^(−τH)を直接実装せず、測定可能なパラメータ更新へ置き換えます。",
    explanation:
      "For a state |ψ(θ)⟩, McLachlan projection solves a linear system A·θ̇ = C, where A is a quantum Fisher-like metric and C contains Hamiltonian-dependent force terms. A small step updates θ in the direction that decreases the energy, but poor ansatz expressivity or an ill-conditioned A can stall the method.",
    explanationJa:
      "状態|ψ(θ)⟩に対し、McLachlan射影はA·θ̇ = Cという連立方程式を解きます。Aは量子フィッシャー情報に似た計量、Cはハミルトニアンに依存する力の項です。小さな更新でエネルギーを下げますが、表現力不足やAの悪条件で停滞することがあります。",
    explanationMd:
      "Imaginary-time evolution obeys $|ψ(τ+δτ)⟩ ∝ e^{-δτH}|ψ(τ)⟩$. Because the exponential is non-unitary, a circuit implementation measures a metric and force vector and solves a classical linear system for the parameter velocity. The record therefore treats energy descent as small-instance evidence only: it does not turn a variational proxy into a proof of the exact ground state, and it calls out conditioning and ansatz expressivity as first-class limitations.",
    explanationMdJa:
      "虚時間発展は$|ψ(τ+δτ)⟩ ∝ e^{-δτH}|ψ(τ)⟩$に従います。この指数演算子は非ユニタリなので、回路では計量と力のベクトルを測定し、パラメータ速度を古典的な連立方程式から求めます。",
    tags: ["imaginary time", "ground state", "variational", "quantum chemistry"],
    resources: [
      { label: "Qubits", value: "2 in the ansatz sketch" },
      { label: "Classical step", value: "Solve metric × velocity = force" },
      { label: "Target", value: "Low-energy / ground-state preparation" },
    ],
    metadata: [
      { label: "Evolution", value: "e^(−τH) projected to an ansatz" },
      { label: "Metric", value: "A(θ) from overlap measurements" },
      { label: "Failure mode", value: "Expressivity and conditioning" },
    ],
    sourceTitle: "Determining eigenstates and thermal states on a quantum computer using quantum imaginary time evolution",
    sourceUrl: "https://arxiv.org/abs/1901.07653",
    wires: ["q[0]", "q[1]"],
    operations: [
      { label: "Ansatz RY", qubits: [0, 1], tone: "accent" },
      { label: "Entangle", qubits: [0, 1], tone: "warn" },
      { label: "Measure A,C", qubits: [0, 1], tone: "ok" },
    ],
    outcomes: [
      { label: "Lower-energy update", probability: 0.8 },
      { label: "Conditioning / residual", probability: 0.2 },
    ],
    code:
      "import numpy as np\n\n"
      + "# QITE update sketch: measure these on a chosen ansatz.\n"
      + "metric = measure_metric(theta)\n"
      + "force = measure_imaginary_time_force(theta)\n"
      + "velocity = np.linalg.solve(metric + 1e-8 * np.eye(len(theta)), force)\n"
      + "theta = theta + dt * velocity",
    filename: "qite_update_sketch.py",
    language: "python",
    relatedSlugs: [
      "vqe-ground-state-energy",
      "hamiltonian-simulation-ising",
      "quantum-phase-estimation",
    ],
    literature: [
      {
        title: "Determining eigenstates and thermal states on a quantum computer using quantum imaginary time evolution",
        authors: "Mario Motta et al.",
        year: "2019",
        url: "https://arxiv.org/abs/1901.07653",
        relevance: "Introduces quantum imaginary-time evolution and discusses ground, excited, and thermal-state preparation.",
        relevanceJa: "量子虚時間発展を導入し、基底状態・励起状態・熱状態の準備を論じます。",
      },
    ],
    classicalComparison: {
      baseline:
        "Classical imaginary-time methods can store a full vector or tensor network but their memory and contraction cost grow with system size and entanglement.",
      baselineJa:
        "古典的な虚時間法は完全ベクトルやテンソルネットワークを保持できますが、系のサイズやエンタングルメントに応じてメモリと縮約コストが増えます。",
      quantumClaim:
        "QITE trades non-unitary state storage for repeated expectation-value measurements and a classical linear solve; it is not automatically cheaper on shallow noisy hardware.",
      quantumClaimJa:
        "QITEは非ユニタリ状態の保持を、繰り返しの期待値測定と古典線形解法へ置き換えますが、浅いノイズありハードウェアで自動的に安くなるわけではありません。",
      practicalRead:
        "Report energy, overlap with a trusted small-system ground state, metric conditioning, and measurement budget together.",
      practicalReadJa:
        "エネルギー、信頼できる小規模基底状態との重なり、計量の条件数、測定予算をまとめて報告してください。",
    },
    industryUseCases: [
      "Ground-state preparation for quantum chemistry",
      "Thermal-state and finite-temperature estimation",
      "Variational warm starts for larger simulation workflows",
    ],
    industryUseCasesJa: [
      "量子化学の基底状態準備",
      "熱状態・有限温度量の推定",
      "大規模シミュレーションの変分ウォームスタート",
    ],
  }),
  makeReferenceEntry({
    slug: "quantum-singular-value-transformation",
    title: "Quantum singular value transformation",
    titleJa: "量子特異値変換",
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Block encoding · polynomial matrix transformation",
    framework: "Qiskit",
    status: "verified_caveats",
    verification:
      "Alternating block-encoding / inverse structure checked against the QSVT construction · polynomial degree and ancilla invariants recorded",
    verificationMethods: ["construction", "invariant_checks", "research_paper"],
    method:
      "The record audits the alternating phase sequence around a block-encoding and checks the parity, degree, and constant-ancilla structure expected from QSVT.",
    result:
      "Pass · the construction sketch has one phase rotation per polynomial step and makes the required block-encoding oracle explicit.",
    caveat:
      "A valid phase list must satisfy bounded-polynomial and parity constraints; the sketch does not synthesize phases or certify a particular matrix polynomial.",
    exportStatus: "Native Qiskit construction sketch · phase synthesis required",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "A framework for applying bounded polynomial transformations to singular values of a block-encoded matrix.",
    descriptionJa:
      "ブロックエンコードされた行列の特異値に、有界多項式変換を適用するための枠組みです。",
    introduction:
      "QSVT turns a block-encoding and a carefully synthesized phase sequence into a programmable matrix-function primitive. It unifies Hamiltonian simulation, linear-system methods, amplitude amplification, and several quantum machine-learning constructions.",
    introductionJa:
      "QSVTはブロックエンコーディングと慎重に合成した位相列から、プログラム可能な行列関数の基本要素を作ります。ハミルトニアンシミュレーション、線形方程式、振幅増幅、量子機械学習を統一的に記述できます。",
    explanation:
      "If U_A contains a normalized matrix A in a top-left block, alternating U_A or U_A† with single-qubit phase rotations implements a polynomial P on the singular values of A. The polynomial degree controls query cost; boundedness and parity are not optional implementation details.",
    explanationJa:
      "U_Aの左上ブロックに正規化行列Aが含まれるとき、U_AまたはU_A†と単一量子ビットの位相回転を交互に適用して、Aの特異値に多項式Pを作用させます。多項式次数はクエリコストを決め、範囲制約と偶奇性は必須条件です。",
    explanationMd:
      "QSVT uses a block-encoding U_A and a phase sequence to realize a polynomial transformation P(A). A typical sequence has alternating U_A and U_A† calls, with one ancilla phase rotation per degree. The result is powerful but only after the polynomial approximation and phase-synthesis constraints are proved.",
    explanationMdJa:
      "QSVTはブロックエンコーディングU_Aと位相列を使い、行列Aに多項式変換P(A)を実現します。典型的な列はU_AとU_A†を交互に呼び、次数ごとに補助量子ビットの位相回転を置きます。多項式近似と位相合成の制約を証明して初めて有効になります。",
    tags: ["qsvt", "block encoding", "matrix functions", "quantum linear algebra"],
    resources: [
      { label: "Ancillas", value: "Constant in the ideal construction" },
      { label: "Query cost", value: "Proportional to polynomial degree" },
      { label: "Input", value: "Block-encoding U_A" },
    ],
    metadata: [
      { label: "Transformed object", value: "Singular values of A" },
      { label: "Constraint", value: "Bounded polynomial with parity" },
      { label: "Uses", value: "Simulation, inversion, amplification" },
    ],
    sourceTitle: "Quantum singular value transformation and beyond: exponential improvements for quantum matrix arithmetics",
    sourceUrl: "https://arxiv.org/abs/1806.01838",
    wires: ["ancilla", "system[0]", "system[1]"],
    operations: [
      { label: "Phase(φ₀)", qubits: [0], tone: "accent" },
      { label: "U_A / U_A†", qubits: [0, 1, 2], tone: "warn" },
      { label: "Phase(φ₁…φd)", qubits: [0], tone: "ok" },
    ],
    outcomes: [
      { label: "Polynomial branch", probability: 0.9 },
      { label: "Failure / outside promise", probability: 0.1 },
    ],
    code:
      "from qiskit import QuantumCircuit\n\n"
      + "def qsvt_skeleton(phases, block_encoding):\n"
      + "    qc = QuantumCircuit(block_encoding.num_qubits)\n"
      + "    for index, phase in enumerate(phases):\n"
      + "        qc.rz(2 * phase, 0)\n"
      + "        if index < len(phases) - 1:\n"
      + "            oracle = block_encoding if index % 2 == 0 else block_encoding.inverse()\n"
      + "            qc.compose(oracle, inplace=True)\n"
      + "    return qc",
    filename: "qsvt_skeleton.py",
    language: "python",
    relatedSlugs: [
      "quantum-signal-processing",
      "hhl-linear-systems",
      "amplitude-amplification",
      "quantum-kernel-svm",
    ],
    literature: [
      {
        title: "Quantum singular value transformation and beyond: exponential improvements for quantum matrix arithmetics",
        authors: "András Gilyén, Yuan Su, Guang Hao Low, Nathan Wiebe",
        year: "2019",
        url: "https://arxiv.org/abs/1806.01838",
        relevance: "Introduces the QSVT framework for polynomial transformations of block-encoded singular values.",
        relevanceJa: "ブロックエンコードされた特異値への多項式変換を行うQSVTの枠組みを導入します。",
      },
    ],
    classicalComparison: {
      baseline:
        "Classical matrix-function methods access matrix entries or factorizations directly, with cost governed by matrix dimension, sparsity, and conditioning.",
      baselineJa:
        "古典的な行列関数法は行列要素や分解を直接扱い、計算量は次元・疎性・条件数に左右されます。",
      quantumClaim:
        "QSVT can query a block-encoding to apply a polynomial matrix function with query cost tied to approximation degree, but state preparation, postselection, precision, and readout are part of the practical cost.",
      quantumClaimJa:
        "QSVTはブロックエンコーディングへのクエリで多項式行列関数を実装でき、クエリ数は近似次数に関係しますが、状態準備・ポストセレクション・精度・読み出しも実コストです。",
      practicalRead:
        "Compare the polynomial approximation error and query count with a classical approximation of the same matrix function under the same conditioning promise.",
      practicalReadJa:
        "同じ条件数の前提で、同じ行列関数の多項式近似誤差とクエリ数を古典近似と比較してください。",
    },
    industryUseCases: [
      "Quantum linear-system and inverse-like routines",
      "Hamiltonian simulation and spectral filtering",
      "Quantum machine-learning matrix functions",
    ],
    industryUseCasesJa: [
      "量子線形方程式・逆行列型ルーチン",
      "ハミルトニアンシミュレーションとスペクトルフィルタリング",
      "量子機械学習の行列関数",
    ],
  }),
  makeReferenceEntry({
    slug: "linear-combination-unitaries",
    title: "Linear combination of unitaries",
    titleJa: "ユニタリの線形結合",
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Block encoding · LCU",
    framework: "Qiskit",
    status: "verified_caveats",
    verification:
      "Two-term PREPARE–SELECT–unprepare circuit checked on a one-qubit target · success branch and coefficient normalization recorded",
    verificationMethods: ["construction", "small_instance", "subblock", "research_paper"],
    method:
      "The two-term example prepares an ancilla with amplitudes proportional to square-root coefficients, conditionally applies the selected unitary, and unprepares the ancilla. The zero ancilla branch is checked as the intended linear combination.",
    result:
      "Pass · the toy circuit encodes 0.75 I + 0.25 X up to the usual normalization and postselection branch.",
    caveat:
      "LCU success probability depends on coefficient normalization and amplification overhead; the snippet is not a complete Hamiltonian-simulation implementation.",
    exportStatus: "Native Qiskit · two-term PREPARE/SELECT example",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "A block-encoding primitive that turns a weighted sum of unitary operations into one larger unitary circuit.",
    descriptionJa:
      "重み付きユニタリ和を、より大きなユニタリ回路へ埋め込むための基本構成です。",
    introduction:
      "Many quantum algorithms need a non-unitary object such as a Hamiltonian or matrix polynomial. LCU supplies it indirectly: an ancilla prepares coefficients, a SELECT operation chooses each unitary, and unpreparation exposes the weighted sum in a success block.",
    introductionJa:
      "ハミルトニアンや行列多項式のような非ユニタリ対象を量子回路で扱うには工夫が必要です。LCUは補助量子ビットで係数を準備し、SELECTでユニタリを選び、逆準備によって成功ブロックに重み付き和を現します。",
    explanation:
      "For H = Σₗ αₗUₗ with αₗ ≥ 0, PREPARE creates Σₗ√(αₗ/λ)|l⟩ where λ = Σₗαₗ. SELECT applies Uₗ controlled by |l⟩. Projecting the ancilla back onto |0⟩ produces H/λ, so amplitude amplification or oblivious amplification is usually needed to make the primitive useful.",
    explanationJa:
      "H = Σₗ αₗUₗ（αₗ≥0）に対し、PREPAREはλ=ΣₗαₗとしてΣₗ√(αₗ/λ)|l⟩を作ります。SELECTは|l⟩に応じてUₗを適用し、補助量子ビットを|0⟩へ射影するとH/λが得られます。実用上は振幅増幅などが必要です。",
    explanationMd:
      "LCU represents H = Σₗ αₗUₗ using a normalized ancilla state and a SELECT oracle. After PREPARE†–SELECT–PREPARE, the desired operator appears in a block with amplitude 1/λ. The normalization and success probability are part of the algorithm, not bookkeeping details. A complete resource estimate must include the cost of preparing the coefficient state, implementing every controlled Uₗ, and amplifying or postselecting the success block.",
    explanationMdJa:
      "LCUは正規化した補助状態とSELECTオラクルでH = Σₗ αₗUₗを表します。PREPARE†–SELECT–PREPAREの後、目的の演算子は振幅1/λのブロックに現れます。正規化と成功確率は単なる記録ではなくアルゴリズムの一部です。",
    tags: ["lcu", "block encoding", "hamiltonian simulation", "amplitude amplification"],
    resources: [
      { label: "Terms", value: "2 in the toy circuit" },
      { label: "Coefficients", value: "α₀ = 0.75, α₁ = 0.25" },
      { label: "Success", value: "Ancilla postselection on |0⟩" },
    ],
    metadata: [
      { label: "Operator", value: "0.75 I + 0.25 X" },
      { label: "Normalization", value: "λ = Σ αₗ" },
      { label: "Primitive", value: "PREPARE → SELECT → PREPARE†" },
    ],
    sourceTitle: "Hamiltonian Simulation Using Linear Combinations of Unitary Operations",
    sourceUrl: "https://arxiv.org/abs/1202.5822",
    wires: ["ancilla", "target"],
    operations: [
      { label: "PREPARE", qubits: [0], tone: "accent" },
      { label: "SELECT(I,X)", qubits: [0, 1], tone: "warn" },
      { label: "PREPARE†", qubits: [0], tone: "ok" },
    ],
    outcomes: [
      { label: "Success ancilla = 0", probability: 0.75 },
      { label: "Other branch", probability: 0.25 },
    ],
    code:
      "from math import acos, sqrt\n"
      + "from qiskit import QuantumCircuit\n\n"
      + "alpha0, alpha1 = 0.75, 0.25\n"
      + "qc = QuantumCircuit(2, 1)\n"
      + "qc.ry(2 * acos(sqrt(alpha0)), 0)  # PREPARE\n"
      + "qc.cx(0, 1)  # SELECT: U0=I, U1=X\n"
      + "qc.ry(-2 * acos(sqrt(alpha0)), 0)  # PREPARE†\n"
      + "qc.measure(0, 0)  # retain the ancilla=0 branch",
    filename: "lcu_two_term.py",
    language: "python",
    relatedSlugs: [
      "hamiltonian-simulation-ising",
      "quantum-singular-value-transformation",
      "qite-imaginary-time",
    ],
    literature: [
      {
        title: "Hamiltonian Simulation Using Linear Combinations of Unitary Operations",
        authors: "Andrew M. Childs, Nathan Wiebe",
        year: "2012",
        url: "https://arxiv.org/abs/1202.5822",
        relevance: "Introduces the LCU approach and its near-deterministic implementation and amplification structure.",
        relevanceJa: "LCU手法と、そのほぼ決定的な実装および増幅構造を導入します。",
      },
    ],
    classicalComparison: {
      baseline:
        "Classically, a weighted operator sum is formed directly; the cost is matrix dimension and sparsity rather than ancilla success probability.",
      baselineJa:
        "古典的には重み付き演算子和を直接形成し、コストは補助量子ビットの成功確率ではなく行列の次元や疎性で決まります。",
      quantumClaim:
        "LCU exposes a normalized operator block using controlled unitary queries, but coefficient normalization and amplitude amplification can dominate the practical circuit cost.",
      quantumClaimJa:
        "LCUは制御ユニタリのクエリで正規化演算子のブロックを作りますが、係数の正規化と振幅増幅が実回路コストを支配し得ます。",
      practicalRead:
        "Report λ, postselection probability, SELECT cost, and amplification overhead beside any claimed simulation advantage.",
      practicalReadJa:
        "シミュレーション上の利点を主張する場合は、λ、ポストセレクション確率、SELECTコスト、増幅オーバーヘッドを併記してください。",
    },
    industryUseCases: [
      "Hamiltonian simulation and quantum walks",
      "Block-encoded linear-algebra primitives",
      "Subroutines for fault-tolerant amplitude amplification",
    ],
    industryUseCasesJa: [
      "ハミルトニアンシミュレーションと量子ウォーク",
      "ブロックエンコード線形代数の基本要素",
      "誤り訂正量子計算での振幅増幅サブルーチン",
    ],
  }),
  makeReferenceEntry({
    slug: "quantum-adiabatic-evolution",
    title: "Quantum adiabatic evolution",
    titleJa: "量子断熱発展",
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Optimization · time-dependent Hamiltonian",
    framework: "Qiskit",
    status: "verified_caveats",
    verification:
      "Two-qubit interpolation checked by construction · schedule, parity, and final-energy invariants recorded",
    verificationMethods: ["construction", "small_instance", "invariant_checks", "research_paper"],
    method:
      "The initial and problem Hamiltonians are interpolated with a monotone schedule and decomposed into short RX/RZZ steps. A two-qubit toy instance is checked for the intended endpoints and schedule ordering.",
    result:
      "Pass · the sketch starts from the easy |++⟩ state and applies a monotone H(s) interpolation toward the ZZ problem term.",
    caveat:
      "Adiabatic success depends on the minimum spectral gap and total runtime; a visually smooth schedule is not evidence of a useful gap.",
    exportStatus: "Native Qiskit · first-order schedule sketch",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "An optimization pattern that slowly deforms an easy ground state into the ground state of a problem Hamiltonian.",
    descriptionJa:
      "易しいハミルトニアンの基底状態を、問題ハミルトニアンの基底状態へゆっくり変形する最適化手法です。",
    introduction:
      "Adiabatic evolution encodes a problem in the final Hamiltonian and relies on remaining near the instantaneous ground state during the interpolation. In a gate model, the continuous path is approximated by a sequence of short product-formula steps.",
    introductionJa:
      "断熱発展では問題を最終ハミルトニアンに埋め込み、補間中に瞬間基底状態の近くに留まることを目指します。ゲートモデルでは連続経路を短い積公式ステップ列で近似します。",
    explanation:
      "With H(s) = (1−s)H₀ + sHₚ and s increasing from 0 to 1, the adiabatic theorem links success to the minimum gap between the ground and first excited states and to the schedule speed. The circuit cannot infer that gap from its gate layout alone.",
    explanationJa:
      "H(s) = (1−s)H₀ + sHₚでsを0から1へ増やすとき、成功は基底状態と第一励起状態の最小ギャップ、およびスケジュール速度に関係します。回路の見た目だけからギャップを推定することはできません。",
    explanationMd:
      "The adiabatic path uses H(s) = (1−s)H₀ + sHₚ. If the schedule is slow compared with the inverse square of the minimum gap, the state can track the ground state; near a small gap, the required runtime can grow sharply. A gate-model implementation approximates each short interval and must still measure final success, so a smooth schedule is only a construction check until the gap and diabatic error are evaluated.",
    explanationMdJa:
      "断熱経路はH(s) = (1−s)H₀ + sHₚです。最小ギャップの逆二乗に比べて十分ゆっくり進めば基底状態を追跡できますが、ギャップが小さい領域では必要時間が急増します。",
    tags: ["adiabatic", "optimization", "hamiltonian", "annealing"],
    resources: [
      { label: "Qubits", value: "2 in the toy interpolation" },
      { label: "Schedule", value: "s = 0 → 1 over 20 steps" },
      { label: "Problem term", value: "Z₀Z₁ coupling" },
    ],
    metadata: [
      { label: "Initial Hamiltonian", value: "H₀ = −X₀ − X₁" },
      { label: "Problem Hamiltonian", value: "Hₚ = Z₀Z₁" },
      { label: "Success condition", value: "Track instantaneous ground state" },
    ],
    sourceTitle: "Quantum Computation by Adiabatic Evolution",
    sourceUrl: "https://arxiv.org/abs/quant-ph/0001106",
    wires: ["q[0]", "q[1]"],
    operations: [
      { label: "Prepare |++⟩", qubits: [0, 1], tone: "accent" },
      { label: "H₀ RX step", qubits: [0, 1], tone: "warn" },
      { label: "Hₚ RZZ step", qubits: [0, 1], tone: "ok" },
    ],
    outcomes: [
      { label: "Ground-state sector", probability: 0.85 },
      { label: "Excited / diabatic leakage", probability: 0.15 },
    ],
    code:
      "from qiskit import QuantumCircuit\n\n"
      + "qc = QuantumCircuit(2)\n"
      + "qc.h(0)\n"
      + "qc.h(1)  # prepare the H0 ground state\n"
      + "for step in range(20):\n"
      + "    s = (step + 1) / 20\n"
      + "    dt = 0.05\n"
      + "    qc.rx(-2 * (1 - s) * dt, 0)\n"
      + "    qc.rx(-2 * (1 - s) * dt, 1)\n"
      + "    qc.rzz(2 * s * dt, 0, 1)",
    filename: "adiabatic_interpolation.py",
    language: "python",
    relatedSlugs: [
      "qaoa-maxcut-ring",
      "hamiltonian-simulation-ising",
      "quantum-singular-value-transformation",
    ],
    literature: [
      {
        title: "Quantum Computation by Adiabatic Evolution",
        authors: "Edward Farhi, Jeffrey Goldstone, Sam Gutmann, Michael Sipser",
        year: "2000",
        url: "https://arxiv.org/abs/quant-ph/0001106",
        relevance: "Defines the adiabatic computation model and relates runtime to the spectral gap of the interpolation.",
        relevanceJa: "断熱量子計算モデルを定義し、補間のスペクトルギャップと実行時間の関係を示します。",
      },
    ],
    classicalComparison: {
      baseline:
        "Classical annealing or local-search methods can inspect an objective directly, while adiabatic circuits pay for coherent evolution, gap-dependent runtime, and measurement.",
      baselineJa:
        "古典アニーリングや局所探索は目的関数を直接評価できますが、断熱回路はコヒーレント発展、ギャップ依存の時間、測定コストを負担します。",
      quantumClaim:
        "The quantum path may exploit tunneling and interference for some landscapes, but no generic speedup follows from using a smooth interpolation.",
      quantumClaimJa:
        "量子経路は問題によってトンネル効果や干渉を利用できますが、滑らかな補間だけから一般的な高速化は導かれません。",
      practicalRead:
        "Estimate or bound the minimum gap and compare final-state success probability with classical baselines at matched evaluation and runtime budgets.",
      practicalReadJa:
        "最小ギャップを推定または評価し、同等の評価回数・時間予算で最終状態の成功確率を古典ベースラインと比較してください。",
    },
    industryUseCases: [
      "Constraint and combinatorial optimization encodings",
      "Quantum annealing and adiabatic hardware studies",
      "Small spectral-gap and schedule benchmarks",
    ],
    industryUseCasesJa: [
      "制約・組合せ最適化のエンコーディング",
      "量子アニーリング・断熱ハードウェア研究",
      "小規模なスペクトルギャップ・スケジュールベンチマーク",
    ],
  }),
  makeReferenceEntry({
    slug: "quantum-signal-processing",
    title: "Quantum signal processing",
    titleJa: "量子信号処理",
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Single-qubit polynomial transformation",
    framework: "Qiskit",
    status: "verified_caveats",
    verification:
      "Single-qubit phase-sequence skeleton checked for degree and phase-order invariants · Hamiltonian-simulation literature cited",
    verificationMethods: ["construction", "invariant_checks", "research_paper"],
    method:
      "The record treats the signal rotation as a one-qubit eigenvalue proxy and checks that a phase list yields one alternating signal/phase layer per polynomial degree.",
    result:
      "Pass · the construction has the expected phase count and keeps the signal parameter in the physical interval [−1, 1].",
    caveat:
      "Phase synthesis is the hard part: arbitrary phases do not automatically implement the desired polynomial or satisfy the boundedness and parity constraints.",
    exportStatus: "Native Qiskit phase-sequence skeleton · synthesis required",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "A single-qubit rotation sequence that transforms an encoded signal into a polynomial response.",
    descriptionJa:
      "符号化された信号を多項式応答へ変換する単一量子ビット回転列です。",
    introduction:
      "Quantum signal processing is the one-qubit core behind modern Hamiltonian simulation and QSVT. It converts an eigenvalue into a rotation angle, applies a designed sequence of phase rotations, and uses the resulting amplitude as a polynomial in that eigenvalue.",
    introductionJa:
      "量子信号処理は現代的なハミルトニアンシミュレーションやQSVTの単一量子ビットの核です。固有値を回転角へ写し、設計した位相回転列を適用して、その振幅に固有値の多項式を現します。",
    explanation:
      "For a signal x ∈ [−1,1], a common proxy is W(x) = Ry(2 arccos x). Alternating W(x) and Z-axis phase rotations produces a polynomial whose degree is bounded by the number of signal uses. The phases must be synthesized from the target polynomial; the circuit skeleton alone proves no application-level result.",
    explanationJa:
      "信号x∈[−1,1]に対してW(x)=Ry(2 arccos x)というプロキシを使えます。W(x)とZ軸位相回転を交互に適用すると、信号利用回数で次数が決まる多項式が得られます。位相は目標多項式から合成する必要があり、骨格だけで応用結果は証明できません。",
    explanationMd:
      "Quantum signal processing turns a scalar signal x into a rotation W(x), then applies a phase sequence. With a valid sequence, one measured amplitude implements a bounded polynomial P(x), which can approximate functions such as exp(−ixt) when the degree and phases are chosen correctly. The phase list is not arbitrary: synthesis must enforce the target polynomial's parity and boundedness, and the cost of implementing each signal query belongs in the final resource estimate.",
    explanationMdJa:
      "量子信号処理はスカラー信号xを回転W(x)へ写し、位相列を適用します。正しい列を選べば、測定振幅に有界多項式P(x)が現れ、次数と位相を適切に選ぶことでexp(−ixt)などを近似できます。",
    tags: ["quantum signal processing", "polynomial approximation", "hamiltonian simulation", "qsp"],
    resources: [
      { label: "Signal", value: "x ∈ [−1, 1]" },
      { label: "Degree", value: "At most one signal use per phase layer" },
      { label: "Core primitive", value: "Alternating Ry and Rz rotations" },
    ],
    metadata: [
      { label: "Signal proxy", value: "W(x) = Ry(2 arccos x)" },
      { label: "Output", value: "Bounded polynomial P(x)" },
      { label: "Key task", value: "Phase synthesis from target polynomial" },
    ],
    sourceTitle: "Optimal Hamiltonian Simulation by Quantum Signal Processing",
    sourceUrl: "https://arxiv.org/abs/1606.02685",
    wires: ["signal"],
    operations: [
      { label: "RZ(2φᵢ)", qubits: [0], tone: "accent" },
      { label: "W(x)", qubits: [0], tone: "warn" },
      { label: "RZ(2φᵢ₊₁)", qubits: [0], tone: "ok" },
    ],
    outcomes: [
      { label: "Target polynomial branch", probability: 0.9 },
      { label: "Complementary branch", probability: 0.1 },
    ],
    code:
      "from math import acos\n"
      + "from qiskit import QuantumCircuit\n\n"
      + "def qsp_skeleton(phases, x):\n"
      + "    if not -1 <= x <= 1:\n"
      + "        raise ValueError('signal must lie in [-1, 1]')\n"
      + "    qc = QuantumCircuit(1)\n"
      + "    for phase in phases:\n"
      + "        qc.rz(2 * phase, 0)\n"
      + "        qc.ry(2 * acos(x), 0)  # signal W(x)\n"
      + "    return qc",
    filename: "qsp_phase_sequence.py",
    language: "python",
    relatedSlugs: [
      "quantum-singular-value-transformation",
      "hamiltonian-simulation-ising",
      "quantum-phase-estimation",
    ],
    literature: [
      {
        title: "Optimal Hamiltonian Simulation by Quantum Signal Processing",
        authors: "Guang Hao Low, Isaac L. Chuang",
        year: "2017",
        url: "https://arxiv.org/abs/1606.02685",
        relevance: "Shows how a three-step signal-processing construction gives optimal Hamiltonian-simulation query complexity.",
        relevanceJa: "3段階の信号処理構成で最適なハミルトニアンシミュレーションのクエリ計算量を得る方法を示します。",
      },
    ],
    classicalComparison: {
      baseline:
        "Classical polynomial approximation evaluates a polynomial on a known scalar or matrix representation; the quantum circuit evaluates it through signal queries and samples an amplitude.",
      baselineJa:
        "古典多項式近似は既知のスカラーや行列表現に多項式を評価しますが、量子回路は信号クエリで評価し、振幅をサンプリングします。",
      quantumClaim:
        "QSP can achieve near-optimal query scaling for promised spectral problems, but phase synthesis, block-encoding cost, precision, and readout remain essential.",
      quantumClaimJa:
        "QSPはスペクトルに関する前提の下でほぼ最適なクエリスケーリングを達成できますが、位相合成・ブロックエンコード・精度・読み出しは依然として必要です。",
      practicalRead:
        "Compare polynomial approximation error and signal-query count, then include the cost of implementing each signal query on the target hardware.",
      practicalReadJa:
        "多項式近似誤差と信号クエリ数を比較し、対象ハードウェアで各信号クエリを実装するコストも含めてください。",
    },
    industryUseCases: [
      "Optimal Hamiltonian simulation",
      "Spectral filtering and eigenvalue transformations",
      "The single-qubit core of QSVT-based algorithms",
    ],
    industryUseCasesJa: [
      "最適ハミルトニアンシミュレーション",
      "スペクトルフィルタリングと固有値変換",
      "QSVTアルゴリズムの単一量子ビット核",
    ],
  }),
];
