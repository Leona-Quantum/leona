// The authored layer graph — the content behind `/repository/layers`.
//
// **Generated from a reviewed authoring pass, then owned by hand.** Every node
// here was drafted from the primary literature, adversarially re-checked against
// the papers it cites, and corrected. It is normal source from here on: edit it
// directly, and `scripts/check-layer-graph.mjs` plus
// `lib/repository-layers.test.ts` will tell you what you broke.
//
// ## What may be written here
//
// - **A citation must resolve to the exact paper it names.** The re-check found
//   complexity claims lifted from a survey's comparison table and attributed to
//   the original, and one causal explanation invented on top of a real citation.
//   Both classes were removed. Neither is recoverable by review alone, which is
//   why the check is a fetch rather than a read.
// - **`conditions`, `cost` and `contested` are omitted rather than filled.** An
//   absent field renders as a sentence saying nobody stated one. A guess in the
//   hole is the thing §3.6 forbids on a record, and it is no better here.
// - **A `bypasses` edge must be true.** It is the strongest claim on the whole
//   surface — that a route does not merely implement a layer differently but
//   does not enter it at all — and one draft edge (discrete adiabatic "skipping"
//   eigenvalue estimation) was removed on exactly that test.
// - **`entries` names records the Atlas actually carries**, and most nodes name
//   none. That is the measurement, not a gap to paper over: the corpus is 283
//   records of circuits and primitives, and the literature this graph describes
//   is largely not in it. The index prints the count.
import type { LayerGraph } from "./layers.ts";

export const LAYER_GRAPH: LayerGraph = {
  nodes: [
  {
    kind: "capability",
    id: "nonlinear-ode-solve",
    label: "Solve a nonlinear ODE dy/dt = F(y)",
    labelJa: "非線形常微分方程式 dy/dt = F(y) を解く",
    summary: "Given access to a nonlinear vector field $F$ — in practice quadratic or polynomial — and a preparation unitary for the initial state, produce a quantum state proportional to $y(T)$ or an estimate of an observable of it. Quantum time evolution is linear, so no quantum primitive acts on this contract directly.",
    summaryJa: "非線形ベクトル場 $F$（実際には二次または多項式のもの）へのアクセスと初期状態の準備ユニタリが与えられたとき、$y(T)$ に比例する量子状態、またはその観測量の推定値を返します。量子力学の時間発展は線形であるため、この層の入出力をそのまま満たす量子プリミティブは存在しません。",
    contract: {
      from: "nonlinear-ivp",
      to: "solution-answer",

      takes: "Access oracles for the components of F (for example a linear part F_1, a quadratic part F_2, a forcing term F_0), a preparation unitary for y_in, the evolution time T, and an error tolerance ε.",
      takesJa: "F の各成分（例えば線形部 F_1、二次部 F_2、強制項 F_0）へのアクセスオラクル、y_in の準備ユニタリ、発展時間 T、誤差許容度 ε。",
      returns: "A normalized state ε-close to y(T)/||y(T)||, a history state over [0,T], or an estimate of an observable of the solution.",
      returnsJa: "y(T)/||y(T)|| に ε-近い正規化された状態、[0,T] 上のヒストリー状態、または解の観測量の推定値。",
    },
    whyALayer: "Every route must first commit to a representation of the nonlinearity, and the available representations — tensor powers, phase-space densities, level sets, homotopy series — differ in which nonlinearities they admit, in whether the truncation provably converges, and in how the answer is read back. This is also the layer at which the hard lower bounds bite, so it is where an advantage claim lives or dies.",
    whyALayerJa: "どの経路も、まず非線形性をどう表現するかを決めなければなりません。テンソル冪、位相空間の分布、レベルセット、ホモトピー級数といった表現は、扱える非線形性、打ち切りの収束が証明されているかどうか、答えをどう読み出すかの点で互いに異なります。厳しい下界が効いてくるのもこの層であり、優位性の主張が成り立つか崩れるかがここで決まります。",
  },
  {
    kind: "method",
    id: "carleman-euler-qls-route",
    label: "Quantum Carleman linearization algorithm",
    labelJa: "量子 Carleman 線形化アルゴリズム",
    summary: "Carleman-linearize the quadratic ODE, discretize with forward Euler, assemble the whole history into one large sparse linear system, and solve that system with a quantum linear system algorithm. This is the route that made dissipative nonlinear ODEs tractable in evolution time.",
    summaryJa: "二次の常微分方程式を Carleman 線形化し、前進 Euler で離散化し、履歴全体をひとつの大きな疎な線形系にまとめ、それを量子線形システムアルゴリズムで解きます。散逸的な非線形常微分方程式を、発展時間 T について効率的に解ける道を開いた経路です。",
    realizes: "nonlinear-ode-solve",
    conditions: "Requires $R < 1$ with $R = (1/|Re(\\lambda_1)|)(||u_in|| ||F_2|| + ||F_0||/||u_in||)$, $F_1$ diagonalizable with $Re(\\lambda_n) \\leq \\ldots \\leq Re(\\lambda_1) < 0$, and sparse access to $F_0$, $F_1$ and $F_2$. Theorem 1 additionally assumes $||F_0|| \\leq ||F_2||$ and normalizes so that $||u_in|| < 1$. Exponential decay of the solution precludes efficiency because it inflates $q = ||u_in||/||u(T)||$, so the useful regime is driven equations that avoid decay despite the dissipation. Krovi's later analysis relaxes the hypothesis on the dissipative matrix: it handles any sparse, invertible matrix with a negative log-norm, including non-diagonalizable ones, where Liu et al. and Xue et al. additionally require normality.",
    conditionsJa: "$R = (1/|Re(\\lambda_1)|)(||u_in|| ||F_2|| + ||F_0||/||u_in||)$ として $R < 1$ であること、$F_1$ が対角化可能で $Re(\\lambda_n) \\leq \\ldots \\leq Re(\\lambda_1) < 0$ であること、$F_0$, $F_1$, $F_2$ への疎アクセスがあることを要求します。定理 1 はさらに $||F_0|| \\leq ||F_2||$ を仮定し、$||u_in|| < 1$ となるよう正規化しています。解が指数的に減衰する場合は $q = ||u_in||/||u(T)||$ が大きくなるため効率が失われます。したがって有用なのは、散逸があっても減衰を避けられる駆動系です。Krovi による後年の解析は散逸行列への仮定を緩め、対数ノルムが負であれば非対角化可能なものを含め、疎で正則な任意の行列を扱えるようにしました。Liu らと Xue らはこれに加えて正規性を要求していました。",
    cost: "$T^2 q\\,\\mathrm{poly}(\\log T, \\log n, \\log 1/\\varepsilon)/\\varepsilon$, where $T$ is the evolution time, $\\varepsilon$ the allowed error, $n$ the dimension and $q$ measures decay of the solution — stated in the abstract under the assumption $R < 1$.",
    costJa: "$T^2 q\\,\\mathrm{poly}(\\log T, \\log n, \\log 1/\\varepsilon)/\\varepsilon$。ここで $T$ は発展時間、$\\varepsilon$ は許容誤差、$n$ は次元、$q$ は解の減衰を測る量です。$R < 1$ の仮定のもとで要旨に述べられています。",
    contested: "The same paper proves the general quadratic ODE problem is intractable for R ≥ √2: any quantum algorithm then has worst-case complexity exponential in $T$. Penuel et al. cost out end to end a neighbouring Carleman-linearized lattice Boltzmann workflow — same lift, a different time discretization and a different linear solver — for drag on a sphere, and find (logical qubits)×(T-gates) ranging from 10^21 to 10^39 over Reynolds numbers 10^1 to 10^8, with quantum resource scaling O(Re^2.68) against classical direct numerical simulation at O(Re^3): in their words, no exponential quantum advantage. They attribute that to explicit time-evolution of nonlinear differential equations subject to the CFL condition or a similar condition linking time step to grid spacing, not to one implementation.",
    contestedJa: "同じ論文は、R ≥ √2 のとき一般の二次常微分方程式の問題が効率的には解けないこと、すなわちどの量子アルゴリズムでも最悪計算量が $T$ について指数的になることを証明しています。また Penuel らは、Carleman 線形化を格子 Boltzmann 法に適用した近縁のワークフロー（持ち上げは共通ですが、時間離散化も線形ソルバーもこの経路とは別のものです）について、球まわりの流れの抗力計算を端から端まで資源見積もりを行い、Reynolds 数 10^1 から 10^8 の範囲で（論理量子ビット数）×（T ゲート数）が 10^21 から 10^39 に及ぶこと、量子側の資源スケーリングが O(Re^2.68) で、古典の直接数値シミュレーション（DNS）の O(Re^3) に対する改善が多項式的にとどまることを報告しています。著者らの表現では、指数的な量子優位性はありません。その原因は、CFL 条件など時間刻みと格子間隔を結びつける条件に従う非線形常微分方程式の陽的な時間発展に帰されており、個別の実装に帰されているのではありません。",
    steps: ["nonlinear-linear-embedding", "time-discretization", "quantum-linear-solve"],
    // Both pins are this route's own first sentence: "Carleman-linearize the
    // quadratic ODE, discretize with forward Euler". The third step is
    // deliberately absent — the route says "a quantum linear system algorithm"
    // and names none of the five, so that hop keeps drawing the slot.
    via: {
      "nonlinear-linear-embedding": "carleman-linearization",
      "time-discretization": "forward-euler",
    },
    citations: [
      { title: "Efficient quantum algorithm for dissipative nonlinear differential equations", authors: "Jin-Peng Liu, Herman Øie Kolden, Hari K. Krovi, Nuno F. Loureiro, Konstantina Trivisa, Andrew M. Childs", year: "2020", url: "https://arxiv.org/abs/2011.03185" },
      { title: "Improved quantum algorithms for linear and nonlinear differential equations", authors: "Hari Krovi", year: "2022", url: "https://arxiv.org/abs/2202.01054" },
      { title: "Detailed assessment of calculating drag force with quantum computers: Explicit time-evolution precludes exponential advantage for nonlinear differential equations", authors: "John Penuel, Amara Katabarwa, Peter D. Johnson, Parker Kuklinski, Benjamin Rempfer, Collin Farquhar, Yudong Cao, Michael C. Garrett", year: "2024", url: "https://arxiv.org/abs/2406.06323" },
    ],
  },
  {
    kind: "method",
    id: "kvn-simulation-route",
    label: "Quantum simulation of the KvN representation",
    labelJa: "Koopman-von Neumann 表現の量子シミュレーション",
    shortLabel: "KvN simulation",
    shortLabelJa: "KvN シミュレーション",
    summary: "Because the Koopman-von Neumann generator is Hermitian and its propagator unitary, the lifted evolution can be run by Hamiltonian simulation directly. No linear system is assembled and no linear solver is called.",
    summaryJa: "Koopman-von Neumann の生成子はエルミートであり、その伝播子はユニタリであるため、持ち上げられた発展はハミルトニアンシミュレーションでそのまま実行できます。線形系を組み立てることも、線形ソルバーを呼ぶこともありません。",
    realizes: "nonlinear-ode-solve",
    conditions: "The exponential claim holds when the Koopman-von Neumann Hamiltonian is sparse — Joseph glosses this as local or banded — and is stated against a deterministic Eulerian discretization of the Liouville equation, not against the best classical method; Joseph says himself that the more interesting comparison is against the best probabilistic classical algorithm, where the gain falls to quadratic. The quadratic claim is conditioned instead on using quantum walks for state preparation and amplitude estimation for observables, not on sparsity. The output is the state psi = f^(1/2) e^(i phi), whose modulus squared is the phase-space density, and the readout Joseph supplies is for observables; measuring the entire PDF over all states is something he calls undesirable, so a trajectory-level answer is a separate problem the paper does not solve.",
    conditionsJa: "指数的な主張は、Koopman-von Neumann ハミルトニアンが疎である場合（Joseph は局所的あるいは帯状と言い換えています）に成り立ち、Liouville 方程式の決定論的なオイラー的（格子上の）離散化を基準としたものであって、最良の古典手法を基準としたものではありません。Joseph 自身、より興味深い比較は最良の確率的古典アルゴリズムとの比較であり、その場合の利得は二次にとどまると述べています。二次の主張のほうは疎性ではなく、状態準備に量子ウォークを、観測量に振幅推定を用いることを条件としています。出力は psi = f^(1/2) e^(i phi) という状態で、その絶対値の二乗が位相空間の分布です。Joseph が与える読み出しは観測量に対するものであり、位相空間全体にわたって分布を測定することは望ましくないと明言しています。したがって個々の軌道についての答えは、この論文が解いていない別の問題です。",
    cost: "Exponentially more efficient than a deterministic Eulerian discretization of the Liouville equation if the Koopman-von Neumann Hamiltonian is sparse — an exponential speedup in the phase-space dimension $D$ and a polynomial one in the number $L$ of grid points taken in each direction. Joseph also reports a quadratic improvement, up to polylogarithmic factors, over classical probabilistic Monte Carlo algorithms when quantum walk techniques are used for state preparation and amplitude estimation for the calculation of observables.",
    costJa: "Koopman-von Neumann ハミルトニアンが疎であれば、Liouville 方程式の決定論的なオイラー的（格子上の）離散化より指数的に効率的です。より正確には、位相空間の次元 $D$ については指数的、各方向にとる格子点数 $L$ については多項式的な高速化です。Joseph はまた、状態準備に量子ウォークの技法を、観測量の計算に振幅推定を用いた場合、古典的な確率的モンテカルロ法に対して、多重対数因子を除いて二次の改善が得られると報告しています。",
    contested: "Joseph limits both claims himself. On the exponential one: some important calculations can require a large number of time steps, potentially scaling as a power of $D$, which would reduce the expected savings to polynomial at best. On the quadratic one: because the Koopman-von Neumann lift doubles the phase-space dimension, if the gains over classical Monte Carlo are only quadratic then that doubling would effectively eliminate the advantage — so where the underlying system is Hamiltonian and simulating the quantized Hamiltonian system suffices for the intended calculation, he states that quantizing the Hamiltonian is the more efficient approach.",
    contestedJa: "Joseph は二つの主張のいずれにも自ら限界を付しています。指数的な主張については、重要な計算のなかには必要な時間ステップ数が $D$ の冪で増えうるものがあり、その場合、期待される節約はよくても多項式にとどまると述べています。二次の主張については、Koopman-von Neumann の持ち上げが位相空間の次元を倍にするため、古典モンテカルロに対する利得が二次にとどまるなら、この次元の倍加が優位性を実質的に打ち消すと述べています。したがって元の系がハミルトン系であり、量子化したハミルトニアンのシミュレーションで目的が果たせる場合には、そちらのほうが効率的な計算方法である、というのが著者の判断です。",
    steps: ["nonlinear-linear-embedding", "hamiltonian-simulation", "observable-estimation"],
    // **This route ends in a number, not a state**, and that single fact is why
    // the four routes with a blank stretch could not share one readout slot
    // (`plans/atlas-revamp/W11-readout-stretch.md`). What W11 refused to invent,
    // W14 wired from the source instead: Joseph's readout IS
    // `observable-estimation` via amplitude estimation, and the contract meets it
    // because his simulation hop lands holding a runnable computation of the
    // evolved state — "The KvN simulation computes the state |ψ⟩" — which the
    // `through` below records as `runnable-evolution`. LCHS and
    // Schrödingerisation still recover a solution *state* and keep their
    // own-work tails; this route closes at `observable-value`, which is the
    // answer form its slot's contract promises ("or an estimate of an
    // observable of the solution"). Owner ruling, session 120: the map
    // restructures to hold what the literature has (`plans/atlas-revamp/
    // W14-readout-wiring.md`).
    hops: {
      "observable-estimation": {
        theory:
          "No state is read out here: what is produced is ⟨O⟩ = Σ_x O(x) f(x), the expectation value of a phase-space observable. An ancilla is appended and R̂_φ built by a reversible computation of φ = O^{1/2}ψ — \"the reversible calculation requires two KvN simulations: one to compute φ … and one to uncompute φ, which requires running the KvN simulation backward in time\". Amplitude estimation of the ancilla's |1⟩ amplitude then gives the estimate. " +
          "[[approximation: Amplitude estimation returns an estimate rather than the value. \"Since each evaluation of R̂_φ and R̂†_φ uses two evaluations of |ψ⟩, the amplitude amplification algorithm requires four KvN simulations to be performed per step\", so accuracy ε costs 4K ∼ O(1/ε) simulations — the readout re-invokes the step above it rather than measuring its output.]] " +
          "Joseph rules out the two alternatives by name: averaging repeated projective measurements returns to the classical 1/ε^2 law, and measuring the entire PDF over all states he calls \"not desirable\".",
        theoryJa:
          "ここでは状態そのものは読み出されません。得られるのは位相空間の観測量の期待値 ⟨O⟩ = Σ_x O(x) f(x) です。補助量子ビットを一つ加え、φ = O^{1/2}ψ の可逆計算によって R̂_φ を構成します。「この可逆計算には二回の KvN シミュレーションが必要である。一回は φ を計算するため、もう一回は φ を打ち消すためで、後者は KvN シミュレーションを時間逆向きに走らせることを要する」とされています。続いて補助量子ビットの |1⟩ 振幅を振幅推定します。" +
          "[[approximation: 振幅推定が返すのは値ではなく推定値です。「R̂_φ と R̂†_φ の各評価が |ψ⟩ の評価を二回使うため、振幅増幅アルゴリズムは一段あたり四回の KvN シミュレーションを要する」とされ、精度 ε には 4K ∼ O(1/ε) 回かかります。読み出しは上の工程の出力を測るのではなく、上の工程を呼び直しています。]] " +
          "Joseph は代替案を名指しで退けています。射影測定を繰り返して平均を取る方法は古典的な 1/ε^2 の法則に戻ってしまい、全状態にわたって確率密度関数そのものを測ることは「望ましくない」と述べています。",
      },
    },
    // The lift this route uses returns a *Hermitian* generator, and that is the
    // whole reason a simulator can be handed it directly. The slot it descends
    // into promises a linear generator and no more, so without this the route
    // reads as skipping a conversion it does not skip.
    //
    // The simulation narrowing is the same shape one hop later: the slot
    // promises a circuit and no more ("something still has to run it on a
    // state"), but Joseph's construction has the input's preparation in hand
    // and runs the pair — "The KvN simulation computes the state |ψ⟩" (§V C).
    // So this route's landing is `runnable-evolution`, the circuit that is also
    // the routine for the evolved state, and that is what lets the readout
    // below follow as a real step instead of filing as a feed.
    through: {
      "nonlinear-linear-embedding": "hermitian-generator",
      "hamiltonian-simulation": "runnable-evolution",
    },
    // The pins the `through` entries above were already relying on. Only the
    // Koopman-von Neumann lift returns a Hermitian generator, so that narrowing
    // was an unstated claim about *which* method fills the step; now it is
    // stated, and a reader sees the algorithm's own name on the hop rather than
    // the slot's. The readout pin is Joseph's own choice made explicit: he
    // rules out sampling (1/ε²) and full-PDF readout by name, and builds
    // amplitude estimation.
    via: {
      "nonlinear-linear-embedding": "koopman-von-neumann-lift",
      "observable-estimation": "amplitude-estimation-readout",
    },
    repeats: {
      "hamiltonian-simulation": {
        count: "4K ∼ O(1/ε) KvN simulations — \"the KvN simulation must be repeated 4K ∼ O(1/ε) times\"",
        countJa: "4K ∼ O(1/ε) 回の KvN シミュレーション。「KvN シミュレーションは 4K ∼ O(1/ε) 回繰り返されなければならない」",
        mark: "×4K",
        markJa: "×4K",
        closure: "coherent",
        note: "The loop is the readout's, and what it turns is the simulation below: each amplification step evaluates R̂_φ and R̂_φ† once each, and each evaluation runs the simulation twice — forward to compute φ = O^{1/2}ψ, backward to uncompute it — so one step is four KvN simulations and K ∼ O(1/ε) steps buy accuracy ε. Coherent invocations are the whole price difference: averaging repeated measurements instead would return to the classical 1/ε² law.",
        noteJa: "この反復は読み出しのものであり、回しているのは下層のシミュレーションです。増幅の一段ごとに R̂_φ と R̂_φ† を一回ずつ評価し、各評価はシミュレーションを二回 — φ = O^{1/2}ψ を計算するために順方向へ、それを打ち消すために逆方向へ — 実行します。したがって一段が KvN シミュレーション四回にあたり、K ∼ O(1/ε) 段で精度 ε が得られます。コヒーレントな呼び出しであることが価格差のすべてです。測定を繰り返して平均すれば、古典的な 1/ε² の法則に戻ってしまいます。",
      },
    },
    bypasses: ["quantum-linear-solve", "time-discretization"],
    entries: ["amplitude-estimation"],
    citations: [
      { title: "Koopman-von Neumann Approach to Quantum Simulation of Nonlinear Classical Dynamics", authors: "Ilon Joseph", year: "2020", url: "https://arxiv.org/abs/2003.09980" },
    ],
  },
  {
    kind: "method",
    id: "level-set-observable-route",
    label: "Level-set method for observables of nonlinear PDEs",
    labelJa: "非線形偏微分方程式の観測量に対するレベルセット法",
    shortLabel: "Level sets for PDE observables",
    shortLabelJa: "PDE 観測量のレベルセット法",
    summary: "Use the exact level-set mapping to a linear PDE, solve the linear problem quantumly, and compute physical observables from it. For $M$ sets of initial data the cost does not grow with $M$.",
    summaryJa: "レベルセット法による厳密な写像で線形偏微分方程式に移し、その線形問題を量子的に解いて物理的な観測量を計算します。$M$ 組の初期データに対して、計算費用は $M$ とともに増えません。",
    realizes: "nonlinear-ode-solve",
    conditions: "Stated for nonlinear Hamilton-Jacobi and scalar hyperbolic PDEs, where the mapping is exact for arbitrary nonlinearity. For general nonlinear PDEs, quantum advantage with respect to $M$ is claimed only in the large-$M$ limit. The advantage is stated for computing observables, not for producing the full solution vector; that distinction is load-bearing and is frequently dropped in secondary summaries.",
    conditionsJa: "非線形 Hamilton-Jacobi 方程式およびスカラー双曲型偏微分方程式について述べられており、その範囲では任意の非線形性に対して写像が厳密です。一般の非線形偏微分方程式では、$M$ に関する量子優位性は $M$ が大きい極限でのみ主張されています。優位性は観測量の計算について述べられたものであり、解ベクトル全体を得ることについてではありません。この区別は本質的で、二次的な要約では落とされがちです。",
    cost: "Computational cost independent of $M$, the number of sets of initial data. Depending on the details of the initial data it can also display up to exponential advantage in both the dimension of the PDE and the error in computing its observables.",
    costJa: "計算費用は初期データの組数 $M$ に依存しません。初期データの詳細によっては、偏微分方程式の次元と観測量計算の誤差の両方について、最大で指数的な優位性を示すこともあります。",
    steps: ["nonlinear-linear-embedding", "linear-ode-solve"],
    // "Use the exact level-set mapping to a linear PDE" — this route's own
    // summary. The linear solve it hands off to is left unpinned: it says
    // "solve the linear problem quantumly" and names no algorithm.
    via: { "nonlinear-linear-embedding": "level-set-linearization" },
    citations: [
      { title: "Quantum algorithms for computing observables of nonlinear partial differential equations", authors: "Shi Jin, Nana Liu", year: "2022", url: "https://arxiv.org/abs/2202.07834" },
    ],
  },
  {
    kind: "method",
    id: "homotopy-perturbation-route",
    label: "Homotopy-perturbation series, embedded as a linear ODE",
    labelJa: "ホモトピー摂動級数を線形常微分方程式に埋め込む",
    shortLabel: "Homotopy series, linear ODE",
    shortLabelJa: "ホモトピー級数の線形 ODE 化",
    summary: "Embed the homotopy-perturbation series into a finite-dimensional linear ODE system and solve that with a quantum linear-ODE algorithm, obtaining a state $\\varepsilon$-close to the normalized exact solution with $Ω(1)$ success probability.",
    summaryJa: "ホモトピー摂動級数を有限次元の線形常微分方程式系に埋め込み、それを量子線形常微分方程式アルゴリズムで解きます。正規化された厳密解に $\\varepsilon$-近い状態が、成功確率 $Ω(1)$ で得られます。",
    realizes: "nonlinear-ode-solve",
    conditions: "Stated for $n$-dimensional nonlinear dissipative ODEs. Krovi notes that the logarithmic dependence on error achieved here holds only for homogeneous nonlinear equations, and that this route, like Liu et al., additionally requires normality of the matrix modelling dissipation.",
    conditionsJa: "$n$ 次元の非線形散逸的常微分方程式について述べられています。Krovi は、ここで得られる誤差への対数依存性が斉次な非線形方程式に限られること、およびこの経路が Liu らと同様に散逸をモデル化する行列の正規性を追加で要求することを指摘しています。",
    cost: "$O(g \\eta T\\,\\mathrm{poly}(\\log(nT/\\varepsilon)))$, where $\\eta$ and $g$ measure the decay of the solution, $n$ is the dimension, $T$ the evolution time and $\\varepsilon$ the error.",
    costJa: "$O(g \\eta T\\,\\mathrm{poly}(\\log(nT/\\varepsilon)))$。ここで $\\eta$ と $g$ は解の減衰を測る量、$n$ は次元、$T$ は発展時間、$\\varepsilon$ は誤差です。",
    steps: ["nonlinear-linear-embedding", "linear-ode-solve"],
    // "Embed the homotopy-perturbation series into a finite-dimensional linear
    // ODE system" — this route's own summary. The solver it then calls is
    // "a quantum linear-ODE algorithm", unnamed, so that hop stays a slot.
    via: { "nonlinear-linear-embedding": "homotopy-perturbation-lift" },
    citations: [
      { title: "Quantum homotopy perturbation method for nonlinear dissipative ordinary differential equations", authors: "Cheng Xue, Yu-Chun Wu, Guo-Ping Guo", year: "2021", url: "https://arxiv.org/abs/2111.07486" },
      { title: "Improved quantum algorithms for linear and nonlinear differential equations", authors: "Hari Krovi", year: "2022", url: "https://arxiv.org/abs/2202.01054" },
    ],
  },
  {
    kind: "capability",
    id: "nonlinear-linear-embedding",
    label: "Embed a nonlinear system into a linear one",
    labelJa: "非線形系を線形系に埋め込む",
    shortLabel: "Embed nonlinear as linear",
    shortLabelJa: "非線形を線形に埋め込む",
    summary: "Given a nonlinear vector field $F$, produce a (truncated) linear generator on a lifted space, a lift of the initial condition into that space, and a decoding of the target quantity, such that linear evolution reproduces the nonlinear dynamics to accuracy $\\varepsilon$. The truncation or lift parameter fixes both the accuracy and the dimension.",
    summaryJa: "非線形ベクトル場 $F$ に対して、持ち上げた空間上の（打ち切られた）線形生成子、初期条件の持ち上げ写像、目的量の復号写像を構成し、線形発展が元の非線形ダイナミクスを精度 $\\varepsilon$ で再現するようにします。打ち切り・持ち上げのパラメータが精度と次元の両方を決めます。",
    contract: {
      from: "nonlinear-ivp",
      to: "linear-ivp",

      takes: "F, y_in, T, ε, and a truncation or lift parameter (Carleman truncation level N, a phase-space grid, the level-set dimension, the homotopy order).",
      takesJa: "F、y_in、T、ε、および打ち切り・持ち上げパラメータ（Carleman の打ち切り水準 N、位相空間の格子、レベルセットの次元、ホモトピーの次数）。",
      returns: "A linear generator with any inhomogeneity, a lift map, a readout map, and an error bound as a function of the truncation parameter.",
      returnsJa: "線形生成子と非斉次項、持ち上げ写像、読み出し写像、および打ち切りパラメータの関数としての誤差評価。",
    },
    whyALayer: "The lifts here are not interchangeable, and they are not all siblings either: Carleman is the monomial-basis instance of Koopman linearization and the Fourier basis is a second instance, so choosing between those two is choosing a basis on a space of observables. Katz et al. list Koopman-von Neumann linearization as its own entry beside Carleman and do not say whether it too is a basis choice, and nothing cited here places level sets (Jin-Liu) or homotopy series terms (Xue et al.) inside that framework either, so all three stay separate on this map. What divides all of them is admissible nonlinearity, whether the truncation converges at all, and what the lifted state physically means — and choosing wrongly here, not downstream, is what usually breaks an end-to-end claim.",
    whyALayerJa: "ここに並ぶ持ち上げ方は互換ではなく、また互いに対等な並列項でもありません。Carleman は Koopman 線形化を単項式基底でとった実例であり、Fourier 基底はもう一つの実例です。したがってこの二つの選択は、観測量の空間上でどの基底をとるかの選択です。Katz らは Koopman-von Neumann 線形化を Carleman と並ぶ独立の項目として挙げており、これも基底の選択にあたるかどうかは述べていません。レベルセット（Jin-Liu）やホモトピー級数の各項（Xue ら）についても、この枠組みの内側に位置づけた文献をここでは引いていません。そのため本図ではいずれも別扱いのままにしています。これらを分けるのは、許容される非線形性、打ち切りがそもそも収束するかどうか、持ち上げた状態が物理的に何を意味するかであり、端から端までの主張が崩れるのは、たいてい下流ではなくこの選択の段階です。",
  },
  {
    kind: "method",
    id: "carleman-linearization",
    label: "Carleman linearization",
    labelJa: "Carleman 線形化",
    summary: "Lift the quadratic ODE onto the tower $y, y⊗y, y⊗y⊗y, \\ldots$ , on which the dynamics is exactly linear and each level couples only to its neighbours, then truncate at level $N$. The lift itself is exact; all of the error comes from the truncation. Katz, Muraleedharan and Alase derive it as one instance of Koopman linearization: taking the space of observables to be the polynomials and the basis functions to be the monomials reproduces exactly this tower, in one variable and in $n$.",
    summaryJa: "二次の常微分方程式を $y, y⊗y, y⊗y⊗y, \\ldots$ という塔に持ち上げると、力学は厳密に線形になり、各水準は隣接水準としか結合しません。これを水準 $N$ で打ち切ります。持ち上げ自体は厳密であり、誤差はすべて打ち切りから生じます。Katz・Muraleedharan・Alase は、これを Koopman 線形化の一つの実例として導いています。観測量の空間を多項式にとり、基底関数を単項式にとると、一変数の場合も $n$ 変数の場合も、ちょうどこの塔が再現されます。",
    realizes: "nonlinear-linear-embedding",
    // The owner's ruling, session 103: Koopman linearization is the larger
    // process and Carleman is the monomial-basis instance of it. `refines` is
    // the relation this already needed — child declares the broader parent, both
    // must realize the same capability — so no new field. The witness is the
    // summary sentence above and Example 3.4 of arXiv:2512.06488, which the node
    // now cites: the map cannot check a `refines` assertion against a source, so
    // the source has to be named in prose beside it.
    refines: "koopman-linearization",
    refinesMark: "Koopman",
    refinesMarkJa: "Koopman",
    // `cost` is authored (session 122) on the Dyson sibling's terms: from the
    // source rather than from memory, and saying in the field itself that the
    // number is the whole algorithm's and not this step's alone. What was read
    // is Liu et al.'s **abstract** — which is exactly what the register already
    // records for `arxiv:2011.03185` (`reportsBasis: "abstract"`), so the cost
    // and the register agree about their own basis. The theorem's constants and
    // its dependence of the truncation level $N$ on $R$ and $\varepsilon$ are in
    // the full text, were not read, and are therefore not quoted: an unread
    // bound stated here would be this map asserting a number no source it
    // consulted carries. Upgrading this to a full-text read is a normal edit —
    // change the field and change the register row's basis with it.
    cost: "Liu et al. state the algorithm's complexity as $T^2 q \\cdot \\mathrm{poly}(\\log T, \\log n, \\log(1/\\varepsilon))/\\varepsilon$, where $T$ is the evolution time, $n$ the dimension of the nonlinear system, $\\varepsilon$ the allowed error, and $q$ a quantity measuring the decay of the solution. It is quoted here as the paper states it: a complexity for the complete algorithm — this embedding together with the linear solver the truncated tower feeds — and not a standalone cost for the linearization, which on its own is a change of variables and buys nothing until something solves the system it produces. The bound holds under the $R < 1$ hypothesis recorded above. How the truncation level $N$ depends on $R$ and $\\varepsilon$ is in the paper's full text and is not quoted here.",
    costJa: "Liu らはアルゴリズムの計算量を $T^2 q \\cdot \\mathrm{poly}(\\log T, \\log n, \\log(1/\\varepsilon))/\\varepsilon$ と述べています。ここで $T$ は発展時間、$n$ は非線形系の次元、$\\varepsilon$ は許容誤差であり、$q$ は解の減衰を測る量です。これは論文の記述のまま引いたものです。すなわち、この埋め込みと、打ち切られた塔が渡す線形ソルバとを合わせたアルゴリズム全体についての計算量であって、線形化単体の費用ではありません。線形化はそれ自体としては変数変換にすぎず、生成された系を何かが解くまでは何も得られないからです。この評価は上に記した $R < 1$ の仮定のもとで成り立ちます。打ち切り水準 $N$ が $R$ と $\\varepsilon$ にどう依存するかは論文の本文にあり、ここでは引用していません。",
    conditions: "Stated for $du/dt = F_2 u^{\\otimes2} + F_1 u + F_0(t)$ with $F_1$ diagonalizable and eigenvalues ordered $Re(\\lambda_n) \\leq \\ldots \\leq Re(\\lambda_1) < 0$, that is, a strictly dissipative linear part. Liu et al. give a convergence theorem for $R < 1$, where $R = (1/|Re(\\lambda_1)|)(||u_in|| ||F_2|| + ||F_0||/||u_in||)$. It does not apply when the linear part has an eigenvalue with non-negative real part.",
    conditionsJa: "$du/dt = F_2 u^{\\otimes2} + F_1 u + F_0(t)$ の形で述べられており、$F_1$ は対角化可能で、固有値が $Re(\\lambda_n) \\leq \\ldots \\leq Re(\\lambda_1) < 0$ の順に並ぶこと、すなわち線形部が厳密に散逸的であることを要求します。Liu らは $R = (1/|Re(\\lambda_1)|)(||u_in|| ||F_2|| + ||F_0||/||u_in||)$ として $R < 1$ の場合に収束定理を与えています。線形部が実部非負の固有値をもつ場合には適用できません。",
    contested: "Liu et al. also prove that the general quadratic ODE problem is intractable for R ≥ √2, so the band 1 ≤ R < √2 is open and $R < 1$ must not be described as necessary. Wu, Wang and Li subsequently prove linear convergence with respect to the truncation level $N$ under a resonance condition instead of a dissipative one, with numerical experiments on Burgers' equation, Fermi-Pasta-Ulam chains and the Korteweg-de Vries equation; that enlarges the set of systems for which the embedding is known to converge and does not overturn the R ≥ √2 result.",
    contestedJa: "Liu らは同じ論文で、R ≥ √2 のとき一般の二次常微分方程式の問題が効率的には解けないことも証明しています。したがって 1 ≤ R < √2 の範囲は未解決であり、$R < 1$ を必要条件のように述べてはなりません。その後 Wu・Wang・Li は、散逸条件ではなく共鳴条件のもとで打ち切り水準 $N$ に関する線形収束を証明し、Burgers 方程式、Fermi-Pasta-Ulam 鎖、Korteweg-de Vries 方程式で数値検証しています。これは埋め込みの収束が判明している系の範囲を広げるものであって、R ≥ √2 の結果を覆すものではありません。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Efficient quantum algorithm for dissipative nonlinear differential equations", authors: "Jin-Peng Liu, Herman Øie Kolden, Hari K. Krovi, Nuno F. Loureiro, Konstantina Trivisa, Andrew M. Childs", year: "2020", url: "https://arxiv.org/abs/2011.03185" },
      { title: "Quantum Algorithms for Nonlinear Dynamics: Revisiting Carleman Linearization with No Dissipative Conditions", authors: "Hsuan-Cheng Wu, Jingyao Wang, Xiantao Li", year: "2024", url: "https://arxiv.org/abs/2405.12714" },
      { title: "Efficient quantum algorithm for solving differential equations with Fourier nonlinearity via Koopman linearization", authors: "Judd Katz, Gopikrishnan Muraleedharan, Abhijeet Alase", year: "2025", url: "https://arxiv.org/abs/2512.06488" },
    ],
  },
  {
    kind: "method",
    id: "koopman-linearization",
    label: "Koopman linearization",
    labelJa: "Koopman 線形化",
    summary: "Pick a space of observables $G$ containing the quantity of interest and a basis $Ψ$ for it; the Koopman generator acting on $Ψ$ gives an infinite-dimensional linear ODE, truncated by projecting onto $N$ basis functions. $G$ fixes which observables the lifted dynamics can report and $Ψ$ fixes the structure of the generator, so this is a family of lifts parameterised by that choice rather than a single lift. Only basis choices a cited paper has carried through are recorded here — Katz, Muraleedharan and Alase name Chebyshev and Hermite bases as directions rather than results — so the narrower versions recorded under it are a sample of the framework and not an enumeration of it.",
    summaryJa: "対象となる量を含む観測量の空間 $G$ と、その基底 $Ψ$ を選びます。$Ψ$ に作用する Koopman 生成子が無限次元の線形常微分方程式を与え、$N$ 個の基底関数への射影によって打ち切ります。$G$ は持ち上げた力学から読み取れる観測量を決め、$Ψ$ は生成子の構造を決めるため、これは単一の持ち上げではなく、その選択でパラメータ付けられた族です。ここに記録するのは、引用元の論文が実際に用いた基底の選び方だけです。Katz・Muraleedharan・Alase は Chebyshev 基底や Hermite 基底を今後の方向として挙げるにとどめており、ここに記録されているより狭い種類は枠組みの一例であって、その全体を数え上げたものではありません。",
    realizes: "nonlinear-linear-embedding",
    // No `conditions` and no `cost`, and that is a reading of the paper rather
    // than a gap. Every stated hypothesis and every complexity in
    // arXiv:2512.06488 is for the Fourier basis — that is, for the child below,
    // not for the framework. Filling these from the child would attribute one
    // instance's costs to the family.
    steps: [],
    atomic: true,
    citations: [
      { title: "Efficient quantum algorithm for solving differential equations with Fourier nonlinearity via Koopman linearization", authors: "Judd Katz, Gopikrishnan Muraleedharan, Abhijeet Alase", year: "2025", url: "https://arxiv.org/abs/2512.06488" },
    ],
  },
  {
    kind: "method",
    id: "carleman-fourier-linearization",
    label: "Carleman-Fourier linearization",
    labelJa: "Carleman-Fourier 線形化",
    summary: "Lift the rescaled ODE $dx/dt = F_0 + F_1 e^{ix}$ — the problem as posed is $du/dt = G_0 + G_1 e^{iu}$, rescaled so that $F_0 = G_0$ and $F_1 = νG_1$ — onto the Fourier tower $e^{ix}, (e^{ix})^{\\otimes2}, \\ldots$ instead of the monomial tower, then truncate at level $N$. Katz, Muraleedharan and Alase give the reason for the choice: expanding the same equation in monomials leaves the coefficient matrix non-sparse, whereas in the Fourier basis the coefficient matrix of their single-variable illustration has only two non-zero entries in each row.",
    summaryJa: "再スケーリングした常微分方程式 $dx/dt = F_0 + F_1 e^{ix}$（もとの問題は $du/dt = G_0 + G_1 e^{iu}$ であり、$F_0 = G_0$、$F_1 = νG_1$ と再スケーリングしたもの）を、単項式の塔ではなく $e^{ix}, (e^{ix})^{\\otimes2}, \\ldots$ という Fourier の塔に持ち上げ、水準 $N$ で打ち切ります。Katz・Muraleedharan・Alase はこの選択の理由を述べています。同じ方程式を単項式で展開すると係数行列は疎になりませんが、Fourier 基底では、著者らの一変数の例において係数行列の各行がもつ非零成分は二つです。",
    realizes: "nonlinear-linear-embedding",
    refines: "koopman-linearization",
    refinesMark: "Koopman",
    refinesMarkJa: "Koopman",
    conditions: "Stated for the rescaled ODE $dx/dt = F_0 + F_1 e^{ix}$ with time-independent coefficient matrices. Katz et al. give two truncation regimes. The dissipative one requires $µ̃_0 := \\min_j Im${$(F_0)_j$}$ \\geq 0$ and $R_p := ||F_1||_row,q ||\\Psi_1(0)||_p / µ̃_0 < 1$, under which the $k$-th truncation error component is bounded by $(||\\Psi_1(0)||_p)^{N+1} (||F_1||_row,q / µ̃_0)^{N+1−k}$. The second drops dissipativity and holds only on a finite interval $[0, T_max]$ with $T_max = \\min${$T_r, \\ln r / (||F_0||_∞ + ||F_1||_row,q)$}, where $r$ is the rescaling parameter and $T_r$ is the horizon their Lemma 4.3 supplies. Chen, Motee and Sun state the linearization for periodic vector fields with several fundamental frequencies and prove exponential convergence in the truncation length, achieved across the whole time horizon only for particular classes of system.",
    conditionsJa: "係数行列が時間に依存しない、再スケーリング後の $dx/dt = F_0 + F_1 e^{ix}$ について述べられています。Katz らは打ち切りに関して二つの領域を与えています。散逸的な領域では $µ̃_0 := \\min_j Im${$(F_0)_j$}$ \\geq 0$ かつ $R_p := ||F_1||_row,q ||\\Psi_1(0)||_p / µ̃_0 < 1$ を要求し、このとき打ち切り誤差の第 $k$ 成分は $(||\\Psi_1(0)||_p)^{N+1} (||F_1||_row,q / µ̃_0)^{N+1−k}$ で抑えられます。もう一方は散逸性の仮定を外す代わりに、有限区間 $[0, T_max]$ でのみ成り立ち、$T_max = \\min${$T_r, \\ln r / (||F_0||_∞ + ||F_1||_row,q)$} で与えられます。ここで $r$ は再スケーリングのパラメータ、$T_r$ は補題 4.3 が与える時間の上限です。Chen・Motee・Sun は、複数の基本周波数をもつ周期的なベクトル場に対してこの線形化を述べ、打ち切り長に関する指数的収束を証明しています。時間区間全体にわたって指数的収束が得られるのは、特定の系のクラスに限られます。",
    // No `cost`: every complexity in arXiv:2512.06488 is the end-to-end query
    // complexity of their algorithm, which is a route-level fact, not a fact
    // about this embedding.
    steps: [],
    atomic: true,
    citations: [
      { title: "Carleman-Fourier Linearization of Complex Dynamical Systems: Convergence and Explicit Error Bounds", authors: "Panpan Chen, Nader Motee, Qiyu Sun", year: "2024", url: "https://arxiv.org/abs/2411.11598" },
      { title: "Efficient quantum algorithm for solving differential equations with Fourier nonlinearity via Koopman linearization", authors: "Judd Katz, Gopikrishnan Muraleedharan, Abhijeet Alase", year: "2025", url: "https://arxiv.org/abs/2512.06488" },
    ],
  },
  {
    kind: "method",
    id: "koopman-von-neumann-lift",
    label: "Koopman-von Neumann lift to phase-space densities",
    labelJa: "Koopman-von Neumann による位相空間分布への持ち上げ",
    shortLabel: "Koopman–von Neumann lift",
    shortLabelJa: "Koopman–von Neumann の持ち上げ",
    summary: "Represent nonlinear non-Hamiltonian classical dynamics by the Liouville equation for the phase-space density; the generalized Koopman-von Neumann formulation recasts that as a Schrödinger equation with a Hermitian Hamiltonian operator and a unitary propagator. The lift is exact, and its cost is dimensional rather than an approximation error.",
    summaryJa: "非線形かつ非ハミルトン的な古典力学を、位相空間の確率分布に対する Liouville 方程式として表現します。一般化された Koopman-von Neumann の定式化では、これはエルミートなハミルトニアン演算子とユニタリな伝播子をもつ Schrödinger 方程式に書き換えられます。持ち上げは厳密であり、その代償は近似誤差ではなく次元です。",
    realizes: "nonlinear-linear-embedding",
    conditions: "Applies to nonlinear non-Hamiltonian classical dynamics on phase space. Joseph's efficiency claim holds when the Koopman-von Neumann Hamiltonian is sparse, and is stated relative to a deterministic Eulerian discretization of the Liouville equation. The lifted object is a distribution over phase space, so recovering a single trajectory or a pointwise value is a separate readout problem.",
    conditionsJa: "位相空間上の非線形・非ハミルトン的な古典力学に適用されます。Joseph の効率性の主張は、Koopman-von Neumann ハミルトニアンが疎である場合に成り立ち、Liouville 方程式の決定論的なオイラー的（格子上の）離散化を基準として述べられています。持ち上げられた対象は位相空間上の分布であるため、単一の軌道や各点の値を取り出すことは別の読み出し問題になります。",
    cost: "Quantum simulation of classical dynamics is exponentially more efficient than a deterministic Eulerian discretization of the Liouville equation if the Koopman-von Neumann Hamiltonian is sparse (abstract). No unconditional end-to-end query count for a general nonlinear system is stated.",
    costJa: "Koopman-von Neumann ハミルトニアンが疎であれば、古典力学の量子シミュレーションは Liouville 方程式の決定論的なオイラー的（格子上の）離散化より指数的に効率的である、と要旨に述べられています。一般の非線形系に対する無条件の端から端までのクエリ数は示されていません。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Koopman-von Neumann Approach to Quantum Simulation of Nonlinear Classical Dynamics", authors: "Ilon Joseph", year: "2020", url: "https://arxiv.org/abs/2003.09980" },
    ],
  },
  {
    kind: "method",
    id: "level-set-linearization",
    label: "Level-set exact linearization",
    labelJa: "レベルセット法による厳密な線形化",
    summary: "Map a nonlinear PDE exactly onto a linear one using the level-set method, with no truncation and therefore no convergence parameter. The price is a higher-dimensional linear problem.",
    summaryJa: "レベルセット法により、非線形偏微分方程式を線形の偏微分方程式へ厳密に写します。打ち切りがないため収束パラメータも存在しません。その代償は、より高次元の線形問題になることです。",
    realizes: "nonlinear-linear-embedding",
    conditions: "Jin and Liu state the exact mapping for nonlinear Hamilton-Jacobi equations and scalar nonlinear hyperbolic PDEs, for arbitrary nonlinearity. Systems of conservation laws lie outside that stated scope. Because the map is exact there is no convergence condition analogous to Carleman's $R < 1$; what the mapping preserves is physical observables rather than a directly readable solution vector.",
    conditionsJa: "Jin と Liu は、非線形 Hamilton-Jacobi 方程式およびスカラー非線形双曲型偏微分方程式に対して、任意の非線形性のもとで厳密な写像を述べています。保存則系はこの記述された適用範囲の外にあります。写像が厳密であるため、Carleman の $R < 1$ に相当する収束条件は存在しません。保存されるのは直接読み出せる解ベクトルではなく、物理的な観測量です。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Quantum algorithms for computing observables of nonlinear partial differential equations", authors: "Shi Jin, Nana Liu", year: "2022", url: "https://arxiv.org/abs/2202.07834" },
    ],
  },
  {
    kind: "method",
    id: "homotopy-perturbation-lift",
    label: "Homotopy perturbation embedding",
    labelJa: "ホモトピー摂動法による埋め込み",
    summary: "Convert the original nonlinear ODE into another nonlinear system whose homotopy-perturbation terms embed into a single finite-dimensional linear ODE system, truncated at a chosen homotopy order. The embedding is finite-dimensional by construction.",
    summaryJa: "元の非線形常微分方程式を別の非線形系に変換し、そのホモトピー摂動項を単一の有限次元線形常微分方程式系に埋め込みます。埋め込みは選んだホモトピー次数で打ち切られ、構成上つねに有限次元です。",
    realizes: "nonlinear-linear-embedding",
    conditions: "Stated for $n$-dimensional nonlinear dissipative ODEs. Krovi describes Xue et al., alongside Liu et al., as additionally requiring normality of the matrix that models dissipation.",
    conditionsJa: "$n$ 次元の非線形散逸的常微分方程式について述べられています。Krovi は、Xue らの手法が Liu らの手法と同様に、散逸をモデル化する行列の正規性を追加で要求すると記述しています。",
    // `cost` (session 123): quoted from the abstract of arxiv:2111.07486, which
    // is the basis the register records for that paper (`reportsBasis:
    // "abstract"`). Like the Carleman sibling, the bound is for the complete
    // algorithm, and the field says so.
    cost: "Xue, Wu and Guo state the algorithm's complexity as $O(g\\eta T\\,\\mathrm{poly}(\\log(nT/\\varepsilon)))$, where $T$ is the evolution time, $n$ the dimension, $\\varepsilon$ the allowed error, and $\\eta$ and $g$ are quantities measuring the decay of the solution; the returned state is $\\varepsilon$-close to the normalized exact solution with success probability $\\Omega(1)$. As with the Carleman route, this is a complexity for the complete algorithm — the embedding together with the quantum linear-ODE solver it feeds — not a standalone cost for the lift. The abstract claims exponential improvement over the best classical algorithms or previous quantum algorithms in $n$ or $\\varepsilon$; how the homotopy truncation order enters the bound is in the paper's full text and is not quoted here.",
    costJa: "Xue・Wu・Guo はアルゴリズムの計算量を $O(g\\eta T\\,\\mathrm{poly}(\\log(nT/\\varepsilon)))$ と述べています。ここで $T$ は発展時間、$n$ は次元、$\\varepsilon$ は許容誤差であり、$\\eta$ と $g$ は解の減衰を測る量です。返される状態は正規化された厳密解に $\\varepsilon$-近く、成功確率は $\\Omega(1)$ です。Carleman の経路と同様、これは埋め込みとそれが渡す量子線形常微分方程式ソルバとを合わせたアルゴリズム全体の計算量であって、持ち上げ単体の費用ではありません。概要では、$n$ または $\\varepsilon$ に関して最良の古典アルゴリズムおよび既存の量子アルゴリズムに対する指数的な改善が主張されています。ホモトピー打ち切り次数が評価にどう入るかは論文の本文にあり、ここでは引用していません。",
    contested: "Xue and co-authors later report that applying quantum simulation to each step of the related homotopy analysis method makes complexity grow exponentially with the truncation order, and introduce a quantum-compatible linearization that maps the whole process into one system of linear PDEs so that complexity grows only polynomially with that order.",
    contestedJa: "その後 Xue らは、関連するホモトピー解析法の各段階に量子シミュレーションを直接適用すると、打ち切り次数に対して計算量が指数的に増大すると報告しています。そのうえで、過程全体を一つの線形偏微分方程式系に写す「量子計算と両立する線形化」を導入し、打ち切り次数に対する増大を多項式にとどめています。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Quantum homotopy perturbation method for nonlinear dissipative ordinary differential equations", authors: "Cheng Xue, Yu-Chun Wu, Guo-Ping Guo", year: "2021", url: "https://arxiv.org/abs/2111.07486" },
      { title: "Quantum homotopy analysis method with quantum-compatible linearization for nonlinear partial differential equations", authors: "Cheng Xue, Xiao-Fan Xu, Xi-Ning Zhuang, Tai-Ping Sun, Yun-Jie Wang, Ming-Yang Tan, Chuang-Chao Ye, Huan-Yu Liu, Yu-Chun Wu, Zhao-Yun Chen, Guo-Ping Guo", year: "2024", url: "https://arxiv.org/abs/2411.06759" },
      { title: "Improved quantum algorithms for linear and nonlinear differential equations", authors: "Hari Krovi", year: "2022", url: "https://arxiv.org/abs/2202.01054" },
    ],
  },
  {
    kind: "capability",
    id: "linear-ode-solve",
    label: "Solve a linear ODE du/dt = A(t)u + b(t)",
    labelJa: "線形常微分方程式 du/dt = A(t)u + b(t) を解く",
    summary: "Given block-encoding access to $A(t)$ and $b(t)$ and a preparation unitary for $u_0$, output a normalized state $\\varepsilon$-close to $u(T)/||u(T)||$. Matrix-query and state-preparation-query counts are stated separately, because methods here differ in them independently.",
    summaryJa: "$A(t)$ と $b(t)$ のブロック符号化と $u_0$ の準備ユニタリが与えられたとき、$u(T)/||u(T)||$ に $\\varepsilon$-近い正規化された状態を出力します。行列クエリ数と初期状態準備クエリ数は別々に示します。この二つは手法ごとに独立に変わるためです。",
    contract: {
      from: "linear-ivp",
      to: "solution-answer",

      takes: "A block-encoding of A(t) with a normalization α_A ≥ max_t ||A(t)||, preparation unitaries for u_0 and b, the evolution time T, and an error tolerance ε.",
      takesJa: "α_A ≥ max_t ||A(t)|| を満たす A(t) のブロック符号化、u_0 と b の準備ユニタリ、発展時間 T、誤差許容度 ε。",
      returns: "A state proportional to u(T), or a history state, together with separately stated matrix-query and initial-state-query complexity.",
      returnsJa: "u(T) に比例する状態、またはヒストリー状態。あわせて行列クエリ数と初期状態クエリ数を別々に示します。",
    },
    whyALayer: "This is the pivot of the cluster. Methods fulfilling it split into two structurally different families: those that assemble one large linear system and call a quantum linear solver, and those that never form a linear system at all, reducing instead to Hamiltonian simulation or to repeated singular value amplification. The two families differ in how many queries they make to the initial-state preparation oracle, and that difference is structural rather than a matter of constants — when the initial state is expensive to prepare, it dominates the end-to-end cost.",
    whyALayerJa: "この層が全体の分岐点です。ここを満たす手法は、構造的に二つの系統に分かれます。ひとつは大きな線形系をまとめて組み立てて量子線形ソルバーを呼ぶもの、もうひとつは線形系をそもそも作らず、ハミルトニアンシミュレーションや特異値増幅の反復に帰着させるものです。両者は初期状態準備オラクルへのクエリ数が定数倍ではなく構造的に異なり、初期状態の準備が高価な場合には、その差が全体の費用を支配します。",
  },
  {
    kind: "method",
    id: "taylor-all-at-once",
    label: "Taylor propagator, all-at-once encoding",
    labelJa: "Taylor 伝播子の一括符号化",
    shortLabel: "Taylor, all-at-once",
    shortLabelJa: "Taylor の一括符号化",
    summary: "Encode a truncated Taylor series of the propagator into a single sparse linear system approximating the whole evolution, then solve it with a quantum linear system algorithm. This is what brought the precision dependence down to polynomial in $\\log(1/\\varepsilon)$.",
    summaryJa: "伝播子の Taylor 級数を打ち切り、発展全体を近似するひとつの疎な線形系に符号化して、量子線形システムアルゴリズムで解きます。精度依存性を $\\log(1/\\varepsilon)$ の多項式まで下げたのがこの手法です。",
    realizes: "linear-ode-solve",
    conditions: "Stated for systems of possibly inhomogeneous linear ODEs with constant coefficients. Berry, Childs, Ostrander and Wang describe the encoding as a sparse, well-conditioned linear system, and state that unlike with finite difference methods their approach does not require additional hypotheses to ensure numerical stability. It reduces to a quantum linear solve; it does not remove that layer.",
    conditionsJa: "定数係数の、非斉次であってもよい線形常微分方程式系について述べられています。Berry・Childs・Ostrander・Wang は、この符号化を疎で条件のよい線形系と表現し、差分法とは異なり数値的安定性のための追加の仮定を必要としないと述べています。この手法は量子線形ソルバーに帰着するものであり、その層を取り除くわけではありません。",
    cost: "The complexity is polynomial in the logarithm of the inverse error, an exponential improvement over previous quantum algorithms for this problem. No matrix-query or state-preparation query count appears in the abstract; a $\\kappa_V$-dependent expression often attached to this method in secondary summaries belongs to the spectral-method row of a later comparison table, so it is not reproduced here.",
    costJa: "計算量は誤差の逆数の対数について多項式であり、この問題に対する従来の量子アルゴリズムからの指数的な改善です。要旨には行列クエリ数も状態準備クエリ数も示されていません。二次的な要約でこの手法に付されがちな $\\kappa_V$ を含む式は、後年の比較表におけるスペクトル法の行のものですので、ここでは再掲しません。",
    steps: ["time-discretization", "quantum-linear-solve"],
    // **The pin the owner's "the same picture twice" complaint pointed at.**
    // This method's own name says *truncated Taylor propagator*, and
    // `truncated-taylor-propagator` already exists one level down as a way
    // through `time-discretization` — the same Berry-Childs-Ostrander-Wang
    // construction, filed where it belongs.
    //
    // Pinning is not collapsing. The three all-at-once methods stay three
    // methods, because they are three papers with three sets of conditions.
    // What stops being identical is the *picture*: this hop now names the
    // Taylor propagator and `dyson-all-at-once`'s names the Dyson series.
    // (`krovi-linear-ode` drew the slot-labelled pair here until s121 — it is
    // folded now, W17: a reanalysis with no walk of its own lives in this
    // card's Refinements section rather than as a third lane, and inventing a
    // discretization for it to point at would still be the map asserting
    // something no source does.)
    //
    // **What this comment used to say was false, and the way it was false is
    // worth keeping.** Until session 107 it claimed the pin had already stopped
    // the three drawing one picture. It had not: `routeOf` read `through` and
    // never `via`, and `chainInside` labelled every hop with its *slot*, so the
    // pin was recorded, validated, and drawn nowhere. Seven of the corpus's
    // eight pins were inert the same way. `scripts/check-layer-graph.mjs` was
    // meanwhile grouping on `steps` **plus** `via` — a second, hand-written
    // model of the drawing — so the gate saw two groups where the canvas drew
    // one, went green, and the claim above survived twenty-odd merges. A pin is
    // only a fix once something reads it.
    via: { "time-discretization": "truncated-taylor-propagator" },
    citations: [
      { title: "Quantum algorithm for linear differential equations with exponentially improved dependence on precision", authors: "Dominic W. Berry, Andrew M. Childs, Aaron Ostrander, Guoming Wang", year: "2017", url: "https://arxiv.org/abs/1701.03684" },
    ],
  },
  {
    kind: "method",
    id: "krovi-linear-ode",
    label: "Krovi's reanalysis of the all-at-once encoding",
    labelJa: "Krovi による一括符号化の再解析",
    // The only name in the corpus the refinement mark pushed over the column,
    // and it was the widest label on `nonlinear-ode-solve` before the mark
    // existed — the full form spends 26 of its 45 characters restating the
    // encoding that `⊂ Taylor` now names outright, one lane away from the lane
    // that draws it. Authored rather than machine-cut, which is the whole
    // difference `shortLabel` records: the full name still reaches the `<title>`,
    // the card and the accessible list.
    shortLabel: "Krovi's reanalysis",
    shortLabelJa: "Krovi の再解析",
    summary: "Reanalyses the all-at-once propagator encoding and shows that the norm of the matrix exponential, rather than the eigenvector condition number, characterizes the run time. It still forms a global linear system and still calls a quantum linear solver.",
    summaryJa: "一括符号化を再解析し、実行時間を特徴づけるのは固有ベクトル行列の条件数ではなく行列指数のノルムであることを示します。それでもなお大域的な線形系を組み立て、量子線形ソルバーを呼ぶ点は変わりません。",
    realizes: "linear-ode-solve",
    // **Folded (s121, W17): same walk, better analysis — no lane of its own.**
    // This relation has now lived three lives: session 107 recorded `refines`
    // and the canvas ignored it (Krovi drew as a flat peer); W13 nested it as
    // a bracketed variant lane; the owner's s121 ruling folded it into the
    // parent's card — *"until there is actually a difference that we can
    // represent in the map itself for the user, the refinement can exist
    // within the broader card with a short explanation."* This paper is that
    // case exactly: it re-analyses the construction rather than changing it,
    // so a lane of its own has nothing to draw that the parent's does not.
    // The node stays — page, URL, mathematics, citations — only the lane goes;
    // the parent card's Refinements section is where a reader meets it now.
    //
    // Do **not** resolve the fold by inventing a `via` pin for this method.
    // The paper chooses no discretization; it re-analyses the one Berry,
    // Childs, Ostrander and Wang already chose. A pin here would put a name on
    // a hop no source puts there — and it would be a drawable difference,
    // which validation would then use to refuse the fold flag.
    refines: "taylor-all-at-once",
    refinesMark: "Taylor",
    refinesMarkJa: "Taylor",
    sameInternalsAsParent: true,
    potentialPath:
      "The paper's contribution is analytic — the norm of the matrix exponential, not the eigenvector condition number, characterizes the run time — and it chooses no step of its own. Nothing in the walk differs, so a drawn path would need the map to represent analysis-level distinctions (which bound governs a lane), which it does not draw today.",
    potentialPathJa:
      "この論文の貢献は解析的なものです。実行時間を特徴づけるのは固有ベクトル行列の条件数ではなく行列指数のノルムである、という点であり、独自の工程は選ばれていません。歩みには何の違いもないため、独自の経路として描くには、どの評価が経路を支配するかという解析水準の区別を地図が表現できる必要がありますが、現在の地図はそれを描きません。",
    conditions: "Extends to many classes of non-diagonalizable matrices, which the Berry-Childs-Ostrander-Wang analysis required to be diagonalizable, and is exponentially faster than those bounds for certain classes of diagonalizable matrices. Applied back to nonlinear ODEs through Carleman linearization, it handles any sparse, invertible matrix modelling dissipation that has a negative log-norm, where Liu et al. and Xue et al. additionally require normality. It improves the constant of the bottleneck; it does not remove the quantum-linear-solve layer.",
    conditionsJa: "Berry・Childs・Ostrander・Wang の解析が対角化可能性を要求していたのに対し、非対角化可能な行列の多くのクラスにも適用でき、ある種の対角化可能な行列については従来の評価より指数的に高速です。Carleman 線形化を通じて非線形常微分方程式に適用する場合、対数ノルムが負であれば疎で正則な任意の散逸行列を扱えます。Liu らと Xue らはこれに加えて正規性を要求していました。この手法はボトルネックの定数を改善するものであり、量子線形ソルバーの層を取り除くものではありません。",
    cost: "The paper's own framing: the norm of the matrix exponential characterizes the run time of quantum algorithms for linear ODEs. The precise bound is not reproduced here.",
    costJa: "論文自身の言い方では、線形常微分方程式に対する量子アルゴリズムの実行時間を特徴づけるのは行列指数のノルムです。厳密な評価式はここでは再掲しません。",
    steps: ["time-discretization", "quantum-linear-solve"],
    citations: [
      { title: "Improved quantum algorithms for linear and nonlinear differential equations", authors: "Hari Krovi", year: "2022", url: "https://arxiv.org/abs/2202.01054" },
      { title: "Quantum algorithm for linear differential equations with exponentially improved dependence on precision", authors: "Dominic W. Berry, Andrew M. Childs, Aaron Ostrander, Guoming Wang", year: "2017", url: "https://arxiv.org/abs/1701.03684" },
    ],
  },
  {
    kind: "method",
    id: "dyson-all-at-once",
    label: "Dyson propagator, all-at-once encoding",
    labelJa: "Dyson 伝播子の一括符号化",
    shortLabel: "Dyson, all-at-once",
    shortLabelJa: "Dyson の一括符号化",
    summary: "Encode the Dyson series in a system of linear equations and solve it via the optimal quantum linear equation solver, extending the all-at-once approach to genuinely time-dependent generators.",
    summaryJa: "Dyson 級数を連立一次方程式に符号化し、最適な量子線形方程式ソルバーで解きます。これにより一括符号化の手法が、真に時間依存な生成子にまで拡張されます。",
    realizes: "linear-ode-solve",
    conditions: "Stated for time-dependent linear differential equations, with a simplified approach in the time-independent case. It reduces to a quantum linear solve. An, Childs and Lin's comparison table places truncated Dyson in the family whose initial-state-preparation cost grows with the evolution, not in the bypass family.",
    conditionsJa: "時間依存の線形微分方程式について述べられており、時間非依存の場合には簡略化された手法が与えられています。この手法は量子線形ソルバーに帰着します。An・Childs・Lin の比較表では、Dyson 打ち切りは初期状態準備の費用が発展とともに増える系統に置かれており、迂回する系統ではありません。",
    cost: "Logarithmic dependence of the complexity on the error and derivative, with the usual exponential improvement over classical approaches in the scaling with the dimension, the solution being encoded in the amplitudes of a quantum state.",
    costJa: "計算量は誤差および生成子の微分に対して対数的に依存します。次元に関しては古典的手法に対する通常どおりの指数的な改善があり、解は量子状態の振幅に符号化されます。",
    steps: ["time-discretization", "quantum-linear-solve"],
    // This method's own first four words: *"Encode the Dyson series"*. The pin
    // was impossible until session 107 because the node it needed did not
    // exist — `truncated-dyson-series` is authored now, as a sibling of the
    // Taylor propagator and out of this method's own summary and citation, with
    // no cost or conditions invented for it.
    //
    // The second hop stays the slot, deliberately. This route says *"the optimal
    // quantum linear equation solver"* and names none of the five recorded ways
    // through `quantum-linear-solve`, so a pin there would be a guess.
    via: { "time-discretization": "truncated-dyson-series" },
    citations: [
      { title: "Quantum algorithm for time-dependent differential equations using Dyson series", authors: "Dominic W. Berry, Pedro C. S. Costa", year: "2022", url: "https://arxiv.org/abs/2212.03544" },
      { title: "Quantum algorithm for linear non-unitary dynamics with near-optimal dependence on all parameters", authors: "Dong An, Andrew M. Childs, Lin Lin", year: "2023", url: "https://arxiv.org/abs/2312.03916" },
    ],
  },
  {
    kind: "method",
    id: "time-marching-usva",
    label: "Time-marching with uniform singular value amplification",
    labelJa: "一様特異値増幅による時間前進法",
    shortLabel: "Time-marching",
    shortLabelJa: "時間前進法",
    summary: "Propagate the solution one step at a time and defeat the exponentially vanishing success probability by repeatedly invoking uniform singular value amplification, improved further by a compression gadget lemma. Fang, Lin and Tong present it explicitly as a design path alternative to solvers based on quantum linear systems algorithms.",
    summaryJa: "解を 1 ステップずつ前進させ、指数的に小さくなる成功確率を、一様特異値増幅の繰り返しによって克服します。圧縮ガジェットの補題によりさらに改善されます。Fang・Lin・Tong はこれを、量子線形システムアルゴリズムに基づくソルバーとは別の設計路線として明示的に提示しています。",
    realizes: "linear-ode-solve",
    conditions: "It surpasses existing QLSA-based solvers in three respects stated by the authors: $A(t)$ need not be diagonalizable; $A(t)$ may be non-smooth and is only required to be of bounded variation; and it can use fewer queries to the initial state. It needs no global linear solve, which is what makes the bypass real rather than rhetorical. The trade is in matrix queries: An, Childs and Lin's comparison table gives time-marching a worse dependence on $\\alpha_A T$ than the LCHS family while crediting it with the same initial-state-preparation advantage.",
    conditionsJa: "著者らが挙げる三点で、既存の量子線形システムアルゴリズムに基づくソルバーを上回ります。$A(t)$ が対角化可能である必要がないこと、$A(t)$ が滑らかでなくてもよく有界変動でありさえすればよいこと、初期状態へのクエリ数が少なくて済むことです。大域的な線形ソルバーを必要としないため、この迂回は言葉のうえだけのものではありません。代償は行列クエリにあります。An・Childs・Lin の比較表では、初期状態準備の利点は LCHS 系統と同等としつつ、$\\alpha_A T$ への依存はより悪いものとされています。",
    cost: "The complexity depends linearly on the amplification ratio, which quantifies the deviation from a unitary dynamics; that linear dependence is proved to attain the query complexity lower bound and thus cannot be improved in the worst case.",
    costJa: "計算量は、ユニタリな力学からのずれを定量化する増幅比に線形に依存します。この線形依存はクエリ計算量の下界を達成することが証明されており、最悪の場合にはこれ以上改善できません。",
    steps: ["time-discretization"],
    repeats: {
      "time-discretization": {
        count: "once per time step, with an amplification at every one",
        countJa: "各時間ステップにつき 1 回、そのつど増幅を伴います。",
        mark: "×per step",
        markJa: "×毎ステップ",
        closure: "coherent",
        note: "Fang, Lin and Tong's method is the repetition stated as the design: propagate one step at a time, and defeat the exponentially vanishing success probability by repeatedly invoking uniform singular value amplification. Nothing is measured between turns — the decay is a coherent one and it is bought back coherently — which is why the cost lands on the amplification ratio rather than on a shot count. The authors prove that linear dependence attains the query-complexity lower bound, so this repetition cannot be made cheaper in the worst case; it can only be avoided by not marching.",
        noteJa: "Fang・Lin・Tong の手法は、反復そのものを設計として述べたものです。1 ステップずつ前進させ、指数的に小さくなる成功確率を一様特異値増幅の繰り返しで克服します。ステップの間で測定は行われません。減衰はコヒーレントなものであり、コヒーレントに買い戻されます。費用がショット数ではなく増幅比に現れるのはこのためです。著者らはこの線形依存がクエリ計算量の下界を達成することを証明しており、最悪の場合、この反復をこれ以上安くすることはできません。避ける方法は、前進させないことだけです。",
      },
    },
    bypasses: ["quantum-linear-solve"],
    citations: [
      { title: "Time-marching based quantum solvers for time-dependent linear differential equations", authors: "Di Fang, Lin Lin, Yu Tong", year: "2022", url: "https://arxiv.org/abs/2208.06941" },
      { title: "Quantum algorithm for linear non-unitary dynamics with near-optimal dependence on all parameters", authors: "Dong An, Andrew M. Childs, Lin Lin", year: "2023", url: "https://arxiv.org/abs/2312.03916" },
    ],
  },
  {
    kind: "method",
    id: "lchs-route",
    label: "LCHS — linear combination of Hamiltonian simulation",
    labelJa: "LCHS — ハミルトニアンシミュレーションの線形結合",
    shortLabel: "LCHS",
    shortLabelJa: "LCHS",
    summary: "Express a general non-unitary evolution operator as a linear combination of unitary evolution operators, each of which solves a Hamiltonian simulation problem, rather than converting the problem into a dilated linear system. An, Liu and Lin state that the method can achieve optimal cost in terms of state preparation.",
    summaryJa: "一般の非ユニタリな発展演算子を、それぞれがハミルトニアンシミュレーション問題を解くユニタリな発展演算子の線形結合として表します。問題を拡大された線形系に変換することはしません。An・Liu・Lin は、この手法が状態準備の費用について最適なものを達成しうると述べています。",
    realizes: "linear-ode-solve",
    conditions: "Requires the decomposition $A(t) = L(t) + iH(t)$ with $L(t) = (A(t)+A(t)^†)/2$ the Hermitian part, and $L(t) ⪰ 0$ throughout the interval. Without a shift it does not apply when the Hermitian part has a negative eigenvalue anywhere on the interval — this is a real restriction, and the analogue at the linear layer of Carleman's dissipativity requirement. It does not rely on converting the problem into a dilated linear system problem, or on the spectral mapping theorem that underpins QSVT-based approaches, which is what substantiates the bypass rather than merely asserting it.",
    conditionsJa: "$A(t) = L(t) + iH(t)$ の分解を要求します。ここで $L(t) = (A(t)+A(t)^†)/2$ はエルミート部で、区間全体で $L(t) ⪰ 0$ でなければなりません。シフトを入れない限り、区間のどこかでエルミート部が負の固有値をもつ場合には適用できません。これは実際の制約であり、線形層における Carleman の散逸条件に相当します。問題を拡大された線形系に変換することにも、QSVT 系の手法を支えるスペクトル写像定理にも依存しません。この点が、迂回を主張だけでなく裏付けています。",
    // `cost` authored session 123 from the paper's full MAIN TEXT (the ar5iv
    // render of arXiv:2303.01029, complete through the Discussion; the
    // Supplemental Materials hold the proofs and were not read — every
    // statement quoted below sits in the main text). The abstract alone states
    // no bound — the earlier session's truncated WebFetch wasn't hiding one —
    // so this field is what NEXT.md's "get a read you can see is complete"
    // instruction was for. The register row for arxiv:2303.01029 moves
    // abstract → full-text with this edit. Theorem 3 (complex absorbing
    // potentials, fast-forwardable $L$) is the abstract's "near-optimal in all
    // parameters" claim; it is an application-specific sharpening and is left
    // to the paper rather than quoted as this route's price.
    cost: "An, Liu and Lin price the solver in Theorem 2, for the implementation combining LCU with a $p$-th order product formula: $\\tilde{O}( ((||u_0|| + ||b||_{L^1})/||u(T)||)^{2+2/p} \\Gamma_p^{1+1/p} T^{1+1/p} / \\varepsilon^{1+2/p} )$ queries to the input models of $H$ and $L$, where $\\Gamma_p$ collects the sizes of the first $p$ derivatives of $H$ and $L$, together with $O( (||u_0|| + ||b||_{L^1})/||u(T)|| )$ queries to the state-preparation oracle and the source input. The second count is the title's claim: it matches the $\\Omega(||u_0||/||u(T)||)$ lower bound the paper cites, so no differential-equation solver can query the initial state fewer times. The matrix-query count is not optimal, and the paper says why: the Cauchy kernel $1/(\\pi(1+k^2))$ decays only quadratically, forcing the truncation $K = O(1/\\varepsilon)$ and an extra $\\varepsilon^{-1}$ factor of circuit depth — the limitation the improved kernel recorded under Refinements was built to remove.",
    costJa: "An・Liu・Lin は定理 2 で、LCU と $p$ 次の積公式を組み合わせた実装についてソルバの費用を与えています。$H$ と $L$ の入力モデルへのクエリは $\\tilde{O}( ((||u_0|| + ||b||_{L^1})/||u(T)||)^{2+2/p} \\Gamma_p^{1+1/p} T^{1+1/p} / \\varepsilon^{1+2/p} )$ です。ここで $\\Gamma_p$ は $H$ と $L$ の $p$ 階までの導関数の大きさをまとめた量です。加えて、状態準備オラクルとソース項入力へのクエリは $O( (||u_0|| + ||b||_{L^1})/||u(T)|| )$ です。後者が題名の主張そのものです。論文が引用する下界 $\\Omega(||u_0||/||u(T)||)$ と一致するため、どの微分方程式ソルバもこれより少ない回数で初期状態を問い合わせることはできません。行列クエリの方は最適ではなく、論文自身が理由を述べています。Cauchy カーネル $1/(\\pi(1+k^2))$ の減衰が二次的でしかないため、打ち切り $K = O(1/\\varepsilon)$ が必要になり、回路深さに $\\varepsilon^{-1}$ の因子が余分に掛かります。「改良」の節に記録された改良カーネルが取り除くために作られたのは、まさにこの制約です。",
    // Two steps, not one, since session 106. This route was filed as reaching
    // `hamiltonian-simulation` straight from a linear ODE system, which is a
    // generator that is *not* Hermitian — so the conversion was missing from the
    // picture, and `schrodingerisation` was missing the same one, which is why
    // the two drew the same chain (R13, KNOWN_TWINS). The conversion is now its
    // own slot and the two pin different ways through it.
    steps: ["hamiltonian-recasting", "hamiltonian-simulation"],
    // **The blank stretch after Hamiltonian simulation, written down.** The owner
    // asked in session 113 why the map goes quiet once the simulation has run.
    // Session 115 read the four routes' own papers to find out, and what it found
    // is that they do **not** end the same way — so the answer is four hop notes,
    // each quoting the paper that owns it, and not a twentieth slot. The whole
    // argument, with the quotes, is `plans/atlas-revamp/W11-readout-stretch.md`.
    hops: {
      "lchs-route": {
        theory:
          "The simulated unitaries are combined by LCU: a prepare pair loads the quadrature weights onto an ancilla register and a select oracle indexes the family, so that W block-encodes Σ_j c_j U_j on the all-zeros branch. " +
          "[[assumption: \"The final step is to measure all the ancilla registers, and if all the outcomes are 0, then the resulting state approximately encodes the solution u(t) of the ODE\" — that outcome is the flag every theorem in the paper refers to.]] " +
          "One shot succeeds with probability (‖T|ψ⟩‖/‖α‖_1)^2, and amplitude amplification raises it to Ω(1) at O(‖α‖_1/‖T|ψ⟩‖) queries. " +
          "The paper gives a second ending the map does not draw: a hybrid implementation that estimates ⟨u_0|U†_k O U_k'|u_0⟩ by a Hadamard test and amplitude estimation, and performs the summation classically by Monte Carlo sampling.",
        theoryJa:
          "シミュレートしたユニタリ群は LCU で線形結合されます。prepare 対が求積の重みを補助レジスタに載せ、select オラクルが各ユニタリを選びますので、W は Σ_j c_j U_j を全ゼロの枝にブロック符号化します。" +
          "[[assumption: 「最後に補助レジスタをすべて測定し、結果がすべて 0 であれば、得られる状態が ODE の解 u(t) を近似的に符号化する」とされており、この結果が論文の各定理のいう成功フラグです。]] " +
          "一回の成功確率は (‖T|ψ⟩‖/‖α‖_1)^2 で、振幅増幅により O(‖α‖_1/‖T|ψ⟩‖) 回の問い合わせで Ω(1) まで引き上げられます。" +
          "論文には地図が描いていないもう一つの終わり方もあります。ハイブリッド実装で、⟨u_0|U†_k O U_k'|u_0⟩ を Hadamard テストと振幅推定で見積もり、総和は古典的なモンテカルロ標本抽出で取ります。",
      },
    },
    via: { "hamiltonian-recasting": "lchs-kernel-identity" },
    bypasses: ["quantum-linear-solve", "time-discretization"],
    entries: ["linear-combination-unitaries"],
    citations: [
      { title: "Linear combination of Hamiltonian simulation for nonunitary dynamics with optimal state preparation cost", authors: "Dong An, Jin-Peng Liu, Lin Lin", year: "2023", url: "https://arxiv.org/abs/2303.01029" },
    ],
  },
  {
    kind: "method",
    id: "lchs-improved-kernel",
    label: "LCHS with the improved kernel",
    labelJa: "改良カーネルによる LCHS",
    summary: "A family of identities expressing non-unitary evolution as a linear combination of unitary evolutions, built on the kernel $f(z) = 1/(C_β e^{(1+iz)^β})$ with $β ∈ (0,1)$ and $C_β = 2π e^{-2^β}$. The kernel decays at a near-exponential rate $e^{-c|k|^β}$, replacing the original Cauchy kernel's quadratic decay and exponentially enhancing accuracy.",
    summaryJa: "非ユニタリな発展をユニタリな発展の線形結合として表す恒等式の族で、カーネル $f(z) = 1/(C_β e^{(1+iz)^β})$（$β ∈ (0,1)$、$C_β = 2π e^{-2^β}$）に基づきます。カーネル自体が $e^{-c|k|^β}$ というほぼ指数的な速さで減衰するため、元の Cauchy カーネルの二次的な減衰を置き換え、精度を指数的に高めます。",
    realizes: "linear-ode-solve",
    refines: "lchs-route",
    refinesMark: "LCHS",
    refinesMarkJa: "LCHS",
    // **Folded (s121, W17) — the owner's model case, in his own words:** *"it
    // just doesn't make sense to put LCHS with improved kernel as a separate
    // process when we haven't researched the internals enough to put things
    // down that differentiate it from normal LCHS."* The pair draws ONE lane;
    // this node lives in the LCHS card's Refinements section, and everything
    // on it — page, URL, cost, hop note — survives untouched.
    sameInternalsAsParent: true,
    potentialPath:
      "The change lives upstream of any drawn hop — in the kernel, the quadrature feeding it, and the inner propagator per simulated evolution (this node's own hop note quotes the paper on exactly that). A granular decomposition of the recast and simulate steps would give those choices drawable homes; until that mapping is researched, this stays a section entry and a potential path.",
    potentialPathJa:
      "変更は描かれるどのホップよりも上流にあります。カーネル、それに与える求積、そして各時間発展の内部伝播子です（本ノードのホップ注記が論文自身の言葉を引用しています）。再定式化とシミュレーションの二工程を細分化して写像すれば、これらの選択に描ける置き場が生まれます。その研究が済むまでは、この項目は親カードの節にとどまり、潜在的な経路として記録されます。",
    conditions: "Carries the same requirement as the original LCHS: the Hermitian part $L(t) = (A(t)+A(t)^†)/2$ must be positive semi-definite throughout the interval. The authors describe this as the first approach enabling quantum algorithms to solve linear differential equations with both optimal state preparation cost and near-optimal scaling in matrix queries on all parameters, which is why it is the current reference point for this layer.",
    conditionsJa: "元の LCHS と同じ条件を引き継ぎます。すなわち、エルミート部 $L(t) = (A(t)+A(t)^†)/2$ が区間全体で半正定値でなければなりません。著者らはこれを、状態準備の最適な費用と、すべてのパラメータに関する行列クエリのほぼ最適なスケーリングを同時に達成した最初の手法と位置づけています。この層の現在の基準点とされるのはそのためです。",
    cost: "$\\tilde{O}( ((||u_0|| + ||b||_{L^1})/||u(T)||) \\alpha_A T (\\log(1/\\varepsilon))^{1+1/\\beta} )$ matrix queries, with $\\alpha_A \\geq \\max_t ||A(t)||$, $T$ the evolution time and $\\beta ∈ (0,1)$; this improves to $(\\log(1/\\varepsilon))^{1/\\beta}$ for time-independent $A$. State preparation costs $O( (||u_0|| + ||b||_{L^1})/||u(T)|| )$ queries, independent of both $T$ and $\\varepsilon$.",
    costJa: "行列クエリは $\\tilde{O}( ((||u_0|| + ||b||_{L^1})/||u(T)||) \\alpha_A T (\\log(1/\\varepsilon))^{1+1/\\beta} )$ です。ここで $\\alpha_A \\geq \\max_t ||A(t)||$、$T$ は発展時間、$\\beta ∈ (0,1)$ です。時間非依存な $A$ では $(\\log(1/\\varepsilon))^{1/\\beta}$ に改善されます。状態準備のクエリ数は $O( (||u_0|| + ||b||_{L^1})/||u(T)|| )$ で、$T$ にも $\\varepsilon$ にも依存しません。",
    // Same chain as `lchs-route`, and that is correct rather than a duplicate:
    // what this paper changes is the kernel inside the identity, which is a
    // parameter of `lchs-kernel-identity` and not a different construction.
    // `refines: lchs-route` declares it, the R13 checker reads the declaration
    // (session 106), and since s121 the fold flag above is what the owner's
    // ruling looks like in data: one drawn lane for the pair.
    steps: ["hamiltonian-recasting", "hamiltonian-simulation"],
    // **The same ending as LCHS, and its own paper says so.** Lemma 24 here is
    // structurally Lemma 6 there. Written out rather than left to the `refines`
    // link because it is this paper's own statement of it, not a copy of the
    // parent's — two papers each stating a fact is not the drift that rule
    // guards against. What the note does *not* restate is the difference; that
    // is this method's lede, one click away.
    hops: {
      "lchs-improved-kernel": {
        theory:
          "The ending is the parent's: \"postselecting the ancilla registers on 0 yields the desired state\", and \"for a constant-level success probability, we need to run O(‖c‖_1) rounds of the amplitude amplification\". " +
          "[[assumption: The state kept is the one where the ancilla registers read 0; everything else is discarded, and the repetition count is the price of that.]] " +
          "What this paper changes is upstream of here — the kernel and the composite Gaussian quadrature feeding it, and a truncated Dyson series for each evolution — not this stretch.",
        theoryJa:
          "終わり方は親と同じです。「補助レジスタを 0 で後選択すると目的の状態が得られる」「一定水準の成功確率を得るには O(‖c‖_1) 回の振幅増幅が必要である」と述べられています。" +
          "[[assumption: 残すのは補助レジスタが 0 を示した状態だけで、それ以外は捨てられます。反復回数はその代価です。]] " +
          "この論文が変えているのはここより上流、すなわちカーネルとそれに与える複合 Gauss 求積、そして各時間発展に用いる打ち切り Dyson 級数であって、この区間ではありません。",
      },
    },
    via: { "hamiltonian-recasting": "lchs-kernel-identity" },
    bypasses: ["quantum-linear-solve", "time-discretization"],
    entries: ["linear-combination-unitaries"],
    citations: [
      { title: "Quantum algorithm for linear non-unitary dynamics with near-optimal dependence on all parameters", authors: "Dong An, Andrew M. Childs, Lin Lin", year: "2023", url: "https://arxiv.org/abs/2312.03916" },
      { title: "Linear combination of Hamiltonian simulation for nonunitary dynamics with optimal state preparation cost", authors: "Dong An, Jin-Peng Liu, Lin Lin", year: "2023", url: "https://arxiv.org/abs/2303.01029" },
    ],
  },
  {
    kind: "method",
    id: "schrodingerisation",
    label: "Schrödingerisation (linear PDEs as Schrödinger equations)",
    labelJa: "Schrödinger 化（線形 PDE の Schrödinger 方程式への書き換え）",
    shortLabel: "Schrödingerisation",
    shortLabelJa: "Schrödinger 化",
    summary: "A simple change of variable — the warped phase transformation, which introduces one extra variable — recasts any linear PDE or ODE system into a system of Schrödinger equations in real time, which ordinary Hamiltonian simulation then runs. The original solution is recovered from the auxiliary dimension.",
    summaryJa: "変数を一つ追加する warped phase 変換という簡単な変数変換により、任意の線形偏微分方程式や常微分方程式系を、実時間の Schrödinger 方程式系に書き換えます。これは通常のハミルトニアンシミュレーションでそのまま実行でき、元の解は追加した補助次元から復元します。",
    realizes: "linear-ode-solve",
    conditions: "Stated for general linear partial differential equations: unlike LCHS there is no positive-semidefiniteness requirement in order to form the Schrödinger system, and that is the structural difference between the two. The cost reappears at recovery: the original solution is read back from the warped variable, either as $u(t,x) = ∫_0^∞ w(t,x,p) dp$ or pointwise as $u(t,x) = e^{p*} w(t,x,p*)$ for a chosen $p* > 0$. Worked examples include the heat, convection, Fokker-Planck, linear Boltzmann and Black-Scholes equations, with extensions to the Vlasov-Fokker-Planck equation and to the Liouville representation equation for nonlinear ODEs — which is how a nonlinear problem reaches this method. The companion technical paper does prove gate-complexity theorems — Theorem 3.1 for the general method, recorded under cost — but in step sizes and qubit counts whose $\\varepsilon$-dependence is left to the discretisation scheme, so no like-for-like count against the LCHS figures is given here.",
    conditionsJa: "一般の線形偏微分方程式について述べられています。LCHS と異なり、Schrödinger 方程式系を作る段階では半正定値性の要求がありません。これが両者の構造的な違いです。費用は復元の段階で現れます。元の解は、warped 変数から $u(t,x) = ∫_0^∞ w(t,x,p) dp$ として、あるいは $p* > 0$ を選んで $u(t,x) = e^{p*} w(t,x,p*)$ として取り出します。扱われている例には、熱方程式、移流方程式、Fokker-Planck 方程式、線形 Boltzmann 方程式、Black-Scholes 方程式が含まれ、Vlasov-Fokker-Planck 方程式や、非線形常微分方程式の Liouville 表現方程式への拡張も示されています。非線形問題がこの手法に到達する経路がまさにこれです。技術詳細版の論文はゲート計算量の定理を証明しています（一般の手法については定理 3.1、cost 欄に記録）。ただし格子幅と量子ビット数による表現で、$\\varepsilon$ 依存性は離散化スキームに委ねられていますので、LCHS の数値と同一条件で比較した数値はここでは示しません。",
    // `cost` authored session 123, and NEXT.md's finding stands for the
    // PRIMARY paper: arXiv:2212.13969's abstract states no complexity at all,
    // so this node's previously empty cost was a correct empty ON THAT SOURCE.
    // What changed is the COMPANION this node already cites: 2212.14703
    // ("technical details", PRA 108, 032603) proves gate-complexity theorems.
    // Basis of the read: the ar5iv render's full text swept programmatically —
    // all seven "Theorem n.m." statements extracted (every one is a
    // gate-complexity theorem; none was skipped) plus every occurrence of
    // "complexit-" with surrounding context, and Theorem 3.1 read in full with
    // its proof. Not a linear cover-to-cover read; the sweep is complete for
    // cost-shaped claims by construction. The register row for 2212.14703
    // moves abstract → full-text with this edit; 2212.13969 stays "abstract".
    cost: "The companion technical paper states the general bound as Theorem 3.1: gate complexity $N_{Gates} = (m_d + m_p) \\tilde{O}( s(A) ||A||_{max} / \\Delta p ) + O( m_p \\log m_p )$ for the spatially discretised linear system $\\partial_t u = -A u$, where $s(A)$ is the sparsity of $A$, $m_d$ and $m_p$ count the system and auxiliary-register qubits, and $\\Delta p$ is the auxiliary variable's grid step; when $H_1$ diagonalises in the momentum basis and $H_2$ is diagonal this improves to $T/\\Delta t \\cdot O(d m \\log m + m_p \\log m_p)$. Per-equation prices follow the same pattern — heat (Theorem 2.1), convection (Theorem 2.2), Black-Scholes (Theorem 4.1), linear Boltzmann (Theorem 4.3). All of these are deliberately stated in step sizes and qubit counts: the paper says the $\\varepsilon$-dependence \"is determined by the particular scheme one wishes to use\", which is why no single $\\varepsilon$-form figure is quoted here.",
    costJa: "技術詳細版の論文は、一般の評価を定理 3.1 として述べています。空間離散化した線形系 $\\partial_t u = -A u$ に対するゲート計算量は $N_{Gates} = (m_d + m_p) \\tilde{O}( s(A) ||A||_{max} / \\Delta p ) + O( m_p \\log m_p )$ です。ここで $s(A)$ は $A$ の疎性、$m_d$ と $m_p$ は系と補助レジスタの量子ビット数、$\\Delta p$ は補助変数の格子幅です。$H_1$ が運動量基底で対角化でき $H_2$ が対角行列の場合には $T/\\Delta t \\cdot O(d m \\log m + m_p \\log m_p)$ に改善されます。方程式ごとの評価も同じ形で与えられています。熱方程式は定理 2.1、移流方程式は定理 2.2、Black-Scholes 方程式は定理 4.1、線形 Boltzmann 方程式は定理 4.3 です。これらはいずれも意図的に格子幅と量子ビット数で述べられています。論文は $\\varepsilon$ 依存性について「用いる離散化スキームによって定まる」と明言していますので、単一の $\\varepsilon$ 表示の数値はここでは示しません。",
    steps: ["hamiltonian-recasting", "hamiltonian-simulation"],
    // **Nothing like LCHS's ending, which is why there is no shared slot.** The
    // inverse Fourier transform on the auxiliary register has no LCHS analogue at
    // all, and the projector is a half-line rather than an all-zeros flag. Two
    // endings this different under one capability would be a claim the sources do
    // not make — `plans/atlas-revamp/W11-readout-stretch.md` has the comparison.
    hops: {
      schrodingerisation: {
        theory:
          "\"By applying an inverse quantum Fourier transform F_p^{-1}, with respect to p, onto the second register we obtain |w(t)⟩\", and the solution is then recovered by restricting to p > 0 — as the integral u(t,x) = ∫_0^∞ w(t,x,p) dp, or on the state by projecting onto 1 ⊗ Σ_{k=N/2}^{N} |k⟩⟨k|. " +
          "[[assumption: Only the p > 0 half-line carries u, so what survives is what that projection keeps: \"a simple projection retrieves |u(t)⟩ with probability (‖u(t)‖‖exp(−p)‖/‖w(t)‖)^2 ∼ N(‖u(t)‖/‖w(t)‖)^2\".]] " +
          "Amplitude amplification with the oracle Q = −S_w S_p raises that to ∼√N‖u(t)‖/‖w(t)‖, at Õ(‖w(t)‖/(√N‖u(t)‖)) queries to Q. The paper also allows a pointwise recovery instead: choose any p* > 0 and take u(t,x) = e^{p*} w(t,x,p*).",
        theoryJa:
          "「第二レジスタに対して p に関する逆量子 Fourier 変換 F_p^{-1} を施すと |w(t)⟩ が得られる」とされ、解はそこから p > 0 に制限して復元されます。積分としては u(t,x) = ∫_0^∞ w(t,x,p) dp、状態としては 1 ⊗ Σ_{k=N/2}^{N} |k⟩⟨k| への射影です。" +
          "[[assumption: u を担うのは p > 0 の半直線だけですので、残るのはその射影が残したものです。「単純な射影は確率 (‖u(t)‖‖exp(−p)‖/‖w(t)‖)^2 ∼ N(‖u(t)‖/‖w(t)‖)^2 で |u(t)⟩ を取り出す」とされています。]] " +
          "オラクル Q = −S_w S_p による振幅増幅はこれを ∼√N‖u(t)‖/‖w(t)‖ まで引き上げ、Q への問い合わせは Õ(‖w(t)‖/(√N‖u(t)‖)) 回です。論文は各点での復元も認めています。任意の p* > 0 を選び u(t,x) = e^{p*} w(t,x,p*) とするやり方です。",
      },
    },
    via: { "hamiltonian-recasting": "warped-phase-transformation" },
    bypasses: ["quantum-linear-solve", "time-discretization"],
    citations: [
      { title: "Quantum simulation of partial differential equations via Schrodingerisation", authors: "Shi Jin, Nana Liu, Yue Yu", year: "2022", url: "https://arxiv.org/abs/2212.13969" },
      { title: "Quantum simulation of partial differential equations via Schrodingerisation: technical details", authors: "Shi Jin, Nana Liu, Yue Yu", year: "2022", url: "https://arxiv.org/abs/2212.14703" },
    ],
  },
  {
    // Authored session 106 on the owner's ruling (OWNER_TODO §2, "author the
    // slot"). `lchs-route` and `schrodingerisation` drew the same chain and must
    // not collapse — LCHS needs the Hermitian part positive semi-definite across
    // the interval and the warped phase transformation needs nothing of the kind,
    // which is different mathematics, not different wording. What was missing was
    // never a distinguishing label: it was this step. Both routes were filed as
    // handing a non-Hermitian generator straight to a simulator, and no route
    // does that, because a simulator runs e^{-iHt} and H has to be Hermitian.
    kind: "capability",
    id: "hamiltonian-recasting",
    label: "Recast a non-Hermitian generator as Hamiltonian evolution",
    labelJa: "非エルミート生成子をハミルトニアン発展に書き換える",
    shortLabel: "Recast as Hamiltonian evolution",
    shortLabelJa: "ハミルトニアン発展への書き換え",
    summary: "Given a generator $A(t)$ whose evolution is not unitary, produce a Hermitian generator — or a quadrature-indexed family of them — on a space at least as large, whose unitary evolution reproduces the original dynamics, together with the map that recovers the original solution. Both halves are required: a construction that reaches a Hamiltonian and cannot get back is not a route.",
    summaryJa: "発展がユニタリでない生成子 $A(t)$ が与えられたとき、元より小さくない空間の上に、そのユニタリな発展が元の力学を再現するエルミート生成子（あるいは求積変数で添字づけられたその族）を作り、あわせて元の解を復元する写像を与えます。この二つは両方が必要です。ハミルトニアンにたどり着いても戻れない構成は、経路ではありません。",
    contract: {
      from: "linear-ivp",
      to: "hamiltonian-surrogate",

      takes: "The generator A(t) with no Hermiticity assumed, the interval [0,T], and an error tolerance ε.",
      takesJa: "エルミート性を仮定しない生成子 A(t)、区間 [0,T]、誤差許容度 ε。",
      returns: "A Hermitian generator or a family of them, the enlargement of the space that carrying them cost, and the map that reads the original solution back — with the weight that map applies stated, because that weight is where the non-unitarity was moved to rather than removed.",
      returnsJa: "エルミート生成子またはその族、それを担うために要した空間の拡大、そして元の解を読み戻す写像。あわせて、その写像がかける重みも示します。非ユニタリ性は取り除かれたのではなくこの重みに移されているためです。",
    },
    whyALayer: "Every route that reaches a simulator without forming a linear system has to pass through here, and the two ways through it demand different things of $A$ — a precondition, not a constant. LCHS requires the Hermitian part L(t) = (A(t)+A(t)^†)/2 to be positive semi-definite across the whole interval, and buys unitarity with a quadrature: the propagator becomes a kernel-weighted combination of unitary evolutions, and how fast the kernel decays is how many of them there are. The warped phase transformation requires nothing of the spectrum and buys unitarity with a dimension: one extra variable turns the system into a Schrödinger equation, and the price reappears at recovery, where the answer is read back out of that variable under a factor that grows with the decay being undone. Neither is a special case of the other. A cost model that says \"reduce to Hamiltonian simulation\" without saying which of these it used has not stated its precondition, and the precondition is the part that decides whether the route applies at all. This is also the slot that says which routes do *not* need it: the Koopman-von Neumann lift arrives holding a generator that is already Hermitian, so it goes straight to the simulator and this layer is not on its path.",
    whyALayerJa: "線形系を組まずにシミュレータに到達する経路は、すべてここを通ります。そして、ここを通る二つの道は $A$ に対して異なるものを要求します。定数の違いではなく前提条件の違いです。LCHS はエルミート部 L(t) = (A(t)+A(t)^†)/2 が区間全体で半正定値であることを要求し、ユニタリ性を求積によって購います。伝播子はユニタリな発展のカーネル重み付き結合になり、カーネルの減衰の速さがその項数を決めます。warped phase 変換はスペクトルについて何も要求せず、ユニタリ性を次元によって購います。変数をひとつ加えると系は Schrödinger 方程式になり、費用は復元の段階で、打ち消そうとしている減衰とともに増大する係数として現れます。どちらも他方の特別な場合ではありません。どちらを使ったかを言わずに「ハミルトニアンシミュレーションに帰着する」とだけ書いたコストモデルは、前提条件を述べていません。そしてその前提条件こそが、経路が適用できるかどうかを決めます。この層はまた、どの経路がここを必要としないかも示します。Koopman–von Neumann による持ち上げは、すでにエルミートな生成子を手にして到達するため、そのままシミュレータに進み、この層はその経路上にありません。",
  },
  {
    kind: "method",
    id: "lchs-kernel-identity",
    label: "Kernel-weighted combination of unitary propagators",
    labelJa: "ユニタリ伝播子のカーネル重み付き結合",
    shortLabel: "LCHS identity",
    shortLabelJa: "LCHS 恒等式",
    summary: "Split $A(t)$ into its Hermitian and anti-Hermitian parts, $A = L + iH$, and write the non-unitary propagator as a kernel-weighted integral over the unitary propagators generated by the one-parameter family $kL(t) + H(t)$. Every member of that family is Hermitian by construction, so each is an ordinary Hamiltonian simulation problem and the combination is an LCU over them.",
    summaryJa: "$A(t)$ をエルミート部と反エルミート部に分けて $A = L + iH$ と書き、非ユニタリな伝播子を、1 パラメータ族 $kL(t) + H(t)$ が生成するユニタリ伝播子についてのカーネル重み付き積分として表します。この族の各要素は構成上エルミートですから、それぞれが通常のハミルトニアンシミュレーション問題であり、その結合は LCU になります。",
    realizes: "hamiltonian-recasting",
    conditions: "Requires $L(t) = (A(t)+A(t)^†)/2 ⪰ 0$ throughout the interval; without a shift the identity does not apply when the Hermitian part has a negative eigenvalue anywhere on $[0,T]$. That restriction is the whole of what this construction demands, and it is a real one — it is the linear-layer analogue of Carleman's dissipativity requirement. What it does not require is anything the alternatives do: no dilated linear system, and no spectral mapping theorem of the kind QSVT-based approaches rest on.",
    conditionsJa: "区間全体で $L(t) = (A(t)+A(t)^†)/2 ⪰ 0$ であることを要求します。シフトを入れない限り、$[0,T]$ のどこかでエルミート部が負の固有値をもつ場合、この恒等式は適用できません。この構成が要求するのはこれだけですが、これは実際の制約であり、線形層における Carleman の散逸条件に相当します。一方で、代替手法が必要とするものは不要です。拡大された線形系も、QSVT 系の手法が依拠するスペクトル写像定理も用いません。",
    cost: "The count this construction hands downstream is the number of unitary propagators surviving truncation and discretization of the $k$-integral, and that number is set by how fast the kernel decays — which is why the kernel is the thing later work changed rather than the identity. The original Cauchy kernel $1/(\\pi(1+k²))$ decays quadratically; An, Childs and Lin's $f(z) = 1/(C_\\beta e^{(1+iz)^\\beta})$ decays at a near-exponential $e^{-c|k|^\\beta}$. The end-to-end query bounds those two produce are stated on `lchs-route` and `lchs-improved-kernel`, where the papers state them, and are not restated here.",
    costJa: "この構成が下流に渡す個数は、$k$ 積分を打ち切り離散化したあとに残るユニタリ伝播子の数であり、それはカーネルの減衰の速さで決まります。後続の研究が変えたのが恒等式ではなくカーネルであったのは、このためです。元の Cauchy カーネル $1/(\\pi(1+k²))$ の減衰は二次的であり、An・Childs・Lin の $f(z) = 1/(C_\\beta e^{(1+iz)^\\beta})$ はほぼ指数的な $e^{-c|k|^\\beta}$ で減衰します。両者が与える端から端までのクエリ評価は、論文がそれを述べている `lchs-route` と `lchs-improved-kernel` に記してあり、ここでは再掲しません。",
    steps: [],
    atomic: true,
    entries: ["linear-combination-unitaries"],
    citations: [
      { title: "Linear combination of Hamiltonian simulation for nonunitary dynamics with optimal state preparation cost", authors: "Dong An, Jin-Peng Liu, Lin Lin", year: "2023", url: "https://arxiv.org/abs/2303.01029" },
      { title: "Quantum algorithm for linear non-unitary dynamics with near-optimal dependence on all parameters", authors: "Dong An, Andrew M. Childs, Lin Lin", year: "2023", url: "https://arxiv.org/abs/2312.03916" },
    ],
  },
  {
    kind: "method",
    id: "warped-phase-transformation",
    label: "Warped phase transformation",
    labelJa: "warped phase 変換",
    summary: "Introduce one extra variable and change to it, so that a linear ODE or PDE system becomes a system of Schrödinger equations in real time — which a simulator runs as it stands. The original solution lives in the auxiliary dimension and is recovered from it afterwards.",
    summaryJa: "変数をひとつ追加してその変数へ移ることで、線形の常微分方程式系や偏微分方程式系を、実時間の Schrödinger 方程式系に変えます。これはシミュレータがそのまま実行できます。元の解は追加した補助次元の中にあり、あとからそこで復元します。",
    realizes: "hamiltonian-recasting",
    conditions: "Unlike the LCHS identity there is no positive-semidefiniteness requirement in order to form the Schrödinger system, and that is the structural difference between the two ways through this slot. What it does require is the extra dimension: the auxiliary variable is continuous, so it has to be truncated and discretized, and the recovery is not free. The original solution is read back either as $u(t,x) = ∫_0^∞ w(t,x,p) dp$ or pointwise as $u(t,x) = e^{p*} w(t,x,p*)$ for a chosen $p* > 0$, and that $e^{p*}$ is the factor the non-unitarity was moved into.",
    conditionsJa: "LCHS 恒等式とは異なり、Schrödinger 方程式系を作る段階で半正定値性の要求はありません。これがこの層を通る二つの道の構造的な違いです。代わりに必要になるのが追加の次元です。補助変数は連続なので、打ち切りと離散化が要り、復元も無償ではありません。元の解は $u(t,x) = ∫_0^∞ w(t,x,p) dp$ として、あるいは $p* > 0$ を選んで $u(t,x) = e^{p*} w(t,x,p*)$ として読み戻します。この $e^{p*}$ こそが、非ユニタリ性の移された先です。",
    cost: "Jin, Liu and Yu present the transformation and worked examples — the heat, convection, Fokker-Planck, linear Boltzmann and Black-Scholes equations, with extensions to Vlasov-Fokker-Planck and to the Liouville representation of nonlinear ODEs — rather than a single unified query-complexity theorem. So no like-for-like count against the LCHS figures is given here, and the absence is the paper's shape rather than an omission at this desk.",
    costJa: "Jin・Liu・Yu は、統一されたひとつのクエリ計算量の定理ではなく、変換と適用例を示しています。熱方程式、移流方程式、Fokker-Planck 方程式、線形 Boltzmann 方程式、Black-Scholes 方程式であり、Vlasov-Fokker-Planck 方程式および非線形常微分方程式の Liouville 表現への拡張も含みます。したがって LCHS の数値と同一条件で比較した数値はここには示しません。この欠落は当方の手落ちではなく、原論文の形です。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Quantum simulation of partial differential equations via Schrodingerisation", authors: "Shi Jin, Nana Liu, Yue Yu", year: "2022", url: "https://arxiv.org/abs/2212.13969" },
      { title: "Quantum simulation of partial differential equations via Schrodingerisation: technical details", authors: "Shi Jin, Nana Liu, Yue Yu", year: "2022", url: "https://arxiv.org/abs/2212.14703" },
    ],
  },
  {
    kind: "capability",
    id: "time-discretization",
    label: "Choose a time discretization or propagator approximation",
    labelJa: "時間離散化・伝播子近似を選ぶ",
    shortLabel: "Discretize time or the propagator",
    shortLabelJa: "時間離散化・伝播子近似",
    summary: "Reduce continuous evolution over $[0,T]$ to a finite algebraic object — a banded linear system, a product of step propagators, or a spectral coefficient system — with a stated truncation error. When a linear system is formed, a conditioning bound is stated with it.",
    summaryJa: "$[0,T]$ 上の連続的な発展を、有限の代数的対象（帯行列の線形系、ステップ伝播子の積、スペクトル係数の方程式系）に落とし、打ち切り誤差を明示します。線形系を組む場合は、条件数の評価もあわせて示します。",
    contract: {
      from: "linear-ivp",
      to: "linear-system",

      takes: "The generator A(t), the interval [0,T], an error tolerance ε, and a target algebraic form.",
      takesJa: "生成子 A(t)、区間 [0,T]、誤差許容度 ε、目標とする代数的形式。",
      returns: "The discrete object, its truncation-error bound, and its conditioning bound.",
      returnsJa: "離散化された対象、その打ち切り誤差評価、および条件数の評価。",
    },
    whyALayer: "The choice fixes both the $\\varepsilon$-scaling and the condition number the downstream solver must pay. The same ODE encoded by a finite-difference scheme and by a truncated Taylor expansion of the propagator differs exponentially in its $\\varepsilon$-dependence. Treating discretization as an implementation detail hides the dominant cost term.",
    whyALayerJa: "この選択が、$\\varepsilon$ 依存性と、下流のソルバーが払う条件数の両方を決めます。同じ方程式でも、差分スキームで符号化するか伝播子の Taylor 打ち切りで符号化するかで、$\\varepsilon$ 依存性は指数的に変わります。離散化を実装の細部として扱うと、支配的な費用項が見えなくなります。",
  },
  {
    kind: "method",
    id: "forward-euler",
    label: "Forward (explicit) Euler",
    labelJa: "前進（陽的）Euler 法",
    summary: "First-order explicit stepping, $u_{k+1} = (I + hA)u_k + h b_k$, assembled into a banded all-at-once linear system. Liu et al. use it inside the Carleman route because its structure is simple enough to bound explicitly.",
    summaryJa: "一次精度の陽的な時間刻み $u_{k+1} = (I + hA)u_k + h b_k$ を、帯行列の一括線形系にまとめます。Liu らが Carleman 経路の内部でこれを用いているのは、構造が単純で明示的に評価できるためです。",
    realizes: "time-discretization",
    conditions: "Explicit, and therefore conditionally stable: a stiff generator forces a small step $h$ and hence many steps, inflating the dimension of the assembled system. First-order local accuracy is what leaves the surrounding algorithm with $1/\\varepsilon$ rather than $\\log(1/\\varepsilon)$ precision dependence, because the number of steps needed to reach accuracy $\\varepsilon$ is fixed by the order of the local truncation error. Liu et al. bound the condition number of the resulting Carleman plus forward-Euler system; the constant is in the paper and is not quoted here.",
    conditionsJa: "陽的であるため条件付き安定です。剛性の強い生成子では刻み幅 $h$ を小さくせざるをえず、ステップ数が増えて組み立てた線形系の次元が膨らみます。一次精度であることが、周囲のアルゴリズムの精度依存性を $\\log(1/\\varepsilon)$ ではなく $1/\\varepsilon$ にとどめます。精度 $\\varepsilon$ に達するのに必要なステップ数が、局所打ち切り誤差の次数で決まるからです。Liu らは Carleman 化と前進 Euler で得られる線形系の条件数を評価していますが、その定数は論文にあり、ここでは引用しません。",
    steps: [],
    atomic: true,
    // **The first hop note, and like the first `example` it is a transcription.**
    // The owner moved approximations and assumptions inside the mathematics as
    // marks (`theory-marks.ts`), and a marked path with no instance anywhere has
    // never been drawn — so one hop is authored here from sentences already on
    // this record, and nothing is worked out:
    //
    // - the recurrence and the assembly are `summary`, verbatim;
    // - the approximation is `conditions` — *"First-order local accuracy is what
    //   leaves the surrounding algorithm with 1/ε rather than log(1/ε) precision
    //   dependence"*;
    // - the assumption is `conditions` — *"Explicit, and therefore conditionally
    //   stable: a stiff generator forces a small step h and hence many steps,
    //   inflating the dimension of the assembled system."*
    //
    // The key is this method's own id because the route is one segment no slot
    // covers — `steps` is empty. **These sentences and this note move together**;
    // a note keeping a claim the record has dropped is the drift a second copy
    // always has, and this comment is where an editor finds out there is one.
    hops: {
      "forward-euler": {
        theory:
          "The steps are u_{k+1} = (I + hA)u_k + h b_k, assembled into a banded all-at-once linear system. " +
          "[[approximation: First-order local accuracy, which is what leaves the surrounding algorithm with 1/ε rather than log(1/ε) precision dependence.]] " +
          "[[assumption: Explicit, and therefore conditionally stable — a stiff generator forces a small step h and hence many steps, inflating the dimension of the assembled system.]]",
        theoryJa:
          "各ステップは u_{k+1} = (I + hA)u_k + h b_k で、これを帯行列の一括線形系にまとめます。" +
          "[[approximation: 一次精度であることが、周囲のアルゴリズムの精度依存性を log(1/ε) ではなく 1/ε にとどめます。]] " +
          "[[assumption: 陽的であるため条件付き安定です。剛性の強い生成子では刻み幅 h を小さくせざるをえず、ステップ数が増えて組み立てた線形系の次元が膨らみます。]]",
      },
    },
    citations: [
      { title: "Efficient quantum algorithm for dissipative nonlinear differential equations", authors: "Jin-Peng Liu, Herman Øie Kolden, Hari K. Krovi, Nuno F. Loureiro, Konstantina Trivisa, Andrew M. Childs", year: "2020", url: "https://arxiv.org/abs/2011.03185" },
    ],
  },
  {
    kind: "method",
    id: "backward-euler",
    label: "Backward (implicit) Euler",
    labelJa: "後退（陰的）Euler 法",
    summary: "First-order implicit stepping: each step solves $(I - hA)u_{k+1} = u_k + h b_{k+1}$. $A$-stability is the classical reason to prefer it for stiff generators, since it removes the explicit method's step-size restriction.",
    summaryJa: "一次精度の陰的な時間刻みで、各ステップは $(I - hA)u_{k+1} = u_k + h b_{k+1}$ を解きます。剛性の強い生成子に対して古典的にこれが選ばれるのは $A$ 安定だからで、陽的手法の刻み幅の制約がなくなります。",
    realizes: "time-discretization",
    conditions: "On a quantum computer the trade differs from the classical one: each implicit step is itself a linear solve, so implicit stepping does not remove the quantum-linear-solve layer below — it invokes it repeatedly, or folds the whole trajectory into one larger block system and hands that over instead. Written out step by step it is one solve per time step, $T/h$ of them to reach time $T$, and each step's solve consumes the previous step's output as its right-hand side, so the chain is a quantum state passed forward and never a number read out. That is what makes the repetition expensive rather than merely long: a quantum linear solve succeeds only on a flagged branch, and the flags multiply down the chain, so the amplification bill compounds with the number of steps. Folding the trajectory into one banded system — which is what the all-at-once encodings do, and what the deliverable of this layer is — is how the published treatments spend that once instead of $T/h$ times. Still first order, so the precision dependence stays polynomial in $1/\\varepsilon$. The nearest published quantum treatment, by Dong, Li and Xue, encodes diagonal Padé approximations of the matrix exponential into a large, block-sparse linear system solved via a quantum linear system algorithm; backward Euler is the subdiagonal $(0,1)$ approximant and is not among the schemes they analyse. No primary quantum source verified here gives an end-to-end complexity or conditioning bound for a pure backward-Euler encoding.",
    conditionsJa: "量子計算機上でのトレードオフは古典の場合と異なります。各陰的ステップ自体が線形ソルバーの呼び出しであるため、陰的な時間刻みは下層の量子線形ソルバーを取り除きません。繰り返し呼び出すか、軌道全体をより大きなブロック系に畳み込んで、それを下層に渡すかのどちらかになります。ステップごとに書き下せば各時間ステップにつき線形ソルバーを 1 回、時刻 $T$ に達するまでに $T/h$ 回です。各ステップの線形ソルバーは前のステップの出力をそのまま右辺として受け取りますので、この連鎖は量子状態を送り続けるものであり、途中で数値を読み出すわけではありません。反復が単に長いだけでなく高価になるのはこのためです。量子線形ソルバーはフラグの立った枝でのみ成功しますので、そのフラグがステップ数だけ掛け合わされ、増幅の代価が累積します。軌道全体をひとつの帯行列系に畳み込む一括符号化は、この代価を $T/h$ 回ではなく 1 回で済ませるための手立てであり、この層が引き渡すのはまさにその系です。依然として一次精度ですので、精度依存性は $1/\\varepsilon$ の多項式のままです。最も近い公表された量子的な扱いは Dong・Li・Xue によるもので、行列指数の対角 Padé 近似を大きなブロック疎線形系に符号化し、量子線形システムアルゴリズムで解きます。ただし後退 Euler 法は劣対角の $(0,1)$ 近似であり、そこで解析されている手法には含まれません。後退 Euler 法のみを用いた符号化について、端から端までの計算量や条件数の評価を与える一次資料は、今回の確認では見つかっていません。",
    steps: [],
    // **Atomic, and the removal of the step is the owner's ruling.** Session 118,
    // verbatim: *"Things like Crank-nicholson needing quantum linear solve as an
    // ingredient doesn't make sense at all — this is not how i want an iterator
    // to be visualized."* Measured before it was removed: `time-discretization`
    // is the **only** capability that produces `linear-system` and
    // `quantum-linear-solve` is the **only** one that consumes it, and four
    // parent routes already walk the two as consecutive stages. So the step drew
    // the same edge twice — once forwards along the spine, once sideways as a
    // stub — and `routeOf` filed it as a *feed* only because this method is still
    // holding `linear-ivp` when the walk reaches it. A feed is defined as
    // something that does not change what the route carries; this one changes it
    // into the exit state one layer up, which is the definition of the next
    // stage. The slot's own contract settles it: `linear-ivp -> linear-system`,
    // returning "the discrete object, its truncation-error bound, and its
    // conditioning bound". Solving that system is out of scope by the contract,
    // and a sibling in this slot already says so in prose —
    // `truncated-dyson-series`: *"solving the system those rows make up is the
    // layer below."*
    //
    // `atomic` rather than left undecomposed, on `forward-euler`'s precedent
    // (identical structure, same recurrence, same deliverable): without it this
    // record joins the "not yet decomposed" queue, which would read as a corpus
    // gap where there is none.
    atomic: true,
    // **The first `example`, and it is a transcription rather than a new claim.**
    // The owner asked for an Example section on all 63 methods and, pushed back
    // on the size of that, added: *"pseudo code could definitely be easy enough
    // as a first pass."* This is that first pass, and every line of it restates
    // a sentence already on this record:
    //
    // - the recurrence is `summary`, verbatim — *"each step solves
    //   (I - hA)u_{k+1} = u_k + h b_{k+1}"*;
    // - the loop bound is `conditions` — *"one solve per time step, T/h of them
    //   to reach time T"*;
    // - the note on the solve is `conditions` too — *"each step's solve consumes
    //   the previous step's output as its right-hand side, so the chain is a
    //   quantum state passed forward and never a number read out."*
    //
    // Both of those sentences were `repeats.count` and `repeats.note` until
    // session 118 removed the step they were keyed to; they moved into
    // `conditions` in the same commit rather than being dropped, which is why
    // this listing still has a source for every line.
    //
    // Nothing here was worked out. **Those three sentences and this block move
    // together**: a listing that keeps a recurrence the summary has stopped
    // claiming is the drift a second copy always has, and this comment is where
    // an editor finds out that there is a second copy.
    //
    // `text` is deliberately absent. Prose describing a run somebody actually
    // did is not something this record has, and inventing one to fill the
    // section would be the exact failure the gap rule exists to prevent.
    example: {
      pseudocode: [
        "given  A, b, u_0, step size h, horizon T",
        "",
        "for k = 0 \u2026 T/h \u2212 1:",
        "    # one quantum linear solve; being implicit does not remove the layer",
        "    solve (I \u2212 hA) u_{k+1} = u_k + h b_{k+1}",
        "    # u_{k+1} is a quantum state handed to the next step, never read out",
        "",
        "return u_{T/h}",
      ].join("\n"),
    },
    // **A second hop note, and it marks one kind and not two.** Its approximation
    // is `summary` and `conditions` — *"First-order implicit stepping"*, *"Still
    // first order, so the precision dependence stays polynomial in 1/ε"*. There
    // is deliberately no `[[assumption: …]]`: nothing on this record states a
    // condition this hop needs. A-stability is a *property* of the scheme rather
    // than something it assumes, and marking it as one to make the pair look
    // complete would be the invented claim the gap rule exists to prevent. A hop
    // that marks one thing is the ordinary case, and this is the record that
    // proves the legend draws one entry rather than always two.
    hops: {
      "backward-euler": {
        theory:
          "Each step solves (I − hA)u_{k+1} = u_k + h b_{k+1}, once per time step — T/h of them to reach time T. " +
          "[[approximation: First-order implicit stepping, so the precision dependence stays polynomial in 1/ε.]]",
        theoryJa:
          "各ステップは (I − hA)u_{k+1} = u_k + h b_{k+1} を解きます。各時間ステップにつき 1 回、時刻 T に達するまでに T/h 回です。" +
          "[[approximation: 一次精度の陰的な時間刻みですので、精度依存性は 1/ε の多項式のままです。]]",
      },
    },
    citations: [
      { title: "A quantum algorithm for linear autonomous differential equations via Padé approximation", authors: "Dekuan Dong, Yingzhou Li, Jungong Xue", year: "2025", url: "https://arxiv.org/abs/2504.06948" },
    ],
  },
  {
    kind: "method",
    id: "trapezoidal-rule",
    label: "Trapezoidal rule (Crank-Nicolson)",
    labelJa: "台形則（Crank-Nicolson 法）",
    summary: "Second-order implicit stepping that averages the generator at the two ends of each step, and is $A$-stable. As a rational approximation of $e^{hA}$ it is the $(1,1)$ diagonal Padé approximant.",
    summaryJa: "各ステップの両端で生成子を平均する二次精度の陰的な時間刻みで、$A$ 安定です。$e^{hA}$ の有理近似として見ると、$(1,1)$ 型の対角 Padé 近似にあたります。",
    realizes: "time-discretization",
    conditions: "Second order at the same stability class as backward Euler, so it is more accurate at equal step size, but the implicit solve does not disappear on a quantum computer — it is the layer below, and what this one hands down to it is the assembled system. Second order buys a larger $h$ at the same accuracy, so written out step by step the loop turns fewer times than backward Euler's; it is the same loop, one linear solve per turn with the previous turn's state as its right-hand side. Being A-stable removes the step-size restriction, not the repetition. Second order still leaves a polynomial dependence on $1/\\varepsilon$; only propagator-series or spectral discretizations reach $\\log(1/\\varepsilon)$. Dong, Li and Xue encode diagonal Padé approximations of the matrix exponential into a large, block-sparse linear system solved via a quantum linear system algorithm, but state no complexity for the $(1,1)$ case specifically.",
    conditionsJa: "後退 Euler 法と同じ安定性クラスで二次精度ですので、同じ刻み幅ならより正確です。ただし量子計算機上でも陰的な線形ソルバーの呼び出しは消えません。それは下層にあたり、この層が引き渡すのは組み上げた系そのものです。二次精度であるぶん同じ精度なら $h$ を大きく取れますので、ステップごとに書き下せば反復回数は後退 Euler 法より少なくなります。しかし反復そのものは同じで、1 ステップにつき線形ソルバーを 1 回、前のステップの状態を右辺として呼びます。A 安定であることは刻み幅の制約を取り除きますが、反復を取り除くわけではありません。二次精度でも $1/\\varepsilon$ への多項式依存は残り、$\\log(1/\\varepsilon)$ に達するのは伝播子の級数近似かスペクトル法だけです。Dong・Li・Xue は行列指数の対角 Padé 近似を大きなブロック疎線形系に符号化し、量子線形システムアルゴリズムで解いていますが、$(1,1)$ の場合に限った計算量は示していません。",
    // Atomic for the same reason and by the same ruling as `backward-euler`;
    // the long comment on that record's `steps` is the one place it is argued.
    steps: [],
    atomic: true,
    citations: [
      { title: "A quantum algorithm for linear autonomous differential equations via Padé approximation", authors: "Dekuan Dong, Yingzhou Li, Jungong Xue", year: "2025", url: "https://arxiv.org/abs/2504.06948" },
    ],
  },
  {
    kind: "method",
    id: "truncated-taylor-propagator",
    label: "Truncated Taylor series of the propagator",
    labelJa: "伝播子の Taylor 級数打ち切り",
    shortLabel: "Truncated Taylor propagator",
    shortLabelJa: "Taylor 打ち切り伝播子",
    summary: "Rather than approximating the derivative, approximate the propagator $e^{hA}$ itself by $k$ Taylor terms and encode those terms as extra rows of a sparse linear system. Truncation error falls factorially in $k$, so accuracy is bought by adding rows rather than by shrinking $h$ and lengthening the system.",
    summaryJa: "微分を近似するのではなく、伝播子 $e^{hA}$ そのものを $k$ 項の Taylor 級数で近似し、その各項を疎な線形系の追加行として符号化します。打ち切り誤差は $k$ について階乗的に小さくなるため、精度は $h$ を縮めて系を長くするのではなく、行を足すことで得られます。",
    realizes: "time-discretization",
    conditions: "Stated for constant-coefficient $A$. Berry, Childs, Ostrander and Wang describe the resulting object as a sparse, well-conditioned linear system, and state that unlike with finite difference methods their approach does not require additional hypotheses to ensure numerical stability.",
    conditionsJa: "定数係数の $A$ について述べられています。Berry・Childs・Ostrander・Wang は、得られる対象を疎で条件のよい線形系と表現し、差分法とは異なり数値的安定性のための追加の仮定を必要としないと述べています。",
    cost: "The resulting algorithm's complexity is polynomial in the logarithm of the inverse error, an exponential improvement over previous quantum algorithms for this problem. That is a statement about the full algorithm, not a standalone cost for the discretization.",
    costJa: "この符号化を用いたアルゴリズムの計算量は、誤差の逆数の対数について多項式であり、この問題に対する従来の量子アルゴリズムからの指数的な改善です。これはアルゴリズム全体についての記述であり、離散化単体の費用ではありません。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Quantum algorithm for linear differential equations with exponentially improved dependence on precision", authors: "Dominic W. Berry, Andrew M. Childs, Aaron Ostrander, Guoming Wang", year: "2017", url: "https://arxiv.org/abs/1701.03684" },
    ],
  },
  {
    kind: "method",
    id: "truncated-dyson-series",
    // `truncated-taylor-propagator` has had a pin since the `via` field was
    // built; this node is the sibling that never existed to be pinned to, and
    // its absence was the whole of the reason `dyson-all-at-once` drew the same
    // picture as `krovi-linear-ode`.
    //
    // **Only what `dyson-all-at-once` already states is repeated here.**
    // `cost` and `conditions` are authored (session 120) the way the old
    // comment here said they could be: from the paper open on the desk — Berry
    // and Costa's Theorem 4.1, its own hypotheses and oracle-call counts — and
    // the cost says in its own words, exactly as the Taylor sibling does, that
    // it is the full algorithm's complexity and not a standalone cost for the
    // discretization. Nothing in either field is a bound no paper carries.
    label: "Truncated Dyson series of the propagator",
    labelJa: "伝播子の Dyson 級数打ち切り",
    // The literature's own phrase — Berry and Costa's title says "Dyson series",
    // their §4 works with the truncated Dyson series by that name — not a
    // coinage. Authored (W19) because this pin and Taylor's are the visible
    // difference between the two all-at-once lanes, and at drawn width the
    // full 40-character label was the pair's only wide one: Taylor's pin has
    // carried its short form since it was authored. Owner pre-approved the
    // proposal route for this string ("that's fine", Inbox 4d7660).
    shortLabel: "Truncated Dyson series",
    shortLabelJa: "Dyson 級数打ち切り",
    summary: "Truncate the Dyson series — the expansion that stands in for the propagator once the generator varies with time — and encode its terms as rows of a system of linear equations. This is what extends the all-at-once approach to genuinely time-dependent generators; solving the system those rows make up is the layer below.",
    summaryJa: "生成子が時間に依存する場合に伝播子の役割を担うのが Dyson 級数です。これを打ち切り、その各項を連立一次方程式の行として符号化します。一括符号化の手法が真に時間依存な生成子にまで拡張されるのは、この置き換えによるものです。組み上がった系を解くのは一つ下の層です。",
    conditions: "Theorem 4.1 is stated for $\\dot{x}(t) = A(t)x(t) + b(t)$ with $A(t)$ of non-positive logarithmic norm, the equation's parameters provided through unitaries $U_A$, $U_b$, $U_x$ with known normalisations $\\lambda_A$, $\\lambda_b$, $\\lambda_x$. No smoothness condition is required: the oracle counts are independent of derivatives of the parameters.",
    conditionsJa: "定理 4.1 は、対数ノルムが非正の $A(t)$ をもつ $\\dot{x}(t) = A(t)x(t) + b(t)$ について述べられており、方程式のパラメータは既知の正規化定数 $\\lambda_A$, $\\lambda_b$, $\\lambda_x$ をもつユニタリ $U_A$, $U_b$, $U_x$ を通じて与えられます。滑らかさの条件は要求されず、オラクル呼び出し回数はパラメータの微分に依存しません。",
    cost: "Berry and Costa's Theorem 4.1 gives, for $\\dot{x}(t) = A(t)x(t) + b(t)$ with $A(t)$ of non-positive logarithmic norm, an average of $O(R \\lambda_A T \\log(1/\\varepsilon))$ calls to the state-preparation oracles and $O(R \\lambda_A T \\log(1/\\varepsilon) \\log(\\lambda_{Ax} T/\\varepsilon))$ calls to the matrix oracle — $T$ the evolution time, $\\varepsilon$ the allowed error, $\\lambda_A$ the matrix oracle's normalisation, $\\lambda_{Ax} = \\max(\\lambda_A, b_{max}/x_{max})$, and $R$ a rescaling constant the theorem bounds explicitly, growing when the solution decays. Gate counts depend on the parameters' first derivatives only through a logarithm, and on no higher derivative. That is a statement about the full algorithm, not a standalone cost for the discretization.",
    costJa: "Berry と Costa の定理 4.1 は、対数ノルムが非正の $A(t)$ をもつ $\\dot{x}(t) = A(t)x(t) + b(t)$ について、状態準備オラクルへの呼び出しを平均 $O(R \\lambda_A T \\log(1/\\varepsilon))$ 回、行列オラクルへの呼び出しを $O(R \\lambda_A T \\log(1/\\varepsilon) \\log(\\lambda_{Ax} T/\\varepsilon))$ 回と与えます。$T$ は発展時間、$\\varepsilon$ は許容誤差、$\\lambda_A$ は行列オラクルの正規化定数、$\\lambda_{Ax} = \\max(\\lambda_A, b_{max}/x_{max})$ であり、$R$ は定理が明示的に抑える再スケーリング定数で、解が減衰するほど大きくなります。ゲート数がパラメータの微分に依存するのは一階微分の対数を通じてのみで、高階微分には依存しません。これはアルゴリズム全体についての記述であり、離散化単体の費用ではありません。",
    realizes: "time-discretization",
    steps: [],
    atomic: true,
    citations: [
      { title: "Quantum algorithm for time-dependent differential equations using Dyson series", authors: "Dominic W. Berry, Pedro C. S. Costa", year: "2022", url: "https://arxiv.org/abs/2212.03544" },
    ],
  },
  {
    kind: "capability",
    id: "quantum-linear-solve",
    label: "Quantum linear solve",
    labelJa: "量子線形方程式の求解",
    summary: "Given access to a matrix $A$ and a unitary that prepares $|b>$, produce a flagged quantum state that is $\\varepsilon$-close in $l2$ to the normalised $A^{-1}b$. The deliverable is a state, not a classical vector.",
    summaryJa: "行列 $A$ へのアクセスと $|b>$ を用意するユニタリが与えられたとき、正規化した $A^{-1}b$ に $l2$ 距離で $\\varepsilon$ まで近い量子状態を、成功フラグ付きで出力します。得られるのは量子状態であって、古典的なベクトルではありません。",
    contract: {
      from: "linear-system",
      to: "solution-state",

      takes: "An access model for A — sparse row/column entry oracles, or a block-encoding; a unitary preparing |b>; a known upper bound κ on the condition number; the normalisation ‖A‖ ≤ 1; and a target state error ε.",
      takesJa: "A へのアクセス方式（疎行列の行・列エントリのオラクル、またはブロック符号化）、|b> を用意するユニタリ、条件数の上界 κ（既知であること）、正規化 ‖A‖ ≤ 1、そして目標とする状態の誤差 ε を受け取ります。",
      returns: "A flagged state ε-close in l2 to A^{-1}|b>/‖A^{-1}|b>‖. It does not return ‖x‖, any entry of x, or any classical functional of x — those cost extra and are decided a layer above.",
      returnsJa: "A^{-1}|b>/‖A^{-1}|b>‖ に l2 距離で ε まで近い、成功フラグ付きの状態を返します。‖x‖ も、x の個々の成分も、x の古典的な汎関数も返しません。それらには追加のコストがかかり、一つ上の層で決まります。",
    },
    whyALayer: "Callers above — differential equations, regression, finite-element methods — need exactly this contract and are indifferent to how it is met. The routes below are not interchangeable in their assumptions: some require sparse entry oracles, some need only $e^{-iAt}$, some use no amplitude amplification at all, and their costs differ by up to a full factor of $\\kappa$. $\\kappa$ itself is an input here; nothing in this layer estimates it for you.",
    whyALayerJa: "微分方程式、回帰、有限要素法といった上位の呼び出し側が必要とするのはこの契約だけで、どう実現されるかには依存しません。下位の経路は前提が互換ではありません。疎行列のエントリオラクルを要求するもの、$e^{-iAt}$ だけで足りるもの、振幅増幅を一切使わないものがあり、コストには最大で $\\kappa$ 一つ分の開きがあります。$\\kappa$ 自体はここでの入力であり、この層がそれを推定することはありません。",
  },
  {
    kind: "method",
    id: "hhl-qpe-inversion",
    label: "HHL: eigenvalue inversion by phase estimation",
    labelJa: "HHL — 位相推定による固有値の逆数化",
    shortLabel: "HHL",
    shortLabelJa: "HHL",
    summary: "Prepare $|b>$, run phase estimation against $e^{-iAt}$ to write eigenvalue estimates into an ancilla register, apply a controlled rotation with amplitude proportional to $1/λ̃$, uncompute the estimation and post-select on the rotation ancilla. The success amplitude is about $1/κ$, so the procedure is amplified $O(κ)$ times.",
    summaryJa: "$|b>$ を用意し、$e^{-iAt}$ に対する位相推定で固有値の推定値を補助レジスタに書き込み、振幅が $1/λ̃$ に比例する制御回転をかけ、推定を逆計算したうえで回転用の補助量子ビットを事後選択します。成功振幅はおよそ $1/κ$ なので、この手順には $O(κ)$ 回の増幅が必要になります。",
    realizes: "quantum-linear-solve",
    conditions: "$A$ Hermitian (the general case is reduced by dilation), $s$-sparse with efficient entry oracles, $‖A‖ \\approx 1$ with the relevant spectrum in $[1/\\kappa, 1]$, $\\kappa$ known or upper-bounded, and $|b>$ preparable in $\\mathrm{poly}(\\log N)$ time. Only the well-conditioned part of $|b>$ is inverted; the ill-conditioned part is flagged and discarded. The eigenvalue reciprocal is realised by phase estimation plus a conditional rotation, so no polynomial approximation and no phase sequence are ever computed. The paper's own headline comparison is for the case where a summary statistic $x†Mx$ is wanted, not $x$ itself.",
    conditionsJa: "$A$ はエルミート（一般の場合は拡大により帰着します）、$s$ 疎で効率的なエントリオラクルを持ち、$‖A‖ \\approx 1$ で対象のスペクトルが $[1/\\kappa, 1]$ に収まり、$\\kappa$ が既知または上界が与えられ、$|b>$ が $\\mathrm{poly}(\\log N)$ 時間で用意できることを前提とします。逆数化されるのは $|b>$ の条件の良い成分だけで、条件の悪い成分はフラグを立てて捨てられます。固有値の逆数は位相推定と条件付き回転によって実現されるため、多項式近似も位相列も一切計算されません。論文自身が掲げる比較も、$x$ そのものではなく要約統計量 $x†Mx$ を求める場合のものです。",
    cost: "Harrow, Hassidim and Lloyd state the runtime as $\\tilde{O}(\\log(N) s² \\kappa²/\\varepsilon)$, with $N$ the dimension, $s$ the sparsity, $\\kappa$ the condition number and $\\varepsilon$ the additive error; the phase-estimation time is set to $t_0 = O(\\kappa/\\varepsilon)$.",
    costJa: "Harrow・Hassidim・Lloyd は実行時間を $\\tilde{O}(\\log(N) s² \\kappa²/\\varepsilon)$ と述べています。ここで $N$ は次元、$s$ は疎性、$\\kappa$ は条件数、$\\varepsilon$ は加法的誤差であり、位相推定の時間は $t_0 = O(\\kappa/\\varepsilon)$ に設定されます。",
    contested: "The headline exponential speedup is over a different deliverable. Learning the full solution vector rather than a functional of it takes $Θ̃(d/ε)$ applications of the preparation unitary and its inverse to obtain an $\\varepsilon$-l2 approximation of a $d$-dimensional pure state (here $d$ is the dimension, written $N$ above; elsewhere in this group $d$ denotes the sparsity) — a characterised complexity, not a loose upper bound — and that linear-in-dimension factor cancels the log-dimension advantage. The $\\kappa²$ is also superseded: later solvers reach $O(\\kappa \\log(1/\\varepsilon))$.",
    contestedJa: "見出しに掲げられる指数的な高速化は、別の成果物に対するものです。x の汎関数ではなく解ベクトル全体を得ようとすると、$d$ 次元の純粋状態（ここでの $d$ は次元であり、上の $N$ にあたります。本群の他の項目では $d$ は疎性を表します）を $\\varepsilon$ の l2 精度で近似するのに、状態を用意するユニタリとその逆を $Θ̃(d/ε)$ 回適用する必要があります。これは上界の緩い評価ではなく特徴付けられた計算量であり、次元に比例するこの因子は次元の対数ぶんの優位を打ち消します。$\\kappa²$ も置き換えられており、のちの解法は $O(\\kappa \\log(1/\\varepsilon))$ に到達しています。",
    steps: ["state-preparation", "hamiltonian-simulation", "success-amplification"],
    repeats: {
      "state-preparation": {
        count: "O(κ) times — once per amplification round",
        countJa: "O(κ) 回。増幅の各ラウンドにつき 1 回。",
        mark: "×O(κ)",
        markJa: "×O(κ)",
        closure: "coherent",
        note: "The rotation ancilla carries a success amplitude of about 1/κ, so the whole prepare-estimate-rotate-uncompute block is amplified O(κ) times and |b⟩ is prepared afresh inside every one of them. This is where one of the two κ factors in Õ(log(N) s² κ²/ε) comes from, and it is the reason the state-preparation query count is a headline number for this family rather than a footnote: a route whose |b⟩ is expensive pays for it κ times here and once in the all-at-once encodings.",
        noteJa: "回転用の補助量子ビットが持つ成功振幅はおよそ 1/κ ですので、準備・推定・回転・逆計算のブロック全体が O(κ) 回増幅され、そのたびに |b⟩ が改めて準備されます。Õ(log(N) s² κ²/ε) にある二つの κ のうち一つはここから来ます。この系統で初期状態準備のクエリ数が脚注ではなく主要な数値として扱われる理由でもあります。|b⟩ の準備が高価な経路は、ここではその代価を κ 回、一括符号化では 1 回だけ支払います。",
      },
      "hamiltonian-simulation": {
        count: "O(κ) times — once per amplification round",
        countJa: "O(κ) 回。増幅の各ラウンドにつき 1 回。",
        mark: "×O(κ)",
        markJa: "×O(κ)",
        closure: "coherent",
        note: "Inside the same amplified block as the preparation above: phase estimation runs against e^{-iAt} with t_0 = O(κ/ε), and that whole estimation is repeated by the amplification. The two κ's compose, which is the second factor in Õ(log(N) s² κ²/ε).",
        noteJa: "上の状態準備と同じ増幅ブロックの内側にあります。位相推定は t_0 = O(κ/ε) のもとで e^{-iAt} に対して実行され、その推定全体が増幅によって繰り返されます。二つの κ が掛け合わさり、それが Õ(log(N) s² κ²/ε) の第二の因子になります。",
      },
    },
    bypasses: ["polynomial-approximation", "qsp-phase-factors"],
    entries: ["hhl-linear-systems"],
    citations: [
      { title: "Quantum algorithm for solving linear systems of equations", authors: "Aram W. Harrow, Avinatan Hassidim, Seth Lloyd", year: "2008", url: "https://arxiv.org/abs/0811.3171" },
      { title: "Quantum tomography using state-preparation unitaries", authors: "Joran van Apeldoorn, Arjan Cornelissen, András Gilyén, Giacomo Nannicini", year: "2022", url: "https://arxiv.org/abs/2207.08800" },
      { title: "Optimal scaling quantum linear systems solver via discrete adiabatic theorem", authors: "Pedro C. S. Costa, Dong An, Yuval R. Sanders, Yuan Su, Ryan Babbush, Dominic W. Berry", year: "2021", url: "https://arxiv.org/abs/2111.08152" },
    ],
  },
  {
    kind: "method",
    id: "qsvt-matrix-inversion",
    label: "QSVT matrix inversion",
    labelJa: "QSVT による行列の反転",
    summary: "Block-encode $A$, apply the quantum singular value transformation with an odd polynomial approximating a scaled $1/x$ away from the origin, then amplify. Because it acts on singular values, $A$ need not be Hermitian or sparse — only block-encodable.",
    summaryJa: "$A$ をブロック符号化し、原点から離れた領域でスケールした $1/x$ を近似する奇多項式を用いて量子特異値変換を適用し、そのうえで増幅します。特異値に作用するため、$A$ はエルミートである必要も疎である必要もなく、ブロック符号化できれば十分です。",
    realizes: "quantum-linear-solve",
    conditions: "Requires a projected unitary encoding of $A$ whose non-zero singular values are all at least $δ$ (so $δ = 1/κ$ after normalisation), with $0 < ε ≤ δ ≤ 1/2$. What the transform produces is $(δ/2)·A^+$, the Moore-Penrose pseudoinverse carrying a subnormalisation, so the raw output is not the normalised solution state — converting it is what the amplification step is for.",
    conditionsJa: "$A$ の射影ユニタリ符号化が必要で、その非零特異値がすべて $δ$ 以上であること（正規化後は $δ = 1/κ$）、および $0 < ε ≤ δ ≤ 1/2$ を要求します。変換が生成するのは $(δ/2)·A^+$、すなわち正規化因子のかかったムーア・ペンローズ擬似逆行列であり、そのままでは正規化された解状態にはなりません。それを変換するために増幅の段階があります。",
    cost: "Gilyén, Su, Low and Wiebe (Theorem 41) implement $(\\delta/2)·A^+$ to error $\\varepsilon$ with $m = O((1/\\delta) \\log(1/\\varepsilon))$ applications of $U$ and $U\\dagger$, using a single ancilla qubit. Chakraborty, Gilyén and Jeffery (Theorem 30) give the block-encoded end-to-end form $\\tilde{O}(\\alpha \\kappa T_U \\log³(1/\\varepsilon) + \\kappa T_b \\log(1/\\varepsilon))$, where $\\alpha$ is the subnormalisation, $T_U$ the cost of the block-encoding and $T_b$ the cost of preparing $|b>$.",
    costJa: "Gilyén・Su・Low・Wiebe の定理 41 は、$(\\delta/2)·A^+$ を誤差 $\\varepsilon$ で実装するのに $U$ と $U\\dagger$ の適用を $m = O((1/\\delta) \\log(1/\\varepsilon))$ 回、補助量子ビット 1 つで済ませます。Chakraborty・Gilyén・Jeffery の定理 30 は、ブロック符号化を含めた全体の形として $\\tilde{O}(\\alpha \\kappa T_U \\log³(1/\\varepsilon) + \\kappa T_b \\log(1/\\varepsilon))$ を与えます。ここで $\\alpha$ は正規化因子、$T_U$ はブロック符号化のコスト、$T_b$ は $|b>$ を用意するコストです。",
    contested: "The $O(\\kappa \\log(1/\\varepsilon))$ figure is a query count against the block-encoding, not a gate count, and it carries neither $\\alpha$ nor the amplification. Lin and Tong summarise the end-to-end QSP/QSVT query complexity as $O(\\kappa² \\mathrm{polylog}(\\kappa/\\varepsilon))$, reduced to $O(\\kappa \\mathrm{polylog}(\\kappa/\\varepsilon))$ only by variable-time amplitude amplification — and they state that the performance of that technique for this problem has not been quantitatively reported in the literature.",
    contestedJa: "$O(\\kappa \\log(1/\\varepsilon))$ という数字はブロック符号化への問い合わせ回数であってゲート数ではなく、$\\alpha$ も増幅ぶんも含んでいません。Lin と Tong は QSP/QSVT の全体としての問い合わせ計算量を $O(\\kappa² \\mathrm{polylog}(\\kappa/\\varepsilon))$ と整理し、$O(\\kappa \\mathrm{polylog}(\\kappa/\\varepsilon))$ まで下がるのは可変時間振幅増幅を用いた場合だけだとしています。さらに両氏は、この問題に対するその技法の性能は定量的に報告されていないと述べています。",
    steps: ["block-encode-matrix", "state-preparation", "matrix-function", "success-amplification"],
    repeats: {
      "block-encode-matrix": {
        count: "m = O((1/δ) log(1/ε)) applications of U and U†",
        countJa: "U と U† を m = O((1/δ) log(1/ε)) 回。",
        mark: "×m",
        markJa: "×m",
        closure: "coherent",
        note: "Gilyén, Su, Low and Wiebe's Theorem 41 count, and δ = 1/κ after normalisation — so this is the condition number, appearing as a number of turns rather than as a mysterious factor. The log(1/ε) is what an approximating polynomial of that degree costs, and it is why this route's precision dependence is logarithmic where phase-estimation inversion's is not.",
        noteJa: "Gilyén・Su・Low・Wiebe の Theorem 41 による回数で、正規化後は δ = 1/κ です。つまりこれは条件数が、正体不明の因子ではなく反復回数として現れたものです。log(1/ε) はその次数の近似多項式にかかる代価であり、この経路の精度依存性が対数的である一方、位相推定による反転がそうでない理由でもあります。",
      },
    },
    citations: [
      { title: "Quantum singular value transformation and beyond: exponential improvements for quantum matrix arithmetics", authors: "András Gilyén, Yuan Su, Guang Hao Low, Nathan Wiebe", year: "2018", url: "https://arxiv.org/abs/1806.01838" },
      { title: "The power of block-encoded matrix powers: improved regression techniques via faster Hamiltonian simulation", authors: "Shantanav Chakraborty, András Gilyén, Stacey Jeffery", year: "2018", url: "https://arxiv.org/abs/1804.01973" },
      { title: "Optimal polynomial based quantum eigenstate filtering with application to solving quantum linear systems", authors: "Lin Lin, Yu Tong", year: "2019", url: "https://arxiv.org/abs/1910.14596" },
    ],
  },
  {
    kind: "method",
    id: "chebyshev-lcu-inversion",
    label: "Chebyshev LCU inversion",
    labelJa: "チェビシェフ展開の LCU による行列の反転",
    summary: "Expand an approximation of $1/x$ in Chebyshev polynomials and implement that expansion directly through the quantum walk associated with a sparse $A$, rather than through Hamiltonian simulation. Phase estimation is never used, which is what removes the $\\mathrm{poly}(1/\\varepsilon)$ bottleneck.",
    summaryJa: "$1/x$ の近似をチェビシェフ多項式で展開し、その展開をハミルトニアンシミュレーションを経由せず、疎行列 $A$ に付随する量子ウォークで直接実装します。位相推定を一切使わないことが、$\\mathrm{poly}(1/\\varepsilon)$ というボトルネックを取り除きます。",
    realizes: "quantum-linear-solve",
    conditions: "Applies to sparse matrices only: it uses the entry oracle $P_A$ directly. The normalisation $‖A‖ = 1$, a known $\\kappa$ and $\\mathrm{poly}(\\log N)$-time preparation of $|b>$ are assumed as elsewhere in this family. Childs, Kothari and Somma state that their Fourier route and this Chebyshev route are incomparable — the Fourier approach is more general and slightly better in the sparsity $d$, the Chebyshev approach is more efficient in $\\kappa$ and $\\varepsilon$ but applies only to sparse Hamiltonians.",
    conditionsJa: "適用できるのは疎行列に限られ、エントリオラクル $P_A$ を直接使います。正規化 $‖A‖ = 1$、既知の $\\kappa$、$\\mathrm{poly}(\\log N)$ 時間での $|b>$ の用意という前提は、この系統の他の手法と同じです。Childs・Kothari・Somma は、自身のフーリエ経路とこのチェビシェフ経路は比較不能だと述べています。フーリエ経路のほうが一般的で疎性 $d$ への依存がわずかに良く、チェビシェフ経路は $\\kappa$ と $\\varepsilon$ への依存が良い代わりに疎なハミルトニアンにしか適用できません。",
    cost: "Childs, Kothari and Somma (Theorem 4): $O(d \\kappa² \\log²(d \\kappa/\\varepsilon))$ queries to $P_A$ and $O(\\kappa \\log(d \\kappa/\\varepsilon))$ uses of $P_B$, where $d$ is the sparsity, $\\kappa$ the condition number and $\\varepsilon$ the state-vector error.",
    costJa: "Childs・Kothari・Somma の定理 4 は、$P_A$ への問い合わせ $O(d \\kappa² \\log²(d \\kappa/\\varepsilon))$ 回と $P_B$ の使用 $O(\\kappa \\log(d \\kappa/\\varepsilon))$ 回を与えます。ここで $d$ は疎性、$\\kappa$ は条件数、$\\varepsilon$ は状態ベクトルの誤差です。",
    contested: "The $\\kappa²$ here is the pre-amplification figure. The same paper's Theorem 5 brings the $\\kappa$-dependence down to near-linear, but it does so by reintroducing a low-precision ('gapped') phase estimation to bucket the spectrum, and it applies to either the Fourier or the Chebyshev route. Describing that near-linear result as phase-estimation-free is incorrect.",
    contestedJa: "ここでの $\\kappa²$ は増幅前の数字です。同じ論文の定理 5 は $\\kappa$ 依存性をほぼ線形まで下げますが、そのためにスペクトルを区分けする低精度の（gapped な）位相推定を再導入しており、フーリエ経路とチェビシェフ経路のどちらにも適用できます。このほぼ線形の結果を位相推定なしと表現するのは誤りです。",
    steps: ["state-preparation", "matrix-function", "success-amplification"],
    bypasses: ["hamiltonian-simulation"],
    citations: [
      { title: "Quantum algorithm for systems of linear equations with exponentially improved dependence on precision", authors: "Andrew M. Childs, Robin Kothari, Rolando D. Somma", year: "2015", url: "https://arxiv.org/abs/1511.02306" },
    ],
  },
  {
    kind: "method",
    id: "discrete-adiabatic-inversion",
    label: "Discrete adiabatic inversion",
    labelJa: "離散断熱定理による行列の反転",
    summary: "Encode the solution as the null eigenstate of a Hamiltonian path built from $A$ and $|b>$, follow that path with a sequence of qubitization walk operators to fixed precision, then finish with an eigenstate filter implemented as a linear combination of walk operators rather than by quantum signal processing. Costa and co-authors prove an adiabatic theorem for intrinsically discrete-time evolutions, which removes the residual $\\log(κ)$ that continuous adiabatic treatments carried.",
    summaryJa: "解を $A$ と $|b>$ から作ったハミルトニアン経路の零固有状態として符号化し、その経路をキュービタイゼーションのウォーク演算子の列で一定精度までたどったうえで、量子信号処理ではなくウォーク演算子の線形結合として実装した固有状態フィルタを最後にかけます。Costa らは本質的に離散時間の発展に対する断熱定理を証明しており、これが連続的な断熱の扱いに残っていた $\\log(κ)$ を取り除きます。",
    realizes: "quantum-linear-solve",
    conditions: "Needs the walk-operator (qubitization) form of access to the path Hamiltonians and a lower bound on the spectral gap along the path, which amounts to a known upper bound on $\\kappa$. The authors' stated advantages are that the algorithm is simpler and easier to implement than the sub-optimal alternatives, and that the constant factors are determined, so gate counts can be worked out for a specific application.",
    conditionsJa: "経路上のハミルトニアンへウォーク演算子（キュービタイゼーション）の形でアクセスできること、および経路に沿ったスペクトルギャップの下界、つまり $\\kappa$ の上界が既知であることを要求します。著者らが挙げる利点は、最適でない代替手法より単純で実装しやすいこと、そして定数因子が決定されているため具体的な応用についてゲート数を見積もれることです。",
    cost: "Costa, An, Sanders, Su, Babbush and Berry state a complexity of $O(\\kappa \\log(1/\\varepsilon))$ — strictly linear in $\\kappa$, matching a known lower bound on the complexity, and also optimal in the combined scaling in $\\kappa$ and the precision $\\varepsilon$. Their framing is that the adiabatic route reaches near-linear $\\kappa$ without a complicated variable-time amplitude amplification procedure.",
    costJa: "Costa・An・Sanders・Su・Babbush・Berry は計算量 $O(\\kappa \\log(1/\\varepsilon))$ を示しています。$\\kappa$ について厳密に線形で既知の下界に一致し、$\\kappa$ と精度 $\\varepsilon$ を合わせたスケーリングとしても最適です。断熱的な経路は、複雑な可変時間振幅増幅の手続きなしにほぼ線形の $\\kappa$ に到達する、というのが著者らの位置づけです。",
    contested: "Constant factors in this family are unsettled. Costa, An, Babbush and Berry (arXiv December 2023; Quantum 9, 1887 (2025)) report numerical testing on random matrices showing the discrete adiabatic solver's constant factor is in practice about 1,200 times smaller than the published upper bound, and about an order of magnitude better than the randomized adiabatic approach of arXiv:2305.11352 — but that comparison was made against the 2023 version of that work, whose published 2025 version postdates it. The ranking therefore rests on a 2023 comparison; the published Quantum version of the discrete-adiabatic benchmark still cites the 2023 preprint of the randomized solver.",
    contestedJa: "この系統の定数因子は決着していません。Costa・An・Babbush・Berry（arXiv は 2023 年 12 月、Quantum 9, 1887 (2025)）はランダム行列を用いた数値実験により、離散断熱の解法の定数因子が実際には公表された上界のおよそ 1,200 分の 1 であり、arXiv:2305.11352 の乱択断熱の手法よりおよそ一桁効率が良いと報告しています。ただしこの比較は当該研究の 2023 年版に対するもので、2025 年に公表された版はそれより後になります。したがってこの順位付けは 2023 年時点の比較にもとづくものです。公表された Quantum 版の離散断熱のベンチマークも、乱択断熱の解法については 2023 年のプレプリントを引いています。",
    steps: ["block-encode-matrix", "state-preparation", "matrix-function"],
    citations: [
      { title: "Optimal scaling quantum linear systems solver via discrete adiabatic theorem", authors: "Pedro C. S. Costa, Dong An, Yuval R. Sanders, Yuan Su, Ryan Babbush, Dominic W. Berry", year: "2021", url: "https://arxiv.org/abs/2111.08152" },
      { title: "The discrete adiabatic quantum linear system solver has lower constant factors than the randomized adiabatic solver", authors: "Pedro C. S. Costa, Dong An, Ryan Babbush, Dominic Berry", year: "2023", url: "https://arxiv.org/abs/2312.07690" },
    ],
  },
  {
    kind: "method",
    id: "eigenstate-filtering-inversion",
    label: "Eigenstate filtering inversion",
    labelJa: "固有状態フィルタリングによる行列の反転",
    summary: "Construct the minimax-optimal polynomial that is 1 at a target eigenvalue and uniformly small outside a spectral gap, and apply it through quantum signal processing. For a linear system $|x>$ is the null eigenstate of a Hamiltonian built from $A$ and $|b>$, so one application of the filter solves it once a starting state with non-trivial overlap is supplied.",
    summaryJa: "目標固有値で 1 となり、スペクトルギャップの外では一様に小さいミニマックス最適な多項式を構成し、量子信号処理で適用します。線形方程式では $|x>$ は $A$ と $|b>$ から作ったハミルトニアンの零固有状態なので、重なりが無視できない初期状態さえ用意できれば、フィルタを 1 回かけるだけで解けます。",
    realizes: "quantum-linear-solve",
    conditions: "Requires a block-encoding of the Hamiltonian, a reasonable lower bound on the spectral gap, and an initial state with non-trivial overlap with the target eigenstate. Stated for a $d$-sparse $A$ whose singular values lie in $[1/\\kappa, 1]$ — the theorems are about singular values, not eigenvalues. Lin and Tong give two ways of supplying the starting state, one seeded by time-optimal adiabatic evolution and one that walks a Zeno path of intermediate Hamiltonians.",
    conditionsJa: "ハミルトニアンのブロック符号化、スペクトルギャップの妥当な下界、そして目標固有状態と無視できない重なりを持つ初期状態を必要とします。想定されているのは特異値が $[1/\\kappa, 1]$ に収まる $d$ 疎行列 $A$ で、定理が述べているのは固有値ではなく特異値についてです。初期状態の用意には 2 通りの方法が示されており、一方は時間最適な断熱発展を種にする方法、もう一方は量子ゼノ効果を用いて中間ハミルトニアンの列をたどる方法です。",
    cost: "Lin and Tong: both QLSP variants achieve the near-optimal $\\tilde{O}(d \\kappa \\log(1/\\varepsilon))$ query complexity for a $d$-sparse matrix, where $\\kappa$ is the condition number and $\\varepsilon$ the desired precision. Their abstract states that neither algorithm uses phase estimation or amplitude amplification.",
    costJa: "Lin と Tong によれば、QLSP に対する 2 つの変種はいずれも $d$ 疎行列に対してほぼ最適な問い合わせ計算量 $\\tilde{O}(d \\kappa \\log(1/\\varepsilon))$ を達成します。ここで $\\kappa$ は条件数、$\\varepsilon$ は要求精度です。どちらのアルゴリズムも位相推定も振幅増幅も使わないと、論文の要旨に明記されています。",
    steps: ["block-encode-matrix", "state-preparation", "matrix-function"],
    bypasses: ["success-amplification"],
    citations: [
      { title: "Optimal polynomial based quantum eigenstate filtering with application to solving quantum linear systems", authors: "Lin Lin, Yu Tong", year: "2019", url: "https://arxiv.org/abs/1910.14596" },
    ],
  },
  {
    kind: "capability",
    id: "matrix-function",
    label: "Matrix function",
    labelJa: "行列関数の適用",
    summary: "Given a block-encoding of $A$ and a target function $f$ bounded on $[-1,1]$, produce a circuit whose designated block is an $\\varepsilon$-approximation of $f$ applied to the singular values (or eigenvalues) of $A$.",
    summaryJa: "$A$ のブロック符号化と、$[-1,1]$ 上で有界な目標関数 $f$ が与えられたとき、指定ブロックが $f$ を $A$ の特異値（または固有値）に適用した結果の $\\varepsilon$ 近似となる回路を構成します。",
    contract: {
      from: "block-encoding",
      to: "transformed-block-encoding",

      takes: "A block-encoding of A together with its subnormalisation α; a target function f on [-1,1]; an error budget ε.",
      takesJa: "A のブロック符号化とその正規化因子 α、[-1,1] 上の目標関数 f、誤差の予算 ε を受け取ります。",
      returns: "A circuit implementing a block-encoding of f(A) to error ε, together with the query count in U and U†.",
      returnsJa: "誤差 ε で f(A) のブロック符号化を実装する回路と、U および U† への問い合わせ回数を返します。",
    },
    whyALayer: "Inverting $A$ is one choice of $f$; the same machinery gives Hamiltonian simulation, spectral filtering and thresholding. The alternatives here differ materially: QSVT compiles $f$ into a phase sequence and needs one ancilla qubit, an LCU of Chebyshev terms needs no phase factors but pays in ancillas and in the coefficient sum, and where the matrix is close to low rank and sampling access is granted, a classical algorithm does the same job in time independent of the dimension.",
    whyALayerJa: "$A$ の逆行列は $f$ の一つの選び方にすぎず、同じ機構でハミルトニアンシミュレーション、スペクトルのフィルタリング、しきい値処理も行えます。ここでの選択肢は実質的に異なります。QSVT は $f$ を位相列へコンパイルし、補助量子ビットは 1 つで済みます。チェビシェフ項の LCU は位相因子を必要としない代わりに、補助量子ビットと係数の総和ぶんのコストを払います。行列が低ランクに近くサンプリングアクセスが認められる場合には、同じ処理を次元に依存しない時間で行う古典アルゴリズムが存在します。",
  },
  {
    kind: "method",
    id: "qsvt-transform",
    label: "Quantum singular value transformation",
    labelJa: "量子特異値変換",
    summary: "Interleave the block-encoding $U$, its inverse, and projector-controlled phase shifts $e^{iφ(2Π-I)}$ so that the designated block becomes $P$ applied to the singular values of $A$. The phase sequence is the compiled form of the polynomial, and a single ancilla qubit carries the phase shifts.",
    summaryJa: "ブロック符号化 $U$、その逆、そして射影子で制御される位相シフト $e^{iφ(2Π-I)}$ を交互に並べ、指定ブロックが $A$ の特異値に $P$ を適用した形になるようにします。位相列は多項式をコンパイルした形であり、位相シフトは 1 つの補助量子ビットが担います。",
    realizes: "matrix-function",
    conditions: "The polynomial must have definite parity, matching the degree mod 2, and satisfy $|P(x)| ≤ 1$ for every $x$ in $[-1,1]$. Parity is not a convention: Gilyén, Su, Low and Wiebe argue it is necessary, following from the sign ambiguity in pairing singular vectors. A complex $P$ is handled directly; a real $P$ — which is what approximations of $1/x$, sign and cos give you — needs the extra-ancilla $|+>$ construction of their Corollary 18. The route from single-qubit quantum signal processing through the eigenvalue transform to QSVT is laid out rung by rung by Martyn, Rossi, Tan and Chuang.",
    conditionsJa: "多項式は偶奇が揃っている（次数の偶奇と一致する）必要があり、$[-1,1]$ のすべての $x$ で $|P(x)| ≤ 1$ を満たさなければなりません。偶奇の条件は約束事ではありません。Gilyén・Su・Low・Wiebe は、特異ベクトルの対応付けにおける符号の不定性から必然的に従うと論じています。複素の $P$ はそのまま扱えますが、$1/x$・sign・cos の近似が与えるような実の $P$ には、同論文の系 18 の、補助量子ビットを 1 つ追加する $|+>$ 構成が必要です。単一量子ビットの量子信号処理から固有値変換を経て QSVT に至る道筋は、Martyn・Rossi・Tan・Chuang が段ごとに整理しています。",
    cost: "Gilyén, Su, Low and Wiebe (Lemma 19): a degree-$n$ transform costs $n$ uses of $U$ and $U\\dagger$, $n$ uses of $C_Π$ NOT, $n$ uses of $C_Π̃$ NOT and $n$ single-qubit gates, with a single ancilla qubit. The degree $n$ is handed down by the polynomial-approximation layer, so that layer is what sets this circuit's query count.",
    costJa: "Gilyén・Su・Low・Wiebe の補題 19 によれば、次数 $n$ の変換には $U$ と $U\\dagger$ を $n$ 回、$C_Π$ NOT を $n$ 回、$C_Π̃$ NOT を $n$ 回、単一量子ビットゲートを $n$ 個使い、補助量子ビットは 1 つです。次数 $n$ は下位の多項式近似の層から渡されるため、この回路の問い合わせ回数を決めるのはその層です。",
    contested: "Where the matrix is close to low rank and the input model is $ℓ²$-norm sampling access — the classical counterpart of the QRAM data-structure assumption these algorithms are costed against — Chia, Gilyén, Li, Lin, Tang and Wang give classical algorithms for singular value transformation that run in time independent of the input dimension, and state that their results give compelling evidence that in the corresponding QRAM data structure input model quantum SVT does not yield exponential quantum speedups. Sparse-access QSVT and general Hamiltonian simulation are not dequantized; overstating this in either direction is the usual failure.",
    contestedJa: "行列が低ランクに近く、入力方式が $ℓ²$ ノルムのサンプリングアクセス、すなわちこれらのアルゴリズムが前提としてきた QRAM データ構造の古典版である場合、Chia・Gilyén・Li・Lin・Tang・Wang は入力次元に依存しない時間で動く特異値変換の古典アルゴリズムを与えており、自身の結果は、対応する QRAM データ構造の入力方式のもとで量子 SVT が指数的な高速化をもたらさないことを示す有力な証拠になる、と述べています。疎行列アクセスの QSVT と一般のハミルトニアンシミュレーションは古典化されていません。どちらの向きにも言いすぎるのが、この話題でよくある失敗です。",
    steps: ["block-encode-matrix", "polynomial-approximation", "qsp-phase-factors"],
    repeats: {
      "block-encode-matrix": {
        count: "n uses of U and n of U†, for a degree-n transform",
        countJa: "次数 n の変換に対して U を n 回、U† を n 回。",
        mark: "×n",
        markJa: "×n",
        closure: "coherent",
        note: "The repetition is the circuit: U, U†, U, U† interleaved with the phase shifts, and the degree of the polynomial is the number of turns. It is the cleanest case on this map of a count that is set by a *different* layer — the polynomial-approximation step above hands down n, so a coarser approximation is literally a shorter loop here. Nothing is measured; the whole sequence is one coherent circuit, which is why the price shows up as depth and as query count rather than as shots.",
        noteJa: "反復そのものが回路です。U、U†、U、U† を位相シフトと交互に並べたものであり、多項式の次数がそのまま反復回数になります。この地図のなかで、回数を決めているのが別の層であることが最も明瞭に見える例です。上の多項式近似の層が n を渡しますので、近似を粗くすることは、ここでは文字どおり反復を短くすることにあたります。測定は行われず、全体がひとつのコヒーレントな回路ですので、代価はショット数ではなく深さとクエリ数として現れます。",
      },
    },
    entries: ["quantum-singular-value-transformation"],
    citations: [
      { title: "Quantum singular value transformation and beyond: exponential improvements for quantum matrix arithmetics", authors: "András Gilyén, Yuan Su, Guang Hao Low, Nathan Wiebe", year: "2018", url: "https://arxiv.org/abs/1806.01838" },
      { title: "A Grand Unification of Quantum Algorithms", authors: "John M. Martyn, Zane M. Rossi, Andrew K. Tan, Isaac L. Chuang", year: "2021", url: "https://arxiv.org/abs/2105.02859" },
      { title: "Sampling-based sublinear low-rank matrix arithmetic framework for dequantizing quantum machine learning", authors: "Nai-Hui Chia, András Gilyén, Tongyang Li, Han-Hsuan Lin, Ewin Tang, Chunhao Wang", year: "2019", url: "https://arxiv.org/abs/1910.06151" },
    ],
  },
  {
    kind: "method",
    id: "lcu-chebyshev-transform",
    label: "Chebyshev series by linear combination of unitaries",
    labelJa: "ユニタリの線形結合によるチェビシェフ級数の実装",
    shortLabel: "Chebyshev series by LCU",
    shortLabelJa: "LCU によるチェビシェフ級数",
    summary: "Write the target function as a Chebyshev series, then implement that series as a linear combination of walk-operator powers using a PREPARE/SELECT pair on an ancilla register, and post-select. No phase factors are computed — the polynomial enters through the coefficients of the combination instead.",
    summaryJa: "目標関数をチェビシェフ級数で表し、その級数を補助レジスタ上の PREPARE/SELECT 対によるウォーク演算子べきの線形結合として実装し、事後選択します。位相因子は一切計算せず、多項式は線形結合の係数として入ります。",
    realizes: "matrix-function",
    conditions: "Needs an explicit decomposition of the target into implementable unitaries with a known coefficient vector, and the ability to prepare a state from those coefficients. Childs, Kothari and Somma apply this route to a sparse $A$ through its associated quantum walk, so it runs from the entry oracle without Hamiltonian simulation as an intermediate. It costs more ancillas than the QSVT route, which carries the polynomial in one qubit's worth of phase shifts.",
    conditionsJa: "目標関数を実装可能なユニタリへ明示的に分解し、その係数ベクトルが既知であること、および係数から状態を用意できることを要求します。Childs・Kothari・Somma はこの経路を疎行列 $A$ に付随する量子ウォークへ適用しており、ハミルトニアンシミュレーションを経由せずエントリオラクルから直接動きます。多項式を補助量子ビット 1 つぶんの位相シフトで担う QSVT の経路に比べ、補助量子ビットは多く必要です。",
    // `cost` (session 123): quoted from the abstract of arxiv:1511.02306
    // (register `reportsBasis: "abstract"`). The abstract states the bound
    // relative to HHL, not as a closed form, and the field keeps that shape.
    cost: "Childs, Kothari and Somma state the improvement in their abstract's own comparative terms: for a sparse, well-conditioned $A$, the Harrow–Hassidim–Lloyd algorithm runs in time $\\mathrm{poly}(\\log N, 1/\\varepsilon)$, and theirs improves this to a running time polynomial in $\\log(1/\\varepsilon)$ — exponentially improving the dependence on precision \"while keeping essentially the same dependence on other parameters\". The claim is for the complete linear-systems algorithm this transform powers, not a standalone cost for the LCU step. The abstract states no closed-form bound; the exact statements, including the condition-number dependence, are in the paper's full text and are not quoted here.",
    costJa: "Childs・Kothari・Somma は改善を概要の比較の形のまま述べています。疎で条件数の良い $A$ に対し、Harrow–Hassidim–Lloyd のアルゴリズムは時間 $\\mathrm{poly}(\\log N, 1/\\varepsilon)$ で動作しますが、彼らのアルゴリズムはこれを $\\log(1/\\varepsilon)$ の多項式時間に改善します。すなわち精度への依存を指数的に改善し、「他のパラメータへの依存は本質的に同じに保つ」ものです。この主張は、この変換が支える線形システムアルゴリズム全体についてのものであって、LCU の段階単体の費用ではありません。概要は閉じた形の評価を述べておらず、条件数への依存を含む正確な言明は論文の本文にあり、ここでは引用していません。",
    steps: ["block-encode-matrix", "polynomial-approximation"],
    bypasses: ["qsp-phase-factors"],
    entries: ["linear-combination-unitaries"],
    citations: [
      { title: "Hamiltonian Simulation Using Linear Combinations of Unitary Operations", authors: "Andrew M. Childs, Nathan Wiebe", year: "2012", url: "https://arxiv.org/abs/1202.5822" },
      { title: "Quantum algorithm for systems of linear equations with exponentially improved dependence on precision", authors: "Andrew M. Childs, Robin Kothari, Rolando D. Somma", year: "2015", url: "https://arxiv.org/abs/1511.02306" },
    ],
  },
  {
    kind: "capability",
    id: "qsp-phase-factors",
    label: "QSP phase factors",
    labelJa: "QSP 位相因子の決定",
    summary: "Given an admissible polynomial, compute the phase sequence $Φ$ that makes the quantum-signal-processing product reproduce it to accuracy $\\varepsilon$ in classical finite-precision arithmetic.",
    summaryJa: "許容条件を満たす多項式が与えられたとき、量子信号処理の積がその多項式を精度 $\\varepsilon$ で再現するような位相列 $Φ$ を、古典計算機の有限精度演算で求めます。",
    contract: {
      from: "polynomial",
      to: "phase-sequence",

      takes: "Chebyshev coefficients of a real polynomial P of degree d with definite parity and |P(x)| ≤ 1 on [-1,1], plus a target accuracy ε.",
      takesJa: "[-1,1] 上で |P(x)| ≤ 1 を満たし偶奇が揃った実多項式 P（次数 d）のチェビシェフ係数と、目標精度 ε を受け取ります。",
      returns: "A phase sequence Φ ∈ R^{d+1}, often symmetric (φ_j = φ_{d-j}), together with the classical running time and the arithmetic precision the method requires.",
      returnsJa: "位相列 Φ ∈ R^{d+1}（多くの場合 φ_j = φ_{d-j} の対称形）と、その手法が要する古典計算の時間および演算精度を返します。",
    },
    whyALayer: "This is a classical numerical-analysis problem sitting inside a quantum algorithm: the existence of the phases was established non-constructively, and computing them stably is separate work. The methods differ on a measurable axis — behaviour as ‖f‖_∞ → 1, the fully-coherent regime — not on taste. The root-finding family is analysed as needing $O(d \\mathrm{polylog}(d/\\varepsilon))$ bits rather than double precision; the optimization and Prony families run in standard double precision but are understood to degrade as ‖f‖_∞ → 1; the Newton formulation is reported to hold up in that regime.",
    whyALayerJa: "これは量子アルゴリズムの内側にある古典的な数値解析の問題です。位相の存在は非構成的に示されており、それを安定に計算することは別の仕事です。手法の違いは好みではなく、測定可能な軸、すなわち ‖f‖_∞ → 1 に近づく完全コヒーレント領域での挙動に現れます。求根系の手法は、倍精度ではなく $O(d \\mathrm{polylog}(d/\\varepsilon))$ ビットの精度を要すると分析されています。最小二乗法と Prony 法の系統は標準的な倍精度で動く代わりに、‖f‖_∞ → 1 では性能が落ちると理解されています。ニュートン法による定式化は、その領域でも通用すると報告されています。",
    entries: ["quantum-signal-processing"],
  },
  {
    kind: "method",
    id: "direct-root-finding-phases",
    label: "Direct method: root finding, then layer stripping",
    labelJa: "直接法 — 求根と層剥がし",
    shortLabel: "Direct root finding",
    shortLabelJa: "直接法による求根",
    summary: "Compute the complementary polynomial by finding the roots of a high-degree polynomial, then strip off one phase factor at a time from the assembled $SU(2)$-valued product. Haah's product decomposition is the version of this route that comes with a full arithmetic-model analysis.",
    summaryJa: "高次多項式の根を求めることで補多項式を構成し、組み上げた $SU(2)$ 値の積から位相因子を 1 つずつ剥がしていきます。Haah の積分解は、この経路のうち演算モデルまで含めて解析された版です。",
    realizes: "qsp-phase-factors",
    conditions: "Root finding is the numerical weak point of the family. Ni and Ying's survey groups this family — the Gilyén-Su-Low-Wiebe construction, Haah, and the halving/capitalization method — as requiring $O(d\\,\\mathrm{polylog}(d/\\varepsilon))$ bits of precision, citing Haah, which means variable-precision arithmetic rather than double precision. They also state that the stability of the layer-stripping process used by most direct methods remains an open question.",
    conditionsJa: "求根の段階がこの系統の数値的な弱点です。Ni と Ying の整理では、この系統、すなわち Gilyén・Su・Low・Wiebe の構成、Haah、そして halving と capitalization による手法は、Haah を引きつつ $O(d\\,\\mathrm{polylog}(d/\\varepsilon))$ ビットの精度を要するものとして分類されており、倍精度ではなく可変精度の演算が前提になります。また両氏は、多くの直接法が用いる層剥がしの安定性は未解決の問題のままだと述べています。",
    cost: "Haah: $O(N³ \\mathrm{polylog}(N/\\varepsilon))$ time for a degree-$N$ approximation at accuracy $\\varepsilon$, under the random-access memory model of computation. The model is the point of the result — earlier efficiency claims had assumed a strong arithmetic model of computation and lacked numerical stability analysis, and this work replaces that with a realistic one.",
    costJa: "Haah は、精度 $\\varepsilon$ の次数 $N$ の近似に対して、random-access memory の計算モデルのもとで $O(N³ \\mathrm{polylog}(N/\\varepsilon))$ 時間を示しています。要点はこのモデルにあります。それ以前の効率性の主張は強い演算モデルを仮定しており数値的安定性の解析を欠いていました。この研究はそれを現実的なモデルに置き換えています。",
    contested: "There is a live tension over the precision requirement. The survey above places the halving/capitalization method of Chao, Ding, Gilyén, Huang and Szegedy in the root-finding family said to need $O(d \\mathrm{polylog}(d/\\varepsilon))$ bits, while that paper itself reports finding sequences of more than 3000 angles within 5 minutes in standard double precision arithmetic. The two claims have not been reconciled in the literature.",
    contestedJa: "要求される精度をめぐっては見解の対立が残っています。上記の整理は Chao・Ding・Gilyén・Huang・Szegedy の halving と capitalization による手法を $O(d \\mathrm{polylog}(d/\\varepsilon))$ ビットを要する求根系に位置づけていますが、当の論文自身は、標準的な倍精度演算で 3000 を超える角度列を 5 分以内に求めたと報告しています。この 2 つの主張は現時点で整合していません。",
    steps: [],
    citations: [
      { title: "Product Decomposition of Periodic Functions in Quantum Signal Processing", authors: "Jeongwan Haah", year: "2018", url: "https://arxiv.org/abs/1806.10236" },
      { title: "Fast Phase Factor Finding for Quantum Signal Processing", authors: "Hongkang Ni, Lexing Ying", year: "2024", url: "https://arxiv.org/abs/2410.06409" },
      { title: "Finding Angles for Quantum Signal Processing with Machine Precision", authors: "Rui Chao, Dawei Ding, Andras Gilyen, Cupjin Huang, Mario Szegedy", year: "2020", url: "https://arxiv.org/abs/2003.02831" },
    ],
  },
  {
    kind: "method",
    id: "least-squares-optimization-phases",
    label: "Least-squares optimization of the phase factors",
    labelJa: "位相因子の最小二乗最適化",
    shortLabel: "Least-squares optimization",
    shortLabelJa: "最小二乗最適化",
    summary: "Instead of constructing the complementary polynomial, minimise the mean squared difference between the QSP response $Re[\\langle0|U_Φ(x_j)|0\\rangle]$ and the target $f$, evaluated at the positive roots of the Chebyshev polynomial $T_{2d̃}$, over symmetric phase sequences. Gradients come from $SU(2)$ matrix products, so root finding is avoided entirely and the method runs in standard double precision — but it degrades as $‖f‖_\\infty$ approaches 1.",
    summaryJa: "補多項式を構成する代わりに、QSP の応答 $Re[\\langle0|U_Φ(x_j)|0\\rangle]$ と目標関数 $f$ の差の二乗平均を、チェビシェフ多項式 $T_{2d̃}$ の正の根で評価し、対称な位相列について最小化します。勾配は $SU(2)$ 行列の積から得られるため求根を完全に回避でき、標準的な倍精度演算で動きますが、$‖f‖_\\infty$ が 1 に近づくにつれて性能が落ちます。",
    realizes: "qsp-phase-factors",
    conditions: "The objective is $L(Φ̂) = (1/d̃) \\Sigma_{j=1}^{d̃} |Re[\\langle0|U_Φ(x_j)|0\\rangle] − f(x_j)|²$ at $x_j = \\cos((2j−1)\\pi/(4d̃))$ with $d̃ = ⌈(d+1)/2⌉$, minimised with L-BFGS over symmetric phase factors. The target must already be an admissible polynomial: feed in a non-polynomial f and $L(Φ) = 0$ generally has no solution, leaving the optimizer stuck among many local minima. The initial guess $Φ⁰ = (\\pi/4, 0, \\ldots, 0, \\pi/4)$ is load-bearing — the seemingly natural $Φ = (0, \\ldots, 0)$ is a stationary point whose loss is non-zero. Wang, Dong and Lin later proved that one global minimum lies in a neighbourhood of Φ⁰ on which the cost function is strongly convex, under $‖f‖_∞ = O(d^{-1})$ with $d = \\deg(f)$.",
    conditionsJa: "目的関数は $L(Φ̂) = (1/d̃) \\Sigma_{j=1}^{d̃} |Re[\\langle0|U_Φ(x_j)|0\\rangle] − f(x_j)|²$ で、$x_j = \\cos((2j−1)\\pi/(4d̃))$、$d̃ = ⌈(d+1)/2⌉$ とし、対称な位相因子について L-BFGS で最小化します。目標はあらかじめ許容条件を満たす多項式でなければなりません。多項式でない f をそのまま入れると $L(Φ) = 0$ には一般に解がなく、最適化は多数の局所解の中で止まります。初期値 $Φ⁰ = (\\pi/4, 0, \\ldots, 0, \\pi/4)$ は本質的です。一見自然に見える $Φ = (0, \\ldots, 0)$ は、損失が零でない停留点だからです。のちに Wang・Dong・Lin は、$‖f‖_∞ = O(d^{-1})$（$d = \\deg(f)$）のもとで、ある大域最小解が Φ⁰ の近傍にあり、その近傍で目的関数が強凸であることを証明しました。",
    cost: "No asymptotic bound is claimed. The paper reports that the optimization finds phase factors accurately approximating polynomials of degree larger than 10,000 with error below $10^{-12}$, using standard double precision arithmetic operations.",
    costJa: "漸近的な評価は主張されていません。論文は、標準的な倍精度の演算だけで、次数 10,000 を超える多項式を誤差 $10^{-12}$ 未満で精度よく近似する位相因子が求まったと報告しています。",
    contested: "This family is efficient and stable in double precision but is understood to degrade in the fully-coherent regime, where ‖f‖_∞ → 1. The Newton method for symmetric QSP and the nonlinear-Fourier-transform route were developed for that regime specifically, and the strong-convexity guarantee that justifies the standard initial guess is proved only under ‖f‖_∞ = O(d^{-1}), which does not reach it.",
    contestedJa: "この系統は倍精度で効率的かつ安定ですが、‖f‖_∞ → 1 となる完全コヒーレント領域では性能が落ちると理解されています。対称 QSP に対するニュートン法や非線形フーリエ変換に基づく経路は、まさにその領域のために開発されました。標準的な初期値を正当化する強凸性の保証も ‖f‖_∞ = O(d^{-1}) のもとでのみ証明されており、その領域には届きません。",
    steps: [],
    citations: [
      { title: "Efficient phase-factor evaluation in quantum signal processing", authors: "Yulong Dong, Xiang Meng, K. Birgitta Whaley, Lin Lin", year: "2020", url: "https://arxiv.org/abs/2002.11649" },
      { title: "On the energy landscape of symmetric quantum signal processing", authors: "Jiasu Wang, Yulong Dong, Lin Lin", year: "2021", url: "https://arxiv.org/abs/2110.04993" },
    ],
  },
  {
    kind: "method",
    id: "symmetric-newton-phases",
    label: "Newton's method for symmetric QSP",
    labelJa: "対称 QSP に対するニュートン法",
    summary: "Treat phase-factor finding as a nonlinear system rather than a minimization, and solve it with a Newton iteration built for symmetric QSP. The matrix-product-state structure of symmetric QSP makes computing the Jacobian cost about the same as a single function evaluation.",
    summaryJa: "位相因子の決定を最小化問題ではなく非線形方程式系とみなし、対称 QSP 向けに設計したニュートン反復で解きます。対称 QSP が持つ行列積状態の構造により、ヤコビ行列の計算コストは関数を 1 回評価するのと同程度に収まります。",
    realizes: "qsp-phase-factors",
    conditions: "Converges rapidly and robustly in all parameter regimes, including the case of an ill-conditioned Jacobian, using standard double precision arithmetic. The reported example is the highly oscillatory target $α cos(1000x)$ at polynomial degree $≈ 1433$: 6 iterations to machine precision at $α = 0.9$, rising only to 18 iterations at $α = 1 − 10^{-9}$, where the Jacobian is highly ill-conditioned. The authors also give a reformulation of symmetric QSP in real arithmetic, and the method is implemented in the QSPPACK package.",
    conditionsJa: "標準的な倍精度演算のまま、ヤコビ行列が悪条件になる場合を含め、すべてのパラメータ領域で速やかかつ頑健に収束します。挙げられている例は、強く振動する目標関数 $α cos(1000x)$（多項式次数はおよそ 1433）です。$α = 0.9$ では 6 回の反復で機械精度に達し、ヤコビ行列が極めて悪条件になる $α = 1 − 10^{-9}$ でも反復回数は 18 回に増えるにとどまります。著者らは対称 QSP を実数演算で書き直す定式化も与えており、手法は QSPPACK に実装されています。",
    contested: "The robustness claim is the paper's own and stands; the efficiency ranking has since moved. Ni and Ying present a structured-matrix method they describe as the fastest applicable across all regimes, and characterise this Newton iteration's per-iteration cost as dominated by a linear solve — a figure that is theirs, not this paper's, which claims no complexity.",
    contestedJa: "頑健性についての主張は論文自身のものであり、そのまま成り立ちます。ただし効率の順位付けはその後動いています。Ni と Ying は、すべての領域に適用できる手法のなかで最も高速だとする構造行列に基づく手法を提示し、このニュートン反復の 1 反復あたりのコストを線形方程式の求解が支配するものとして特徴付けています。これは両氏による評価であり、計算量を何も主張していないこの論文自身の数字ではありません。",
    steps: [],
    citations: [
      { title: "Robust iterative method for symmetric quantum signal processing in all parameter regimes", authors: "Yulong Dong, Lin Lin, Hongkang Ni, Jiasu Wang", year: "2023", url: "https://arxiv.org/abs/2307.12468" },
    ],
  },
  {
    kind: "method",
    id: "prony-stable-factorization-phases",
    label: "Stable factorization via Prony's method",
    labelJa: "Prony 法による安定な因子分解",
    summary: "Build the complementary polynomial directly, with Prony's method as the key step, then obtain the phase factors by factorization. This avoids root finding of high-degree polynomials, which is the step that forces variable-precision arithmetic elsewhere in the direct family.",
    summaryJa: "Prony 法を要として補多項式を直接構成し、そのうえで因子分解によって位相因子を得ます。これにより高次多項式の求根を回避できます。求根こそ、直接法の他の手法で可変精度の演算を強いる段階です。",
    realizes: "qsp-phase-factors",
    conditions: "Reported numerically stable in double precision arithmetic, with experiments on Hamiltonian simulation, eigenstate filtering, matrix inversion and evaluation of the Fermi-Dirac operator.",
    conditionsJa: "倍精度演算で数値的に安定であると報告されており、ハミルトニアンシミュレーション、固有状態フィルタリング、行列の反転、フェルミ・ディラック演算子の評価で実験されています。",
    cost: "Ying's own accounting: computing the vector $m$ costs an empirical $O(d^2)$, and extracting the phase factors costs $O(d^2 \\log d)$ via the FFT and dominates, so the overall cost is $O(d^2 \\log d)$. The paper's headline comparison is the same $O(d^2)$ computational cost as the optimization-based method of Dong, Meng, Whaley and Lin at comparable accuracy ($\\sim 10^{-12}$), with sequences beyond 50,000 phase factors demonstrated. $d$ is the polynomial degree, and the cost is classical preprocessing. Stated in the full text; the abstract carries no bound.",
    costJa: "論文自身の見積もりでは、ベクトル $m$ の計算は経験的に $O(d^2)$、位相因子の取り出しは FFT を用いて $O(d^2 \\log d)$ であり、後者が支配的なため全体のコストは $O(d^2 \\log d)$ です。論文の総括的な比較では、Dong・Meng・Whaley・Lin の最適化に基づく手法と同じ $O(d^2)$ の計算コストで同等の精度（$\\sim 10^{-12}$）に達すると述べられており、50,000 個を超える位相因子の列まで実験されています。$d$ は多項式の次数であり、これは古典的な前処理のコストです。要旨ではなく本文に述べられています。",
    contested: "The paper's claim is stability in double precision, not an improved asymptotic, and no sharp worst-case complexity separating it from the root-finding family is given. Ni and Ying add that the stability of the layer-stripping process most direct methods rely on — this one included — remains an open question.",
    contestedJa: "論文が主張しているのは倍精度での安定性であって漸近計算量の改善ではなく、求根系と分ける鋭い最悪計算量は与えられていません。さらに Ni と Ying は、この手法を含め多くの直接法が依拠する層剥がしの安定性は未解決の問題のままだと指摘しています。",
    steps: [],
    citations: [
      { title: "Stable factorization for phase factors of quantum signal processing", authors: "Lexing Ying", year: "2022", url: "https://arxiv.org/abs/2202.02671" },
      { title: "Fast Phase Factor Finding for Quantum Signal Processing", authors: "Hongkang Ni, Lexing Ying", year: "2024", url: "https://arxiv.org/abs/2410.06409" },
    ],
  },
  {
    kind: "capability",
    id: "polynomial-approximation",
    label: "Polynomial approximation",
    labelJa: "多項式近似の構成",
    summary: "Given a target function, a domain and an error $\\varepsilon$, return a polynomial of definite parity, bounded on $[-1,1]$, that is $\\varepsilon$-close to the target on that domain, with an explicit degree.",
    summaryJa: "目標関数、定義域、誤差 $\\varepsilon$ が与えられたとき、その定義域上で目標関数に $\\varepsilon$ まで近く、偶奇が揃い $[-1,1]$ 上で有界な多項式を、次数を明示して返します。",
    contract: {
      from: "target-function",
      to: "polynomial",

      takes: "A target function f (1/x, sign, e^{-ixt} and so on); a domain such as [-1,1] \\ (-1/κ, 1/κ); an error ε; the required parity.",
      takesJa: "目標関数 f（1/x、sign、e^{-ixt} など）、[-1,1] \\ (-1/κ, 1/κ) のような定義域、誤差 ε、要求される偶奇を受け取ります。",
      returns: "Chebyshev coefficients of the polynomial and its degree d, plus the bound on |P| over [-1,1] before any rescaling.",
      returnsJa: "多項式のチェビシェフ係数と次数 d、および再スケーリング前の [-1,1] 上での |P| の上界を返します。",
    },
    whyALayer: "The degree returned here becomes the query complexity of the circuit above it, so the cost of the quantum algorithm is settled by classical approximation theory rather than by anything quantum. Routes to the same target differ in their constants and sometimes in their asymptotics, and the bound on $|P|$ before rescaling determines how much amplification the caller must pay for afterwards.",
    whyALayerJa: "ここで返される次数がそのまま上位の回路の問い合わせ計算量になるため、量子アルゴリズムのコストは量子的な要素ではなく古典の近似理論で決まります。同じ目標関数に向かう経路でも定数は異なり、漸近形すら変わることがあります。再スケーリング前の $|P|$ の上界は、呼び出し側があとで支払う増幅の量を決めます。",
  },
  {
    kind: "method",
    id: "chebyshev-truncation",
    label: "Truncated Chebyshev expansion",
    labelJa: "チェビシェフ展開の打ち切り",
    summary: "Expand the target in Chebyshev polynomials and truncate once the coefficients have fallen below the error budget. For $1/x$ the expansion is taken of the odd function $f(x) = (1 − (1 − x²)^b)/x$; for $e^{-ixt}$ the Jacobi-Anger identity supplies Bessel coefficients that decay super-exponentially once the order passes about $t$.",
    summaryJa: "目標関数をチェビシェフ多項式で展開し、係数が誤差の予算を下回ったところで打ち切ります。$1/x$ に対しては奇関数 $f(x) = (1 − (1 − x²)^b)/x$ を展開し、$e^{-ixt}$ に対しては Jacobi-Anger の公式が、次数がおよそ $t$ を超えると超指数的に減衰するベッセル係数を与えます。",
    realizes: "polynomial-approximation",
    conditions: "For the $1/x$ construction with $b = ⌈\\kappa² \\log(\\kappa/\\varepsilon)⌉$, accuracy is claimed only on $[−1,1]$ \\ $(−1/\\kappa, 1/\\kappa)$ — a gap of width $1/\\kappa$ around the origin, which is where the condition-number assumption enters — and requires $\\kappa > 1$ and $\\varepsilon ∈ (0, ½)$. The polynomial must be rescaled to satisfy $|P| \\leq 1$ before QSVT will accept it, and that rescaling is what makes amplification mandatory downstream. On attribution: this polynomial is Childs, Kothari and Somma's Lemmas 17-19; Gilyén, Su, Low and Wiebe reuse it as their Lemma 40 after adjustments, and the form quoted here is that restatement.",
    conditionsJa: "$1/x$ の構成では $b = ⌈\\kappa² \\log(\\kappa/\\varepsilon)⌉$ とし、精度が主張されるのは $[−1,1]$ \\ $(−1/\\kappa, 1/\\kappa)$ の上、すなわち原点まわりの幅 $1/\\kappa$ の隙間を除いた領域に限られます。条件数の仮定が入るのはここです。あわせて $\\kappa > 1$ と $\\varepsilon ∈ (0, ½)$ を要求します。QSVT に渡す前に $|P| \\leq 1$ を満たすよう再スケーリングする必要があり、この再スケーリングが下流で増幅を必須にします。出典について一点。この多項式は Childs・Kothari・Somma の補題 17-19 のものです。Gilyén・Su・Low・Wiebe は調整のうえ自身の補題 40 として再利用しており、ここで引用した形はその再掲版です。",
    cost: "Degree $O(\\kappa \\log(\\kappa/\\varepsilon))$ for the odd real polynomial, with $|P(x)| = O(\\kappa \\log(\\kappa/\\varepsilon))$ on the interval before rescaling. For Hamiltonian simulation, Low and Chuang give the resulting query complexity as $O(t d ‖Ĥ‖_max + \\log(1/\\varepsilon)/\\log \\log(1/\\varepsilon))$ for a $d$-sparse Hamiltonian ($d$ here is the sparsity, not the polynomial degree above), matching lower bounds in all parameters.",
    costJa: "奇の実多項式の次数は $O(\\kappa \\log(\\kappa/\\varepsilon))$ で、再スケーリング前の区間上での大きさは $|P(x)| = O(\\kappa \\log(\\kappa/\\varepsilon))$ です。ハミルトニアンシミュレーションについては、Low と Chuang が $d$ 疎ハミルトニアン（この $d$ は疎性であり、上記の多項式の次数ではありません）に対する問い合わせ計算量を $O(t d ‖Ĥ‖_max + \\log(1/\\varepsilon)/\\log \\log(1/\\varepsilon))$ と与えており、これはすべてのパラメータで下界に一致します。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Quantum algorithm for systems of linear equations with exponentially improved dependence on precision", authors: "Andrew M. Childs, Robin Kothari, Rolando D. Somma", year: "2015", url: "https://arxiv.org/abs/1511.02306" },
      { title: "Quantum singular value transformation and beyond: exponential improvements for quantum matrix arithmetics", authors: "András Gilyén, Yuan Su, Guang Hao Low, Nathan Wiebe", year: "2018", url: "https://arxiv.org/abs/1806.01838" },
      { title: "Optimal Hamiltonian Simulation by Quantum Signal Processing", authors: "Guang Hao Low, Isaac L. Chuang", year: "2016", url: "https://arxiv.org/abs/1606.02685" },
    ],
  },
  {
    kind: "method",
    id: "remez-minimax",
    label: "Remez exchange for a minimax polynomial",
    labelJa: "Remez 交換法によるミニマックス多項式",
    summary: "Rather than truncating a Chebyshev series, which is only near-optimal, run the Remez exchange algorithm to obtain the genuine minimax polynomial of a given degree. In the QSP setting it is the alternative front end, handing a tighter polynomial of the same degree to the phase-factor stage.",
    summaryJa: "ほぼ最適にとどまる級数の打ち切りに代えて、Remez 交換法を走らせ、与えられた次数における真のミニマックス多項式を求めます。QSP では、同じ次数でより誤差の小さい多項式を位相因子の段階へ渡す、もう一つの入口として使われます。",
    realizes: "polynomial-approximation",
    conditions: "Remez is a classical approximation-theory algorithm, not a quantum one. The citation here is the QSP paper that employs it, alongside a Fourier-Chebyshev expansion, and should not be read as its origin. In that use the coefficients are solved from a reference set of degree-plus-two sampled points, which is then adjusted.",
    conditionsJa: "Remez 法は古典的な近似理論のアルゴリズムであり、量子由来ではありません。ここでの引用は、この手法をフーリエ・チェビシェフ展開と並べて用いている QSP の論文であって、手法そのものの出典ではない点にご注意ください。その用法では、次数に 2 を加えた個数の標本点からなる参照集合について係数を解き、その参照集合を調整していきます。",
    cost: "Dong, Meng, Whaley and Lin state no complexity for the Remez exchange itself. Their stated benefit is comparative: for approximating $1/x$, the minimax polynomial reaches the same accuracy at a degree smaller by a factor of 2–3 than the Fourier–Chebyshev truncation — their Table III has degrees 303–1519 (odd parity) and 280–1400 (even) against 759–4035 for the truncation, at $\\varepsilon_0 = 10^{-14}$ over $\\kappa = 10$–$50$. Stated in the full text; the abstract carries no formula.",
    costJa: "Remez 交換法そのものの計算量を Dong・Meng・Whaley・Lin は述べていません。論文が述べているのは比較の形の利点です。$1/x$ の近似では、ミニマックス多項式は Fourier–Chebyshev 展開の打ち切りに比べ、同じ精度を 2〜3 分の 1 の次数で達成します。論文の表 III では、$\\varepsilon_0 = 10^{-14}$、$\\kappa = 10$〜$50$ の範囲で、打ち切りの次数 759〜4035 に対し、奇関数の場合 303〜1519、偶関数の場合 280〜1400 です。要旨ではなく本文に述べられています。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Efficient phase-factor evaluation in quantum signal processing", authors: "Yulong Dong, Xiang Meng, K. Birgitta Whaley, Lin Lin", year: "2020", url: "https://arxiv.org/abs/2002.11649" },
    ],
  },
  {
    kind: "capability",
    id: "block-encode-matrix",
    label: "Block-encode a matrix",
    labelJa: "行列のブロックエンコーディング",
    summary: "Wrap an operator $A$ inside a larger unitary $U$ so that $A/α$ sits in $U$'s top-left block, giving every routine above it one uniform way to touch the matrix. The subnormalization $α$ and the ancilla count are outputs of this layer, not free parameters.",
    summaryJa: "演算子 $A$ をより大きなユニタリ $U$ の左上ブロックに $A/α$ として埋め込み、上位のルーチンが行列に触れる経路を一本化します。副正規化係数 $α$ とアンシラ数はこの層が返す値であり、自由に決められる定数ではありません。",
    contract: {
      from: "matrix-access",
      to: "block-encoding",

      takes: "An access model for A — sparse-access oracles, a Pauli or LCU decomposition, a purification, or an explicit arithmetic description — plus a target precision ε.",
      takesJa: "A へのアクセスモデル（スパースアクセスのオラクル、Pauli/LCU 分解、純粋化、明示的な算術的記述のいずれか）と、目標精度 ε。",
      returns: "A unitary U on s+a qubits, its subnormalization α, and its ancilla/flag count a. Because ||U|| = 1, Gilyén, Su, Low and Wiebe's Definition 43 forces ||A|| ≤ α + ε.",
      returnsJa: "s+a 量子ビット上のユニタリ U、その副正規化係数 α、およびアンシラ（フラグ）数 a。||U|| = 1 であるため、Gilyén–Su–Low–Wiebe の Definition 43 により ||A|| ≤ α + ε が課されます。",
    },
    whyALayer: "Downstream query counts are linear in $\\alpha$, so the same matrix encoded two different ways can differ in end-to-end cost by orders of magnitude: $\\alpha = 1$ for a purified density operator, $||c||_1$ for a Pauli LCU, $sqrt(s_r·s_c)$ for sparse access under $|a_ij| \\leq 1$, and $2^n$ for FABLE. Comparing two block-encodings without comparing their $\\alpha$ says nothing. This is also where an exponential advantage most often dies quietly, because a construction that needs $\\Omega(N)$ gates to build $U$ erases whatever the solver above it saves — and most results at this layer are stated in queries to an oracle rather than in gates.",
    whyALayerJa: "上位のクエリ数は $\\alpha$ に比例するため、同じ行列でもエンコード方法が異なれば全体のコストは桁で変わります。純粋化された密度演算子なら $\\alpha = 1$、Pauli LCU なら $||c||_1$、$|a_ij| \\leq 1$ のスパースアクセスなら $sqrt(s_r·s_c)$、FABLE なら $2^n$ です。$\\alpha$ を比べずに二つのブロックエンコーディングを比較しても、何も言ったことになりません。指数的な優位が静かに失われるのもこの層です。$U$ の構成に $\\Omega(N)$ 個のゲートが必要なら、上位のソルバが節約した分はそこで相殺されます。しかもこの層の結果の多くは、ゲート数ではなくオラクルへのクエリ数で述べられています。",
  },
  {
    kind: "method",
    id: "sparse-access-block-encoding",
    label: "Sparse-access oracle construction",
    labelJa: "スパースアクセスオラクルによる構成",
    summary: "Given row and column index oracles $O_r$, $O_c$ and an entry oracle $O_A$, prepare uniform superpositions over the sparsity pattern, rotate an ancilla by arcsin of each entry, and swap registers to leave $A$ in the flagged block. This is the standard construction behind the sparse-Hamiltonian line, formalized as a block-encoding by Gilyén, Su, Low and Wiebe.",
    summaryJa: "行と列の添字オラクル $O_r$, $O_c$ と成分オラクル $O_A$ が与えられたとき、疎構造のパターン上に一様重ね合わせを作り、各成分の arcsin だけアンシラを回転させ、レジスタを入れ替えることで、フラグの立つブロックに $A$ を残します。スパースハミルトニアンの系譜を支えてきた標準的な構成で、Gilyén–Su–Low–Wiebe がブロックエンコーディングとして定式化しました。",
    realizes: "block-encode-matrix",
    conditions: "Needs $A$ to be $s_r$-row-sparse and $s_c$-column-sparse with $|a_ij| ≤ 1$ after rescaling, and needs the sparsity-pattern oracles $O_r$ and $O_c$ to be efficiently implementable. That is an assumption about structure, and it is separate from the question of whether it holds for a given application.",
    conditionsJa: "$A$ が $s_r$ 行スパースかつ $s_c$ 列スパースであり、再スケール後に $|a_ij| ≤ 1$ を満たすこと、および疎構造のパターンを与えるオラクル $O_r$, $O_c$ を効率的に実装できることが必要です。これは構造に関する仮定であり、対象の応用でそれが成り立つかどうかは別に確かめる必要があります。",
    cost: "Gilyén, Su, Low and Wiebe (arXiv:1806.01838) Lemma 48 gives a $(\\sqrt(s_r·s_c), w+3, \\varepsilon)$-block-encoding of $A$, using a single use of $O_r$, a single use of $O_c$, two uses of $O_A$, plus $O(w + \\log^{2.5}(s_r·s_c/\\varepsilon))$ one- and two-qubit gates. Lemma 48 assumes $|a_ij| \\leq 1$ and states $\\alpha = \\sqrt(s_r·s_c)$ flat; the $\\alpha = \\sqrt(s_r·s_c)·||A||_max$ form usually quoted is the standard rescaling, not what the lemma says.",
    costJa: "Gilyén–Su–Low–Wiebe（arXiv:1806.01838）の Lemma 48 は、$A$ の $(\\sqrt(s_r·s_c), w+3, \\varepsilon)$-ブロックエンコーディングを与えます。使用するのは $O_r$ を 1 回、$O_c$ を 1 回、$O_A$ を 2 回、加えて $O(w + \\log^{2.5}(s_r·s_c/\\varepsilon))$ 個の 1・2 量子ビットゲートです。Lemma 48 は $|a_ij| \\leq 1$ を仮定し、$\\alpha = \\sqrt(s_r·s_c)$ をそのまま述べています。よく引用される $\\alpha = \\sqrt(s_r·s_c)·||A||_max$ という形は標準的な再スケールであって、補題の記述そのものではありません。",
    contested: "The Lemma 48 count is in queries, not gates. Zhang and Yuan open the oracle: \"For general matrices (even including sparse ones), we prove that sparse-access input models and block-encoding both require nearly linear circuit complexities relative to the matrix dimension.\" A routine that is logarithmic in queries to an oracle whose own circuit is linear in $N$ is a linear-cost routine.",
    contestedJa: "Lemma 48 が数えているのはクエリ数であって、ゲート数ではありません。Zhang と Yuan はそのオラクルの中身を開き、「一般の行列については（スパースなものを含めても）、スパースアクセス入力モデルとブロックエンコーディングのいずれも、行列次元に対してほぼ線形の回路計算量を必要とすることを証明する」と述べています。オラクルへのクエリ数が対数的でも、そのオラクル自身の回路が $N$ に線形であれば、全体としては線形コストのルーチンです。",
    steps: [],
    citations: [
      { title: "Quantum singular value transformation and beyond: exponential improvements for quantum matrix arithmetics", authors: "András Gilyén, Yuan Su, Guang Hao Low, Nathan Wiebe", year: "2018", url: "https://arxiv.org/abs/1806.01838" },
      { title: "Circuit complexity of quantum access models for encoding classical data", authors: "Xiao-Ming Zhang, Xiao Yuan", year: "2023", url: "https://arxiv.org/abs/2311.11365" },
    ],
  },
  {
    kind: "method",
    id: "pauli-lcu-block-encoding",
    label: "Block-encoding from a Pauli decomposition",
    labelJa: "Pauli 分解によるブロックエンコーディング",
    shortLabel: "Pauli block-encoding",
    shortLabelJa: "Pauli ブロックエンコーディング",
    summary: "Write $A = Σ_j c_j P_j$ over Pauli strings; PREPARE loads amplitudes proportional to $sqrt(|c_j|)$ into an ancilla register, SELECT applies the controlled Pauli strings, and PREPARE$†$ unprepares, leaving $A/||c||_1$ in the block flagged by the all-zeros ancilla. This is the input model chemistry and lattice Hamiltonians supply for free.",
    summaryJa: "$A = Σ_j c_j P_j$ と Pauli 文字列で書き、PREPARE がアンシラレジスタに $sqrt(|c_j|)$ に比例する振幅を載せ、SELECT が制御付き Pauli 文字列を適用し、PREPARE$†$ が元に戻します。その結果、アンシラが全ゼロのフラグに対応するブロックに $A/||c||_1$ が残ります。量子化学や格子模型のハミルトニアンが、問題の定義からそのまま与えてくれる入力モデルです。",
    realizes: "block-encode-matrix",
    conditions: "Efficient only when the number of Pauli terms is $\\mathrm{poly}(n)$ and $||c||_1$ stays small. It does not rescue a general dense matrix: an arbitrary $2^n \\times 2^n$ matrix has $4^n$ Pauli coefficients, so this route is a win only where the physics hands you a short decomposition. Note also that a decomposition with many terms of comparable magnitude is expensive even when $A$ itself is well-conditioned, because the term count enters the cost through $||c||_1$.",
    conditionsJa: "効率的なのは、Pauli 項の数が $\\mathrm{poly}(n)$ で、かつ $||c||_1$ が小さく保たれる場合に限られます。一般の密行列は救えません。任意の $2^n \\times 2^n$ 行列は $4^n$ 個の Pauli 係数を持つため、この経路が有利になるのは物理側が短い分解を与えてくれる場合だけです。また、同程度の大きさの項が多数並ぶ分解は、$A$ 自体の条件数が良くても高くつきます。項数は $||c||_1$ を通じてコストに直接入るからです。",
    cost: "Gilyén, Su, Low and Wiebe (arXiv:1806.01838) Lemma 52: with $(P_L, P_R)$ a $(\\beta, b, \\varepsilon_1)$-state-preparation-pair for the coefficient vector and each $U_j$ an $(\\alpha, a, \\varepsilon_2)$-block-encoding, the result is an $(\\alpha\\cdot\\beta, a+b, \\alpha\\cdot\\varepsilon_1 + \\alpha\\cdot\\beta\\cdot\\varepsilon_2)$-block-encoding using a single use each of SELECT, $P_R$ and $P_L†$, with $\\beta \\geq ||y||_1$ required by their Definition 51 — for a Pauli decomposition this is the $\\lambda = ||c||_1$ of the chemistry literature. Babbush et al. give a SELECT/PREPARE compilation with T-gate complexity $O(N + \\log(1/\\varepsilon))$ for $N$ orbitals, enabling qubitized phase estimation with optimal query complexity $O(\\lambda/\\varepsilon)$. The $b = ceil(\\log2 L)$ flag-qubit count for $L$ terms is implied by Definition 51's requirement $2^b \\geq L$; Lemma 52 does not state it.",
    costJa: "Gilyén–Su–Low–Wiebe（arXiv:1806.01838）の Lemma 52 によれば、係数ベクトルに対する $(\\beta, b, \\varepsilon_1)$-state-preparation-pair を $(P_L, P_R)$、各 $U_j$ を $(\\alpha, a, \\varepsilon_2)$-ブロックエンコーディングとするとき、結果は $(\\alpha\\cdot\\beta, a+b, \\alpha\\cdot\\varepsilon_1 + \\alpha\\cdot\\beta\\cdot\\varepsilon_2)$-ブロックエンコーディングとなり、SELECT・$P_R$・$P_L†$ をそれぞれ 1 回ずつ使います。Definition 51 が $\\beta \\geq ||y||_1$ を要求しており、Pauli 分解の場合これが量子化学の文献でいう $\\lambda = ||c||_1$ にあたります。Babbush らは $N$ 個の軌道に対して T ゲート計算量 $O(N + \\log(1/\\varepsilon))$ の SELECT/PREPARE 実装を与え、qubitization 型の位相推定に最適なクエリ計算量 $O(\\lambda/\\varepsilon)$ をもたらしています。$L$ 項に対するフラグ量子ビット数 $b = ceil(\\log2 L)$ は Definition 51 の要件 $2^b \\geq L$ から導かれるものであり、Lemma 52 が述べているわけではありません。",
    steps: ["state-preparation"],
    entries: ["linear-combination-unitaries"],
    citations: [
      { title: "Quantum singular value transformation and beyond: exponential improvements for quantum matrix arithmetics", authors: "András Gilyén, Yuan Su, Guang Hao Low, Nathan Wiebe", year: "2018", url: "https://arxiv.org/abs/1806.01838" },
      { title: "Encoding Electronic Spectra in Quantum Circuits with Linear T Complexity", authors: "Ryan Babbush, Craig Gidney, Dominic W. Berry, Nathan Wiebe, Jarrod McClean, Alexandru Paler, Austin Fowler, Hartmut Neven", year: "2018", url: "https://arxiv.org/abs/1805.03662" },
    ],
  },
  {
    kind: "method",
    id: "fable-approximate-block-encoding",
    label: "FABLE approximate circuit construction",
    labelJa: "FABLE による近似回路構成",
    summary: "Build the block-encoding directly from uniformly controlled Ry (magnitude) and Rz (phase) rotations between Hadamards and a SWAP, with no oracle assumption at all, then threshold the rotation angles and cancel the resulting CNOT chains to compress the circuit.",
    summaryJa: "一様制御された Ry（大きさ）と Rz（位相）の回転を、Hadamard と SWAP で挟む形に組み、オラクルを一切仮定せずにブロックエンコーディング回路を直接構成します。そのうえで回転角にしきい値を設け、生じた CNOT の連鎖を打ち消すことで回路を圧縮します。",
    realizes: "block-encode-matrix",
    conditions: "Requires |a_ij| ≤ 1. The authors state the gate complexity is \"bounded by O(N^2) gates with a modest prefactor of 2 for real-valued matrices (4 for complex-valued matrices), and a limited polylogarithmic overhead\", and that \"this gate complexity scales exponentially in the number of qubits for generic dense matrices\". So this is a compression technique for structured matrices — Heisenberg, Hubbard, Laplacian — and not a way to load dense unstructured data cheaply. The paper states only that the circuit parameters can be easily generated for problems up to fifteen qubits.",
    conditionsJa: "|a_ij| ≤ 1 が必要です。著者らはゲート計算量について「実数行列では控えめな係数 2（複素数行列では 4）を伴う O(N^2) ゲートと、限定的な多重対数のオーバーヘッドで抑えられる」とし、さらに「このゲート計算量は一般的な密行列に対して量子ビット数に関して指数的に増大する」と述べています。つまりこれは Heisenberg 模型・Hubbard 模型・ラプラシアンのような構造を持つ行列のための圧縮手法であって、構造を持たない密なデータを安く読み込む方法ではありません。論文が述べているのは、15 量子ビット程度までの問題であれば回路パラメータを容易に生成できる、ということだけです。",
    cost: "Camps and Van Beeumen's Theorem 1 states the circuit is an \"$(1/2^n, n+1)$-block-encoding\" of $A$ when $|a_ij| \\leq 1$, and Theorem 2 that a cutoff compression threshold $\\delta_c$ gives an $(1/2^n, n+1, N^3\\cdot\\delta_c)$-block-encoding of $A$ up to third order in $\\delta_c$.",
    costJa: "Camps と Van Beeumen の Theorem 1 は、$|a_ij| \\leq 1$ のとき当該回路が $A$ の「$(1/2^n, n+1)$-ブロックエンコーディング」であると述べ、Theorem 2 は、打ち切り圧縮のしきい値 $\\delta_c$ を用いると $\\delta_c$ の 3 次までの範囲で $A$ の $(1/2^n, n+1, N^3\\cdot\\delta_c)$-ブロックエンコーディングが得られると述べています。",
    contested: "The stated parameter $1/2^n$ is inconsistent with the paper's own Definition 1, which sets A = α·Ã and therefore $||A||_2 \\leq \\alpha$ — the same orientation as Gilyén et al.'s Definition 43, not its reciprocal — while the Theorem 1 proof derives a block equal to $a_ij/2^n$. Under either paper's definition the subnormalization is $\\alpha = 2^n = N$. This applies to the arXiv text as served; a journal version may differ.",
    contestedJa: "述べられているパラメータ $1/2^n$ は、論文自身の Definition 1 と整合しません。Definition 1 は A = α·Ã と置き、したがって $||A||_2 \\leq \\alpha$ を導きます。これは Gilyén らの Definition 43 と同じ向きであって、その逆数ではありません。一方 Theorem 1 の証明は $a_ij/2^n$ に等しいブロックを導出しています。どちらの論文の定義を採っても、副正規化係数は $\\alpha = 2^n = N$ です。これは現在配信されている arXiv 版に対する指摘であり、雑誌掲載版では異なる可能性があります。",
    steps: [],
    atomic: true,
    citations: [
      { title: "FABLE: Fast Approximate Quantum Circuits for Block-Encodings", authors: "Daan Camps, Roel Van Beeumen", year: "2022", url: "https://arxiv.org/abs/2205.00081" },
      { title: "Quantum singular value transformation and beyond: exponential improvements for quantum matrix arithmetics", authors: "András Gilyén, Yuan Su, Guang Hao Low, Nathan Wiebe", year: "2018", url: "https://arxiv.org/abs/1806.01838" },
    ],
  },
  {
    kind: "capability",
    id: "state-preparation",
    label: "Prepare an input state",
    labelJa: "入力状態の準備",
    summary: "Map $|0\\ldots0⟩$ to a state whose amplitudes are proportional to a specified vector $b$, to within $\\varepsilon$. The cost is set by which description of $b$ you hold, not by the algorithm that consumes it.",
    summaryJa: "$|0\\ldots0⟩$ を、指定されたベクトル $b$ に比例する振幅を持つ状態へ、誤差 $\\varepsilon$ 以内で写します。コストを決めるのは $b$ がどの形で与えられているかであり、その状態を使う上位アルゴリズムではありません。",
    contract: {
      from: "state-description",
      to: "prepared-state",

      takes: "A description of b — an explicit list of 2^n amplitudes, an analytic density, a list of d nonzero entries, or a low-bond-dimension tensor network — plus a target ε.",
      takesJa: "b の記述（2^n 個の振幅の明示的なリスト、解析的な確率密度、d 個の非ゼロ成分のリスト、結合次元の小さいテンソルネットワークのいずれか）と、目標精度 ε。",
      returns: "An n-qubit circuit, possibly using ancillas, with a stated gate count, depth, ancilla count, and — where the circuit is not deterministic — a success probability.",
      returnsJa: "n 量子ビットの回路（アンシラを使う場合もあります）と、そのゲート数・深さ・アンシラ数、および回路が決定的でない場合は成功確率。",
    },
    whyALayer: "Dense unstructured preparation costs $\\Theta(2^n)$ gates, and ancillas do not remove it. Yuan and Zhang pin the depth to $\\Theta(n + 2^n/(n+m))$ and the size to $\\Theta(2^n)$ for any number $m$ of ancillary qubits. Ancillas buy depth, not gates. So a pipeline that loads a dense unstructured right-hand side pays $\\Omega(N)$ gates at the input and has no exponential advantage regardless of how good the solver above it is. An end-to-end exponential speedup requires $b$ to be sparse, analytically specified, low-bond-dimension, or produced by an earlier quantum subroutine — never that it be an arbitrary classical vector. That description-dependent cliff, not the solver, is what decides the pipeline.",
    whyALayerJa: "構造を持たない密なベクトルの準備には $\\Theta(2^n)$ 個のゲートが必要で、アンシラを増やしてもこの数は減りません。Yuan と Zhang は、アンシラ数 $m$ がいくつであっても深さが $\\Theta(n + 2^n/(n+m))$、サイズが $\\Theta(2^n)$ になることを確定させました。アンシラで買えるのは深さであって、ゲート数ではありません。したがって、構造を持たない密なベクトルを右辺として読み込むパイプラインは入力の時点で $\\Omega(N)$ 個のゲートを支払い、その上のソルバがどれほど優れていても指数的な優位は残りません。端から端まで指数的な高速化が成り立つのは、$b$ がスパースであるか、解析的に指定されているか、結合次元が小さいか、前段の量子サブルーチンが生成した場合に限られ、任意の古典ベクトルであってはなりません。パイプラインの成否を決めるのはソルバではなく、この記述の形に依存する段差です。",
  },
  {
    kind: "method",
    id: "uniformly-controlled-rotations",
    label: "Uniformly controlled rotations",
    labelJa: "一様制御回転による準備",
    summary: "Prepare an arbitrary state with one layer of uniformly controlled (multiplexed) Ry and Rz rotations per qubit, the angles computed analytically from the amplitude list. This is the exact, assumption-free method most software stacks emit by default.",
    summaryJa: "量子ビットごとに一様制御（多重化）された Ry・Rz 回転を 1 層ずつ重ね、振幅のリストから解析的に求めた角度を与えることで、任意の状態を準備します。仮定を置かない厳密な方法であり、多くのソフトウェアが既定で出力するのもこれです。",
    realizes: "state-preparation",
    conditions: "Applies to any state, with no structural assumption — which is exactly why it cannot beat the exponential bound. Ancilla-free in its basic form.",
    conditionsJa: "構造に関する仮定を一切置かず、任意の状態に適用できます。だからこそ指数的な下界を破れません。基本形ではアンシラを使いません。",
    cost: "Möttönen, Vartiainen, Bergholm and Salomaa give $2^{n+2} − 4n − 4$ CNOT gates and $2^{n+2} − 5$ one-qubit rotations, with an analytic expression for the angles. Yuan and Zhang settle the ancilla-assisted case, pinning the depth complexity to $\\Theta(n + 2^n/(n+m))$ and the size complexity to $\\Theta(2^n)$ for any number $m$ of ancillary qubits. Li and Luo independently give size $\\Theta(n·d/\\log(n·d) + n)$ for an $n$-qubit $d$-sparse state with unlimited ancillas; the substitution $d = 2^n$ that turns this into $\\Theta(2^n)$ is arithmetic we performed, not a statement in their paper.",
    costJa: "Möttönen–Vartiainen–Bergholm–Salomaa は $2^{n+2} − 4n − 4$ 個の CNOT ゲートと $2^{n+2} − 5$ 個の 1 量子ビット回転を与え、角度の解析的な表式も示しています。Yuan と Zhang はアンシラを併用する場合を決着させ、アンシラ数 $m$ がいくつであっても深さ計算量が $\\Theta(n + 2^n/(n+m))$、サイズ計算量が $\\Theta(2^n)$ であることを確定させました。Li と Luo は独立に、アンシラ数無制限のもとで $n$ 量子ビットの $d$ スパース状態のサイズが $\\Theta(n·d/\\log(n·d) + n)$ であることを与えています。これを $\\Theta(2^n)$ に変える $d = 2^n$ の代入は本項での計算であり、論文の記述ではありません。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Transformation of quantum states using uniformly controlled rotations", authors: "Mikko Mottonen, Juha J. Vartiainen, Ville Bergholm, Martti M. Salomaa", year: "2004", url: "https://arxiv.org/abs/quant-ph/0407010" },
      { title: "Optimal (controlled) quantum state preparation and improved unitary synthesis by quantum circuits with any number of ancillary qubits", authors: "Pei Yuan, Shengyu Zhang", year: "2022", url: "https://arxiv.org/abs/2202.11302" },
      { title: "Nearly Optimal Circuit Size for Sparse Quantum State Preparation", authors: "Lvzhou Li, Jingquan Luo", year: "2024", url: "https://arxiv.org/abs/2406.16142" },
    ],
  },
  {
    kind: "method",
    id: "grover-rudolph-preparation",
    label: "Grover-Rudolph bisection preparation",
    labelJa: "Grover–Rudolph の二分割による準備",
    summary: "Prepare a discrete approximation to a probability density by recursive bisection: at layer $k$ a uniformly controlled rotation splits each current interval's probability mass between its two halves, so only $n$ rotation layers are needed.",
    summaryJa: "再帰的な二分割によって確率密度の離散近似を準備します。第 $k$ 層では一様制御回転が、その時点の各区間の確率質量を左右の半区間に振り分けます。必要な回転層は $n$ 層だけです。",
    realizes: "state-preparation",
    conditions: "Sound where the subinterval integrals are genuinely available in closed form or from an efficient deterministic routine. Grover and Rudolph's own text points at Monte Carlo for the log-concave case — \"A well known set of probability density functions which are efficiently integrable by monte carlo methods are log-concave distributions\" — so \"efficiently integrable\" and \"log-concave\" are not the same class, and the method is routinely cited as if they were.",
    conditionsJa: "部分区間の積分が閉じた形で、あるいは効率的な決定的手続きで実際に得られる場合には健全な方法です。Grover と Rudolph 自身の本文は、対数凹の場合について Monte Carlo を指しています（「モンテカルロ法で効率的に積分できる確率密度関数のよく知られた一群が、対数凹分布である」）。つまり「効率的に積分可能」と「対数凹」は同じ範疇ではありませんが、両者を同一視した引用が繰り返されています。",
    contested: "Herbert shows the method carries no end-to-end quantum speedup when the interval integrals are obtained the way Grover and Rudolph prescribe. Quantum Monte-Carlo RMSE decays as $\\Theta(1/N_q)$ in the number of queries $N_q$ to the state-preparation circuit, whereas the classical Monte-Carlo RMSE used to compute those interval integrals decays only as $\\Theta(1/sqrt(N_s))$ in the number of samples $N_s$; Herbert's Theorem 1 concludes that reaching RMSE $ε̂$ then costs $Ω̃(1/ε̂²)$ operations, which is the classical rate.",
    contestedJa: "Herbert は、区間積分を Grover と Rudolph が指定した方法で求める限り、端から端までの量子的な高速化は得られないことを示しました。量子モンテカルロの RMSE は状態準備回路へのクエリ数 $N_q$ に対して $\\Theta(1/N_q)$ で減少しますが、その区間積分を計算する古典モンテカルロの RMSE はサンプル数 $N_s$ に対して $\\Theta(1/sqrt(N_s))$ でしか減少しません。Herbert の Theorem 1 は、RMSE $ε̂$ を達成するには $Ω̃(1/ε̂²)$ 回の演算を要すると結論しており、これは古典的な速度です。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Creating superpositions that correspond to efficiently integrable probability distributions", authors: "Lov Grover, Terry Rudolph", year: "2002", url: "https://arxiv.org/abs/quant-ph/0208112" },
      { title: "The Problem with Grover-Rudolph State Preparation for Quantum Monte-Carlo", authors: "Steven Herbert", year: "2021", url: "https://arxiv.org/abs/2101.02240" },
    ],
  },
  {
    kind: "method",
    id: "sparse-state-preparation",
    label: "Sparse state preparation",
    labelJa: "スパース状態の準備",
    summary: "When only $d$ of the $2^n$ amplitudes are nonzero, build the $d$ computational-basis strings directly instead of rotating through the whole binary tree, so the cost tracks $d$ and $n$ rather than $2^n$.",
    summaryJa: "$2^n$ 個の振幅のうち非ゼロが $d$ 個だけの場合、二分木全体を回転で辿るのではなく、$d$ 個の計算基底文字列を直接組み立てます。これによりコストは $2^n$ ではなく $d$ と $n$ で決まります。",
    realizes: "state-preparation",
    conditions: "Requires the state to be $d$-sparse in the computational basis with $d$ small, and the support to be known in advance. Sparsity is basis-dependent: a state that is sparse in one basis is generally dense in another, so this is a property of the problem's encoding as much as of the state.",
    conditionsJa: "状態が計算基底で $d$ スパースであり、$d$ が小さく、台があらかじめ分かっている必要があります。スパース性は基底に依存する性質です。ある基底でスパースな状態は、別の基底では一般に密になります。つまりこれは状態の性質であると同時に、問題のエンコードの仕方の性質でもあります。",
    cost: "Gleinig and Hoefler's Eq. 5 gives $T_CNOT(|S|)$ in $O(|S|·n)$ for an $n$-qubit state with $|S|$ nonzero coefficients, ancilla-free. Li and Luo give matching bounds: without ancillas, size $O(n·d/\\log n + n)$, asymptotically optimal when $d = \\mathrm{poly}(n)$; with $m$ ancillas, size $O(n·d/\\log(n+m) + n)$ for any $m ∈ O(n·d/\\log(n·d) + n)$, with a matching lower bound $\\Omega(n·d/\\log(n+m) + n)$ under reasonable assumptions; with unlimited ancillas, size exactly $\\Theta(n·d/\\log(n·d) + n)$.",
    costJa: "Gleinig と Hoefler の Eq. 5 は、非ゼロ係数が $|S|$ 個の $n$ 量子ビット状態に対して $T_CNOT(|S|)$ が $O(|S|·n)$ であることを与えています。アンシラは使いません。Li と Luo は対応する上下界を与えています。アンシラなしではサイズ $O(n·d/\\log n + n)$ で、$d = \\mathrm{poly}(n)$ のとき漸近的に最適です。アンシラ $m$ 個（$m ∈ O(n·d/\\log(n·d) + n)$）ではサイズ $O(n·d/\\log(n+m) + n)$ で、妥当な仮定のもとで一致する下界 $\\Omega(n·d/\\log(n+m) + n)$ が付きます。アンシラ数無制限ではサイズはちょうど $\\Theta(n·d/\\log(n·d) + n)$ です。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Nearly Optimal Circuit Size for Sparse Quantum State Preparation", authors: "Lvzhou Li, Jingquan Luo", year: "2024", url: "https://arxiv.org/abs/2406.16142" },
      { title: "An Efficient Algorithm for Sparse Quantum State Preparation", authors: "Gleinig, Hoefler", year: "2021", url: "https://doi.org/10.1109/dac18074.2021.9586240" },
    ],
  },
  {
    kind: "capability",
    id: "success-amplification",
    label: "Amplify a success branch",
    labelJa: "成功分岐の増幅",
    summary: "Take a routine whose output lands in the wanted subspace only with probability $a$, and raise that probability to near 1 using quadratically fewer repetitions than restarting the routine would need.",
    summaryJa: "出力が目的の部分空間に確率 $a$ でしか入らないルーチンを受け取り、単純にやり直す場合に比べて二次的に少ない繰り返し回数で、その確率を 1 近くまで引き上げます。",
    contract: {
      from: "flagged-routine",
      to: "reliable-routine",

      takes: "The preparation unitary A and its inverse, a reflection about |0⟩, and a reflection marking the good subspace — the Grover operator Q = −A S_0 A^{-1} S_χ must be applicable at arbitrary powers. Individual variants additionally require a lower bound on a, or a per-branch stopping flag.",
      takesJa: "準備ユニタリ A とその逆、|0⟩ に関する反射、そして良い部分空間に印を付ける反射。すなわち Grover 演算子 Q = −A S_0 A^{-1} S_χ を任意のべき乗で適用できる必要があります。方式によっては、これに加えて a の下界、あるいは分岐ごとの停止フラグが必要です。",
      returns: "A routine that produces the wanted branch with a stated failure probability, together with the query count and the maximum sequential depth consumed.",
      returnsJa: "目的の分岐を、明示された失敗確率のもとで生成するルーチン。あわせて消費したクエリ数と逐次深さの最大値を返します。",
    },
    whyALayer: "Every LCU and block-encoding construction succeeds only on an all-zeros ancilla flag, so this layer is structural rather than optional. Its realizations demand different things: textbook amplification needs the success amplitude to be known, fixed-point amplification needs only a lower bound on it, and variable-time amplification needs the amplified routine to break into stages that stop at different times. What changes between them is the maximum sequential depth, which is the resource a coherence-limited device actually runs out of first.",
    whyALayerJa: "LCU やブロックエンコーディングの構成は、いずれもアンシラが全ゼロのときにしか成功しません。したがってこの層は選択肢ではなく構造上必ず現れます。実現方式が要求するものは互いに異なります。教科書的な増幅は成功振幅が既知であることを求め、不動点型の増幅はその下界だけで足り、可変時間型の増幅は増幅対象が異なる時刻で停止する段に分解できることを求めます。方式によって変わるのは逐次深さの最大値であり、コヒーレンス時間の限られた装置が最初に使い果たすのはこの資源です。",
    entries: ["amplitude-amplification"],
  },
  {
    kind: "method",
    id: "fixed-point-amplification",
    label: "Fixed-point amplification",
    labelJa: "不動点型の増幅",
    summary: "Replace the $±1$ reflections of textbook amplification with tuned phase shifts, so the iteration converges on the target instead of rotating past it — which is what happens when the initial success amplitude is known only as a lower bound.",
    summaryJa: "教科書的な増幅における $±1$ の反射を、調整された位相シフトに置き換えます。これにより反復は目標を通り過ぎるのではなく目標へ収束します。初期の成功振幅が下界としてしか分かっていない場合に起きるのが、この「通り過ぎ」です。",
    realizes: "success-amplification",
    conditions: "Needs a reliable lower bound on the fraction $\\lambda$ of the initial state made up of target states, rather than $\\lambda$ itself. Grover's earlier $\\pi/3$ construction achieves fixed-point convergence but, as Yoder, Low and Chuang put it, such algorithms \"lose the very quadratic advantage that makes Grover's algorithm so appealing\". Their own construction is described by them as \"the first version of amplitude amplification that achieves fixed-point behavior without sacrificing the quantum speedup\", and it carries an adjustable bound on the failure probability.",
    conditionsJa: "必要なのは $\\lambda$ そのものではなく、初期状態のうち目標状態が占める割合 $\\lambda$ の信頼できる下界です。Grover による先行の $\\pi/3$ 構成は不動点的な収束を達成しますが、Yoder–Low–Chuang の表現を借りれば、この種のアルゴリズムは「Grover のアルゴリズムを魅力的にしているまさにその二次的な優位を失う」ものです。彼ら自身の構成については「量子的な高速化を犠牲にせずに不動点的な挙動を達成する、振幅増幅の最初の方式」と述べられており、失敗確率の上界を調整できる点も特徴です。",
    // `cost` (session 123): from the abstract of arxiv:1409.3305 (register
    // `reportsBasis: "abstract"`), which states no formula — the field carries
    // the abstract's comparative and optimality claims and says exactly that.
    // The "without sacrificing" quote lives in `conditions` above; this field
    // deliberately does not repeat it.
    cost: "The abstract states no query-count formula; its cost claims are comparative. The construction keeps the quadratic quantum speedup that fixed-point predecessors gave up, and the optimality named in the title is of exactly this shape: for a given number of oracle queries, the adjustable failure-probability bound is guaranteed, as Yoder, Low and Chuang put it, over \"the broadest possible range\" of the target fraction $\\lambda$. The explicit query count as a function of $\\lambda$'s lower bound and the failure tolerance is in the paper's full text and is not quoted here.",
    costJa: "概要はクエリ数の式を述べておらず、費用に関する主張は比較の形をとります。この構成は、先行する不動点型の手法が手放していた二次的な量子高速化を保持します。表題にある「最適」もまさにこの形のものです。すなわち、オラクルへのクエリ数を固定したとき、調整可能な失敗確率の上界が、Yoder・Low・Chuang の言う「可能な限り広い範囲」の目標割合 $\\lambda$ にわたって保証されます。$\\lambda$ の下界と許容失敗確率の関数としての明示的なクエリ数は論文の本文にあり、ここでは引用していません。",
    steps: ["state-preparation"],
    citations: [
      { title: "Fixed-point quantum search with an optimal number of queries", authors: "Theodore J. Yoder, Guang Hao Low, Isaac L. Chuang", year: "2014", url: "https://arxiv.org/abs/1409.3305" },
      { title: "A different kind of quantum search", authors: "Lov K. Grover", year: "2005", url: "https://arxiv.org/abs/quant-ph/0503205" },
      { title: "Quantum Amplitude Amplification and Estimation", authors: "Gilles Brassard, Peter Hoyer, Michele Mosca, Alain Tapp", year: "2000", url: "https://arxiv.org/abs/quant-ph/0005055" },
    ],
  },
  {
    kind: "method",
    id: "variable-time-amplification",
    label: "Variable-time amplification",
    labelJa: "可変時間増幅",
    summary: "When the branches of the amplified routine stop at different times, amplify in nested stages so branches that finish early are not charged at the worst-case depth.",
    summaryJa: "増幅対象のルーチンの各分岐が異なる時刻に停止する場合、増幅を入れ子の段に分けて行い、早く終わる分岐に最悪ケースの深さを課さないようにします。",
    realizes: "success-amplification",
    conditions: "Requires the amplified algorithm to decompose into stages carrying a per-branch stopping flag; a routine with a single uniform stopping time gains nothing from it. Its natural position is above a solver whose branches differ in cost — which is where the $\\kappa$ dependence of a linear-system solve actually lives — rather than above a bare preparation.",
    conditionsJa: "増幅対象のアルゴリズムが、分岐ごとの停止フラグを持つ段に分解できることが必要です。停止時刻が一様なルーチンでは何も得られません。本来の位置づけは、分岐ごとにコストが異なるソルバの上です。線形方程式の求解における $\\kappa$ 依存性が実際に宿るのもそこであり、単なる状態準備の上ではありません。",
    cost: "Ambainis states his generalization of amplitude amplification \"to the case when parts of the quantum algorithm that is being amplified stop at different times\" improves the running time of the Harrow et al. linear-systems algorithm \"from O(kappa^2 log N) to O(kappa log^3 kappa log N) where kappa is the condition number of the system of equations\". Chakraborty, Gilyén and Jeffery build on it directly: they \"develop a technique of variable-time amplitude estimation, based on Ambainis' variable-time amplitude amplification technique\".",
    costJa: "Ambainis は、振幅増幅を「増幅されている量子アルゴリズムの各部分が異なる時刻で停止する場合」へ一般化することにより、Harrow らの線形方程式アルゴリズムの実行時間を「O(kappa^2 log N) から O(kappa log^3 kappa log N) へ（kappa は方程式系の条件数）」改善すると述べています。Chakraborty–Gilyén–Jeffery はこれを直接踏まえ、「Ambainis の可変時間振幅増幅の技法に基づく可変時間振幅推定の技法を開発する」と述べています。",
    steps: [],
    citations: [
      { title: "Variable time amplitude amplification and a faster quantum algorithm for solving systems of linear equations", authors: "Andris Ambainis", year: "2010", url: "https://arxiv.org/abs/1010.4458" },
      { title: "The power of block-encoded matrix powers: improved regression techniques via faster Hamiltonian simulation", authors: "Shantanav Chakraborty, András Gilyén, Stacey Jeffery", year: "2018", url: "https://arxiv.org/abs/1804.01973" },
    ],
  },
  {
    kind: "capability",
    id: "hamiltonian-simulation",
    label: "Simulate Hamiltonian evolution",
    labelJa: "ハミルトニアン時間発展のシミュレーション",
    summary: "Implement $e^{-iHt}$ to error $\\varepsilon$ given some access model for $H$. It is an application in its own right and also the engine inside phase estimation and several linear-system solvers.",
    summaryJa: "$H$ へのアクセスモデルが与えられたとき、$e^{-iHt}$ を誤差 $\\varepsilon$ 以内で実装します。これ自体が応用であると同時に、位相推定やいくつかの線形方程式ソルバの内部機構でもあります。",
    contract: {
      from: "hamiltonian-access",
      to: "evolution-circuit",

      takes: "An access model for H — a sum of efficiently exponentiable terms, sparse-access oracles, or a block-encoding — plus an evolution time t and a target error ε.",
      takesJa: "H へのアクセスモデル（直接指数化できる項の和、スパースアクセスのオラクル、ブロックエンコーディングのいずれか）と、発展時間 t、目標誤差 ε。",
      returns: "A circuit approximating e^{-iHt} to within ε, with a stated query or gate count, an ancilla count, and the norm parameter — sparsity times ||H||_max, or the LCU 1-norm — that the cost is measured against.",
      returnsJa: "e^{-iHt} を誤差 ε 以内で近似する回路。あわせてクエリ数またはゲート数、アンシラ数、そしてコストの基準となるノルムのパラメータ（スパース度と ||H||_max の積、あるいは LCU の 1-ノルム）を返します。",
    },
    whyALayer: "The families here consume genuinely different inputs and pay in different currencies. Product formulas need only a term decomposition and build no block-encoding, but carry a polynomial dependence on $1/\\varepsilon$. LCU and qubitization need a block-encoding and its ancillas and reach a logarithmic dependence on $1/\\varepsilon$. Which is cheaper depends on the precision regime and on the structure of $H$, so a cost model that names \"Hamiltonian simulation\" without naming the family has not costed anything. The norm parameter is inherited from the block-encoding layer below, which is where the constant that dominates real resource estimates is actually fixed.",
    whyALayerJa: "ここに並ぶ系統は、消費する入力も支払う通貨も本当に異なります。積公式は項への分解だけを必要とし、ブロックエンコーディングを構成しませんが、$1/\\varepsilon$ に対する依存は多項式です。LCU と qubitization はブロックエンコーディングとそのアンシラを必要とする代わりに、$1/\\varepsilon$ に対して対数的な依存に到達します。どちらが安いかは要求精度の領域と $H$ の構造で決まるため、系統を指定せずに「ハミルトニアンシミュレーション」とだけ書いたコスト見積もりは、何も見積もっていません。ノルムのパラメータは下位のブロックエンコーディング層から継承され、実際の資源見積もりを支配する定数はそこで決まります。",
    entries: ["trotter-suzuki-simulation", "hamiltonian-simulation-ising"],
  },
  {
    kind: "method",
    id: "product-formula-simulation",
    label: "Product-formula (Trotter-Suzuki) simulation",
    labelJa: "積公式（Trotter–Suzuki）によるシミュレーション",
    shortLabel: "Trotter-Suzuki simulation",
    shortLabelJa: "Trotter–Suzuki シミュレーション",
    summary: "Split $H$ into terms that can each be exponentiated directly and alternate short evolutions of them — the Lie-Trotter formula and its higher-order generalizations. No block-encoding is built and there is no all-zeros flag to amplify.",
    summaryJa: "$H$ を、それぞれ直接指数化できる項に分け、短い時間発展を交互に適用します。Lie–Trotter 公式とその高次への一般化です。ブロックエンコーディングを構成せず、増幅すべき全ゼロのフラグもありません。",
    realizes: "hamiltonian-simulation",
    conditions: "Needs a decomposition of $H$ into efficiently exponentiable summands. The error is governed by commutators among those summands: Childs, Su, Tran, Wiebe and Zhu's analysis \"directly exploits the commutativity of operator summands, producing tighter error bounds for both real- and imaginary-time evolutions\", and they show local observables can be simulated with complexity independent of the system size for power-law interacting systems. Term ordering affects the error and is not fixed by the formula itself.",
    conditionsJa: "$H$ を効率的に指数化できる項の和に分解できることが必要です。誤差はそれらの項どうしの交換子で支配されます。Childs–Su–Tran–Wiebe–Zhu の解析は「演算子の項どうしの可換性を直接利用し、実時間・虚時間いずれの発展についてもより精密な誤差限界を与える」ものであり、べき則相互作用系については局所オブザーバブルを系のサイズに依存しない計算量でシミュレートできることも示しています。項の順序は誤差に影響しますが、公式自体がそれを定めるわけではありません。",
    cost: "In the sparse-access oracle model, Berry, Ahokas, Cleve and Sanders: when $H$ acts on $n$ qubits, has at most a constant number of nonzero entries in each row/column, and $||H||$ is bounded by a constant, one may select any positive integer $k$ such that the simulation requires $O((\\log* n)·t^{1+1/2k})$ accesses to matrix entries of $H$. They also show the temporal scaling cannot be significantly improved beyond this, because sublinear time scaling is not possible.",
    costJa: "スパースアクセスのオラクルモデルのもとで、Berry–Ahokas–Cleve–Sanders によれば、$H$ が $n$ 量子ビットに作用し、各行・各列の非ゼロ成分数が高々定数個で、$||H||$ が定数で抑えられているとき、任意の正整数 $k$ を選べて、シミュレーションは $H$ の行列成分への $O((\\log* n)·t^{1+1/2k})$ 回のアクセスを要します。さらに、時間に関するスケーリングはこれ以上大きくは改善できないことも示されています。時間に対する劣線形なスケーリングは不可能だからです。",
    contested: "The precision dependence is the weak point, and it is what the later families were built to fix: Berry, Childs, Cleve, Kothari and Somma's truncated-Taylor method has a cost depending logarithmically on the inverse of the desired precision, which the authors state is optimal. That does not make product formulas obsolete — the commutator bounds above often win on constants and on structured systems, and there is no ancilla overhead — but a high-precision cost model that quotes only a product formula has picked the wrong family.",
    contestedJa: "弱点は精度への依存性であり、後続の系統はまさにそれを直すために作られました。Berry–Childs–Cleve–Kothari–Somma の打ち切り Taylor 級数の方法では、コストは要求精度の逆数に対して対数的に依存し、著者らはこれが最適だと述べています。とはいえ積公式が時代遅れになったわけではありません。上記の交換子に基づく限界は、定数の面でも構造を持つ系でも有利になることが多く、アンシラの追加も不要です。ただし、高精度が要求される場面で積公式だけを引用したコスト見積もりは、選ぶ系統を誤っています。",
    steps: [],
    atomic: true,
    bypasses: ["block-encode-matrix"],
    entries: ["trotter-suzuki-simulation"],
    citations: [
      { title: "Efficient quantum algorithms for simulating sparse Hamiltonians", authors: "Dominic W. Berry, Graeme Ahokas, Richard Cleve, Barry C. Sanders", year: "2005", url: "https://arxiv.org/abs/quant-ph/0508139" },
      { title: "A Theory of Trotter Error", authors: "Andrew M. Childs, Yuan Su, Minh C. Tran, Nathan Wiebe, Shuchen Zhu", year: "2019", url: "https://arxiv.org/abs/1912.08854" },
      { title: "Simulating Hamiltonian dynamics with a truncated Taylor series", authors: "Dominic W. Berry, Andrew M. Childs, Richard Cleve, Robin Kothari, Rolando D. Somma", year: "2014", url: "https://arxiv.org/abs/1412.4687" },
    ],
  },
  {
    kind: "method",
    id: "lcu-taylor-simulation",
    label: "Truncated-Taylor LCU simulation",
    labelJa: "打ち切り Taylor 級数の LCU によるシミュレーション",
    summary: "Truncate the Taylor series of $e^{-iHt}$ over short segments and implement the truncated sum as a linear combination of unitaries — PREPARE loads the coefficients, SELECT applies the terms, PREPARE$†$ unprepares — with the all-zeros ancilla flag amplified.",
    summaryJa: "$e^{-iHt}$ の Taylor 級数を短い区間ごとに打ち切り、その有限和をユニタリの線形結合として実装します。PREPARE が係数を載せ、SELECT が各項を適用し、PREPARE$†$ が元に戻したうえで、アンシラが全ゼロのフラグを増幅します。",
    realizes: "hamiltonian-simulation",
    conditions: "Requires $H$ as a linear combination of efficiently implementable unitaries with a cheap PREPARE over the coefficients. The projection onto the wanted block succeeds only on the all-zeros flag, so amplification is part of the method rather than an afterthought, and the cost scales with the 1-norm of the coefficient vector rather than with $||H||$ — a decomposition with many comparable terms is expensive even for a benign $H$.",
    conditionsJa: "$H$ が効率的に実装できるユニタリの線形結合として与えられ、係数に対する PREPARE が安価であることが必要です。目的のブロックへの射影はアンシラが全ゼロのときにしか成功しないため、増幅は後付けではなく手法の一部です。またコストは $||H||$ ではなく係数ベクトルの 1-ノルムに比例します。同程度の大きさの項が多数並ぶ分解は、$H$ が扱いやすい場合でも高くつきます。",
    cost: "Berry, Childs, Cleve, Kothari and Somma: the cost of the algorithm depends logarithmically on the inverse of the desired precision, which the authors state is optimal. Berry, Childs and Kothari, using a linear combination of quantum walk steps with coefficients given by Bessel functions, report a complexity in queries and 2-qubit gates that is \"logarithmic in the inverse error, and nearly linear in the product $\\tau$ of the evolution time, the sparsity, and the magnitude of the largest entry of the Hamiltonian\".",
    costJa: "Berry–Childs–Cleve–Kothari–Somma によれば、このアルゴリズムのコストは要求精度の逆数に対して対数的に依存し、著者らはこれが最適だと述べています。Berry–Childs–Kothari は、Bessel 関数を係数とする量子ウォークのステップの線形結合を用い、クエリ数および 2 量子ビットゲート数で測った計算量が「誤差の逆数に対して対数的であり、発展時間・スパース度・ハミルトニアンの最大成分の大きさの積 $\\tau$ に対してほぼ線形である」と報告しています。",
    steps: ["block-encode-matrix", "state-preparation", "success-amplification"],
    entries: ["linear-combination-unitaries"],
    citations: [
      { title: "Simulating Hamiltonian dynamics with a truncated Taylor series", authors: "Dominic W. Berry, Andrew M. Childs, Richard Cleve, Robin Kothari, Rolando D. Somma", year: "2014", url: "https://arxiv.org/abs/1412.4687" },
      { title: "Hamiltonian simulation with nearly optimal dependence on all parameters", authors: "Dominic W. Berry, Andrew M. Childs, Robin Kothari", year: "2015", url: "https://arxiv.org/abs/1501.01715" },
      { title: "Hamiltonian Simulation Using Linear Combinations of Unitary Operations", authors: "Andrew M. Childs, Nathan Wiebe", year: "2012", url: "https://arxiv.org/abs/1202.5822" },
    ],
  },
  {
    kind: "method",
    id: "qubitization-simulation",
    label: "Qubitization walk simulation",
    labelJa: "qubitization ウォークによるシミュレーション",
    summary: "From a block-encoding pair $(U, |G⟩)$ with $H = (⟨G|⊗I)U(|G⟩⊗I)$, build a walk operator $W$ that splits the Hilbert space into invariant two-dimensional $SU(2)$ subspaces, one per eigenvalue of $H$, with eigenvalues $e^{±i·arccos(H/α)}$. Quantum signal processing phases applied to $W$ then produce $e^{-iHt}$.",
    summaryJa: "$H = (⟨G|⊗I)U(|G⟩⊗I)$ を満たすブロックエンコーディングの組 $(U, |G⟩)$ から、ヒルベルト空間を $H$ の固有値ごとに 2 次元の不変な $SU(2)$ 部分空間へ分解するウォーク演算子 $W$ を構成します。その固有値は $e^{±i·arccos(H/α)}$ です。$W$ に量子信号処理の位相を適用することで $e^{-iHt}$ が得られます。",
    realizes: "hamiltonian-simulation",
    conditions: "Applies to Hermitian $H$, and consumes a block-encoding-like access model rather than raw data, so it does not solve the data-input problem by itself. The subnormalization $\\alpha$ is inherited from whatever built the encoding and downstream cost is linear in it. The arccos spectral relation means eigenvalues near the edges of the spectrum are resolved differently from those near zero. On provenance: Low and Chuang build on Childs' extension of Szegedy's quantum walk rather than introducing the walk themselves.",
    conditionsJa: "エルミートな $H$ に適用されます。生のデータではなくブロックエンコーディングに類するアクセスモデルを消費するため、これ自体はデータ入力の問題を解決しません。副正規化係数 $\\alpha$ はエンコーディングを構成した側から継承され、上位のコストはそれに比例します。arccos による固有値の対応関係のため、スペクトルの端付近の固有値はゼロ付近の固有値とは異なる分解能で扱われます。来歴について一点。Low と Chuang はウォーク自体を導入したのではなく、Szegedy の量子ウォークを Childs が拡張したものの上に構成しています。",
    cost: "Low and Chuang state a query complexity $O(t + \\log(1/\\varepsilon))$ to both oracles \"that is optimal with respect to all parameters in both the asymptotic and non-asymptotic regime\", using at most two additional ancilla qubits. The approach subsumes prior sparse-Hamiltonian and linear-combination-of-unitaries approaches with significant improvements in space and gate complexity, such as a quadratic speed-up for precision simulations.",
    costJa: "Low と Chuang は、両方のオラクルに対するクエリ計算量 $O(t + \\log(1/\\varepsilon))$ が「漸近的な領域でも非漸近的な領域でも、すべてのパラメータに関して最適である」と述べ、追加のアンシラは高々 2 量子ビットであるとしています。この方法は従来のスパースハミルトニアン法およびユニタリの線形結合による方法を包含し、空間およびゲート計算量を大きく節約します。高精度のシミュレーションに対する二次的な高速化はその一例です。",
    steps: ["block-encode-matrix", "qsp-phase-factors"],
    entries: ["quantum-signal-processing"],
    citations: [
      { title: "Hamiltonian Simulation by Qubitization", authors: "Guang Hao Low, Isaac L. Chuang", year: "2016", url: "https://arxiv.org/abs/1610.06546" },
      { title: "Optimal Hamiltonian Simulation by Quantum Signal Processing", authors: "Guang Hao Low, Isaac L. Chuang", year: "2016", url: "https://arxiv.org/abs/1606.02685" },
      { title: "On the relationship between continuous- and discrete-time quantum walk", authors: "Andrew M. Childs", year: "2008", url: "https://arxiv.org/abs/0810.0312" },
    ],
  },
  {
    kind: "capability",
    id: "observable-estimation",
    label: "Estimate an observable",
    labelJa: "オブザーバブルの推定",
    summary: "Given the ability to prepare $|ψ⟩$ and a description of an observable $O$, return a classical scalar within $\\varepsilon$ of $⟨O⟩$ at confidence $1−δ$. The state is never returned; only the number is.",
    summaryJa: "$|ψ⟩$ を準備できることとオブザーバブル $O$ の記述が与えられたとき、$⟨O⟩$ から誤差 $\\varepsilon$ 以内の古典的なスカラー値を、信頼度 $1−δ$ で返します。状態そのものは返らず、返るのは数値だけです。",
    contract: {
      from: "prepared-state",
      to: "observable-value",

      takes: "A preparation routine A with A|0⟩ = |ψ⟩, or repeated copies of ρ; a description of O; a target additive error ε and a confidence 1−δ. Coherent, controlled access to A and A† is required by some methods here and by none of the sampling-based ones.",
      takesJa: "A|0⟩ = |ψ⟩ となる準備ルーチン A、または ρ のコピーの繰り返し供給。オブザーバブル O の記述。目標加法誤差 ε と信頼度 1−δ。A および A† へのコヒーレントな制御アクセスを要求する方式もありますが、サンプリングに基づく方式は要求しません。",
      returns: "A scalar estimate with a stated additive-error guarantee, plus the shot or query budget and the maximum circuit depth actually consumed.",
      returnsJa: "加法誤差の保証が明示されたスカラー推定値。あわせて、実際に消費したショット数（またはクエリ数）と回路深さの最大値を返します。",
    },
    whyALayer: "Reading out the full solution vector destroys the speedup. A classical description of an $n$-qubit state is $2^n$ numbers before any sampling cost is counted, and reconstructing it costs $O(rank(ρ)·d/ε²) \\leq O(d²/ε²)$ copies for trace-distance error $\\varepsilon$ with $d = 2^n$ (O'Donnell and Wright — upper bounds only). This layer exists because the useful question is almost always a scalar: one $⟨x|M|x⟩$ rather than $x$ itself. That is what HHL actually delivers, and it is one of the conditions Aaronson's \"Read the fine print\" (Nature Physics 11, 291–293, 2015) names as carrying the exponential claim. The number of runs is decided here and decided independently of the preparation above it: the same |ψ⟩ costs ε^-2 runs by plain sampling and ε^-1 by coherent estimation, a difference that can exceed the advantage being claimed upstream.",
    whyALayerJa: "解ベクトル全体を読み出せば高速化は失われます。$n$ 量子ビット状態の古典的な記述は、サンプリング費用を数える前の段階ですでに $2^n$ 個の数値であり、$d = 2^n$ としてトレース距離誤差 $\\varepsilon$ での再構成には $O(rank(ρ)·d/ε²) \\leq O(d²/ε²)$ 個のコピーが必要です（O'Donnell と Wright、上界のみ）。この層が存在するのは、実際に役立つ問いがほぼ常にスカラー値だからです。求めるのは $x$ そのものではなく $⟨x|M|x⟩$ 一つであり、HHL が返すのもこちらです。Aaronson の『Read the fine print』（Nature Physics 11, 291–293, 2015）が、指数的主張を支える前提条件の一つとして挙げているのもこの制限です。実行回数を決めるのはこの層であり、上位の状態準備とは独立に決まります。同じ |ψ⟩ でも、単純なサンプリングなら ε^-2 回、コヒーレントな推定なら ε^-1 回であり、この差は上位で主張されている優位そのものを上回ることがあります。",
  },
  {
    kind: "method",
    id: "direct-sampling-readout",
    label: "Direct sampling in a measurement basis",
    labelJa: "測定基底での直接サンプリング",
    summary: "Decompose $O$ into Pauli strings, rotate each into the computational basis with a layer of single-qubit Cliffords, sample bitstrings, and recombine the per-term averages linearly. No ancilla, no controlled operations, minimum added depth.",
    summaryJa: "$O$ を Pauli 文字列に分解し、1 量子ビット Clifford の層でそれぞれを計算基底へ回転させ、ビット列をサンプリングして、項ごとの平均を線形に足し合わせます。アンシラも制御演算も不要で、追加される深さは最小です。",
    realizes: "observable-estimation",
    conditions: "Applies when $O$ is given as a Pauli or fermionic-operator sum with an efficiently enumerable term count, and the extra single-qubit basis-change layer is affordable. Each shot destroys the state, so the preparation must be repeatable. There is no coherence-derived advantage available here: this is a strict $\\varepsilon^-2$ method, and grouping commuting terms changes the constant, not the exponent.",
    conditionsJa: "$O$ が Pauli 和またはフェルミオン演算子の和として与えられ、項数を効率的に列挙でき、基底変換のための 1 量子ビット層を追加できる場合に適用できます。1 ショットごとに状態は壊れるため、準備を繰り返せることが前提です。コヒーレンスから来る優位はここにはありません。厳密に $\\varepsilon^-2$ の方法であり、可換な項をまとめても変わるのは定数であって指数ではありません。",
    cost: "Huggins et al. record the coherent endpoint of this layer: \"Optimal strategies for estimating a single expectation value are known, requiring a number of state preparations that scales with the target error $\\varepsilon$ as $O(1/\\varepsilon)$.\" Shot-based averaging as described here is the $\\varepsilon^-2$ endpoint.",
    costJa: "Huggins らはこの層のコヒーレントな側の端点を記録しています。「単一の期待値を推定する最適な戦略は既に知られており、目標誤差 $\\varepsilon$ に対して $O(1/\\varepsilon)$ 回の状態準備を要する。」ここで述べているショットに基づく平均化は、$\\varepsilon^-2$ の側の端点にあたります。",
    contested: "Gonthier et al.'s resource analysis of combustion energies of small organic molecules to chemical accuracy concludes that modern improvements including low-rank Hamiltonian factorization \"will not be sufficient to achieve practical quantum computational advantage for our molecular set, or for similar molecules\", and points instead at operator estimation that leverages quantum coherence. Any near-term chemistry advantage claim resting on shot-based readout has to answer that analysis.",
    contestedJa: "Gonthier らは、小さな有機分子の燃焼エネルギーを化学的精度で求める場合の資源解析から、低ランクのハミルトニアン分解を含む近年の改良をもってしても「我々の分子群、あるいは同種の分子について、実用的な量子計算上の優位を達成するには十分ではない」と結論し、代わりに量子コヒーレンスを活用する演算子推定を挙げています。ショットに基づく読み出しに依拠した近未来の量子化学における優位の主張は、この解析に答える必要があります。",
    steps: ["state-preparation"],
    repeats: {
      "state-preparation": {
        count: "O(1/ε²) shots, and one preparation per shot",
        countJa: "O(1/ε²) 回のショット、1 ショットにつき 1 回の準備。",
        mark: "×O(1/ε²)",
        markJa: "×O(1/ε²)",
        closure: "measured",
        note: "This is the loop that closes through a measurement, and the whole cost is in that fact. Each shot destroys the state, so the state-preparation circuit below is not run once and read many times — it is run again, in full, for every sample, and the samples needed grow as ε^-2. Grouping commuting terms changes the constant; it cannot change the exponent, because the exponent is what averaging independent classical outcomes costs. A method that keeps the loop coherent pays ε^-1 instead, which is the whole of the row below.",
        noteJa: "これが測定を挟んで閉じる反復であり、費用のすべてがその事実にあります。1 ショットごとに状態は壊れますので、下層の状態準備回路は 1 回実行して何度も読むのではなく、標本ごとに丸ごと実行し直されます。必要な標本数は ε^-2 で増えます。可換な項をまとめれば定数は変わりますが、指数は変わりません。指数は、独立な古典的結果を平均することの代価そのものだからです。反復をコヒーレントに保つ手法が支払うのは ε^-1 であり、それが次の行の内容です。",
      },
    },
    citations: [
      { title: "A variational eigenvalue solver on a quantum processor", authors: "Alberto Peruzzo, Jarrod McClean, Peter Shadbolt, Man-Hong Yung, Xiao-Qi Zhou, Peter J. Love, Alán Aspuru-Guzik, Jeremy L. O'Brien", year: "2013", url: "https://arxiv.org/abs/1304.3061" },
      { title: "Measurements as a roadblock to near-term practical quantum advantage in chemistry: resource analysis", authors: "Jérôme F. Gonthier, Maxwell D. Radin, Corneliu Buda, Eric J. Doskocil, Clena M. Abuan, Jhonathan Romero", year: "2020", url: "https://arxiv.org/abs/2012.04001" },
      { title: "Nearly Optimal Quantum Algorithm for Estimating Multiple Expectation Values", authors: "William J. Huggins, Kianna Wan, Jarrod McClean, Thomas E. O'Brien, Nathan Wiebe, Ryan Babbush", year: "2021", url: "https://arxiv.org/abs/2111.09283" },
    ],
  },
  {
    kind: "method",
    id: "amplitude-estimation-readout",
    label: "Coherent amplitude-estimation readout",
    labelJa: "振幅推定によるコヒーレントな読み出し",
    summary: "Encode the expectation value into an amplitude and estimate that amplitude coherently — phase estimation on the Grover operator $Q = −A S_0 A^{-1} S_χ$, or one of the QPE-free variants — instead of averaging independent shots.",
    summaryJa: "期待値を振幅に埋め込み、その振幅をコヒーレントに推定します。Grover 演算子 $Q = −A S_0 A^{-1} S_χ$ に対する位相推定、あるいは位相推定を使わない派生手法を用い、独立なショットの平均を取る方式とは別の経路をとります。",
    realizes: "observable-estimation",
    conditions: "Requires coherent, controlled access to the state-preparation unitary and its inverse, and a bound on the observable's eigenvalues or on its tail distribution. A state that has been prepared and measured cannot be reused, so this is a fault-tolerant-regime method while direct sampling is the near-term one. The sign matters: Brassard, Høyer, Mosca and Tapp define $Q$ with a global minus, which fixes the eigenphase convention the amplitude is read off from.",
    conditionsJa: "状態準備ユニタリとその逆へのコヒーレントな制御アクセス、およびオブザーバブルの固有値または裾分布に対する上界が必要です。いったん準備して測定した状態は再利用できないため、これは誤り訂正が前提の領域の手法であり、近未来の装置で使われるのは直接サンプリングです。符号は重要で、Brassard–Høyer–Mosca–Tapp は $Q$ を全体符号のマイナス付きで定義しており、これが振幅を読み取る際の固有位相の規約を決めています。",
    cost: "Brassard, Høyer, Mosca and Tapp's Theorem 12 outputs $ã$ with $|ã − a| \\leq 2\\pi√(a(1−a))/M + \\pi²/M²$ at probability at least $8/\\pi²$, using exactly $M$ iterations, where one iteration runs $A$ once forwards and once backwards and evaluates $χ$ once. Knill, Ortiz and Somma give explicit algorithms that approach precision $1/N$ with $N$ uses, given a bound on the eigenvalues of the operators or on their tail distribution.",
    costJa: "Brassard–Høyer–Mosca–Tapp の Theorem 12 は、ちょうど $M$ 回の反復（1 回の反復で $A$ を順方向と逆方向に 1 度ずつ適用し、$χ$ を 1 度評価します）を用いて、確率 $8/\\pi²$ 以上で $|ã − a| \\leq 2\\pi√(a(1−a))/M + \\pi²/M²$ を満たす $ã$ を出力します。Knill–Ortiz–Somma は、演算子の固有値または裾分布に対する上界が与えられているとき、$N$ 回の使用で精度 $1/N$ に近づく明示的なアルゴリズムを与えています。",
    contested: "Reaching additive error $\\varepsilon$ takes of order $1/\\varepsilon$ sequential applications of $Q$, and that is a depth as much as a count, so a device with a capped coherent depth cannot spend it. Giurgica-Tiron, Kerenidis, Labib, Prakash and Zeng give two algorithms — Power law AE and QoPrime AE — carrying a parameter $\\beta ∈ (0,1]$ with $N = \\tilde{O}(1/\\varepsilon^{1+\\beta})$ oracle calls and $D = O(1/\\varepsilon^{1−\\beta})$ sequential calls, so $N·D = \\tilde{O}(1/\\varepsilon²)$ throughout and $\\beta = 1$ recovers classical sampling. A quoted \"quadratic speedup\" that does not state the depth it assumes has not stated its cost.",
    contestedJa: "加法誤差 $\\varepsilon$ の達成に要する $Q$ の適用回数はおよそ $1/\\varepsilon$ ですが、これは回数であると同時に逐次深さでもあり、コヒーレント深さに上限のある装置はそれを使い切れません。Giurgica-Tiron–Kerenidis–Labib–Prakash–Zeng は Power law AE と QoPrime AE という二つのアルゴリズムを与えています。パラメータ $\\beta ∈ (0,1]$ に対しオラクル呼び出しは $N = \\tilde{O}(1/\\varepsilon^{1+\\beta})$、逐次呼び出しは $D = O(1/\\varepsilon^{1−\\beta})$ であり、全域で $N·D = \\tilde{O}(1/\\varepsilon²)$ が成り立ち、$\\beta = 1$ で古典的なサンプリングに戻ります。前提とする深さを述べずに「二次的な高速化」と書いた見積もりは、コストを述べたことになりません。",
    steps: ["state-preparation"],
    repeats: {
      "state-preparation": {
        count: "M iterations, M = O(1/ε), each running the preparation forwards and backwards once",
        countJa: "M 回の反復（M = O(1/ε)）。各反復で準備を順方向と逆方向に 1 度ずつ実行します。",
        mark: "×M",
        markJa: "×M",
        closure: "coherent",
        note: "The same slot as the row above, repeated the same way, and it is the closure that separates them: Brassard, Høyer, Mosca and Tapp's Theorem 12 uses exactly M iterations of the Grover operator, and one iteration runs A once forwards and once backwards. Nothing is measured until the end, so the ε^-2 of independent sampling becomes ε^-1. The bill does not vanish, it moves: those M applications are sequential, so the count is also a depth, and a device with a capped coherent depth cannot spend it — which is exactly what the contested note below is about.",
        noteJa: "上の行と同じスロットを同じように繰り返しますが、両者を分けるのは閉じ方です。Brassard–Høyer–Mosca–Tapp の Theorem 12 は Grover 演算子をちょうど M 回反復し、1 回の反復で A を順方向と逆方向に 1 度ずつ実行します。最後まで測定しませんので、独立サンプリングの ε^-2 が ε^-1 になります。代価は消えるのではなく移動します。この M 回の適用は逐次的ですから、回数はそのまま深さでもあり、コヒーレント深さに上限のある装置はそれを使い切れません。下の「異論」の節はまさにその点を扱っています。",
      },
    },
    entries: ["amplitude-estimation"],
    citations: [
      { title: "Quantum Amplitude Amplification and Estimation", authors: "Gilles Brassard, Peter Hoyer, Michele Mosca, Alain Tapp", year: "2000", url: "https://arxiv.org/abs/quant-ph/0005055" },
      { title: "Optimal Quantum Measurements of Expectation Values of Observables", authors: "Emanuel Knill, Gerardo Ortiz, Rolando D. Somma", year: "2006", url: "https://arxiv.org/abs/quant-ph/0607019" },
      { title: "Low depth algorithms for quantum amplitude estimation", authors: "Tudor Giurgica-Tiron, Iordanis Kerenidis, Farrokh Labib, Anupam Prakash, William Zeng", year: "2020", url: "https://arxiv.org/abs/2012.03348" },
    ],
  },
  {
    kind: "method",
    id: "classical-shadow-readout",
    label: "Classical shadow readout",
    labelJa: "古典シャドウによる読み出し",
    summary: "Apply a random unitary from a chosen ensemble, measure in the computational basis, and keep the (unitary, outcome) pair; inverting the measurement channel turns each pair into an unbiased single-shot snapshot of $ρ$, and median-of-means over snapshots predicts many observables at once. The observables may be chosen after the data has been taken.",
    summaryJa: "選んだアンサンブルからランダムなユニタリを引いて適用し、計算基底で測定して、（ユニタリ, 測定結果）の組を保存します。測定チャネルを逆にたどると各組は $ρ$ の不偏な 1 ショットのスナップショットになり、これらを平均値の中央値（median-of-means）でまとめることで、多数のオブザーバブルを一度に予測できます。どのオブザーバブルを見るかはデータ取得後に決められます。",
    realizes: "observable-estimation",
    conditions: "Lives or dies on the shadow norm of the target observables under the chosen ensemble. The random-Pauli ensemble is shallow and hardware-ready but costs exponentially in the observable's locality; the global random Clifford ensemble handles dense observables but needs an n-qubit Clifford circuit, which is deep. The guarantee is additive per observable and says nothing about relative error for near-zero expectations. This is what makes the layer worth having: reconstructing $ρ$ itself instead costs $O(rank(ρ)·d/ε²) ≤ O(d²/ε²)$ copies for trace-distance error $ε$ (O'Donnell and Wright, upper bounds only), which at $d = 2^n$ is exponential in the qubit count.",
    conditionsJa: "成否は、選んだアンサンブルのもとでの対象オブザーバブルのシャドウノルムで決まります。ランダム Pauli アンサンブルは浅く実機で使えますが、オブザーバブルの局所性に対して指数的なコストがかかります。大域的ランダム Clifford アンサンブルは密なオブザーバブルを扱えますが、n 量子ビットの Clifford 回路が必要で深くなります。保証はオブザーバブルごとの加法誤差であり、期待値がゼロ近傍のときの相対誤差については何も述べません。この層に意味があるのはまさにここです。$ρ$ そのものを再構成する場合、トレース距離誤差 $ε$ に対して $O(rank(ρ)·d/ε²) ≤ O(d²/ε²)$ 個のコピーが必要で（O'Donnell と Wright、上界のみ）、$d = 2^n$ では量子ビット数に対して指数的になります。",
    cost: "Huang, Kueng and Preskill: $N = O(\\log(M) \\cdot \\max_i ||O_i − tr(O_i)2^{-n}I||²_shadow / \\varepsilon²)$ total measurements to predict $M$ linear functions to additive error $\\varepsilon$ — formally $K = 2 \\log(2M/\\delta)$ median-of-means batches with $N = 34/\\varepsilon² \\cdot \\max_i ||\\cdot||²_shadow$ per batch. For random Pauli measurements the shadow norm is bounded by $4^k||O||²_\\infty$ for a $k$-local $O$, improving to $3^k$ for tensor products of single-qubit observables; for random $n$-qubit Cliffords it is bounded by $3 tr(O²)$.",
    costJa: "Huang–Kueng–Preskill によれば、$M$ 個の線形汎関数を加法誤差 $\\varepsilon$ で予測するのに必要な測定回数の合計は $N = O(\\log(M) \\cdot \\max_i ||O_i − tr(O_i)2^{-n}I||²_shadow / \\varepsilon²)$ です。正確には、平均値の中央値をとるためのバッチ数が $K = 2 \\log(2M/\\delta)$、1 バッチあたりの測定回数が $N = 34/\\varepsilon² \\cdot \\max_i ||\\cdot||²_shadow$ です。ランダム Pauli 測定では、$k$ 局所の $O$ に対してシャドウノルムは $4^k||O||²_\\infty$ で抑えられ、1 量子ビットオブザーバブルのテンソル積では $3^k$ まで改善します。$n$ 量子ビットのランダム Clifford では $3 tr(O²)$ で抑えられます。",
    contested: "\"Independent of system size\" holds for observables of bounded shadow norm and is not a claim about arbitrary observables; quoting the $\\log(M)$ without the max_i ||·||²_shadow factor is the standard misreading of this result. Separately, this is a different construction from Aaronson's shadow tomography, whose Õ(ε^-4 · log⁴M · log D) is a copy count for a procedure that measures the copies collectively, not a hardware shot count. The two results are not interchangeable despite the shared word.",
    contestedJa: "「系のサイズに依存しない」が成り立つのはシャドウノルムが抑えられているオブザーバブルについてであり、任意のオブザーバブルに対する主張ではありません。max_i ||·||²_shadow の因子を落として $\\log(M)$ だけを引用するのが、この結果の典型的な誤読です。また、これは Aaronson のシャドウトモグラフィとは別の構成です。あちらの Õ(ε^-4 · log⁴M · log D) は、コピーをまとめて測定する手続きに対するコピー数であって、実機のショット数ではありません。名称が似ていても両者は置き換えられません。",
    steps: ["state-preparation"],
    repeats: {
      "state-preparation": {
        count: "N = O(log(M) · max_i ||·||²_shadow / ε²) measurements, one preparation each",
        countJa: "N = O(log(M) · max_i ||·||²_shadow / ε²) 回の測定。1 回につき 1 度の準備。",
        mark: "×N",
        markJa: "×N",
        closure: "measured",
        note: "A measured loop like direct sampling, and the same ε^-2 — what shadows buy is not a shorter loop but a loop whose length no longer grows with the number of observables, since M enters only logarithmically and the observables may be chosen after the data is taken. Formally the turns are grouped: K = 2 log(2M/δ) median-of-means batches of N = 34/ε² · max_i ||·||²_shadow each. The shadow norm is the factor that decides whether that is cheap, and it is exponential in locality under the random-Pauli ensemble.",
        noteJa: "直接サンプリングと同じく測定を挟んで閉じる反復であり、ε^-2 も同じです。古典シャドウが得るのは反復の短さではなく、オブザーバブルの個数とともに伸びない反復です。M は対数でしか効かず、どのオブザーバブルを見るかはデータ取得後に決められます。厳密には反復はまとめられ、K = 2 log(2M/δ) 個のバッチそれぞれで N = 34/ε² · max_i ||·||²_shadow 回を測定します。安く済むかどうかを決めるのはシャドウノルムであり、ランダム Pauli アンサンブルのもとでは局所性に対して指数的です。",
      },
    },
    citations: [
      { title: "Predicting Many Properties of a Quantum System from Very Few Measurements", authors: "Hsin-Yuan Huang, Richard Kueng, John Preskill", year: "2020", url: "https://arxiv.org/abs/2002.08953" },
      { title: "Shadow Tomography of Quantum States", authors: "Scott Aaronson", year: "2017", url: "https://arxiv.org/abs/1711.01053" },
      { title: "Efficient quantum tomography", authors: "Ryan O'Donnell, John Wright", year: "2015", url: "https://arxiv.org/abs/1508.01907" },
    ],
  },
  {
    kind: "capability",
    id: "compile-to-device",
    label: "Compile a circuit to a specific device",
    labelJa: "回路を実機向けにコンパイルする",
    summary: "Turn a circuit written as arbitrary unitaries over abstract qubits into an executable instruction sequence for one machine's own gate set and connectivity graph. The result is functionally equivalent, or equivalent to within a stated approximation error.",
    summaryJa: "抽象的な量子ビット上で任意のユニタリとして書かれた回路を、特定の実機がもつゲート集合と結合グラフに合わせた実行可能な命令列へ変換します。得られる命令列は元の回路と等価か、明示された近似誤差の範囲で等価です。",
    contract: {
      from: "abstract-circuit",
      to: "device-circuit",

      takes: "An abstract circuit (arbitrary-angle rotations, arbitrary two-qubit gates, all-to-all qubit indices); a device model giving the native gate set, coupling graph and calibration data; an approximation budget ε.",
      takesJa: "任意角の回転、任意の 2 量子ビットゲート、全結合を前提とした量子ビット番号からなる抽象回路。装置固有のゲート集合・結合グラフ・較正データを含む装置モデル。近似誤差の許容量 ε。",
      returns: "A native-gate instruction sequence obeying the connectivity constraint, plus the overhead it added (SWAP count, T-count, depth) and the accumulated synthesis error.",
      returnsJa: "結合制約を満たす装置固有ゲートの命令列と、追加されたオーバーヘッド（SWAP 数、T 数、深さ）および蓄積した合成誤差の内訳。",
    },
    whyALayer: "The same algorithm compiles to very different instruction sequences on different machines, and nothing above this boundary changes. The layer is also entered at different depths — a pre-fault-tolerant backend consumes arbitrary-angle rotations directly, a surface-code backend consumes only a discrete gate set — which is why a gate count quoted by an algorithms paper does not carry across it.",
    whyALayerJa: "同じアルゴリズムでも実機が変われば命令列は大きく変わりますが、この境界より上は何も変わりません。さらに、この層はどの深さから入るかも装置によって異なります。誤り耐性以前の実機は任意角の回転をそのまま受け取り、表面符号の実機は離散的なゲート集合しか受け取りません。アルゴリズムの論文が挙げるゲート数がこの境界を越えて通用しないのは、そのためです。",
    entries: ["qft-resource-screen"],
  },
  {
    kind: "method",
    id: "nisq-transpilation",
    label: "NISQ transpilation (retargetable pass pipeline)",
    labelJa: "NISQ 向けトランスパイル（再ターゲット可能なパス列）",
    shortLabel: "NISQ transpilation",
    shortLabelJa: "NISQ 向けトランスパイル",
    summary: "A pass pipeline that decomposes to the device's own two-qubit gate, routes onto the coupling graph, and optimizes for two-qubit gate count and depth. Arbitrary-angle single-qubit rotations are emitted directly, because the hardware executes them.",
    summaryJa: "装置固有の 2 量子ビットゲートへ分解し、結合グラフ上へ経路付けし、2 量子ビットゲート数と深さを目標に最適化するパス列です。任意角の 1 量子ビット回転は、ハードウェアがそのまま実行できるため、そのまま出力します。",
    realizes: "compile-to-device",
    conditions: "Applies when the backend accepts continuous-angle rotations, i.e. pre-fault-tolerant hardware. It does not apply to a surface-code backend, where only a discrete gate set is available and synthesis becomes mandatory; the targets optimized here, depth and two-qubit gate count, are also the wrong targets there.",
    conditionsJa: "連続角の回転を受け付けるバックエンド、すなわち誤り耐性以前のハードウェアに当てはまります。離散的なゲート集合しか使えない表面符号のバックエンドには当てはまらず、そこでは離散合成が必須になります。ここで最適化する深さと 2 量子ビットゲート数も、誤り耐性計算では目標として誤りです。",
    steps: ["qubit-routing"],
    bypasses: ["gate-synthesis"],
    citations: [
      { title: "t|ket⟩: A Retargetable Compiler for NISQ Devices", authors: "Seyon Sivarajah, Silas Dilkes, Alexander Cowtan, Will Simmons, Alec Edgington, Ross Duncan", year: "2020", url: "https://arxiv.org/abs/2003.10611" },
    ],
  },
  {
    kind: "method",
    id: "fault-tolerant-compilation",
    label: "Fault-tolerant compilation (Clifford+T pipeline)",
    labelJa: "誤り耐性コンパイル（Clifford+T のパス列）",
    shortLabel: "Fault-tolerant compilation",
    shortLabelJa: "誤り耐性コンパイル",
    summary: "Decompose to Clifford+T, approximate every continuous rotation by a discrete gate word, optimize for T-count and T-depth, then express the result as a schedule of logical operations on encoded patches — typically Pauli-product measurements under lattice surgery.",
    summaryJa: "Clifford+T へ分解し、連続的な回転をすべて離散ゲート語で近似し、T 数と T 深さを目標に最適化したうえで、符号化されたパッチ上の論理操作の並び（多くは格子手術によるパウリ積測定）として表現します。",
    realizes: "compile-to-device",
    conditions: "Applies when the target is a surface-code architecture. The compiler does not merely sit on top of error correction: it chooses the code distance and the patch layout, which is why that layer sits beneath this route as a step rather than as a precondition. The cost model inverts relative to pre-fault-tolerant compilation: Clifford gates are cheap or free because they can be commuted into the Pauli frame, and T and Toffoli gates dominate. Routing in the SWAP sense is replaced by lattice-level layout and ancilla-bus scheduling.",
    conditionsJa: "対象が表面符号のアーキテクチャである場合に当てはまります。このコンパイルは誤り訂正の上に乗るだけではなく、符号距離とパッチの配置そのものを決めます。誤り訂正がこの経路の前提ではなく下位の層として置かれているのは、そのためです。費用モデルは誤り耐性以前と逆転します。Clifford ゲートはパウリフレームへ交換して押し出せるため、費用は安価あるいは実質ゼロになり、T と Toffoli が支配的になります。SWAP の意味での経路付けは、格子上の配置とアンシラバスのスケジューリングに置き換わります。",
    cost: "Costed in T-count, T-depth, logical qubit count and lattice area rather than gate count. Litinski's worked tradeoff: at $p = 1e-4$ with a 1 μs code cycle, a 100-logical-qubit computation with T-count 1e8 and T-depth 1e6 runs in 4 hours using 55,000 qubits, in 22 minutes using 120,000 qubits, or in 1 second using 330,000,000 qubits.",
    costJa: "費用はゲート数ではなく、T 数・T 深さ・論理量子ビット数・格子面積で数えます。Litinski の試算では、$p = 1e-4$、符号周期 1 μs のもとで、論理量子ビット 100 個・T 数 1e8・T 深さ 1e6 の計算は、55,000 量子ビットなら 4 時間、120,000 量子ビットなら 22 分、330,000,000 量子ビットなら 1 秒で終わります。",
    steps: ["gate-synthesis", "error-correction"],
    citations: [
      { title: "A Game of Surface Codes: Large-Scale Quantum Computing with Lattice Surgery", authors: "Daniel Litinski", year: "2018", url: "https://arxiv.org/abs/1808.02892" },
      { title: "Low overhead quantum computation using lattice surgery", authors: "Austin G. Fowler, Craig Gidney", year: "2018", url: "https://arxiv.org/abs/1808.06709" },
    ],
  },
  {
    kind: "capability",
    id: "qubit-routing",
    label: "Satisfy the hardware connectivity constraint",
    labelJa: "ハードウェアの結合制約を満たす",
    shortLabel: "Satisfy hardware connectivity",
    shortLabelJa: "ハードウェア結合制約を満たす",
    summary: "Place logical qubits on physical ones and schedule connectivity-repair operations — usually SWAPs — so that every two-qubit gate acts on a coupled pair. The problem combines subgraph isomorphism with token swapping.",
    summaryJa: "論理量子ビットを物理量子ビットに配置し、SWAP などの結合修復操作を差し込んで、すべての 2 量子ビットゲートが結合済みの対の上で動くようにします。部分グラフ同型判定とトークン交換を組み合わせた組合せ問題です。",
    contract: {
      from: "abstract-circuit",
      to: "routed-circuit",

      takes: "The circuit's two-qubit interaction graph or DAG; the device coupling graph; optionally per-edge error rates and gate durations.",
      takesJa: "回路の 2 量子ビット相互作用グラフまたはゲートの DAG、装置の結合グラフ、必要に応じて辺ごとの誤り率とゲート実行時間。",
      returns: "An initial logical-to-physical mapping and a routed circuit, costed in added SWAP count and added depth.",
      returnsJa: "初期の論理-物理対応と経路付け済みの回路。費用は追加された SWAP 数と追加された深さで測ります。",
    },
    whyALayer: "It is a self-contained combinatorial problem with a full ladder of fillings, from fast heuristics to exact solvers, and it disappears on hardware with all-to-all or reconfigurable connectivity. That disappearance is what makes it a layer rather than an implementation detail: the same algorithm pays a routing tax on a superconducting grid and none on a machine that physically moves its qubits.",
    whyALayerJa: "高速なヒューリスティクスから厳密解法まで選択肢が一通り揃った自己完結の組合せ問題であり、全結合あるいは再構成可能な結合をもつハードウェアでは丸ごと消えます。消えることこそが、これを実装上の細部ではなく層にしています。同じアルゴリズムが超伝導の格子では経路付けのぶんの費用を払い、量子ビット自体を動かす装置では払いません。",
  },
  {
    kind: "method",
    id: "sabre-routing",
    label: "SABRE (SWAP-based bidirectional heuristic search)",
    labelJa: "SABRE（SWAP に基づく双方向ヒューリスティック探索）",
    shortLabel: "SABRE",
    shortLabelJa: "SABRE",
    summary: "Insert SWAPs guided by a lookahead cost function, and obtain a good initial mapping by traversing the circuit forward and then in reverse, so the final mapping of one pass seeds the other. A decay term trades added depth against added gate count.",
    summaryJa: "先読みを含む評価関数に従って SWAP を挿入し、回路を順方向と逆方向に走査して一方の最終対応をもう一方の初期対応の種にすることで、良い初期配置を得ます。減衰項によって、増える深さと増えるゲート数の釣り合いを調整できます。",
    realizes: "qubit-routing",
    conditions: "Applies to arbitrary coupling graphs, sparse ones included. It is a heuristic with no optimality guarantee, and the underlying qubit assignment problem is NP-complete (Siraichi et al., Theorem 3.1). The paper claims an exponential speedup over the best known algorithm with comparable or better benchmark results, but states no bound on inserted SWAP count. Quality and convergence degrade on large circuits, which is the problem LightSABRE was built to address.",
    conditionsJa: "疎なものも含め、任意の結合グラフに使えます。最適性の保証はないヒューリスティクスであり、下敷きとなる量子ビット割り当て問題は NP 完全です（Siraichi ら、定理 3.1）。論文は既知の最良手法に対する指数的な高速化と、同等以上のベンチマーク結果を主張していますが、挿入される SWAP 数の上界は述べていません。大きな回路では品質と収束が落ち、それが LightSABRE の出発点になりました。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Tackling the Qubit Mapping Problem for NISQ-Era Quantum Devices", authors: "Gushu Li, Yufei Ding, Yuan Xie", year: "2018", url: "https://arxiv.org/abs/1809.02573" },
      { title: "Qubit allocation", authors: "Siraichi, Santos, Collange, Pereira", year: "2018", url: "https://doi.org/10.1145/3168822" },
      { title: "LightSABRE: A Lightweight and Enhanced SABRE Algorithm", authors: "Henry Zou, Matthew Treinish, Kevin Hartman, Alexander Ivrii, Jake Lishman", year: "2024", url: "https://arxiv.org/abs/2409.08368" },
    ],
  },
  {
    kind: "method",
    id: "lightsabre-routing",
    label: "LightSABRE",
    labelJa: "LightSABRE",
    summary: "A re-engineered SABRE — the Qiskit production implementation, largely rewritten in Rust — whose algorithmic changes improve both runtime and routing quality on large circuits. The release-valve mechanism it carries was already present in the Qiskit 0.20.1 baseline it is measured against.",
    summaryJa: "SABRE を作り直した実装（Qiskit の製品実装で、大部分が Rust で書き直されています）で、アルゴリズム上の変更により大きな回路での実行時間と経路付けの品質をともに改善します。あわせて備えるリリースバルブ機構は、比較対象である Qiskit 0.20.1 の時点で既に導入されていたものです。",
    realizes: "qubit-routing",
    refines: "sabre-routing",
    refinesMark: "SABRE",
    refinesMarkJa: "SABRE",
    // Folded (s121, W17) by the same ruling as the LCHS pair: a re-engineered
    // implementation of the same routine is not a second process on the map.
    sameInternalsAsParent: true,
    potentialPath:
      "Every recorded difference is implementation engineering, measured as benchmark constants on the same routine. The map draws constructions, not implementation pipelines; a surface for implementations — build, data structures, release policy — is what would give this a path of its own.",
    potentialPathJa:
      "記録されている違いはすべて、同じ手順に対する実装工学であり、ベンチマーク定数として測られたものです。地図が描くのは構成であって実装パイプラインではありません。ビルド、データ構造、リリース方針といった実装のための地図面ができたとき、はじめてこれは独自の経路になり得ます。",
    conditions: "Same applicability as SABRE. The claims are benchmark-relative, measured against named Qiskit versions and the benchmark set of Li et al.; they are not worst-case guarantees.",
    conditionsJa: "適用範囲は SABRE と同じです。主張はいずれもベンチマーク相対で、指定された Qiskit の版と Li らのベンチマーク回路に対して測ったものであり、最悪ケースの保証ではありません。",
    cost: "Benchmark-relative rather than a bound: the Qiskit 1.2.0 implementation is approximately 200 times faster than the implementation in Qiskit 0.20.1, and gives an average 18.9% decrease in SWAP gate count against the SABRE algorithm of Li et al. across the same benchmark circuits.",
    costJa: "上界ではなくベンチマーク相対の値です。Qiskit 1.2.0 の実装は Qiskit 0.20.1 の実装に対しておよそ 200 倍高速で、同じベンチマーク回路上で Li らの SABRE と比べて SWAP ゲート数が平均 18.9% 減少します。",
    steps: [],
    atomic: true,
    citations: [
      { title: "LightSABRE: A Lightweight and Enhanced SABRE Algorithm", authors: "Henry Zou, Matthew Treinish, Kevin Hartman, Alexander Ivrii, Jake Lishman", year: "2024", url: "https://arxiv.org/abs/2409.08368" },
    ],
  },
  {
    kind: "method",
    id: "exact-layout-synthesis",
    label: "Exact layout synthesis by mathematical programming",
    labelJa: "数理計画による厳密な配置合成",
    shortLabel: "Exact layout synthesis",
    shortLabelJa: "厳密な配置合成",
    summary: "Encode placement and routing jointly as a mathematical program over a spacetime variable encoding and solve it exactly. Relaxing the same formulation yields a fast near-optimal synthesizer.",
    summaryJa: "配置と経路付けを時空間の変数符号化上の数理計画としてまとめて記述し、厳密に解きます。同じ定式化を緩和すれば、高速で準最適な合成器になります。",
    realizes: "qubit-routing",
    conditions: "The exact synthesizer is the reference against which heuristics are measured; the approximate variant, obtained by relaxing the same formulation, is the practical one, and a commutation-aware adjustment is available for QAOA-structured circuits. The underlying qubit assignment problem is NP-complete (Siraichi et al., Theorem 3.1), so no polynomial bound is available.",
    conditionsJa: "厳密解法はヒューリスティクスを測るための基準であり、同じ定式化を緩和した版が実務で使うものです。QAOA 型の回路には可換性を考慮した調整も用意されています。下敷きとなる量子ビット割り当て問題は NP 完全であり（Siraichi ら、定理 3.1）、多項式時間の上界は得られません。",
    cost: "Reported as an exponential reduction in time and space complexity relative to some leading prior optimal approaches, while searching a strictly larger solution space. The approximate variant is reported to beat leading heuristics by up to 100% on additional gate cost and up to 10x on fidelity, and for QAOA by up to 75% on depth.",
    costJa: "先行する厳密手法の一部に対して、より広い解空間を探索しながら時間と空間の計算量を指数的に削減したと報告されています。緩和版は、追加ゲート費用で最大 100%、忠実度で最大 10 倍、QAOA では深さで最大 75% まで、主要なヒューリスティクスを上回ると報告されています。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Optimal Layout Synthesis for Quantum Computing", authors: "Bochen Tan, Jason Cong", year: "2020", url: "https://arxiv.org/abs/2007.15671" },
      { title: "Qubit allocation", authors: "Siraichi, Santos, Collange, Pereira", year: "2018", url: "https://doi.org/10.1145/3168822" },
    ],
  },
  {
    kind: "capability",
    id: "gate-synthesis",
    label: "Approximate a continuous rotation in a discrete gate set",
    labelJa: "連続的な回転を離散ゲート集合で近似する",
    shortLabel: "Approximate a rotation in a gate set",
    shortLabelJa: "回転をゲート集合で近似する",
    summary: "Given a target single-qubit unitary — typically a z-rotation by an arbitrary angle — and a precision $\\varepsilon$, produce a finite word over a fixed discrete gate set such as Clifford+T whose product is within $\\varepsilon$ of the target in a stated metric. The cost is charged in non-Clifford gates.",
    summaryJa: "目標となる 1 量子ビットユニタリ（多くは任意角の z 回転）と精度 $\\varepsilon$ を与えると、Clifford+T のような固定された離散ゲート集合上の有限語を返します。積は指定した距離で目標の $\\varepsilon$ 以内に入り、費用は非 Clifford ゲートの本数で数えます。",
    contract: {
      from: "abstract-circuit",
      to: "discrete-circuit",

      takes: "A target unitary or channel; a precision ε; a metric (operator norm or diamond norm); the gate set; and whether ancillas, measurement or mixing are permitted.",
      takesJa: "目標のユニタリまたはチャネル、精度 ε、用いる距離（作用素ノルムかダイヤモンドノルムか）、ゲート集合、そしてアンシラ・測定・混合を許すかどうか。",
      returns: "A gate word, costed in T-count (or non-Clifford count).",
      returnsJa: "ゲート語と、その T 数（非 Clifford ゲート数）。",
    },
    whyALayer: "A fault-tolerant architecture can only apply a discrete gate set, so every continuous rotation in every algorithm above has to pass through here, and the price is paid in the dominant cost unit of the fault-tolerant stack. The competing fillings differ not by constants but by the exponent on $\\log(1/\\varepsilon)$. Pre-fault-tolerant hardware skips the layer entirely by executing arbitrary angles natively — and $T$-counts stated over different gate sets or different metrics are different quantities that must not be placed on one axis.",
    whyALayerJa: "誤り耐性アーキテクチャは離散的なゲート集合しか実行できないため、上位のアルゴリズムに現れる連続的な回転はすべてこの層を通り、費用は誤り耐性計算全体の主要な単位で支払われます。ここで競合する手法は定数倍ではなく $\\log(1/\\varepsilon)$ の指数で差がつきます。誤り耐性以前のハードウェアは任意角をそのまま実行できるので、この層を丸ごと迂回します。なお、ゲート集合や距離が異なれば $T$ 数は別の量であり、同じ軸に並べて比べることはできません。",
  },
  {
    kind: "method",
    id: "solovay-kitaev-synthesis",
    label: "Solovay-Kitaev algorithm",
    labelJa: "Solovay–Kitaev アルゴリズム",
    summary: "Recursively refine an approximation using group commutators, for any finite inverse-closed set that densely generates the group. It is the general-purpose fallback: it works on gate sets with no exploitable algebraic structure.",
    summaryJa: "群交換子を使って近似を再帰的に精密化します。逆元で閉じた有限の生成集合が群を稠密に生成していれば使えるため、代数的な構造を利用できないゲート集合に対する汎用の手段です。",
    realizes: "gate-synthesis",
    conditions: "Requires the generating set to be finite, inverse-closed and dense, and gives no optimality guarantee. Kuperberg's result improves the algorithm for a general finite, inverse-closed generating set acting on a qudit, and holds more generally for any finite set densely generating a connected semisimple real Lie group; in the noncompact case an extra length term is needed to reach group elements far from the identity.",
    conditionsJa: "生成集合が有限であり、逆元で閉じており、稠密であることが必要です。最適性の保証はありません。Kuperberg の結果は、クディット（d 準位系）に作用する逆元で閉じた一般の有限生成集合に対してアルゴリズムを改善するもので、連結半単純実リー群を稠密に生成する任意の有限集合に対しても、より一般に成り立ちます。非コンパクトの場合は、単位元から遠い元に届くために語長の追加項が必要です。",
    cost: "Dawson and Nielsen: the algorithm runs in $O(\\log^2.71(1/\\varepsilon))$ classical time and produces a sequence of $O(\\log^3.97(1/\\varepsilon))$ gates guaranteed to approximate the target to accuracy $\\varepsilon$. Kuperberg: word length $O(n^(1.44042+\\delta))$ to approximate an arbitrary target to $n$ bits of precision, improving on the prior $O(n^(3+\\delta))$.",
    costJa: "Dawson と Nielsen: 古典計算時間 $O(\\log^2.71(1/\\varepsilon))$ で動作し、目標を精度 $\\varepsilon$ で近似する $O(\\log^3.97(1/\\varepsilon))$ 本のゲート列を出力します。Kuperberg: 任意の目標を $n$ ビットの精度で近似する語長は $O(n^(1.44042+\\delta))$ で、従来の $O(n^(3+\\delta))$ からの改善です。",
    contested: "Superseded for the case that dominates practice. For Clifford+T $z$-rotations, number-theoretic synthesis reaches a $T$-count linear in $\\log(1/\\varepsilon)$, where the gate-set-generic Solovay-Kitaev bound carries an exponent near 3.97. Solovay-Kitaev survives only where the gate set has no exploitable algebraic structure — and even there Kuperberg has cut the exponent.",
    contestedJa: "実務上支配的な場合については、既に置き換えられています。Clifford+T の $z$ 回転では数論的な合成が $\\log(1/\\varepsilon)$ に比例する $T$ 数に達するのに対し、ゲート集合を問わない Solovay–Kitaev の上界は指数がおよそ 3.97 です。代数的な構造を利用できないゲート集合でだけ残る手段であり、そこでも Kuperberg が指数を下げています。",
    steps: [],
    atomic: true,
    citations: [
      { title: "The Solovay-Kitaev algorithm", authors: "Christopher M. Dawson, Michael A. Nielsen", year: "2005", url: "https://arxiv.org/abs/quant-ph/0505030" },
      { title: "Breaking the cubic barrier in the Solovay-Kitaev algorithm", authors: "Greg Kuperberg", year: "2023", url: "https://arxiv.org/abs/2306.13158" },
    ],
  },
  {
    kind: "method",
    id: "ross-selinger-synthesis",
    label: "Number-theoretic Clifford+T synthesis of z-rotations (Ross-Selinger)",
    labelJa: "数論的な Clifford+T z 回転合成（Ross–Selinger）",
    shortLabel: "Ross–Selinger synthesis",
    shortLabelJa: "Ross–Selinger 合成",
    summary: "Reduce approximation of a z-rotation to a grid problem over the ring $Z[1/sqrt(2), i]$ plus a relative norm equation, then exactly synthesize the resulting ring element. This is the production method for z-rotations under Clifford+T.",
    summaryJa: "z 回転の近似を環 $Z[1/sqrt(2), i]$ 上の格子問題と相対ノルム方程式に帰着させ、得られた環の元を厳密に合成します。Clifford+T のもとでの z 回転については、これが実務上の標準手法です。",
    realizes: "gate-synthesis",
    conditions: "Specific to $z$-rotations over Clifford+T (general $SU(2)$ at higher cost), and ancilla-free. The optimality claim carries a real condition: it requires a factoring oracle, such as a quantum computer. Without one the algorithm is near-optimal only under a mild number-theoretic hypothesis, and its provable efficiency rests on that same hypothesis. Exact synthesis of the resulting ring element is unconditional (Kliuchnikov, Maslov, Mosca).",
    conditionsJa: "Clifford+T 上の $z$ 回転に固有の手法で（一般の $SU(2)$ はより高い費用で扱えます）、アンシラを使いません。最適性の主張には実際の条件が付きます。量子計算機のような素因数分解オラクルを必要とし、それがない場合は緩やかな数論的仮定のもとで準最適であるにとどまり、証明可能な効率も同じ仮定に依存します。得られた環の元の厳密な合成については、そうした仮定を必要としません（Kliuchnikov・Maslov・Mosca）。",
    cost: "Ross and Selinger: T-count $3\\log2(1/\\varepsilon) + O(\\log \\log(1/\\varepsilon))$ in the typical case, with expected runtime $O(\\mathrm{polylog}(1/\\varepsilon))$; without a factoring oracle it finds T-count $m + O(\\log \\log(1/\\varepsilon))$, where $m$ is the T-count of the second-to-optimal solution. Selinger's earlier algorithm gives T-count $K + 4\\log2(1/\\varepsilon)$ with $K$ approximately 10 for $z$-rotations, against a proved worst-case lower bound of the same form with $K = -9$, and $K + 12\\log2(1/\\varepsilon)$ for an arbitrary $SU(2)$ element.",
    costJa: "Ross と Selinger: 典型的な場合の T 数は $3\\log2(1/\\varepsilon) + O(\\log \\log(1/\\varepsilon))$、期待実行時間は $O(\\mathrm{polylog}(1/\\varepsilon))$ です。素因数分解オラクルがない場合に得られる T 数は $m + O(\\log \\log(1/\\varepsilon))$ で、$m$ は 2 番目に良い解の T 数です。Selinger の先行アルゴリズムは $z$ 回転に対して T 数 $K + 4\\log2(1/\\varepsilon)$（$K$ はおよそ 10）を与え、証明された最悪ケース下界は同じ形で $K = -9$、任意の $SU(2)$ の元では $K + 12\\log2(1/\\varepsilon)$ です。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Optimal ancilla-free Clifford+T approximation of z-rotations", authors: "Neil J. Ross, Peter Selinger", year: "2014", url: "https://arxiv.org/abs/1403.2975" },
      { title: "Efficient Clifford+T approximation of single-qubit operators", authors: "Peter Selinger", year: "2012", url: "https://arxiv.org/abs/1212.6253" },
      { title: "Fast and efficient exact synthesis of single qubit unitaries generated by Clifford and T gates", authors: "Vadym Kliuchnikov, Dmitri Maslov, Michele Mosca", year: "2012", url: "https://arxiv.org/abs/1206.5236" },
    ],
  },
  {
    kind: "capability",
    id: "error-mitigation",
    label: "Recover a noiseless expectation value by post-processing",
    labelJa: "後処理によって雑音のない期待値を取り戻す",
    shortLabel: "Mitigate noise by post-processing",
    shortLabelJa: "後処理で雑音を緩和する",
    summary: "Estimate what an observable would have measured on a noiseless device by running modified or repeated circuits on the noisy one and combining the results classically. No qubits are spent on redundancy; the whole price is paid in shots.",
    summaryJa: "雑音のある実機で回路を変形・反復して実行し、その結果を古典的に組み合わせることで、雑音がなければ観測量が示したはずの値を推定します。冗長化に量子ビットは使わず、代価はすべてショット数で支払います。",
    contract: {
      from: "noisy-estimate",
      to: "mitigated-estimate",

      takes: "A circuit, a target observable, a noisy device, a shot budget, and — for the model-based methods — a learned characterization of the device noise.",
      takesJa: "回路、対象の観測量、雑音のある実機、ショット数の予算。モデルに基づく手法ではさらに、学習によって得た装置雑音の特性評価。",
      returns: "A bias-reduced expectation-value estimate, with a variance — equivalently a sampling overhead — that grows with circuit volume.",
      returnsJa: "偏りを減らした期待値の推定と、回路の体積（深さ×幅）とともに増大する分散（言い換えればサンプリングのオーバーヘッド）。",
    },
    whyALayer: "Mitigation and correction are different contracts, not different degrees of the same one. Correction returns logical qubits a later subroutine can consume coherently; mitigation returns a statistic, and nothing downstream can take its output as a quantum input, so an algorithm whose result is a sampled bitstring cannot use it at all. It is also the one layer here with a proven ceiling: the sampling overhead of any protocol in a broad class — including protocols with nonlinear post-processing and protocols not yet invented — grows exponentially with circuit depth for layered circuits under local depolarizing and, more broadly, Markovian noise, and for random circuits under local noise with qubit count as well. Those are worst-case, class-wide bounds, so particular structured instances can still be mitigated cheaply — which is why mitigation remains a useful small-scale instrument and not a scaling path.",
    whyALayerJa: "誤り緩和と誤り訂正は程度の違いではなく、契約そのものが違います。訂正は後続のサブルーチンがコヒーレントに使える論理量子ビットを返しますが、緩和が返すのは統計量であり、その出力を量子的な入力として受け取れるものは下流にありません。したがって結果がビット列の標本であるアルゴリズムは、緩和をそもそも使えません。さらにこの層には証明された天井があります。非線形な後処理を含む広いクラスの手法、まだ考案されていない手法までを含めて、サンプリングのオーバーヘッドは、層状の回路において局所的な脱分極雑音および広いクラスのマルコフ雑音のもとで回路の深さに対して指数的に増大し、局所雑音下のランダム回路では量子ビット数に対しても指数的に増大します。これらは最悪ケースかつクラス全体に対する下界なので、構造をもつ個別の問題は今も安く緩和できます。緩和が小規模での測定器具として有用でありながら、規模を伸ばす道ではないのはそのためです。",
  },
  {
    kind: "method",
    id: "zero-noise-extrapolation",
    label: "Zero-noise extrapolation (ZNE)",
    labelJa: "ゼロ雑音外挿（ZNE）",
    summary: "Deliberately amplify the device noise by a set of known factors, measure the observable at each, and extrapolate the resulting curve back to zero noise. The fit is Richardson's deferred approach to the limit, or another model.",
    summaryJa: "装置の雑音を既知の倍率で意図的に増幅し、各倍率で観測量を測り、その曲線を雑音ゼロへ外挿します。外挿には Richardson の極限への遅延接近法などを使います。",
    realizes: "error-mitigation",
    conditions: "Requires that the noise can be scaled by a controlled factor and that the observable's dependence on noise strength is captured by the chosen fit. The extrapolation model is an assumption, and a wrong model produces a confidently wrong number. It reduces bias while amplifying variance, so the shot cost rises, and it returns an expectation value that cannot be handed to a coherent downstream subroutine. Temme, Bravyi and Gambetta state that the size of the circuits to which these techniques can be applied is limited by the rate at which errors are introduced.",
    conditionsJa: "雑音を制御された倍率で増幅できること、そして観測量の雑音強度依存性が選んだ当てはめで表せることが必要です。外挿のモデルは仮定であり、モデルを誤れば自信をもって誤った数値が出ます。偏りは減る一方で分散は増えるためショット数が増え、返るのは期待値なので、コヒーレントな後続のサブルーチンには渡せません。Temme・Bravyi・Gambetta は、この手法を適用できる回路の規模が、誤りの発生率によって制約されると述べています。",
    contested: "The headline demonstration — the 127-qubit IBM Eagle kicked-Ising experiment reported as evidence for the utility of quantum computing before fault tolerance (Kim et al., Nature 618, 500 (2023)) — was afterwards reproduced classically and in places exceeded: by belief-propagation tensor networks (Tindall, Fishman, Stoudenmire, Sels), whose results were more accurate and more precise than the processor's, and by sparse Pauli dynamics running on a single laptop core orders of magnitude faster than the reported quantum walltime (Begusic, Chan). The mitigation itself worked; the quantum-advantage reading did not survive.",
    contestedJa: "看板となった実証、すなわち誤り耐性以前における量子計算の有用性の裏付けとして報告された 127 量子ビットの IBM Eagle での kicked Ising 実験（Kim ら、Nature 618, 500 (2023)）は、その後に古典計算で再現され、精度でも上回られました。一つは信念伝播に基づくテンソルネットワーク（Tindall・Fishman・Stoudenmire・Sels）で、量子プロセッサの結果より正確かつ精密でした。もう一つはノートパソコンの 1 コア上で走らせた疎パウリ動力学（Begusic・Chan）で、報告された量子側の実行時間より桁違いに高速でした。誤り緩和そのものは機能しました。残らなかったのは量子優位という読み方です。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Error mitigation for short-depth quantum circuits", authors: "Kristan Temme, Sergey Bravyi, Jay M. Gambetta", year: "2016", url: "https://arxiv.org/abs/1612.02058" },
      { title: "Efficient tensor network simulation of IBM's Eagle kicked Ising experiment", authors: "Joseph Tindall, Matt Fishman, Miles Stoudenmire, Dries Sels", year: "2023", url: "https://arxiv.org/abs/2306.14887" },
      { title: "Fast classical simulation of evidence for the utility of quantum computing before fault tolerance", authors: "Tomislav Begušić, Garnet Kin-Lic Chan", year: "2023", url: "https://arxiv.org/abs/2306.16372" },
    ],
  },
  {
    kind: "method",
    id: "probabilistic-error-cancellation",
    label: "Probabilistic error cancellation (PEC)",
    labelJa: "確率的誤り相殺（PEC）",
    summary: "Write the inverse of the characterized noise channel as a quasi-probability distribution over implementable operations, sample circuits from it, and combine the results with signed weights. Unlike extrapolation it inverts the noise rather than fitting through it, so it is unbiased in principle.",
    summaryJa: "特性評価した雑音チャネルの逆を、実行可能な操作の上の擬確率分布として書き、そこから回路を標本抽出して符号付きの重みで結果をまとめます。外挿のように曲線を当てはめるのではなく雑音を反転させるため、原理的には偏りがありません。",
    realizes: "error-mitigation",
    conditions: "Requires an accurate characterization of the noise channel, and that is the binding constraint — PEC's experimental history is largely the history of noise-learning methods catching up. Van den Berg et al. make it work at scale by learning a sparse Pauli-Lindblad model that captures crosstalk, over twirled circuits, so that the noise really is stochastic Pauli noise; Endo, Benjamin and Li treat imperfect knowledge of the error model explicitly. Temme, Bravyi and Gambetta state that the size of the circuits to which these techniques can be applied is limited by the rate at which errors are introduced.",
    conditionsJa: "雑音チャネルの正確な特性評価が必要で、そこが律速になります。PEC の実験史は、ほぼそのまま雑音学習の手法が追いついてきた歴史です。van den Berg らは、トワリング（twirling）を施した回路の上で、クロストークまで捉える疎な Pauli–Lindblad モデルを学習し、雑音を実際に確率的なパウリ雑音にすることで、大規模でも成立させました。Endo・Benjamin・Li は、誤りモデルの知識が不完全な場合を明示的に扱っています。Temme・Bravyi・Gambetta は、この手法を適用できる回路の規模が、誤りの発生率によって制約されると述べています。",
    steps: [],
    citations: [
      { title: "Error mitigation for short-depth quantum circuits", authors: "Kristan Temme, Sergey Bravyi, Jay M. Gambetta", year: "2016", url: "https://arxiv.org/abs/1612.02058" },
      { title: "Probabilistic error cancellation with sparse Pauli-Lindblad models on noisy quantum processors", authors: "Ewout van den Berg, Zlatko K. Minev, Abhinav Kandala, Kristan Temme", year: "2022", url: "https://arxiv.org/abs/2201.09866" },
      { title: "Practical Quantum Error Mitigation for Near-Future Applications", authors: "Suguru Endo, Simon C. Benjamin, Ying Li", year: "2017", url: "https://arxiv.org/abs/1712.09271" },
    ],
  },
  {
    kind: "method",
    id: "readout-error-mitigation",
    label: "Readout (measurement) error mitigation",
    labelJa: "読み出し誤り緩和",
    summary: "Correct the classical readout channel by deconvolving the assignment matrix that maps true bitstrings to observed ones. The naive form calibrates and inverts the full $2^n x 2^n$ matrix; the scalable form never forms it.",
    summaryJa: "真のビット列を観測されたビット列へ写す割り当て行列を逆畳み込みして、古典的な読み出し経路を補正します。素朴なやり方は $2^n x 2^n$ の割り当て行列を較正して反転しますが、規模に耐える方法はその行列を作りません。",
    realizes: "error-mitigation",
    conditions: "Addresses readout error only — it does nothing about gate or decoherence error, and treating it as general-purpose mitigation is a category error. The approach Nation et al. displace forms the full assignment matrix and inverts it, which needs $2^n$ calibration circuits and a $2^n x 2^n$ inverse and can return unphysical negative probabilities; their method never forms it. The scalable method works in the subspace defined by the observed bitstrings, accommodates correlated as well as uncorrelated errors, and yields computable error bounds.",
    conditionsJa: "扱えるのは読み出し誤りだけです。ゲート誤りやデコヒーレンスには何もせず、汎用の誤り緩和として扱うのは種類の取り違えです。Nation らが置き換える従来のやり方は、割り当て行列を全体として作って反転するもので、$2^n$ 本の較正回路と $2^n x 2^n$ の逆行列を要し、物理的にありえない負の確率を返すこともあります。同論文の手法はその行列を一度も作りません。規模に耐える方法は、観測されたビット列が張る部分空間の上で働き、相関のある誤りも扱え、計算可能な誤差限界を与えます。",
    cost: "Nation, Kang, Sundaresan and Gambetta report a matrix-free preconditioned iterative solver converging in $O(1)$ steps and using orders of magnitude less memory than direct factorization, mitigating in a few seconds at qubit numbers where the direct method is intractable.",
    costJa: "Nation・Kang・Sundaresan・Gambetta は、行列を陽に作らない前処理付きの反復解法が $O(1)$ 回の反復で収束し、直接分解に比べて桁違いに少ないメモリで済み、直接法では扱えない量子ビット数でも数秒で緩和できると報告しています。",
    steps: [],
    atomic: true,
    citations: [
      { title: "Scalable mitigation of measurement errors on quantum computers", authors: "Paul D. Nation, Hwajung Kang, Neereja Sundaresan, Jay M. Gambetta", year: "2021", url: "https://arxiv.org/abs/2108.12518" },
    ],
  },
  {
    kind: "capability",
    id: "error-correction",
    label: "Build logical qubits at a target logical error rate",
    labelJa: "目標の論理誤り率をもつ論理量子ビットを作る",
    shortLabel: "Build logical qubits",
    shortLabelJa: "論理量子ビットを作る",
    summary: "Encode physical qubits whose error rate $p$ sits below a code- and decoder-specific threshold into logical qubits meeting a target logical error rate per round, by spending qubits and time on redundancy and decoding syndromes in real time. Which code sits underneath reaches the layers above only as a physical-qubit count and a demand on connectivity.",
    summaryJa: "符号と復号器に固有のしきい値を下回る物理誤り率 $p$ の量子ビットを符号化し、冗長化と実時間の症候群復号に量子ビットと時間を投じて、1 ラウンドあたりの論理誤り率が目標を満たす論理量子ビットを返します。下に敷かれる符号が何であるかは、必要な物理量子ビット数と要求される結合の豊かさとしてのみ上位に現れます。",
    contract: {
      from: "physical-qubits",
      to: "logical-qubits",

      takes: "A physical error rate p and noise model; a target logical error rate P_L; a connectivity constraint; a measurement and feedback cycle time.",
      takesJa: "物理誤り率 p と雑音モデル、目標の論理誤り率 P_L、結合の制約、測定とフィードバックの周期。",
      returns: "Logical qubits, together with the code and code distance d that were chosen for them, a physical-qubits-per-logical-qubit figure, and a decoding latency requirement.",
      returnsJa: "論理量子ビットと、そのために選ばれた符号および符号距離 d、論理量子ビット 1 個あたりの物理量子ビット数、そして復号に許される遅延。",
    },
    whyALayer: "Everything above this layer is written in logical qubits and is indifferent to which code sits underneath; everything below is physics. The competing codes trade threshold against encoding rate against required connectivity. The parameter to watch is the code distance $d$: it is an OUTPUT of this layer, solved for from the physical error rate $p$ and the target logical error rate $P_L$ that the algorithm's total operation count demands. Halve $p$ and $d$ falls; raise the $T$-count and $d$ rises. A distance quoted on its own, or a physical-per-logical ratio quoted without $p$, $P_L$ and $d$ beside it, states nothing.",
    whyALayerJa: "この層より上はすべて論理量子ビットで書かれており、下に敷かれる符号が何であるかに依存しません。下はすべて物理です。競合する符号は、しきい値・符号化率・要求される結合の豊かさを互いに引き換えにします。注意すべき量は符号距離 $d$ です。$d$ はこの層の出力であり、物理誤り率 $p$ と、アルゴリズムの総演算数が要求する論理誤り率 $P_L$ から解いて決まります。$p$ を半分にすれば $d$ は下がり、$T$ 数を増やせば $d$ は上がります。単独で挙げられた距離や、$p$・$P_L$・$d$ を併記しない『論理 1 個あたり物理何個』という比は、何も述べていません。",
  },
  {
    kind: "method",
    id: "surface-code",
    label: "Surface code",
    labelJa: "表面符号",
    summary: "Encode a logical qubit in the homology of a two-dimensional lattice of physical qubits, with weight-4 stabilizers measured by nearest-neighbour circuits. It is the dominant fault-tolerant code because it needs only a 2D nearest-neighbour grid and tolerates a comparatively high physical error rate.",
    summaryJa: "物理量子ビットを並べた 2 次元格子のホモロジーに論理量子ビットを符号化し、重み 4 の安定化演算子を最近接回路で測定します。2 次元の最近接格子だけで済み、比較的高い物理誤り率まで耐えるため、誤り耐性計算で主流の符号です。",
    realizes: "error-correction",
    conditions: "Requires the physical error rate $p$ to sit strictly below a threshold that depends on the code variant, the syndrome-extraction circuit, the noise model AND the decoder — a threshold quoted without all four means nothing. The encoding rate is poor: one logical qubit per patch. The code distance is not a property of a machine; it is solved for from $p$ and the target logical error rate the algorithm's total operation count demands. Real-time syndrome decoding is a separate engineering problem with a hard latency budget, and the decoder is part of what sets the observed threshold. One caution on reading the Google result: the once-an-hour correlated-error floor sometimes quoted beside it was measured with repetition codes run to probe the limits, not observed as the limit of the surface-code memories.",
    conditionsJa: "物理誤り率 $p$ が、しきい値を厳密に下回る必要があります。そのしきい値は符号の変種・症候群抽出回路・雑音モデル・復号器の 4 つに依存し、4 つを述べずに挙げたしきい値には意味がありません。符号化率は低く、1 つのパッチにつき論理量子ビットは 1 つです。符号距離は装置の性質ではなく、$p$ と、アルゴリズムの総演算数が要求する論理誤り率から解いて決める量です。実時間の症候群復号は厳しい遅延予算をもつ別の工学問題であり、観測されるしきい値を決める要素の 1 つでもあります。Google の結果を読む際の注意として、これと並べて引かれることのある『1 時間に 1 度ほど起きる相関誤りが性能の下限を定める』という記述は、限界を探るために走らせた繰り返し符号で測られたものであり、表面符号メモリの限界として観測されたものではありません。",
    cost: "Fowler, Mariantoni, Martinis and Cleland give the empirical scaling $P_L ≈ 0.03 (p/p_th)^d_e$, with error dimension $d_e = (d+1)/2$ for odd $d$ (rounded down to $d/2$ for even $d$), and measure $p_th = 0.57$% for their circuit and noise model. In their defect-based construction a logical qubit costs $2.5 x 1.25 x (2d)^2 ≈ 12.5 d^2$ physical qubits — about 3600 at $d = 17$ and about 14500 at $d = 34$. Google reports logical error suppressed by $Λ = 2.14 ± 0.02$ per two units of distance, reaching $0.143$% $± 0.003$% per cycle on a 101-qubit distance-7 code, beyond break-even by a factor $2.4 ± 0.3$.",
    costJa: "Fowler・Mariantoni・Martinis・Cleland は経験則 $P_L ≈ 0.03 (p/p_th)^d_e$（誤り次元 $d_e$ は奇数の $d$ では $(d+1)/2$、偶数の $d$ では $d/2$ に切り下げ）を与え、自らの回路と雑音モデルで $p_th = 0.57$% を測っています。同論文の欠陥に基づく構成では、論理量子ビット 1 個あたり $2.5 x 1.25 x (2d)^2 ≈ 12.5 d^2$ 個の物理量子ビットを要し、$d = 17$ でおよそ 3600 個、$d = 34$ でおよそ 14500 個になります。Google は距離 2 単位あたり $Λ = 2.14 ± 0.02$ の論理誤り抑制を報告し、101 量子ビットの距離 7 の符号で 1 周期あたり $0.143$% $± 0.003$%、損益分岐点を $2.4 ± 0.3$ 倍上回ったとしています。",
    steps: [],
    citations: [
      { title: "Surface codes: Towards practical large-scale quantum computation", authors: "Austin G. Fowler, Matteo Mariantoni, John M. Martinis, Andrew N. Cleland", year: "2012", url: "https://arxiv.org/abs/1208.0928" },
      { title: "Quantum error correction below the surface code threshold", authors: "Rajeev Acharya, Laleh Aghababaie-Beni, Igor Aleiner, Trond I. Andersen, Markus Ansmann, Frank Arute, Kunal Arya, Abraham Asfaw, Nikita Astrakhantsev, Juan Atalaya, Ryan Babbush, Dave Bacon, Brian Ballard, Joseph C. Bardin, Johannes Bausch, Andreas Bengtsson, Alexander Bilmes, Sam Blackwell, Sergio Boixo, Gina Bortoli, Alexandre Bourassa, Jenna Bovaird, Leon Brill, Michael Broughton, David A. Browne, Brett Buchea, Bob B. Buckley, David A. Buell, Tim Burger, Brian Burkett, Nicholas Bushnell, Anthony Cabrera, Juan Campero, Hung-Shen Chang, Yu Chen, Zijun Chen, Ben Chiaro, Desmond Chik, Charina Chou, Jahan Claes, Agnetta Y. Cleland, Josh Cogan, Roberto Collins, Paul Conner, William Courtney, Alexander L. Crook, Ben Curtin, Sayan Das, Alex Davies, Laura De Lorenzo, Dripto M. Debroy, Sean Demura, Michel Devoret, Agustin Di Paolo, Paul Donohoe, Ilya Drozdov, Andrew Dunsworth, Clint Earle, Thomas Edlich, Alec Eickbusch, Aviv Moshe Elbag, Mahmoud Elzouka, Catherine Erickson, Lara Faoro, Edward Farhi, Vinicius S. Ferreira, Leslie Flores Burgos, Ebrahim Forati, Austin G. Fowler, Brooks Foxen, Suhas Ganjam, Gonzalo Garcia, Robert Gasca, Élie Genois, William Giang, Craig Gidney, Dar Gilboa, Raja Gosula, Alejandro Grajales Dau, Dietrich Graumann, Alex Greene, Jonathan A. Gross, Steve Habegger, John Hall, Michael C. Hamilton, Monica Hansen, Matthew P. Harrigan, Sean D. Harrington, Francisco J. H. Heras, Stephen Heslin, Paula Heu, Oscar Higgott, Gordon Hill, Jeremy Hilton, George Holland, Sabrina Hong, Hsin-Yuan Huang, Ashley Huff, William J. Huggins, Lev B. Ioffe, Sergei V. Isakov, Justin Iveland, Evan Jeffrey, Zhang Jiang, Cody Jones, Stephen Jordan, Chaitali Joshi, Pavol Juhas, Dvir Kafri, Hui Kang, Amir H. Karamlou, Kostyantyn Kechedzhi, Julian Kelly, Trupti Khaire, Tanuj Khattar, Mostafa Khezri, Seon Kim, Paul V. Klimov, Andrey R. Klots, Bryce Kobrin, Pushmeet Kohli, Alexander N. Korotkov, Fedor Kostritsa, Robin Kothari, Borislav Kozlovskii, John Mark Kreikebaum, Vladislav D. Kurilovich, Nathan Lacroix, David Landhuis, Tiano Lange-Dei, Brandon W. Langley, Pavel Laptev, Kim-Ming Lau, Loïck Le Guevel, Justin Ledford, Kenny Lee, Yuri D. Lensky, Shannon Leon, Brian J. Lester, Wing Yan Li, Yin Li, Alexander T. Lill, Wayne Liu, William P. Livingston, Aditya Locharla, Erik Lucero, Daniel Lundahl, Aaron Lunt, Sid Madhuk, Fionn D. Malone, Ashley Maloney, Salvatore Mandrá, Leigh S. Martin, Steven Martin, Orion Martin, Cameron Maxfield, Jarrod R. McClean, Matt McEwen, Seneca Meeks, Anthony Megrant, Xiao Mi, Kevin C. Miao, Amanda Mieszala, Reza Molavi, Sebastian Molina, Shirin Montazeri, Alexis Morvan, Ramis Movassagh, Wojciech Mruczkiewicz, Ofer Naaman, Matthew Neeley, Charles Neill, Ani Nersisyan, Hartmut Neven, Michael Newman, Jiun How Ng, Anthony Nguyen, Murray Nguyen, Chia-Hung Ni, Thomas E. O'Brien, William D. Oliver, Alex Opremcak, Kristoffer Ottosson, Andre Petukhov, Alex Pizzuto, John Platt, Rebecca Potter, Orion Pritchard, Leonid P. Pryadko, Chris Quintana, Ganesh Ramachandran, Matthew J. Reagor, David M. Rhodes, Gabrielle Roberts, Eliott Rosenberg, Emma Rosenfeld, Pedram Roushan, Nicholas C. Rubin, Negar Saei, Daniel Sank, Kannan Sankaragomathi, Kevin J. Satzinger, Henry F. Schurkus, Christopher Schuster, Andrew W. Senior, Michael J. Shearn, Aaron Shorter, Noah Shutty, Vladimir Shvarts, Shraddha Singh, Volodymyr Sivak, Jindra Skruzny, Spencer Small, Vadim Smelyanskiy, W. Clarke Smith, Rolando D. Somma, Sofia Springer, George Sterling, Doug Strain, Jordan Suchard, Aaron Szasz, Alex Sztein, Douglas Thor, Alfredo Torres, M. Mert Torunbalci, Abeer Vaishnav, Justin Vargas, Sergey Vdovichev, Guifre Vidal, Benjamin Villalonga, Catherine Vollgraff Heidweiller, Steven Waltman, Shannon X. Wang, Brayden Ware, Kate Weber, Theodore White, Kristi Wong, Bryan W. K. Woo, Cheng Xing, Z. Jamie Yao, Ping Yeh, Bicheng Ying, Juhwan Yoo, Noureldin Yosri, Grayson Young, Adam Zalcman, Yaxing Zhang, Ningfeng Zhu, Nicholas Zobrist", year: "2024", url: "https://arxiv.org/abs/2408.13687" },
      { title: "Topological quantum memory", authors: "Eric Dennis, Alexei Kitaev, Andrew Landahl, John Preskill", year: "2001", url: "https://arxiv.org/abs/quant-ph/0110143" },
    ],
  },
  {
    kind: "method",
    id: "qldpc-code",
    label: "Quantum LDPC codes (bivariate bicycle family)",
    labelJa: "量子 LDPC 符号（bivariate bicycle 系列）",
    shortLabel: "qLDPC codes",
    shortLabelJa: "qLDPC 符号",
    summary: "Trade the surface code's strictly planar layout for slightly richer connectivity, in exchange for a much better encoding rate. Many logical qubits live in one code block instead of one per patch.",
    summaryJa: "表面符号の厳密に平面な配置を諦めて結合をわずかに豊かにする代わりに、符号化率を大きく改善します。1 パッチに論理量子ビット 1 つではなく、1 つの符号ブロックに多数の論理量子ビットが入ります。",
    realizes: "error-correction",
    conditions: "Requires a degree-6 qubit connectivity graph decomposable into two edge-disjoint planar subgraphs — strictly more than the surface code's 2D nearest-neighbour grid, and the binding practical constraint. The headline result is a fault-tolerant MEMORY; performing logical operations on these codes is substantially less developed than lattice surgery on surface codes, so this is not yet a drop-in replacement for a full computation. Syndrome decoding remains a separate real-time problem, and matching decoders built for surface codes do not transfer directly.",
    conditionsJa: "次数 6 の結合グラフで、辺素な 2 つの平面部分グラフに分解できるものが必要です。これは表面符号の 2 次元最近接格子より厳しく、実務上の律速になります。看板となる結果は誤り耐性メモリであり、これらの符号の上で論理操作を行う方法は表面符号の格子手術に比べてはるかに未成熟なので、計算全体をそのまま置き換えられるものではありません。症候群復号も別の実時間問題として残り、表面符号向けに作られたマッチング復号器はそのままでは移せません。",
    cost: "Error threshold 0.8% under the standard circuit-based noise model, on par with the surface code. A syndrome cycle for a length-$n$ code uses $n$ ancillary qubits and a depth-7 nearest-neighbour CNOT circuit. Bravyi et al. preserve 12 logical qubits for nearly a million syndrome cycles using 288 total physical qubits at physical error rate 0.1%, against an argued nearly 3000 physical qubits for equivalent surface-code suppression.",
    costJa: "標準的な回路レベル雑音モデルのもとでのしきい値は 0.8% で、表面符号と同程度です。長さ $n$ の符号の症候群 1 周期は、$n$ 個のアンシラ量子ビットと深さ 7 の最近接 CNOT 回路で構成されます。Bravyi らは、物理誤り率 0.1% のもとで合計 288 個の物理量子ビットを使い、12 個の論理量子ビットを 100 万に近い症候群周期にわたって保持しています。同等の抑制を表面符号で得るには 3000 個近い物理量子ビットが要る、というのが同論文の議論です。",
    steps: [],
    citations: [
      { title: "High-threshold and low-overhead fault-tolerant quantum memory", authors: "Sergey Bravyi, Andrew W. Cross, Jay M. Gambetta, Dmitri Maslov, Patrick Rall, Theodore J. Yoder", year: "2023", url: "https://arxiv.org/abs/2308.07915" },
    ],
  },
  ],
};
