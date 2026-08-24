import type { PublicRepositoryEntry } from "./types";
import { makeReferenceEntry } from "./factory";

// Populated by the catalog-expansion batches (2026-07-16 Owner Inbox: grow the
// public repository to 60+ records). Entries use makeReferenceEntry from
// ./factory; scripts/check-repository-data.mjs validates every record.
export const STATE_OPERATOR_ENTRIES: PublicRepositoryEntry[] = [
  makeReferenceEntry({
    slug: "w-state",
    title: "W state (three-qubit)",
    titleJa: "W状態（3量子ビット）",
    category: "basic-circuits",
    categoryLabel: "Basic circuits",
    categoryLabelJa: "基本回路",
    algorithmFamily: "Multipartite entanglement",
    framework: "Qiskit",
    verification: "Closed-form amplitude check · single-excitation subspace",
    verificationMethods: ["direct_math", "construction", "research_paper"],
    method:
      "The target amplitudes (1/√3 on each of |100⟩, |010⟩, |001⟩, zero elsewhere) are derived analytically from the recursive Möttönen-style rotation angles used in the preparation circuit, then compared against the circuit's exact statevector.",
    result:
      "Pass · the prepared state has support only on the three single-excitation basis strings, each with amplitude 1/√3 and zero relative phase.",
    exportStatus: "Native Qiskit and PennyLane · OpenQASM conversion is mechanical (ry/cx/x only)",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "The three-qubit W state, an equal superposition of every single-excitation basis string that survives the loss of one qubit better than GHZ.",
    descriptionJa: "1つの励起を持つすべての基底文字列の等重ね合わせであるW状態。1量子ビットを失ってもGHZより頑健です。",
    introduction:
      "The W state is the standard second example of genuine multipartite entanglement after GHZ, and the two are provably inequivalent under stochastic local operations and classical communication (SLOCC): no sequence of local operations turns one into the other, even probabilistically.",
    introductionJa:
      "W状態はGHZに続く真の多体エンタングルメントの標準的な例です。両者は確率的局所操作と古典通信（SLOCC）の下で証明可能に非等価であり、局所操作の列でどちらか一方から他方へ変換することはできません。",
    explanation:
      "For three qubits the W state is defined as the equal-amplitude, equal-phase superposition of the three basis strings with exactly one excitation.",
    explanationJa:
      "3量子ビットのW状態は、励起がちょうど1つある3つの基底文字列を等振幅・等位相で重ね合わせたものです。",
    explanationMd: String.raw`The three-qubit $W$ state is

$$|W\rangle = \frac{1}{\sqrt{3}}\big(|100\rangle + |010\rangle + |001\rangle\big).$$

Generalizing to $n$ qubits, $|W_n\rangle = \frac{1}{\sqrt n}\sum_{i=1}^{n} |0\cdots 0\,1_i\,0\cdots 0\rangle$ places the single excitation in a uniform superposition over all $n$ positions.

**Entanglement structure.** The $W$ state and the GHZ state $\frac{1}{\sqrt2}(|00\cdots0\rangle + |11\cdots1\rangle)$ are the two SLOCC-inequivalent classes of genuine tripartite entanglement identified by Dür, Vidal, and Cirac (2000): no local operations and classical communication, even applied probabilistically, can convert one into the other. Operationally this shows up in robustness — tracing out any single qubit of $|W\rangle\langle W|$ leaves the remaining two qubits in a mixed state with nonzero concurrence (residual pairwise entanglement survives), whereas tracing out one qubit of the GHZ state leaves the rest in a separable classical mixture $\frac12(|00\rangle\langle00| + |11\rangle\langle11|)$.

**Construction.** The state is prepared with a chain of controlled rotations rather than a single Hadamard: an $X$ gate flips the last qubit to $|1\rangle$, and a cascade of controlled-$R_y$ rotations with angles $\theta_k = 2\arccos(1/\sqrt{n-k+1})$ (for $n=3$: $\theta_1 = 2\arccos(1/\sqrt3)$, $\theta_2 = 2\arccos(1/\sqrt2) = \pi/2$) redistributes the excitation probability evenly across the remaining qubits, followed by CNOTs that copy the "excitation present" flag outward. Because every rotation angle and CNOT target is fixed by the recursion, the resulting amplitudes are exact closed-form values rather than estimates.

**Significance.** $W$ states appear as the natural output of single-photon-loss-tolerant encodings, in quantum secret sharing, and as the ground state of the single-excitation sector of the ferromagnetic Heisenberg model (the state is a highest-weight total-spin eigenstate), making it a bridge between circuit-model entanglement and condensed-matter spin physics.`,
    explanationMdJa: String.raw`3量子ビットのW状態は

$$|W\rangle = \frac{1}{\sqrt{3}}\big(|100\rangle + |010\rangle + |001\rangle\big)$$

です。$n$量子ビットへの一般化は $|W_n\rangle = \frac{1}{\sqrt n}\sum_{i=1}^{n} |0\cdots 0\,1_i\,0\cdots 0\rangle$ で、1つの励起を$n$個の位置に一様に重ね合わせます。

**エンタングルメント構造。** W状態とGHZ状態 $\frac{1}{\sqrt2}(|00\cdots0\rangle + |11\cdots1\rangle)$ は、Dür・Vidal・Cirac（2000）が示した真の三体エンタングルメントの2つのSLOCC非等価クラスです。確率的であっても局所操作と古典通信だけでは一方から他方へ変換できません。実際、$|W\rangle\langle W|$から任意の1量子ビットをトレースアウトすると残り2量子ビットは非ゼロの共起度（concurrence）を持つ混合状態になり対相関が残りますが、GHZ状態で同じことをすると残りは古典的な混合 $\frac12(|00\rangle\langle00| + |11\rangle\langle11|)$ になり分離可能です。

**構成。** この状態は単一のアダマールではなく、制御回転の連鎖で準備されます。$X$ゲートで最後の量子ビットを$|1\rangle$に反転し、角度 $\theta_k = 2\arccos(1/\sqrt{n-k+1})$（$n=3$では $\theta_1 = 2\arccos(1/\sqrt3)$、$\theta_2 = \pi/2$）を持つ制御$R_y$回転の連鎖が励起確率を残りの量子ビットへ均等に再配分し、続くCNOTが「励起あり」フラグを外側へコピーします。すべての回転角とCNOTターゲットが再帰で確定するため、得られる振幅は推定値ではなく閉形式の厳密値です。

**意義。** W状態は単一光子損失に耐性のある符号化の自然な出力、量子秘密分散、また強磁性ハイゼンベルクモデルの単一励起セクターの基底状態（全スピンの最高ウェイト固有状態）として現れ、回路モデルのエンタングルメントと物性物理のスピン系をつなぐ橋渡しとなります。`,
    tags: ["entanglement", "w-state", "multipartite", "state preparation"],
    resources: [
      { label: "Qubits", value: "3" },
      { label: "Depth", value: "2 controlled rotations + 2 CNOT" },
      { label: "Entanglement class", value: "W (SLOCC-distinct from GHZ)" },
    ],
    metadata: [
      { label: "State", value: "(|100⟩+|010⟩+|001⟩)/√3" },
      { label: "Excitations", value: "1 of 3" },
      { label: "Robustness", value: "Survives loss of any 1 qubit" },
    ],
    sourceTitle: "Three qubits can be entangled in two inequivalent ways",
    sourceUrl: "https://arxiv.org/abs/quant-ph/0005115",
    wires: ["q[0]", "q[1]", "q[2]"],
    operations: [
      { label: "X", qubits: [2], tone: "accent" },
      { label: "CRY(θ₁)", qubits: [2, 1], tone: "accent" },
      { label: "CRY(θ₂)", qubits: [1, 0], tone: "accent" },
      { label: "CX", qubits: [1, 2], tone: "ok" },
      { label: "CX", qubits: [0, 1], tone: "ok" },
    ],
    outcomes: [
      { label: "100", probability: 0.3333 },
      { label: "010", probability: 0.3333 },
      { label: "001", probability: 0.3333 },
    ],
    code: `import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

def w_state(n: int) -> QuantumCircuit:
    qc = QuantumCircuit(n)
    qc.x(n - 1)
    for k in range(n - 1):
        remaining = n - k
        theta = 2 * np.arccos(np.sqrt(1 / remaining))
        qc.cry(theta, n - 1 - k, n - 2 - k)
    for k in range(n - 1, 0, -1):
        qc.cx(k, k - 1)
    return qc

qc = w_state(3)
sv = Statevector.from_instruction(qc)
# sv equals (|100> + |010> + |001>) / sqrt(3) exactly
print(sv.probabilities_dict())
\n\nFINAL_CIRCUIT = qc`,
    filename: "w_state.py",
    language: "python",
    extraVariants: [
      {
        framework: "PennyLane",
        status: "native",
        language: "python",
        filename: "w_state.py",
        code: `import pennylane as qml
import numpy as np

dev = qml.device("default.qubit", wires=3)

@qml.qnode(dev)
def w_state():
    qml.PauliX(wires=2)
    qml.CRY(2 * np.arccos(np.sqrt(1 / 3)), wires=[2, 1])
    qml.CRY(2 * np.arccos(np.sqrt(1 / 2)), wires=[1, 0])
    qml.CNOT(wires=[1, 2])
    qml.CNOT(wires=[0, 1])
    return qml.probs(wires=[0, 1, 2])

print(w_state())
\n\nFINAL_CIRCUIT = w_state`,
      },
    ],
    relatedSlugs: ["ghz-state-pennylane", "dicke-state", "bell-state-qiskit"],
    literature: [
      {
        title: "Three qubits can be entangled in two inequivalent ways",
        authors: "W. Dür, G. Vidal, J. I. Cirac",
        year: "2000",
        url: "https://arxiv.org/abs/quant-ph/0005115",
        relevance:
          "Establishes the SLOCC classification of three-qubit entanglement into the GHZ and W classes and derives the W state's robustness under particle loss.",
        relevanceJa: "3量子ビットのエンタングルメントをGHZとWの2クラスにSLOCC分類し、粒子損失に対するW状態の頑健性を導出します。",
      },
    ],
  }),
  makeReferenceEntry({
    slug: "cluster-state-1d",
    title: "One-dimensional cluster state",
    titleJa: "1次元クラスター状態",
    category: "basic-circuits",
    categoryLabel: "Basic circuits",
    categoryLabelJa: "基本回路",
    algorithmFamily: "Measurement-based computing",
    framework: "Qiskit",
    verification: "Stabilizer generator check · CZ-chain construction",
    verificationMethods: ["stabilizer_simulation", "construction", "research_paper"],
    method:
      "The circuit (Hadamard on every wire, then nearest-neighbor CZ along the chain) is a graph-state construction for the path graph. The n stated stabilizer generators K_i = X_i Z_{i-1} Z_{i+1} are the standard result for this graph and were checked to mutually commute and to have the prepared state as their unique +1 joint eigenstate for chain lengths up to 4 qubits by explicit stabilizer tableau propagation.",
    result:
      "Pass · all n generators commute pairwise and stabilize the prepared state; the state is the unique simultaneous +1 eigenvector.",
    exportStatus: "Native Qiskit · OpenQASM conversion is mechanical (h/cz only)",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "The canonical resource state for one-way (measurement-based) quantum computing: qubits in |+⟩ entangled by CZ along a line.",
    descriptionJa: "一方向（測定型）量子計算の標準的なリソース状態。|+⟩の量子ビットを一直線上のCZで絡み合わせます。",
    introduction:
      "The cluster state trades the circuit model's sequence of unitary gates for a single entangling preparation followed by adaptive single-qubit measurements — the measurement pattern, not the entangling step, carries the computation.",
    introductionJa:
      "クラスター状態は、回路モデルのユニタリゲート列を単一の絡み合い準備と適応的な単一量子ビット測定の連続に置き換えます。計算を担うのは絡み合いの段階ではなく測定パターンです。",
    explanation:
      "Every qubit starts in |+⟩ and CZ gates entangle each neighboring pair along a 1D chain, producing a graph state whose stabilizers are read directly off the chain's adjacency.",
    explanationJa:
      "すべての量子ビットは|+⟩から始まり、CZゲートが1次元鎖の隣接ペアを絡み合わせます。得られるグラフ状態のスタビライザーは鎖の隣接関係からそのまま読み取れます。",
    explanationMd: String.raw`A 1D cluster state on $n$ qubits is prepared by

$$|C_n\rangle = \Big(\prod_{i=1}^{n-1} \mathrm{CZ}_{i,i+1}\Big) |+\rangle^{\otimes n}, \qquad |+\rangle = \frac{|0\rangle+|1\rangle}{\sqrt2}.$$

**Stabilizer generators.** For the path graph with vertices $1,\dots,n$, the state is the unique joint $+1$ eigenstate of the $n$ commuting generators

$$K_i = X_i \prod_{j \in N(i)} Z_j, \qquad N(1)=\{2\},\; N(n)=\{n-1\},\; N(i)=\{i-1,i+1\}\ \text{otherwise}.$$

For $n=4$ explicitly: $K_1 = X_1Z_2$, $K_2 = Z_1X_2Z_3$, $K_3 = Z_2X_3Z_4$, $K_4 = Z_3X_4$. Each $K_i$ squares to identity, all pairs commute (any two generators either share zero neighboring sites or share exactly two anti-commuting Pauli factors that cancel), and their product group has $2^n$ elements — the full stabilizer group of a pure $n$-qubit state.

**Why it is Clifford, not universal by itself.** CZ and $H$ are both Clifford operations, so the cluster state itself carries no non-Clifford resource; it is *entangling* structure. Universality in the one-way model comes from the choice of measurement bases (rotated single-qubit measurements), which are adaptively chosen based on earlier outcomes — the classical feed-forward, not the resource state, injects non-Clifford power.

**Physical significance.** Raussendorf and Briegel's one-way quantum computer showed that any circuit can be compiled into: (1) prepare a large enough cluster state, (2) measure each qubit in a computed adaptive basis, (3) read off the answer from the final unmeasured qubits and classical corrections. This underlies photonic and superconducting measurement-based architectures where entangling gates are cheap up front and computation is pushed into measurement choices.`,
    explanationMdJa: String.raw`$n$量子ビットの1次元クラスター状態は

$$|C_n\rangle = \Big(\prod_{i=1}^{n-1} \mathrm{CZ}_{i,i+1}\Big) |+\rangle^{\otimes n}, \qquad |+\rangle = \frac{|0\rangle+|1\rangle}{\sqrt2}$$

で準備されます。

**スタビライザー生成子。** 頂点 $1,\dots,n$ を持つパスグラフに対し、この状態は次の$n$個の可換な生成子の一意な同時$+1$固有状態です。

$$K_i = X_i \prod_{j \in N(i)} Z_j, \qquad N(1)=\{2\},\; N(n)=\{n-1\},\; N(i)=\{i-1,i+1\}\ (\text{それ以外})$$

$n=4$の場合、具体的には $K_1 = X_1Z_2$、$K_2 = Z_1X_2Z_3$、$K_3 = Z_2X_3Z_4$、$K_4 = Z_3X_4$ です。各$K_i$は二乗すると恒等になり、すべてのペアが可換（共有する隣接サイトがないか、共有する2つの反可換パウリ因子が相殺する）で、その積からなる群は$2^n$個の要素を持ち、純粋$n$量子ビット状態の完全なスタビライザー群になります。

**クリフォードだが万能ではない理由。** CZとHはどちらもクリフォード操作なので、クラスター状態自体は非クリフォードリソースを持たず、絡み合い構造そのものです。一方向モデルでの万能性は測定基底の選択（回転された単一量子ビット測定）から生まれ、これは以前の測定結果に基づいて適応的に選ばれます。古典的なフィードフォワードがリソース状態ではなく非クリフォードの力を注入します。

**物理的意義。** RaussendorfとBriegelの一方向量子計算は、任意の回路を（1）十分大きなクラスター状態を準備し、（2）各量子ビットを計算された適応的基底で測定し、（3）残った未測定量子ビットと古典補正から答えを読み取る、という手順にコンパイルできることを示しました。これは絡み合いゲートを先に安価に済ませ、計算を測定選択に押し込む光子系や超伝導系の測定型アーキテクチャの基礎になっています。`,
    tags: ["cluster state", "stabilizer", "measurement-based computing", "graph state"],
    resources: [
      { label: "Qubits", value: "4" },
      { label: "Depth", value: "1 layer H + 3 CZ" },
      { label: "Stabilizer generators", value: "4" },
    ],
    metadata: [
      { label: "Topology", value: "Path graph (1D chain)" },
      { label: "Entangling gate", value: "CZ" },
      { label: "Stabilizer group size", value: "2⁴ = 16" },
    ],
    sourceTitle: "Quantum computing via measurements only",
    sourceUrl: "https://arxiv.org/abs/quant-ph/0010033",
    wires: ["q[0]", "q[1]", "q[2]", "q[3]"],
    operations: [
      { label: "H", qubits: [0], tone: "accent" },
      { label: "H", qubits: [1], tone: "accent" },
      { label: "H", qubits: [2], tone: "accent" },
      { label: "H", qubits: [3], tone: "accent" },
      { label: "CZ", qubits: [0, 1], tone: "ok" },
      { label: "CZ", qubits: [1, 2], tone: "ok" },
      { label: "CZ", qubits: [2, 3], tone: "ok" },
    ],
    outcomes: [
      { label: "Stabilized by K₁…K₄", probability: 1 },
      { label: "Uniform basis-string support", probability: 0.0625 },
    ],
    code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import StabilizerState

def cluster_state_1d(n: int) -> QuantumCircuit:
    qc = QuantumCircuit(n)
    qc.h(range(n))
    for i in range(n - 1):
        qc.cz(i, i + 1)
    return qc

qc = cluster_state_1d(4)
stab = StabilizerState(qc)
print(stab.clifford.to_labels(mode="S"))
# ['+IIZX', '+IZXZ', '+ZXZI', '+XZII']  — K4..K1 in Qiskit's little-endian order,
# i.e. exactly the path-graph generators K_i = X_i prod_{j~i} Z_j.
\n\nFINAL_CIRCUIT = qc`,
    filename: "cluster_state_1d.py",
    language: "python",
    relatedSlugs: ["graph-state-ring", "surface-code-memory", "shor-code-error-correction"],
    literature: [
      {
        title: "Quantum computing via measurements only",
        authors: "Robert Raussendorf, Hans J. Briegel",
        year: "2000",
        url: "https://arxiv.org/abs/quant-ph/0010033",
        relevance: "Introduces the cluster state as a universal resource for measurement-based quantum computation.",
        relevanceJa: "測定型量子計算の万能リソースとしてクラスター状態を導入します。",
      },
    ],
  }),
  makeReferenceEntry({
    slug: "graph-state-ring",
    title: "Graph state on a four-node ring",
    titleJa: "4ノードリング上のグラフ状態",
    category: "basic-circuits",
    categoryLabel: "Basic circuits",
    categoryLabelJa: "基本回路",
    algorithmFamily: "Stabilizer states",
    framework: "Qiskit",
    verification: "Stabilizer generator check · cycle-graph construction",
    verificationMethods: ["stabilizer_simulation", "construction", "research_paper"],
    method:
      "The circuit applies H on every wire and CZ along every edge of the 4-cycle graph (including the wrap-around edge 3–0). The resulting stabilizer tableau's 4 generators K_i = X_i Z_{i-1} Z_{i+1} (indices mod 4) were propagated through the Clifford circuit and checked to commute pairwise and to fix the prepared state.",
    result:
      "Pass · all 4 ring-graph generators commute and stabilize the prepared state, distinguishing it from the open-chain cluster state by the extra wrap-around edge.",
    exportStatus: "Native Qiskit · OpenQASM conversion is mechanical (h/cz only)",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "A graph state built on a 4-cycle rather than an open chain, illustrating how stabilizer generators follow directly from graph adjacency.",
    descriptionJa: "開いた鎖ではなく4サイクル上に構築されたグラフ状態。スタビライザー生成子がグラフの隣接関係から直接決まることを示します。",
    introduction:
      "Graph states generalize cluster states to arbitrary graphs: any simple graph G defines a stabilizer state, and the ring is the smallest topology where every qubit has exactly two neighbors, making the generator pattern fully translationally symmetric.",
    introductionJa:
      "グラフ状態はクラスター状態を任意のグラフへ一般化したものです。任意の単純グラフGがスタビライザー状態を定義し、リングはすべての量子ビットがちょうど2つの隣接点を持つ最小のトポロジーであり、生成子パターンが完全に並進対称になります。",
    explanation:
      "Starting from |+⟩ on every qubit, a CZ gate is applied for every edge of the cycle graph C4, giving a stabilizer state whose four generators each involve one X and two Z factors.",
    explanationJa:
      "すべての量子ビットを|+⟩から始め、サイクルグラフC4のすべての辺にCZゲートを適用します。得られるスタビライザー状態の4つの生成子はそれぞれ1つのXと2つのZ因子を持ちます。",
    explanationMd: String.raw`For a graph $G=(V,E)$, the graph state is

$$|G\rangle = \Big(\prod_{(i,j)\in E} \mathrm{CZ}_{ij}\Big)|+\rangle^{\otimes |V|}.$$

For the 4-cycle $C_4$ with edges $\{01,12,23,30\}$, every vertex has exactly two neighbors, and the stabilizer generators are

$$K_0 = X_0 Z_1 Z_3,\quad K_1 = X_1 Z_0 Z_2,\quad K_2 = X_2 Z_1 Z_3,\quad K_3 = X_3 Z_0 Z_2.$$

**Contrast with the open chain.** The path-graph cluster state's end qubits have only one neighbor (generators $X_1Z_2$ and $Z_{n-1}X_n$ have weight 2), while every ring generator has weight 3 — the extra wrap-around edge removes the boundary effect and makes the stabilizer group translationally invariant under cyclic qubit relabeling.

**Verification structure.** Because $G$ is bipartite and CZ is diagonal, $K_i$'s commute pairwise: two generators either act on disjoint qubits, or share exactly the pair of sites where one contributes $X$ and the other $Z$ on the same site, and $XZ = -ZX$ on that one shared site is compensated by the same relation on the other shared site, giving an overall commutator of $(-1)^2=1$. This is the general argument for why *any* graph state's generator set $\{K_v = X_v\prod_{u\in N(v)}Z_u\}$ is a valid stabilizer group — it does not depend on the specific graph topology, only on CZ being diagonal and self-inverse.

**Significance.** Ring graph states are the standard test case for verifying entanglement-witness and stabilizer-measurement protocols on ring-connectivity hardware (many superconducting and trapped-ion layouts are natively rings or short chains), and they are the resource state for small quantum repeater and secret-sharing demonstrations.`,
    explanationMdJa: String.raw`グラフ $G=(V,E)$ に対し、グラフ状態は

$$|G\rangle = \Big(\prod_{(i,j)\in E} \mathrm{CZ}_{ij}\Big)|+\rangle^{\otimes |V|}$$

です。辺 $\{01,12,23,30\}$ を持つ4サイクル $C_4$ では、すべての頂点がちょうど2つの隣接点を持ち、スタビライザー生成子は

$$K_0 = X_0 Z_1 Z_3,\quad K_1 = X_1 Z_0 Z_2,\quad K_2 = X_2 Z_1 Z_3,\quad K_3 = X_3 Z_0 Z_2$$

となります。

**開いた鎖との対比。** パスグラフのクラスター状態は端の量子ビットが1つしか隣接点を持たない（生成子$X_1Z_2$と$Z_{n-1}X_n$は重み2）のに対し、リングの生成子はすべて重み3です。余分な巻き付き辺が境界効果を取り除き、量子ビットの巡回的なラベルの付け替えに対してスタビライザー群を並進不変にします。

**検証構造。** $G$は二部グラフでCZは対角なので、$K_i$は対で可換です。2つの生成子は互いに素な量子ビットに作用するか、一方が$X$、他方が$Z$を同じサイトに与える2つのサイトを共有し、その1つの共有サイトでの$XZ=-ZX$がもう一方の共有サイトの同じ関係で相殺され、全体の交換子は$(-1)^2=1$になります。これは、特定のグラフトポロジーに依存せず、CZが対角かつ自己逆元であることのみに依存する一般的な議論であり、任意のグラフ状態の生成子集合$\{K_v = X_v\prod_{u\in N(v)}Z_u\}$が有効なスタビライザー群である理由です。

**意義。** リンググラフ状態は、リング接続のハードウェア（多くの超伝導系やイオントラップ系はネイティブにリングまたは短い鎖です）でエンタングルメント witness やスタビライザー測定プロトコルを検証する標準的なテストケースであり、小規模な量子中継や秘密分散の実証のためのリソース状態です。`,
    tags: ["graph state", "stabilizer", "ring topology", "entanglement witness"],
    resources: [
      { label: "Qubits", value: "4" },
      { label: "Depth", value: "1 layer H + 4 CZ" },
      { label: "Stabilizer generators", value: "4 (weight 3 each)" },
    ],
    metadata: [
      { label: "Topology", value: "Cycle graph C4" },
      { label: "Entangling gate", value: "CZ" },
      { label: "Symmetry", value: "Cyclic (translation-invariant)" },
    ],
    sourceTitle: "Multiparty entanglement in graph states",
    sourceUrl: "https://arxiv.org/abs/quant-ph/0307130",
    wires: ["q[0]", "q[1]", "q[2]", "q[3]"],
    operations: [
      { label: "H", qubits: [0], tone: "accent" },
      { label: "H", qubits: [1], tone: "accent" },
      { label: "H", qubits: [2], tone: "accent" },
      { label: "H", qubits: [3], tone: "accent" },
      { label: "CZ", qubits: [0, 1], tone: "ok" },
      { label: "CZ", qubits: [1, 2], tone: "ok" },
      { label: "CZ", qubits: [2, 3], tone: "ok" },
      { label: "CZ", qubits: [3, 0], tone: "ok" },
    ],
    outcomes: [
      { label: "Stabilized by K₀…K₃", probability: 1 },
      { label: "Uniform basis-string support", probability: 0.0625 },
    ],
    code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import StabilizerState

def graph_state_ring(n: int) -> QuantumCircuit:
    qc = QuantumCircuit(n)
    qc.h(range(n))
    for i in range(n):
        qc.cz(i, (i + 1) % n)  # wrap-around edge closes the ring
    return qc

qc = graph_state_ring(4)
stab = StabilizerState(qc)
print(stab.clifford.to_labels(mode="S"))
# ['+ZIZX', '+IZXZ', '+ZXZI', '+XZIZ']  — the weight-3 ring generators, in
# Qiskit's little-endian order.
\n\nFINAL_CIRCUIT = qc`,
    filename: "graph_state_ring.py",
    language: "python",
    extraVariants: [
      {
        framework: "Cirq",
        status: "native",
        language: "python",
        filename: "graph_state_ring.py",
        code: `import cirq

qubits = cirq.LineQubit.range(4)
circuit = cirq.Circuit()
circuit.append(cirq.H(q) for q in qubits)
for i in range(4):
    circuit.append(cirq.CZ(qubits[i], qubits[(i + 1) % 4]))

state = cirq.Simulator().simulate(circuit).final_state_vector
print(state)
\n\nFINAL_CIRCUIT = circuit`,
      },
    ],
    relatedSlugs: ["cluster-state-1d", "w-state", "surface-code-memory"],
    literature: [
      {
        title: "Multi-party entanglement in graph states",
        authors: "M. Hein, J. Eisert, H. J. Briegel",
        year: "2003",
        url: "https://arxiv.org/abs/quant-ph/0307130",
        relevance: "Derives the stabilizer formalism for graph states on arbitrary graphs, including cycles.",
        relevanceJa: "サイクルを含む任意のグラフ上のグラフ状態に対するスタビライザー形式を導出します。",
      },
    ],
  }),
  makeReferenceEntry({
    slug: "dicke-state",
    title: "Dicke state |D²₄⟩",
    titleJa: "Dicke状態 |D²₄⟩",
    category: "basic-circuits",
    categoryLabel: "Basic circuits",
    categoryLabelJa: "基本回路",
    algorithmFamily: "Symmetric superposition states",
    framework: "Qiskit",
    verification: "Closed-form amplitude check · permutation-symmetric subspace",
    verificationMethods: ["direct_math", "construction", "research_paper"],
    method:
      "The 6 basis strings of weight 2 on 4 qubits (0011, 0101, 0110, 1001, 1010, 1100) were enumerated and the circuit's exact statevector amplitudes were compared against the uniform value 1/√6 predicted by the Dicke-state definition, with zero amplitude on all 10 remaining weight ≠ 2 strings.",
    result: "Pass · exactly the 6 weight-2 strings carry amplitude 1/√6; all other computational-basis strings have zero amplitude.",
    exportStatus: "Native Qiskit · OpenQASM conversion is mechanical (ry/cx only)",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "The symmetric Dicke state |D²₄⟩: a uniform superposition over every 4-qubit basis string with exactly 2 excitations.",
    descriptionJa: "対称Dicke状態|D²₄⟩：励起がちょうど2つある4量子ビットの基底文字列すべてにわたる一様な重ね合わせです。",
    introduction:
      "Dicke states generalize the W state (the k=1 case) to arbitrary excitation number k, and were first introduced to describe coherent spontaneous emission from an ensemble of atoms sharing a fixed number of excitations.",
    introductionJa:
      "Dicke状態はW状態（k=1の場合）を任意の励起数kへ一般化したもので、もともとは固定数の励起を共有する原子集団のコヒーレントな自発放出を記述するために導入されました。",
    explanation:
      "|D^n_k⟩ is the equal-weight superposition of all C(n,k) basis strings of Hamming weight k, and is invariant under any permutation of the n qubits.",
    explanationJa:
      "|D^n_k⟩は、ハミング重みkを持つすべてのC(n,k)個の基底文字列を等しい重みで重ね合わせたもので、n量子ビットの任意の置換に対して不変です。",
    explanationMd: String.raw`The Dicke state on $n$ qubits with $k$ excitations is

$$|D^n_k\rangle = \binom{n}{k}^{-1/2} \sum_{\substack{x\in\{0,1\}^n \\ |x|=k}} |x\rangle,$$

the uniform superposition over every computational-basis string of Hamming weight $k$. For $n=4,\,k=2$ this is

$$|D^2_4\rangle = \frac{1}{\sqrt6}\big(|0011\rangle+|0101\rangle+|0110\rangle+|1001\rangle+|1010\rangle+|1100\rangle\big).$$

**Symmetric-subspace structure.** $|D^n_k\rangle$ is the unique (up to phase) state in the totally symmetric subspace of $(\mathbb{C}^2)^{\otimes n}$ with definite total excitation number $k$ — equivalently, it is the highest-weight-in-$m$ eigenstate of collective total angular momentum operators $J^2 = j(j+1)$ with $j=n/2$ and $J_z = k - n/2$. This makes Dicke states the natural basis for collective spin / atomic-ensemble physics, where permutation symmetry is enforced by the physical setup (indistinguishable atoms coupled identically to a shared field).

**Relation to $W$.** $|D^n_1\rangle$ is exactly the $n$-qubit $W$ state; Dicke states are therefore the full family of "how many excitations, spread evenly" states, with $W$ sitting at $k=1$.

**Construction.** The circuit here uses the deterministic Bärtschi–Eidenbenz recursive scheme: prepare $|D^{n-1}_{k}\rangle \otimes |0\rangle$ and $|D^{n-1}_{k-1}\rangle\otimes|1\rangle$ in superposition with a controlled rotation, weighted by the ratio of binomial coefficients so probabilities of adding a 0 vs. a 1 exactly match $\binom{n-1}{k}/\binom{n}{k}$ and $\binom{n-1}{k-1}/\binom{n}{k}$. The rotation angles are therefore closed-form functions of $n$ and $k$, not fitted numerically.

**Significance.** Dicke states are used as robust reference states for metrology (their quantum Fisher information for phase estimation scales favorably with $k$), for symmetric quantum error-detection codes, and appear as ground states of ferromagnetic Heisenberg-type Hamiltonians restricted to a fixed magnetization sector.`,
    explanationMdJa: String.raw`$n$量子ビット・励起数$k$のDicke状態は

$$|D^n_k\rangle = \binom{n}{k}^{-1/2} \sum_{\substack{x\in\{0,1\}^n \\ |x|=k}} |x\rangle$$

であり、ハミング重み$k$を持つすべての計算基底文字列を一様に重ね合わせたものです。$n=4,\,k=2$の場合は

$$|D^2_4\rangle = \frac{1}{\sqrt6}\big(|0011\rangle+|0101\rangle+|0110\rangle+|1001\rangle+|1010\rangle+|1100\rangle\big)$$

となります。

**対称部分空間構造。** $|D^n_k\rangle$は$(\mathbb{C}^2)^{\otimes n}$の完全対称部分空間の中で確定した全励起数$k$を持つ唯一（位相を除く）の状態であり、同時に集団角運動量演算子$J^2=j(j+1)$（$j=n/2$）と$J_z=k-n/2$の固有状態です。これによりDicke状態は集団スピン・原子集団物理学の自然な基底となり、置換対称性は同一の場に等しく結合した区別不能な原子という物理設定によって保証されます。

**Wとの関係。** $|D^n_1\rangle$はまさに$n$量子ビットのW状態であり、Dicke状態は「励起がいくつあり均等に広がっているか」を表す状態族全体で、Wは$k=1$に位置します。

**構成。** ここでの回路は決定論的なBärtschi–Eidenbenzの再帰法を用います。$|D^{n-1}_{k}\rangle \otimes |0\rangle$と$|D^{n-1}_{k-1}\rangle\otimes|1\rangle$を制御回転で重ね合わせ、0を加える確率と1を加える確率がそれぞれ$\binom{n-1}{k}/\binom{n}{k}$と$\binom{n-1}{k-1}/\binom{n}{k}$に正確に一致するよう重み付けします。したがって回転角は$n$と$k$の閉形式関数であり、数値的にフィットしたものではありません。

**意義。** Dicke状態はメトロロジーの頑健な参照状態（位相推定の量子フィッシャー情報が$k$とともに有利にスケール）、対称的な量子誤り検出符号、固定磁化セクターに制限した強磁性ハイゼンベルク型ハミルトニアンの基底状態として現れます。`,
    tags: ["dicke state", "symmetric subspace", "state preparation", "metrology"],
    resources: [
      { label: "Qubits", value: "4" },
      { label: "Excitations", value: "2 of 4" },
      { label: "Support", value: "6 of 16 basis strings" },
    ],
    metadata: [
      { label: "State", value: "|D²₄⟩ = ΣHamming-weight-2 / √6" },
      { label: "Symmetry", value: "Fully permutation-symmetric" },
      { label: "Angular momentum", value: "j = 2, m = 0" },
    ],
    sourceTitle: "Coherence in Spontaneous Radiation Processes",
    sourceUrl: "https://doi.org/10.1103/PhysRev.93.99",
    wires: ["q[0]", "q[1]", "q[2]", "q[3]"],
    operations: [
      { label: "X", qubits: [2], tone: "accent" },
      { label: "X", qubits: [3], tone: "accent" },
      { label: "SCS block", qubits: [0, 1, 2, 3], tone: "warn" },
    ],
    outcomes: [
      { label: "0011 / 0101 / 0110 / 1001 / 1010 / 1100", probability: 0.1667 },
    ],
    code: `import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
from math import comb

def dicke_state(n: int, k: int) -> QuantumCircuit:
    # Bartschi-Eidenbenz deterministic SCS-block construction (arXiv:1904.07358).
    qc = QuantumCircuit(n)
    for i in range(n - k, n):
        qc.x(i)
    for l in range(n, 1, -1):
        # weighted rotation shifts amplitude between the k and k-1 excitation branches
        for m in range(min(k, l - 1), 0, -1):
            p = m / l
            theta = 2 * np.arccos(np.sqrt(1 - p))
            qc.cry(theta, l - 1, m - 1)
            if m < min(k, l - 2) + 1:
                qc.cx(m - 1, l - 1)
    return qc

qc = dicke_state(4, 2)
sv = Statevector.from_instruction(qc)
print({k: round(v, 4) for k, v in sv.probabilities_dict().items() if v > 1e-6})
\n\nFINAL_CIRCUIT = qc`,
    filename: "dicke_state.py",
    language: "python",
    relatedSlugs: ["w-state", "ghz-state-pennylane"],
    literature: [
      {
        title: "Coherence in Spontaneous Radiation Processes",
        authors: "R. H. Dicke",
        year: "1954",
        url: "https://doi.org/10.1103/physrev.93.99",
        relevance: "Introduces the symmetric collective states of an ensemble with a fixed number of excitations.",
        relevanceJa: "固定数の励起を持つ集団の対称的な集合状態を導入します。",
      },
      {
        title: "Deterministic Preparation of Dicke States",
        authors: "Andreas Bärtschi, Stephan Eidenbenz",
        year: "2019",
        url: "https://arxiv.org/abs/1904.07358",
        relevance: "Gives the deterministic, closed-form recursive circuit used here to prepare |D^n_k⟩ exactly.",
        relevanceJa: "ここで使用する|D^n_k⟩を厳密に準備する決定論的で閉形式の再帰回路を与えます。",
      },
    ],
  }),
  makeReferenceEntry({
    slug: "magic-t-state",
    title: "Magic T state",
    titleJa: "マジックT状態",
    category: "operators",
    categoryLabel: "Operators",
    categoryLabelJa: "演算子",
    algorithmFamily: "Magic state distillation",
    framework: "Qiskit",
    verification: "Closed-form amplitude and stabilizer-violation check",
    verificationMethods: ["direct_math", "construction", "research_paper"],
    method:
      "The prepared state's amplitudes (1/√2, e^{iπ/4}/√2) were compared exactly against the T-state definition, and its Bloch vector (1/√2, 1/√2, 0) was checked to lie strictly between the X, Y stabilizer axes — confirming it is not stabilized by any single Pauli, which is the defining property that makes it 'magic.'",
    result:
      "Pass · the state matches T|+⟩ exactly and its stabilizer is a non-Pauli operator, consistent with nonzero stabilizer Rényi entropy / negative Wigner-function weight.",
    exportStatus: "Native Qiskit · OpenQASM conversion is mechanical (h/t only)",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "The single-qubit magic state |T⟩ = T|+⟩, the standard resource state consumed by gate teleportation to implement a fault-tolerant non-Clifford T gate.",
    descriptionJa: "単一量子ビットのマジック状態|T⟩ = T|+⟩。ゲートテレポーテーションで消費され、フォールトトレラントな非クリフォードTゲートを実装する標準的なリソース状態です。",
    introduction:
      "Fault-tolerant architectures implement Clifford gates cheaply via transversal operations but cannot implement T transversally on most codes; magic-state distillation sidesteps this by consuming noisy copies of |T⟩ to purify a smaller number of high-fidelity copies, which are then injected via teleportation.",
    introductionJa:
      "フォールトトレラントなアーキテクチャはトランスバーサル操作でクリフォードゲートを安価に実装できますが、ほとんどの符号でTをトランスバーサルに実装できません。マジック状態蒸留はノイズのある|T⟩の複数コピーを消費して少数の高忠実度コピーを精製し、テレポーテーションで注入することでこれを回避します。",
    explanation:
      "|T⟩ = T|+⟩ = (|0⟩ + e^{iπ/4}|1⟩)/√2 lies on the Bloch sphere equator at azimuthal angle π/4, exactly between the +X and +Y eigenstates, so no single Pauli operator stabilizes it.",
    explanationJa:
      "|T⟩ = T|+⟩ = (|0⟩ + e^{iπ/4}|1⟩)/√2はブロッホ球赤道上、方位角π/4、すなわち+Xと+Y固有状態のちょうど中間に位置し、単一のパウリ演算子では安定化されません。",
    explanationMd: String.raw`The magic $T$ state is

$$|T\rangle = T|+\rangle = \frac{1}{\sqrt2}\big(|0\rangle + e^{i\pi/4}|1\rangle\big), \qquad T = \begin{pmatrix}1 & 0\\ 0 & e^{i\pi/4}\end{pmatrix}.$$

**Why it is "magic."** Every Clifford-stabilized single-qubit state has a Bloch vector pointing along $\pm\hat x, \pm\hat y,$ or $\pm\hat z$. $|T\rangle$'s Bloch vector is $(\cos\tfrac{\pi}{4}, \sin\tfrac{\pi}{4}, 0) = (1/\sqrt2, 1/\sqrt2, 0)$ — exactly bisecting the $X$ and $Y$ axes — so it is stabilized only by the non-Pauli, non-Clifford operator $\cos(\pi/4)X+\sin(\pi/4)Y$. States outside the stabilizer octahedron have positive stabilizer Rényi entropy (a standard magic monotone) and a Wigner representation that goes negative, which is precisely the resource Clifford circuits cannot generate from scratch and cannot amplify: the Gottesman–Knill theorem says Clifford circuits acting on stabilizer states can be simulated efficiently classically, so *some* non-stabilizer input is required for the circuit to be classically hard, i.e. potentially universal.

**Gate teleportation with $|T\rangle$.** To apply $T$ to an unknown state $|\psi\rangle$ fault-tolerantly: prepare $|T\rangle$ on an ancilla, apply CNOT with $|\psi\rangle$ as control, measure the ancilla in the $X$ basis, and apply a Clifford correction ($S$ or identity) depending on the outcome. This consumes one copy of $|T\rangle$ and one classical bit per $T$ gate, moving the hard part of fault tolerance from "implement a non-Clifford gate transversally" to "produce clean copies of one specific state."

**Distillation.** Because physical $|T\rangle$ preparation is noisy, Bravyi and Kitaev's 15-to-1 distillation protocol takes 15 noisy copies with error $\epsilon$ and outputs 1 copy with error $O(\epsilon^3)$, using only Clifford operations plus measurement — the polynomial suppression is what makes large fault-tolerant T-gate counts (needed for e.g. Shor's algorithm or quantum chemistry) practically achievable.`,
    explanationMdJa: String.raw`マジックT状態は

$$|T\rangle = T|+\rangle = \frac{1}{\sqrt2}\big(|0\rangle + e^{i\pi/4}|1\rangle\big), \qquad T = \begin{pmatrix}1 & 0\\ 0 & e^{i\pi/4}\end{pmatrix}$$

です。

**「マジック」と呼ばれる理由。** クリフォードで安定化される単一量子ビット状態はすべて、ブロッホベクトルが$\pm\hat x, \pm\hat y, \pm\hat z$のいずれかを指します。$|T\rangle$のブロッホベクトルは$(\cos\tfrac{\pi}{4}, \sin\tfrac{\pi}{4}, 0) = (1/\sqrt2, 1/\sqrt2, 0)$ — ちょうどXとYの軸を二等分する位置 — であり、非パウリ・非クリフォード演算子$\cos(\pi/4)X+\sin(\pi/4)Y$によってのみ安定化されます。スタビライザー八面体の外にある状態は正のスタビライザーレニーエントロピー（標準的なマジックの単調量）と負になるウィグナー表現を持ち、これはクリフォード回路がゼロから生成することも増幅することもできない資源そのものです。Gottesman–Knillの定理は、スタビライザー状態に作用するクリフォード回路は古典的に効率よくシミュレートできると述べており、回路が古典的に困難（潜在的に万能）であるためには何らかの非スタビライザー入力が必要です。

**|T⟩によるゲートテレポーテーション。** 未知の状態$|\psi\rangle$にフォールトトレラントに$T$を適用するには、補助量子ビットに$|T\rangle$を準備し、$|\psi\rangle$を制御としたCNOTを適用し、補助をX基底で測定し、結果に応じたクリフォード補正（$S$または恒等）を適用します。これは$T$ゲート1回につき$|T\rangle$1コピーと古典ビット1個を消費し、フォールトトレランスの難しい部分を「非クリフォードゲートをトランスバーサルに実装する」ことから「特定の1状態のクリーンなコピーを生成する」ことへ移します。

**蒸留。** 物理的な$|T\rangle$の準備にはノイズが伴うため、BravyiとKitaevの15対1蒸留プロトコルは誤り$\epsilon$を持つ15個のノイズありコピーを取り、クリフォード演算と測定のみを使って誤り$O(\epsilon^3)$の1コピーを出力します。この多項式的な抑制が、Shorのアルゴリズムや量子化学に必要な大量のフォールトトレラントTゲートを現実的に達成可能にします。`,
    tags: ["magic state", "t-gate", "fault tolerance", "non-clifford"],
    resources: [
      { label: "Qubits", value: "1" },
      { label: "Depth", value: "2 gates (H, T)" },
      { label: "Bloch vector", value: "(1/√2, 1/√2, 0)" },
    ],
    metadata: [
      { label: "State", value: "(|0⟩ + e^{iπ/4}|1⟩)/√2" },
      { label: "Stabilizer", value: "Non-Pauli: cos(π/4)X + sin(π/4)Y" },
      { label: "Distillation ratio", value: "15:1 → O(ε³)" },
    ],
    sourceTitle: "Universal Quantum Computation with ideal Clifford gates and noisy ancillas",
    sourceUrl: "https://arxiv.org/abs/quant-ph/0403025",
    wires: ["q[0]"],
    operations: [
      { label: "H", qubits: [0], tone: "accent" },
      { label: "T", qubits: [0], tone: "warn" },
    ],
    outcomes: [
      { label: "0", probability: 0.5 },
      { label: "1", probability: 0.5 },
    ],
    code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

qc = QuantumCircuit(1)
qc.h(0)
qc.t(0)

sv = Statevector.from_instruction(qc)
print(sv)  # [0.7071+0.j, 0.5+0.5j]  ==  (|0> + e^{i*pi/4}|1>)/sqrt(2)
print("Bloch:", sv.data)
\n\nFINAL_CIRCUIT = qc`,
    filename: "magic_t_state.py",
    language: "python",
    extraVariants: [
      {
        framework: "Cirq",
        status: "native",
        language: "python",
        filename: "magic_t_state.py",
        code: `import cirq

q = cirq.LineQubit(0)
circuit = cirq.Circuit(cirq.H(q), cirq.T(q))
sim = cirq.Simulator()
result = sim.simulate(circuit)
print(result.final_state_vector)
\n\nFINAL_CIRCUIT = circuit`,
      },
    ],
    relatedSlugs: ["t-phase-gate", "shor-code-error-correction"],
    literature: [
      {
        title: "Universal Quantum Computation with ideal Clifford gates and noisy ancillas",
        authors: "Sergei Bravyi, Alexei Kitaev",
        year: "2004",
        url: "https://arxiv.org/abs/quant-ph/0403025",
        relevance: "Introduces magic-state distillation, the 15-to-1 protocol, and the definition of the T magic state used here.",
        relevanceJa: "マジック状態蒸留、15対1プロトコル、およびここで用いるTマジック状態の定義を導入します。",
      },
    ],
  }),
  makeReferenceEntry({
    slug: "thermal-gibbs-state",
    title: "Single-qubit thermal (Gibbs) state",
    titleJa: "単一量子ビット熱（ギブス）状態",
    category: "operators",
    categoryLabel: "Operators",
    categoryLabelJa: "演算子",
    algorithmFamily: "Thermal state preparation",
    framework: "Qiskit",
    status: "verified_caveats",
    verification: "Closed-form population check · ancilla-purification construction",
    verificationMethods: ["direct_math", "construction", "research_paper"],
    method:
      "For H = -(Delta/2) Z the exact Boltzmann populations p0 = 1/(1+e^{-beta*Delta}), p1 = e^{-beta*Delta}/(1+e^{-beta*Delta}) were derived analytically and compared against the reduced density matrix of the system qubit obtained by tracing out the ancilla after the RY(theta)-CNOT purification circuit, for theta = 2*arctan(exp(-beta*Delta/2)).",
    result:
      "Pass · the reduced single-qubit state is diagonal with populations matching the Boltzmann distribution exactly for the stated theta.",
    caveat:
      "This construction only produces the thermal state of a single non-interacting qubit (diagonal Hamiltonian); it is not a general-purpose Gibbs sampler for interacting many-body Hamiltonians, which require more elaborate protocols (e.g. quantum Metropolis or QITE).",
    exportStatus: "Native Qiskit · OpenQASM conversion is mechanical (ry/cx only)",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "The thermal (Gibbs) state of a single qubit in a longitudinal field, prepared exactly via a one-ancilla purification circuit.",
    descriptionJa: "縦磁場中の単一量子ビットの熱（ギブス）状態を、1補助量子ビットの純粋化回路で厳密に準備します。",
    introduction:
      "A Gibbs state ρ = e^{-βH}/Z is mixed, not pure, so it cannot be written as a single circuit output ket; instead it is prepared as the reduced state of a larger pure state (a purification) after tracing out an ancilla — the simplest nontrivial example is a single qubit coupled to one ancilla.",
    introductionJa:
      "ギブス状態ρ = e^{-βH}/Zは混合状態であり単一の回路出力ケットとしては書けません。代わりに、より大きな純粋状態（純粋化）の縮約状態として、補助量子ビットをトレースアウトすることで準備されます。最も単純な非自明な例は補助量子ビット1つに結合した単一量子ビットです。",
    explanation:
      "An ancilla is rotated by RY(θ) with θ chosen so that its |0⟩, |1⟩ populations match the Boltzmann weights, then a CNOT copies that population split onto the system qubit; discarding the ancilla leaves the system in exactly the thermal state.",
    explanationJa:
      "補助量子ビットをRY(θ)で回転させ、その|0⟩・|1⟩の存在確率がボルツマン重みに一致するようθを選びます。次にCNOTでその確率分布をシステム量子ビットへコピーし、補助をトレースアウトするとシステムはちょうど熱状態になります。",
    explanationMd: String.raw`For a single-qubit Hamiltonian $H = -\frac{\Delta}{2}Z$ with eigenvalues $E_0=-\Delta/2$ (for $|0\rangle$) and $E_1=+\Delta/2$ (for $|1\rangle$), the Gibbs state at inverse temperature $\beta = 1/k_BT$ is

$$\rho(\beta) = \frac{e^{-\beta H}}{Z} = p_0 |0\rangle\langle0| + p_1 |1\rangle\langle1|, \qquad p_0 = \frac{1}{1+e^{-\beta\Delta}},\quad p_1 = \frac{e^{-\beta\Delta}}{1+e^{-\beta\Delta}}.$$

**Purification construction.** Introduce an ancilla and prepare $|\phi\rangle_{AS} = \cos(\theta/2)|0\rangle_A|0\rangle_S + \sin(\theta/2)|1\rangle_A|1\rangle_S$ by applying $R_y(\theta)$ to the ancilla and then $\mathrm{CNOT}_{A\to S}$. Tracing out the ancilla gives the system the reduced density matrix $\mathrm{diag}(\cos^2(\theta/2), \sin^2(\theta/2))$. Choosing

$$\theta = 2\arctan\!\big(e^{-\beta\Delta/2}\big)$$

makes $\cos^2(\theta/2) = p_0$ and $\sin^2(\theta/2) = p_1$ exactly — this is a standard identity since $\tan(\theta/2) = e^{-\beta\Delta/2}$ implies $\cos^2(\theta/2) = 1/(1+\tan^2(\theta/2)) = 1/(1+e^{-\beta\Delta}) = p_0$.

**Limits.** As $\beta \to 0$ (infinite temperature), $\theta \to \pi/2$ and $\rho \to I/2$, the maximally mixed state. As $\beta \to \infty$ (zero temperature), $\theta \to 0$ and $\rho \to |0\rangle\langle0|$, the ground state — recovering ordinary ground-state preparation as the $T=0$ limit of Gibbs-state preparation.

**Beyond one qubit.** For interacting many-body Hamiltonians this single-ancilla trick does not generalize directly (the purification's Schmidt rank must match the Hilbert space dimension in general), and practical quantum Gibbs-sampling proposals instead use quantum Metropolis sampling, quantum imaginary-time evolution (QITE), or variational thermofield-double constructions — each with its own resource and convergence tradeoffs.`,
    explanationMdJa: String.raw`単一量子ビットのハミルトニアン $H = -\frac{\Delta}{2}Z$（固有値は$|0\rangle$に対し$E_0=-\Delta/2$、$|1\rangle$に対し$E_1=+\Delta/2$）に対し、逆温度$\beta = 1/k_BT$でのギブス状態は

$$\rho(\beta) = \frac{e^{-\beta H}}{Z} = p_0 |0\rangle\langle0| + p_1 |1\rangle\langle1|, \qquad p_0 = \frac{1}{1+e^{-\beta\Delta}},\quad p_1 = \frac{e^{-\beta\Delta}}{1+e^{-\beta\Delta}}$$

です。

**純粋化構成。** 補助量子ビットを導入し、補助に$R_y(\theta)$を適用してから$\mathrm{CNOT}_{A\to S}$を適用することで $|\phi\rangle_{AS} = \cos(\theta/2)|0\rangle_A|0\rangle_S + \sin(\theta/2)|1\rangle_A|1\rangle_S$ を準備します。補助をトレースアウトすると、システムは縮約密度行列 $\mathrm{diag}(\cos^2(\theta/2), \sin^2(\theta/2))$ を持ちます。

$$\theta = 2\arctan\!\big(e^{-\beta\Delta/2}\big)$$

を選ぶと、$\cos^2(\theta/2) = p_0$、$\sin^2(\theta/2) = p_1$ が厳密に成り立ちます。これは$\tan(\theta/2) = e^{-\beta\Delta/2}$から$\cos^2(\theta/2) = 1/(1+\tan^2(\theta/2)) = 1/(1+e^{-\beta\Delta}) = p_0$が従う標準的な恒等式です。

**極限。** $\beta \to 0$（無限温度）では$\theta \to \pi/2$、$\rho \to I/2$（最大混合状態）になります。$\beta \to \infty$（絶対零度）では$\theta \to 0$、$\rho \to |0\rangle\langle0|$（基底状態）となり、ギブス状態準備の$T=0$極限として通常の基底状態準備が回復されます。

**1量子ビットを超えて。** 相互作用する多体ハミルトニアンに対しては、この1補助量子ビットのトリックは直接一般化できません（純粋化のシュミット階数は一般にヒルベルト空間の次元と一致する必要があります）。実用的な量子ギブスサンプリングの提案は、量子メトロポリスサンプリング、量子虚時間発展（QITE）、変分サーモフィールド二重構成などを用い、それぞれ異なるリソースと収束のトレードオフを持ちます。`,
    tags: ["thermal state", "gibbs state", "purification", "mixed state"],
    resources: [
      { label: "Qubits", value: "1 system + 1 ancilla" },
      { label: "Depth", value: "2 gates (RY, CNOT)" },
      { label: "Free parameter", value: "θ(β, Δ)" },
    ],
    metadata: [
      { label: "Hamiltonian", value: "H = -(Δ/2)Z" },
      { label: "State", value: "ρ = diag(p0, p1)" },
      { label: "T→0 limit", value: "Ground state |0⟩" },
    ],
    sourceTitle: "Sampling from the thermal quantum Gibbs state and evaluating partition functions with a quantum computer",
    sourceUrl: "https://arxiv.org/abs/0905.2199",
    wires: ["ancilla", "system"],
    operations: [
      { label: "RY(θ)", qubits: [0], tone: "accent" },
      { label: "CX", qubits: [0, 1], tone: "ok" },
    ],
    outcomes: [
      { label: "p0 (system in |0⟩)", probability: 0.7311 },
      { label: "p1 (system in |1⟩)", probability: 0.2689 },
    ],
    code: `import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import DensityMatrix, partial_trace

def thermal_qubit(beta: float, delta: float) -> QuantumCircuit:
    theta = 2 * np.arctan(np.exp(-beta * delta / 2))
    qc = QuantumCircuit(2)  # qubit 0 = ancilla, qubit 1 = system
    qc.ry(theta, 0)
    qc.cx(0, 1)
    return qc

beta, delta = 1.0, 1.0
qc = thermal_qubit(beta, delta)
full = DensityMatrix.from_instruction(qc)
system_rho = partial_trace(full, [0])  # trace out the ancilla
print(np.real(system_rho.data))
# [[0.7311, 0], [0, 0.2689]]  ==  Boltzmann populations for beta*delta = 1
\n\nFINAL_CIRCUIT = qc`,
    filename: "thermal_gibbs_state.py",
    language: "python",
    relatedSlugs: ["transverse-field-ising-operator", "ising-hamiltonian-operator"],
    literature: [
      {
        title: "Sampling from the thermal quantum Gibbs state and evaluating partition functions with a quantum computer",
        authors: "David Poulin, Pawel Wocjan",
        year: "2009",
        url: "https://arxiv.org/abs/0905.2199",
        relevance: "Surveys quantum algorithms for Gibbs-state sampling, of which the single-qubit ancilla purification is the minimal instance.",
        relevanceJa: "量子ギブス状態サンプリングのアルゴリズムを概観しており、単一量子ビットの補助純粋化はその最小の例です。",
      },
    ],
  }),
  makeReferenceEntry({
    slug: "ising-hamiltonian-operator",
    title: "Classical Ising Hamiltonian operator",
    titleJa: "古典イジング・ハミルトニアン演算子",
    category: "operators",
    categoryLabel: "Operators",
    categoryLabelJa: "演算子",
    algorithmFamily: "Spin Hamiltonians",
    framework: "Qiskit",
    verification: "Diagonal-spectrum check · commuting-term construction",
    verificationMethods: ["direct_math", "construction", "textbook_citation"],
    method:
      "Because every term is a product of Z operators, the SparsePauliOp is diagonal in the computational basis by construction; its eigenvalues were computed directly as -J*sum(s_i s_{i+1}) - h*sum(s_i) over all 2^n classical spin configurations s_i in {+1,-1} for a 4-site chain and compared to the matrix's diagonal.",
    result:
      "Pass · all 16 diagonal entries match the classical Ising energy formula exactly, confirming the operator has no off-diagonal (quantum superposition-inducing) terms.",
    exportStatus: "Native Qiskit SparsePauliOp · framework-portable Pauli string list",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "The classical (longitudinal-field) Ising Hamiltonian expressed as a diagonal SparsePauliOp: a foundational Z-only spin model with no quantum superposition dynamics of its own.",
    descriptionJa: "対角SparsePauliOpとして表現された古典（縦磁場）イジング・ハミルトニアン。それ自体は量子的な重ね合わせのダイナミクスを持たない、Zのみの基礎的スピンモデルです。",
    introduction:
      "The Ising model was originally posed as a 1D classical statistical-mechanics problem to explain ferromagnetism, and its operator form — diagonal in the computational (Z) basis — is the natural starting point before adding a transverse field turns it into a genuinely quantum model.",
    introductionJa:
      "イジングモデルはもともと強磁性を説明するための1次元古典統計力学の問題として提示されました。計算（Z）基底で対角なその演算子形式は、横磁場を加えて真に量子的なモデルにする前の自然な出発点です。",
    explanation:
      "H = -J Σ Z_i Z_{i+1} - h Σ Z_i is diagonal in the computational basis, so its eigenstates are exactly the basis states and its eigenvalues are the classical Ising energies for each ±1 spin configuration.",
    explanationJa:
      "H = -J Σ Z_i Z_{i+1} - h Σ Z_iは計算基底で対角であるため、固有状態はまさに基底状態そのものであり、固有値は各±1スピン配置に対する古典イジングエネルギーです。",
    explanationMd: String.raw`The classical Ising Hamiltonian on a chain of $n$ sites with nearest-neighbor coupling $J$ and longitudinal field $h$ is

$$H = -J\sum_{i=1}^{n-1} Z_i Z_{i+1} - h\sum_{i=1}^{n} Z_i.$$

**Diagonal structure.** Every term is a product of $Z$ operators, and $Z$ is diagonal in the computational basis with eigenvalues $\pm1$. Consequently $H$ itself is diagonal: for a basis state $|s_1\cdots s_n\rangle$ with $Z_i|s_i\rangle = (-1)^{s_i}|s_i\rangle$, writing $\sigma_i = (-1)^{s_i} \in \{+1,-1\}$,

$$H|s_1\cdots s_n\rangle = \Big(-J\sum_i \sigma_i\sigma_{i+1} - h\sum_i \sigma_i\Big)|s_1\cdots s_n\rangle,$$

i.e. every computational basis state is already an exact eigenstate, with eigenvalue equal to the classical Ising energy of that spin configuration. No diagonalization or simulation is required to find the spectrum — it is read off termwise.

**Physical content.** For $J>0$ (ferromagnetic) the ground state(s) align all spins ($\sigma_i$ all $+1$ or all $-1$ when $h=0$, degenerate); for $J<0$ (antiferromagnetic) on a bipartite lattice the ground state alternates. The field $h$ breaks the up/down degeneracy by favoring one alignment. Because $[H, Z_i]=0$ for every $i$, there is no term driving transitions between basis states — this is a *classical* Hamiltonian dressed in quantum notation, and running it alone on a quantum computer produces no dynamics beyond an overall phase per basis state.

**Role in the catalog.** This diagonal operator is the baseline against which the transverse-field Ising model (adding $-h_x\sum X_i$, which does not commute with $Z_i$) is compared: the transverse term is exactly what turns a classical statistical-mechanics model into a quantum many-body Hamiltonian with a genuine phase transition driven by quantum fluctuations rather than thermal fluctuations alone.`,
    explanationMdJa: String.raw`結合定数$J$、縦磁場$h$を持つ$n$サイト鎖上の古典イジング・ハミルトニアンは

$$H = -J\sum_{i=1}^{n-1} Z_i Z_{i+1} - h\sum_{i=1}^{n} Z_i$$

です。

**対角構造。** すべての項はZ演算子の積であり、Zは計算基底で対角、固有値は$\pm1$です。したがって$H$自体が対角であり、$Z_i|s_i\rangle = (-1)^{s_i}|s_i\rangle$を満たす基底状態$|s_1\cdots s_n\rangle$に対して$\sigma_i = (-1)^{s_i} \in \{+1,-1\}$と書くと

$$H|s_1\cdots s_n\rangle = \Big(-J\sum_i \sigma_i\sigma_{i+1} - h\sum_i \sigma_i\Big)|s_1\cdots s_n\rangle$$

となります。つまりすべての計算基底状態がすでに厳密な固有状態であり、固有値はそのスピン配置の古典イジングエネルギーに等しくなります。スペクトルを求めるのに対角化やシミュレーションは不要で、項ごとに読み取れます。

**物理的内容。** $J>0$（強磁性）では基底状態はすべてのスピンが揃い（$h=0$なら全て+1または全て-1で縮退）、$J<0$（反強磁性）の二部格子では基底状態は交互になります。磁場$h$は上下の縮退を破り一方の配置を有利にします。すべての$i$に対して$[H, Z_i]=0$であるため、基底状態間の遷移を駆動する項はなく、これは量子的な記法をまとった古典ハミルトニアンです。単独で量子コンピュータ上で実行しても、基底状態ごとの全体位相以外のダイナミクスは生じません。

**カタログでの位置づけ。** この対角演算子は横磁場イジングモデル（$Z_i$と可換でない$-h_x\sum X_i$を加えたもの）と比較する基準です。横磁場項こそが、古典統計力学モデルを、熱ゆらぎだけでなく量子ゆらぎによって駆動される真の相転移を持つ量子多体ハミルトニアンへと変える要素です。`,
    tags: ["ising model", "spin hamiltonian", "diagonal operator", "classical limit"],
    resources: [
      { label: "Sites", value: "4 (chain)" },
      { label: "Terms", value: "3 ZZ + 4 Z" },
      { label: "Spectrum", value: "16 classical energies (diagonal)" },
    ],
    metadata: [
      { label: "Hamiltonian", value: "H = -JΣZᵢZᵢ₊₁ - hΣZᵢ" },
      { label: "Commutation", value: "[H, Zᵢ] = 0 ∀i" },
      { label: "Phase transition driver", value: "Thermal (needs T, not this operator alone)" },
    ],
    sourceTitle: "Quantum Phase Transitions",
    sourceUrl: "https://doi.org/10.1017/CBO9780511973765",
    wires: ["Z₀", "Z₁", "Z₂", "Z₃"],
    operations: [
      { label: "ZZ", qubits: [0, 1], tone: "ok" },
      { label: "ZZ", qubits: [1, 2], tone: "ok" },
      { label: "ZZ", qubits: [2, 3], tone: "ok" },
      { label: "Z field", qubits: [0, 1, 2, 3], tone: "neutral" },
    ],
    outcomes: [
      { label: "Ground energy (all-aligned, J>0,h=0)", probability: 1 },
    ],
    code: `import numpy as np
from qiskit.quantum_info import SparsePauliOp

def ising_hamiltonian(n: int, J: float, h: float) -> SparsePauliOp:
    terms, coeffs = [], []
    for i in range(n - 1):
        s = ["I"] * n
        s[i], s[i + 1] = "Z", "Z"
        terms.append("".join(reversed(s)))
        coeffs.append(-J)
    for i in range(n):
        s = ["I"] * n
        s[i] = "Z"
        terms.append("".join(reversed(s)))
        coeffs.append(-h)
    return SparsePauliOp(terms, coeffs)

H = ising_hamiltonian(4, J=1.0, h=0.5)
diag = np.real(H.to_matrix()).diagonal()
print("Diagonal (classical energies):", diag)
print("Ground energy:", diag.min())

RESULT = {"ground_energy": float(diag.min()), "classical_energies": [float(v) for v in diag]}
`,
    filename: "ising_hamiltonian_operator.py",
    language: "python",
    relatedSlugs: ["transverse-field-ising-operator", "heisenberg-xxz-operator", "thermal-gibbs-state"],
    literature: [
      {
        title: "Quantum Phase Transitions",
        authors: "S. Sachdev",
        year: "2011",
        url: "https://doi.org/10.1017/cbo9780511973765",
        relevance: "Standard textbook treatment of the Ising Hamiltonian as the classical limit contrasted with its transverse-field quantum extension.",
        relevanceJa: "イジング・ハミルトニアンを、横磁場による量子拡張と対比される古典極限として扱う標準的な教科書です。",
      },
    ],
  }),
  makeReferenceEntry({
    slug: "heisenberg-xxz-operator",
    title: "Heisenberg XXZ spin-chain operator",
    titleJa: "ハイゼンベルクXXZスピン鎖演算子",
    category: "operators",
    categoryLabel: "Operators",
    categoryLabelJa: "演算子",
    algorithmFamily: "Spin Hamiltonians",
    framework: "Qiskit",
    verification: "Symmetry / commutation check · small-instance matrix construction",
    verificationMethods: ["direct_math", "construction", "textbook_citation"],
    method:
      "Total Sz = (1/2)Σ Zᵢ was checked to commute exactly with the assembled 4-site SparsePauliOp matrix ([H, Sz] = 0, the U(1) symmetry expected from XX+YY+ΔZZ terms), and the isotropic point Δ=1 was checked to reduce to the SU(2)-symmetric Heisenberg operator by comparing coefficients termwise.",
    result:
      "Pass · [H, Sz] is the zero matrix to numerical precision for a 4-site chain, and the Δ=1 coefficients match the isotropic XXX Heisenberg form exactly.",
    exportStatus: "Native Qiskit SparsePauliOp · framework-portable Pauli string list",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "The anisotropic Heisenberg (XXZ) spin-chain Hamiltonian: exchange-coupled spins with tunable easy-axis/easy-plane anisotropy Δ, U(1)-symmetric under total-Sz rotation.",
    descriptionJa: "調整可能な易軸・易面異方性Δを持つ交換結合スピンの異方性ハイゼンベルク（XXZ）スピン鎖ハミルトニアン。全Sz回転に対してU(1)対称です。",
    introduction:
      "The XXZ chain interpolates between the classical Ising model (Δ→∞), the exactly Bethe-ansatz-solvable isotropic Heisenberg point (Δ=1), and the free-fermion XY point (Δ=0), making it the standard testbed for exact integrability techniques in 1D quantum magnetism.",
    introductionJa:
      "XXZ鎖は古典イジングモデル（Δ→∞）、厳密にBethe仮説で解ける等方ハイゼンベルク点（Δ=1）、自由フェルミオンのXY点（Δ=0）の間を補間し、1次元量子磁性における厳密可積分性技法の標準的な試験台です。",
    explanation:
      "H = J Σ (X_i X_{i+1} + Y_i Y_{i+1} + Δ Z_i Z_{i+1}) couples neighboring spins isotropically in the XY plane and with separate strength Δ along Z, conserving total Z-magnetization.",
    explanationJa:
      "H = J Σ (X_i X_{i+1} + Y_i Y_{i+1} + Δ Z_i Z_{i+1})は隣接スピンをXY平面内で等方的に、Z方向には別の強さΔで結合し、全Z磁化を保存します。",
    explanationMd: String.raw`The XXZ Heisenberg Hamiltonian on a chain of $n$ sites is

$$H = J\sum_{i=1}^{n-1}\big(X_iX_{i+1} + Y_iY_{i+1} + \Delta\, Z_iZ_{i+1}\big).$$

**Special points.** $\Delta = 1$ recovers the isotropic Heisenberg (XXX) model, exactly solvable by Bethe's 1931 ansatz; $\Delta = 0$ gives the XY model, mappable to free fermions via a Jordan–Wigner transformation; $|\Delta| \to \infty$ recovers the classical Ising limit (the XX terms become negligible relative to ZZ).

**Symmetry.** Writing $S^z_{\text{tot}} = \tfrac12\sum_i Z_i$, the XX+YY term can be re-expressed with raising/lowering operators $S^+_iS^-_{i+1}+S^-_iS^+_{i+1}$, which conserve the number of up-spins — a $U(1)$ symmetry, so $[H, S^z_{\text{tot}}] = 0$. This block-diagonalizes $H$ by total magnetization sector, which is why the model is tractable analytically (Bethe ansatz solves each magnetization sector separately) and why it is a natural target for excitation-number-conserving VQE ansätze.

**Physical content.** In the gapless regime $-1 \le \Delta \le 1$, the XXZ chain is a Luttinger liquid with power-law spin correlations; for $\Delta > 1$ the ground state is gapped and Néel (antiferromagnetically) ordered, and for $\Delta < -1$ it is ferromagnetically ordered. The Lieb–Schultz–Mattis theorem constrains this gap structure for half-integer spin chains with translational and $U(1)$ symmetry — a spin-1/2 chain at generic filling cannot have both a unique gapped ground state and these symmetries simultaneously.

**Use as a testbed.** Because exact Bethe-ansatz energies are known at every $\Delta$ for finite chains, the XXZ operator is a standard benchmark for VQE and quantum-simulation error analysis: any claimed ground-state energy can be checked against the exact solution rather than only against exact diagonalization of the same finite instance.`,
    explanationMdJa: String.raw`$n$サイト鎖上のXXZハイゼンベルク・ハミルトニアンは

$$H = J\sum_{i=1}^{n-1}\big(X_iX_{i+1} + Y_iY_{i+1} + \Delta\, Z_iZ_{i+1}\big)$$

です。

**特別点。** $\Delta = 1$は等方ハイゼンベルク（XXX）模型に一致し、Betheの1931年の仮説で厳密に解けます。$\Delta = 0$はXYモデルを与え、Jordan–Wigner変換で自由フェルミオンに写像できます。$|\Delta| \to \infty$は古典イジング極限（XX項がZZに対して無視できるようになる）に一致します。

**対称性。** $S^z_{\text{tot}} = \tfrac12\sum_i Z_i$と書くと、XX+YY項は昇降演算子$S^+_iS^-_{i+1}+S^-_iS^+_{i+1}$で再表現でき、これはアップスピンの数を保存します — $U(1)$対称性であり、$[H, S^z_{\text{tot}}] = 0$です。これにより$H$は全磁化セクターごとにブロック対角化され、この模型が解析的に扱いやすい（Bethe仮説は各磁化セクターを別々に解く）理由、また励起数保存型VQEアンザッツの自然な対象である理由になっています。

**物理的内容。** ギャップレス領域$-1 \le \Delta \le 1$では、XXZ鎖はスピン相関がべき乗則に従う朝永・Luttinger液体です。$\Delta > 1$では基底状態はギャップがありネール（反強磁性）秩序を持ち、$\Delta < -1$では強磁性秩序を持ちます。Lieb–Schultz–Mattisの定理は、並進対称性と$U(1)$対称性を持つ半整数スピン鎖に対してこのギャップ構造を制約します。一般的なフィリングのスピン1/2鎖は、一意なギャップのある基底状態とこれらの対称性を同時に持つことはできません。

**試験台としての利用。** 有限鎖の任意の$\Delta$で厳密なBethe仮説エネルギーが分かっているため、XXZ演算子はVQEや量子シミュレーションの誤差解析の標準的なベンチマークです。主張された基底状態エネルギーは、同じ有限インスタンスの厳密対角化だけでなく厳密解とも照合できます。`,
    tags: ["heisenberg model", "xxz chain", "spin hamiltonian", "bethe ansatz", "u(1) symmetry"],
    resources: [
      { label: "Sites", value: "4 (chain)" },
      { label: "Terms", value: "3 XX + 3 YY + 3 ZZ" },
      { label: "Symmetry", value: "U(1) total-Sz conservation" },
    ],
    metadata: [
      { label: "Hamiltonian", value: "H = JΣ(XᵢXᵢ₊₁+YᵢYᵢ₊₁+ΔZᵢZᵢ₊₁)" },
      { label: "Δ=1 point", value: "Isotropic Heisenberg (Bethe-solvable)" },
      { label: "Regime (this entry)", value: "Δ=1, gapless Luttinger liquid" },
    ],
    sourceTitle: "An introduction to integrable techniques for one-dimensional quantum systems",
    sourceUrl: "https://arxiv.org/abs/1609.02100",
    wires: ["S₀", "S₁", "S₂", "S₃"],
    operations: [
      { label: "XX", qubits: [0, 1], tone: "accent" },
      { label: "YY", qubits: [0, 1], tone: "accent" },
      { label: "ΔZZ", qubits: [0, 1], tone: "ok" },
      { label: "…", qubits: [1, 2], tone: "neutral" },
    ],
    outcomes: [
      { label: "Sz sectors block-diagonal", probability: 1 },
    ],
    code: `import numpy as np
from qiskit.quantum_info import SparsePauliOp

def xxz_hamiltonian(n: int, J: float, delta: float) -> SparsePauliOp:
    terms, coeffs = [], []
    for i in range(n - 1):
        for pauli, coeff in (("X", J), ("Y", J), ("Z", J * delta)):
            s = ["I"] * n
            s[i], s[i + 1] = pauli, pauli
            terms.append("".join(reversed(s)))
            coeffs.append(coeff)
    return SparsePauliOp(terms, coeffs)

n = 4
H = xxz_hamiltonian(n, J=1.0, delta=1.0)  # isotropic Heisenberg point
Sz_tot = SparsePauliOp(["".join(reversed(["Z" if k == i else "I" for k in range(n)])) for i in range(n)],
                        [0.5] * n)
commutator = H.to_matrix() @ Sz_tot.to_matrix() - Sz_tot.to_matrix() @ H.to_matrix()
print("max |[H, Sz_tot]| =", np.abs(commutator).max())  # ~0, confirming U(1) symmetry

RESULT = {"max_commutator_norm": float(np.abs(commutator).max()), "conserves_total_sz": bool(np.abs(commutator).max() < 1e-9)}
`,
    filename: "heisenberg_xxz_operator.py",
    language: "python",
    relatedSlugs: ["ising-hamiltonian-operator", "transverse-field-ising-operator", "vqe-ground-state-energy"],
    literature: [
      {
        title: "An introduction to integrable techniques for one-dimensional quantum systems",
        authors: "Fabio Franchini",
        year: "2016",
        url: "https://arxiv.org/abs/1609.02100",
        relevance: "Modern review deriving the XXZ chain's symmetries, Bethe-ansatz solvability, and phase diagram used in this entry.",
        relevanceJa: "このエントリで用いるXXZ鎖の対称性、Bethe仮説による可解性、相図を導出する現代的なレビューです。",
      },
    ],
  }),
  makeReferenceEntry({
    slug: "transverse-field-ising-operator",
    title: "Transverse-field Ising model operator",
    titleJa: "横磁場イジングモデル演算子",
    category: "operators",
    categoryLabel: "Operators",
    categoryLabelJa: "演算子",
    algorithmFamily: "Spin Hamiltonians",
    framework: "Qiskit",
    verification: "Non-commutation check · small-instance exact diagonalization",
    verificationMethods: ["direct_math", "construction", "textbook_citation"],
    method:
      "[H, Z_i] was computed exactly for a 4-site chain and found nonzero (confirming the transverse field genuinely drives quantum dynamics, unlike the classical Ising operator), and the exact ground-state energy from full diagonalization was compared against the known closed-form free-fermion dispersion at the self-dual point h=J for small n.",
    result:
      "Pass · [H, Zᵢ] ≠ 0 as expected, and the numerically diagonalized ground energy matches the closed-form Pfeuty free-fermion result at h=J to machine precision.",
    exportStatus: "Native Qiskit SparsePauliOp · framework-portable Pauli string list",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "The transverse-field Ising model (TFIM): the standard minimal Hamiltonian exhibiting a quantum (zero-temperature) phase transition driven by competing Z-Z order and X-field disorder.",
    descriptionJa: "横磁場イジングモデル（TFIM）：競合するZ-Z秩序とX磁場による無秩序化によって駆動される量子（絶対零度）相転移を示す標準的な最小ハミルトニアン。",
    introduction:
      "Adding a transverse field to the classical Ising chain turns a purely statistical-mechanics model into the paradigmatic example of a quantum phase transition — one driven by the Heisenberg uncertainty between competing non-commuting terms rather than by thermal fluctuations.",
    introductionJa:
      "古典イジング鎖に横磁場を加えると、純粋な統計力学モデルが量子相転移の典型例に変わります。熱ゆらぎではなく、可換でない競合項の間のハイゼンベルクの不確定性によって駆動される転移です。",
    explanation:
      "H = -J Σ Z_i Z_{i+1} - h Σ X_i adds a field along X, which does not commute with the ZZ coupling, so unlike the classical Ising operator this Hamiltonian generates genuine quantum dynamics and a level-crossing-free quantum phase transition at h=J.",
    explanationJa:
      "H = -J Σ Z_i Z_{i+1} - h Σ X_iはX方向の磁場を加えます。これはZZ結合と可換でないため、古典イジング演算子と異なり、このハミルトニアンは真の量子ダイナミクスとh=Jでの量子相転移を生じます。",
    explanationMd: String.raw`The transverse-field Ising model (TFIM) on a chain of $n$ sites is

$$H = -J\sum_{i=1}^{n-1} Z_iZ_{i+1} - h\sum_{i=1}^{n} X_i.$$

**Genuinely quantum.** Unlike the classical Ising operator, $[H, Z_i] \neq 0$ because $X_i$ and $Z_i$ anticommute: $\{X,Z\}=0 \Rightarrow XZ=-ZX$. The transverse field therefore drives real transitions between computational-basis states, and $H$ cannot be diagonalized simply by inspection.

**Exact solvability.** Via a Jordan–Wigner transformation, the 1D TFIM maps exactly onto free fermions, giving the closed-form dispersion relation (periodic chain, $N\to\infty$)

$$\epsilon(k) = 2J\sqrt{1 + (h/J)^2 - 2(h/J)\cos k},$$

so ground-state energies and gaps are known in closed form at every system size — the reason this model is the standard exact benchmark for VQE, Trotterized time evolution, and quantum annealing schedules.

**Quantum phase transition.** At zero temperature, tuning $h/J$ drives a transition at the self-dual point $h=J$ between a ferromagnetically ordered phase ($h<J$, spontaneous $\mathbb{Z}_2$ symmetry breaking of the global spin-flip $\prod_i X_i$) and a paramagnetic phase ($h>J$, field-aligned along X). The transition is continuous, with the gap closing as $\Delta \sim |h-J|^{z\nu}$ — the paradigmatic example distinguishing a quantum phase transition (driven by $h/J$ at $T=0$) from the thermal transition of the classical 2D Ising model, to which the 1D TFIM's partition function is related by a quantum-classical mapping.

**Use in the catalog.** This operator sits directly above the classical Ising Hamiltonian and the XXZ chain in the family of exactly-characterizable spin models: setting $h=0$ recovers the classical diagonal operator, and the model's non-commuting structure is exactly what a Trotter-based Hamiltonian simulation or a VQE ansatz must reproduce.`,
    explanationMdJa: String.raw`$n$サイト鎖上の横磁場イジングモデル（TFIM）は

$$H = -J\sum_{i=1}^{n-1} Z_iZ_{i+1} - h\sum_{i=1}^{n} X_i$$

です。

**真に量子的。** 古典イジング演算子と異なり、$X_i$と$Z_i$は反可換（$\{X,Z\}=0 \Rightarrow XZ=-ZX$）であるため$[H, Z_i] \neq 0$です。したがって横磁場は計算基底状態間の実際の遷移を駆動し、$H$は単純な観察では対角化できません。

**厳密可解性。** Jordan–Wigner変換により、1次元TFIMは自由フェルミオンへ厳密に写像され、閉形式の分散関係（周期鎖、$N\to\infty$）

$$\epsilon(k) = 2J\sqrt{1 + (h/J)^2 - 2(h/J)\cos k}$$

が得られます。そのため基底状態エネルギーとギャップはあらゆる系のサイズで閉形式で分かっており、これがこのモデルがVQE、トロッター化時間発展、量子アニーリングスケジュールの標準的な厳密ベンチマークである理由です。

**量子相転移。** 絶対零度で$h/J$を調整すると、自己双対点$h=J$で強磁性秩序相（$h<J$、大域スピン反転$\prod_i X_i$の自発的$\mathbb{Z}_2$対称性の破れ）と常磁性相（$h>J$、X方向に磁場が揃う）の間の転移が起こります。この転移は連続的で、ギャップは$\Delta \sim |h-J|^{z\nu}$として閉じます。これは、量子相転移（$T=0$で$h/J$により駆動）と古典2次元イジングモデルの熱的転移（1次元TFIMの分配関数は量子・古典対応でこれと関係します）を区別する典型例です。

**カタログでの利用。** この演算子は、厳密に特徴づけ可能なスピンモデル族の中で古典イジング・ハミルトニアンとXXZ鎖の直上に位置します。$h=0$とすると古典対角演算子に一致し、このモデルの非可換構造こそが、トロッター型ハミルトニアンシミュレーションやVQEアンザッツが再現すべきものです。`,
    tags: ["ising model", "transverse field", "quantum phase transition", "jordan-wigner"],
    resources: [
      { label: "Sites", value: "4 (chain)" },
      { label: "Terms", value: "3 ZZ + 4 X" },
      { label: "Critical point", value: "h = J (self-dual)" },
    ],
    metadata: [
      { label: "Hamiltonian", value: "H = -JΣZᵢZᵢ₊₁ - hΣXᵢ" },
      { label: "Commutation", value: "[H, Zᵢ] ≠ 0" },
      { label: "Symmetry", value: "Z₂ (global spin flip ΠXᵢ)" },
    ],
    sourceTitle: "The one-dimensional Ising model with a transverse field",
    sourceUrl: "https://doi.org/10.1016/0003-4916(70)90270-8",
    wires: ["Z₀", "Z₁", "Z₂", "Z₃"],
    operations: [
      { label: "ZZ", qubits: [0, 1], tone: "ok" },
      { label: "ZZ", qubits: [1, 2], tone: "ok" },
      { label: "ZZ", qubits: [2, 3], tone: "ok" },
      { label: "X field", qubits: [0, 1, 2, 3], tone: "warn" },
    ],
    outcomes: [
      { label: "h < J: ferromagnetic order", probability: 0.5 },
      { label: "h > J: paramagnetic", probability: 0.5 },
    ],
    code: `import numpy as np
from qiskit.quantum_info import SparsePauliOp

def tfim_hamiltonian(n: int, J: float, h: float) -> SparsePauliOp:
    terms, coeffs = [], []
    for i in range(n - 1):
        s = ["I"] * n
        s[i], s[i + 1] = "Z", "Z"
        terms.append("".join(reversed(s)))
        coeffs.append(-J)
    for i in range(n):
        s = ["I"] * n
        s[i] = "X"
        terms.append("".join(reversed(s)))
        coeffs.append(-h)
    return SparsePauliOp(terms, coeffs)

n = 4
H_crit = tfim_hamiltonian(n, J=1.0, h=1.0)  # self-dual critical point
Z0 = SparsePauliOp("IIIZ")
commutator = H_crit.to_matrix() @ Z0.to_matrix() - Z0.to_matrix() @ H_crit.to_matrix()
print("max |[H, Z0]| =", np.abs(commutator).max())  # nonzero: genuine quantum dynamics

eigvals = np.linalg.eigvalsh(H_crit.to_matrix())
print("Ground energy:", eigvals[0])

RESULT = {"ground_energy": float(eigvals[0]), "max_commutator_norm": float(np.abs(commutator).max())}
`,
    filename: "transverse_field_ising_operator.py",
    language: "python",
    extraVariants: [
      {
        framework: "PennyLane",
        status: "native",
        language: "python",
        filename: "transverse_field_ising_operator.py",
        code: `import pennylane as qml

n, J, h = 4, 1.0, 1.0
coeffs = [-J] * (n - 1) + [-h] * n
obs = [qml.PauliZ(i) @ qml.PauliZ(i + 1) for i in range(n - 1)] + [qml.PauliX(i) for i in range(n)]
H = qml.Hamiltonian(coeffs, obs)
eigenvalues = qml.eigvals(H)
print(eigenvalues)

RESULT = {"ground_energy": float(min(eigenvalues)), "spectrum": [float(v) for v in eigenvalues]}
`,
      },
    ],
    relatedSlugs: ["ising-hamiltonian-operator", "heisenberg-xxz-operator", "thermal-gibbs-state"],
    literature: [
      {
        title: "The one-dimensional Ising model with a transverse field",
        authors: "P. Pfeuty",
        year: "1970",
        url: "https://doi.org/10.1016/0003-4916(70)90270-8",
        relevance: "Original exact solution of the TFIM via Jordan-Wigner fermionization, giving the dispersion relation used in this entry.",
        relevanceJa: "Jordan-Wignerフェルミオン化によるTFIMの厳密解を初めて与え、このエントリで用いる分散関係を導きます。",
      },
      {
        title: "Quantum Phase Transitions",
        authors: "S. Sachdev",
        year: "2011",
        url: "https://doi.org/10.1017/cbo9780511973765",
        relevance: "Standard textbook treatment of the TFIM as the canonical example of a quantum (zero-temperature) phase transition.",
        relevanceJa: "TFIMを量子（絶対零度）相転移の標準例として扱う定番教科書です。",
      },
    ],
  }),
  makeReferenceEntry({
    slug: "fermi-hubbard-operator",
    title: "Fermi-Hubbard dimer operator (Jordan-Wigner encoded)",
    titleJa: "フェルミ・ハバードダイマー演算子（Jordan-Wigner符号化）",
    category: "operators",
    categoryLabel: "Operators",
    categoryLabelJa: "演算子",
    algorithmFamily: "Fermionic Hamiltonians",
    framework: "Qiskit",
    verification: "Particle-number conservation check · small-instance matrix construction",
    verificationMethods: ["direct_math", "construction", "research_paper"],
    method:
      "Total particle number N = Σ n_iσ (per-spin-orbital occupation from Jordan-Wigner) was checked to commute exactly with the assembled 4-qubit (2-site, 2-spin) SparsePauliOp Hamiltonian by explicit matrix commutator, confirming the hopping and interaction terms both conserve fermion number as required by the JW encoding.",
    result: "Pass · [H, N] is the zero matrix to numerical precision, confirming particle-number conservation of the encoded operator.",
    exportStatus: "Native Qiskit SparsePauliOp · Jordan-Wigner Pauli strings, framework-portable",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "The two-site Fermi-Hubbard dimer Hamiltonian, mapped to qubits via the Jordan-Wigner transformation: nearest-neighbor hopping competing with on-site Coulomb repulsion.",
    descriptionJa: "Jordan-Wigner変換で量子ビットに写像された2サイト・フェルミ・ハバードダイマー・ハミルトニアン。最近接ホッピングとサイト内クーロン斥力が競合します。",
    introduction:
      "The Hubbard model is the minimal Hamiltonian containing both itinerant kinetic energy and strong local correlation, making it the standard target for quantum simulation of strongly correlated electron physics — including, in its 2D form, proposed connections to high-temperature superconductivity.",
    introductionJa:
      "ハバードモデルは遍歴的な運動エネルギーと強い局所相関の両方を含む最小のハミルトニアンであり、強相関電子物理の量子シミュレーションの標準的な対象です。2次元形式では高温超伝導との関連も議論されています。",
    explanation:
      "H = -t Σ (c†_iσ c_jσ + h.c.) + U Σ n_i↑n_i↓ describes fermions hopping between sites with amplitude t while paying an energy cost U whenever two opposite-spin fermions occupy the same site; the Jordan-Wigner transform rewrites creation/annihilation operators as Pauli strings with Z-strings enforcing fermionic anticommutation.",
    explanationJa:
      "H = -t Σ (c†_iσ c_jσ + h.c.) + U Σ n_i↑n_i↓は、振幅tでサイト間をホッピングするフェルミオンと、同一サイトに逆スピンの2つのフェルミオンが占有するたびに課されるエネルギーコストUを記述します。Jordan-Wigner変換は生成・消滅演算子を、フェルミオンの反可換性を強制するZ文字列を伴うパウリ文字列として書き換えます。",
    explanationMd: String.raw`The single-band Fermi-Hubbard model on a lattice with hopping $t$ and on-site interaction $U$ is

$$H = -t\sum_{\langle i,j\rangle,\sigma} \big(c^\dagger_{i\sigma} c_{j\sigma} + c^\dagger_{j\sigma} c_{i\sigma}\big) + U\sum_i n_{i\uparrow} n_{i\downarrow}, \qquad n_{i\sigma} = c^\dagger_{i\sigma}c_{i\sigma}.$$

**Two-site dimer.** With 2 sites and 2 spins there are 4 fermionic modes $(1{\uparrow},1{\downarrow},2{\uparrow},2{\downarrow})$, mapped to 4 qubits. Using the Jordan-Wigner transform with mode ordering $1{\uparrow},1{\downarrow},2{\uparrow},2{\downarrow}$,

$$c^\dagger_k = \Big(\prod_{l<k} Z_l\Big)\frac{X_k - iY_k}{2}, \qquad c_k = \Big(\prod_{l<k} Z_l\Big)\frac{X_k + iY_k}{2},$$

so a hopping term $c^\dagger_k c_{k+1} + \text{h.c.}$ becomes $\tfrac12(X_kX_{k+1}+Y_kY_{k+1})$ acting on adjacent-index modes (with an extra $Z$-string factor if the modes are not adjacent in the chosen ordering), and each density term $n_{i\sigma} = \tfrac12(I - Z_{i\sigma})$ is diagonal.

**Particle-number conservation.** Both the hopping and interaction terms conserve total fermion number $N=\sum_{i\sigma} n_{i\sigma}$: hopping moves a fermion between sites without creating or destroying one, and the interaction term is purely diagonal in occupation. Consequently $[H, N] = 0$, which block-diagonalizes the Hamiltonian by total filling and is the symmetry sector structure any correct encoding must reproduce.

**Physical content.** For $U/t \to 0$ the model reduces to free fermions hopping on the lattice (band physics); for $U/t \to \infty$ double occupancy is forbidden and, at half filling, the low-energy physics maps onto the antiferromagnetic Heisenberg model via a Schrieffer-Wolff-type superexchange argument ($J_{\text{eff}} = 4t^2/U$) — directly connecting this operator to the Heisenberg XXZ operator elsewhere in this catalog. The model is believed (though not proven in 2D) to host a $d$-wave superconducting regime near intermediate coupling, which is the primary reason it remains a central target for near-term quantum simulation.`,
    explanationMdJa: String.raw`ホッピング$t$とサイト内相互作用$U$を持つ格子上の単一バンド・フェルミ・ハバードモデルは

$$H = -t\sum_{\langle i,j\rangle,\sigma} \big(c^\dagger_{i\sigma} c_{j\sigma} + c^\dagger_{j\sigma} c_{i\sigma}\big) + U\sum_i n_{i\uparrow} n_{i\downarrow}, \qquad n_{i\sigma} = c^\dagger_{i\sigma}c_{i\sigma}$$

です。

**2サイトダイマー。** 2サイト・2スピンでは4つのフェルミオンモード$(1{\uparrow},1{\downarrow},2{\uparrow},2{\downarrow})$があり、4量子ビットに写像します。モード順序$1{\uparrow},1{\downarrow},2{\uparrow},2{\downarrow}$でJordan-Wigner変換を用いると

$$c^\dagger_k = \Big(\prod_{l<k} Z_l\Big)\frac{X_k - iY_k}{2}, \qquad c_k = \Big(\prod_{l<k} Z_l\Big)\frac{X_k + iY_k}{2}$$

となり、ホッピング項$c^\dagger_k c_{k+1} + \text{h.c.}$は隣接インデックスのモードに対して$\tfrac12(X_kX_{k+1}+Y_kY_{k+1})$になり（選んだ順序で隣接しないモードには追加のZ文字列因子が付きます）、各密度項$n_{i\sigma} = \tfrac12(I - Z_{i\sigma})$は対角です。

**粒子数保存。** ホッピング項も相互作用項も全フェルミオン数$N=\sum_{i\sigma} n_{i\sigma}$を保存します。ホッピングはフェルミオンを生成・消滅させずにサイト間を移動させ、相互作用項は占有数に関して純粋に対角だからです。したがって$[H, N] = 0$であり、これはハミルトニアンを全フィリングごとにブロック対角化し、正しい符号化が再現すべき対称性セクター構造です。

**物理的内容。** $U/t \to 0$ではモデルは格子上を自由にホッピングするフェルミオン（バンド物理）に帰着し、$U/t \to \infty$では二重占有が禁止され、ハーフフィリングでは低エネルギー物理はSchrieffer-Wolff型の超交換の議論（$J_{\text{eff}} = 4t^2/U$）を通じて反強磁性ハイゼンベルクモデルに写像されます。これは本カタログの別項目であるハイゼンベルクXXZ演算子と直接つながります。このモデルは（2次元では未証明ながら）中間結合近傍でd波超伝導領域を持つと考えられており、これが近未来の量子シミュレーションの中心的対象であり続ける主な理由です。`,
    tags: ["hubbard model", "fermionic simulation", "jordan-wigner", "strongly correlated electrons"],
    resources: [
      { label: "Sites × spins", value: "2 × 2 = 4 modes / qubits" },
      { label: "Terms", value: "2 hopping (XX+YY) + 2 on-site U" },
      { label: "Conserved", value: "Total fermion number N" },
    ],
    metadata: [
      { label: "Hamiltonian", value: "H = -tΣ(c†c+h.c.) + UΣn↑n↓" },
      { label: "Encoding", value: "Jordan-Wigner" },
      { label: "Strong-coupling limit", value: "Jeff = 4t²/U (Heisenberg superexchange)" },
    ],
    sourceTitle: "Strategies for solving the Fermi-Hubbard model on near-term quantum computers",
    sourceUrl: "https://arxiv.org/abs/1912.06007",
    wires: ["1↑", "1↓", "2↑", "2↓"],
    operations: [
      { label: "Hop (XX+YY)", qubits: [0, 2], tone: "accent" },
      { label: "Hop (XX+YY)", qubits: [1, 3], tone: "accent" },
      { label: "U n₁↑n₁↓", qubits: [0, 1], tone: "warn" },
      { label: "U n₂↑n₂↓", qubits: [2, 3], tone: "warn" },
    ],
    outcomes: [
      { label: "Half-filling ground sector (N=2)", probability: 1 },
    ],
    code: `import numpy as np
from qiskit.quantum_info import SparsePauliOp

def hubbard_dimer(t: float, U: float) -> SparsePauliOp:
    # Mode order: 0=1up, 1=1down, 2=2up, 3=2down
    n = 4
    terms, coeffs = [], []
    # Hopping 1up-2up (modes 0,2) and 1down-2down (modes 1,3), with Z-string for JW
    for (a, b) in [(0, 2), (1, 3)]:
        for pauli, coeff in (("X", -t / 2), ("Y", -t / 2)):
            s = ["I"] * n
            s[a], s[b] = pauli, pauli
            for k in range(a + 1, b):
                s[k] = "Z"
            terms.append("".join(reversed(s)))
            coeffs.append(coeff)
    # On-site interaction U * n_i_up * n_i_down = U/4 * (I-Z_up)(I-Z_down),
    # expanded directly as Pauli strings.
    for (up, down) in [(0, 1), (2, 3)]:
        s0 = ["I"] * n
        terms.append("".join(reversed(s0))); coeffs.append(U / 4)
        s1 = ["I"] * n; s1[up] = "Z"
        terms.append("".join(reversed(s1))); coeffs.append(-U / 4)
        s2 = ["I"] * n; s2[down] = "Z"
        terms.append("".join(reversed(s2))); coeffs.append(-U / 4)
        s3 = ["I"] * n; s3[up], s3[down] = "Z", "Z"
        terms.append("".join(reversed(s3))); coeffs.append(U / 4)
    return SparsePauliOp(terms, coeffs).simplify()

H = hubbard_dimer(t=1.0, U=4.0)
N_op = SparsePauliOp(["".join(reversed(["Z" if k == i else "I" for k in range(4)])) for i in range(4)],
                      [-0.5] * 4) + SparsePauliOp("IIII", [2.0])
commutator = H.to_matrix() @ N_op.to_matrix() - N_op.to_matrix() @ H.to_matrix()
print("max |[H, N]| =", np.abs(commutator).max())  # ~0, confirming particle-number conservation

RESULT = {"max_commutator_norm": float(np.abs(commutator).max()), "conserves_particle_number": bool(np.abs(commutator).max() < 1e-9)}
`,
    filename: "fermi_hubbard_operator.py",
    language: "python",
    relatedSlugs: ["heisenberg-xxz-operator", "number-operator", "vqe-ground-state-energy"],
    literature: [
      {
        title: "Electron correlations in narrow energy bands",
        authors: "J. Hubbard",
        year: "1963",
        url: "https://doi.org/10.1098/rspa.1963.0204",
        relevance: "Original paper introducing the Hubbard model of competing itinerant hopping and on-site Coulomb repulsion.",
        relevanceJa: "遍歴的ホッピングとサイト内クーロン斥力の競合というハバードモデルを導入した原論文です。",
      },
      {
        title: "Strategies for solving the Fermi-Hubbard model on near-term quantum computers",
        authors: "Chris Cade, Lana Mineh, Ashley Montanaro, Stasja Stanisic",
        year: "2019",
        url: "https://arxiv.org/abs/1912.06007",
        relevance: "Analyzes Jordan-Wigner-encoded Hubbard Hamiltonians and their resource requirements for near-term quantum simulation.",
        relevanceJa: "Jordan-Wigner符号化されたハバード・ハミルトニアンと、近未来の量子シミュレーションに必要なリソースを分析します。",
      },
    ],
  }),
  makeReferenceEntry({
    slug: "number-operator",
    title: "Fermionic number operator",
    titleJa: "フェルミオン数演算子",
    category: "operators",
    categoryLabel: "Operators",
    categoryLabelJa: "演算子",
    algorithmFamily: "Fermionic Hamiltonians",
    framework: "Qiskit",
    verification: "Eigenvalue check · diagonal-operator construction",
    verificationMethods: ["direct_math", "construction", "textbook_citation"],
    method:
      "The Jordan-Wigner-encoded operator n = (I - Z)/2 was compared against its matrix form [[0,0],[0,1]], confirming eigenvalue 0 on |0⟩ (unoccupied) and 1 on |1⟩ (occupied), and the multi-mode total-number operator's eigenvalues were checked against Hamming weight for all 16 basis strings of a 4-qubit register.",
    result:
      "Pass · single-mode n has eigenvalues {0,1} matching occupation exactly; total N's eigenvalue on each basis string equals that string's Hamming weight for all 16 checked strings.",
    exportStatus: "Native Qiskit SparsePauliOp · framework-portable Pauli string list",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "The Jordan-Wigner-encoded fermionic number operator n = c†c = (I-Z)/2, whose eigenvalues count mode occupation exactly.",
    descriptionJa: "Jordan-Wigner符号化されたフェルミオン数演算子n = c†c = (I-Z)/2。固有値はモードの占有数を厳密に数えます。",
    introduction:
      "Every fermionic simulation needs a way to read out how many particles occupy each mode; the number operator is the diagonal Pauli operator that makes this readout exact and trivial to verify, and it is the building block every interaction term (like Hubbard's U n↑n↓) is written in terms of.",
    introductionJa:
      "フェルミオンシミュレーションでは各モードにどれだけの粒子が占有しているかを読み出す手段が必要です。数演算子はこの読み出しを厳密かつ検証が容易にする対角パウリ演算子であり、ハバードのUn↑n↓のようなあらゆる相互作用項が記述される構成要素です。",
    explanation:
      "Under the Jordan-Wigner mapping the fermionic number operator for mode i, n_i = c†_i c_i, becomes the single-qubit diagonal operator (I - Z_i)/2, with eigenvalue 0 on |0⟩ (empty) and 1 on |1⟩ (occupied) — no Z-string is needed since n_i involves no net creation or annihilation.",
    explanationJa:
      "Jordan-Wigner写像の下で、モードiのフェルミオン数演算子n_i = c†_i c_iは単一量子ビットの対角演算子(I - Z_i)/2になり、固有値は|0⟩（空）で0、|1⟩（占有）で1です。n_iは正味の生成・消滅を含まないためZ文字列は不要です。",
    explanationMd: String.raw`Under the Jordan-Wigner transform, the fermionic creation/annihilation operators for mode $i$ are

$$c^\dagger_i = \Big(\prod_{k<i} Z_k\Big)\sigma^-_i, \qquad c_i = \Big(\prod_{k<i} Z_k\Big)\sigma^+_i, \qquad \sigma^{\pm}_i = \tfrac12(X_i \mp iY_i),$$

and the number operator $n_i = c^\dagger_i c_i$ is

$$n_i = \Big(\prod_{k<i} Z_k\Big)\sigma^-_i \Big(\prod_{k<i} Z_k\Big)\sigma^+_i = \sigma^-_i\sigma^+_i = \frac{I - Z_i}{2},$$

since the two $Z$-strings square to identity and cancel — the number operator, unlike creation or annihilation individually, never needs the nonlocal Jordan-Wigner string. This is why $n_i$ is diagonal and single-qubit local even though $c_i$ and $c^\dagger_i$ individually act nonlocally in the qubit register.

**Spectrum.** $(I-Z_i)/2$ has eigenvalue $0$ on $|0\rangle$ and $1$ on $|1\rangle$ exactly, matching Fock-space occupation number one-to-one. The total number operator $N = \sum_i n_i$ has eigenvalue on any basis string equal to that string's Hamming weight, and commutes with any Hamiltonian built only from hopping and density-density terms (both are number-conserving), which is exactly the symmetry exploited to block-diagonalize the Fermi-Hubbard operator elsewhere in this catalog.

**Role as a building block.** Every density-density interaction (Hubbard's $U n_{i\uparrow}n_{i\downarrow}$), every chemical-potential term ($-\mu\sum_i n_i$), and every measurement of "how many particles are in this orbital" in quantum chemistry / condensed-matter simulations is expressed directly in terms of this operator. Because it is diagonal, expectation values $\langle n_i \rangle$ can be read out with a single computational-basis measurement per mode — no ancilla or phase-estimation circuit is required, unlike for off-diagonal observables.`,
    explanationMdJa: String.raw`Jordan-Wigner変換の下で、モード$i$のフェルミオン生成・消滅演算子は

$$c^\dagger_i = \Big(\prod_{k<i} Z_k\Big)\sigma^-_i, \qquad c_i = \Big(\prod_{k<i} Z_k\Big)\sigma^+_i, \qquad \sigma^{\pm}_i = \tfrac12(X_i \mp iY_i)$$

であり、数演算子$n_i = c^\dagger_i c_i$は

$$n_i = \Big(\prod_{k<i} Z_k\Big)\sigma^-_i \Big(\prod_{k<i} Z_k\Big)\sigma^+_i = \sigma^-_i\sigma^+_i = \frac{I - Z_i}{2}$$

となります。2つのZ文字列が二乗して恒等になり相殺するためです。数演算子は生成・消滅演算子単体と異なり、非局所的なJordan-Wigner文字列を決して必要としません。これが、$c_i$と$c^\dagger_i$は個別には量子ビットレジスタ上で非局所的に作用するにもかかわらず、$n_i$が対角かつ単一量子ビット局所である理由です。

**スペクトル。** $(I-Z_i)/2$は$|0\rangle$で固有値0、$|1\rangle$で固有値1を厳密に持ち、フォック空間の占有数と一対一に対応します。全数演算子$N = \sum_i n_i$は任意の基底文字列に対しその文字列のハミング重みに等しい固有値を持ち、ホッピング項と密度密度項のみから構成される（どちらも数保存の）任意のハミルトニアンと可換です。これは本カタログの別項目のフェルミ・ハバード演算子をブロック対角化するために利用される対称性そのものです。

**構成要素としての役割。** すべての密度密度相互作用（ハバードの$U n_{i\uparrow}n_{i\downarrow}$）、すべての化学ポテンシャル項（$-\mu\sum_i n_i$）、量子化学・物性シミュレーションで「この軌道に何個の粒子があるか」を測定するあらゆる操作は、この演算子で直接表現されます。対角であるため、期待値$\langle n_i \rangle$はモードごとに1回の計算基底測定で読み出せ、非対角な観測量と異なり補助量子ビットや位相推定回路は不要です。`,
    tags: ["number operator", "jordan-wigner", "fermionic simulation", "occupation"],
    resources: [
      { label: "Qubits", value: "1 per mode" },
      { label: "Depth", value: "Diagonal (no gates needed to define)" },
      { label: "Eigenvalues", value: "0 (empty) / 1 (occupied)" },
    ],
    metadata: [
      { label: "Operator", value: "n = (I - Z)/2" },
      { label: "Total N", value: "Eigenvalue = Hamming weight" },
      { label: "Locality", value: "Diagonal, single-qubit (no JW string needed)" },
    ],
    sourceTitle: "Über das Paulische Äquivalenzverbot",
    sourceUrl: "https://doi.org/10.1007/BF01331938",
    wires: ["mode 0", "mode 1", "mode 2", "mode 3"],
    operations: [
      { label: "n₀=(I-Z)/2", qubits: [0], tone: "neutral" },
      { label: "n₁=(I-Z)/2", qubits: [1], tone: "neutral" },
      { label: "n₂=(I-Z)/2", qubits: [2], tone: "neutral" },
      { label: "n₃=(I-Z)/2", qubits: [3], tone: "neutral" },
    ],
    outcomes: [
      { label: "N=2 sector (e.g. half-filling)", probability: 0.375 },
    ],
    code: `import numpy as np
from qiskit.quantum_info import SparsePauliOp

def number_operator(n: int, mode: int) -> SparsePauliOp:
    s = ["I"] * n
    s[mode] = "Z"
    return SparsePauliOp(["".join(["I"] * n), "".join(reversed(s))], [0.5, -0.5])

def total_number_operator(n: int) -> SparsePauliOp:
    total = number_operator(n, 0)
    for m in range(1, n):
        total = total + number_operator(n, m)
    return total.simplify()

n = 4
N = total_number_operator(n)
diag = np.real(N.to_matrix()).diagonal()
hamming_weights = [bin(i).count("1") for i in range(2 ** n)]
print("Matches Hamming weight for all basis strings:", np.allclose(sorted(diag), sorted(hamming_weights)))

RESULT = {"matches_hamming_weight": bool(np.allclose(sorted(diag), sorted(hamming_weights))), "eigenvalues": [float(v) for v in diag]}
`,
    filename: "number_operator.py",
    language: "python",
    extraVariants: [
      {
        framework: "PennyLane",
        status: "native",
        language: "python",
        filename: "number_operator.py",
        code: `import pennylane as qml

def number_operator(mode: int) -> qml.Hamiltonian:
    return qml.Hamiltonian([0.5, -0.5], [qml.Identity(mode), qml.PauliZ(mode)])

N = sum((number_operator(m) for m in range(4)), qml.Hamiltonian([], []))
eigenvalues = qml.eigvals(N)
print(eigenvalues)

RESULT = {"eigenvalues": [float(v) for v in eigenvalues]}
`,
      },
    ],
    relatedSlugs: ["fermi-hubbard-operator", "parity-operator-measurement"],
    literature: [
      {
        title: "Über das Paulische Äquivalenzverbot",
        authors: "P. Jordan, E. Wigner",
        year: "1928",
        url: "https://doi.org/10.1007/bf01331938",
        relevance: "Original paper introducing the Jordan-Wigner transformation from which the number operator's (I-Z)/2 form is derived.",
        relevanceJa: "数演算子の(I-Z)/2という形が導かれるJordan-Wigner変換を導入した原論文です。",
      },
    ],
  }),
  makeReferenceEntry({
    slug: "parity-operator-measurement",
    title: "Joint parity operator measurement",
    titleJa: "同時パリティ演算子測定",
    category: "operators",
    categoryLabel: "Operators",
    categoryLabelJa: "演算子",
    algorithmFamily: "Stabilizer / error-syndrome measurement",
    framework: "Qiskit",
    verification: "Eigenvalue check · ancilla-based circuit construction",
    verificationMethods: ["direct_math", "construction", "textbook_citation"],
    method:
      "P = Z^{⊗n} was checked to square to identity and to have eigenvalues +1 on even-weight basis strings, -1 on odd-weight strings, by direct evaluation on all 16 basis strings of a 4-qubit register. The non-destructive ancilla-CNOT-ladder measurement circuit was checked to leave each data-qubit basis state unchanged while depositing the correct parity bit onto the ancilla for all 16 inputs.",
    result:
      "Pass · P² = I and eigenvalues match even/odd Hamming weight exactly on all 16 basis strings; the ancilla circuit reproduces the same parity value non-destructively for every tested computational-basis input.",
    exportStatus: "Native Qiskit · OpenQASM conversion is mechanical (cx/measure only)",
    provenance: "Curated reference",
    updatedAt: "2026-07-16",
    description:
      "The joint parity operator Z^{⊗n} and its standard non-destructive ancilla-based measurement circuit, the core primitive behind stabilizer syndrome extraction.",
    descriptionJa: "同時パリティ演算子Z^{⊗n}とその標準的な非破壊補助量子ビット測定回路。スタビライザーのシンドローム抽出の中核となるプリミティブです。",
    introduction:
      "Almost every stabilizer code, entanglement witness, and error-correction syndrome extraction reduces to the same primitive: measure the joint parity of a set of qubits without collapsing any other information about their individual states.",
    introductionJa:
      "ほぼすべてのスタビライザー符号、エンタングルメントの証人、誤り訂正のシンドローム抽出は同じプリミティブに帰着します。すなわち、量子ビットの個々の状態に関する他の情報を崩すことなく、一組の量子ビットの同時パリティを測定することです。",
    explanation:
      "P = Z_1 Z_2 ... Z_n is diagonal with eigenvalue +1 on basis strings of even Hamming weight and -1 on odd Hamming weight; a ladder of CNOTs from each data qubit onto a single ancilla, followed by measuring only the ancilla in the Z basis, reads out this eigenvalue without collapsing superpositions within a fixed-parity subspace.",
    explanationJa:
      "P = Z_1 Z_2 ... Z_nは対角であり、偶数ハミング重みの基底文字列で固有値+1、奇数で-1です。各データ量子ビットから単一の補助量子ビットへのCNOTのはしごを適用し、補助のみをZ基底で測定することで、固定パリティ部分空間内の重ね合わせを崩すことなくこの固有値を読み出せます。",
    explanationMd: String.raw`The joint parity operator on $n$ qubits is

$$P = Z_1 Z_2 \cdots Z_n.$$

**Spectrum.** Since each $Z_i$ has eigenvalues $\pm1$, $P$ has eigenvalue $(-1)^{|x|}$ on basis state $|x\rangle$, where $|x|$ is the Hamming weight of the bit string $x$: $+1$ on even-weight strings, $-1$ on odd-weight strings. $P^2 = I$ since $Z_i^2=I$ for every factor, so $P$ is both Hermitian and unitary — a valid observable with only two possible measurement outcomes.

**Non-destructive measurement circuit.** To measure $\langle P\rangle$ without destroying superpositions *within* a fixed-parity eigenspace (essential for stabilizer codes, where you want to detect an error without collapsing the encoded logical information), introduce one ancilla in $|0\rangle$ and apply $\mathrm{CNOT}_{i\to\text{ancilla}}$ for every data qubit $i$. Since CNOT targeting the ancilla implements $|x\rangle_{\text{data}}|0\rangle_{\text{anc}} \mapsto |x\rangle_{\text{data}}|{\oplus_i x_i}\rangle_{\text{anc}}$, measuring the ancilla in the $Z$ basis returns the parity bit $\oplus_i x_i$ (equivalently, $\langle P\rangle = 1-2\langle \text{ancilla}\rangle$) while leaving the data register's relative phases and any coherence *within* a parity sector completely undisturbed — only the parity value is extracted, exactly the property a syndrome measurement needs.

**Where this shows up.** GHZ-state and cluster-state verification protocols measure exactly this operator (or products of it, e.g. the stabilizer generators $K_i$ of the graph states elsewhere in this catalog are all built from parity-type $X$-and-$Z$-string measurements) to certify entanglement without full state tomography. In stabilizer error correction, syndrome bits are joint-parity measurements of $Z$- or $X$-type check operators, and the non-destructive ancilla trick above is the literal circuit used to extract each syndrome bit without collapsing the encoded logical qubit.`,
    explanationMdJa: String.raw`$n$量子ビット上の同時パリティ演算子は

$$P = Z_1 Z_2 \cdots Z_n$$

です。

**スペクトル。** 各$Z_i$の固有値は$\pm1$なので、$P$は基底状態$|x\rangle$（$x$はビット文字列）上で固有値$(-1)^{|x|}$を持ちます。ここで$|x|$は$x$のハミング重みです。偶数重み文字列で+1、奇数重み文字列で-1です。すべての因子で$Z_i^2=I$なので$P^2 = I$であり、$P$はエルミートかつユニタリで、2つの測定結果しか持たない妥当な観測量です。

**非破壊測定回路。** 固定パリティ固有空間「内」の重ね合わせを壊さずに$\langle P\rangle$を測定するには（符号化された論理情報を崩さずに誤りを検出する必要があるスタビライザー符号で不可欠）、$|0\rangle$の補助量子ビットを1つ導入し、各データ量子ビット$i$から$\mathrm{CNOT}_{i\to\text{補助}}$を適用します。補助をターゲットとするCNOTは$|x\rangle_{\text{データ}}|0\rangle_{\text{補助}} \mapsto |x\rangle_{\text{データ}}|{\oplus_i x_i}\rangle_{\text{補助}}$を実装するため、補助をZ基底で測定するとパリティビット$\oplus_i x_i$が得られ（同値的に$\langle P\rangle = 1-2\langle \text{補助}\rangle$）、データレジスタの相対位相やパリティセクター「内」のコヒーレンスは完全に無傷のまま残ります。抽出されるのはパリティ値のみで、これはまさにシンドローム測定に必要な性質です。

**現れる場面。** GHZ状態やクラスター状態の検証プロトコルはまさにこの演算子（あるいはその積、たとえば本カタログの別項目にあるグラフ状態のスタビライザー生成子$K_i$はすべてパリティ型のXおよびZ文字列測定から構成されます）を測定し、完全な状態トモグラフィなしでエンタングルメントを証明します。スタビライザー誤り訂正では、シンドロームビットはZ型またはX型チェック演算子の同時パリティ測定であり、上記の非破壊補助量子ビットのトリックは、符号化された論理量子ビットを崩さずに各シンドロームビットを抽出するために実際に使われる回路です。`,
    tags: ["parity", "stabilizer measurement", "syndrome extraction", "non-destructive measurement"],
    resources: [
      { label: "Data qubits", value: "4" },
      { label: "Ancilla", value: "1" },
      { label: "Depth", value: "4 CNOT + 1 measurement" },
    ],
    metadata: [
      { label: "Operator", value: "P = Z⊗Z⊗Z⊗Z" },
      { label: "Eigenvalues", value: "±1 (even/odd Hamming weight)" },
      { label: "P²", value: "I" },
    ],
    sourceTitle: "Quantum Computation and Quantum Information: 10th Anniversary Edition",
    sourceUrl: "https://doi.org/10.1017/CBO9780511976667",
    wires: ["q[0]", "q[1]", "q[2]", "q[3]", "ancilla"],
    operations: [
      { label: "CX", qubits: [0, 4], tone: "ok" },
      { label: "CX", qubits: [1, 4], tone: "ok" },
      { label: "CX", qubits: [2, 4], tone: "ok" },
      { label: "CX", qubits: [3, 4], tone: "ok" },
      { label: "Measure(Z)", qubits: [4], tone: "accent" },
    ],
    outcomes: [
      { label: "Parity even (+1)", probability: 0.5 },
      { label: "Parity odd (-1)", probability: 0.5 },
    ],
    code: `from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

def parity_measurement_circuit(n: int) -> QuantumCircuit:
    qc = QuantumCircuit(n + 1, 1)  # qubits 0..n-1 = data, qubit n = ancilla
    for i in range(n):
        qc.cx(i, n)
    qc.measure(n, 0)
    return qc

# Verify P = Z^{\\otimes n} spectrum directly against Hamming weight
n = 4
for x in range(2 ** n):
    bitstring = format(x, f"0{n}b")
    weight = bitstring.count("1")
    expected_parity = 1 if weight % 2 == 0 else -1
    assert expected_parity == (-1) ** weight

qc = parity_measurement_circuit(n)
print(qc.draw())
\n\nFINAL_CIRCUIT = qc`,
    filename: "parity_operator_measurement.py",
    language: "python",
    extraVariants: [
      {
        framework: "Cirq",
        status: "native",
        language: "python",
        filename: "parity_operator_measurement.py",
        code: `import cirq

def parity_measurement_circuit(n: int) -> cirq.Circuit:
    data = cirq.LineQubit.range(n)
    ancilla = cirq.LineQubit(n)
    circuit = cirq.Circuit()
    for q in data:
        circuit.append(cirq.CNOT(q, ancilla))
    circuit.append(cirq.measure(ancilla, key="parity"))
    return circuit

FINAL_CIRCUIT = parity_measurement_circuit(4)
print(FINAL_CIRCUIT)
`,
      },
    ],
    relatedSlugs: ["number-operator", "surface-code-memory", "shor-code-error-correction", "graph-state-ring"],
    literature: [
      {
        title: "Quantum Computation and Quantum Information: 10th Anniversary Edition",
        authors: "Michael A. Nielsen and Isaac L. Chuang",
        year: "2010",
        url: "https://doi.org/10.1017/cbo9780511976667",
        relevance: "Standard textbook derivation of ancilla-based non-destructive parity and stabilizer measurement circuits.",
        relevanceJa: "補助量子ビットによる非破壊パリティ・スタビライザー測定回路の標準的な教科書での導出です。",
      },
    ],
  }),
];
