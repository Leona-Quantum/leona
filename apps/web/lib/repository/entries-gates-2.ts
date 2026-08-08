import type { PublicRepositoryEntry } from "./types";
import { makeReferenceEntry } from "./factory";

// Second gate-catalog batch (2026-07-17 Owner Inbox: 10 more gate records,
// several with the new `decomposition` field for the gates-browser
// expand/collapse toggle). Entries use makeReferenceEntry from ./factory;
// scripts/check-repository-data.mjs validates every record.

const NIELSEN_CHUANG = {
  title: "Quantum Computation and Quantum Information: 10th Anniversary Edition",
  authors: "Michael A. Nielsen and Isaac L. Chuang",
  year: "2010",
  url: "https://doi.org/10.1017/cbo9780511976667",
  relevance: "Standard reference for gate matrices, the Clifford/non-Clifford distinction, and controlled-gate constructions used throughout this record.",
  relevanceJa: "ゲート行列、クリフォード／非クリフォードの区別、制御ゲートの構成に関する標準的な参考文献です。",
};

const OPENQASM3_PAPER = {
  title: "OpenQASM 3: A broader and deeper quantum assembly language",
  authors: "Andrew W. Cross, Ali Javadi-Abhari, Thomas Alexander, Niel de Beaudrap, Lev S. Bishop, Steven Heidel, Colm A. Ryan, Prasahnt Sivarajah, John Smolin, Jay M. Gambetta, Blake R. Johnson",
  year: "2021",
  url: "https://arxiv.org/abs/2104.14722",
  relevance: "Defines the standard gate library (id, sdg, tdg, cy, crz, rxx, rzz, ccx, cx…) used natively by the code snippets on this record.",
  relevanceJa: "この項目のコードで使うid・sdg・tdg・cy・crz・rxx・rzz・ccx・cxなどの標準ゲートライブラリを定義します。",
};

const MCKAY_2017 = {
  title: "Efficient Z-Gates for Quantum Computing",
  authors: "David C. McKay, Christopher J. Wood, Sarah Sheldon, Jerry M. Chow, Jay M. Gambetta",
  year: "2016",
  url: "https://arxiv.org/abs/1612.00858",
  relevance: "Establishes the virtual-Z / calibrated-pulse framework that IBM's native two-qubit gates, including the cross-resonance family, are compiled within.",
  relevanceJa: "IBMのネイティブ2量子ビットゲート（クロス共鳴系列を含む）がその中でコンパイルされる、仮想Z・較正済みパルスの枠組みを確立します。",
};

const SHELDON_2016 = {
  title: "Procedure for systematically tuning up crosstalk in the cross resonance gate",
  authors: "Sarah Sheldon, Easwar Magesan, Jerry M. Chow, Jay M. Gambetta",
  year: "2016",
  url: "https://arxiv.org/abs/1603.04821",
  relevance: "Introduces the echoed cross-resonance pulse sequence RZX(π/4)–X–RZX(−π/4) that the ECR gate implements, canceling unwanted interaction terms via the X echo.",
  relevanceJa: "望まない相互作用項をXエコーで打ち消す、ECRゲートが実装するエコー付きクロス共鳴パルス列RZX(π/4)–X–RZX(−π/4)を導入します。",
};

export const GATE_ENTRIES_2: PublicRepositoryEntry[] = [
  makeReferenceEntry({
    slug: "identity-gate",
    title: "Identity (I) gate",
    titleJa: "恒等（I）ゲート",
    category: "gates",
    categoryLabel: "Gates",
    categoryLabelJa: "ゲート",
    algorithmFamily: "Single-qubit gate",
    framework: "OpenQASM 3.0",
    verificationMethods: ["unitary_equivalence", "direct_math", "textbook_citation"],
    verification: "Direct matrix check · I leaves every state vector unchanged",
    method: "Multiply the 2×2 identity matrix against arbitrary computational-basis and superposition state vectors and confirm the output equals the input exactly.",
    result: "Pass · I|ψ⟩ = |ψ⟩ for every tested |ψ⟩, and I is exactly the 2×2 identity matrix by inspection.",
    exportStatus: "Native OpenQASM 3 · direct framework snippets available",
    provenance: "Curated reference",
    updatedAt: "2026-07-17",
    description:
      "The single-qubit no-op gate that leaves every state exactly unchanged, used as a placeholder in circuit diagrams, a timing/idle slot on real hardware, and the base case for gate-composition identities.",
    descriptionJa: "あらゆる状態をそのまま変えない単一量子ビットの無操作ゲートで、回路図のプレースホルダー、実機での待機（アイドル）スロット、ゲート合成の恒等式の基底ケースとして使われます。",
    introduction:
      "I rarely appears as an algorithmic step, but it matters as the formal identity element of the single-qubit unitary group: every gate-composition identity in this catalog (e.g. S·S† = I, X² = I) is stated relative to it.",
    introductionJa: "Iがアルゴリズム上のステップとして現れることは稀ですが、単一量子ビットユニタリ群の形式的な単位元として重要です。このカタログのすべてのゲート合成恒等式（例: S·S† = I、X² = I）はIを基準に述べられます。",
    explanation:
      "I = diag(1,1) fixes both basis states exactly. On idling hardware qubits, a scheduled identity (or explicit delay) is often inserted to keep circuit timing uniform across parallel wires, since real qubits decohere even while doing 'nothing'.",
    explanationJa: "I = diag(1,1) は両方の基底状態を厳密に固定します。アイドル状態の実機量子ビットでは、並列な配線間で回路のタイミングを揃えるために、スケジュールされた恒等操作（または明示的な遅延）が挿入されることがよくあります。実機の量子ビットは「何もしない」間もデコヒーレンスするためです。",
    explanationMd: `## Definition

$$
I = \\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}
$$

$I$ is the $2\\times 2$ identity matrix: the unique unitary that acts trivially on every state, and the identity element of $U(2)$ under matrix multiplication.

## Action on basis states

$$
I|0\\rangle = |0\\rangle, \\qquad I|1\\rangle = |1\\rangle
$$

and by linearity $I(\\alpha|0\\rangle+\\beta|1\\rangle) = \\alpha|0\\rangle+\\beta|1\\rangle$ for any superposition — no amplitude or phase is touched.

## Key identities

- $I$ is the identity element for gate composition: $UI = IU = U$ for every single-qubit unitary $U$.
- Every involutory gate in this catalog squares to $I$: $X^2=Y^2=Z^2=H^2=I$, and every phase-ladder gate returns to $I$ after enough applications: $S^4=I$, $T^8=I$.
- $I = R_Z(0) = P(0)$: the identity is the $\\theta=0$ (or $\\lambda=0$) special case of every parametrized rotation and phase gate in this catalog.
- On real hardware, an explicit identity or delay instruction is used to pad circuit depth for timing alignment; unlike a mathematical no-op, it still accumulates decoherence, which is why idle qubits are a genuine error source in circuit scheduling.`,
    explanationMdJa: `## 定義

$$
I = \\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}
$$

$I$は$2\\times 2$の恒等行列です。あらゆる状態に自明に作用する唯一のユニタリであり、行列の乗法に関する$U(2)$の単位元です。

## 基底状態への作用

$$
I|0\\rangle = |0\\rangle, \\qquad I|1\\rangle = |1\\rangle
$$

線形性により、任意の重ね合わせ$\\alpha|0\\rangle+\\beta|1\\rangle$に対しても$I(\\alpha|0\\rangle+\\beta|1\\rangle) = \\alpha|0\\rangle+\\beta|1\\rangle$となり、振幅も位相もまったく変化しません。

## 主要な恒等式

- $I$はゲート合成の単位元です: 任意の単一量子ビットユニタリ$U$について$UI = IU = U$。
- このカタログの対合的なゲートはすべて2乗するとIになります: $X^2=Y^2=Z^2=H^2=I$。位相ラダーゲートも十分な回数の適用でIに戻ります: $S^4=I$、$T^8=I$。
- $I = R_Z(0) = P(0)$: 恒等ゲートは、このカタログのすべてのパラメータ化された回転・位相ゲートの$\\theta=0$（または$\\lambda=0$）の特殊な場合です。
- 実機では、タイミング調整のために明示的な恒等または遅延命令が回路の深さを埋めるために使われます。数学的な無操作と異なり、実機ではそれでもデコヒーレンスが蓄積するため、アイドル量子ビットは回路スケジューリングにおける実際のエラー源です。`,
    tags: ["identity", "single qubit", "clifford", "no-op"],
    resources: [
      { label: "Qubits", value: "1" },
      { label: "Depth", value: "1 gate (0-duration no-op semantically)" },
      { label: "Parameter", value: "none" },
    ],
    metadata: [
      { label: "Matrix", value: "diag(1, 1)" },
      { label: "Role", value: "Identity element of U(2)" },
      { label: "Special case of", value: "RZ(0), P(0)" },
      { label: "Gate family", value: "Clifford (and Pauli)" },
    ],
    sourceTitle: "OpenQASM 3 standard gate set",
    sourceUrl: "https://openqasm.com/language/gates.html",
    wires: ["q[0]"],
    operations: [{ label: "I", qubits: [0], tone: "neutral" }],
    outcomes: [
      { label: "P(|0⟩) unchanged", probability: 1 },
      { label: "P(|1⟩) unchanged", probability: 0 },
    ],
    code: `OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit q;\nid q;`,
    filename: "identity.qasm",
    language: "openqasm",
    extraVariants: [
      {
        framework: "Qiskit",
        status: "native",
        language: "python",
        filename: "identity.py",
        code: `from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(1)\nqc.id(0)\n\nFINAL_CIRCUIT = qc`,
      },
      {
        framework: "Cirq",
        status: "native",
        language: "python",
        filename: "identity.py",
        code: `import cirq\n\nq = cirq.LineQubit(0)\ncircuit = cirq.Circuit(cirq.I(q))\n\nFINAL_CIRCUIT = circuit`,
      },
    ],
    relatedSlugs: ["pauli-x-operator", "rz-rotation-gate", "phase-gate-p", "hadamard-gate"],
    literature: [NIELSEN_CHUANG, OPENQASM3_PAPER],
  }),

  makeReferenceEntry({
    slug: "s-dagger-gate",
    title: "S† (inverse phase) gate",
    titleJa: "S†（逆位相）ゲート",
    category: "gates",
    categoryLabel: "Gates",
    categoryLabelJa: "ゲート",
    algorithmFamily: "Phase gate",
    framework: "OpenQASM 3.0",
    verificationMethods: ["unitary_equivalence", "direct_math", "textbook_citation"],
    verification: "Direct matrix check · S† matches diag(1,-i) and S·S† = I",
    method: "Compare the S† matrix against diag(1,-i) and multiply it by the S matrix to confirm the product is the identity.",
    result: "Pass · S† = diag(1,-i) exactly, and S·S† = S†·S = I.",
    exportStatus: "Native OpenQASM 3 · direct framework snippets available",
    provenance: "Curated reference",
    updatedAt: "2026-07-17",
    description:
      "The Hermitian conjugate (and inverse) of the S gate, applying a -π/2 phase to |1⟩ and undoing whatever an S gate did earlier in a circuit.",
    descriptionJa: "Sゲートのエルミート共役（かつ逆演算）で、|1⟩に-π/2の位相を適用し、回路の前段で適用されたSゲートを打ち消します。",
    introduction:
      "S† exists in this catalog for the same reason T† does: real circuits need to undo a Clifford phase gate exactly, and S† is the closed-form inverse rather than something re-derived from S every time.",
    introductionJa: "S†がこのカタログに存在する理由はT†と同じです。実際の回路はクリフォード位相ゲートを厳密に打ち消す必要があり、S†は毎回Sから再導出するのではなく閉形式の逆演算です。",
    explanation:
      "S† = diag(1,-i) leaves |0⟩ fixed and multiplies |1⟩ by -i, the complex conjugate of S's +i phase. Because S and S† are both diagonal, they commute with each other and with RZ and P at any angle.",
    explanationJa: "S† = diag(1,-i) は|0⟩をそのままにし、|1⟩に-iを掛けます。これはSの+i位相の複素共役です。SとS†はどちらも対角なので互いに可換であり、任意の角度のRZやPとも可換です。",
    explanationMd: `## Definition

$$
S^\\dagger = \\begin{pmatrix} 1 & 0 \\\\ 0 & -i \\end{pmatrix}
$$

$S^\\dagger$ is the conjugate transpose of $S = \\mathrm{diag}(1,i)$, and since $S$ is unitary, $S^\\dagger$ is also its inverse: $SS^\\dagger = S^\\dagger S = I$.

## Action on basis states

$$
S^\\dagger|0\\rangle = |0\\rangle, \\qquad S^\\dagger|1\\rangle = -i|1\\rangle
$$

Applied to $|+\\rangle = \\tfrac{1}{\\sqrt2}(|0\\rangle+|1\\rangle)$, it produces $\\tfrac{1}{\\sqrt2}(|0\\rangle - i|1\\rangle) = |{-i}\\rangle$, the state at $-\\pi/2$ on the Bloch-sphere equator, mirroring how $S|+\\rangle = |i\\rangle$ lands at $+\\pi/2$.

## Key identities

- $S^\\dagger = P(-\\pi/2) = R_Z(-\\pi/2)$ up to global phase, so $S^\\dagger$ is the $\\lambda=-\\pi/2$ special case of the general phase gate, symmetric with $S=P(\\pi/2)$.
- $S^\\dagger = S^3$ since $S^4=I$: three applications of $S$ equal one $S^\\dagger$, useful when a compiler's native gate set only exposes $S$.
- $S^\\dagger \\cdot T^2 = I$ because $T^2=S$, so $S^\\dagger$ and two $T$ gates cancel exactly.
- Like $S$, $S^\\dagger$ is Clifford: conjugating a Pauli operator by $S^\\dagger$ returns a Pauli operator, e.g. $S^\\dagger X S = -Y$.`,
    explanationMdJa: `## 定義

$$
S^\\dagger = \\begin{pmatrix} 1 & 0 \\\\ 0 & -i \\end{pmatrix}
$$

$S^\\dagger$は$S = \\mathrm{diag}(1,i)$の複素共役転置であり、$S$がユニタリなので$S^\\dagger$はその逆演算でもあります: $SS^\\dagger = S^\\dagger S = I$。

## 基底状態への作用

$$
S^\\dagger|0\\rangle = |0\\rangle, \\qquad S^\\dagger|1\\rangle = -i|1\\rangle
$$

$|+\\rangle = \\tfrac{1}{\\sqrt2}(|0\\rangle+|1\\rangle)$に適用すると、$\\tfrac{1}{\\sqrt2}(|0\\rangle - i|1\\rangle) = |{-i}\\rangle$が得られます。これはブロッホ球の赤道上で$-\\pi/2$の位置にある状態で、$S|+\\rangle = |i\\rangle$が$+\\pi/2$に達するのと対称的です。

## 主要な恒等式

- $S^\\dagger = P(-\\pi/2) = R_Z(-\\pi/2)$（大域位相を除く）なので、$S^\\dagger$は一般的な位相ゲートの$\\lambda=-\\pi/2$の特殊な場合であり、$S=P(\\pi/2)$と対称です。
- $S^4=I$なので$S^\\dagger = S^3$です。コンパイラのネイティブゲート集合が$S$しか持たない場合、$S$を3回適用すれば$S^\\dagger$一回分になります。
- $T^2=S$なので$S^\\dagger \\cdot T^2 = I$、つまり$S^\\dagger$と2つの$T$ゲートは厳密に打ち消し合います。
- $S$と同様、$S^\\dagger$もクリフォードです。パウリ演算子を$S^\\dagger$で共役するとパウリ演算子に戻ります。例: $S^\\dagger X S = -Y$。`,
    tags: ["phase", "clifford", "single qubit", "inverse"],
    resources: [
      { label: "Qubits", value: "1" },
      { label: "Depth", value: "1 gate" },
      { label: "Parameter", value: "none (fixed -π/2 phase)" },
    ],
    metadata: [
      { label: "Matrix", value: "diag(1, -i)" },
      { label: "Inverse of", value: "S (S·S† = I)" },
      { label: "Special case", value: "S† = P(-π/2)" },
      { label: "Gate family", value: "Clifford" },
    ],
    sourceTitle: "OpenQASM 3 standard gate set",
    sourceUrl: "https://openqasm.com/language/gates.html",
    wires: ["q[0]"],
    operations: [{ label: "S†", qubits: [0], tone: "neutral" }],
    outcomes: [
      { label: "P(|0⟩) unchanged", probability: 1 },
      { label: "P(|1⟩) unchanged", probability: 0 },
    ],
    code: `OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit q;\nsdg q;`,
    filename: "s-dagger.qasm",
    language: "openqasm",
    extraVariants: [
      {
        framework: "Qiskit",
        status: "native",
        language: "python",
        filename: "s_dagger.py",
        code: `from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(1)\nqc.sdg(0)\n\nFINAL_CIRCUIT = qc`,
      },
      {
        framework: "Cirq",
        status: "native",
        language: "python",
        filename: "s_dagger.py",
        code: `import cirq\n\nq = cirq.LineQubit(0)\n# S ** -1 is the inverse (dagger) of the S gate\ncircuit = cirq.Circuit((cirq.S ** -1).on(q))\n\nFINAL_CIRCUIT = circuit`,
      },
    ],
    relatedSlugs: ["s-phase-gate", "rz-rotation-gate", "phase-gate-p", "t-dagger-gate"],
    literature: [NIELSEN_CHUANG, OPENQASM3_PAPER],
  }),

  makeReferenceEntry({
    slug: "t-dagger-gate",
    title: "T† gate",
    titleJa: "T†ゲート",
    category: "gates",
    categoryLabel: "Gates",
    categoryLabelJa: "ゲート",
    algorithmFamily: "Phase gate",
    framework: "OpenQASM 3.0",
    verificationMethods: ["unitary_equivalence", "direct_math", "textbook_citation"],
    verification: "Direct matrix check · T† matches diag(1, e^{-iπ/4}) and T·T† = I",
    method: "Compare the T† matrix against diag(1, e^{-iπ/4}) and multiply it by the T matrix to confirm the product is the identity.",
    result: "Pass · T† = diag(1, e^{-iπ/4}) exactly, and T·T† = T†·T = I.",
    exportStatus: "Native OpenQASM 3 · direct framework snippets available",
    provenance: "Curated reference",
    updatedAt: "2026-07-17",
    description:
      "The Hermitian conjugate (and inverse) of the non-Clifford T gate, applying a -π/4 phase to |1⟩ and appearing throughout fault-tolerant circuits as the T-count partner of T.",
    descriptionJa: "非クリフォードのTゲートのエルミート共役（かつ逆演算）で、|1⟩に-π/4の位相を適用し、フォールトトレラント回路全体でTのT数上の相方として現れます。",
    introduction:
      "T† matters because fault-tolerant compilers count T and T† together as the expensive resource (T-count): the Toffoli decomposition in this catalog, for instance, uses both 4 T and 3 T† gates, and each costs the same magic-state budget.",
    introductionJa: "T†が重要なのは、フォールトトレラントなコンパイラがTとT†をまとめて高コストな資源（T数）として数えるためです。例えばこのカタログのToffoli分解では4つのTと3つのT†を使いますが、それぞれ同じマジック状態の予算を消費します。",
    explanation:
      "T† = diag(1, e^{-iπ/4}) leaves |0⟩ fixed and multiplies |1⟩ by e^{-iπ/4}, the complex conjugate of T's +π/4 phase. Like T, it is non-Clifford, so it cannot be simulated efficiently by stabilizer methods and requires magic-state distillation in fault-tolerant hardware.",
    explanationJa: "T† = diag(1, e^{-iπ/4}) は|0⟩をそのままにし、|1⟩にe^{-iπ/4}を掛けます。これはTの+π/4位相の複素共役です。Tと同様に非クリフォードであるため、スタビライザー法で効率的にシミュレートできず、フォールトトレラントなハードウェアではマジック状態蒸留が必要です。",
    explanationMd: `## Definition

$$
T^\\dagger = \\begin{pmatrix} 1 & 0 \\\\ 0 & e^{-i\\pi/4} \\end{pmatrix}
$$

$T^\\dagger$ is the conjugate transpose of $T = \\mathrm{diag}(1, e^{i\\pi/4})$, and since $T$ is unitary, $T^\\dagger$ is also its inverse: $TT^\\dagger = T^\\dagger T = I$.

## Action on basis states

$$
T^\\dagger|0\\rangle = |0\\rangle, \\qquad T^\\dagger|1\\rangle = e^{-i\\pi/4}|1\\rangle
$$

Applied to $|+\\rangle$, $T^\\dagger$ rotates the equatorial phase by $-\\pi/4$, the mirror image of what $T$ does.

## Key identities

- $(T^\\dagger)^2 = S^\\dagger$ and $(T^\\dagger)^8 = I$: the phase ladder $\\{I, T^\\dagger, S^\\dagger, \\dots\\}$ steps down in $-\\pi/4$ increments exactly as $\\{I,T,S,\\dots\\}$ steps up.
- $T^\\dagger = P(-\\pi/4) = R_Z(-\\pi/4)$ up to global phase.
- $T^\\dagger = T^7$ since $T^8=I$, so seven applications of $T$ implement one $T^\\dagger$ when a compiler's native gate set exposes only $T$.
- $T^\\dagger$ is not Clifford: conjugating $X$ by $T^\\dagger$ does not return a Pauli operator, which is exactly why $\\{H, S, \\mathrm{CX}, T^\\dagger\\}$ (or $T$) is needed for universal fault-tolerant quantum computation.`,
    explanationMdJa: `## 定義

$$
T^\\dagger = \\begin{pmatrix} 1 & 0 \\\\ 0 & e^{-i\\pi/4} \\end{pmatrix}
$$

$T^\\dagger$は$T = \\mathrm{diag}(1, e^{i\\pi/4})$の複素共役転置であり、$T$がユニタリなので$T^\\dagger$はその逆演算でもあります: $TT^\\dagger = T^\\dagger T = I$。

## 基底状態への作用

$$
T^\\dagger|0\\rangle = |0\\rangle, \\qquad T^\\dagger|1\\rangle = e^{-i\\pi/4}|1\\rangle
$$

$|+\\rangle$に適用すると、$T^\\dagger$は赤道上の位相を$-\\pi/4$回転させます。これは$T$の作用の鏡像です。

## 主要な恒等式

- $(T^\\dagger)^2 = S^\\dagger$、$(T^\\dagger)^8 = I$: 位相ラダー$\\{I, T^\\dagger, S^\\dagger, \\dots\\}$は、$\\{I,T,S,\\dots\\}$が$+\\pi/4$刻みで上がるのと同様に$-\\pi/4$刻みで下がります。
- 大域位相を除き$T^\\dagger = P(-\\pi/4) = R_Z(-\\pi/4)$です。
- $T^8=I$なので$T^\\dagger = T^7$です。コンパイラのネイティブゲート集合が$T$しか持たない場合、$T$を7回適用すれば$T^\\dagger$一回分になります。
- $T^\\dagger$はクリフォードではありません。$X$を$T^\\dagger$で共役してもパウリ演算子には戻らず、これこそが万能なフォールトトレラント量子計算に$\\{H, S, \\mathrm{CX}, T^\\dagger\\}$（または$T$）が必要な理由です。`,
    tags: ["phase", "non-clifford", "single qubit", "inverse", "fault tolerant"],
    resources: [
      { label: "Qubits", value: "1" },
      { label: "Depth", value: "1 gate" },
      { label: "Parameter", value: "none (fixed -π/4 phase)" },
    ],
    metadata: [
      { label: "Matrix", value: "diag(1, e^{-iπ/4})" },
      { label: "Inverse of", value: "T (T·T† = I)" },
      { label: "Power", value: "(T†)² = S†, (T†)⁸ = I" },
      { label: "Gate family", value: "Non-Clifford" },
    ],
    sourceTitle: "OpenQASM 3 standard gate set",
    sourceUrl: "https://openqasm.com/language/gates.html",
    wires: ["q[0]"],
    operations: [{ label: "T†", qubits: [0], tone: "warn" }],
    outcomes: [
      { label: "P(|0⟩) unchanged", probability: 1 },
      { label: "P(|1⟩) unchanged", probability: 0 },
    ],
    code: `OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit q;\ntdg q;`,
    filename: "t-dagger.qasm",
    language: "openqasm",
    extraVariants: [
      {
        framework: "Qiskit",
        status: "native",
        language: "python",
        filename: "t_dagger.py",
        code: `from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(1)\nqc.tdg(0)\n\nFINAL_CIRCUIT = qc`,
      },
      {
        framework: "Cirq",
        status: "native",
        language: "python",
        filename: "t_dagger.py",
        code: `import cirq\n\nq = cirq.LineQubit(0)\ncircuit = cirq.Circuit((cirq.T ** -1).on(q))\n\nFINAL_CIRCUIT = circuit`,
      },
    ],
    relatedSlugs: ["t-phase-gate", "s-dagger-gate", "magic-t-state", "toffoli-ccx-gate"],
    literature: [NIELSEN_CHUANG, OPENQASM3_PAPER],
  }),

  makeReferenceEntry({
    slug: "controlled-y-gate",
    title: "Controlled-Y gate",
    titleJa: "制御Yゲート",
    category: "gates",
    categoryLabel: "Gates",
    categoryLabelJa: "ゲート",
    algorithmFamily: "Controlled gate",
    framework: "OpenQASM 3.0",
    verificationMethods: ["truth_table", "unitary_equivalence", "textbook_citation"],
    verification: "Block-diagonal check · CY applies I to the control-0 subspace and Y to the control-1 subspace",
    method: "Apply CY to all four computational-basis inputs and confirm the target block for control=0 is identity and the block for control=1 is the Pauli-Y matrix.",
    result: "Pass · CY|0,t⟩ = |0,t⟩ and CY|1,0⟩ = i|1,1⟩, CY|1,1⟩ = -i|1,0⟩, matching Y exactly on the control-1 block.",
    exportStatus: "Native OpenQASM 3 · direct framework snippets available",
    provenance: "Curated reference",
    updatedAt: "2026-07-17",
    description:
      "A controlled version of the Pauli-Y gate that flips the target bit and attaches a ±i phase exactly when the control qubit is |1⟩, completing the CX/CY/CZ family of controlled Paulis.",
    descriptionJa: "制御量子ビットが|1⟩のときにのみ対象ビットを反転させ±iの位相を付与する、パウリYゲートの制御版です。CX/CY/CZという制御パウリの系列を完成させます。",
    introduction:
      "CY is less common as a native hardware gate than CX or CZ, but it completes the natural trio of controlled-Pauli gates and is a direct exercise in the general controlled-U-from-CX recipe, since Y is neither diagonal (like Z) nor real (like X).",
    introductionJa: "CYはCXやCZほど一般的にはネイティブなハードウェアゲートではありませんが、制御パウリの自然な三つ組を完成させ、CXから一般の制御Uを構成する定石の直接的な練習例です。Yは（Zのように）対角でも、（Xのように）実数でもないためです。",
    explanation:
      "CY acts as the identity on the control-0 subspace and as Y on the control-1 subspace. Because Y = S·X·S†, CY can be built from a single CX sandwiched between S† and S on the target, converting the CX bit-flip into the CY bit-flip-plus-phase.",
    explanationJa: "CYは制御が0の部分空間では恒等として、制御が1の部分空間ではYとして作用します。Y = S·X·S† であるため、CYは対象にS†とSを挟んだ1つのCXから構成でき、CXのビット反転をCYのビット反転＋位相に変換します。",
    explanationMd: `## Definition

$$
\\mathrm{CY} = |0\\rangle\\langle 0|\\otimes I + |1\\rangle\\langle 1|\\otimes Y = \\begin{pmatrix} 1&0&0&0\\\\0&1&0&0\\\\0&0&0&-i\\\\0&0&i&0 \\end{pmatrix}
$$

with the control as the first (leftmost) qubit. Like $\\mathrm{CX}$, this matrix is a bit-flip on the target; unlike $\\mathrm{CX}$, it also attaches a $\\pm i$ phase, since $Y|0\\rangle = i|1\\rangle$ and $Y|1\\rangle = -i|0\\rangle$.

## Action on basis states

$$
\\mathrm{CY}|0,t\\rangle = |0,t\\rangle, \\qquad \\mathrm{CY}|1,0\\rangle = i|1,1\\rangle, \\qquad \\mathrm{CY}|1,1\\rangle = -i|1,0\\rangle
$$

The control is left untouched in every case; the target flips exactly when the control is $|1\\rangle$, exactly as with $\\mathrm{CX}$, but the flipped amplitude also picks up a phase of $\\pm i$ depending on direction.

## Decomposition

Using the single-qubit identity $Y = S\\,X\\,S^\\dagger$ (verified directly: $S X S^\\dagger = \\begin{pmatrix}0&-i\\\\i&0\\end{pmatrix} = Y$), conjugating a plain $\\mathrm{CX}$'s target by $S^\\dagger$ before and $S$ after reproduces $\\mathrm{CY}$ exactly:

$$
\\mathrm{CY} = (I\\otimes S)\\,\\mathrm{CX}\\,(I\\otimes S^\\dagger)
$$

so the circuit applies $S^\\dagger$ to the target, then $\\mathrm{CX}$, then $S$ to the target — a direct three-gate analogue of the $\\mathrm{CZ} = (I\\otimes H)\\,\\mathrm{CX}\\,(I\\otimes H)$ identity elsewhere in this catalog.

## Key identities

- $\\mathrm{CY}^2 = I\\otimes I$: $\\mathrm{CY}$ is its own inverse, since $Y^2=I$.
- $\\mathrm{CY}$ is Clifford: it maps Pauli operators to Pauli operators under conjugation, just like $\\mathrm{CX}$ and $\\mathrm{CZ}$.
- Together, $\\mathrm{CX}$, $\\mathrm{CY}$, and $\\mathrm{CZ}$ are the three controlled-Pauli gates; any one can be built from either of the others plus single-qubit Clifford conjugation ($H$ for $\\mathrm{CZ}\\leftrightarrow\\mathrm{CX}$, $S$ for $\\mathrm{CY}\\leftrightarrow\\mathrm{CX}$).`,
    explanationMdJa: `## 定義

$$
\\mathrm{CY} = |0\\rangle\\langle 0|\\otimes I + |1\\rangle\\langle 1|\\otimes Y = \\begin{pmatrix} 1&0&0&0\\\\0&1&0&0\\\\0&0&0&-i\\\\0&0&i&0 \\end{pmatrix}
$$

制御を先頭（左側）の量子ビットとします。CXと同様にこの行列は対象のビット反転ですが、CXと異なり$\\pm i$の位相も付与します。$Y|0\\rangle = i|1\\rangle$、$Y|1\\rangle = -i|0\\rangle$だからです。

## 基底状態への作用

$$
\\mathrm{CY}|0,t\\rangle = |0,t\\rangle, \\qquad \\mathrm{CY}|1,0\\rangle = i|1,1\\rangle, \\qquad \\mathrm{CY}|1,1\\rangle = -i|1,0\\rangle
$$

制御はどの場合もそのまま保たれ、対象は制御が|1⟩のときにちょうどCXと同様に反転しますが、反転した振幅は向きに応じて$\\pm i$の位相も受け取ります。

## 分解

単一量子ビットの恒等式$Y = S\\,X\\,S^\\dagger$（直接検証済み: $S X S^\\dagger = \\begin{pmatrix}0&-i\\\\i&0\\end{pmatrix} = Y$）を使い、通常のCXの対象を前後で$S^\\dagger$とSにより共役すると、ちょうどCYが再現されます。

$$
\\mathrm{CY} = (I\\otimes S)\\,\\mathrm{CX}\\,(I\\otimes S^\\dagger)
$$

つまり回路は対象にS†を適用し、次にCX、最後に対象にSを適用します。これはこのカタログの他の場所にある$\\mathrm{CZ} = (I\\otimes H)\\,\\mathrm{CX}\\,(I\\otimes H)$の恒等式の直接的な3ゲート版です。

## 主要な恒等式

- $\\mathrm{CY}^2 = I\\otimes I$: $Y^2=I$なのでCYは自分自身の逆演算です。
- CYはクリフォードです。CXやCZと同様、共役の下でパウリ演算子をパウリ演算子に写します。
- CX・CY・CZは3つの制御パウリゲートです。いずれか1つは、他のどちらかに単一量子ビットのクリフォード共役（CZ↔CXにはH、CY↔CXにはS）を加えることで構成できます。`,
    tags: ["controlled gate", "two qubit", "clifford", "entanglement"],
    resources: [
      { label: "Qubits", value: "2" },
      { label: "Depth", value: "1 native / 3-gate decomposition (S†, CX, S)" },
      { label: "Outcomes", value: "conditional bit-flip with phase" },
    ],
    metadata: [
      { label: "Matrix", value: "block-diag(I₂, Y)" },
      { label: "Decomposition", value: "CY = (I⊗S)·CX·(I⊗S†)" },
      { label: "Self-inverse", value: "CY² = I" },
      { label: "Gate family", value: "Clifford" },
    ],
    sourceTitle: "OpenQASM 3 standard gate set",
    sourceUrl: "https://openqasm.com/language/gates.html",
    wires: ["q[0]", "q[1]"],
    operations: [{ label: "CY", qubits: [0, 1], tone: "ok" }],
    outcomes: [
      { label: "|10⟩ → i|11⟩", probability: 1 },
      { label: "|11⟩ → -i|10⟩", probability: 1 },
    ],
    decomposition: {
      summary: "S† · CX · S (target-conjugated CX)",
      summaryJa: "S† · CX · S（対象を共役したCX）",
      wires: ["q[0]", "q[1]"],
      operations: [
        { label: "S†", qubits: [1], tone: "neutral" },
        { label: "CX", qubits: [0, 1], tone: "accent" },
        { label: "S", qubits: [1], tone: "neutral" },
      ],
      note: "Uses Y = S·X·S†: applying S† to the target, then CX, then S reproduces CY exactly, the same conjugation trick as CZ = (I⊗H)·CX·(I⊗H).",
      noteJa: "Y = S·X·S† を利用します。対象にS†を適用し、次にCX、最後にSを適用するとCYが厳密に再現されます。CZ = (I⊗H)·CX·(I⊗H) と同じ共役の手法です。",
    },
    code: `OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nx q[0];\ncy q[0], q[1];`,
    filename: "controlled-y.qasm",
    language: "openqasm",
    extraVariants: [
      {
        framework: "Qiskit",
        status: "native",
        language: "python",
        filename: "controlled_y.py",
        code: `from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(2)\nqc.x(0)\nqc.cy(0, 1)\n\nFINAL_CIRCUIT = qc`,
      },
      {
        framework: "Cirq",
        status: "native",
        language: "python",
        filename: "controlled_y.py",
        code: `import cirq\n\nq0, q1 = cirq.LineQubit.range(2)\ncircuit = cirq.Circuit(cirq.X(q0), cirq.Y.controlled().on(q0, q1))\n\nFINAL_CIRCUIT = circuit`,
      },
    ],
    relatedSlugs: ["controlled-x-gate", "controlled-z-gate", "pauli-y-gate", "s-phase-gate"],
    literature: [NIELSEN_CHUANG, OPENQASM3_PAPER],
  }),

  makeReferenceEntry({
    slug: "controlled-rz-gate",
    title: "Controlled-RZ gate (CRZ)",
    titleJa: "制御RZゲート（CRZ）",
    category: "gates",
    categoryLabel: "Gates",
    categoryLabelJa: "ゲート",
    algorithmFamily: "Controlled gate",
    framework: "OpenQASM 3.0",
    verificationMethods: ["truth_table", "unitary_equivalence", "textbook_citation"],
    verification: "Block-diagonal check · CRZ(θ) applies I to the control-0 subspace and RZ(θ) to the control-1 subspace",
    method: "Apply CRZ(θ) to all four computational-basis inputs and confirm the control-0 block is identity while the control-1 block matches the RZ(θ) diagonal matrix.",
    result: "Pass · CRZ(θ)|0,t⟩ = |0,t⟩ for both t, and CRZ(θ)|1,t⟩ = e^{iθ(2t-1)/2}|1,t⟩, matching RZ(θ) on the target.",
    exportStatus: "Native OpenQASM 3 · direct framework snippets available",
    provenance: "Curated reference",
    updatedAt: "2026-07-17",
    description:
      "A parametrized controlled gate that applies an RZ(θ) rotation to the target exactly when the control is |1⟩, the entangling generalization of RZ used when a Z-rotation itself needs to be conditioned on another qubit.",
    descriptionJa: "制御が|1⟩のときにのみ対象にRZ(θ)回転を適用する、パラメータ化された制御ゲートです。Z回転自体を別の量子ビットに条件付けする必要がある場合に使われる、RZのエンタングルする一般化です。",
    introduction:
      "CRZ is easy to confuse with the controlled-phase gate CP, since both are parametrized two-qubit gates built around a single-qubit Z-axis operation — but they are genuinely different unitaries, and this record exists partly to make that distinction explicit.",
    introductionJa: "CRZと制御位相ゲートCPは、どちらも単一量子ビットのZ軸演算をもとに構成されたパラメータ付き2量子ビットゲートですが、異なるユニタリです。ここでは、その違いを明示します。",
    explanation:
      "CRZ(θ) acts as the identity on the control-0 subspace and as RZ(θ) on the control-1 subspace. Unlike CP(θ), which only phases |11⟩, RZ splits its phase symmetrically across both target basis states, so CRZ(θ) also applies a nontrivial phase to |10⟩ — the two gates coincide only up to a target-dependent phase correction, not exactly.",
    explanationJa: "CRZ(θ)は制御が0の部分空間では恒等として、制御が1の部分空間ではRZ(θ)として作用します。|11⟩のみに位相を与えるCP(θ)と異なり、RZは両方の対象基底状態に対称に位相を分けるため、CRZ(θ)は|10⟩にも自明でない位相を与えます。2つのゲートは対象に依存する位相補正を除いてのみ一致し、厳密には一致しません。",
    explanationMd: `## Definition

$$
\\mathrm{CRZ}(\\theta) = |0\\rangle\\langle 0|\\otimes I + |1\\rangle\\langle 1|\\otimes R_Z(\\theta) = \\begin{pmatrix} 1&0&0&0\\\\0&1&0&0\\\\0&0&e^{-i\\theta/2}&0\\\\0&0&0&e^{i\\theta/2} \\end{pmatrix}
$$

with the control as the first (leftmost) qubit.

## Action on basis states

$$
\\mathrm{CRZ}(\\theta)|0,t\\rangle = |0,t\\rangle, \\qquad \\mathrm{CRZ}(\\theta)|1,0\\rangle = e^{-i\\theta/2}|1,0\\rangle, \\qquad \\mathrm{CRZ}(\\theta)|1,1\\rangle = e^{i\\theta/2}|1,1\\rangle
$$

The control is untouched. When the control is $|1\\rangle$, *both* target values pick up a phase — $|10\\rangle$ gets $e^{-i\\theta/2}$, not just $1$ — which is the key difference from $\\mathrm{CP}(\\theta)$, whose $|10\\rangle$ amplitude is always left exactly at $1$.

## Decomposition

$$
\\mathrm{CRZ}(\\theta) = (I\\otimes R_Z(\\theta/2))\\;\\mathrm{CX}\\;(I\\otimes R_Z(-\\theta/2))\\;\\mathrm{CX}
$$

For control $0$, both CNOTs act trivially and the target sees $R_Z(\\theta/2)R_Z(-\\theta/2)=I$. For control $1$, the first CNOT flips the target, the surrounding $R_Z(\\mp\\theta/2)$ gates pick up phases that depend on the (opposite-sign) bit values before and after the flip, and the second CNOT flips the target back — a direct phase-kickback calculation shows the two contributions add to exactly $e^{i\\theta\\,\\mathrm{sign}(t)/2}$, reproducing $R_Z(\\theta)$ on the original target value $t$.

## Key identities

- $\\mathrm{CRZ}(\\theta) \\ne \\mathrm{CP}(\\theta)$ in general: they agree on $|00\\rangle,|01\\rangle,|11\\rangle$ only up to how each defines phase on $|10\\rangle$, and differ by a target-controlled global-phase factor overall.
- $\\mathrm{CRZ}(\\theta_1)\\,\\mathrm{CRZ}(\\theta_2) = \\mathrm{CRZ}(\\theta_1+\\theta_2)$: controlled Z-rotations on the same qubit pair compose additively, just like the underlying $R_Z$.
- $\\mathrm{CRZ}(2\\pi) = I\\otimes I$ and $\\mathrm{CRZ}(0) = I \\otimes I$, since $R_Z(2\\pi) = R_Z(0) = I$ up to global phase considerations that cancel in the controlled version.
- $\\mathrm{CRZ}$ is the natural entangling primitive whenever an algorithm needs a data-dependent $Z$-rotation, e.g. controlled time-evolution steps in quantum simulation.`,
    explanationMdJa: `## 定義

$$
\\mathrm{CRZ}(\\theta) = |0\\rangle\\langle 0|\\otimes I + |1\\rangle\\langle 1|\\otimes R_Z(\\theta) = \\begin{pmatrix} 1&0&0&0\\\\0&1&0&0\\\\0&0&e^{-i\\theta/2}&0\\\\0&0&0&e^{i\\theta/2} \\end{pmatrix}
$$

制御を先頭（左側）の量子ビットとします。

## 基底状態への作用

$$
\\mathrm{CRZ}(\\theta)|0,t\\rangle = |0,t\\rangle, \\qquad \\mathrm{CRZ}(\\theta)|1,0\\rangle = e^{-i\\theta/2}|1,0\\rangle, \\qquad \\mathrm{CRZ}(\\theta)|1,1\\rangle = e^{i\\theta/2}|1,1\\rangle
$$

制御はそのまま保たれます。制御が|1⟩のとき、対象の*両方の*値が位相を受け取ります。|10⟩は$1$ではなく$e^{-i\\theta/2}$を受け取り、これが常に|10⟩振幅をちょうど$1$のままにする$\\mathrm{CP}(\\theta)$との重要な違いです。

## 分解

$$
\\mathrm{CRZ}(\\theta) = (I\\otimes R_Z(\\theta/2))\\;\\mathrm{CX}\\;(I\\otimes R_Z(-\\theta/2))\\;\\mathrm{CX}
$$

制御が0の場合、両方のCNOTは自明に作用し、対象は$R_Z(\\theta/2)R_Z(-\\theta/2)=I$を受けます。制御が1の場合、最初のCNOTが対象を反転させ、前後の$R_Z(\\mp\\theta/2)$は反転前後の（符号が逆の）ビット値に依存する位相を蓄積し、2番目のCNOTが対象を元に戻します。位相キックバックの直接計算により、2つの寄与はちょうど$e^{i\\theta\\,\\mathrm{sign}(t)/2}$に加算され、元の対象値$t$に対する$R_Z(\\theta)$を再現することが示されます。

## 主要な恒等式

- $\\mathrm{CRZ}(\\theta) \\ne \\mathrm{CP}(\\theta)$ が一般に成り立ちます。両者は$|00\\rangle,|01\\rangle,|11\\rangle$上で、|10⟩上の位相の定義方法を除いてのみ一致し、全体としては対象に依存する大域位相因子だけ異なります。
- $\\mathrm{CRZ}(\\theta_1)\\,\\mathrm{CRZ}(\\theta_2) = \\mathrm{CRZ}(\\theta_1+\\theta_2)$: 同じ量子ビット対に対する制御Z回転は、元の$R_Z$と同様に加法的に合成されます。
- $\\mathrm{CRZ}(2\\pi) = I\\otimes I$、$\\mathrm{CRZ}(0) = I \\otimes I$です。制御版では打ち消し合う大域位相を除き$R_Z(2\\pi) = R_Z(0) = I$だからです。
- CRZは、アルゴリズムがデータに依存したZ回転を必要とする場合の自然なエンタングルする基本演算です。例えば量子シミュレーションにおける制御時間発展のステップなどです。`,
    tags: ["controlled gate", "rotation", "phase", "two qubit"],
    resources: [
      { label: "Qubits", value: "2" },
      { label: "Depth", value: "1 native / 4-gate decomposition (RZ, CX, RZ, CX)" },
      { label: "Parameter", value: "θ (radians)" },
    ],
    metadata: [
      { label: "Matrix", value: "diag(1, 1, e^{-iθ/2}, e^{iθ/2})" },
      { label: "Distinction", value: "CRZ(θ) ≠ CP(θ): also phases |10⟩" },
      { label: "Decomposition", value: "RZ(θ/2)·CX·RZ(-θ/2)·CX" },
      { label: "Gate family", value: "Non-Clifford (generic θ)" },
    ],
    sourceTitle: "OpenQASM 3 standard gate set",
    sourceUrl: "https://openqasm.com/language/gates.html",
    wires: ["q[0]", "q[1]"],
    operations: [{ label: "CRZ(π/2)", qubits: [0, 1], tone: "accent" }],
    outcomes: [
      { label: "|11⟩ phase e^{iθ/2}", probability: 1 },
      { label: "|10⟩ phase e^{-iθ/2}", probability: 1 },
    ],
    decomposition: {
      summary: "RZ(θ/2) · CX · RZ(-θ/2) · CX",
      summaryJa: "RZ(θ/2) · CX · RZ(-θ/2) · CX",
      wires: ["q[0]", "q[1]"],
      operations: [
        { label: "RZ(θ/2)", qubits: [1], tone: "neutral" },
        { label: "CX", qubits: [0, 1], tone: "accent" },
        { label: "RZ(-θ/2)", qubits: [1], tone: "neutral" },
        { label: "CX", qubits: [0, 1], tone: "accent" },
      ],
      note: "Phase kickback through the two CNOTs cancels for control=0 and accumulates the full RZ(θ) phase for control=1, verified by direct basis-state phase tracking.",
      noteJa: "2つのCNOTを通じた位相キックバックは制御=0では打ち消し合い、制御=1では完全なRZ(θ)位相として蓄積します。基底状態の位相を直接追跡して検証済みです。",
    },
    code: `OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nx q[0];\ncrz(pi/2) q[0], q[1];`,
    filename: "controlled-rz.qasm",
    language: "openqasm",
    extraVariants: [
      {
        framework: "Qiskit",
        status: "native",
        language: "python",
        filename: "controlled_rz.py",
        code: `from qiskit import QuantumCircuit\nimport numpy as np\n\nqc = QuantumCircuit(2)\nqc.x(0)\nqc.crz(np.pi / 2, 0, 1)\n\nFINAL_CIRCUIT = qc`,
      },
      {
        framework: "Cirq",
        status: "native",
        language: "python",
        filename: "controlled_rz.py",
        code: `import cirq\nimport numpy as np\n\nq0, q1 = cirq.LineQubit.range(2)\ncircuit = cirq.Circuit(cirq.X(q0), cirq.rz(np.pi / 2).on(q1).controlled_by(q0))\n\nFINAL_CIRCUIT = circuit`,
      },
    ],
    relatedSlugs: ["rz-rotation-gate", "controlled-phase-gate", "controlled-z-gate", "quantum-phase-estimation"],
    literature: [NIELSEN_CHUANG, OPENQASM3_PAPER],
  }),

  makeReferenceEntry({
    slug: "rzz-interaction-gate",
    title: "RZZ (ZZ interaction) gate",
    titleJa: "RZZ（ZZ相互作用）ゲート",
    category: "gates",
    categoryLabel: "Gates",
    categoryLabelJa: "ゲート",
    algorithmFamily: "Two-qubit gate",
    framework: "OpenQASM 3.0",
    verificationMethods: ["unitary_equivalence", "direct_math", "textbook_citation"],
    verification: "Unitary equivalence · RZZ(θ) matches exp(-iθ Z⊗Z/2)",
    method: "Expand exp(-iθZZ/2) using (Z⊗Z)²=I⊗I to split the Taylor series into cosine and sine terms, and compare the closed form against the parametrized RZZ diagonal matrix.",
    result: "Pass · RZZ(θ) = diag(e^{-iθ/2}, e^{iθ/2}, e^{iθ/2}, e^{-iθ/2}) exactly, matching the ZZ eigenvalue structure (+1 on |00⟩,|11⟩, -1 on |01⟩,|10⟩).",
    exportStatus: "Native OpenQASM 3 · direct framework snippets available",
    provenance: "Curated reference",
    updatedAt: "2026-07-17",
    description:
      "A parametrized two-qubit gate implementing evolution under the Ising ZZ coupling, the entangling primitive most directly native to superconducting and trapped-ion hardware built from always-on or tunable ZZ interactions.",
    descriptionJa: "Ising型ZZ結合の下での時間発展を実装するパラメータ化2量子ビットゲートで、常時オンまたは可変なZZ相互作用から構築された超伝導・イオントラップハードウェアに最も直接的にネイティブなエンタングルする基本演算です。",
    introduction:
      "RZZ matters because ZZ coupling is often the physical interaction a device actually has: rather than compiling a target algorithm's entangling step down to CNOT, many Hamiltonian-simulation and QAOA compilers target RZZ directly since it matches the hardware's native two-body term.",
    introductionJa: "RZZが重要なのは、ZZ結合がデバイスが実際に持つ物理的な相互作用であることが多いためです。ターゲットアルゴリズムのエンタングルするステップをCNOTまでコンパイルするのではなく、多くのハミルトニアンシミュレーションやQAOAのコンパイラは、ハードウェアのネイティブな2体項に一致するRZZを直接ターゲットにします。",
    explanation:
      "RZZ(θ) = exp(-iθZ⊗Z/2) is diagonal, applying e^{-iθ/2} to the same-parity states |00⟩,|11⟩ and e^{iθ/2} to the opposite-parity states |01⟩,|10⟩, since Z⊗Z has eigenvalue +1 or -1 accordingly. It changes no computational-basis populations, only relative phase.",
    explanationJa: "RZZ(θ) = exp(-iθZ⊗Z/2) は対角であり、同じパリティの状態|00⟩,|11⟩にはe^{-iθ/2}を、異なるパリティの状態|01⟩,|10⟩にはe^{iθ/2}を適用します。これはZ⊗Zがそれぞれ固有値+1または-1を持つためです。計算基底の存在確率は変えず、相対位相のみを変えます。",
    explanationMd: `## Definition

$$
\\mathrm{RZZ}(\\theta) = e^{-i\\theta (Z\\otimes Z)/2} = \\begin{pmatrix} e^{-i\\theta/2}&0&0&0\\\\0&e^{i\\theta/2}&0&0\\\\0&0&e^{i\\theta/2}&0\\\\0&0&0&e^{-i\\theta/2} \\end{pmatrix}
$$

Since $(Z\\otimes Z)^2 = I\\otimes I$, the exponential splits exactly as $\\cos(\\theta/2)\\,I\\otimes I - i\\sin(\\theta/2)\\,Z\\otimes Z$, and because $Z\\otimes Z$ is diagonal with eigenvalues $\\pm1$, the result is diagonal.

## Action on basis states

$$
\\mathrm{RZZ}(\\theta)|00\\rangle = e^{-i\\theta/2}|00\\rangle, \\quad \\mathrm{RZZ}(\\theta)|01\\rangle = e^{i\\theta/2}|01\\rangle, \\quad \\mathrm{RZZ}(\\theta)|10\\rangle = e^{i\\theta/2}|10\\rangle, \\quad \\mathrm{RZZ}(\\theta)|11\\rangle = e^{-i\\theta/2}|11\\rangle
$$

No population moves between basis states; only the relative phase between same-parity and opposite-parity computational states changes, which is exactly the interference resource used by QAOA cost-Hamiltonian layers.

## Decomposition

$$
\\mathrm{RZZ}(\\theta) = \\mathrm{CX}\\;(I\\otimes R_Z(\\theta))\\;\\mathrm{CX}
$$

The first CNOT maps the target qubit onto the parity $t\\oplus c$; a single-qubit $R_Z(\\theta)$ there attaches $e^{i\\theta\\,\\mathrm{sign}(t\\oplus c)/2}$, and the second CNOT restores the target to $t$ while leaving the accumulated phase in place — direct basis-state tracking confirms this phase equals the $\\mathrm{RZZ}(\\theta)$ diagonal entry exactly for all four $(c,t)$ inputs.

## Key identities

- $\\mathrm{RZZ}(\\pi/2)$ is Clifford: numerically, $e^{i\\pi/4}\\mathrm{RZZ}(\\pi/2) = (S\\otimes S)\\cdot\\mathrm{CZ}$ (both sides equal $\\mathrm{diag}(1,i,i,1)$), so at this special angle $\\mathrm{RZZ}$ reduces to a product of Clifford gates; for generic $\\theta$ it is not Clifford.
- $\\mathrm{RZZ}(\\theta_1)\\,\\mathrm{RZZ}(\\theta_2) = \\mathrm{RZZ}(\\theta_1+\\theta_2)$: successive ZZ-interaction pulses on the same pair compose additively, matching real continuous-time evolution under a fixed coupling.
- $\\mathrm{RXX}(\\theta) = (H\\otimes H)\\,\\mathrm{RZZ}(\\theta)\\,(H\\otimes H)$: conjugating by Hadamards on both qubits rotates the interaction axis from $Z\\otimes Z$ to $X\\otimes X$.
- $\\mathrm{RZZ}(\\theta)$ is the two-qubit workhorse of Trotterized Hamiltonian simulation for Ising-type models and of the cost-Hamiltonian layer in QAOA for Max-Cut-style problems.`,
    explanationMdJa: `## 定義

$$
\\mathrm{RZZ}(\\theta) = e^{-i\\theta (Z\\otimes Z)/2} = \\begin{pmatrix} e^{-i\\theta/2}&0&0&0\\\\0&e^{i\\theta/2}&0&0\\\\0&0&e^{i\\theta/2}&0\\\\0&0&0&e^{-i\\theta/2} \\end{pmatrix}
$$

$(Z\\otimes Z)^2 = I\\otimes I$なので、指数はちょうど$\\cos(\\theta/2)\\,I\\otimes I - i\\sin(\\theta/2)\\,Z\\otimes Z$に分かれ、$Z\\otimes Z$は固有値$\\pm1$を持つ対角行列なので結果も対角になります。

## 基底状態への作用

$$
\\mathrm{RZZ}(\\theta)|00\\rangle = e^{-i\\theta/2}|00\\rangle, \\quad \\mathrm{RZZ}(\\theta)|01\\rangle = e^{i\\theta/2}|01\\rangle, \\quad \\mathrm{RZZ}(\\theta)|10\\rangle = e^{i\\theta/2}|10\\rangle, \\quad \\mathrm{RZZ}(\\theta)|11\\rangle = e^{-i\\theta/2}|11\\rangle
$$

基底状態間で存在確率が移動することはなく、同じパリティと異なるパリティの計算基底状態の間の相対位相だけが変化します。これはまさにQAOAのコストハミルトニアン層が使う干渉のリソースです。

## 分解

$$
\\mathrm{RZZ}(\\theta) = \\mathrm{CX}\\;(I\\otimes R_Z(\\theta))\\;\\mathrm{CX}
$$

最初のCNOTは対象量子ビットをパリティ$t\\oplus c$に写します。そこで単一量子ビットの$R_Z(\\theta)$が$e^{i\\theta\\,\\mathrm{sign}(t\\oplus c)/2}$を付与し、2番目のCNOTは蓄積された位相をそのままにしつつ対象を$t$に戻します。基底状態を直接追跡すると、この位相が4つの$(c,t)$入力すべてについて$\\mathrm{RZZ}(\\theta)$の対角成分に厳密に一致することが確認できます。

## 主要な恒等式

- $\\mathrm{RZZ}(\\pi/2)$はクリフォードです。数値的に$e^{i\\pi/4}\\mathrm{RZZ}(\\pi/2) = (S\\otimes S)\\cdot\\mathrm{CZ}$（両辺とも$\\mathrm{diag}(1,i,i,1)$）となるため、この特殊な角度ではRZZはクリフォードゲートの積に帰着します。一般の$\\theta$ではクリフォードではありません。
- $\\mathrm{RZZ}(\\theta_1)\\,\\mathrm{RZZ}(\\theta_2) = \\mathrm{RZZ}(\\theta_1+\\theta_2)$: 同じ量子ビット対への連続したZZ相互作用パルスは加法的に合成され、固定された結合の下での実際の連続時間発展と一致します。
- $\\mathrm{RXX}(\\theta) = (H\\otimes H)\\,\\mathrm{RZZ}(\\theta)\\,(H\\otimes H)$: 両方の量子ビットにアダマールで共役すると、相互作用軸が$Z\\otimes Z$から$X\\otimes X$へ変わります。
- $\\mathrm{RZZ}(\\theta)$は、Ising型モデルのトロッター化ハミルトニアンシミュレーションや、Max-Cut型問題に対するQAOAのコストハミルトニアン層の主力2量子ビットゲートです。`,
    tags: ["ising interaction", "two qubit", "rotation", "hardware native"],
    resources: [
      { label: "Qubits", value: "2" },
      { label: "Depth", value: "1 native / 3-gate decomposition (CX, RZ, CX)" },
      { label: "Parameter", value: "θ (radians)" },
    ],
    metadata: [
      { label: "Matrix", value: "diag(e^{-iθ/2}, e^{iθ/2}, e^{iθ/2}, e^{-iθ/2})" },
      { label: "Generator", value: "exp(-iθ ZZ/2)" },
      { label: "Decomposition", value: "CX · RZ(θ) · CX" },
      { label: "Gate family", value: "Non-Clifford (generic θ); Clifford at θ=π/2" },
    ],
    sourceTitle: "OpenQASM 3 standard gate set",
    sourceUrl: "https://openqasm.com/language/gates.html",
    wires: ["q[0]", "q[1]"],
    operations: [{ label: "RZZ(π/2)", qubits: [0, 1], tone: "accent" }],
    outcomes: [
      { label: "|00⟩, |11⟩ phase e^{-iθ/2}", probability: 1 },
      { label: "|01⟩, |10⟩ phase e^{iθ/2}", probability: 1 },
    ],
    decomposition: {
      summary: "CX · RZ(θ) · CX",
      summaryJa: "CX · RZ(θ) · CX",
      wires: ["q[0]", "q[1]"],
      operations: [
        { label: "CX", qubits: [0, 1], tone: "accent" },
        { label: "RZ(θ)", qubits: [1], tone: "neutral" },
        { label: "CX", qubits: [0, 1], tone: "accent" },
      ],
      note: "The CNOTs map the ZZ parity onto the target's computational-basis value, so a single-qubit RZ(θ) there reproduces the two-qubit Ising phase exactly.",
      noteJa: "CNOTはZZパリティを対象の計算基底の値に写すため、そこでの単一量子ビットRZ(θ)が2量子ビットのIsing位相を厳密に再現します。",
    },
    code: `OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nrzz(pi/2) q[0], q[1];`,
    filename: "rzz-interaction.qasm",
    language: "openqasm",
    extraVariants: [
      {
        framework: "Qiskit",
        status: "native",
        language: "python",
        filename: "rzz_interaction.py",
        code: `from qiskit import QuantumCircuit\nimport numpy as np\n\nqc = QuantumCircuit(2)\nqc.rzz(np.pi / 2, 0, 1)\n\nFINAL_CIRCUIT = qc`,
      },
      {
        framework: "Cirq",
        status: "native",
        language: "python",
        filename: "rzz_interaction.py",
        code: `import cirq\n\nq0, q1 = cirq.LineQubit.range(2)\n# ZZPowGate(t) applies exp(-i*pi*t/2 * ZZ) up to phase; t=0.5 matches RZZ(pi/2)\ncircuit = cirq.Circuit(cirq.ZZPowGate(exponent=0.5).on(q0, q1))\n\nFINAL_CIRCUIT = circuit`,
      },
    ],
    relatedSlugs: ["controlled-z-gate", "rz-rotation-gate", "rxx-interaction-gate", "hamiltonian-simulation-ising", "qaoa-maxcut-ring"],
    literature: [NIELSEN_CHUANG, OPENQASM3_PAPER],
  }),

  makeReferenceEntry({
    slug: "rxx-interaction-gate",
    title: "RXX (XX interaction) gate",
    titleJa: "RXX（XX相互作用）ゲート",
    category: "gates",
    categoryLabel: "Gates",
    categoryLabelJa: "ゲート",
    algorithmFamily: "Two-qubit gate",
    framework: "OpenQASM 3.0",
    verificationMethods: ["unitary_equivalence", "direct_math", "textbook_citation"],
    verification: "Unitary equivalence · RXX(θ) matches exp(-iθ X⊗X/2)",
    method: "Expand exp(-iθXX/2) using (X⊗X)²=I⊗I to split the Taylor series into cosine and sine terms, and compare the closed form against the parametrized RXX matrix.",
    result: "Pass · RXX(θ) = cos(θ/2)·I⊗I - i·sin(θ/2)·X⊗X exactly, matching the anti-diagonal structure of X⊗X.",
    exportStatus: "Native OpenQASM 3 · direct framework snippets available",
    provenance: "Curated reference",
    updatedAt: "2026-07-17",
    description:
      "A parametrized two-qubit gate implementing evolution under the Ising XX coupling, the RZZ gate's basis-rotated sibling used in Heisenberg-model simulation and trapped-ion Mølmer–Sørensen-style entangling operations.",
    descriptionJa: "Ising型XX結合の下での時間発展を実装するパラメータ化2量子ビットゲートで、RZZゲートの基底回転された兄弟分であり、Heisenbergモデルのシミュレーションやイオントラップの Mølmer–Sørensen型エンタングル演算に使われます。",
    introduction:
      "RXX matters wherever a model's interaction term is naturally expressed in the X basis rather than Z — Heisenberg-type spin chains, or trapped-ion hardware whose native multi-qubit gate is generated by a collective XX-type coupling rather than ZZ.",
    introductionJa: "RXXが重要なのは、モデルの相互作用項がZではなくX基底で自然に表現される場合です。Heisenberg型スピン鎖や、集団的なXX型結合によって生成されるネイティブな多体ゲートを持つイオントラップハードウェアなどです。",
    explanation:
      "RXX(θ) = exp(-iθX⊗X/2) = cos(θ/2)·I⊗I - i·sin(θ/2)·X⊗X. Because X⊗X is anti-diagonal (it exchanges |00⟩↔|11⟩ and |01⟩↔|10⟩), RXX(θ) mixes populations between those pairs rather than only shifting phase, unlike its Z-axis sibling RZZ.",
    explanationJa: "RXX(θ) = exp(-iθX⊗X/2) = cos(θ/2)·I⊗I - i·sin(θ/2)·X⊗X です。X⊗Xは反対角（|00⟩↔|11⟩と|01⟩↔|10⟩を交換する）であるため、RXX(θ)はZ軸の兄弟分であるRZZと異なり、位相をずらすだけでなくこれらのペア間で存在確率を混ぜます。",
    explanationMd: `## Definition

$$
\\mathrm{RXX}(\\theta) = e^{-i\\theta (X\\otimes X)/2} = \\begin{pmatrix} \\cos(\\theta/2)&0&0&-i\\sin(\\theta/2)\\\\0&\\cos(\\theta/2)&-i\\sin(\\theta/2)&0\\\\0&-i\\sin(\\theta/2)&\\cos(\\theta/2)&0\\\\-i\\sin(\\theta/2)&0&0&\\cos(\\theta/2) \\end{pmatrix}
$$

Since $(X\\otimes X)^2 = I\\otimes I$, the exponential splits as $\\cos(\\theta/2)\\,I\\otimes I - i\\sin(\\theta/2)\\,X\\otimes X$, and because $X\\otimes X$ swaps $|00\\rangle\\leftrightarrow|11\\rangle$ and $|01\\rangle\\leftrightarrow|10\\rangle$, the off-diagonal terms connect exactly those pairs.

## Action on basis states

$$
\\mathrm{RXX}(\\theta)|00\\rangle = \\cos(\\theta/2)|00\\rangle - i\\sin(\\theta/2)|11\\rangle, \\qquad \\mathrm{RXX}(\\theta)|01\\rangle = \\cos(\\theta/2)|01\\rangle - i\\sin(\\theta/2)|10\\rangle
$$

At $\\theta=\\pi/2$, $\\mathrm{RXX}(\\pi/2)|00\\rangle = \\tfrac{1}{\\sqrt2}(|00\\rangle - i|11\\rangle)$ — an entangled Bell-like state produced from a product-state input, giving equal $1/2$ probability on $|00\\rangle$ and $|11\\rangle$.

## Decomposition

$$
\\mathrm{RXX}(\\theta) = (H\\otimes H)\\;\\mathrm{RZZ}(\\theta)\\;(H\\otimes H)
$$

Since $X = HZH$, we have $X\\otimes X = (H\\otimes H)(Z\\otimes Z)(H\\otimes H)$, so conjugating the entire $\\mathrm{RZZ}(\\theta)$ circuit — itself $\\mathrm{CX}\\,(I\\otimes R_Z(\\theta))\\,\\mathrm{CX}$ — by Hadamards on both qubits rotates the interaction axis from $Z\\otimes Z$ to $X\\otimes X$, giving the five-gate circuit $H,H,\\mathrm{CX},R_Z(\\theta),\\mathrm{CX},H,H$.

## Key identities

- $\\mathrm{RXX}(\\pi/2)$ is Clifford: it equals $(H\\otimes H)\\,\\mathrm{RZZ}(\\pi/2)\\,(H\\otimes H)$, a conjugation of the Clifford gate $\\mathrm{RZZ}(\\pi/2)$ by Clifford Hadamards, hence itself Clifford; for generic $\\theta$ it is not.
- $\\mathrm{RXX}(\\theta_1)\\,\\mathrm{RXX}(\\theta_2) = \\mathrm{RXX}(\\theta_1+\\theta_2)$: successive XX pulses on the same pair compose additively.
- $\\mathrm{RXX}(\\pi) = -i\\,X\\otimes X$: a full-$\\pi$ pulse reproduces a simultaneous bit-flip on both qubits up to global phase.
- $\\mathrm{RXX}$ is the generating gate of the trapped-ion Mølmer–Sørensen interaction, which natively entangles pairs (or larger groups) of ions via their shared motional mode.`,
    explanationMdJa: `## 定義

$$
\\mathrm{RXX}(\\theta) = e^{-i\\theta (X\\otimes X)/2} = \\begin{pmatrix} \\cos(\\theta/2)&0&0&-i\\sin(\\theta/2)\\\\0&\\cos(\\theta/2)&-i\\sin(\\theta/2)&0\\\\0&-i\\sin(\\theta/2)&\\cos(\\theta/2)&0\\\\-i\\sin(\\theta/2)&0&0&\\cos(\\theta/2) \\end{pmatrix}
$$

$(X\\otimes X)^2 = I\\otimes I$なので、指数は$\\cos(\\theta/2)\\,I\\otimes I - i\\sin(\\theta/2)\\,X\\otimes X$に分かれます。$X\\otimes X$は$|00\\rangle\\leftrightarrow|11\\rangle$と$|01\\rangle\\leftrightarrow|10\\rangle$を交換するため、非対角項はちょうどこれらのペアを結びます。

## 基底状態への作用

$$
\\mathrm{RXX}(\\theta)|00\\rangle = \\cos(\\theta/2)|00\\rangle - i\\sin(\\theta/2)|11\\rangle, \\qquad \\mathrm{RXX}(\\theta)|01\\rangle = \\cos(\\theta/2)|01\\rangle - i\\sin(\\theta/2)|10\\rangle
$$

$\\theta=\\pi/2$のとき、$\\mathrm{RXX}(\\pi/2)|00\\rangle = \\tfrac{1}{\\sqrt2}(|00\\rangle - i|11\\rangle)$となります。これは積状態の入力から生成されたベル状態的なエンタングル状態で、|00⟩と|11⟩にそれぞれ$1/2$の確率を与えます。

## 分解

$$
\\mathrm{RXX}(\\theta) = (H\\otimes H)\\;\\mathrm{RZZ}(\\theta)\\;(H\\otimes H)
$$

$X = HZH$なので、$X\\otimes X = (H\\otimes H)(Z\\otimes Z)(H\\otimes H)$です。したがって、$\\mathrm{RZZ}(\\theta)$回路（それ自体$\\mathrm{CX}\\,(I\\otimes R_Z(\\theta))\\,\\mathrm{CX}$）全体を両方の量子ビットのアダマールで共役すると、相互作用軸が$Z\\otimes Z$から$X\\otimes X$に変わり、$H,H,\\mathrm{CX},R_Z(\\theta),\\mathrm{CX},H,H$という5ゲート回路が得られます。

## 主要な恒等式

- $\\mathrm{RXX}(\\pi/2)$はクリフォードです。$(H\\otimes H)\\,\\mathrm{RZZ}(\\pi/2)\\,(H\\otimes H)$に等しく、クリフォードゲートである$\\mathrm{RZZ}(\\pi/2)$をクリフォードのアダマールで共役したものなので、それ自体もクリフォードです。一般の$\\theta$ではクリフォードではありません。
- $\\mathrm{RXX}(\\theta_1)\\,\\mathrm{RXX}(\\theta_2) = \\mathrm{RXX}(\\theta_1+\\theta_2)$: 同じ量子ビット対への連続したXXパルスは加法的に合成されます。
- $\\mathrm{RXX}(\\pi) = -i\\,X\\otimes X$: 完全な$\\pi$パルスは、大域位相を除いて両方の量子ビットの同時ビット反転を再現します。
- RXXは、イオントラップのMølmer–Sørensen相互作用を生成するゲートであり、共有された運動モードを介してイオンのペア（またはより大きなグループ）をネイティブにエンタングルさせます。`,
    tags: ["ising interaction", "two qubit", "rotation", "trapped ion"],
    resources: [
      { label: "Qubits", value: "2" },
      { label: "Depth", value: "1 native / 5-gate decomposition (H, H, CX, RZ, CX, H, H)" },
      { label: "Parameter", value: "θ (radians)" },
    ],
    metadata: [
      { label: "Matrix", value: "cos(θ/2)·I⊗I - i sin(θ/2)·X⊗X" },
      { label: "Generator", value: "exp(-iθ XX/2)" },
      { label: "Decomposition", value: "H⊗H · RZZ(θ) · H⊗H" },
      { label: "Gate family", value: "Non-Clifford (generic θ); Clifford at θ=π/2" },
    ],
    sourceTitle: "OpenQASM 3 standard gate set",
    sourceUrl: "https://openqasm.com/language/gates.html",
    wires: ["q[0]", "q[1]"],
    operations: [{ label: "RXX(π/2)", qubits: [0, 1], tone: "accent" }],
    outcomes: [
      { label: "P(|00⟩) at θ=π/2", probability: 0.5 },
      { label: "P(|11⟩) at θ=π/2", probability: 0.5 },
    ],
    decomposition: {
      summary: "H·H · CX·RZ(θ)·CX · H·H (basis change from RZZ)",
      summaryJa: "H·H · CX·RZ(θ)·CX · H·H（RZZからの基底変換）",
      wires: ["q[0]", "q[1]"],
      operations: [
        { label: "H", qubits: [0], tone: "ok" },
        { label: "H", qubits: [1], tone: "ok" },
        { label: "CX", qubits: [0, 1], tone: "accent" },
        { label: "RZ(θ)", qubits: [1], tone: "neutral" },
        { label: "CX", qubits: [0, 1], tone: "accent" },
        { label: "H", qubits: [0], tone: "ok" },
        { label: "H", qubits: [1], tone: "ok" },
      ],
      note: "Since X = HZH, wrapping the RZZ(θ) circuit in Hadamards on both qubits rotates the interaction axis from Z⊗Z to X⊗X, reproducing RXX(θ) exactly.",
      noteJa: "X = HZH なので、RZZ(θ)回路を両方の量子ビットのアダマールで挟むと相互作用軸がZ⊗XからX⊗Xへ変わり、RXX(θ)が厳密に再現されます。",
    },
    code: `OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nrxx(pi/2) q[0], q[1];`,
    filename: "rxx-interaction.qasm",
    language: "openqasm",
    extraVariants: [
      {
        framework: "Qiskit",
        status: "native",
        language: "python",
        filename: "rxx_interaction.py",
        code: `from qiskit import QuantumCircuit\nimport numpy as np\n\nqc = QuantumCircuit(2)\nqc.rxx(np.pi / 2, 0, 1)\n\nFINAL_CIRCUIT = qc`,
      },
      {
        framework: "Cirq",
        status: "native",
        language: "python",
        filename: "rxx_interaction.py",
        code: `import cirq\n\nq0, q1 = cirq.LineQubit.range(2)\n# XXPowGate(t) applies exp(-i*pi*t/2 * XX) up to phase; t=0.5 matches RXX(pi/2)\ncircuit = cirq.Circuit(cirq.XXPowGate(exponent=0.5).on(q0, q1))\n\nFINAL_CIRCUIT = circuit`,
      },
    ],
    relatedSlugs: ["rzz-interaction-gate", "rx-rotation-gate", "hamiltonian-simulation-ising", "heisenberg-xxz-operator"],
    literature: [NIELSEN_CHUANG, OPENQASM3_PAPER],
  }),

  makeReferenceEntry({
    slug: "ecr-gate",
    title: "ECR (echoed cross-resonance) gate",
    titleJa: "ECR（エコー付きクロス共鳴）ゲート",
    category: "gates",
    categoryLabel: "Gates",
    categoryLabelJa: "ゲート",
    algorithmFamily: "Two-qubit gate",
    framework: "OpenQASM 3.0",
    verificationMethods: ["unitary_equivalence", "direct_math", "research_paper"],
    verification: "Direct matrix check · RZX(π/4)-X-RZX(-π/4) circuit reproduces the documented ECR matrix",
    method: "Multiply the 4×4 matrices for RZX(π/4), a control-qubit X flip, and RZX(-π/4) in circuit order and compare the product entry-by-entry against Qiskit's published ECRGate matrix.",
    result: "Pass · the product matches 1/√2·[[0,0,1,i],[0,0,i,1],[1,-i,0,0],[-i,1,0,0]] exactly in all 16 entries.",
    exportStatus: "Hardware-native on IBM backends · Qiskit and Cirq snippets available",
    provenance: "Curated reference",
    updatedAt: "2026-07-17",
    description:
      "The maximally entangling two-qubit gate native to IBM's newer superconducting processors, built from an 'echoed' pair of opposite-sign cross-resonance pulses around a control-qubit X flip, and locally equivalent to CX.",
    descriptionJa: "IBMの新しい超伝導プロセッサにネイティブな最大限にエンタングルする2量子ビットゲートで、制御量子ビットのX反転を挟んだ符号の異なる一対の「エコー」クロス共鳴パルスから構成され、局所的にCXと等価です。",
    introduction:
      "ECR replaced the plain cross-resonance gate as IBM's native two-qubit entangler because the echo sequence cancels unwanted always-on ZZ and IX crosstalk terms that a single cross-resonance pulse leaves behind, at the cost of needing an extra calibrated X pulse mid-sequence.",
    introductionJa: "ECRは、単一のクロス共鳴パルスが残してしまう望まない常時オンのZZやIXのクロストーク項をエコー列が打ち消すため、IBMのネイティブな2量子ビットエンタングラーとして単純なクロス共鳴ゲートに取って代わりました。その代償として、シーケンスの途中に較正されたXパルスが追加で必要です。",
    explanation:
      "ECR is defined as RZX(-π/4)·X₀·RZX(π/4) in circuit order, where RZX(θ)=exp(-iθZ⊗X/2) is itself a native two-qubit microwave-driven rotation (the underlying cross-resonance interaction), not a further-decomposable elementary gate. The X flip on the control between the two opposite-sign RZX pulses is the 'echo' that cancels unwanted terms and doubles the wanted ZX-type entangling action.",
    explanationJa: "ECRは回路順でRZX(-π/4)·X₀·RZX(π/4)として定義されます。ここでRZX(θ)=exp(-iθZ⊗X/2)はそれ自体がネイティブな2量子ビットのマイクロ波駆動回転（背後にあるクロス共鳴相互作用）であり、これ以上分解できる要素ゲートではありません。符号の異なる2つのRZXパルスの間で制御量子ビットに加えるX反転が「エコー」であり、望まない項を打ち消しつつ望むZX型のエンタングル作用を2倍にします。",
    explanationMd: `## Definition (Qiskit convention)

$$
\\mathrm{ECR} = \\frac{1}{\\sqrt2}\\begin{pmatrix} 0&0&1&i\\\\0&0&i&1\\\\1&-i&0&0\\\\-i&1&0&0 \\end{pmatrix}
$$

using Qiskit's \`ECRGate\` convention, with qubit 0 as the "control" side of the underlying RZX pulses. This matrix is maximally entangling and locally equivalent to $\\mathrm{CX}$ (same Weyl-chamber point), but is not identical to it.

## Action on basis states

$$
\\mathrm{ECR}|00\\rangle = \\tfrac{1}{\\sqrt2}(|10\\rangle - i|11\\rangle), \\qquad \\mathrm{ECR}|10\\rangle = \\tfrac{1}{\\sqrt2}(|00\\rangle + i|01\\rangle)
$$

Every computational-basis input is mapped to an equal-weight superposition of two basis states on the other qubit's block, confirming maximal entangling power from a product-state input.

## Decomposition

$$
\\mathrm{ECR} = \\mathrm{RZX}(-\\pi/4)\\cdot (X\\otimes I) \\cdot \\mathrm{RZX}(\\pi/4)
$$

$\\mathrm{RZX}(\\theta) = e^{-i\\theta (Z\\otimes X)/2}$ is itself a native two-qubit rotation driven directly by the cross-resonance microwave tone — it is not decomposed further here, since on IBM hardware it is a calibrated pulse, not a compiled circuit. Multiplying the three $4\\times4$ matrices in circuit order (RZX(π/4), then an X flip on qubit 0, then RZX(-π/4)) reproduces the ECR matrix above exactly, entry by entry.

## Key identities

- $\\mathrm{ECR}$ is a Clifford gate per Qiskit's \`ECRGate\` documentation, since it is locally equivalent to $\\mathrm{CX}$; standard Clifford-simulator and transpiler passes treat it as such.
- The "echo" structure — $\\mathrm{RZX}(-\\pi/4)$ and $\\mathrm{RZX}(\\pi/4)$ with an intervening $X$ on the control — is the standard technique (Sheldon et al. 2016) for canceling static $ZZ$ and $IX$/$IY$ crosstalk terms that a bare cross-resonance pulse would otherwise leave in the effective Hamiltonian.
- $\\mathrm{RZX}$ is not part of OpenQASM 3's core \`stdgates.inc\`; it is exposed as a hardware-native gate by IBM's backend dialect, the same status ECR itself has.
- Because ECR is locally equivalent to $\\mathrm{CX}$, any circuit expressed with $\\mathrm{CX}$ plus single-qubit gates can be retargeted to ECR plus single-qubit gates by a transpiler, which is exactly how Qiskit compiles CX-based circuits for ECR-native IBM backends.`,
    explanationMdJa: `## 定義（Qiskitの規約）

$$
\\mathrm{ECR} = \\frac{1}{\\sqrt2}\\begin{pmatrix} 0&0&1&i\\\\0&0&i&1\\\\1&-i&0&0\\\\-i&1&0&0 \\end{pmatrix}
$$

Qiskitの\`ECRGate\`の規約を用い、量子ビット0を背後のRZXパルスの「制御」側とします。この行列は最大限にエンタングルし、局所的に$\\mathrm{CX}$と等価です（同じWeylチェンバーの点）が、同一ではありません。

## 基底状態への作用

$$
\\mathrm{ECR}|00\\rangle = \\tfrac{1}{\\sqrt2}(|10\\rangle - i|11\\rangle), \\qquad \\mathrm{ECR}|10\\rangle = \\tfrac{1}{\\sqrt2}(|00\\rangle + i|01\\rangle)
$$

すべての計算基底の入力は、もう一方の量子ビットのブロック上の2つの基底状態の等重率重ね合わせに写されます。これは積状態の入力から最大限のエンタングル能力があることを確認します。

## 分解

$$
\\mathrm{ECR} = \\mathrm{RZX}(-\\pi/4)\\cdot (X\\otimes I) \\cdot \\mathrm{RZX}(\\pi/4)
$$

$\\mathrm{RZX}(\\theta) = e^{-i\\theta (Z\\otimes X)/2}$はそれ自体、クロス共鳴マイクロ波トーンによって直接駆動されるネイティブな2量子ビット回転です。IBMのハードウェアではコンパイルされた回路ではなく較正済みのパルスであるため、ここではこれ以上分解しません。3つの$4\\times4$行列を回路順（RZX(π/4)、次に量子ビット0のX反転、次にRZX(-π/4)）で掛け合わせると、上記のECR行列を全16成分について厳密に再現します。

## 主要な恒等式

- Qiskitの\`ECRGate\`ドキュメントによれば、ECRは局所的に$\\mathrm{CX}$と等価なのでクリフォードゲートです。標準的なクリフォードシミュレータやトランスパイラのパスもそのように扱います。
- 「エコー」構造 — 制御に挟んだXを伴う$\\mathrm{RZX}(-\\pi/4)$と$\\mathrm{RZX}(\\pi/4)$ — は、素のクロス共鳴パルスが有効ハミルトニアンに残してしまう静的な$ZZ$や$IX$/$IY$のクロストーク項を打ち消すための標準的な手法です（Sheldon et al. 2016）。
- $\\mathrm{RZX}$はOpenQASM 3のコアの\`stdgates.inc\`には含まれません。IBMのバックエンド方言によってハードウェアネイティブなゲートとして公開されており、ECR自体も同じ立場です。
- ECRは局所的に$\\mathrm{CX}$と等価であるため、$\\mathrm{CX}$と単一量子ビットゲートで表現された回路は、トランスパイラによってECRと単一量子ビットゲートに再ターゲットできます。これはまさにQiskitがCXベースの回路をECRネイティブなIBMバックエンド向けにコンパイルする方法です。`,
    tags: ["ecr", "cross resonance", "hardware native", "two qubit", "ibm"],
    resources: [
      { label: "Qubits", value: "2" },
      { label: "Depth", value: "1 native pulse (2× RZX + 1× X in the echo decomposition)" },
      { label: "Convention", value: "Qiskit ECRGate" },
    ],
    metadata: [
      { label: "Matrix", value: "1/√2 · [[0,0,1,i],[0,0,i,1],[1,-i,0,0],[-i,1,0,0]]" },
      { label: "Decomposition", value: "RZX(-π/4) · X₀ · RZX(π/4)" },
      { label: "Equivalence", value: "Locally equivalent to CX" },
      { label: "Gate family", value: "Clifford (per Qiskit ECRGate docs)" },
    ],
    sourceTitle: "Qiskit ECRGate documentation",
    sourceUrl: "https://docs.quantum.ibm.com/api/qiskit/qiskit.circuit.library.ECRGate",
    wires: ["q[0]", "q[1]"],
    operations: [{ label: "ECR", qubits: [0, 1], tone: "ok" }],
    outcomes: [
      { label: "P(|10⟩) from |00⟩", probability: 0.5 },
      { label: "P(|11⟩) from |00⟩", probability: 0.5 },
    ],
    decomposition: {
      summary: "RZX(π/4) · X (control) · RZX(-π/4)",
      summaryJa: "RZX(π/4) · X（制御）· RZX(-π/4)",
      wires: ["q[0]", "q[1]"],
      operations: [
        { label: "RZX(π/4)", qubits: [0, 1], tone: "accent" },
        { label: "X", qubits: [0], tone: "warn" },
        { label: "RZX(−π/4)", qubits: [0, 1], tone: "accent" },
      ],
      note: "The echoed cross-resonance sequence: an X flip on the control between two opposite-sign RZX pulses cancels unwanted crosstalk terms and doubles the wanted one. RZX(θ) = exp(−iθ Z⊗X/2) is itself a native two-qubit microwave rotation, not decomposed further here.",
      noteJa: "エコー付きクロス共鳴シーケンス: 符号の異なる2つのRZXパルスの間で制御にXを反転させることで、望まないクロストーク項を打ち消し望む項を2倍にします。RZX(θ) = exp(−iθ Z⊗X/2) はそれ自体ネイティブな2量子ビットのマイクロ波回転であり、ここではこれ以上分解しません。",
    },
    code: `OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\necr q[0], q[1];`,
    filename: "ecr.qasm",
    language: "openqasm",
    extraVariants: [
      {
        framework: "Qiskit",
        status: "native",
        language: "python",
        filename: "ecr.py",
        code: `from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(2)\nqc.ecr(0, 1)\n\nFINAL_CIRCUIT = qc`,
      },
      {
        framework: "Cirq",
        status: "native",
        language: "python",
        filename: "ecr.py",
        code: `import cirq\nimport numpy as np\n\nq0, q1 = cirq.LineQubit.range(2)\n# Cirq has no built-in ECR gate; define it directly from the verified matrix\necr_matrix = (1 / np.sqrt(2)) * np.array([\n    [0, 0, 1, 1j],\n    [0, 0, 1j, 1],\n    [1, -1j, 0, 0],\n    [-1j, 1, 0, 0],\n])\necr_gate = cirq.MatrixGate(ecr_matrix)  # width is read off the 4x4 matrix\ncircuit = cirq.Circuit(ecr_gate.on(q0, q1))\n\nFINAL_CIRCUIT = circuit`,
      },
    ],
    relatedSlugs: ["controlled-x-gate", "rzz-interaction-gate", "iswap-gate"],
    literature: [SHELDON_2016, MCKAY_2017],
  }),

  makeReferenceEntry({
    slug: "ccz-gate",
    title: "CCZ (doubly-controlled Z) gate",
    titleJa: "CCZ（二重制御Z）ゲート",
    category: "gates",
    categoryLabel: "Gates",
    categoryLabelJa: "ゲート",
    algorithmFamily: "Multi-qubit gate",
    framework: "OpenQASM 3.0",
    verificationMethods: ["truth_table", "unitary_equivalence", "textbook_citation"],
    verification: "Exhaustive truth table · CCZ applies a -1 phase iff all three qubits are |1⟩",
    method: "Apply CCZ to all eight computational-basis inputs and confirm only |111⟩ picks up a sign flip, with all other seven states unchanged.",
    result: "Pass · CCZ|111⟩ = -|111⟩ and CCZ leaves all other seven basis states unchanged.",
    exportStatus: "Native OpenQASM 3 · direct framework snippets available",
    provenance: "Curated reference",
    updatedAt: "2026-07-17",
    description:
      "The phase-only sibling of the Toffoli gate that applies a -1 phase exactly when all three qubits are |1⟩, symmetric in all three qubits and the natural three-qubit generalization of CZ.",
    descriptionJa: "3つの量子ビットすべてが|1⟩のときにちょうど-1の位相を適用する、Toffoliゲートの位相のみの兄弟分です。3つの量子ビットすべてに関して対称であり、CZの自然な3量子ビットへの一般化です。",
    introduction:
      "CCZ matters wherever Grover-style diffusion or oracle marking needs a symmetric multi-controlled phase rather than a bit flip: because it treats all three qubits identically, it composes more transparently into larger multi-controlled-phase constructions than Toffoli does.",
    introductionJa: "CCZが重要なのは、Grover型の拡散演算やオラクルの印付けが、ビット反転ではなく対称な多重制御位相を必要とする場合です。3つの量子ビットすべてを同一に扱うため、Toffoliよりも大きな多重制御位相の構成に、より透過的に組み込めます。",
    explanation:
      "CCZ = diag(1,1,1,1,1,1,1,-1) in the 8-dimensional computational basis, flipping the sign of |111⟩ alone. Since it differs from Toffoli only by a Hadamard conjugation on the target, CCZ inherits Toffoli's non-Clifford status and resource cost exactly.",
    explanationJa: "CCZは8次元計算基底でdiag(1,1,1,1,1,1,1,-1)であり、|111⟩のみの符号を反転させます。対象へのアダマール共役だけがToffoliと異なるため、CCZはToffoliの非クリフォード性と資源コストをそのまま受け継ぎます。",
    explanationMd: `## Definition

$$
\\mathrm{CCZ}|a,b,c\\rangle = (-1)^{a\\wedge b\\wedge c}\\,|a,b,c\\rangle
$$

As an $8\\times 8$ diagonal matrix, $\\mathrm{CCZ} = \\mathrm{diag}(1,1,1,1,1,1,1,-1)$ in the ordered basis $|000\\rangle,\\dots,|111\\rangle$ — the identity everywhere except a sign flip on $|111\\rangle$.

## Action on basis states and symmetry

Only $|111\\rangle$ picks up a phase; the other seven computational-basis states are completely unaffected. Because the matrix is symmetric under any permutation of the three qubits, $\\mathrm{CCZ}$ has no distinguished "target" — unlike Toffoli, where swapping the target with a control changes the gate.

## Decomposition

$$
\\mathrm{CCZ} = (I\\otimes I\\otimes H)\\;\\mathrm{CCX}\\;(I\\otimes I\\otimes H)
$$

exactly mirroring the two-qubit identity $\\mathrm{CZ} = (I\\otimes H)\\,\\mathrm{CX}\\,(I\\otimes H)$: conjugating the Toffoli's target by Hadamard converts its controlled bit-flip ($X$ on the control-11 block) into a controlled phase-flip ($HXH=Z$ on that same block), leaving the control-not-both-1 blocks at identity in both cases.

## Key identities

- $\\mathrm{CCZ}^2 = I^{\\otimes 3}$: applying the same doubly-controlled phase twice restores the input.
- $\\mathrm{CCZ}$ is non-Clifford, exactly like Toffoli: it inherits the same resource cost (6 CNOT + 2 H + 7 T-family gates, via the Toffoli decomposition sandwiched by the extra pair of target Hadamards, which cancel two of Toffoli's own Hadamards).
- $\\mathrm{CCZ}$ is the natural building block for multi-controlled-phase oracles in amplitude amplification and Grover-style search, since its full symmetry across all three qubits makes larger $C^nZ$ constructions compose more uniformly than $C^nX$ ones.`,
    explanationMdJa: `## 定義

$$
\\mathrm{CCZ}|a,b,c\\rangle = (-1)^{a\\wedge b\\wedge c}\\,|a,b,c\\rangle
$$

$8\\times 8$の対角行列として、順序付き基底$|000\\rangle,\\dots,|111\\rangle$において$\\mathrm{CCZ} = \\mathrm{diag}(1,1,1,1,1,1,1,-1)$です。|111⟩の符号反転を除いてすべて恒等です。

## 基底状態への作用と対称性

|111⟩のみが位相を受け取り、他の7つの計算基底状態はまったく影響を受けません。この行列は3つの量子ビットの任意の入れ替えに対して対称であるため、CCZには区別された「対象」がありません。対象と制御を入れ替えるとゲートが変わるToffoliとは異なります。

## 分解

$$
\\mathrm{CCZ} = (I\\otimes I\\otimes H)\\;\\mathrm{CCX}\\;(I\\otimes I\\otimes H)
$$

これは2量子ビットの恒等式$\\mathrm{CZ} = (I\\otimes H)\\,\\mathrm{CX}\\,(I\\otimes H)$を正確に反映しています。Toffoliの対象をアダマールで共役すると、その制御ビット反転（制御=11のブロックでの$X$）が制御位相反転（同じブロックでの$HXH=Z$）に変わり、両方の制御が1でないブロックはどちらの場合も恒等のままです。

## 主要な恒等式

- $\\mathrm{CCZ}^2 = I^{\\otimes 3}$: 同じ二重制御位相を2回適用すると入力に戻ります。
- CCZはToffoliとまったく同様に非クリフォードです。Toffoli分解（対象への追加のアダマール対に挟まれ、Toffoli自身のアダマールの一部を打ち消す形）を介して、同じ資源コスト（6個のCNOT + 2個のH + 7個のT系ゲート）を受け継ぎます。
- CCZは振幅増幅やGrover型探索における多重制御位相オラクルの自然な構成要素です。3つの量子ビットすべてに対する完全な対称性により、より大きな$C^nZ$構成は$C^nX$構成よりも一様に組み合わせられます。`,
    tags: ["multi-controlled", "phase", "three qubit", "non-clifford"],
    resources: [
      { label: "Qubits", value: "3" },
      { label: "Depth", value: "1 native / 3-gate decomposition around Toffoli (H, CCX, H)" },
      { label: "T-count", value: "7 (inherited from Toffoli)" },
    ],
    metadata: [
      { label: "Truth table", value: "phase-flip iff a AND b AND c" },
      { label: "Decomposition", value: "H(target)·CCX·H(target)" },
      { label: "Self-inverse", value: "CCZ² = I" },
      { label: "Gate family", value: "Non-Clifford (locally equivalent to CCX/Toffoli)" },
    ],
    sourceTitle: "OpenQASM 3 standard gate set",
    sourceUrl: "https://openqasm.com/language/gates.html",
    wires: ["q[0]", "q[1]", "q[2]"],
    operations: [{ label: "CCZ", qubits: [0, 1, 2], tone: "warn" }],
    outcomes: [
      { label: "|111⟩ phase-flipped", probability: 1 },
      { label: "all other 7 inputs unchanged", probability: 1 },
    ],
    decomposition: {
      summary: "H(target) · CCX · H(target)",
      summaryJa: "H（対象）· CCX · H（対象）",
      wires: ["q[0]", "q[1]", "q[2]"],
      operations: [
        { label: "H", qubits: [2], tone: "ok" },
        { label: "CCX", qubits: [0, 1, 2], tone: "warn" },
        { label: "H", qubits: [2], tone: "ok" },
      ],
      note: "CCZ = (I⊗I⊗H)·CCX·(I⊗I⊗H): conjugating the Toffoli's target by Hadamard converts the controlled bit-flip into a controlled phase-flip, exactly as CZ = (I⊗H)·CX·(I⊗H) does for two qubits.",
      noteJa: "CCZ = (I⊗I⊗H)·CCX·(I⊗I⊗H): Toffoliの対象をアダマールで共役すると、制御ビット反転が制御位相反転に変わります。2量子ビットにおけるCZ = (I⊗H)·CX·(I⊗H) とまったく同じです。",
    },
    code: `OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[3] q;\nx q[0];\nx q[1];\nx q[2];\nh q[2];\nccx q[0], q[1], q[2];\nh q[2];`,
    filename: "ccz.qasm",
    language: "openqasm",
    extraVariants: [
      {
        framework: "Qiskit",
        status: "native",
        language: "python",
        filename: "ccz.py",
        code: `from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(3)\nqc.x([0, 1, 2])\nqc.ccz(0, 1, 2)\n\nFINAL_CIRCUIT = qc`,
      },
      {
        framework: "Cirq",
        status: "native",
        language: "python",
        filename: "ccz.py",
        code: `import cirq\n\nq0, q1, q2 = cirq.LineQubit.range(3)\ncircuit = cirq.Circuit(cirq.X(q0), cirq.X(q1), cirq.X(q2), cirq.CCZ(q0, q1, q2))\n\nFINAL_CIRCUIT = circuit`,
      },
    ],
    relatedSlugs: ["toffoli-ccx-gate", "controlled-z-gate", "controlled-phase-gate"],
    literature: [NIELSEN_CHUANG, OPENQASM3_PAPER],
  }),

  makeReferenceEntry({
    slug: "dcx-gate",
    title: "DCX (double-CNOT) gate",
    titleJa: "DCX（二重CNOT）ゲート",
    category: "gates",
    categoryLabel: "Gates",
    categoryLabelJa: "ゲート",
    algorithmFamily: "Two-qubit gate",
    framework: "OpenQASM 3.0",
    verificationMethods: ["truth_table", "unitary_equivalence", "textbook_citation"],
    verification: "Exhaustive truth table · DCX matches the composition of two reversed CNOTs on all four basis states",
    method: "Track all four computational-basis inputs through CX(q0→q1) followed by CX(q1→q0) and compare the resulting permutation against the direct DCX definition.",
    result: "Pass · |00⟩→|00⟩, |01⟩→|11⟩, |10⟩→|01⟩, |11⟩→|10⟩, exactly the 3-cycle on {|01⟩,|10⟩,|11⟩} produced by the two-CNOT composition.",
    exportStatus: "Native in Qiskit's circuit library · direct framework snippets available",
    provenance: "Curated reference",
    updatedAt: "2026-07-17",
    description:
      "A two-qubit permutation gate defined as two CNOTs with reversed control and target applied back to back — a genuinely different two-CNOT gate from SWAP (which uses three), and notable for not being self-inverse.",
    descriptionJa: "制御と対象を反転させた2つのCNOTを連続して適用する2量子ビットの置換ゲートです。3つのCNOTを使うSWAPとは本質的に異なる2CNOTゲートであり、自己逆演算ではない点が特徴的です。",
    introduction:
      "DCX is useful less as an algorithmic primitive and more as a compiler/transpiler building block: it is literally the two-CNOT circuit that appears naturally when routing swaps are partially applied, and Qiskit exposes it as a named gate so transpilers do not have to re-recognize the pattern.",
    introductionJa: "DCXはアルゴリズム上の基本要素としてよりも、コンパイラ／トランスパイラの構成要素として有用です。ルーティングのスワップが部分的に適用されたときに自然に現れる、文字通り2CNOTの回路であり、Qiskitはトランスパイラがそのパターンを再認識せずに済むよう、これを名前付きゲートとして公開しています。",
    explanation:
      "DCX = CX(q1→q0)·CX(q0→q1) applied to a two-qubit register permutes the four basis states as a fixed point on |00⟩ plus a 3-cycle on {|01⟩,|10⟩,|11⟩}. Because a 3-cycle is not its own inverse, DCX ≠ DCX†, unlike most two-qubit Clifford gates in this catalog.",
    explanationJa: "DCX = CX(q1→q0)·CX(q0→q1) を2量子ビットレジスタに適用すると、4つの基底状態は|00⟩の不動点と{|01⟩,|10⟩,|11⟩}上の3-サイクルとして置換されます。3-サイクルはそれ自身の逆ではないため、このカタログのほとんどの2量子ビットクリフォードゲートと異なり、DCX ≠ DCX† です。",
    explanationMd: `## Definition

In the $q[0]$-leftmost basis ordering used throughout this catalog, composing $\\mathrm{CX}(q_0\\!\\to\\!q_1)$ then $\\mathrm{CX}(q_1\\!\\to\\!q_0)$ gives

$$
\\mathrm{DCX} = \\begin{pmatrix} 1&0&0&0\\\\0&0&1&0\\\\0&0&0&1\\\\0&1&0&0 \\end{pmatrix}
$$

in the ordered basis $\\{|00\\rangle,|01\\rangle,|10\\rangle,|11\\rangle\\}$ (frameworks using a little-endian statevector ordering will print an index-permuted version of this same matrix).

## Action on basis states

$$
\\mathrm{DCX}|00\\rangle = |00\\rangle, \\qquad \\mathrm{DCX}|01\\rangle = |11\\rangle, \\qquad \\mathrm{DCX}|10\\rangle = |01\\rangle, \\qquad \\mathrm{DCX}|11\\rangle = |10\\rangle
$$

$|00\\rangle$ is a fixed point; the other three basis states form a single 3-cycle $|01\\rangle\\to|11\\rangle\\to|10\\rangle\\to|01\\rangle$, verified by direct basis-state tracking through both CNOTs.

## Decomposition

$$
\\mathrm{DCX} = \\mathrm{CX}(q_1\\!\\to\\!q_0)\\cdot \\mathrm{CX}(q_0\\!\\to\\!q_1)
$$

This is not really a "decomposition" in the sense of compiling a hardware-hard gate down to easier ones — two reversed CNOTs *is* the definition of DCX. The gate exists as a named primitive because this exact two-CNOT pattern recurs often enough in routing and partial-SWAP contexts to be worth naming directly.

## Key identities

- $\\mathrm{DCX}$ is Clifford, since it is a product of two Clifford ($\\mathrm{CX}$) gates.
- $\\mathrm{DCX}^3 = I\\otimes I$ (period 3, from the 3-cycle structure), but $\\mathrm{DCX}^2 \\ne I\\otimes I$ — unlike $\\mathrm{CX}$, $\\mathrm{CZ}$, or $\\mathrm{SWAP}$, $\\mathrm{DCX}$ is **not** self-inverse: $\\mathrm{DCX}^\\dagger = \\mathrm{DCX}^2 \\ne \\mathrm{DCX}$.
- $\\mathrm{DCX}$ differs from $\\mathrm{SWAP}$ (three alternating CNOTs) by exactly one CNOT: $\\mathrm{SWAP} = \\mathrm{CX}(q_0\\!\\to\\!q_1)\\cdot\\mathrm{DCX}$, so appending one more CNOT to DCX completes a full SWAP.
- Because DCX is built from only two CNOTs rather than three, it is cheaper than a full SWAP whenever a circuit only needs the specific 3-cycle permutation rather than a genuine two-qubit exchange.`,
    explanationMdJa: `## 定義

このカタログ全体で使われる$q[0]$を先頭とする基底の順序において、$\\mathrm{CX}(q_0\\!\\to\\!q_1)$の後に$\\mathrm{CX}(q_1\\!\\to\\!q_0)$を合成すると次が得られます。

$$
\\mathrm{DCX} = \\begin{pmatrix} 1&0&0&0\\\\0&0&1&0\\\\0&0&0&1\\\\0&1&0&0 \\end{pmatrix}
$$

順序付き基底$\\{|00\\rangle,|01\\rangle,|10\\rangle,|11\\rangle\\}$において（リトルエンディアンの状態ベクトル順序を使うフレームワークでは、同じ行列のインデックスを入れ替えたものが表示されます）。

## 基底状態への作用

$$
\\mathrm{DCX}|00\\rangle = |00\\rangle, \\qquad \\mathrm{DCX}|01\\rangle = |11\\rangle, \\qquad \\mathrm{DCX}|10\\rangle = |01\\rangle, \\qquad \\mathrm{DCX}|11\\rangle = |10\\rangle
$$

|00⟩は不動点です。他の3つの基底状態は$|01\\rangle\\to|11\\rangle\\to|10\\rangle\\to|01\\rangle$という単一の3-サイクルを形成します。これは両方のCNOTを通じて基底状態を直接追跡することで検証済みです。

## 分解

$$
\\mathrm{DCX} = \\mathrm{CX}(q_1\\!\\to\\!q_0)\\cdot \\mathrm{CX}(q_0\\!\\to\\!q_1)
$$

これは、ハードウェア的に難しいゲートをより簡単なものへコンパイルするという意味での「分解」ではありません。反転した2つのCNOTがそのままDCXの定義です。このゲートが名前付きの基本要素として存在するのは、この正確な2CNOTパターンがルーティングや部分的SWAPの文脈で十分頻繁に現れ、直接名前を付ける価値があるためです。

## 主要な恒等式

- DCXは、2つのクリフォード（CX）ゲートの積であるためクリフォードです。
- $\\mathrm{DCX}^3 = I\\otimes I$（3-サイクル構造による周期3）ですが、$\\mathrm{DCX}^2 \\ne I\\otimes I$です。CX・CZ・SWAPと異なり、DCXは自己逆演算では**ありません**: $\\mathrm{DCX}^\\dagger = \\mathrm{DCX}^2 \\ne \\mathrm{DCX}$。
- DCXはSWAP（3つの交互のCNOT）とちょうど1つのCNOTだけ異なります: $\\mathrm{SWAP} = \\mathrm{CX}(q_0\\!\\to\\!q_1)\\cdot\\mathrm{DCX}$なので、DCXにもう1つCNOTを加えると完全なSWAPになります。
- DCXは3つではなく2つのCNOTだけから構成されるため、回路が真の2量子ビット交換ではなく特定の3-サイクル置換だけを必要とする場合、完全なSWAPより安価です。`,
    tags: ["double cnot", "two qubit", "clifford", "routing"],
    resources: [
      { label: "Qubits", value: "2" },
      { label: "Depth", value: "2 CNOTs (definitional)" },
      { label: "Order", value: "DCX³ = I (period 3)" },
    ],
    metadata: [
      { label: "Matrix", value: "3-cycle on {01,10,11}, fixes 00 (q[0]-leftmost convention)" },
      { label: "Decomposition", value: "CX(0→1) · CX(1→0)" },
      { label: "Self-inverse", value: "No: DCX† = DCX² ≠ DCX" },
      { label: "Gate family", value: "Clifford" },
    ],
    sourceTitle: "Qiskit DCXGate documentation",
    sourceUrl: "https://docs.quantum.ibm.com/api/qiskit/qiskit.circuit.library.DCXGate",
    wires: ["q[0]", "q[1]"],
    operations: [{ label: "DCX", qubits: [0, 1], tone: "accent" }],
    outcomes: [
      { label: "|01⟩ → |11⟩", probability: 1 },
      { label: "|10⟩ → |01⟩", probability: 1 },
    ],
    decomposition: {
      summary: "CX(0→1) · CX(1→0)",
      summaryJa: "CX(0→1) · CX(1→0)",
      wires: ["q[0]", "q[1]"],
      operations: [
        { label: "CX", qubits: [0, 1], tone: "accent" },
        { label: "CX", qubits: [1, 0], tone: "accent" },
      ],
      note: "Two CNOTs with reversed control and target is the definition of DCX, not a further compilation — verified by tracking all four basis states through both CNOTs.",
      noteJa: "制御と対象を反転させた2つのCNOTがDCXの定義そのものであり、それ以上のコンパイルではありません。4つの基底状態すべてを両方のCNOTを通じて追跡して検証済みです。",
    },
    code: `OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nx q[1];\ncx q[0], q[1];\ncx q[1], q[0];`,
    filename: "dcx.qasm",
    language: "openqasm",
    extraVariants: [
      {
        framework: "Qiskit",
        status: "native",
        language: "python",
        filename: "dcx.py",
        code: `from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(2)\nqc.x(1)\nqc.dcx(0, 1)\n\nFINAL_CIRCUIT = qc`,
      },
      {
        framework: "Cirq",
        status: "native",
        language: "python",
        filename: "dcx.py",
        code: `import cirq\n\nq0, q1 = cirq.LineQubit.range(2)\n# Cirq has no built-in DCX gate; it is literally two reversed CNOTs\ncircuit = cirq.Circuit(cirq.X(q1), cirq.CNOT(q0, q1), cirq.CNOT(q1, q0))\n\nFINAL_CIRCUIT = circuit`,
      },
    ],
    relatedSlugs: ["controlled-x-gate", "swap-gate", "iswap-gate"],
    literature: [NIELSEN_CHUANG, OPENQASM3_PAPER],
  }),
];
