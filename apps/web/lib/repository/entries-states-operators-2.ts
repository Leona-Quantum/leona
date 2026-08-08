import type { PublicRepositoryEntry } from "./types";
import { makeReferenceEntry } from "./factory";

// Batch 2 of the states/operators catalog-expansion series (2026-07-17). Entries
// use makeReferenceEntry from ./factory; scripts/check-repository-data.mjs
// validates every record. See entries-states-operators.ts for the original batch.
export const STATE_OPERATOR_ENTRIES_2: PublicRepositoryEntry[] = [
  makeReferenceEntry({
    slug: "plus-minus-states",
    title: "Hadamard-basis states |+⟩ and |−⟩",
    titleJa: "アダマール基底状態 |+⟩ と |−⟩",
    category: "states",
    categoryLabel: "States",
    categoryLabelJa: "状態",
    algorithmFamily: "Superposition state",
    framework: "Qiskit",
    verification: "Closed-form amplitude and eigenvalue check · Hadamard construction",
    verificationMethods: ["direct_math", "construction", "textbook_citation"],
    method:
      "The prepared amplitudes (1/√2, ±1/√2) were compared exactly against the |+⟩, |−⟩ definitions, and each state was checked to be an exact eigenstate of X (eigenvalue +1 for |+⟩, −1 for |−⟩) by direct matrix multiplication.",
    result:
      "Pass · H|0⟩ and X;H|0⟩ reproduce |+⟩ and |−⟩ exactly, and X|+⟩=|+⟩, X|−⟩=−|−⟩ hold with no residual off-axis component.",
    exportStatus: "Native Qiskit, PennyLane, and Cirq · OpenQASM conversion is mechanical (h/x only)",
    provenance: "Curated reference",
    updatedAt: "2026-07-17",
    description:
      "The Hadamard-basis (X-basis) states |+⟩ and |−⟩: the eigenstates of the Pauli-X operator, produced from |0⟩/|1⟩ by a single Hadamard gate.",
    descriptionJa: "アダマール基底（X基底）状態|+⟩と|−⟩：パウリX演算子の固有状態であり、|0⟩/|1⟩から単一のアダマールゲートで得られます。",
    introduction:
      "Every single-qubit protocol that needs a second, mutually unbiased measurement basis reaches for |+⟩/|−⟩ first: they are equal-weight superpositions in the computational (Z) basis, yet perfectly distinguishable in the X basis, making them the standard tool for basis-mismatch protocols like BB84 and for phase-kickback tricks in oracle-based algorithms.",
    introductionJa:
      "第2の相互不偏な測定基底を必要とする単一量子ビットのプロトコルはまず|+⟩/|−⟩に頼ります。これらは計算（Z）基底では等しい重みの重ね合わせですが、X基底では完全に識別可能であり、BB84のような基底不一致プロトコルやオラクルベースのアルゴリズムにおける位相キックバックの標準的な道具です。",
    explanation:
      "|+⟩ = H|0⟩ and |−⟩ = H|1⟩ are the two eigenstates of X, related to the computational basis by an equal-weight superposition that differs only in the relative phase between |0⟩ and |1⟩.",
    explanationJa:
      "|+⟩ = H|0⟩、|−⟩ = H|1⟩はXの2つの固有状態であり、計算基底とは|0⟩と|1⟩の間の相対位相のみが異なる等しい重みの重ね合わせで関係付けられます。",
    explanationMd: String.raw`The Hadamard-basis states are

$$|+\rangle = \frac{|0\rangle+|1\rangle}{\sqrt2}, \qquad |-\rangle = \frac{|0\rangle-|1\rangle}{\sqrt2}.$$

**Eigenstates of $X$.** Direct matrix multiplication gives $X|+\rangle = |+\rangle$ and $X|-\rangle = -|-\rangle$, so $\{|+\rangle,|-\rangle\}$ is the eigenbasis of the Pauli-$X$ operator, exactly as $\{|0\rangle,|1\rangle\}$ is the eigenbasis of $Z$. Because $HXH=Z$ and $HZH=X$ ($H$ conjugation swaps the two Pauli operators), the Hadamard gate is precisely the change-of-basis unitary between the $Z$ and $X$ eigenbases: $|+\rangle=H|0\rangle$, $|-\rangle=H|1\rangle$.

**Mutual unbiasedness.** $|\langle 0|+\rangle|^2 = |\langle 0|-\rangle|^2 = |\langle1|+\rangle|^2=|\langle1|-\rangle|^2 = 1/2$: every computational-basis state has equal overlap with every Hadamard-basis state. This is the defining property of *mutually unbiased bases* — measuring a $Z$-eigenstate in the $X$ basis (or vice versa) yields a uniformly random outcome, which is exactly the security mechanism behind the BB84 quantum key distribution protocol's second basis choice.

**Phase kickback.** Preparing an ancilla in $|-\rangle$ before a controlled-$U_f$ oracle is the standard trick that converts a classical bit-flip oracle $|x\rangle|y\rangle \mapsto |x\rangle|y\oplus f(x)\rangle$ into a phase oracle $|x\rangle|-\rangle \mapsto (-1)^{f(x)}|x\rangle|-\rangle$, because $|-\rangle$ is an eigenstate of the flip with eigenvalue $-1$. This is the mechanism used by Deutsch–Jozsa, Bernstein–Vazirani, Simon's algorithm, and Grover's diffusion oracle.

**Stabilizer view.** $|+\rangle$ is stabilized by $X$ (the unique $+1$ eigenstate) and $|-\rangle$ by $-X$; both are single-qubit stabilizer states, sitting alongside $|0\rangle,|1\rangle,|+i\rangle,|-i\rangle$ as the six single-qubit states reachable by Clifford operations from $|0\rangle$ — the vertices of the stabilizer octahedron on the Bloch sphere, in contrast to the off-axis magic states elsewhere in this catalog.`,
    explanationMdJa: String.raw`アダマール基底状態は

$$|+\rangle = \frac{|0\rangle+|1\rangle}{\sqrt2}, \qquad |-\rangle = \frac{|0\rangle-|1\rangle}{\sqrt2}$$

です。

**Xの固有状態。** 直接の行列計算により$X|+\rangle = |+\rangle$、$X|-\rangle = -|-\rangle$が成り立ち、$\{|+\rangle,|-\rangle\}$はパウリ$X$演算子の固有基底です。ちょうど$\{|0\rangle,|1\rangle\}$が$Z$の固有基底であるのと同様です。$HXH = Z$、$HZH = X$（H共役が2つのパウリ演算子を入れ替える）であるため、アダマールゲートはまさに$Z$基底と$X$基底間の基底変換ユニタリであり、$|+\rangle=H|0\rangle$、$|-\rangle=H|1\rangle$です。

**相互不偏性。** $|\langle 0|+\rangle|^2 = |\langle 0|-\rangle|^2 = |\langle1|+\rangle|^2=|\langle1|-\rangle|^2 = 1/2$であり、すべての計算基底状態はすべてのアダマール基底状態と等しい重なりを持ちます。これは相互不偏基底の定義的性質であり、$Z$固有状態を$X$基底で測定する（あるいはその逆）と一様にランダムな結果が得られます。これはまさにBB84量子鍵配送プロトコルの第2基底選択の安全性の仕組みです。

**位相キックバック。** 制御$U_f$オラクルの前に補助量子ビットを$|-\rangle$に準備することは、古典的なビット反転オラクル$|x\rangle|y\rangle \mapsto |x\rangle|y\oplus f(x)\rangle$を位相オラクル$|x\rangle|-\rangle \mapsto (-1)^{f(x)}|x\rangle|-\rangle$に変換する標準的なトリックです。$|-\rangle$が反転の固有値$-1$の固有状態だからです。これはDeutsch–Jozsa、Bernstein–Vazirani、Simonのアルゴリズム、Groverの拡散オラクルで使われる仕組みです。

**スタビライザーの観点。** $|+\rangle$は$X$（唯一の+1固有状態）で、$|-\rangle$は$-X$で安定化されます。両方とも単一量子ビットのスタビライザー状態であり、$|0\rangle,|1\rangle,|+i\rangle,|-i\rangle$とともに、$|0\rangle$からクリフォード操作で到達可能な6つの単一量子ビット状態、すなわちブロッホ球上のスタビライザー八面体の頂点をなします。これは本カタログの他の項目にある軸外のマジック状態とは対照的です。`,
    tags: ["hadamard basis", "x-basis", "mutually unbiased bases", "phase kickback"],
    resources: [
      { label: "Qubits", value: "1" },
      { label: "Depth", value: "1 gate (H, or X+H)" },
      { label: "Eigenvalue", value: "X = ±1" },
    ],
    metadata: [
      { label: "|+⟩", value: "(|0⟩+|1⟩)/√2, X-eigenvalue +1" },
      { label: "|−⟩", value: "(|0⟩−|1⟩)/√2, X-eigenvalue −1" },
      { label: "Basis", value: "Mutually unbiased with {|0⟩,|1⟩}" },
    ],
    sourceTitle: "Quantum Computation and Quantum Information",
    sourceUrl: "https://doi.org/10.1017/CBO9780511976667",
    wires: ["q[0] (|+⟩)", "q[1] (|−⟩)"],
    operations: [
      { label: "H", qubits: [0], tone: "accent" },
      { label: "X", qubits: [1], tone: "ok" },
      { label: "H", qubits: [1], tone: "accent" },
    ],
    outcomes: [
      { label: "q[0] (|+⟩) Z-basis outcome", probability: 0.5 },
      { label: "q[1] (|−⟩) Z-basis outcome", probability: 0.5 },
    ],
    code: `import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector, Operator

def plus_state() -> QuantumCircuit:
    qc = QuantumCircuit(1)
    qc.h(0)
    return qc

def minus_state() -> QuantumCircuit:
    qc = QuantumCircuit(1)
    qc.x(0)
    qc.h(0)
    return qc

X = Operator.from_label("X").data
plus = Statevector.from_instruction(plus_state())
minus = Statevector.from_instruction(minus_state())

print("|+> =", plus.data)   # [0.7071, 0.7071]
print("|-> =", minus.data)  # [0.7071, -0.7071]
print("X|+> = +|+>:", np.allclose(X @ plus.data, plus.data))
print("X|-> = -|->:", np.allclose(X @ minus.data, -minus.data))

FINAL_CIRCUIT = plus_state()
`,
    filename: "plus_minus_states.py",
    language: "python",
    extraVariants: [
      {
        framework: "PennyLane",
        status: "native",
        language: "python",
        filename: "plus_minus_states.py",
        code: `import pennylane as qml

dev = qml.device("default.qubit", wires=2)

@qml.qnode(dev)
def plus_minus():
    qml.Hadamard(wires=0)      # |+>
    qml.PauliX(wires=1)
    qml.Hadamard(wires=1)      # |->
    return qml.state()

print(plus_minus())
\n\nFINAL_CIRCUIT = plus_minus`,
      },
    ],
    relatedSlugs: ["hadamard-gate", "bell-state-qiskit", "pauli-x-operator"],
    literature: [
      {
        title: "Quantum Computation and Quantum Information: 10th Anniversary Edition",
        authors: "Michael A. Nielsen and Isaac L. Chuang",
        year: "2010",
        url: "https://doi.org/10.1017/cbo9780511976667",
        relevance:
          "Standard textbook definition of the Hadamard/X-eigenbasis states and their role as the second measurement basis in mutually-unbiased-basis protocols such as BB84.",
        relevanceJa: "アダマール／X固有基底状態の標準的な教科書での定義と、BB84のような相互不偏基底プロトコルにおける第2測定基底としての役割です。",
      },
    ],
  }),
  makeReferenceEntry({
    slug: "werner-state",
    title: "Werner state (two-qubit)",
    titleJa: "ワーナー状態（2量子ビット）",
    category: "states",
    categoryLabel: "States",
    categoryLabelJa: "状態",
    algorithmFamily: "Mixed-state entanglement",
    framework: "Qiskit",
    verification: "Closed-form eigenvalue / PPT threshold check · convex-mixture construction",
    verificationMethods: ["direct_math", "construction", "research_paper"],
    method:
      "The density matrix ρ_W(p) = p|Ψ⁻⟩⟨Ψ⁻| + (1−p)I/4 was checked to be a valid density matrix (Hermitian, trace 1, positive semidefinite) for all p∈[0,1] by direct eigenvalue computation, and its partial transpose's eigenvalues were computed in closed form to confirm the p ≤ 1/3 separability threshold in the singlet-fraction convention used here.",
    result:
      "Pass · ρ_W(p) has eigenvalues {p+(1-p)/4 (×1, on the singlet), (1-p)/4 (×3, on the triplet)}, all non-negative for p∈[0,1]; the partial transpose has a negative eigenvalue exactly when p>1/3, matching the known PPT-separability threshold for this state family.",
    exportStatus: "Native Qiskit quantum_info (DensityMatrix) · no gate-level circuit representation (mixed state)",
    provenance: "Curated reference",
    updatedAt: "2026-07-17",
    description:
      "The Werner state ρ_W(p) = p|Ψ⁻⟩⟨Ψ⁻| + (1−p)I/4: a one-parameter family interpolating between the maximally entangled singlet and the maximally mixed state, historically significant as the first known example separating entanglement from Bell-inequality violation.",
    descriptionJa:
      "ワーナー状態ρ_W(p) = p|Ψ⁻⟩⟨Ψ⁻| + (1−p)I/4：最大エンタングルの一重項状態と最大混合状態の間を補間する1パラメータ族。エンタングルメントとベル不等式の違反を分離する最初の既知の例として歴史的に重要です。",
    introduction:
      "Werner's 1989 construction was designed to answer a specific question: can an entangled state still behave classically under all projective measurements? By mixing the singlet with white noise in a tunable ratio, Werner produced a family that is provably entangled above one threshold yet provably compatible with a local hidden-variable model up to a higher threshold — showing entanglement and Bell-inequality violation are not the same thing.",
    introductionJa:
      "Wernerの1989年の構成は、特定の疑問に答えるために設計されました。エンタングル状態はすべての射影測定の下でなお古典的に振る舞えるか、という疑問です。一重項を調整可能な比率でホワイトノイズと混ぜることで、Wernerはあるしきい値以上で証明可能にエンタングルでありながら、より高いしきい値まで局所隠れ変数モデルと証明可能に整合する状態族を作りました。これはエンタングルメントとベル不等式の違反が同じものではないことを示しています。",
    explanation:
      "ρ_W(p) mixes the singlet Bell state with the maximally mixed state in proportion p:(1−p); it is separable for p≤1/3 and entangled for p>1/3, in the convention where p is the weight on the pure singlet.",
    explanationJa:
      "ρ_W(p)は一重項ベル状態と最大混合状態をp:(1−p)の比率で混合します。pを純粋な一重項の重みとする本エントリの規約では、p≤1/3で分離可能、p>1/3でエンタングルです。",
    explanationMd: String.raw`The two-qubit Werner state, in the **singlet-fraction convention** used throughout this entry, is

$$\rho_W(p) = p\,|\Psi^-\rangle\langle\Psi^-| + (1-p)\,\frac{I}{4}, \qquad |\Psi^-\rangle = \frac{|01\rangle-|10\rangle}{\sqrt2}, \qquad p\in[0,1].$$

(Other papers parametrize Werner states by mixing the singlet with the *other three* Bell states rather than with $I/4$ directly; that convention shifts the numerical thresholds below, so the convention must always be stated alongside any threshold value.)

**Spectrum.** Because $|\Psi^-\rangle\langle\Psi^-|$ and $I/4$ commute (both are diagonal in the Bell basis), $\rho_W(p)$ has eigenvalue $p + (1-p)/4$ on $|\Psi^-\rangle$ and $(1-p)/4$ (three-fold degenerate) on the symmetric triplet $\{|\Phi^+\rangle,|\Phi^-\rangle,|\Psi^+\rangle\}$. Both eigenvalues are non-negative for every $p\in[0,1]$, so $\rho_W(p)$ is a valid density matrix everywhere on this interval.

**Separability threshold.** Applying the partial transpose $\rho_W(p)^{T_B}$ and computing its eigenvalues directly gives one eigenvalue $\tfrac{1-3p}{4}$ (the rest stay non-negative); by the Peres–Horodecki (PPT) criterion, which is necessary and sufficient for separability of two-qubit states, $\rho_W(p)$ is **separable iff $p \le 1/3$** and entangled (and distillable, since PPT $=$ separable in $2\times2$) for $p>1/3$. At $p=1$, $\rho_W(1)=|\Psi^-\rangle\langle\Psi^-|$ recovers the pure maximally entangled singlet; at $p=0$, $\rho_W(0)=I/4$ recovers the maximally mixed state.

**Local hidden-variable model.** Werner's original 1989 result goes further than the separability threshold: he showed that for $p\le 1/2$, $\rho_W(p)$ admits an explicit local hidden-variable (LHV) model reproducing the statistics of *every* projective (von Neumann) measurement on either qubit — even though the state is already entangled throughout $1/3 < p \le 1/2$. This is the historical significance of the construction: it demonstrated for the first time that entanglement alone does not imply the existence of a Bell-inequality-violating experiment, separating "entangled" from "nonlocal" as distinct resources. (The CHSH value for $\rho_W(p)$ with the standard optimal measurement settings is $2\sqrt2\,p$, so this particular CHSH strategy is violated only for $p>1/\sqrt2\approx0.707$ — a third, even higher threshold, leaving a nontrivial gap $1/2 < p \le 1/\sqrt2$ that motivated later work on whether more elaborate measurement strategies could reveal nonlocality closer to the $p=1/2$ boundary.)

**Symmetry.** $\rho_W(p)$ is invariant under $U\otimes U$ for every single-qubit unitary $U$ — this $U\otimes U$-twirling symmetry is in fact how Werner states are usually *produced* in practice: apply the completely-depolarizing twirl (average over Haar-random $U\otimes U$ conjugation) to any two-qubit state, and only its overlap with the singlet survives, projecting any input onto some $\rho_W(p)$.`,
    explanationMdJa: String.raw`本エントリで用いる**一重項分率（シングレット・フラクション）規約**での2量子ビットワーナー状態は

$$\rho_W(p) = p\,|\Psi^-\rangle\langle\Psi^-| + (1-p)\,\frac{I}{4}, \qquad |\Psi^-\rangle = \frac{|01\rangle-|10\rangle}{\sqrt2}, \qquad p\in[0,1]$$

です。（他の文献では一重項を$I/4$ではなく他の3つのベル状態と混合する規約を用いることがあり、その場合以下のしきい値の数値はずれます。したがって規約は常にしきい値の値と一緒に明記する必要があります。）

**スペクトル。** $|\Psi^-\rangle\langle\Psi^-|$と$I/4$は可換（どちらもベル基底で対角）なので、$\rho_W(p)$は$|\Psi^-\rangle$上で固有値$p + (1-p)/4$、対称三重項$\{|\Phi^+\rangle,|\Phi^-\rangle,|\Psi^+\rangle\}$上で固有値$(1-p)/4$（3重縮退）を持ちます。両固有値は$p\in[0,1]$のすべてで非負であり、$\rho_W(p)$はこの区間全体で有効な密度行列です。

**分離可能性のしきい値。** 部分転置$\rho_W(p)^{T_B}$を適用しその固有値を直接計算すると、1つの固有値が$\tfrac{1-3p}{4}$になります（残りは非負のまま）。2量子ビット状態の分離可能性の必要十分条件であるPeres–Horodecki（PPT）判定基準により、$\rho_W(p)$は**$p \le 1/3$で分離可能**であり、$p>1/3$でエンタングル（かつ蒸留可能。2×2ではPPT＝分離可能なので）です。$p=1$では$\rho_W(1)=|\Psi^-\rangle\langle\Psi^-|$となり純粋な最大エンタングル一重項に一致し、$p=0$では$\rho_W(0)=I/4$となり最大混合状態に一致します。

**局所隠れ変数モデル。** Wernerの1989年のオリジナルの結果は分離可能性のしきい値をさらに超えます。彼は$p\le 1/2$に対して、どちらかの量子ビットへの*あらゆる*射影（フォン・ノイマン）測定の統計を再現する明示的な局所隠れ変数（LHV）モデルが存在することを示しました。$1/3 < p \le 1/2$の範囲ではすでに状態がエンタングルであるにもかかわらずです。これがこの構成の歴史的な意義です。エンタングルメントだけではベル不等式を破る実験の存在を意味しないことを初めて実証し、「エンタングル」と「非局所的」を別個のリソースとして区別しました。（標準的な最適測定設定での$\rho_W(p)$のCHSH値は$2\sqrt2\,p$であり、この特定のCHSH戦略が破られるのは$p>1/\sqrt2\approx0.707$の場合のみです。これは3番目の、さらに高いしきい値であり、$1/2 < p \le 1/\sqrt2$という非自明な隙間が残ります。この隙間は、より精緻な測定戦略が$p=1/2$境界に近い非局所性を明らかにできるかという後の研究を動機づけました。）

**対称性。** $\rho_W(p)$はすべての単一量子ビットユニタリ$U$に対する$U\otimes U$のもとで不変です。この$U\otimes U$ツイリング対称性は、実際にワーナー状態を*生成*する通常の方法でもあります。任意の2量子ビット状態に完全脱分極ツイル（ハール測度でランダムな$U\otimes U$共役の平均）を適用すると、一重項との重なりのみが生き残り、任意の入力をある$\rho_W(p)$へ射影します。`,
    tags: ["werner state", "mixed state", "separability", "local hidden variables", "ppt criterion"],
    resources: [
      { label: "Qubits", value: "2" },
      { label: "Free parameter", value: "p ∈ [0,1]" },
      { label: "Separable region", value: "p ≤ 1/3 (singlet-fraction convention)" },
    ],
    metadata: [
      { label: "State", value: "ρ_W(p) = p|Ψ⁻⟩⟨Ψ⁻| + (1−p)I/4" },
      { label: "Entangled region", value: "p > 1/3" },
      { label: "LHV region (projective, Werner 1989)", value: "p ≤ 1/2" },
    ],
    sourceTitle: "Quantum states with Einstein-Podolsky-Rosen correlations admitting a hidden-variable model",
    sourceUrl: "https://doi.org/10.1103/PhysRevA.40.4277",
    wires: ["q[0]", "q[1]"],
    operations: [
      { label: "|Ψ⁻⟩ (prob. p)", qubits: [0, 1], tone: "accent" },
      { label: "I/4 (prob. 1−p)", qubits: [0, 1], tone: "neutral" },
      { label: "Classical mixture", qubits: [0, 1], tone: "warn" },
    ],
    outcomes: [
      { label: "Separable (PPT) for p ≤ 1/3", probability: 1 },
      { label: "Entangled for p > 1/3", probability: 1 },
    ],
    code: `import numpy as np
from qiskit.quantum_info import DensityMatrix

def werner_state(p: float) -> DensityMatrix:
    singlet = np.array([0, 1, -1, 0]) / np.sqrt(2)
    proj_singlet = np.outer(singlet, singlet.conj())
    rho = p * proj_singlet + (1 - p) * np.eye(4) / 4
    return DensityMatrix(rho)

def partial_transpose_second(rho: DensityMatrix) -> np.ndarray:
    """Transpose the second qubit only. Written out rather than imported:
    qiskit.quantum_info has no partial_transpose, and the two-qubit case is
    one index swap on the reshaped density matrix."""
    return rho.data.reshape(2, 2, 2, 2).transpose(0, 3, 2, 1).reshape(4, 4)

separability = {}
for p in (0.2, 1 / 3, 0.5, 0.9):
    rho = werner_state(p)
    pt_eigs = np.linalg.eigvalsh(partial_transpose_second(rho))
    min_rho_eig = min(np.linalg.eigvalsh(rho.data))
    separability[f"{p:.3f}"] = bool(pt_eigs.min() >= -1e-9)
    print(f"p={p:.3f}  min eig(rho)={min_rho_eig:.4f}  min eig(partial transpose)={pt_eigs.min():.4f}"
          f"  separable(PPT)={pt_eigs.min() >= -1e-9}")

RESULT = {"separable_by_ppt": separability}
`,
    filename: "werner_state.py",
    language: "python",
    relatedSlugs: ["bell-state-qiskit", "maximally-mixed-state", "thermal-gibbs-state"],
    literature: [
      {
        title: "Quantum states with Einstein-Podolsky-Rosen correlations admitting a hidden-variable model",
        authors: "R. F. Werner",
        year: "1989",
        url: "https://doi.org/10.1103/physreva.40.4277",
        relevance:
          "Introduces the Werner state family and proves both the separability/entanglement structure and the existence of a local hidden-variable model for projective measurements up to p=1/2.",
        relevanceJa: "ワーナー状態族を導入し、分離可能性・エンタングルメント構造と、射影測定に対しp=1/2まで局所隠れ変数モデルが存在することを証明します。",
      },
    ],
  }),
  makeReferenceEntry({
    slug: "noon-state",
    title: "NOON state (two-mode, N=2)",
    titleJa: "NOON状態（2モード、N=2）",
    category: "states",
    categoryLabel: "States",
    categoryLabelJa: "状態",
    algorithmFamily: "Quantum metrology states",
    framework: "Qiskit",
    status: "verified_caveats",
    verification: "Closed-form amplitude check · two-level embedding of the N00N manifold",
    verificationMethods: ["direct_math", "construction", "research_paper"],
    method:
      "The state's amplitudes in the two-dimensional {|N,0⟩,|0,N⟩} subspace were compared exactly against the definition (1/√2, 1/√2), and the N-fold phase-accumulation factor e^{iNφ} was checked by direct substitution into the interferometric phase-evolution formula for a general N00N state.",
    result:
      "Pass · the embedded qubit reproduces the exact (1/√2,1/√2) amplitude split, and applying a phase φ to one mode yields the analytic e^{iNφ} scaling, reproducing the N-fold interference-fringe compression used for Heisenberg-limited metrology.",
    caveat:
      "The single-qubit embedding exactly tracks amplitudes and relative phase within the {|N,0⟩,|0,N⟩} manifold, but does not model the full bosonic Fock space, mode loss, or the nonlinear/heralded photonic resources actually needed to generate N00N states with N>2.",
    exportStatus:
      "Native Qiskit and PennyLane as a two-level embedding · true multi-photon Fock-space representation is out of scope for a qubit simulator",
    provenance: "Curated reference",
    updatedAt: "2026-07-17",
    description:
      "The NOON state (|N,0⟩+|0,N⟩)/√2: a two-mode entangled state with all N particles in one mode or the other, the standard resource for Heisenberg-limited interferometric phase estimation.",
    descriptionJa: "NOON状態(|N,0⟩+|0,N⟩)/√2：N個の粒子すべてが一方のモードかもう一方のモードにある2モードのエンタングル状態。ハイゼンベルク限界の干渉計位相推定における標準的なリソースです。",
    introduction:
      "Classical (coherent-state) interferometry estimates a phase φ with uncertainty scaling as 1/√N in the number of probe particles — the standard quantum limit or shot-noise limit. NOON states were introduced to reach the fundamentally better 1/N Heisenberg scaling by concentrating N particles into a single maximally path-entangled superposition rather than spreading them across N independent particles.",
    introductionJa:
      "古典的（コヒーレント状態）干渉計は、プローブ粒子数Nに対して不確かさが1/√Nでスケールする位相φを推定します。これは標準量子限界（ショット雑音限界）です。NOON状態は、N個の粒子をN個の独立した粒子に分散させるのではなく、単一の最大限に経路エンタングルした重ね合わせに集中させることで、より根本的に良い1/Nのハイゼンベルクスケーリングに到達するために導入されました。",
    explanation:
      "|NOON⟩ = (|N,0⟩+|0,N⟩)/√2 places all N particles in mode a or all N in mode b in equal superposition; because the relative phase between the two branches accumulates N times faster than for a single particle, the resulting interference fringes oscillate N times faster, giving N-fold enhanced phase sensitivity.",
    explanationJa:
      "|NOON⟩ = (|N,0⟩+|0,N⟩)/√2は、N個の粒子すべてがモードaにあるか、すべてがモードbにあるかの等しい重ね合わせです。2つの分岐間の相対位相は単一粒子のN倍の速さで蓄積するため、生じる干渉縞はN倍速く振動し、N倍に強化された位相感度が得られます。",
    explanationMd: String.raw`The N00N state on two bosonic modes $a,b$ with $N$ total particles is

$$|\mathrm{NOON}\rangle = \frac{|N\rangle_a|0\rangle_b + |0\rangle_a|N\rangle_b}{\sqrt2},$$

an equal superposition of "all $N$ particles in mode $a$" and "all $N$ particles in mode $b$." Because this superposition lives entirely within the two-dimensional subspace spanned by $\{|N,0\rangle,|0,N\rangle\}$, it can be tracked with a single effective qubit for circuit-level bookkeeping: $|0\rangle_{\text{eff}}\equiv|N,0\rangle$, $|1\rangle_{\text{eff}}\equiv|0,N\rangle$, giving $|\mathrm{NOON}\rangle \cong |+\rangle_{\text{eff}} = H|0\rangle_{\text{eff}}$, formally identical to the Hadamard-basis state elsewhere in this catalog. This embedding is exact for tracking amplitudes and relative phase within the N00N manifold, but it does **not** capture the full bosonic Fock space or the nonlinear-optical resources (or heralded multi-photon interference) actually required to *generate* $|N,0\rangle+|0,N\rangle$ physically for $N>2$; the $N=2$ case alone is producible with linear optics via Hong–Ou–Mandel-style two-photon bunching at a 50:50 beamsplitter fed with one photon per input port.

**Phase sensitivity.** Passing mode $a$ through a phase shift $\phi$ (relative to $b$) evolves the state to

$$|\mathrm{NOON}(\phi)\rangle = \frac{e^{iN\phi}|N,0\rangle + |0,N\rangle}{\sqrt2},$$

since each of the $N$ particles picks up phase $\phi$ independently, giving $N\phi$ total — an $N$-fold compression of the interference fringe compared to a single-particle probe, where the fringe would oscillate as $\cos\phi$ rather than $\cos(N\phi)$. Standard phase-estimation error propagation gives $\Delta\phi = 1/N$ for an ideal N00N-state measurement (the Heisenberg limit), compared to $\Delta\phi = 1/\sqrt N$ for $N$ independent uncorrelated probes at the same total resource count (the standard quantum limit) — the quadratic advantage in $N$ that motivates using entangled probe states for quantum-enhanced sensing.

**Fragility.** The metrological advantage is purchased at a steep cost in robustness: losing even a single one of the $N$ particles collapses the coherence between the $|N,0\rangle$ and $|0,N\rangle$ branches entirely (an environment that "sees" which branch the lost particle came from performs a which-path measurement), so N00N-state sensitivity degrades catastrophically under loss, unlike less fragile metrological resource states such as spin-squeezed or Dicke states. This tradeoff between Heisenberg-limited scaling and loss-sensitivity is the central practical constraint on N00N-state interferometry.

**Where this shows up.** N00N states are the textbook example motivating quantum-enhanced interferometry and quantum radar/lidar proposals, and the $N=2$ case connects directly to two-photon Hong–Ou–Mandel interference — the same bosonic bunching effect that underlies photonic SWAP-test and boson-sampling architectures.`,
    explanationMdJa: String.raw`2つのボソンモード$a,b$上に合計$N$個の粒子を持つNOON状態は

$$|\mathrm{NOON}\rangle = \frac{|N\rangle_a|0\rangle_b + |0\rangle_a|N\rangle_b}{\sqrt2}$$

であり、「N個の粒子すべてがモードaにある」と「N個の粒子すべてがモードbにある」の等しい重ね合わせです。この重ね合わせは完全に$\{|N,0\rangle,|0,N\rangle\}$が張る2次元部分空間内にあるため、回路レベルの記帳には単一の実効量子ビットで追跡できます。$|0\rangle_{\text{eff}}\equiv|N,0\rangle$、$|1\rangle_{\text{eff}}\equiv|0,N\rangle$とすると、$|\mathrm{NOON}\rangle \cong |+\rangle_{\text{eff}} = H|0\rangle_{\text{eff}}$となり、本カタログの別項目のアダマール基底状態と形式的に同一です。この埋め込みはNOONマニフォールド内の振幅と相対位相を追跡するには厳密ですが、$N>2$で$|N,0\rangle+|0,N\rangle$を物理的に*生成*するために実際に必要な完全なボソン・フォック空間や非線形光学リソース（あるいはヘラルド多光子干渉）は捉えていません。$N=2$の場合だけは、各入力ポートに1光子ずつを送り込んだ50:50ビームスプリッターでのHong–Ou–Mandel型の2光子バンチングにより線形光学で生成可能です。

**位相感度。** モード$a$を（$b$に対して相対的に）位相シフト$\phi$に通すと状態は

$$|\mathrm{NOON}(\phi)\rangle = \frac{e^{iN\phi}|N,0\rangle + |0,N\rangle}{\sqrt2}$$

に発展します。$N$個の粒子それぞれが独立に位相$\phi$を得るため、合計で$N\phi$になります。これは単一粒子プローブと比べて干渉縞が$N$倍圧縮されることを意味し、単一粒子では縞は$\cos\phi$で振動するのに対しここでは$\cos(N\phi)$で振動します。標準的な位相推定の誤差伝播により、理想的なNOON状態測定では$\Delta\phi = 1/N$（ハイゼンベルク限界）が得られ、同じ総リソース数での$N$個の独立で無相関なプローブでは$\Delta\phi = 1/\sqrt N$（標準量子限界）となります。これがエンタングルしたプローブ状態を量子強化センシングに用いる動機となる$N$における2次的な優位性です。

**脆弱性。** このメトロロジー上の優位性は頑健性の大きな代償の上に成り立っています。N個のうちたった1粒子でも失うと、$|N,0\rangle$と$|0,N\rangle$の分岐間のコヒーレンスは完全に崩壊します（失われた粒子がどちらの分岐から来たかを「見る」環境は経路測定を行うのと同じことです）。そのためNOON状態の感度は損失下で壊滅的に劣化し、スピンスクイーズド状態やDicke状態のようなより頑健なメトロロジー・リソース状態とは対照的です。このハイゼンベルク限界のスケーリングと損失感受性の間のトレードオフが、NOON状態干渉計測の中心的な実用上の制約です。

**現れる場面。** NOON状態は量子強化干渉計測や量子レーダー・ライダーの提案を動機づける教科書的な例であり、$N=2$の場合は2光子Hong–Ou–Mandel干渉と直接つながります。これは光子SWAPテストやボソンサンプリングのアーキテクチャの基礎となっているのと同じボソン・バンチング効果です。`,
    tags: ["noon state", "quantum metrology", "heisenberg limit", "interferometry", "photonic"],
    resources: [
      { label: "Modes", value: "2 (a, b)" },
      { label: "Particle number", value: "N (N=2 shown)" },
      { label: "Phase scaling", value: "e^{iNφ} (Heisenberg limit Δφ=1/N)" },
    ],
    metadata: [
      { label: "State", value: "(|N,0⟩+|0,N⟩)/√2" },
      { label: "Standard quantum limit", value: "Δφ = 1/√N" },
      { label: "Heisenberg limit", value: "Δφ = 1/N" },
    ],
    sourceTitle: "A quantum Rosetta stone for interferometry",
    sourceUrl: "https://arxiv.org/abs/quant-ph/0202133",
    wires: ["NOON qubit (|N,0⟩/|0,N⟩)"],
    operations: [
      { label: "H", qubits: [0], tone: "accent" },
      { label: "RZ(Nφ)", qubits: [0], tone: "ok" },
    ],
    outcomes: [
      { label: "|N,0⟩ (before phase)", probability: 0.5 },
      { label: "|0,N⟩ (before phase)", probability: 0.5 },
    ],
    code: `import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

def noon_qubit_embedding(N: int, phi: float = 0.0) -> QuantumCircuit:
    # Effective 2-level embedding: |0> == |N,0>, |1> == |0,N>.
    qc = QuantumCircuit(1)
    qc.h(0)              # (|N,0> + |0,N>) / sqrt(2)
    qc.rz(N * phi, 0)     # N-fold phase accumulation e^{i N phi}
    return qc

N = 2
sv0 = Statevector.from_instruction(noon_qubit_embedding(N, phi=0.0))
print("Amplitudes at phi=0:", sv0.data)  # equal superposition

phi = np.pi / (2 * N)
sv = Statevector.from_instruction(noon_qubit_embedding(N, phi))
relative_phase = np.angle(sv.data[1]) - np.angle(sv.data[0])
print(f"Relative phase at phi={phi:.4f}: {relative_phase:.4f}  (expected N*phi = {N * phi:.4f})")

FINAL_CIRCUIT = noon_qubit_embedding(N, phi)
`,
    filename: "noon_state.py",
    language: "python",
    extraVariants: [
      {
        framework: "PennyLane",
        status: "native",
        language: "python",
        filename: "noon_state.py",
        code: `import pennylane as qml
import numpy as np

dev = qml.device("default.qubit", wires=1)

@qml.qnode(dev)
def noon_qubit_embedding(N, phi):
    qml.Hadamard(wires=0)
    qml.RZ(N * phi, wires=0)
    return qml.state()

print(noon_qubit_embedding(2, np.pi / 8))
\n\nFINAL_CIRCUIT = noon_qubit_embedding`,
      },
    ],
    relatedSlugs: ["ghz-state-pennylane", "quantum-phase-estimation", "amplitude-estimation"],
    literature: [
      {
        title: "A Quantum Rosetta Stone for Interferometry",
        authors: "Hwang Lee, Pieter Kok, Jonathan P. Dowling",
        year: "2002",
        url: "https://arxiv.org/abs/quant-ph/0202133",
        relevance:
          "Introduces and reviews the N00N-state formalism connecting quantum optical interferometry to quantum-information notation, including the Heisenberg-limited phase-scaling result used here.",
        relevanceJa: "量子光干渉計と量子情報記法を結びつけるNOON状態の形式を導入・概観し、本エントリで用いるハイゼンベルク限界の位相スケーリング結果を含みます。",
      },
    ],
  }),
  makeReferenceEntry({
    slug: "maximally-mixed-state",
    title: "Maximally mixed state I/2ⁿ",
    titleJa: "最大混合状態 I/2ⁿ",
    category: "states",
    categoryLabel: "States",
    categoryLabelJa: "状態",
    algorithmFamily: "Thermal state preparation",
    framework: "Qiskit",
    verification: "Closed-form trace/eigenvalue check · classical-mixture and partial-trace construction",
    verificationMethods: ["direct_math", "construction", "textbook_citation"],
    method:
      "ρ = I/2^n was checked to be trace 1, Hermitian, and to have all 2^n eigenvalues equal to 1/2^n by direct inspection; equivalence to (a) a uniform classical mixture of computational-basis states and (b) the reduced state of one half of any maximally entangled pair (obtained by partial trace) was checked by direct matrix computation for n=1.",
    result:
      "Pass · I/2^n has trace 1, is positive semidefinite with all eigenvalues 1/2^n, and both the classical-mixture and partial-trace constructions reproduce I/2 exactly for a single qubit.",
    exportStatus: "Native Qiskit quantum_info (DensityMatrix) · no gate-level circuit representation (mixed state)",
    provenance: "Curated reference",
    updatedAt: "2026-07-17",
    description:
      "The maximally mixed state ρ = I/2ⁿ: the unique n-qubit state invariant under every unitary, carrying zero information and maximal (n-bit) von Neumann entropy.",
    descriptionJa: "最大混合状態ρ = I/2ⁿは、あらゆるユニタリに対して不変な唯一のn量子ビット状態です。情報を持たず、最大値nビットのフォン・ノイマンエントロピーを持ちます。",
    introduction:
      "Every mixed-state construction in this catalog has the maximally mixed state as a limiting or reference case: it is the infinite-temperature limit of any Gibbs state, the reduced state of half a maximally entangled pair, and the fixed point of complete depolarization — making it the natural 'zero information' baseline against which every other state's purity and entanglement are measured.",
    introductionJa:
      "本カタログのあらゆる混合状態構成は、最大混合状態を極限または参照ケースとして持ちます。それはあらゆるギブス状態の無限温度極限であり、最大エンタングルペアの半分の縮約状態であり、完全脱分極の不動点です。これにより、他のすべての状態の純粋度とエンタングルメントを測る「情報ゼロ」の自然な基準となります。",
    explanation:
      "ρ = I/2ⁿ assigns equal probability 1/2ⁿ to every computational basis string with zero coherence between them; it is the unique state left unchanged by conjugation with any unitary, UρU† = ρ for all U.",
    explanationJa:
      "ρ = I/2ⁿはすべての計算基底文字列に等しい確率1/2ⁿを割り当て、それらの間にコヒーレンスを持ちません。これはあらゆるユニタリによる共役の下で不変のままである唯一の状態であり、すべてのUに対しUρU† = ρです。",
    explanationMd: String.raw`The maximally mixed state on $n$ qubits is

$$\rho = \frac{I}{2^n} = \frac{1}{2^n}\sum_{x\in\{0,1\}^n} |x\rangle\langle x|.$$

**Unitary invariance.** For any unitary $U$, $U\rho U^\dagger = U\frac{I}{2^n}U^\dagger = \frac{UU^\dagger}{2^n} = \frac{I}{2^n} = \rho$. This is the *only* $n$-qubit state with this property (any other state has some eigenbasis with unequal eigenvalues, and a unitary rotating that eigenbasis changes the state), which is why $I/2^n$ represents complete ignorance: no measurement in any basis, and no unitary transformation, can extract or reveal any information from it.

**Maximal entropy.** The von Neumann entropy $S(\rho) = -\mathrm{Tr}(\rho\log_2\rho) = -\sum_x \frac{1}{2^n}\log_2\frac{1}{2^n} = n$ bits, the maximum possible for an $n$-qubit system (achieved uniquely by $I/2^n$, exactly analogous to a uniform classical distribution maximizing Shannon entropy). Purity $\mathrm{Tr}(\rho^2) = 2^n\cdot(1/2^n)^2 = 1/2^n$ is correspondingly minimal, reflecting that this is the 'most mixed' possible state.

**Three equivalent constructions.**
1. **Classical randomization.** Flip $n$ fair, independent classical coins and prepare the corresponding computational basis string $|x\rangle$; averaging the resulting ensemble $\{p_x=1/2^n, |x\rangle\}$ over all $2^n$ outcomes gives exactly $\sum_x \frac{1}{2^n}|x\rangle\langle x| = I/2^n$.
2. **Partial trace of a maximally entangled state.** Tracing out either half of any maximally entangled $2n$-qubit state (e.g. $n$ Bell pairs) leaves the remaining $n$ qubits in $I/2^n$ — this is the cleanest illustration of how entanglement with an inaccessible system manifests locally as maximal mixedness, even though the global state is pure.
3. **Complete depolarization / infinite temperature.** $I/2^n$ is the fixed point of the completely depolarizing channel $\mathcal{E}(\rho)=I/2^n$ for all input $\rho$, and is the $\beta\to0$ (infinite-temperature) limit of the Gibbs state $e^{-\beta H}/Z$ for *any* Hamiltonian $H$ — exactly the limit reached by the single-qubit thermal-state purification construction elsewhere in this catalog as $\theta\to\pi/2$.

**Role as a baseline.** Because it carries zero distinguishing information, $I/2^n$ is the reference point for every mixedness/entanglement measure used elsewhere in this catalog: it is the $p=0$ endpoint of the Werner-state family, the maximum-entropy endpoint of any thermal state, and the state a qubit decoheres toward under a fully depolarizing noise channel — the worst-case error model in quantum error correction.`,
    explanationMdJa: String.raw`$n$量子ビット上の最大混合状態は

$$\rho = \frac{I}{2^n} = \frac{1}{2^n}\sum_{x\in\{0,1\}^n} |x\rangle\langle x|$$

です。

**ユニタリ不変性。** 任意のユニタリ$U$に対し、$U\rho U^\dagger = U\frac{I}{2^n}U^\dagger = \frac{UU^\dagger}{2^n} = \frac{I}{2^n} = \rho$です。この性質を持つ$n$量子ビット状態は*これだけ*です（他のどの状態も固有値が不揃いなある固有基底を持ち、その固有基底を回転させるユニタリは状態を変化させます）。これが$I/2^n$が完全な無知を表す理由です。どの基底での測定も、どのユニタリ変換も、そこから情報を取り出したり明らかにしたりすることはできません。

**最大エントロピー。** フォン・ノイマンエントロピー$S(\rho) = -\mathrm{Tr}(\rho\log_2\rho) = -\sum_x \frac{1}{2^n}\log_2\frac{1}{2^n} = n$ビットは、$n$量子ビット系で可能な最大値です（$I/2^n$のみで達成され、一様な古典分布がシャノンエントロピーを最大化するのとまったく同様です）。純粋度$\mathrm{Tr}(\rho^2) = 2^n\cdot(1/2^n)^2 = 1/2^n$も対応して最小であり、これが可能な限り「最も混合した」状態であることを反映しています。

**3つの等価な構成。**
1. **古典的ランダム化。** $n$個の公正で独立な古典コインを投げ、対応する計算基底文字列$|x\rangle$を準備します。得られるアンサンブル$\{p_x=1/2^n, |x\rangle\}$をすべての$2^n$個の結果にわたって平均すると、ちょうど$\sum_x \frac{1}{2^n}|x\rangle\langle x| = I/2^n$になります。
2. **最大エンタングル状態の部分トレース。** 任意の$2n$量子ビット最大エンタングル状態（例えば$n$個のベルペア）のどちらか半分をトレースアウトすると、残りの$n$量子ビットは$I/2^n$になります。これは、大域状態が純粋であっても、アクセス不能な系とのエンタングルメントが局所的には最大混合として現れることの最も明快な例です。
3. **完全脱分極・無限温度。** $I/2^n$は完全脱分極チャネル$\mathcal{E}(\rho)=I/2^n$（あらゆる入力$\rho$に対して）の不動点であり、*任意の*ハミルトニアン$H$に対するギブス状態$e^{-\beta H}/Z$の$\beta\to0$（無限温度）極限です。これはまさに本カタログの別項目にある単一量子ビット熱状態の純粋化構成が$\theta\to\pi/2$で到達する極限です。

**基準としての役割。** 識別情報を一切持たないため、$I/2^n$は本カタログの他の混合度・エンタングルメント指標すべての基準点です。ワーナー状態族の$p=0$端点であり、任意の熱状態の最大エントロピー端点であり、完全脱分極ノイズチャネルの下で量子ビットがデコヒーレンスしていく先の状態、すなわち量子誤り訂正における最悪ケースの誤りモデルです。`,
    tags: ["maximally mixed state", "mixed state", "unitary invariance", "von neumann entropy"],
    resources: [
      { label: "Qubits", value: "n (n=1,2 shown)" },
      { label: "Purity", value: "Tr(ρ²) = 1/2ⁿ" },
      { label: "Entropy", value: "S(ρ) = n bits (maximal)" },
    ],
    metadata: [
      { label: "State", value: "ρ = I/2ⁿ" },
      { label: "Invariance", value: "UρU† = ρ for all unitary U" },
      { label: "T→∞ limit of", value: "Any Gibbs state e^{-βH}/Z" },
    ],
    sourceTitle: "Quantum Computation and Quantum Information",
    sourceUrl: "https://doi.org/10.1017/CBO9780511976667",
    wires: ["q[0]", "q[1]"],
    operations: [
      { label: "Uniform mixture over {|00⟩,|01⟩,|10⟩,|11⟩}", qubits: [0, 1], tone: "neutral" },
      { label: "≡ partial trace of Bell pair", qubits: [0, 1], tone: "accent" },
    ],
    outcomes: [{ label: "Each basis string (n=2)", probability: 0.25 }],
    code: `import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import DensityMatrix, Statevector, partial_trace

def maximally_mixed(n: int) -> DensityMatrix:
    return DensityMatrix(np.eye(2 ** n) / 2 ** n)

rho2 = maximally_mixed(2)
print("Trace:", np.trace(rho2.data))                  # 1.0
print("Eigenvalues:", np.linalg.eigvalsh(rho2.data))  # [0.25, 0.25, 0.25, 0.25]

# Construction 2: partial trace of a Bell pair reproduces I/2 for one qubit
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
bell = Statevector.from_instruction(qc)
reduced = partial_trace(bell, [1])  # trace out qubit 1
print("Reduced state of one Bell-pair qubit:\\n", np.real(reduced.data))  # [[0.5, 0], [0, 0.5]]
\n\nFINAL_CIRCUIT = qc`,
    filename: "maximally_mixed_state.py",
    language: "python",
    relatedSlugs: ["thermal-gibbs-state", "werner-state", "bell-state-qiskit"],
    literature: [
      {
        title: "Quantum Computation and Quantum Information: 10th Anniversary Edition",
        authors: "Michael A. Nielsen and Isaac L. Chuang",
        year: "2010",
        url: "https://doi.org/10.1017/cbo9780511976667",
        relevance:
          "Standard textbook treatment of the maximally mixed state, its unitary invariance, and its role as the partial trace of a maximally entangled state.",
        relevanceJa: "最大混合状態、そのユニタリ不変性、および最大エンタングル状態の部分トレースとしての役割についての標準的な教科書での扱いです。",
      },
    ],
  }),
  makeReferenceEntry({
    slug: "h2-molecular-hamiltonian",
    title: "H₂ molecular qubit Hamiltonian (STO-3G, 2-qubit tapered)",
    titleJa: "H₂分子量子ビット・ハミルトニアン（STO-3G、2量子ビットに縮約）",
    category: "operators",
    categoryLabel: "Operators",
    categoryLabelJa: "演算子",
    algorithmFamily: "Fermionic Hamiltonians",
    framework: "Qiskit",
    status: "verified_caveats",
    verification: "Hermiticity / structural-form check · literature-sourced coefficients",
    verificationMethods: ["direct_math", "construction", "research_paper"],
    method:
      "Hermiticity of the six-term Pauli decomposition was checked directly (every Pauli string I⊗I, Z⊗I, I⊗Z, Z⊗Z, Y⊗Y, X⊗X is Hermitian and all six coefficients are real, so the sum is Hermitian by construction). The general structural form — one identity term, two single-qubit Z terms, and ZZ/XX/YY two-qubit terms with no other Pauli strings — was checked against the standard result for Jordan-Wigner-mapped H₂ in a minimal (STO-3G) basis after parity mapping and two-qubit tapering by particle-number and spin symmetry. The specific numeric coefficients are curated directly from the cited literature table at the H₂ equilibrium bond length (0.7414 Å) rather than recomputed from a fresh Hartree-Fock calculation in this catalog.",
    result:
      "Pass · the operator is Hermitian by construction (real coefficients on Hermitian Pauli strings), and its Pauli-string structure matches the standard tapered two-qubit form; the numeric coefficients reproduce the cited literature table exactly.",
    caveat:
      "The six coefficients (g0…g5) are taken directly from the cited literature's electronic-structure calculation, not independently re-derived via Hartree-Fock/Jordan-Wigner mapping by this catalog; treat them as literature-sourced constants specific to the STO-3G basis and the stated bond length.",
    exportStatus: "Native Qiskit SparsePauliOp · framework-portable Pauli string list",
    provenance: "Curated reference",
    updatedAt: "2026-07-17",
    description:
      "The minimal-basis (STO-3G) H₂ electronic Hamiltonian after Jordan-Wigner/parity mapping and two-qubit tapering: the canonical small-molecule target for variational quantum eigensolver (VQE) demonstrations.",
    descriptionJa: "Jordan-Wigner／パリティ写像と2量子ビットへの縮約を経た最小基底（STO-3G）H₂電子ハミルトニアン。変分量子固有値ソルバー（VQE）実証の標準的な小分子ターゲットです。",
    introduction:
      "H₂ in a minimal basis is small enough to diagonalize exactly on a classical computer, which is precisely what makes it the standard first target for quantum chemistry on quantum hardware: every claimed VQE energy can be checked against an exact classical answer, isolating hardware and algorithmic error from basis-set error.",
    introductionJa:
      "最小基底のH₂は古典コンピュータで厳密に対角化できるほど小さく、これこそが量子ハードウェア上での量子化学の標準的な最初のターゲットである理由です。あらゆるVQEエネルギーの主張は厳密な古典的解答と照合でき、ハードウェアやアルゴリズムの誤差を基底関数集合の誤差から切り分けられます。",
    explanation:
      "After Jordan-Wigner encoding the four spin-orbitals of minimal-basis H₂ and eliminating two qubits using particle-number and spin-parity symmetries, the electronic Hamiltonian reduces to a 2-qubit operator with six Pauli terms: an identity offset, two single-qubit Z terms, and ZZ/XX/YY two-qubit terms.",
    explanationJa:
      "最小基底H₂の4つのスピン軌道をJordan-Wigner符号化し、粒子数とスピン・パリティの対称性を用いて2量子ビットを消去した後、電子ハミルトニアンは6つのパウリ項を持つ2量子ビット演算子に縮約されます。恒等オフセット項、2つの単一量子ビットZ項、およびZZ/XX/YYの2量子ビット項です。",
    explanationMd: String.raw`In a minimal STO-3G basis, H₂ has two spatial molecular orbitals (bonding $\sigma_g$ and antibonding $\sigma_u^*$), i.e. four spin-orbitals. Jordan-Wigner encoding these four spin-orbitals gives a 4-qubit fermionic Hamiltonian; applying a parity mapping and exploiting the two $\mathbb{Z}_2$ symmetries of a fixed 2-electron singlet state (particle-number and spin-parity conservation) tapers this down to the standard **2-qubit** operator

$$H = g_0\, I\!I + g_1\, Z_0 I + g_2\, I Z_1 + g_3\, Z_0 Z_1 + g_4\, Y_0 Y_1 + g_5\, X_0 X_1,$$

with the following coefficients (in Hartree) at the H₂ **equilibrium bond length $R=0.7414\,\text{Å}$**, curated from O'Malley et al. (2016), Table I:

$$g_0=-0.4804,\quad g_1=0.3435,\quad g_2=-0.4347,\quad g_3=0.5716,\quad g_4=g_5=0.0910.$$

**Structural facts checked here.** Every Pauli string appearing ($II,ZI,IZ,ZZ,YY,XX$) is Hermitian, and all six coefficients are real, so $H$ is Hermitian by construction — a property that must hold for any physical Hamiltonian and is trivial to confirm directly from the term list. The absence of any $XY$, $YX$, single-$X$, or single-$Y$ terms is a direct consequence of the residual symmetry after tapering (the untapered operator has more terms; the surviving six are exactly the ones commuting with both retained $\mathbb{Z}_2$ symmetry generators), and is the standard structural signature of this specific reduction scheme rather than a general property of arbitrary two-qubit molecular Hamiltonians.

**Provenance of the numbers.** The *form* of the operator (six terms, this Pauli-string set) is a structural consequence of the mapping and is checked directly; the *specific numeric values* $g_0,\dots,g_5$ come from a classical Hartree-Fock plus configuration-interaction calculation in the literature and are curated here as literature values, not independently recomputed — this catalog verifies the mathematical object is well-formed, not the underlying quantum-chemistry calculation that produced its coefficients.

**Why it is the canonical VQE target.** Because the exact ground-state energy of this specific 2-qubit matrix is obtainable by classical diagonalization (trivial at 2 qubits), any VQE run on this Hamiltonian has a known correct answer to compare against — which is exactly why H₂ (and the closely related minimal-basis diatomics) became the field's de facto small-molecule benchmark for early superconducting- and photonic-qubit VQE demonstrations.

**Bond-length dependence.** The six coefficients above are only valid at $R=0.7414\,\text{Å}$; scanning the bond length produces a different $g_0,\dots,g_5$ at each point, tracing out the H₂ potential energy surface used to validate dissociation-curve accuracy — a standard downstream use of this exact operator family.`,
    explanationMdJa: String.raw`最小STO-3G基底では、H₂は2つの分子軌道（結合性$\sigma_g$と反結合性$\sigma_u^*$）、すなわち4つのスピン軌道を持ちます。この4つのスピン軌道をJordan-Wigner符号化すると4量子ビットのフェルミオン・ハミルトニアンが得られます。パリティ写像を適用し、固定された2電子一重項状態の2つの$\mathbb{Z}_2$対称性（粒子数保存とスピン・パリティ保存）を利用すると、これは標準的な**2量子ビット**演算子に縮約されます。

$$H = g_0\, I\!I + g_1\, Z_0 I + g_2\, I Z_1 + g_3\, Z_0 Z_1 + g_4\, Y_0 Y_1 + g_5\, X_0 X_1$$

係数（ハートリー単位）はH₂の**平衡結合長$R=0.7414\,\text{Å}$**において、O'Malleyら（2016年）のTable Iから採録されています。

$$g_0=-0.4804,\quad g_1=0.3435,\quad g_2=-0.4347,\quad g_3=0.5716,\quad g_4=g_5=0.0910.$$

**ここで確認された構造的事実。** 現れるすべてのパウリ文字列（$II,ZI,IZ,ZZ,YY,XX$）はエルミートであり、6つの係数はすべて実数であるため、$H$は構成上エルミートです。これはあらゆる物理的ハミルトニアンが満たすべき性質であり、項のリストから直接自明に確認できます。$XY$、$YX$、単一$X$、単一$Y$項が存在しないことは、縮約後に残る対称性の直接的な帰結です（縮約前の演算子はより多くの項を持ち、生き残る6項はまさに保持された2つの$\mathbb{Z}_2$対称性生成子の両方と可換な項です）。これは任意の2量子ビット分子ハミルトニアンの一般的性質ではなく、この特定の縮約方式の標準的な構造的特徴です。

**数値の出所。** 演算子の*形*（6項、このパウリ文字列集合）は写像の構造的帰結であり直接確認されています。一方、*具体的な数値*$g_0,\dots,g_5$は文献における古典的なハートリー・フォック＋配置間相互作用計算に由来し、ここでは文献値として採録されているのであって、本カタログが独自に再計算したものではありません。本カタログが検証しているのは数学的対象が well-formed であることであり、その係数を生成した量子化学計算そのものではありません。

**なぜ標準的なVQEターゲットなのか。** この特定の2量子ビット行列の厳密な基底状態エネルギーは古典的対角化で得られるため（2量子ビットでは自明です）、このハミルトニアン上のあらゆるVQE実行には比較対象となる既知の正しい答えがあります。これこそがH₂（および密接に関連する最小基底の二原子分子）が、初期の超伝導・光子量子ビットVQE実証における事実上の小分子ベンチマークとなった理由です。

**結合長依存性。** 上記の6つの係数は$R=0.7414\,\text{Å}$でのみ有効です。結合長を走査すると各点で異なる$g_0,\dots,g_5$が得られ、解離曲線の精度を検証するために使われるH₂のポテンシャルエネルギー曲面が描かれます。これはこの演算子族の標準的な下流での利用法です。`,
    tags: ["molecular hamiltonian", "vqe", "quantum chemistry", "jordan-wigner", "sto-3g"],
    resources: [
      { label: "Qubits", value: "2 (tapered from 4)" },
      { label: "Pauli terms", value: "6" },
      { label: "Bond length", value: "0.7414 Å (equilibrium)" },
    ],
    metadata: [
      { label: "Hamiltonian", value: "H = g0·II + g1·ZI + g2·IZ + g3·ZZ + g4·YY + g5·XX" },
      { label: "Basis set", value: "STO-3G (minimal)" },
      { label: "Mapping", value: "Jordan-Wigner + parity, 2-qubit tapering" },
    ],
    sourceTitle: "Scalable Quantum Simulation of Molecular Energies",
    sourceUrl: "https://arxiv.org/abs/1512.06860",
    wires: ["q0", "q1"],
    operations: [
      { label: "g0·II", qubits: [0, 1], tone: "neutral" },
      { label: "g1·ZI", qubits: [0], tone: "ok" },
      { label: "g2·IZ", qubits: [1], tone: "ok" },
      { label: "g3·ZZ", qubits: [0, 1], tone: "ok" },
      { label: "g4·YY", qubits: [0, 1], tone: "accent" },
      { label: "g5·XX", qubits: [0, 1], tone: "accent" },
    ],
    outcomes: [{ label: "Ground state (lowest eigenvalue, ≈ -1.137 Ha at R=0.7414 Å)", probability: 1 }],
    code: `from qiskit.quantum_info import SparsePauliOp
import numpy as np

# H2 in STO-3G, Jordan-Wigner + parity mapped, 2-qubit tapered by particle-number
# and spin-parity symmetry, at the equilibrium bond length R = 0.7414 A.
# Coefficients (Hartree) curated from O'Malley et al., "Scalable Quantum Simulation
# of Molecular Energies," Phys. Rev. X 6, 031007 (2016), arXiv:1512.06860, Table I.
h2_hamiltonian = SparsePauliOp(
    ["II", "ZI", "IZ", "ZZ", "YY", "XX"],
    [-0.4804, 0.3435, -0.4347, 0.5716, 0.0910, 0.0910],
)

matrix = h2_hamiltonian.to_matrix()
print("Hermitian:", np.allclose(matrix, matrix.conj().T))

eigvals = np.linalg.eigvalsh(matrix)
print("Eigenvalues (Hartree):", eigvals)
print("Ground-state energy:", eigvals.min())

RESULT = {"ground_state_energy_hartree": float(eigvals.min()), "eigenvalues_hartree": [float(v) for v in eigvals]}
`,
    filename: "h2_molecular_hamiltonian.py",
    language: "python",
    relatedSlugs: ["vqe-ground-state-energy", "number-operator", "fermi-hubbard-operator", "ising-hamiltonian-operator"],
    literature: [
      {
        title: "Scalable Quantum Simulation of Molecular Energies",
        authors: "P. J. J. O'Malley, R. Babbush, I. D. Kivlichan, J. Romero, J. R. McClean, R. Barends, J. Kelly, P. Roushan, A. Tranter, N. Ding, B. Campbell, Y. Chen, Z. Chen, B. Chiaro, A. Dunsworth, A. G. Fowler, E. Jeffrey, A. Megrant, J. Y. Mutus, C. Neill, C. Quintana, D. Sank, A. Vainsencher, J. Wenner, T. C. White, P. V. Coveney, P. J. Love, H. Neven, A. Aspuru-Guzik, J. M. Martinis",
        year: "2015",
        url: "https://arxiv.org/abs/1512.06860",
        relevance:
          "Source of the 2-qubit tapered H₂ Hamiltonian coefficients used here, computed at the STO-3G equilibrium bond length.",
        relevanceJa: "本エントリで使用するSTO-3G平衡結合長における2量子ビット縮約H₂ハミルトニアン係数の出典です。",
      },
    ],
  }),
];
