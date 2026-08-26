// The authored state vocabulary: every object a route can be holding.
//
// Small on purpose. Twenty-eight of these 29 names were read off the `takes` and
// `returns` prose already written on the slots in `layer-graph.ts` — nothing in
// that first tranche is a new claim about the literature, it is the same claim
// with the nouns pulled out and given one spelling each. Where two slots
// described the same object in different words, that is now one state; where
// they described genuinely different objects, it is two, and `specializes`
// records the cases where one is a kind of another.
//
// `hamiltonian-surrogate` is the exception and the first of its kind: it was
// authored **with** a slot rather than lifted from one, because the object it
// names had no contract to be lifted from — `lchs-route` and `schrodingerisation`
// were both filed as reaching Hamiltonian simulation directly from a linear ODE
// system, and the conversion between the two was the thing nobody had written
// down. That is the growth path the owner set in session 106: granularity gets
// finer as methods arrive, and a submethod earns a state of its own where it
// diverges from its siblings in the mathematics rather than in the wording.
// Every such addition is recorded in `plans/leona-map-scaling-rules.md` §R15.
//
// The test of whether a state belongs here is the one `whyALayer` applies to a
// slot: can you name **two different processes that arrive at it** or **two that
// leave it**? A noun that appears on exactly one edge, in one direction, is a
// parameter of that process and belongs in its contract prose.
//
// Authored in TS beside the graph for the reason D89.3 gives: it reaches a
// visitor on the merge, and it stays outside the record pin, the manifest
// freshness check and the width-family gate.
import type { StateVocabulary } from "./states.ts";

export const STATE_VOCABULARY: StateVocabulary = {
  states: [
    // --- the differential-equation spine -----------------------------------
    {
      id: "pde-problem",
      label: "Partial differential equation",
      labelJa: "偏微分方程式",
      summary:
        "A linear PDE on a continuous spatial domain, with the initial or boundary conditions that pin its solution — the problem as it is posed, before any grid exists. It is the one object here with infinitely many degrees of freedom, and that is what makes the first step real work rather than bookkeeping: replacing the continuum with finitely many numbers costs an error nobody can avoid, and that error is the first term in every budget downstream.",
      summaryJa:
        "連続な空間領域の上の線形偏微分方程式と、その解を定める初期条件あるいは境界条件。すなわち、格子を導入する前の、提示されたままの問題です。ここに登場する対象のうち、自由度が無限であるのはこれだけであり、そのために最初の一歩は帳簿づけではなく実質的な作業になります。連続体を有限個の数値で置き換えるには誰にも避けられない誤差が伴い、その誤差こそ、下流のあらゆる見積もりにおける最初の項だからです。",
      // **Two processes leave this state, which is what this file's own
      // admission test asks for** (stated in the header above; it said
      // `states.ts` until 2026-08-26, which never held the rule), and one paper
      // states both by itself rather than the two
      // being lined up from separate sources. Linden, Montanaro and Shao
      // (arXiv:2004.06516) discretise space *and* time by FTCS into a single
      // block system over all timesteps (§I A, Eq. 38), and give the alternative
      // explicitly in their Appendix A: *"if we just discretise x_1,...,x_d ...
      // we obtain a system of ODEs"*.
      //
      // So this is deliberately NOT one process composed with
      // `time-discretization`. Heat's FTCS produces the whole linear system in
      // one step rather than discretising space and then time, and the plasma
      // problem (arXiv:2403.11989) has no time axis to discretise at all — it is
      // a boundary-value problem at a fixed drive frequency. Reading them as a
      // composition would attribute to those papers a two-stage structure
      // neither of them has.
      //
      // **No `specializes`, and no parent is tempting.** A PDE is not a kind of
      // `nonlinear-ivp` or `linear-ivp`: those are finite vector systems and this
      // is not, which is the whole reason the discretisation between them costs
      // anything. Declaring a parent here would let `stateSatisfies` hand a PDE
      // straight to an ODE solver and call the continuum limit free.
    },
    {
      id: "nonlinear-ivp",
      label: "Nonlinear initial-value problem",
      labelJa: "非線形の初期値問題",
      summary:
        "A nonlinear vector field F, an initial condition, a time to evolve to, and an error you are willing to accept. Nothing quantum acts on this directly — quantum time evolution is linear — so every route begins by changing what it is holding.",
      summaryJa:
        "非線形ベクトル場 F、初期条件、発展させる時刻、そして許容する誤差。量子力学の時間発展は線形であるため、量子プリミティブがこの対象に直接作用することはありません。どの経路も、まず手にしているものを取り替えるところから始まります。",
    },
    {
      id: "linear-ivp",
      label: "Linear ODE system",
      labelJa: "線形常微分方程式系",
      summary:
        "A generator A(t), any inhomogeneity, and an initial vector — du/dt = A(t)u + b(t) on a space that may be much larger than the one you started in, together with the maps that lifted you into it and will read you back out.",
      summaryJa:
        "生成子 A(t)、非斉次項、初期ベクトル。すなわち du/dt = A(t)u + b(t) であり、その空間は出発点よりはるかに大きいことがあります。持ち上げ写像と読み出し写像も一緒に携えています。",
    },
    {
      id: "hermitian-generator",
      label: "Hermitian generator",
      labelJa: "エルミート生成子",
      summary:
        "A linear generator that happens to be Hermitian, so the evolution it drives is unitary and a simulator can run it as it stands. This is why some lifts reach an answer without ever assembling a linear system.",
      summaryJa:
        "たまたまエルミートであった線形生成子。これが駆動する発展はユニタリであり、シミュレータがそのまま実行できます。線形系を組み立てることなく答えにたどり着く持ち上げがあるのは、このためです。",
      specializes: ["linear-ivp", "hamiltonian-access"],
    },
    {
      id: "hamiltonian-surrogate",
      label: "Hamiltonian surrogate, with the map back",
      labelJa: "ハミルトニアン代理系と復元写像",
      summary:
        "A Hermitian generator manufactured from one that was not — on a space at least as large as the one you were in — whose unitary evolution carries the non-unitary dynamics you started with, together with the map that reads the original solution back out. The map is part of the object rather than an afterthought: it is where the norm the true dynamics lost gets paid back, and it is the half that costs.",
      summaryJa:
        "エルミートでなかった生成子から作り出したエルミート生成子であり、元より小さくない空間の上で、そのユニタリな発展が元の非ユニタリな力学を担います。あわせて、元の解を読み出すための復元写像を伴います。この写像は付随物ではなく対象の一部です。真の力学が失ったノルムはここで払い戻され、費用が現れるのもこの側です。",
      // `hamiltonian-access`, and deliberately **not** `hermitian-generator` —
      // which would be the tempting one, since the object is Hermitian and
      // `hermitian-generator` is right there carrying exactly the two parents a
      // reader would want.
      //
      // It was written that way first and measured: `hermitian-generator`
      // specializes `linear-ivp`, so the walk read a surrogate as a linear ODE
      // system you could hand back to `linear-ode-solve`, and `nonlinear-ode-solve`
      // grew two ways across that drew **`linear-ode-solve` inside itself** —
      // recast-then-solve-the-ODE, and recast-then-discretize-then-linear-solve.
      // Neither is anything a source records: LCHS and Schrödingerisation both
      // hand the surrogate to a simulator and nothing else.
      //
      // The distinction is real and not a convenience. A Koopman-von Neumann
      // lift produces the problem you go on to solve. A surrogate is not the
      // problem — it is an instrument, and its solution means nothing until the
      // recovery map has been applied. So what it *is*, for the purpose of what
      // may consume it, is a Hamiltonian you can query.
      //
      // Sometimes a *family* of them rather than one: LCHS produces
      // {kL(t)+H(t)} indexed by a quadrature variable and combines them with an
      // LCU. The claim survives, because what a simulator is ever handed is one
      // member and every member is Hermitian by construction — but it is written
      // here rather than left to be read off the arrow.
      specializes: ["hamiltonian-access"],
    },
    {
      id: "linear-system",
      label: "Linear system Ax = b",
      labelJa: "線形方程式系 Ax = b",
      summary:
        "One matrix and one right-hand side, with the whole time history folded into them. It has a condition number, and that number is what the cost of solving it will be measured against. Every solver in the literature is handed it as an access model for the matrix plus a routine preparing the right-hand side, which is why it counts as a matrix you can query.",
      summaryJa:
        "ひとつの行列とひとつの右辺。時間履歴の全体がそこに畳み込まれています。条件数をもち、求解の計算量はその条件数を基準に測られます。文献上のソルバーはいずれも、行列へのアクセスモデルと右辺を準備する手続きの組として受け取ります。問い合わせ可能な行列の一種と数えるのはそのためです。",
      specializes: ["matrix-access"],
    },
    {
      id: "solution-answer",
      label: "Answer about the solution",
      labelJa: "解についての答え",
      summary:
        "Whatever a route hands back about the state of the system at the end — a state you can measure, a history over the whole interval, or a single number. Which of the three you get is a real difference between routes, so each is its own kind below this one.",
      summaryJa:
        "経路が最後に返してくる、系の終状態についての何か。測定できる状態、区間全体にわたるヒストリー、あるいは一個の数値です。そのどれが得られるかは経路ごとの実質的な違いであり、それぞれをこの下位の種類として区別しています。",
    },
    {
      id: "solution-state",
      label: "Solution as a state",
      labelJa: "解に比例する状態",
      summary:
        "A normalised quantum state close to the answer vector. You can measure it and you can feed it onward, but you do not have its norm, any one of its entries, or any classical function of it — those cost extra and are decided a layer up.",
      summaryJa:
        "答えのベクトルに近い、正規化された量子状態。測定することも、そのまま次に渡すこともできます。ただしノルム、個々の成分、古典的な関数値は得られていません。それらには追加の費用がかかり、ひとつ上の層で決まります。",
      specializes: ["solution-answer", "prepared-state"],
    },
    {
      id: "history-state",
      label: "History state",
      labelJa: "ヒストリー状態",
      summary:
        "The solution at every recorded time step, superposed in one register with a clock. Reading one time out of it costs a measurement that lands on the others too.",
      summaryJa:
        "記録された各時刻での解が、時計レジスタとともにひとつのレジスタに重ね合わされたもの。ひとつの時刻を取り出す読み出しは、他の時刻にも影響します。",
      specializes: ["solution-answer", "prepared-state"],
    },

    // --- matrices and their access models -----------------------------------
    {
      id: "matrix-access",
      label: "Matrix you can query",
      labelJa: "問い合わせ可能な行列",
      summary:
        "Some way of asking about a matrix without writing it down — sparse row and column oracles, a Pauli or LCU decomposition, a purification, or an explicit arithmetic rule. Which one you have decides which routes are open.",
      summaryJa:
        "行列を書き下さずに問い合わせる手立て。疎な行・列オラクル、Pauli 分解や LCU 分解、純粋化、あるいは明示的な算術規則です。どれを持っているかで、開いている経路が決まります。",
    },
    {
      id: "block-encoding",
      label: "Block-encoding",
      labelJa: "ブロックエンコーディング",
      summary:
        "A unitary whose top-left block is the matrix you care about, divided by a subnormalisation α. Because the unitary has norm one, α is not a free parameter — it bounds the matrix, and it multiplies straight into every cost downstream.",
      summaryJa:
        "左上のブロックが目的の行列を副正規化 α で割ったものになっているユニタリ。ユニタリのノルムは 1 なので α は自由なパラメータではなく、行列を上から抑えると同時に、下流のあらゆる計算量にそのまま掛かってきます。",
      specializes: ["matrix-access"],
    },
    {
      id: "transformed-block-encoding",
      label: "Block-encoding of f(A)",
      labelJa: "f(A) のブロックエンコーディング",
      summary:
        "The same shape of object as the one you started with, holding a function of the original matrix instead of the matrix. That it is still a block-encoding is what makes these transformations compose.",
      summaryJa:
        "出発点と同じ形の対象で、中身は元の行列ではなくその関数になっています。依然としてブロックエンコーディングであることが、この種の変換を合成可能にしています。",
      specializes: ["block-encoding"],
    },
    {
      id: "hamiltonian-access",
      label: "Hamiltonian you can query",
      labelJa: "ハミルトニアン",
      summary:
        "A Hermitian operator reachable as a sum of terms you can exponentiate one at a time, as sparse-access oracles, or as a block-encoding — plus the norm parameter the simulation cost will be quoted against.",
      summaryJa:
        "エルミート演算子であって、個別に指数化できる項の和、疎アクセスオラクル、あるいはブロックエンコーディングとして到達できるもの。シミュレーション計算量を表示する際の基準となるノルムパラメータも伴います。",
      specializes: ["matrix-access"],
    },
    {
      id: "eigenvalue-problem",
      label: "Hamiltonian whose eigenvalues are wanted",
      labelJa: "固有値を求めたいハミルトニアン",
      summary:
        "A Hamiltonian you can query, plus the declaration that what is being asked for is a piece of its spectrum rather than an evolution under it. Which piece — the bottom of it, or a state above the bottom — is the next distinction down, and the two are separate states because the methods that answer them do not substitute for one another.",
      summaryJa:
        "問い合わせ可能なハミルトニアンに加えて、求められているのがその下での発展ではなくスペクトルの一部であるという宣言。どの部分か——最下部か、それとも最下部より上の状態か——はもう一段下の区別であり、それらを別々の状態としているのは、両者に答える方式が互いに代替にならないからです。",
      // **The parent `ground-state-problem` used to have, added when the region
      // gained a second question.** Everything the comment below says about
      // narrowness applies at THIS level: the ODE route that walked
      // `nonlinear-ode-solve` → recast to a Hamiltonian → the variational region
      // is stopped here, because a recasting produces a Hamiltonian to evolve and
      // never a declaration that its spectrum is what is wanted.
      //
      // It exists because `ansatz-construction` serves both questions and only one
      // of them is a ground state. Pointing that slot at `ground-state-problem`
      // was right while the region had one root; with `excited-state-problem`
      // beside it, the same slot would have been unreachable from half its own
      // region — and the two ways out of that are a lie about what an
      // excited-state problem is (declaring it a kind of ground-state problem, so
      // it inherits the slot) or this: name the thing they actually share.
      specializes: ["hamiltonian-access"],
    },
    {
      id: "ground-state-problem",
      label: "Hamiltonian whose ground state is wanted",
      labelJa: "基底状態を求めたいハミルトニアン",
      summary:
        "A Hamiltonian you can query, plus the declaration that the quantity being asked for is its lowest eigenvalue. The second half is not decoration: the same operator can be handed to a simulator to evolve a state under it, and evolving it and minimising it are different questions with different answers.",
      summaryJa:
        "問い合わせ可能なハミルトニアンに加えて、求められている量がその最小固有値であるという宣言。この後半は飾りではありません。同じ演算子はシミュレータに渡して状態をその下で発展させることもでき、発展させることと最小化することは、答えの異なる別々の問いだからです。",
      // **Narrower than `hamiltonian-access` on purpose, and the reason is a bug this
      // state exists to prevent rather than a distinction for its own sake.** With the
      // variational region entered from `hamiltonian-access`, `statePathsBetween` found
      // a route out of `nonlinear-ode-solve`: recast the problem to a Hamiltonian, then
      // hand that Hamiltonian to the variational region and read an observable off it.
      // Every hop type-checks and the whole path is nonsense — a variational eigensolver
      // returns a lowest eigenvalue, not the solution of an initial-value problem at
      // time T — so the figure for `nonlinear-ode-solve` grew a branch no literature
      // contains and blew through its own size ceiling drawing it.
      //
      // The path-finder is not wrong to chain what fits; the vocabulary was wrong to say
      // these two objects were the same one. This is the owner's session-96 point read in
      // the other direction: the value of finding paths the literature has not taken
      // depends entirely on the states being honest about what they are.
      //
      // **Re-parented to `eigenvalue-problem` when the excited-state region arrived, and
      // nothing about the protection above changed.** `kindsOf` walks upward transitively,
      // so this is still a `hamiltonian-access` for every satisfaction check that asks;
      // what it is no longer is the ONLY way to say "a spectral question", which is what
      // made it the wrong entry for a slot that serves excited states too.
      specializes: ["eigenvalue-problem"],
    },
    {
      id: "excited-state-problem",
      label: "Hamiltonian whose excited state is wanted",
      labelJa: "励起状態を求めたいハミルトニアン",
      summary:
        "A Hamiltonian you can query, plus a declaration of which state above the lowest one is being asked for — the k-th, the lowest in a chosen symmetry sector, or the one nearest a target energy. That target is part of the problem, not a setting: a method that finds the ground state has not answered this question, and most methods here need the ground state before they can start.",
      summaryJa:
        "問い合わせ可能なハミルトニアンに加えて、最下位より上のどの状態が求められているかの宣言——第 k 励起状態、選ばれた対称性セクター内の最低状態、あるいは目標エネルギーに最も近い状態。この目標は設定ではなく問題の一部です。基底状態を求めただけではこの問いに答えたことにならず、しかもここに属する方式の多くは、始める前に基底状態そのものを必要とします。",
      // **A sibling of `ground-state-problem`, not a kind of it**, and the distinction is
      // the one the whole region rests on. An excited-state problem carries the opposite
      // declaration — the quantity wanted is NOT the lowest eigenvalue — so calling it a
      // specialisation would let `stateSatisfies` hand one to a ground-state method and
      // call the result an answer. It is narrow in the same way and for the same reason
      // its sibling is: nothing in the differential-equation region produces one, so no
      // path can be invented into this region from there.
      specializes: ["eigenvalue-problem"],
    },

    // --- polynomials and phases ---------------------------------------------
    {
      id: "target-function",
      label: "Target function",
      labelJa: "目標の関数",
      summary:
        "What you want done to the eigenvalues — 1/x, the sign function, e^{-ixt} — together with the domain it has to be right on. The domain is usually not the whole interval, and the piece it excludes is where the cost hides.",
      summaryJa:
        "固有値に対して施したい操作。1/x、符号関数、e^{-ixt} など、正しく成り立つべき定義域を伴います。定義域は区間全体でないのが普通で、除かれた部分にこそ計算量が潜んでいます。",
    },
    {
      id: "polynomial",
      label: "Polynomial approximation",
      labelJa: "多項式近似",
      summary:
        "Chebyshev coefficients, a degree, and the bound the polynomial obeys before anyone rescales it. The degree is the query count a circuit will pay, so this is where an error budget turns into a runtime.",
      summaryJa:
        "Chebyshev 係数、次数、そして再スケーリング前に多項式が満たす上界。次数はそのまま回路が支払う問い合わせ回数になります。誤差の予算が実行時間に変わるのはここです。",
    },
    {
      id: "phase-sequence",
      label: "QSP phase sequence",
      labelJa: "QSP 位相列",
      summary:
        "The angles that make an alternating circuit realise a chosen polynomial. Finding them is classical work, and for high degrees it is numerically delicate work, which is why several methods compete for the same slot.",
      summaryJa:
        "交互回路に所望の多項式を実現させるための角度列。その決定は古典計算であり、高次では数値的に繊細な計算になります。同じ枠を複数の手法が争っているのはそのためです。",
    },

    // --- states and routines -------------------------------------------------
    {
      id: "state-description",
      label: "Vector to load",
      labelJa: "読み込むベクトル",
      summary:
        "The amplitudes you want in a register, given as an explicit list, an analytic density, a short list of nonzero entries, or a low-bond-dimension tensor network. Which form you have is what separates a cheap load from an intractable one.",
      summaryJa:
        "レジスタに載せたい振幅。明示的な列挙、解析的な密度、非零成分の短いリスト、あるいは低ボンド次元のテンソルネットワークとして与えられます。どの形で持っているかが、安価な読み込みと手に負えない読み込みを分けます。",
    },
    {
      id: "prepared-state",
      label: "State you can prepare",
      labelJa: "準備できる状態",
      summary:
        "Not the state itself but the routine that makes it — which is the useful form, because a routine can be run again, controlled, and inverted, and a state that has already collapsed can do none of those.",
      summaryJa:
        "状態そのものではなく、それを作る手続き。手続きであることが有用で、再実行も、制御も、逆演算も可能です。すでに収縮した状態にはそのいずれもできません。",
    },
    {
      id: "flagged-routine",
      label: "Routine with a good branch",
      labelJa: "成功分岐をもつ手続き",
      summary:
        "A circuit that produces what you want on one branch and something useless on the others, with a flag telling the two apart. Almost every quantum subroutine hands back one of these, and what it costs to make the good branch likely is usually where the algorithm's cost sits.",
      summaryJa:
        "ある分岐では目的のものを、他の分岐では無用のものを生み、両者を区別するフラグを備えた回路。量子サブルーチンはほとんどこの形で結果を返します。問題は常に、良い分岐の確率を上げるのに何を支払うかです。",
    },
    {
      id: "reliable-routine",
      label: "Reliable routine",
      labelJa: "信頼できる手続き",
      summary:
        "The same routine after the good branch has been amplified, now carrying a failure probability you can quote, a query count, and the sequential depth that buying the reliability consumed.",
      summaryJa:
        "良い分岐を増幅したのちの同じ手続き。明示できる失敗確率、問い合わせ回数、そして信頼性を買うために費やした逐次深さを伴います。",
      specializes: ["prepared-state"],
    },

    // --- circuits and machines ----------------------------------------------
    {
      id: "abstract-circuit",
      label: "Abstract circuit",
      labelJa: "抽象回路",
      summary:
        "Arbitrary rotation angles, arbitrary two-qubit gates, and any qubit able to talk to any other. No machine runs this. Everything between here and hardware is the business of closing that gap and counting what it costs.",
      summaryJa:
        "任意の回転角、任意の二量子ビットゲート、そして任意の量子ビット同士が相互作用できる前提の回路。これを実行できる実機はありません。ここからハードウェアまでの一切は、その隔たりを埋め、代償を数える作業です。",
    },
    {
      id: "parameterized-circuit",
      label: "Parameterised circuit family",
      labelJa: "パラメータ付き回路族",
      summary:
        "Not one circuit but a family of them, indexed by free real parameters — a fixed gate structure with the angles left open. Nothing can be run and nothing can be costed until the angles are chosen, so this is deliberately a different object from the circuit it becomes: the structure decides which states are reachable at all, and the choice of angles only decides which of those you land on.",
      summaryJa:
        "ひとつの回路ではなく、自由な実パラメータで添字づけられた回路の族です。ゲートの構造は固定され、角度だけが未定のまま残されています。角度が決まるまでは実行も費用の見積もりもできないため、これは確定した回路とは意図的に別の対象として扱います。到達しうる状態の範囲を決めるのは構造であり、角度の選択はそのうちのどれに着地するかを決めるにすぎません。",
      // Its own state rather than `abstract-circuit` reused, and the reason is
      // the one the file's header rule protects: a family and a member are not
      // the same object, and the whole variational region turns on the
      // difference. `ansatz-construction` returns the family — nothing about it
      // has a gate count yet, because the angles are open — and
      // `parameter-optimization` is precisely the process that turns a family
      // into a member. If both ends were `abstract-circuit` the optimisation
      // hop would read as a process that changes nothing, which is the shape
      // `validateLayerGraph` rejects outright on a capability contract.
      specializes: ["abstract-circuit"],
    },
    {
      id: "evolution-circuit",
      label: "Circuit for e^{-iHt}",
      labelJa: "e^{-iHt} を実現する回路",
      summary:
        "Time evolution under a Hamiltonian, approximated to a stated error, with the query or gate count and the norm parameter the count is measured against. It is a circuit, not an answer — something still has to run it on a state and read the result.",
      summaryJa:
        "ハミルトニアンのもとでの時間発展を、明示された誤差で近似した回路。問い合わせ回数またはゲート数と、その基準となるノルムパラメータを伴います。これは回路であって答えではありません。状態に作用させ、結果を読み出す工程が別に要ります。",
      specializes: ["abstract-circuit"],
    },
    {
      id: "runnable-evolution",
      label: "Evolution circuit, input in hand",
      labelJa: "入力を手にした発展回路",
      summary:
        "An evolution circuit together with the preparation routine for the input it acts on. The pair is still a circuit — its error and its count are unchanged — and it is also the routine that makes the evolved state: run it and the state is in hand, control and invert it and an estimation readout can call the whole simulation as a subroutine.",
      summaryJa:
        "作用させる入力の準備手続きを伴った発展回路。この組はやはり回路であり、誤差も回数の勘定も変わりません。同時に、発展後の状態を作る手続きでもあります。実行すれば状態が手に入り、制御し逆転すれば、推定型の読み出しがシミュレーション全体をサブルーチンとして呼び出せます。",
      // The second state authored with a route rather than lifted from a
      // contract (`hamiltonian-surrogate` was the first — the growth path the
      // owner set in session 106, recorded in `plans/leona-map-scaling-rules.md`
      // §R15). Both parents are true of the object, not a modelling convenience:
      // Joseph writes "The KvN simulation computes the state |ψ⟩" — the hop
      // lands holding a runnable computation of the evolved state, which is
      // `prepared-state`'s own definition ("not the state itself but the routine
      // that makes it"), and his readout uses both parents at once — it runs the
      // simulation forward and backward (the routine) while counting its
      // invocations as circuit evaluations (the circuit). Owner ruling,
      // session 120: when the map cannot hold something the literature truly
      // has, the map restructures; this state is that restructuring, and it is
      // what lets a `through` narrowing record the landing without widening
      // `observable-estimation.from` for the three readouts that rely on it.
      specializes: ["evolution-circuit", "prepared-state"],
    },
    {
      id: "eigenphase-problem",
      label: "Unitary whose eigenphase is wanted",
      labelJa: "固有位相を求めたいユニタリ",
      summary:
        "A circuit you can apply controlled powers of, together with the routine preparing the state it acts on, plus the declaration that what is being asked for is the phase that state picks up — not the state, and not an expectation value read off it. The second half is not decoration: the same pair handed to a readout returns an average over a distribution, and an eigenphase is a single number sitting in the operator's spectrum.",
      summaryJa:
        "制御べき乗を作用させられる回路と、それが作用する状態を準備する手続き。そこに、求めているのはその状態が獲得する位相であるという宣言が加わります。状態そのものでも、そこから読み出す期待値でもありません。後半は飾りではありません。同じ組を読み出しに渡せば分布の平均が返りますが、固有位相は演算子のスペクトルの中にある一つの数です。",
      // **Narrower than `runnable-evolution` on purpose, and the reason is the same
      // bug `ground-state-problem` exists to prevent** (W21 §0.1, and W25 §3.3 puts
      // it on the wall: *a new region's entry state must be narrower than the
      // nearest existing state, or the path-finder invents routes*). Entered from
      // `runnable-evolution` itself, `statePathsBetween` would have chained the KvN
      // route — the one method on this map that produces that state — straight into
      // phase estimation and called the result an answer. Every hop type-checks and
      // the claim is nonsense: a Koopman–von Neumann simulation of a nonlinear ODE
      // hands you an evolved state to measure, and it never declares that a phase in
      // that evolution's spectrum is the quantity wanted.
      //
      // The pattern is the codebase's own, not a new invention: `hermitian-generator`
      // vs `linear-ivp`, `ground-state-problem` vs `hamiltonian-access`. "The same
      // object plus what is being asked of it" is a real state every time the
      // question changes which methods can answer.
      specializes: ["runnable-evolution"],
    },
    {
      id: "device-figure",
      label: "Number about the machine",
      labelJa: "機械についての数値",
      summary:
        "A figure of merit for the hardware itself — an average error rate, a largest circuit it can actually run — together with the protocol that produced it and the confidence it was established at. It answers a question about the computer, never a question the computer was asked.",
      summaryJa:
        "ハードウェアそのものについての性能指標。平均誤り率や、実際に実行できる最大の回路といったものであり、それを生んだプロトコルと、確立された際の信頼度を伴います。答えているのは計算機についての問いであって、計算機に与えられた問いではありません。",
      // **Deliberately not `observable-value`, and this is the distinction the
      // owner's ai-ops#68 ruling makes possible rather than removes.** That state
      // is "a scalar estimate with an additive-error guarantee" and it sits under
      // `solution-answer` — the family of things a route hands back about a
      // problem it was given. A quantum volume is an integer about a machine and
      // an average error rate is a property of a gate set; neither is an answer to
      // anything the machine was asked to compute. Reusing `observable-value`
      // would have let the path-finder hand a benchmark result to anything that
      // consumes a measured number, and would have told a reader that these
      // protocols solve problems. They characterise the thing that solves them.
    },
    {
      id: "periodic-function-oracle",
      label: "Function promised to be periodic",
      labelJa: "周期をもつと約束された関数",
      summary:
        "A function you can evaluate on a superposition of inputs, together with the promise that it repeats — and, decisively, the kind of thing its period is allowed to be. An integer in a finite cyclic group, an irrational real, or a lattice of periods in several dimensions are three different promises, and the routes that answer them are not interchangeable.",
      summaryJa:
        "入力の重ね合わせの上で評価できる関数と、それが繰り返すという約束。そして決定的に重要なのは、その周期がどのようなものでありうるかという指定です。有限巡回群の中の整数、無理数である実数、そして複数次元の周期の格子は、三つの異なる約束であり、それらに答える経路は互いに置き換えられません。",
      // Which group the period lives in is part of the state rather than a
      // parameter of the method, because it decides which methods can answer at
      // all. Hallgren says so about his own problem in as many words: the periodic
      // structure behind Pell's equation is "a group-like subset of the reals
      // modulo an irrational number", and "this prevents direct application of
      // Shor's algorithms."
    },
    {
      id: "hidden-period",
      label: "The period, recovered",
      labelJa: "回復された周期",
      summary:
        "What the promise was hiding: a single integer period, a real number known to enough bits to be useful, or a basis for the lattice of periods. Not a number with an error bar — an exact integer where the group is finite, and elsewhere an approximation whose precision is itself part of the answer.",
      summaryJa:
        "約束が隠していたもの。すなわち、単一の整数周期、役に立つだけの桁数まで求めた実数、あるいは周期の格子の基底です。誤差付きの数ではありません。群が有限であるところでは正確な整数であり、それ以外では精度そのものが答えの一部となる近似値です。",
      // **Deliberately not `observable-value`.** That state is "a scalar estimate
      // with an additive-error guarantee", and an integer period recovered through
      // a continued-fraction expansion is not an estimate at all — it is exact, and
      // it is verifiable by evaluating the function. Reusing `observable-value`
      // here would have let the path-finder hand a period to anything that consumes
      // a measured number, and would have told a reader that Shor's algorithm
      // returns an error bar. It does not.
    },
    {
      id: "routed-circuit",
      label: "Routed circuit",
      labelJa: "ルーティング済み回路",
      summary:
        "An assignment of logical qubits to physical ones, plus the SWAPs needed to keep every two-qubit gate on an edge the machine actually has. Costed in the depth the routing added, not in the depth you asked for.",
      summaryJa:
        "論理量子ビットの物理量子ビットへの割り当てと、すべての二量子ビットゲートを実機の辺の上に保つために要する SWAP。費用は、要求した深さではなくルーティングが加えた深さで測られます。",
      specializes: ["abstract-circuit"],
    },
    {
      id: "discrete-circuit",
      label: "Discrete-gate circuit",
      labelJa: "離散ゲート回路",
      summary:
        "Continuous rotations replaced by words in a finite gate set, to a stated precision. The count that matters here is the non-Clifford one, because that is what a fault-tolerant machine charges for.",
      summaryJa:
        "連続的な回転を、明示された精度で有限ゲート集合の語に置き換えた回路。ここで意味をもつのは非 Clifford ゲートの数です。誤り耐性機械が課金するのはそこだからです。",
      specializes: ["abstract-circuit"],
    },
    {
      id: "device-circuit",
      label: "Device circuit",
      labelJa: "実機向け回路",
      summary:
        "Native gates, legal connectivity, and an honest account of what compiling added — SWAP count, non-Clifford count, depth, and the approximation error accumulated on the way down.",
      summaryJa:
        "ネイティブゲート、許される結合、そしてコンパイルが加えたものの正直な内訳。SWAP 数、非 Clifford 数、深さ、そして途中で蓄積した近似誤差です。",
      specializes: ["abstract-circuit"],
    },

    // --- numbers that come back ---------------------------------------------
    {
      id: "observable-value",
      label: "Number with an error bar",
      labelJa: "誤差付きの数値",
      summary:
        "A scalar estimate with an additive-error guarantee, the shot or query budget it consumed, and the deepest circuit it actually ran. Every claim about an application eventually has to arrive here.",
      summaryJa:
        "加法的誤差の保証を伴うスカラー推定値、消費したショット数または問い合わせ回数、そして実際に実行した最大の回路深さ。応用についての主張は、最終的にすべてここに帰着します。",
      specializes: ["solution-answer"],
    },
    {
      id: "noisy-estimate",
      label: "Noisy expectation value",
      labelJa: "雑音のある期待値",
      summary:
        "What the hardware actually returned, biased by the noise it ran under. It is a measurement, not an error — treating it as the answer is the mistake, and every mitigation method exists to undo a modelled part of the bias.",
      summaryJa:
        "実機が実際に返した値であり、動作時の雑音によって偏っています。これは測定結果であって誤りではありません。誤りは、これを答えとみなすことです。あらゆる誤り抑制手法は、モデル化された偏りの一部を取り消すために存在します。",
    },
    {
      id: "mitigated-estimate",
      label: "Bias-reduced expectation value",
      labelJa: "偏りを減らした期待値",
      summary:
        "The same number after post-processing, with less bias and more variance. The variance is a sampling overhead and it grows with circuit volume, which is what bounds how far mitigation alone can be pushed.",
      summaryJa:
        "後処理を経た同じ数値で、偏りは減り、分散は増えています。分散はサンプリングのオーバーヘッドであり、回路のボリュームとともに増大します。誤り抑制だけでどこまで押せるかは、これが決めます。",
      specializes: ["observable-value"],
    },

    // --- searching a domain nobody has sorted --------------------------------
    {
      id: "marking-oracle",
      label: "Marking oracle over a domain",
      labelJa: "定義域上の印付けオラクル",
      summary:
        "A check you can run in superposition that answers yes or no about each candidate in a domain of known size, together with whatever promise you hold about how many candidates it says yes to. The promise is not decoration: Grover's own paper assumes exactly one, and the schedule that finds it is fixed before the first query from the domain size alone, so a different promise is a different algorithm rather than a different parameter.",
      summaryJa: "既知のサイズをもつ定義域の中の各候補についてはい・いいえで答える、重ね合わせの上で実行できるチェックと、そのうち肯定と答える候補がいくつあるかについて保持している約束とから成ります。この約束は単なる飾りではありません。Grover 自身の論文はちょうど一つであることを仮定しており、それを見つけ出すスケジュールは、最初の問い合わせよりも前に、定義域のサイズのみから固定されます。したがって、異なる約束は異なるパラメータではなく、異なるアルゴリズムを意味します。",
      // **Deliberately not a kind of `flagged-routine`**, and that is the one
      // decision here a reader is most likely to want argued.
      //
      // `flagged-routine` is "a circuit that produces what you want on one branch
      // and something useless on the others, with a flag telling the two apart" —
      // the routine is built and you are holding it. A marking oracle is the
      // opposite half of that object: a way to test candidates, and no routine
      // producing them. The check that separates the two is the one W27 wrote for
      // a reader to run on any future candidate — *does the record's own paper
      // hand you the preparation unitary A already built, or does it build A for
      // you out of an oracle?* `fixed-point-amplification` lists "the preparation
      // unitary A and its inverse" among its inputs and carries
      // `steps: ["state-preparation"]`; Grover's paper builds its own initial
      // distribution out of the domain in $O(\log N)$ steps and is handed nothing.
      //
      // Declaring the `specializes` would have let `stateSatisfies` pass a bare
      // oracle to `success-amplification` and price the construction of A at
      // nothing — the same failure `hamiltonian-surrogate`'s comment records
      // catching, arriving one region later.
    },
    {
      id: "marked-item",
      label: "A marked item, with its query bill",
      labelJa: "印の付いた候補と、その問い合わせ費用",
      summary:
        "One candidate the check accepts, together with the number of queries it took and the probability the answer is right — or, at a stated confidence, the report that the domain holds none. What is uncertain differs between the routes that arrive here, and the object carries which: Grover samples at the end and is right with probability greater than a half, while the wildcard recovery ends every stage on an oracle answer confirming its guess, so there the bill is the random quantity and the answer is not.",
      summaryJa: "チェックが受理する候補一つと、それに要した問い合わせの回数、そして答えが正しい確率です。あるいは、定められた確信度のもとで、定義域にそのような候補が一つもないという報告です。何が不確かであるかは、ここに至る経路ごとに異なり、この対象はそのどちらであるかを保持しています。Grover は最後にサンプリングを行い、二分の一より大きい確率で正しい答えを得ます。一方、ワイルドカードによる復元は、どの段でも自分の推測を確認するオラクルの答えで終わるため、そこでは費用の方が確率的な量であり、答えはそうではありません。",
      // Two processes arrive: `marked-item-search` and `quantum-walk-search`.
      // That is what makes this one state rather than two, and it is the reason
      // the two slots were built in the same unit — a search region whose exit
      // nothing else reaches is a parameter of one process wearing a circle, and
      // this file's own header says so in as many words. (It said `states.ts`
      // until 2026-08-26; the rule has always been stated here, above the
      // vocabulary it governs, and `states.ts` never held it.)
    },
    {
      id: "search-graph-with-marked-set",
      label: "Search graph with a marked set",
      labelJa: "印付き集合をもつ探索グラフ",
      summary:
        "A graph over candidate states given by local rules rather than laid out — from any vertex you can name its neighbours — together with the rule that says which vertices are marked and the size bounds that fix how long a walk has to run. What makes this a different object from a domain plus an oracle is that moving costs less than starting again: the work already done at a vertex is still valid one step away, and a walk is worth running exactly when that is true.",
      summaryJa: "候補となる状態の上のグラフで、あらかじめ敷かれているのではなく局所的な規則によって与えられます。どの頂点からも、その隣接頂点を名指しできます。それに加えて、どの頂点が印付きであるかを述べる規則と、ウォークをどれだけ走らせる必要があるかを定めるサイズの上限とから成ります。これを定義域とオラクルの組とは異なる対象にしているのは、移動することが最初からやり直すことよりも安く済むという点です。ある頂点ですでに済ませた仕事は、一歩隣でもなお有効であり、ウォークを走らせる価値があるのは、まさにそれが成り立つときです。",
      // **Not `markov-chain-with-marked-set`**, which is what W26 §2 proposed and
      // what this note was written from. Two of the three things that name would
      // promise are absent from the papers the slot is built on.
      //
      // Ambainis (arXiv:quant-ph/0311001) never writes "Johnson graph", never
      // applies the language of Markov chains to his OWN walk, and has no
      // setup/update/check cost model: he accounts for it as "r queries for the
      // first step and 1 query to simulate each move", two terms and not three.
      // The setup/update/check triple is Szegedy's and Magniez–Nayak–Roland–
      // Santha's vocabulary, and W26 attributed it to Ambainis.
      //
      // The middle clause is narrow on purpose, and it was wider and wrong
      // first. "Markov chains" does occur in that paper — twice, in §1.1's
      // "Recent developments", saying that Szegedy "generalized our results on
      // quantum walk for element distinctness to an arbitrary graph with a large
      // eigenvalue gap and cast them into the language of Markov chains". That
      // is a description of somebody else's later paper, and it is evidence FOR
      // the distinction rather than against it: the chain vocabulary arrived
      // with the generalisation and was not how the construction was posed.
      // "Spectral gap" does not occur at all.
      //
      // Montanaro (arXiv:1509.02374) does not have a chain either, and says so
      // against exactly this reading: "in prior work it is usually assumed that
      // the input graph is known in advance, and moreover that the initial state
      // of the quantum walk is the stationary distribution of the corresponding
      // random walk". His tree is defined by a predicate and a branching
      // heuristic, is not known in advance, and the walk starts at the root
      // rather than at a stationary distribution. A state promising a stationary
      // distribution and a spectral gap would have made his method undrawable on
      // the slot it belongs to.
      //
      // So the state says what both papers actually hand the walk — local
      // neighbour rules, a marking rule, and size bounds — and a method that
      // needs a genuine reversible chain narrows the contract in its own
      // `contract` field, which is what that field is for.
    },
    {
      id: "cost-hamiltonian",
      label: "Cost Hamiltonian, diagonal in the computational basis",
      labelJa: "計算基底で対角なコストハミルトニアン",
      summary: "An Ising or QUBO operator, diagonal in the computational basis. Its extremal computational-basis eigenstates are the optimal assignments a combinatorial optimisation problem is asking for — one or more of them, because two assignments tying on the objective is ordinary rather than a special case — and a general vector in that eigenspace is a superposition of them and not an assignment at all, which is why what comes back is measured in the computational basis rather than read off the operator. Nothing in this build produces it: the encoding slot that would turn a combinatorial-problem statement into this operator was scoped and then refused, so this is where the region starts, not a state anything hands off.",
      summaryJa: "計算基底で対角な、Ising または QUBO 演算子です。その極値に対応する計算基底状態が、組合せ最適化問題の求めている最適な割り当てにあたります。二つの割り当てが目的関数の値で並ぶことは特別な場合ではなく普通に起こりますから、それは一つとは限りません。またその固有空間の一般のベクトルはそれらの重ね合わせであって、割り当てではありません。返ってくるものを演算子から読み取るのではなく計算基底で測定するのは、そのためです。この構築ではこれを生成するものは何もありません。組合せ問題の記述をこの演算子へと変換する符号化のスロットは検討されたのち退けられたため、この状態はこの領域の出発点であり、何かが手渡すものではありません。",
      // **A root, like `nonlinear-ivp` and `pde-problem`: no `specializes`.** The
      // encoding slot that would produce this state (`combinatorial-problem` →
      // `cost-hamiltonian`) was scoped in
      // `plans/atlas-revamp/W29-combinatorial-optimization-scoped.md` §2.1 and then
      // refused — a second reading of Pakhomchik et al. (arXiv:2205.04844), done
      // the same session, found its own distinct contribution is a *decomposition*
      // method (§III.C), not a competing encoding technique, so the slot has one
      // method (Lucas, arXiv:1302.5843) and fails the ≥2-methods rule. Until a
      // second encoding method is found and the slot is built, nothing in this
      // graph produces `cost-hamiltonian`, and it is filed as a root for that
      // reason rather than as an unnoticed gap.
      //
      // **Must NOT `specialize` `ground-state-problem`, and must NOT `specialize`
      // `eigenvalue-problem` either.** `eigenvalue-problem`'s own summary is "the
      // declaration that what is being asked for is a piece of its spectrum rather
      // than an evolution under it" — and a combinatorial optimisation asks for the
      // argmin assignment, not a piece of the spectrum. Declaring the
      // specialisation would let `stateSatisfies` hand a QAOA or
      // adiabatic-evolution instance to a ground-state-energy method and return an
      // *energy* where the reader asked *which assignment* — the same failure
      // `excited-state-problem`'s own comment records catching one region over
      // ("carries the opposite declaration... so calling it a specialisation would
      // let `stateSatisfies` hand one to a ground-state method and call the result
      // an answer") and the same failure `ground-state-problem`'s own comment
      // records catching a region before that ("a variational eigensolver returns a
      // lowest eigenvalue, not the solution of an initial-value problem at time
      // T"). A sibling under `hamiltonian-access` was the tempting shape here too,
      // and is refused for the identical reason.
    },
    {
      id: "assignment",
      label: "Assignment, with the objective value it achieves",
      labelJa: "割り当てと、それが達成する目的関数値",
      summary: "A bit string read off the computational basis — a value for every one of the problem's decision variables — together with the value of the objective at that string. One process arrives here; nothing in this graph consumes it yet.",
      summaryJa: "計算基底から読み取ったビット列であり、問題の決定変数のすべてに対する値を与えます。あわせて、その文字列における目的関数の値を伴います。ここには一つの過程が到達しますが、この図の中でそれを消費するものはまだありません。",
      // One process arrives here — both methods realising `combinatorial-optimization`
      // return this — and none leaves. Under the admission rule as
      // `state-vocabulary.ts`'s own header states it (never as the four files that
      // cited it wrongly restated it — corrected in leona PR 784), that is
      // admissible: the rule is a bar applied when a state is newly authored, not
      // an invariant the vocabulary holds, and the response to a state failing it
      // is to name the missing consumer, never to invent one. `hidden-period`
      // above is the same shape for the same reason.
      //
      // No `specializes` is declared. `solution-answer`'s own summary offers three
      // kinds — "a state you can measure, a history over the whole interval, or a
      // single number" — and an assignment fits none of the three cleanly: it is a
      // measured bit string paired with the scalar it achieves, which
      // `observable-value` (an *error-bar* estimate) does not fit either. Forcing
      // a parent here would be the same mistake `cost-hamiltonian`'s comment above
      // refuses for the opposite reason: asserting a taxonomic relation no source
      // states, rather than leaving it unclaimed.
    },
    // --- the machine underneath ---------------------------------------------
    {
      id: "physical-qubits",
      label: "Physical qubits",
      labelJa: "物理量子ビット",
      summary:
        "Real hardware: a physical error rate, a noise model, a connectivity constraint, and a measurement-and-feedback cycle time. Everything above is written as if this floor were not there; error correction is the layer that pays for the pretence.",
      summaryJa:
        "実際のハードウェア。物理誤り率、雑音モデル、結合の制約、測定とフィードバックの周期時間です。上位のすべては、この土台が無いかのように書かれています。誤り訂正は、その建前の代金を支払う層です。",
    },
    {
      id: "logical-qubits",
      label: "Logical qubits",
      labelJa: "論理量子ビット",
      summary:
        "Qubits good enough to run the circuit above, together with the code and code distance chosen for them, the physical-per-logical ratio that bought it, and the decoding latency the machine has to keep up with.",
      summaryJa:
        "上位の回路を走らせるに足る量子ビットと、そのために選ばれた符号および符号距離、それを買うのに要した物理／論理比、そして実機が追従しなければならない復号のレイテンシです。",
    },
  ],
};
