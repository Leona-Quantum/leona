// Zoo-parity intake: catalog records for algorithms the Quantum Algorithm Zoo
// carries and this repository did not.
//
// ## Why this file exists
//
// The north-star direction is "expand the repository and the map until they
// match, and then beyond" (plans/atlas-revamp/NORTH-STAR.md, stage C). The
// repository half of that had never been measured against an outside index. It
// is now: `node scripts/check-zoo-parity.mjs` diffs the Zoo's own entry list
// against this catalog and prints closed / partial / unreviewed / missing with
// the denominator, the same discipline `check-match-gauge.mjs` applies to the map
// half. The first reading, before this file, was 8 covered — **of 60, which was
// itself wrong**: the generator was dropping fourteen entries into their
// neighbours, and the Zoo has 74. Read the current figure off the gauge; every
// fraction written into this file has since needed correcting.
//
// Two of the twelve records below close a gap that had been visible from the
// other side for weeks: the map has drawn `linear-ode-solve` and
// `nonlinear-ode-solve` — a whole region, tens of methods — while the repository
// held no record for either, so a reader who arrived from the catalog could not
// reach the region at all. Those two anchor; the other ten are repository-only,
// because inventing a map slot to hold a record is the failure the map-eligibility
// rules exist to prevent (see ./map-eligibility.ts).
//
// ## What a record here claims, and what it does not
//
// These are **literature records**: `language: "text"`, nothing runnable, and the
// verification prose says so. What was actually checked, per record, is:
//
//   1. the problem statement and speedup class against the Zoo's own entry text,
//   2. the primary reference's title, author list and v1 year against the arXiv
//      abs page (the verifiable-complete route — the API 503s from here),
//   3. the complexity claim against a clause of that paper's abstract, quoted in
//      `complexityBasis`.
//
// A record whose sources state no bound carries `complexity: ""` and says which
// source was read in `complexityBasis`. Correct-empty is a state a field holds on
// purpose here, exactly as in the linear-ODE `cost` backlog; a plausible bound
// written from memory is the failure mode this convention exists to refuse.
//
// Adding a record: append a concept below, add its paper to ./paper-register.ts
// FIRST (the citation checkers refuse an unregistered paper), give its family a
// rule in ./topics.ts if it has no existing one, and regenerate
// services/api/catalog_bootstrap/manifest.json in the same PR.
import { makeReferenceEntry } from "./factory";
import type { PublicRepositoryEntry } from "./types";

type ZooAlgorithm = {
  slug: string;
  title: string;
  titleJa: string;
  /** Must resolve to a rule in ./topics.ts — an entry with no role fails the build. */
  family: string;
  /** The Quantum Algorithm Zoo entry this record covers, verbatim. */
  zooName: string;
  zooSection: string;
  /** The Zoo's own speedup class for that entry, verbatim. */
  speedup: string;
  /**
   * What this record's **own primary paper** says about that speedup class.
   *
   * ## Why the field exists
   *
   * The `speedup` above is a quotation from an outside index, and on at least one
   * record it is a quotation about a whole *section* rather than about the paper:
   * `gibbs-state-sampling` sits under "Preparing Eigenstates and Thermal States",
   * which the Zoo labels superpolynomial as a block. The owner was asked whether a
   * record may show a rating like that at all:
   *
   * > *"i will say try your best to find the claim from a primary source or a
   * > refutation of it. otherwise, keep track of which claims are from secondary
   * > sources like the zoo. this way i can get expert opinion and rederive it in
   * > some way without only relying on something like the zoo. we do ideally want
   * > to pose this repository as superior to zoo and classiq and braid and all
   * > others without outright claiming that, so less references to them the better
   * > since they must have gotten those things from somewhere!"*
   * > — owner, github.com/EshMis/ai-ops/issues/18, 2026-08-12
   *
   * So: not dropped, and not shown as ours either. Every speedup class carries a
   * statement of whether a primary source backs it, which is both the honesty the
   * reader needs and the worklist the owner asked for — "which claims are from
   * secondary sources" is now a number this repository can produce rather than a
   * thing somebody would have to re-read 32 records to find out.
   *
   * ## Three states, and `absent` is scoped by what was read
   *
   * - `reported` — the primary source states a comparable speedup. `quote` is its
   *   own words, not a paraphrase.
   * - `absent`   — the text named in `read` was read and states no speedup. A
   *   positive claim, and **deliberately narrower than "the paper does not"**:
   *   `read` says exactly what was looked at, because an abstract is not a paper
   *   and "we read the abstract" must not harden into "the authors never say it".
   * - `unknown`  — nobody has checked. The honest default and NOT the same thing.
   *
   * The same three-valued discipline as `SourceCoverage` in ./types.ts, and for the
   * same reason: collapsing the middle value into the last one loses the only fact
   * that distinguishes a finding from a gap.
   *
   * The intake as shipped checked the problem statement, the speedup class against
   * the Zoo, the reference metadata and the complexity claim. It did **not** ask
   * whether the primary paper supports the class, so `unknown` is accurate for the
   * records that carry it — it is a worklist, not a shrug.
   */
  speedupPrimary:
    | { states: "reported"; quote: string }
    | { states: "absent"; read: string }
    | { states: "unknown" };
  problem: string;
  problemJa: string;
  idea: string;
  ideaJa: string;
  /** Empty when the read sources state no bound — see `complexityBasis` for which were read. */
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

const ZOO_ALGORITHMS: ZooAlgorithm[] = [
  {
    slug: "discrete-logarithm",
    title: "Discrete logarithm on a quantum computer",
    titleJa: "量子計算による離散対数問題",
    family: "Hidden-period / factoring",
    zooName: "Discrete-log",
    zooSection: "Algebraic and Number Theoretic Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: { states: "unknown" },
    problem: "Given three n-bit numbers a, b and N with the promise that b = a^s mod N for some s, recover the exponent s.",
    problemJa: "n ビットの整数 a, b, N が与えられ、ある s について b = a^s mod N が成り立つと約束されているとき、その指数 s を求める問題です。",
    idea: "Shor's paper gives efficient randomized quantum algorithms for two problems believed hard classically, integer factoring and discrete logarithms, and both take a number of steps polynomial in the input size. The Zoo entry points the reader to the abelian hidden subgroup problem, and it states that by similar techniques quantum computers can solve the discrete logarithm problem on elliptic curves, thereby breaking elliptic-curve cryptography. Roetteler, Naehrig, Svore and Lauter make that elliptic-curve variant concrete by giving reversible circuits for modular addition, multiplication and inversion and for elliptic-curve point addition, then counting the qubits and Toffoli gates such a circuit needs.",
    ideaJa: "Shor の論文は、古典的には困難と考えられている素因数分解と離散対数の双方について、入力サイズの多項式ステップで動作する効率的な確率的量子アルゴリズムを与えています。Zoo はこの項目から可換隠れ部分群問題を参照しており、同様の技法によって量子計算機は楕円曲線上の離散対数問題も解くことができ、楕円曲線暗号を破ることになると述べています。Roetteler らは、剰余加算・乗算・逆元計算と楕円曲線の点加算に対する可逆回路を与え、必要な量子ビット数と Toffoli ゲート数を数え上げることで、この楕円曲線版を具体化しています。",
    complexity: "Polynomial in the input size: the Zoo states that s can be found in poly(n) time for n-bit inputs while the fastest known classical algorithm takes time superpolynomial in n, and neither source quotes an exponent or constant. For the elliptic-curve variant over an n-bit prime field, Roetteler et al. estimate at most 9n + 2⌈log₂(n)⌉ + 10 **logical** qubits and a circuit of at most 448 n³ log₂(n) + 4090 n³ Toffoli gates. Their abstract states that qubit figure without the qualifier; section 5 is where they call it logical, and the paper states no error-correction assumption at all, so it supports no physical-qubit reading.",
    complexityBasis: 'Zoo entry "Discrete-log": "this can be achieved on a quantum computer in poly( n ) time. The fastest known classical algorithm requires time superpolynomial in n"; abstract of arXiv:quant-ph/9508027: "These algorithms take a number of steps polynomial in the input size, e.g., the number of digits of the integer to be factored"; abstract of arXiv:1706.06752: "can be computed on a quantum computer with at most 9n + 2⌈log_2(n)⌉+10 qubits using a quantum circuit of at most 448 n^3 log_2(n) + 4090 n^3 Toffoli gates"; that abstract does not say whether those qubits are logical or physical, and section 5 of the same paper does: "the overall number of logical qubits for the controlled elliptic curve point addition in our simulation is 9n + 2⌈log_2(n)⌉ + 10", with section 1 calling the P-256 figure "2330 logical qubits". The words "physical qubit", "error correction" and "noiseless" appear nowhere in it.',
    caveat: "This is a literature record. No circuit was built, compiled or executed here, and no instance of a, b, N was solved. The poly(n) claim is asymptotic: neither the Zoo nor Shor's abstract states an exponent, a constant factor, or a modular-arithmetic gate count for the mod-N group, so nothing here bounds the cost of a specific key size. The classical side is stated as the fastest algorithm currently known, not a proven lower bound, so the superpolynomial separation is conditional on that state of the art. The Roetteler et al. counts are qubit and Toffoli-gate estimates for the elliptic-curve problem over prime fields, not for the mod-N statement above, and the abstract quoted here reports neither an error-correction cost nor a running time on hardware. The further optimizations to Shor's algorithm and the semigroup extension that the Zoo cites rest on papers outside this record.",
    caveatJa: "本項目は文献に基づく記録です。ここで回路を構成・コンパイル・実行したことはなく、具体的な a, b, N の実例を解いたわけでもありません。poly(n) は漸近的な主張であり、Zoo も Shor の要旨も指数・定数因子・mod N における剰余演算のゲート数を示していないため、特定の鍵長に対するコストはここからは分かりません。古典側は「現在知られている最速のアルゴリズム」に関する記述であって証明された下界ではなく、超多項式的な差はその前提に依存します。Roetteler らの数値は素体上の楕円曲線問題に対する量子ビット数と Toffoli ゲート数の見積りであり、上記の mod N の定式化に対するものではなく、ここで引用した要旨は誤り訂正のコストも実機での所要時間も報告していません。Zoo が挙げる追加の最適化や半群への拡張は、本記録の対象外の論文に基づきます。",
    tags: ["discrete logarithm", "shor", "hidden subgroup", "elliptic curves", "cryptanalysis"],
    source: {
      id: "arxiv:quant-ph/9508027",
      title: "Polynomial-Time Algorithms for Prime Factorization and Discrete Logarithms on a Quantum Computer",
      authors: "Peter W. Shor",
      year: "1995",
      url: "https://arxiv.org/abs/quant-ph/9508027",
    },
    literature: [
      {
        title: "Quantum resource estimates for computing elliptic curve discrete logarithms",
        authors: "Martin Roetteler, Michael Naehrig, Krysta M. Svore, Kristin Lauter",
        year: "2017",
        url: "https://arxiv.org/abs/1706.06752",
        relevance: "Resource-estimate companion for the elliptic-curve case. The authors give circuit implementations for reversible modular arithmetic and elliptic-curve point addition, and report qubit and Toffoli-gate counts for an n-bit prime field. The paper states that these estimates are derived from a simulation of a Toffoli gate network for controlled elliptic curve point addition, implemented within the software tool suite LIQUi|⟩, and that the authors were able to simulate those networks classically for the NIST standard curves P-192, P-224, P-256, P-384 and P-521. It also reports that the results indicate a lower qubit requirement for tackling elliptic curves than for attacking RSA, for current parameters at comparable classical security levels, which the authors suggest makes ECC the easier target.",
        relevanceJa: "楕円曲線版の資源見積りを与える論文です。可逆な剰余演算と楕円曲線の点加算の回路構成を示し、n ビット素体に対する量子ビット数と Toffoli ゲート数を報告しています。この見積りは、制御付き楕円曲線点加算に対応する Toffoli ゲートネットワークをソフトウェアツール群 LIQUi|⟩ の枠組みで実装したシミュレーションから導かれたものであり、NIST 標準曲線 P-192, P-224, P-256, P-384, P-521 についてはこのネットワークを古典的にシミュレートできたと述べています。また、現在のパラメータのもとで同等の古典的安全性水準を比べると、楕円曲線に必要な量子ビット数は RSA を攻撃する場合より少ないことを結果が示していると報告し、ECC のほうが攻撃しやすい標的であることを示唆しています。",
      },
    ],
    relatedSlugs: ["shor-period-finding", "quantum-fourier-transform", "quantum-phase-estimation", "qft-resource-screen"],
  },
  {
    slug: "nand-tree-evaluation",
    title: "NAND tree evaluation with discrete queries",
    titleJa: "離散クエリによるNAND木の評価",
    family: "Quantum query algorithm",
    zooName: "Formula Evaluation",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem: "Determine the value at the root of a read-once Boolean formula, canonically a NAND tree on N variables, given only oracle access to the variables and using as few queries as possible.",
    problemJa: "各変数が一度しか現れないブール式、すなわちファンアウトを持たない木構造の回路について、変数へのオラクルアクセスだけを用いて、できるだけ少ないクエリ数で根の値を決定する問題です。代表例は N 変数のNAND木です。",
    idea: "Farhi, Goldstone and Gutmann gave a quantum algorithm for evaluating NAND trees with a continuous-time quantum walk, running in time O(√(N log N)) in the Hamiltonian query model, which is not the model in which a discrete circuit calls an oracle. Childs, Cleve, Jordan and Yonge-Mallo point out that their algorithm can be converted into one that works in the conventional quantum query model, at the price of an arbitrarily small polynomial overhead: O(N^(1/2 + ε)) queries for any fixed ε > 0. The Zoo places NAND-tree evaluation inside a longer line of work on formula evaluation, in which Reichardt's span-program formalism finally settled the quantum query complexity of any formula of O(1) fanin on N variables at Θ(√N), and in which Grover's algorithm can be regarded as the special case where every gate is OR.",
    ideaJa: "Farhi、Goldstone、Gutmann は、連続時間量子ウォークによってNAND木を評価する量子アルゴリズムを与えました。これはHamiltonianクエリモデルで O(√(N log N)) 時間で動作しますが、このモデルは、離散的な回路がオラクルを呼び出す通常のモデルとは異なります。Childs、Cleve、Jordan、Yonge-Mallo は、このアルゴリズムを通常の量子クエリモデルで動くものへ変換できることを指摘しました。オーバーヘッドは任意に小さい多項式で、固定した任意の ε > 0 に対し O(N^(1/2 + ε)) クエリとなります。Zoo はNAND木の評価を式評価に関する一連の研究の中に位置づけています。そこでは Reichardt のspanプログラム形式により、ファンインが O(1) の任意の式に対する量子クエリ計算量が Θ(√N) と確定し、Grover のアルゴリズムはすべてのゲートがORである特別な場合とみなせます。",
    complexity: "O(N^(1/2 + ε)) queries in the conventional quantum query model for any fixed ε > 0, converted from a continuous-time algorithm running in time O(√(N log N)) in the Hamiltonian query model; the Zoo states the walk's cost separately, in exponential form, as NAND trees on 2^n variables evaluable in time O(2^(0.5n)), against Ω(2^(0.753n)) queries required classically.",
    complexityBasis: "abstract of arXiv:quant-ph/0702160: \"their algorithm can be converted into an algorithm using O(N^{1/2 + epsilon}) queries in the conventional quantum query model, for any fixed epsilon > 0\", and, for the model it starts from, \"a quantum algorithm for evaluating NAND trees that runs in time O(sqrt(N log N)) in the Hamiltonian query model\". The exponential form is from the Quantum Algorithm Zoo entry \"Formula Evaluation\": \"NAND trees on 2^n variables can be evaluated on quantum computers in time O(2^{0.5n}) using a continuous-time quantum walk, whereas classical computers require Ω(2^{0.753n}) queries.\"",
    caveat: "This is a literature record: no circuit was built, compiled, simulated, or run, and no NAND-tree instance was evaluated. The figures are query counts in an oracle model, so gate counts, constant factors, and the cost of realizing the leaf oracle on hardware are not addressed, and the paper is explicit that its own contribution is the model conversion, not the O(√(N log N)) Hamiltonian-model algorithm, which is Farhi, Goldstone and Gutmann's. The ε in O(N^(1/2 + ε)) is an overhead that can be made small but does not vanish, so this bound approaches without meeting the Θ(√N) quantum query complexity that the Zoo attributes to Reichardt's span-program formalism. The bound also assumes the read-once formula structure; the Zoo notes separately that allowing repeated input variables changes the query count.",
    caveatJa: "本項目は文献に基づく記録であり、回路の構成、コンパイル、シミュレーション、実行は行っておらず、具体的なNAND木の評価も行っていません。示されている値はオラクルモデルでのクエリ数であり、ゲート数、定数因子、葉のオラクルを実機で実現するコストは対象外です。また論文自身が述べるとおり、その寄与はモデル間の変換であって、O(√(N log N)) というHamiltonianクエリモデルのアルゴリズムは Farhi、Goldstone、Gutmann によるものです。O(N^(1/2 + ε)) の ε はいくらでも小さくできますが消えるわけではなく、Zoo が Reichardt のspanプログラム形式に帰する量子クエリ計算量 Θ(√N) には到達していません。さらにこの評価は、各変数が一度しか現れないという式の構造を前提としており、Zoo は入力変数の重複を許すとクエリ数が変わることを別途述べています。",
    tags: ["nand tree", "formula evaluation", "quantum walk", "query complexity", "oracle"],
    source: {
      id: "arxiv:quant-ph/0702160",
      title: "Discrete-query quantum algorithm for NAND trees",
      authors: "Andrew M. Childs, Richard Cleve, Stephen P. Jordan, David Yonge-Mallo",
      year: "2007",
      url: "https://arxiv.org/abs/quant-ph/0702160",
    },
    literature: [
      {
        title: "Discrete-query quantum algorithm for NAND trees",
        authors: "Andrew M. Childs, Richard Cleve, Stephen P. Jordan, David Yonge-Mallo",
        year: "2007",
        url: "https://arxiv.org/abs/quant-ph/0702160",
        relevance: "Primary source for the discrete-query bound: it points out that the continuous-time NAND-tree algorithm can be converted from the Hamiltonian query model into the conventional quantum query model at O(N^(1/2 + ε)) queries for any fixed ε > 0. Consult it for what the conversion assumes and for how the overhead depends on ε.",
        relevanceJa: "離散クエリ版の評価の一次資料です。連続時間のNAND木アルゴリズムをHamiltonianクエリモデルから通常の量子クエリモデルへ変換できることを指摘し、固定した任意の ε > 0 に対し O(N^(1/2 + ε)) クエリとなることを述べています。変換が前提とする条件や、オーバーヘッドの ε 依存性は原論文で確認してください。",
      },
    ],
    relatedSlugs: ["quantum-walk-line", "grover-unstructured-search", "amplitude-amplification"],
  },
  {
    slug: "hidden-shift-problem",
    title: "Hidden shift problem",
    titleJa: "隠れシフト問題",
    family: "Quantum query algorithm",
    zooName: "Hidden Shift",
    zooSection: "Oracular Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: { states: "unknown" },
    problem: "Given oracle access to a function f on the integers mod N together with the promise that f(x) = g(x+s) for a known function g and an unknown shift s, recover s.",
    problemJa: "既知の関数 g に対して f(x) = g(x+s) が成り立つという約束のもとで、N を法とする整数上の関数 f へのオラクルアクセスから未知のシフト s を求める問題です。",
    idea: "Nearly all of the successful quantum algorithms use the Fourier transform to recover subgroup structure, above all periodicity; van Dam, Hallgren and Ip point out that the same transform also captures shift structure, which had received far less attention. They give three unknown-shift problems that can be solved efficiently on a quantum computer using the quantum Fourier transform, and they define the hidden coset problem, one framework that contains both the hidden shift problem and the hidden subgroup problem. The Quantum Algorithm Zoo records that their construction covers the case where f is a multiplicative character of a finite ring or field, and that the previously discovered shifted Legendre symbol algorithm is subsumed as a special case, because the Legendre symbol is a multiplicative character of Fₚ.",
    ideaJa: "これまでに成功した量子アルゴリズムの多くは、Fourier変換によって関数の部分群構造、とりわけ周期性を取り出してきました。van Dam、Hallgren、Ip は、同じ変換がシフト構造も捉えられる点に着目しています。この点は、これまで注目される度合いがはるかに低いままでした。論文では、量子Fourier変換によって量子計算機上で効率的に解ける「未知のシフト」問題を3つ挙げ、さらに隠れシフト問題と隠れ部分群問題の双方を含む枠組みとして隠れコセット問題を定義しています。Zoo の記述によれば、この構成は f が有限環または有限体の乗法指標である場合を扱い、Legendre記号が Fₚ の乗法指標であることから、先行するシフトLegendre記号アルゴリズムは特別な場合として含まれます。",
    complexity: "O(1) quantum queries for the special case in which f is a multiplicative character of a finite ring or field; for hidden shift in general, at least √N queries are necessary, by reduction from Grover's problem.",
    complexityBasis: "Quantum Algorithm Zoo entry \"Hidden Shift\": \"certain special cases of the hidden shift problem are solvable on quantum computers using O(1) queries. In particular, van Dam et al. showed that this can be done if f is a multiplicative character of a finite ring or field\", and \"By reduction from Grover's problem it is clear that at least √N queries are necessary to solve hidden shift in general.\" The abstract of arXiv:quant-ph/0211140 states no query count or running time of its own; it says only that three unknown-shift problems \"can be solved efficiently on a quantum computer using the quantum Fourier transform\".",
    caveat: "Nothing here was executed: no circuit was written, compiled, simulated, or benchmarked, and no instance was solved. The O(1) figure is a query count in an oracle model for one special class of f, not a gate count and not a statement about general hidden shift. Query cost and circuit cost come apart badly in this family: the Zoo notes that for an injective function on the integers mod N the quantum query complexity is O(log n) while the best known quantum circuit complexity is O(2^(C √log N)), from Kuperberg's sieve. The classical side is an absence rather than a proof, since the Zoo says only that no classical algorithm running in time O(polylog(N)) is known for these problems. The cost of building the oracle for a concrete g, and any hardware feasibility question, are outside this record.",
    caveatJa: "本項目は文献に基づく記録であり、回路の記述、コンパイル、シミュレーション、ベンチマークは一切行っておらず、具体的な問題例も解いていません。O(1) はオラクルモデルにおける特定の関数クラスに対するクエリ数であり、ゲート数でも、一般の隠れシフト問題についての主張でもありません。この問題族では、クエリ数と量子回路計算量が大きく乖離します。Zoo によれば、N を法とする整数上の単射関数の場合、量子クエリ計算量は O(log n) である一方、知られている中で最良の量子回路計算量は Kuperberg のふるいによる O(2^(C √log N)) です。古典側についても、O(polylog(N)) 時間のアルゴリズムが「知られていない」と述べられているだけで、下界が証明されているわけではありません。具体的な g に対するオラクルの実装コストや実機での実行可能性も、本項目の対象外です。",
    tags: ["hidden shift", "oracle", "fourier transform", "hidden coset", "query complexity"],
    source: {
      id: "arxiv:quant-ph/0211140",
      title: "Quantum Algorithms for some Hidden Shift Problems",
      authors: "Wim van Dam, Sean Hallgren, Lawrence Ip",
      year: "2002",
      url: "https://arxiv.org/abs/quant-ph/0211140",
    },
    literature: [
      {
        title: "Quantum Algorithms for some Hidden Shift Problems",
        authors: "Wim van Dam, Sean Hallgren, Lawrence Ip",
        year: "2002",
        url: "https://arxiv.org/abs/quant-ph/0211140",
        relevance: "Primary source: it presents three unknown-shift problems that can be solved efficiently by the quantum Fourier transform and defines the hidden coset problem, which generalizes both the hidden shift problem and the hidden subgroup problem. Consult it for the promise conditions on f and g, since the abstract states no query bound.",
        relevanceJa: "一次資料です。量子Fourier変換で効率的に解ける未知シフト問題を3つ示し、隠れシフト問題と隠れ部分群問題を一般化する隠れコセット問題を定義しています。要旨にはクエリ数の記載がないため、f と g に課される約束条件は原論文で確認してください。",
      },
    ],
    relatedSlugs: ["quantum-fourier-transform", "shor-period-finding", "grover-unstructured-search"],
  },
  {
    slug: "ordered-search",
    title: "Ordered search",
    titleJa: "順序付き探索",
    family: "Quantum query algorithm",
    zooName: "Ordered Search",
    zooSection: "Oracular Algorithms",
    speedup: "Constant factor",
    speedupPrimary: { states: "unknown" },
    problem: "Given oracle access to a list of N numbers held in order from least to greatest, together with a number x, determine where in the list x would fit.",
    problemJa: "小さい順に並んだN個の数のリストへのオラクルアクセスが与えられ、さらに数xが与えられたとき、xがリストのどの位置に入るかを求める問題です。",
    idea: "The paper characterizes a class of quantum query algorithms for ordered search as a semidefinite program, and solving that program yields new algorithms for small instances of the problem. Those small-instance algorithms are then extended to arbitrarily large N by recursion, which produces an exact quantum ordered search algorithm improving on the previously best known exact algorithm. Because classical binary search already costs log₂ N queries, the quantum gain here is a constant factor on that logarithm rather than a change of order.",
    ideaJa: "この論文は、順序付き探索に対する量子クエリアルゴリズムのクラスを半正定値計画として特徴付け、その計画を解くことで小さなインスタンス向けの新しいアルゴリズムを得ます。得られたアルゴリズムを再帰によって任意の大きさのNへ拡張すると、従来の最良の厳密アルゴリズムを改善する厳密な量子順序付き探索アルゴリズムが得られます。古典の二分探索がすでにlog₂ Nクエリで済むため、量子側の利得はこの対数に掛かる定数倍であり、オーダーの改善ではありません。",
    complexity: "4 log₆₀₅ N ≈ 0.433 log₂ N oracle queries for the exact quantum algorithm, against log₂ N queries for classical binary search; a lower bound of (ln 2)/π · log₂ N quantum queries is known for the problem.",
    complexityBasis: 'abstract of arXiv:quant-ph/0608161: "we show that there is an exact quantum ordered search algorithm using 4 log_{605} N ≈ 0.433 log_2 N queries, which improves upon the previously best known exact algorithm". The classical baseline ("the best possible algorithm is binary search which takes log₂ N queries") and the (ln 2)/π · log₂ N lower bound ("A lower bound of ... quantum queries has been proven for this problem") are from the Quantum Algorithm Zoo entry "Ordered Search"; in the quotations from both sources, LaTeX has been rendered into Unicode where shown, including the abstract\'s approximation sign as ≈.',
    caveat: "This is a query-complexity record in the oracle model, not an executed result: nothing here was compiled, simulated, or run. The count is of queries to the ordered list only, and says nothing about gate counts, ancilla requirements, or the cost of implementing the comparison oracle on hardware; constant factors and small-N behaviour of the recursion are also outside it. The 0.433 log₂ N figure is for the exact (deterministic) setting, while the Zoo separately reports a randomized quantum algorithm whose expected query complexity is below (1/3) log₂ N, and the abstract states that the precise value of the constant factor by which a quantum computer improves on the classical query count is unknown.",
    caveatJa: "本項目はオラクルモデルにおけるクエリ計算量の記録であり、実行結果ではありません。コンパイル、シミュレーション、実機実行はいずれも行っていません。数えているのは順序付きリストへのクエリ回数のみで、ゲート数、補助量子ビット、比較オラクルの実装コストは含まれず、定数因子や再帰の小さなNでの挙動も対象外です。0.433 log₂ Nは厳密（決定的）な設定の値であり、Zooは期待クエリ数が(1/3) log₂ N未満の乱択量子アルゴリズムを別に挙げています。論文の要旨は、量子計算機が古典より少ないクエリ数で解けるときの定数因子について、その正確な値は未知であると述べています。",
    tags: ["oracular", "query complexity", "sorted list", "semidefinite programming"],
    source: {
      id: "arxiv:quant-ph/0608161",
      title: "Improved quantum algorithms for the ordered search problem via semidefinite programming",
      authors: "Andrew M. Childs, Andrew J. Landahl, Pablo A. Parrilo",
      year: "2006",
      url: "https://arxiv.org/abs/quant-ph/0608161",
    },
    literature: [
      {
        title: "Improved quantum algorithms for the ordered search problem via semidefinite programming",
        authors: "Andrew M. Childs, Andrew J. Landahl, Pablo A. Parrilo",
        year: "2006",
        url: "https://arxiv.org/abs/quant-ph/0608161",
        relevance: "Primary paper: it recasts ordered-search quantum query algorithms as a semidefinite program, solves small instances, and lifts them by recursion to the exact 4 log₆₀₅ N ≈ 0.433 log₂ N query algorithm quoted in the complexity field.",
        relevanceJa: "一次文献です。順序付き探索の量子クエリアルゴリズムを半正定値計画として定式化し、小さなインスタンスを解いたうえで再帰により拡張し、計算量欄に引いた4 log₆₀₅ N ≈ 0.433 log₂ Nクエリの厳密アルゴリズムを与えています。",
      },
    ],
    relatedSlugs: ["grover-unstructured-search", "amplitude-amplification", "quantum-counting"],
  },
  {
    slug: "welded-tree-traversal",
    title: "Welded tree traversal by continuous-time quantum walk",
    titleJa: "連続時間量子ウォークによる溶接木グラフの探索",
    family: "Quantum walk",
    zooName: "Welded Tree",
    zooSection: "Oracular Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given oracle access to a graph built by joining two depth-n binary trees with a random weld, so that every node except the two roots has degree three, start from the label of one root and find the label of the other root.",
    problemJa:
      "深さnの二分木2本をランダムな溶接で接続し、2つの根以外のすべてのノードの次数が3となるグラフへのオラクルアクセスが与えられたとき、一方の根のラベルから出発してもう一方の根のラベルを見つける問題です。",
    idea:
      "The oracle, queried with a node label, returns the labels of that node's neighbours. Childs, Cleve, Deotto, Farhi, Gutmann and Spielman base their algorithm on a continuous-time quantum walk on this graph, a different technique from earlier quantum algorithms based on quantum Fourier transforms, and show how to implement that walk efficiently in the oracular setting. The walk traverses the graph rapidly enough to reach the far root, and the same paper proves that no classical algorithm solves the problem with high probability in subexponential time.",
    ideaJa:
      "オラクルにノードのラベルを問い合わせると、隣接ノードのラベルの一覧が返されます。Childsらは、量子フーリエ変換に基づく従来の量子アルゴリズムとは異なる手法として、このグラフ上の連続時間量子ウォークに基づくアルゴリズムを構成し、オラクル設定においてそのウォークを効率的に実装する方法を示しています。ウォークはグラフ上を高速に伝播してもう一方の根に到達し、同じ論文は、いかなる古典アルゴリズムも、この問題を劣指数時間で高い確率で解くことはできないことを証明しています。",
    complexity:
      "poly(n) oracle queries for a pair of depth-n trees, against a proved classical lower bound: no classical algorithm solves the problem with high probability in subexponential time.",
    complexityBasis:
      'Quantum Algorithm Zoo entry "Welded Tree": "a quantum computer can find the other root using poly( n ) queries, whereas this is provably impossible using classical queries"; abstract of arXiv:quant-ph/0209131: "we prove that no classical algorithm can solve this problem with high probability in subexponential time". Neither source states an exponent inside poly(n) or any constant factor.',
    caveat:
      "This is a query-complexity statement about an oracle that returns neighbour labels; neither source gives the gate cost of realising that oracle for a concrete graph, so the separation is about queries rather than end-to-end runtime. The separation is proved for this welded-tree family, not for graph traversal in general. Nothing here was compiled, simulated or run, and with no exponent or constant behind poly(n) the record supports no statement about instance sizes, qubit counts or hardware feasibility.",
    caveatJa:
      "これは隣接ラベルを返すオラクルに対するクエリ計算量の主張であり、具体的なグラフでそのオラクルを実装するゲートコストはいずれの資料にも示されていないため、全体の実行時間ではなくクエリ数についての分離です。分離が示されているのは溶接木という特定のグラフ族であって、一般のグラフ探索ではありません。回路の作成、シミュレーション、実行は行っておらず、poly(n)の指数や定数因子も示されていないため、扱える問題規模、量子ビット数、ハードウェア上の実現可能性についてはこの項目からは何も言えません。",
    tags: ["quantum walk", "oracle", "graph traversal", "query complexity", "separation"],
    source: {
      id: "arxiv:quant-ph/0209131",
      title: "Exponential algorithmic speedup by quantum walk",
      authors:
        "Andrew M. Childs, Richard Cleve, Enrico Deotto, Edward Farhi, Sam Gutmann, Daniel A. Spielman",
      year: "2002",
      url: "https://arxiv.org/abs/quant-ph/0209131",
    },
    literature: [
      {
        title: "Exponential algorithmic speedup by quantum walk",
        authors:
          "Andrew M. Childs, Richard Cleve, Enrico Deotto, Edward Farhi, Sam Gutmann, Daniel A. Spielman",
        year: "2002",
        url: "https://arxiv.org/abs/quant-ph/0209131",
        relevance:
          "Primary source: constructs the welded-tree oracle problem, gives the continuous-time quantum walk that traverses it, shows how to implement the walk in the oracular setting, and proves the classical subexponential-time lower bound.",
        relevanceJa:
          "一次資料です。溶接木のオラクル問題を構成し、そのグラフ上を伝播する連続時間量子ウォークとそのオラクル設定での実装法を与え、古典側の劣指数時間下界を証明しています。",
      },
    ],
    relatedSlugs: ["quantum-walk-line", "grover-unstructured-search", "hamiltonian-simulation-ising"],
  },
  {
    slug: "element-distinctness",
    title: "Element distinctness by quantum walk",
    titleJa: "量子ウォークによる要素相異性問題",
    family: "Quantum walk",
    zooName: "Collision Finding and Element Distinctness",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem: "Given oracle access to N items carrying no promise about the underlying function, find two items that are equal, or establish that all N are distinct.",
    problemJa: "写像の構造に関する約束が一切ない N 個の要素へオラクル経由でアクセスできるとき、値の等しい 2 要素を見つける、あるいは N 個すべてが相異なることを確かめる問題です。",
    idea: "Ambainis builds the algorithm out of a quantum walk instead of a direct search, which is what improves on the earlier O(N^(3/4))-query quantum algorithm the abstract credits to Buhrman et al. and matches the query lower bound of Shi. The same construction also solves the generalization in which k equal items must be found among N. The easier promised version is older: when f is r-to-one, Brassard, Hoyer and Tapp give an algorithm that finds a collision by using Grover's search in a novel way, and their technique also yields a claw-finding algorithm for a pair of functions and a space-time tradeoff. The Zoo groups the two under one entry because dropping the two-to-one promise is exactly what turns collision finding into element distinctness.",
    ideaJa: "Ambainis は直接的な探索ではなく量子ウォークを用いてアルゴリズムを構成しており、これにより、要旨が Buhrman らによるものとしている O(N^(3/4)) クエリの量子アルゴリズムを改良し、Shi が示したクエリ下界と一致します。同じ構成は、N 個の中から k 個の等しい要素を見つける一般化も解きます。約束付きのより易しい版はこれより古く、f が r 対 1 の場合に Brassard, Hoyer, Tapp は Grover 探索を新しい形で用いて衝突を発見するアルゴリズムを与えており、同じ技法から 2 つの写像に対する claw 探索と時空間のトレードオフも得られます。2 対 1 の約束を外すことが衝突発見を要素相異性問題に変えるため、Zoo は両者を 1 つの項目にまとめています。",
    complexity: "O(N^(2/3)) queries for element distinctness on N items, matching the lower bound of Shi and improving the previous O(N^(3/4))-query quantum algorithm; the same algorithm uses O(N^(k/(k+1))) queries to find k equal items among N. The Zoo gives Θ(N) classical query complexity for element distinctness, and for the two-to-one collision problem O(N^(1/3)) quantum queries against Θ(√N) classical randomized queries, with Brassard, Hoyer and Tapp stating O((N/r)^(1/3)) expected function evaluations for r-to-one functions.",
    complexityBasis: 'abstract of arXiv:quant-ph/0311001: "For element distinctness (the problem of finding two equal items among N given items), we get an O(N^{2/3}) query quantum algorithm. This improves the previous O(N^{3/4}) query quantum algorithm of Buhrman [link mangled to \'this http URL\' on the abs page] (quant-ph/0007016) and matches the lower bound by Shi (quant-ph/0112086)", and "For this problem, we get an O(N^{k/(k+1)}) query quantum algorithm"; Zoo entry "Collision Finding and Element Distinctness": element distinctness "has Θ(N) classical query complexity", and for the collision problem "The classical randomized query complexity of this problem is Θ(√N), whereas ... a quantum computer can achieve this using O(N^{1/3}) queries"; abstract of arXiv:quant-ph/9705002: "finds collisions in arbitrary r-to-one functions after only O((N/r)^(1/3)) expected evaluations of the function".',
    caveat: "This is a literature record. No oracle was instantiated, no circuit compiled, and no walk simulated or run. Every figure above is a query count in the black-box model, so none of it bounds gate count, circuit depth, the cost of holding and addressing the data the walk moves over, or the constant factors hidden by O(·); the collision paper asserts a space-time tradeoff exists without this record fixing the space. Optimality is reported: the Zoo calls the O(N^(2/3)) bound optimal and the Ambainis abstract attributes the matching lower bound to Shi, neither of which is re-derived here. The remaining results in the same Zoo entry, the k-distinctness bounds, time-complexity claims, many-collision and claw-finding work for N ≠ M, frequency-moment estimation and the graph collision problem, rest on papers outside this record.",
    caveatJa: "本項目は文献に基づく記録です。オラクルを具体化したことも、回路をコンパイルしたことも、ウォークをシミュレートしたり実行したりしたこともありません。上記の数値はいずれもブラックボックスモデルでのクエリ数であり、ゲート数、回路深さ、ウォークが渡り歩くデータの保持と参照にかかるコスト、O(·) に隠れた定数因子のいずれについても上界を与えるものではありません。衝突発見の論文は時空間トレードオフの存在を述べていますが、本記録で空間量を特定してはいません。最適性については文献の記述を引用したものであり、Zoo は O(N^(2/3)) を最適と記し、Ambainis の要旨は一致する下界を Shi の結果としています。いずれも本記録で導出し直したものではありません。同じ Zoo 項目に含まれる k-distinctness の評価、時間計算量の主張、多重衝突や N ≠ M の場合の claw 探索、頻度モーメント推定、グラフ衝突問題は、本記録の対象外の論文に基づきます。",
    tags: ["element distinctness", "quantum walk", "collision finding", "query complexity", "oracle"],
    source: {
      id: "arxiv:quant-ph/0311001",
      title: "Quantum walk algorithm for element distinctness",
      authors: "Andris Ambainis",
      year: "2003",
      url: "https://arxiv.org/abs/quant-ph/0311001",
    },
    literature: [
      {
        title: "Quantum Algorithm for the Collision Problem",
        authors: "Gilles Brassard, Peter Hoyer, Alain Tapp",
        year: "1997",
        url: "https://arxiv.org/abs/quant-ph/9705002",
        relevance: "The promised half of the same Zoo entry. For arbitrary r-to-one functions given as a black box the authors find collisions in O((N/r)^(1/3)) expected evaluations, more efficient than any classical algorithm even with randomization, and they extend the technique to claw finding in pairs of functions and exhibit a space-time tradeoff.",
        relevanceJa: "同じ Zoo 項目のうち、約束が付いた側を担う論文です。ブラックボックスとして与えられた任意の r 対 1 写像に対し、期待評価回数 O((N/r)^(1/3)) で衝突を発見し、確率的手法を許したいかなる古典アルゴリズムよりも効率的だと述べています。さらに同じ技法を 2 つの写像に対する claw 探索へ拡張し、時空間のトレードオフも示しています。",
      },
    ],
    relatedSlugs: ["quantum-walk-line", "grover-unstructured-search", "amplitude-amplification"],
  },
  {
    slug: "gibbs-state-sampling",
    title: "Thermal Gibbs state sampling",
    titleJa: "熱的 Gibbs 状態のサンプリング",
    family: "Quantum sampling algorithm",
    zooName: "Preparing Eigenstates and Thermal States",
    zooSection: "Approximation and Simulation Algorithms",
    speedup: "Superpolynomial",
    // The record that prompted the owner's ruling, and the one the ruling was
    // acted on. Poulin and Wocjan's abstract was read in full: it states the
    // preparation, the universal D^α thermalisation-time bound with α < 1/2, and
    // the partition-function algorithm's dependence on that time and on the
    // squared accuracy — and it makes no comparison to a classical algorithm at
    // all. No "superpolynomial", no "exponential speedup", no classical runtime.
    // The class is the section heading's, and the paper does not carry it.
    speedupPrimary: { states: "absent", read: "abstract of arXiv:0905.2199" },
    problem: "Prepare the thermal Gibbs state of an interacting quantum system on a quantum computer, and use that preparation to evaluate the system's partition function to a target accuracy.",
    problemJa: "相互作用する量子系の熱的 Gibbs 状態を量子計算機上で準備し、その準備を用いて分配関数を目標精度で評価する問題です。",
    idea: "Poulin and Wocjan's algorithm prepares the thermal Gibbs state of an interacting quantum system directly on the quantum register. The paper states that the algorithm sets a universal upper bound D^α on the thermalization time of a quantum system, with D the Hilbert space dimension and the exponent α < 1/2 proportional to the Helmholtz free energy density. A second algorithm derived from the same preparation evaluates the partition function, its running time proportional to the system's thermalization time and inversely proportional to the targeted accuracy squared. In the Zoo this sits among methods for approximating ground states, low energy states, and thermal states for some classes of Hamiltonians; the Zoo notes that simulating Hamiltonian time evolution, as well as some problems of preparing ground and thermal states, can all be done as special cases of the quantum singular value transformation.",
    ideaJa: "Poulin と Wocjan のアルゴリズムは、相互作用する量子系の熱的 Gibbs 状態を量子レジスタ上で直接準備します。論文によれば、このアルゴリズムは量子系の熱化時間に対する普遍的な上界 D^α を与えます。ここで D は Hilbert 空間の次元、指数 α < 1/2 は Helmholtz 自由エネルギー密度に比例します。同じ準備から導かれるもう一つのアルゴリズムは分配関数を評価し、その実行時間は系の熱化時間に比例し、目標精度の二乗に反比例します。Zoo ではこの手法を、あるクラスの Hamiltonian に対する基底状態、低エネルギー状態、熱状態の近似手法群の中に位置づけており、Hamiltonian の時間発展のシミュレーション、および基底状態と熱状態を準備するいくつかの問題は、量子特異値変換の特別な場合として実行できると述べています。",
    complexity: "The preparation sets a universal upper bound D^α on the thermalization time, where D is the Hilbert space dimension and α < 1/2 is proportional to the Helmholtz free energy density; the derived partition-function algorithm runs in time proportional to that thermalization time and inversely proportional to the targeted accuracy squared.",
    complexityBasis: "abstract of arXiv:0905.2199 (plain-text Greek names rendered as Unicode): \"This algorithm sets a universal upper bound D^α on the thermalization time of a quantum system, where D is the system's Hilbert space dimension and α < 1/2 is proportional to the Helmholtz free energy density of the system\", and \"an algorithm to evaluate the partition function of a quantum system in a time proportional to the system's thermalization time and inversely proportional to the targeted accuracy squared\". The Zoo entry for this section states no bound of its own; its \"Superpolynomial\" label is the Zoo's classification, not a measured comparison, and is recorded in the speedup field rather than here.",
    caveat: "Nothing here was constructed, compiled, simulated, or benchmarked; this is a literature record. D^α is stated as a universal upper bound on thermalization time, not as an achieved cost for any named Hamiltonian, and the exponent α depends on the free energy density of the system in question, so it has to be bounded per system before the figure means anything operationally. The abstract gives no gate counts, ancilla counts, error-correction overhead, or hardware requirements, and gives no target accuracy or temperature range for a worked instance. The Zoo section collects many separate methods for eigenstates and thermal states; this record covers only the Poulin and Wocjan construction and does not establish which Hamiltonian classes admit efficient preparation.",
    caveatJa: "本項目は文献に基づく記録であり、回路の構成、コンパイル、シミュレーション、ベンチマークは一切行っていません。D^α は熱化時間の普遍的な上界として述べられたものであり、特定の Hamiltonian で達成されたコストではありません。指数 α は対象系の自由エネルギー密度に依存するため、実用的な意味を持たせるには系ごとに上界を与える必要があります。要旨にはゲート数、補助量子ビット数、誤り訂正のオーバーヘッド、ハードウェア要件は示されておらず、具体例に対する目標精度や温度範囲も示されていません。Zoo の該当節は固有状態と熱状態に関する多数の手法をまとめたものですが、本項目が扱うのは Poulin と Wocjan の構成のみであり、どのクラスの Hamiltonian が効率的な準備を許すかについては何も確定していません。",
    tags: ["gibbs state", "thermal state", "partition function", "quantum sampling", "hamiltonian"],
    source: {
      id: "arxiv:0905.2199",
      title: "Sampling from the thermal quantum Gibbs state and evaluating partition functions with a quantum computer",
      authors: "David Poulin, Pawel Wocjan",
      year: "2009",
      url: "https://arxiv.org/abs/0905.2199",
    },
    literature: [
      {
        title: "Sampling from the thermal quantum Gibbs state and evaluating partition functions with a quantum computer",
        authors: "David Poulin, Pawel Wocjan",
        year: "2009",
        url: "https://arxiv.org/abs/0905.2199",
        relevance: "Primary source: it states the Gibbs-state preparation for interacting quantum systems, the universal D^α thermalization-time bound with α < 1/2 tied to the Helmholtz free energy density, and the partition-function algorithm's dependence on thermalization time and on the squared target accuracy.",
        relevanceJa: "一次資料です。相互作用する量子系に対する Gibbs 状態の準備、Helmholtz 自由エネルギー密度に結びついた α < 1/2 を伴う普遍的な熱化時間の上界 D^α、および分配関数アルゴリズムの熱化時間と目標精度の二乗への依存が述べられています。",
      },
    ],
    relatedSlugs: ["quantum-singular-value-transformation", "qite-imaginary-time", "hamiltonian-simulation-ising"],
  },
  {
    slug: "jones-polynomial-approximation",
    title: "Additive approximation of the Jones polynomial at a primitive root of unity",
    titleJa: "1の原始k乗根におけるJones多項式の加法的近似",
    family: "Topological invariants",
    zooName: "Knot Invariants",
    zooSection: "Approximation and Simulation Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given a braid on n strands with m crossings and an integer k, compute a certain additive approximation to the Jones polynomial of the link obtained by closing the braid, evaluated at the primitive root of unity e^(2πi/k).",
    problemJa:
      "n本のストランドとm個の交差を持つブレイドと整数kが与えられたとき、ブレイドを閉じて得られる絡み目のJones多項式を1の原始k乗根 e^(2πi/k) で評価した値について、ある加法的近似を求める問題です。",
    idea:
      "Freedman, Kitaev, Larsen and Wang had shown that a quantum computer can efficiently simulate topological quantum field theory and vice versa, which implicitly implies an efficient additive approximation of the Jones polynomial at e^(2πi/5) and makes that approximation BQP-complete, but the algorithm was never explicitly formulated and its TQFT footing left it inaccessible to computer scientists. Aharonov, Jones and Landau write that algorithm down explicitly, resting it on well known mathematical results instead of TQFT. Their algorithm takes a braid of n strands with m crossings and returns the additive approximation at any primitive root of unity e^(2πi/k), and the paper states that, by the results of Freedman et al., its algorithm solves a BQP-complete problem.",
    ideaJa:
      "Freedman、Kitaev、Larsen、Wangは量子計算機が位相的量子場理論を効率的にシミュレートでき、その逆も成り立つことを示しました。これは e^(2πi/5) におけるJones多項式を加法的に近似する効率的なアルゴリズムが存在すること、およびその問題がBQP完全であることを暗に導きますが、アルゴリズム自体は明示的に定式化されず、位相的量子場理論に依拠するため計算機科学者には扱いにくいままでした。Aharonov、Jones、Landauは位相的量子場理論ではなくよく知られた数学的結果に基づき、そのアルゴリズムを明示的に書き下しています。このアルゴリズムはn本のストランドとm個の交差を持つブレイドを入力として、任意の1の原始k乗根 e^(2πi/k) における加法的近似を返します。論文は、Freedmanらの結果により、このアルゴリズムがBQP完全な問題を解くと述べています。",
    complexity:
      "Running time polynomial in m, n and k for an n-strand braid with m crossings, at any primitive root of unity e^(2πi/k); the guarantee is an additive approximation.",
    complexityBasis:
      'Abstract of arXiv:quant-ph/0511096: "an explicit and simple polynomial quantum algorithm to approximate the Jones polynomial of an n-strands braid with m crossings at any primitive root of unity ... where the running time of the algorithm is polynomial in m,n and k". The abstract gives no exponent, no constant, and no numeric size for the additive approximation window.',
    caveat:
      "The word additive is load-bearing and left unquantified: neither the Zoo entry nor the abstract states how large the approximation window is, so this record does not establish that the output is useful as a multiplicative estimate of the Jones polynomial. The BQP-completeness quoted by the Zoo is for the plat closure of a braid at e^(2πi/5); the Zoo separately reports that the trace closure at the same point is DQC1-complete, so the closure convention changes the complexity claim. Nothing here was compiled, simulated or run: no braid instance, qubit count, circuit depth, or exponent for the polynomial in m, n and k is attached, and BQP-completeness is a statement about quantum hardness, not evidence about any device.",
    caveatJa:
      "近似が加法的であるという点が本質ですが、Zooの記述にも要旨にも誤差幅の定量的な言及はないため、この項目は出力がJones多項式の乗法的な推定として使えることを保証しません。Zooが引用するBQP完全性はブレイドのプラット閉包を e^(2πi/5) で評価した場合のものであり、同じ点でもトレース閉包ではDQC1完全になるとZooは述べているため、閉包の取り方によって計算量の主張は変わります。回路の作成、シミュレーション、実行は行っておらず、具体的なブレイド事例、量子ビット数、回路深さ、m・n・kに対する多項式の次数はいずれも示されていません。BQP完全性は量子計算の難しさに関する主張であって、実機についての証拠ではありません。",
    tags: ["jones polynomial", "knot invariants", "braid", "bqp-complete", "approximation"],
    source: {
      id: "arxiv:quant-ph/0511096",
      title: "A Polynomial Quantum Algorithm for Approximating the Jones Polynomial",
      authors: "Dorit Aharonov, Vaughan Jones, Zeph Landau",
      year: "2005",
      url: "https://arxiv.org/abs/quant-ph/0511096",
    },
    literature: [
      {
        title: "A Polynomial Quantum Algorithm for Approximating the Jones Polynomial",
        authors: "Dorit Aharonov, Vaughan Jones, Zeph Landau",
        year: "2005",
        url: "https://arxiv.org/abs/quant-ph/0511096",
        relevance:
          "Primary source: makes the previously implicit algorithm explicit, extends it from e^(2πi/5) to any primitive root of unity e^(2πi/k), and states the running time as polynomial in m, n and k. The authors also flag the Potts model partition function as a candidate for the same approach.",
        relevanceJa:
          "一次資料です。それまで暗黙にしか存在しなかったアルゴリズムを明示的に構成し、e^(2πi/5) から任意の1の原始k乗根 e^(2πi/k) へ拡張したうえで、実行時間がm、n、kの多項式であることを述べています。著者らは同じ手法の適用候補としてPottsモデルの分配関数にも言及しています。",
      },
    ],
    relatedSlugs: ["amplitude-estimation", "hamiltonian-simulation-ising"],
  },
  {
    slug: "quantum-simulated-annealing",
    title: "Quantum simulated annealing",
    titleJa: "量子シミュレーテッドアニーリング",
    family: "Markov-chain sampling",
    zooName: "Simulated Annealing",
    zooSection: "Approximation and Simulation Algorithms",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem: "Sample from the final limiting distribution πₙ of a slowly varying sequence of Markov chains, where πₙ is chosen to concentrate on good solutions of a combinatorial optimization problem.",
    problemJa: "ゆっくり変化するマルコフ連鎖の列の最終的な極限分布 πₙ からサンプリングする問題です。πₙ は組合せ最適化問題の良い解に集中するように選ばれます。",
    idea: "Classical simulated annealing applies stochastic matrices M₁, M₂, …, Mₙ whose limiting distributions satisfy |πₜ₊₁ − πₜ| < ε for some small ε, so that an easily prepared π₁ can be carried step by step to πₙ; these distributions are typically thermal distributions at successively lower temperatures. Somma, Boixo, Barnum and Knill describe a quantum algorithm that simulates that annealing process on a quantum computer, using quantum walks together with the quantum Zeno effect induced by randomizing the evolution. The cost is governed by δ, the minimum over the schedule of the gap between the largest and second largest eigenvalues of each Mᵢ, and the quantum algorithm requires only the square root of the classical dependence on that gap. The Zoo describes this construction as building upon results of Szegedy.",
    ideaJa: "古典のシミュレーテッドアニーリングでは、ある小さな ε に対して極限分布が |πₜ₊₁ − πₜ| < ε を満たす確率行列 M₁, M₂, …, Mₙ を順に適用し、準備しやすい π₁ から πₙ へ段階的に移します。これらの分布は通常、温度を下げていく熱平衡分布に対応します。Somma、Boixo、Barnum、Knill は、このシミュレーテッドアニーリング過程を量子計算機上でシミュレートする量子アルゴリズムを記述しており、そこでは量子ウォークと、時間発展のランダム化によって誘起される量子 Zeno 効果が用いられます。コストは各 Mᵢ の最大固有値と第2固有値の差の最小値 δ で決まり、量子アルゴリズムはこのギャップに対する古典の依存性の平方根で済みます。Zoo はこの構成を Szegedy の結果の上に構築されたものと位置づけています。",
    complexity: "Order 1/√δ steps to find an optimal solution with bounded error probability, where δ is the minimum spectral gap of the stochastic matrices used in the classical annealing process; this is a quadratic improvement over the order 1/δ steps required by the classical procedure.",
    complexityBasis: "abstract of arXiv:0804.1571 (TeX rendered as Unicode): \"It requires order 1/√δ steps to find an optimal solution with bounded error probability, where δ is the minimum spectral gap of the stochastic matrices used in the classical annealing process. This is a quadratic improvement over the order 1/δ steps required by the latter.\" The Zoo entry states the same contrast: \"The run time of this classical algorithm is proportional to 1/δ … quantum computers can sample from π_n with a runtime proportional to 1/√δ.\"",
    caveat: "Nothing here was constructed, compiled, simulated, or benchmarked; this is a literature record. The 1/√δ figure is a step count in the paper's own model, not a gate count, a qubit count, or a wall-clock time, and the cost of implementing one walk step is not stated in the cited abstract. δ is a property of a particular annealing schedule and class of instances, and neither the abstract nor the Zoo entry supplies δ, constant factors, or an error-correction budget for any concrete optimization problem, so no claim is made about which instances actually benefit or about hardware feasibility.",
    caveatJa: "本項目は文献に基づく記録であり、回路の構成、コンパイル、シミュレーション、ベンチマークは一切行っていません。1/√δ は論文のモデルにおけるステップ数であり、ゲート数、量子ビット数、実時間ではありません。1ステップの実装コストは引用した要旨に示されていません。δ は個々のシミュレーテッドアニーリングのスケジュールと問題例のクラスに依存する量で、要旨にも Zoo の記述にも、具体的な最適化問題に対する δ の値、定数因子、誤り訂正の見積もりは示されていません。したがって、どの問題例が実際に恩恵を受けるか、実機で実行可能かについては何も主張していません。",
    tags: ["simulated annealing", "quantum walk", "markov chain", "optimization", "spectral gap"],
    source: {
      id: "arxiv:0804.1571",
      title: "Quantum Simulations of Classical Annealing Processes",
      authors: "R. D. Somma, S. Boixo, H. Barnum, E. Knill",
      year: "2008",
      url: "https://arxiv.org/abs/0804.1571",
    },
    literature: [
      {
        title: "Quantum Simulations of Classical Annealing Processes",
        authors: "R. D. Somma, S. Boixo, H. Barnum, E. Knill",
        year: "2008",
        url: "https://arxiv.org/abs/0804.1571",
        relevance: "Primary source for the quantum construction: it states the quantum-walk plus evolution-randomization (quantum Zeno) mechanism, the order 1/√δ step count with bounded error probability, and the quadratic improvement over the classical order 1/δ.",
        relevanceJa: "量子的構成の一次資料です。量子ウォークと時間発展のランダム化による量子 Zeno 効果という機構、有界誤り確率での 1/√δ 程度のステップ数、古典の 1/δ に対する二次（二乗）の改善が述べられています。",
      },
    ],
    relatedSlugs: ["quantum-walk-line", "quantum-adiabatic-evolution", "qaoa-maxcut-ring"],
  },
  {
    slug: "decoded-quantum-interferometry",
    title: "Optimization by decoded quantum interferometry",
    titleJa: "復号量子干渉法（DQI）による最適化",
    family: "Optimization · decoded interferometry",
    zooName: "Optimization by Decoded Quantum Interferometry",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Superpolynomial",
    speedupPrimary: { states: "unknown" },
    problem: "Given a set of constraints over a finite field, such as a max-XORSAT instance or the task of finding a degree-n polynomial over 𝔽ₚ that approximates a given data set as well as possible, produce an assignment that satisfies as many constraints as possible.",
    problemJa: "有限体上の制約集合、たとえばmax-XORSATインスタンスや、与えられたデータ集合を𝔽ₚ上でできるだけよく近似する次数nの多項式を求める課題に対し、満たす制約の数ができるだけ多い割り当てを出力します。",
    idea: "Decoded Quantum Interferometry uses the quantum Fourier transform to reduce the optimization problem to a decoding problem, so the number of constraints the output satisfies is set by the number of errors that can be decoded. When each constraint depends on only a few variables, the induced code is a classical LDPC code, which efficient classical decoders such as belief propagation handle at large error counts. When the constraints carry algebraic structure, as in polynomial fitting over 𝔽ₚ, that structure carries over to the decoding problem and yields Reed-Solomon codes, which classical algorithms decode up to half their distance; this is the regime where the paper claims its speedup. The construction is built on Regev's reduction.",
    ideaJa: "DQIは量子フーリエ変換を用いて最適化問題を復号問題へ帰着させ、出力が満たす制約の個数は復号できる誤りの個数によって決まります。各制約が少数の変数にしか依存しない場合、得られる符号は古典LDPC符号となり、信念伝播などの効率的な古典復号器が多数の誤りを訂正できます。制約に代数的構造がある場合、たとえば𝔽ₚ上の多項式フィッティングでは、その構造が復号問題側へ引き継がれてReed-Solomon符号となり、最小距離の半分まで古典的に復号できます。論文が高速化を主張しているのはこの領域で、全体はRegevの帰着の上に構成されています。",
    complexity: "",
    complexityBasis: 'abstract of arXiv:2408.08292: "For approximating optimal polynomial fits over finite fields, DQI achieves a superpolynomial speedup over known classical algorithms." That abstract states no explicit query, gate, or qubit count, and the Quantum Algorithm Zoo entry likewise quotes no bound, classing the entry as "Superpolynomial" and describing the polynomial-regression case as "apparent exponential speedup".',
    caveat: "This record cites a published claim; no circuit was constructed, simulated, run, or benchmarked here. The speedup is stated relative to known classical algorithms for optimal polynomial fits over finite fields rather than proven as a separation, and the paper itself reports that on the max-XORSAT instance it constructs, a tailored classical solver outperforms DQI even though DQI finds an approximate optimum significantly faster than general-purpose classical heuristics such as simulated annealing. How many constraints are satisfied is inherited from whichever decoder is used, so no approximation guarantee is recorded here independent of that decoder, and no qubit count, circuit depth, or fault-tolerance estimate is established.",
    caveatJa: "本項目は文献の主張を記録したものであり、回路の構成、シミュレーション、実行、ベンチマークはいずれも行っていません。超多項式的な高速化は有限体上の多項式フィッティングについて既知の古典アルゴリズムと比較した主張であり、分離の証明ではありません。論文自身も、構成したmax-XORSATインスタンスではDQIが焼きなまし法などの汎用的な古典ヒューリスティクスよりも大幅に速く近似最適解を見つける一方、専用の古典ソルバーはDQIを上回ると述べています。満たされる制約数は用いる復号器に依存するため、その復号器と独立した近似保証はここでは記録していません。量子ビット数、回路深さ、誤り耐性を含む資源見積もりも確立していません。",
    tags: ["optimization", "decoding", "quantum fourier transform", "ldpc", "reed-solomon"],
    source: {
      id: "arxiv:2408.08292",
      title: "Optimization by Decoded Quantum Interferometry",
      authors: "Stephen P. Jordan, Noah Shutty, Mary Wootters, Adam Zalcman, Alexander Schmidhuber, Robbie King, Sergei V. Isakov, Tanuj Khattar, Ryan Babbush",
      year: "2024",
      url: "https://arxiv.org/abs/2408.08292",
    },
    literature: [
      {
        title: "Optimization by Decoded Quantum Interferometry",
        authors: "Stephen P. Jordan, Noah Shutty, Mary Wootters, Adam Zalcman, Alexander Schmidhuber, Robbie King, Sergei V. Isakov, Tanuj Khattar, Ryan Babbush",
        year: "2024",
        url: "https://arxiv.org/abs/2408.08292",
        relevance: "Primary paper introducing DQI, the reduction from optimization to decoding via the quantum Fourier transform, the polynomial-fit speedup claim over finite fields, and the max-XORSAT instance on which DQI is compared with classical heuristics.",
        relevanceJa: "DQIを導入した一次文献です。量子フーリエ変換による最適化から復号への帰着、有限体上の多項式フィッティングにおける高速化の主張、古典ヒューリスティクスと比較したmax-XORSATインスタンスが記載されています。",
      },
    ],
    relatedSlugs: ["quantum-fourier-transform", "qaoa-maxcut-ring"],
  },
  {
    slug: "linear-differential-equations",
    title: "Quantum algorithms for linear differential equations",
    titleJa: "線形微分方程式を解く量子アルゴリズム",
    family: "Quantum differential equations · linear",
    zooName: "Solving Linear Differential Equations",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Superpolynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given a first-order linear differential equation d/dt x = A(t)x + b(t) with N-dimensional vectors x and b and an N×N matrix A, and given an initial condition x(0), produce the solution x(t) at a later time t to precision ε, in the sense that the normalized vector x(t)/‖x(t)‖ returned is at distance at most ε from the exact solution.",
    problemJa:
      "N次元ベクトルxおよびbとN×N行列Aからなる一階線形微分方程式 d/dt x = A(t)x + b(t)について、初期条件x(0)が与えられたとき、後の時刻tにおける解x(t)を精度εで求める問題です。ここでの精度は、得られる規格化ベクトルx(t)/‖x(t)‖と厳密解との距離がε以下であることを指します。",
    idea:
      "Quantum simulation already handles the restricted linear differential equations that describe quantum systems; the construction extends it to general inhomogeneous sparse linear differential equations by turning time evolution into one large linear-algebra problem and handing that problem to a quantum linear algebra primitive. Berry discretizes the evolution with a high-order finite difference method, and it is the use of high-order methods that gives scaling close to Δt² in the evolution time Δt. The answer arrives as a superposition on O(log N) qubits whose amplitudes carry the components of x(t), from which global features of the solution can be extracted. The later Berry, Childs, Ostrander and Wang algorithm replaces the difference stencil with a Taylor series approximation of the propagator encoded in a sparse, well-conditioned linear system, which drops the extra hypotheses finite differences need for numerical stability.",
    ideaJa:
      "量子系を記述する限られた形の線形微分方程式は量子シミュレーションで既に扱えますが、この手法は時間発展を1つの大きな線形代数問題に帰着させ、量子線形代数プリミティブに渡すことで、一般の非斉次かつ疎な線形微分方程式へ拡張します。Berryは高次精度差分法で時間発展を離散化しており、高次精度であることにより発展時間Δtに対しΔt²に近いスケーリングが得られます。解はO(log N)量子ビット上の重ね合わせとして、その振幅にx(t)の成分が含まれる形で現れ、解の大域的な特徴を取り出せます。後続のBerry、Childs、Ostrander、Wangのアルゴリズムは、差分ステンシルの代わりに伝播作用素のTaylor展開を疎で条件の良い線形系に符号化し、差分法が数値安定性のために課していた追加の仮定を不要にします。",
    complexity:
      "Time O(t² poly(1/ε) poly log N) for the Berry algorithm, against O(t poly N) for the fastest classical algorithms; for systems with constant coefficients the Berry, Childs, Ostrander and Wang variant is polynomial in the logarithm of the inverse error, an exponential improvement in the precision dependence.",
    complexityBasis:
      'Quantum Algorithm Zoo entry "Solving Linear Differential Equations": "Berry gives a quantum algorithm for this problem that runs in time O(t^2 poly(1/epsilon) poly log N), whereas the fastest classical algorithms run in time O(t poly N)"; precision dependence from the abstract of arXiv:1701.03684: "The complexity of the algorithm is polynomial in the logarithm of the inverse error, an exponential improvement over previous quantum algorithms for this problem." The abstract of the primary paper arXiv:1010.2745 states only "scaling close to Δt² in the evolution time Δt", with no full cost expression.',
    caveat:
      "This is a literature record. No circuit was constructed, compiled, simulated, or run for it, and it carries no resource estimate. The bounds above are the Zoo's and the papers' own statements about sparse systems under the assumptions those papers adopt, checked against no instance data here; the Zoo itself notes that a general formulation leaves tasks such as preparation of the relevant initial state unspecified. The output is a normalized quantum state, so the cost of reading out individual components of x(t), as opposed to global features, is not established here, and neither are constant factors, condition-number dependence, or hardware feasibility.",
    caveatJa:
      "本項目は文献記録であり、回路の構成、コンパイル、シミュレーション、実行はいずれも行っていません。資源見積りも含みません。上記の計算量はZooと各論文が疎な系について自ら述べた主張であり、論文が置く仮定に依存します。ここで具体的な問題例に照らして検証したものではなく、Zoo自身も、一般的な定式化では該当する初期状態の準備などの作業が未規定のまま残ると述べています。出力は規格化された量子状態であるため、大域的な特徴ではなくx(t)の個々の成分を読み出すコストは本項目では確立されておらず、定数因子、条件数への依存、ハードウェア上の実現可能性も同様です。",
    tags: ["differential equations", "linear systems", "amplitude encoding", "sparse matrix"],
    source: {
      id: "arxiv:1010.2745",
      title: "High-order quantum algorithm for solving linear differential equations",
      authors: "Dominic W. Berry",
      year: "2010",
      url: "https://arxiv.org/abs/1010.2745",
    },
    literature: [
      {
        title: "High-order quantum algorithm for solving linear differential equations",
        authors: "Dominic W. Berry",
        year: "2010",
        url: "https://arxiv.org/abs/1010.2745",
        relevance:
          "The algorithm the Zoo entry cites for this problem: quantum simulation extended to general inhomogeneous sparse linear differential equations, with high-order methods giving scaling close to Δt² in the evolution time and the solution encoded in the amplitudes of the state.",
        relevanceJa:
          "Zooの項目がこの問題に対して挙げているアルゴリズムです。量子シミュレーションを一般の非斉次かつ疎な線形微分方程式へ拡張し、高次精度の手法により発展時間Δtに対しΔt²に近いスケーリングを与え、解は状態の振幅に符号化されます。",
      },
      {
        title:
          "Quantum algorithm for linear differential equations with exponentially improved dependence on precision",
        authors: "Dominic W. Berry, Andrew M. Childs, Aaron Ostrander, Guoming Wang",
        year: "2017",
        url: "https://arxiv.org/abs/1701.03684",
        relevance:
          "The improvement the Zoo credits with bringing the error dependence down to a polynomial in log(1/ε): for constant-coefficient systems the evolution is encoded into a sparse, well-conditioned linear system approximating the propagator by a Taylor series, which unlike finite differences needs no extra hypotheses for numerical stability.",
        relevanceJa:
          "Zooが誤差依存性をlog(1/ε)の多項式まで下げたと評価している改良です。定数係数の系について、伝播作用素をTaylor展開で近似した疎で条件の良い線形系に時間発展を符号化しており、差分法と異なり数値安定性のための追加仮定を必要としません。",
      },
    ],
    relatedSlugs: [
      "hhl-linear-systems",
      "linear-combination-unitaries",
      "quantum-singular-value-transformation",
      "hamiltonian-simulation-ising",
    ],
  },
  {
    slug: "nonlinear-differential-equations",
    title: "Quantum algorithms for nonlinear differential equations",
    titleJa: "非線形微分方程式を解く量子アルゴリズム",
    family: "Quantum differential equations · nonlinear",
    zooName: "Solving Nonlinear Differential Equations",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Superpolynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given a system of nonlinear ordinary differential equations, in the primary algorithm's case a dissipative quadratic n-dimensional system, produce the solution at a chosen evolution time T to error ε, encoded in the amplitudes of a quantum state.",
    problemJa:
      "非線形の常微分方程式系、とりわけ本項目の主論文が扱う散逸的な二次のn次元系について、指定した発展時間Tにおける解を誤差ε以内で求め、量子状態の振幅に符号化して出力する問題です。",
    idea:
      "Carleman linearization maps the nonlinear system to an infinite-dimensional system of linear differential equations, which is then truncated, discretized with the forward Euler method, and solved with the quantum linear system algorithm; the paper supplies a new convergence theorem for the Carleman linearization. Efficiency is conditional on the parameter R, which compares the nonlinearity and the forcing against the linear dissipation, staying below 1, and the same work proves a worst-case lower bound making general quadratic differential equations intractable once R ≥ √2. Exponential decay of the solution precludes efficiency, but driven equations can avoid that issue despite the presence of dissipation. The earlier route of Leyton and Osborne is structurally different: it combines a subroutine that applies a nonlinear transformation to the probability amplitudes of an unknown state with a quantum implementation of Euler's method, and is nondeterministic.",
    ideaJa:
      "Carleman線形化により非線形系を無限次元の線形微分方程式系へ写し、これを打ち切って離散化し、前進Euler法と量子線形システムアルゴリズムで解きます。論文はこのCarleman線形化に対する新しい収束定理を与えています。効率性は、非線形項と強制項を線形散逸と比べたパラメータRが1未満であることを前提としており、同じ論文はR ≥ √2では一般の二次の微分方程式が困難であるという最悪計算量の下界も示しています。解が指数的に減衰する場合は効率が失われますが、散逸があっても駆動項のある方程式であればこの問題を避けられます。より初期のLeytonとOsborneの手法は構成が異なり、未知状態の確率振幅に非線形変換を施すサブルーチンとEuler法の量子的実装を組み合わせた非決定的なアルゴリズムです。",
    complexity:
      "For dissipative quadratic n-dimensional ODEs with R < 1, complexity T² q poly(log T, log n, log 1/ε)/ε, where T is the evolution time, ε the allowed error and q measures decay of the solution; a worst-case lower bound in the same paper shows the general quadratic problem is intractable for R ≥ √2. The earlier Leyton and Osborne algorithm has expected resource requirements polylogarithmic in the number of variables but exponential in the integration time, against a best classical algorithm scaling linearly in the number of variables.",
    complexityBasis:
      'abstract of arXiv:2011.03185: "Assuming R < 1, where R is a parameter characterizing the ratio of the nonlinearity and forcing to the linear dissipation, this algorithm has complexity T^2 q poly(log T, log n, log 1/epsilon)/epsilon, where T is the evolution time, epsilon is the allowed error, and q measures decay of the solution", and "a lower bound on the worst-case complexity of quantum algorithms for general quadratic differential equations, showing that the problem is intractable for R >= sqrt(2)"; second bound from the abstract of arXiv:0812.4423: "its expected resource requirements are polylogarithmic in the number of variables and exponential in the integration time. The best classical algorithm runs in a time scaling linearly with the number of variables."',
    caveat:
      "This is a literature record. Nothing was executed for it: no circuit was built, compiled, simulated, or benchmarked, and no resource count is claimed. The T² bound holds only inside the stated regime, a dissipative quadratic system with R < 1, and says nothing about systems outside it; the paper's support for larger R in a fluid-dynamics model is described in its own abstract as numerical evidence, not a proof. Because the solution lives in the amplitudes of a quantum state, unitarity means the approach is inefficient when the solution's norm grows or shrinks too rapidly, and the cost of reading individual solution components back out is not established here, nor are constant factors, the input-access model, or hardware feasibility.",
    caveatJa:
      "本項目は文献記録です。回路の構成、コンパイル、シミュレーション、ベンチマークはいずれも行っておらず、資源量の主張も含みません。T²の計算量は、R < 1を満たす散逸的な二次の系という限られた条件の中でのみ成り立ち、その外側の系については何も述べていません。より大きなRを含む流体力学モデルへの適用可能性は、論文の要旨自身が数値的な証拠として述べているものであり、証明ではありません。解が量子状態の振幅に置かれるため、ユニタリ性により解のノルムが急激に増大または減少する場合には効率が失われます。個々の解成分を読み出すコスト、定数因子、入力アクセスモデル、ハードウェア上の実現可能性は、いずれも本項目では確立していません。",
    tags: ["differential equations", "nonlinear", "carleman linearization", "amplitude encoding"],
    source: {
      id: "arxiv:2011.03185",
      title: "Efficient quantum algorithm for dissipative nonlinear differential equations",
      authors:
        "Jin-Peng Liu, Herman Øie Kolden, Hari K. Krovi, Nuno F. Loureiro, Konstantina Trivisa, Andrew M. Childs",
      year: "2020",
      url: "https://arxiv.org/abs/2011.03185",
    },
    literature: [
      {
        title: "Efficient quantum algorithm for dissipative nonlinear differential equations",
        authors:
          "Jin-Peng Liu, Herman Øie Kolden, Hari K. Krovi, Nuno F. Loureiro, Konstantina Trivisa, Andrew M. Childs",
        year: "2020",
        url: "https://arxiv.org/abs/2011.03185",
        relevance:
          "The Carleman linearization algorithm the Zoo credits with T² scaling, together with its convergence theorem, its R < 1 condition, and the accompanying intractability bound for R ≥ √2; it also reports that the condition can be met in realistic epidemiological models.",
        relevanceJa:
          "ZooがT²のスケーリングを与えるとしているCarleman線形化に基づくアルゴリズムです。収束定理、R < 1という条件、R ≥ √2での困難性の下界を示し、この条件が現実的な感染症モデルで満たされうることも報告しています。",
      },
      {
        title: "A quantum algorithm to solve nonlinear differential equations",
        authors: "Sarah K. Leyton, Tobias J. Osborne",
        year: "2008",
        url: "https://arxiv.org/abs/0812.4423",
        relevance:
          "The earlier approach the Zoo describes as exponential in t: a nondeterministic algorithm for sparse nonlinear systems with polynomial nonlinear terms, built from a nonlinear transformation of the amplitudes of an unknown state and a quantum implementation of Euler's method.",
        relevanceJa:
          "Zooが時間tについて指数的と述べている初期の手法です。非線形項が多項式である疎な非線形系を対象とし、未知状態の振幅への非線形変換とEuler法の量子的実装から構成される非決定的なアルゴリズムです。",
      },
    ],
    relatedSlugs: ["hhl-linear-systems", "linear-combination-unitaries", "amplitude-amplification"],
  },
  {
    slug: "matrix-product-verification",
    title: "Matrix product verification by quantum walk",
    titleJa: "量子ウォークによる行列積の検証",
    family: "Quantum query algorithm",
    zooName: "Verifying Matrix Products",
    zooSection: "Algebraic and Number Theoretic Algorithms",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given three n×n matrices A, B and C over a field, decide whether AB = C, rather than computing the product and comparing it entry by entry.",
    problemJa:
      "体上の n×n 行列 A, B, C が三つ与えられたとき、積を計算して成分ごとに比べるのではなく、AB = C が成り立つかどうかを判定する問題です。",
    idea:
      "The paper describes a quantum algorithm that decides whether AB = C over any field with bounded error. Its cost is sensitive to how wrong the claimed product is: the worst-case time is n^(5/3), while the expected time is n^(5/3) / min(w, √n)^(1/3) when w entries are wrong, so the expected figure falls as w grows until w reaches √n, past which the minimum in the denominator stops changing. The Zoo records that this algorithm rests on results about quantum walks proven in a separate paper, and that it improves the n^(7/4) algorithm the Zoo credits to Ambainis et al. The same paper also presents a quantum matrix multiplication algorithm that its authors describe as efficient when the result has few nonzero entries.",
    ideaJa:
      "この論文は、任意の体上で AB = C が成り立つかどうかを有界誤りで判定する量子アルゴリズムを示しています。コストは主張された積がどれだけ誤っているかに依存し、最悪時間は n^(5/3) である一方、誤っている成分が w 個ある場合の期待時間は n^(5/3) / min(w, √n)^(1/3) となります。この期待時間は w が大きくなるほど小さくなりますが、w が √n に達したあとは分母の min が変わらなくなります。Zoo は、このアルゴリズムが別の論文で証明された量子ウォークに関する結果に基づいており、Zoo が Ambainis らに帰する n^(7/4) のアルゴリズムを改良したものだと記しています。同じ論文には、結果の非零成分が少ない場合に効率的だと著者らが述べる、行列の積を計算する量子アルゴリズムも示されています。",
    complexity:
      "Worst-case time n^(5/3) to verify a product of two n×n matrices over any field with bounded error, and expected time n^(5/3) / min(w, √n)^(1/3), where w is the number of wrong entries; the Zoo gives O(n^(7/4)) for the earlier quantum algorithm it credits to Ambainis et al., O(n^2) for the best known randomized classical verification, and O(n^(2.373)) for the best known classical matrix multiplication.",
    complexityBasis:
      'abstract of arXiv:quant-ph/0409035: "We present a quantum algorithm that verifies a product of two n*n matrices over any field with bounded error in worst-case time n^{5/3} and expected time n^{5/3} / min(w,sqrt(n))^{1/3}, where w is the number of wrong entries. This improves the previous best algorithm that runs in time n^{7/4}." The comparison figures are from the Quantum Algorithm Zoo entry "Verifying Matrix Products" (LaTeX rendered into plain text): "Classically, the best known (randomized) algorithm achieves this in time O(n^2), whereas the best known classical algorithm for matrix multiplication runs in time O(n^{2.373})", "Ambainis et al. discovered a quantum algorithm for this problem with runtime O(n^{7/4})", and "Buhrman and Špalek improved upon this, obtaining a quantum algorithm for this problem with runtime O(n^{5/3})". The Zoo spells the second author Špalek; the author list recorded for the primary reference gives Robert Spalek, which is the spelling carried in the source field.',
    caveat:
      "This is a literature record: no circuit was constructed, compiled, simulated, or run, and no matrix instance was verified. The abstract states its times as bare n^(5/3) and n^(5/3) / min(w, √n)^(1/3), with no O(·) notation, constant factor, gate or qubit count, and no statement of how the entries of A, B and C are made available, so nothing here bounds the cost of a concrete n. The expected-time refinement is governed by w, the number of wrong entries in the claimed product, which is a property of the instance and is not known in advance; the worst-case figure is the one that holds without it. The classical baselines are the fastest algorithms currently known, as the Zoo says, not proven lower bounds, so the polynomial separation is conditional on that state of the art. The quantum-walk results the algorithm is built on, and the earlier n^(7/4) algorithm it improves, are in papers outside this record, and the second result in the same abstract, a quantum matrix multiplication algorithm for results with few nonzero entries, is described only as efficient, with no bound quoted anywhere in the sources read here.",
    caveatJa:
      "本項目は文献に基づく記録であり、回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、具体的な行列の検証も行っていません。要旨は計算時間を n^(5/3) および n^(5/3) / min(w, √n)^(1/3) とだけ述べており、O(·) の記法も定数因子もゲート数も量子ビット数も示されず、A, B, C の各成分をどのように参照するかも述べられていないため、具体的な n におけるコストはここからは分かりません。期待時間の改善は主張された積のうち誤っている成分の個数 w に支配されますが、w は問題例ごとの性質であり事前には分かりません。w に依存せず成り立つのは最悪時間のほうです。古典側は Zoo が述べるとおり現在知られている最速のアルゴリズムであって証明された下界ではないため、多項式的な差はその前提に依存します。アルゴリズムの土台となる量子ウォークの結果も、改良の対象である n^(7/4) のアルゴリズムも本記録の対象外の論文にあり、同じ要旨のもう一つの結果である、非零成分が少ない場合の行列の積を計算する量子アルゴリズムについては「効率的」と述べられるのみで、ここで参照した資料には計算量の記載がありません。",
    tags: ["matrix verification", "quantum walk", "linear algebra", "query complexity", "bounded error"],
    source: {
      id: "arxiv:quant-ph/0409035",
      title: "Quantum Verification of Matrix Products",
      authors: "Harry Buhrman, Robert Spalek",
      year: "2004",
      url: "https://arxiv.org/abs/quant-ph/0409035",
    },
    literature: [
      {
        title: "Quantum Verification of Matrix Products",
        authors: "Harry Buhrman, Robert Spalek",
        year: "2004",
        url: "https://arxiv.org/abs/quant-ph/0409035",
        relevance: "Primary source and the origin of every figure in the cost claim: bounded-error verification of an n×n matrix product over any field in worst-case time n^(5/3), the expected time n^(5/3) / min(w, √n)^(1/3) in terms of the number w of wrong entries, and the improvement on the previous n^(7/4) algorithm. The same abstract announces a quantum matrix multiplication algorithm for the case where the result has few nonzero entries; consult the paper for what that algorithm costs, since the abstract states no bound for it.",
        relevanceJa: "一次資料であり、計算量欄の数値はすべてここに由来します。任意の体上での n×n 行列積の有界誤り検証が最悪時間 n^(5/3) であること、誤っている成分の個数 w を用いた期待時間 n^(5/3) / min(w, √n)^(1/3)、および従来の n^(7/4) のアルゴリズムに対する改良が述べられています。同じ要旨では、結果の非零成分が少ない場合に向けた行列の積を計算する量子アルゴリズムにも触れていますが、その計算量は要旨に示されていないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["quantum-walk-line", "element-distinctness", "grover-unstructured-search"],
  },
  {
    slug: "polynomial-interpolation",
    title: "Polynomial interpolation from oracle queries",
    titleJa: "オラクルクエリによる多項式補間",
    family: "Quantum query algorithm",
    zooName: "Polynomial interpolation",
    zooSection: "Oracular Algorithms",
    speedup: "Varies",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given an oracle that returns the value p(x) of an unknown degree-d polynomial p over the finite field GF(q) at any queried point x, determine the coefficients of p using as few queries as possible.",
    problemJa:
      "有限体 GF(q) 上の未知の d 次多項式 p について、問い合わせた点 x での値 p(x) を返すオラクルが与えられたとき、できるだけ少ないクエリ数で p の係数を決定する問題です。",
    idea:
      "Classically the d + 1 coefficients cannot be pinned down with fewer than d + 1 queries, and a lower bound proved independently by Kane and Kutin and by Meyer and Pommersheim puts the quantum cost at d/2 + 1/2 queries. Childs, van Dam, Hung and Shparlinski describe an algorithm that attains that lower bound rather than the d queries of the earlier Boneh and Zhandry algorithm, and they show that its success probability, as a function of the number of queries, is precisely optimal. Their abstract states that the algorithm can be implemented with gate complexity poly(log q) with negligible decrease in the success probability. Chen, Childs and Hung carry the same question to a degree-d polynomial in n variables, where their abstract reports a speedup over the classical count (n+d choose d) by a factor of n+1 over ℂ, (n+1)/2 over ℝ and (n+d)/d over GF(q), which it calls a much larger gap than the factor of 2 available in the univariate case.",
    ideaJa:
      "古典的には、d + 1 個の係数を決めるのに d + 1 クエリが必要であり、Kane と Kutin、および Meyer と Pommersheim がそれぞれ独立に証明した下界により、量子では d/2 + 1/2 クエリが必要です。Childs、van Dam、Hung、Shparlinski は、先行する Boneh と Zhandry のアルゴリズムの d クエリではなく、この下界に到達するアルゴリズムを示し、クエリ数の関数としての成功確率がちょうど最適であることも示しています。要旨によれば、このアルゴリズムはゲート計算量 poly(log q) で実装でき、その際の成功確率の低下は無視できる程度です。Chen、Childs、Hung は同じ問いを n 変数の d 次多項式へ広げており、古典のクエリ計算量 (n+d choose d) に対して、ℂ 上では n+1 倍、ℝ 上では (n+1)/2 倍、GF(q) 上では (n+d)/d 倍の高速化が得られると要旨は述べており、これは一変数の場合に得られる 2 倍の高速化よりもはるかに大きな差だとしています。",
    complexity:
      "Univariate over GF(q): d/2 + 1/2 quantum queries suffice to determine a degree-d polynomial with bounded error, which matches the lower bound, and d/2 + 1 queries suffice for success probability approaching 1 at large q, against d + 1 queries necessary and sufficient classically; the algorithm can be implemented with gate complexity poly(log q) with negligible decrease in the success probability. Multivariate, for degree d in n variables: ⌈(1/(n+1))·(n+d choose d)⌉ queries suffice for probability 1 over ℂ and twice that over ℝ, except for d = 2 and four other special cases, and ⌈(d/(n+d))·(n+d choose d)⌉ queries suffice for probability approaching 1 over GF(q) at large field order, against a classical query complexity of (n+d choose d).",
    complexityBasis:
      'abstract of arXiv:1509.09271: "A lower bound shown independently by Kane and Kutin and by Meyer and Pommersheim shows that d/2+1/2 quantum queries are needed to solve this problem with bounded error, whereas an algorithm of Boneh and Zhandry shows that d quantum queries are sufficient. We show that the lower bound is achievable: d/2+1/2 quantum queries suffice to determine the polynomial with bounded error. Furthermore, we show that d/2+1 queries suffice to achieve probability approaching 1 for large q", and "the algorithm can be implemented with gate complexity poly(log q) with negligible decrease in the success probability". The classical univariate count is from the Quantum Algorithm Zoo entry "Polynomial interpolation" (LaTeX rendered into plain text): "Classically, d + 1 queries are necessary and sufficient." The multivariate figures are from the abstract of arXiv:1701.03990, with TeX rendered into Unicode, the binomial written as (n+d choose d) and the subscript of k written as C rather than ℂ: "We show that k_C and 2k_C queries suffice to achieve probability 1 for ℂ and ℝ, respectively, where k_C=⌈(1/(n+1))(n+d choose d)⌉ except for d=2 and four other special cases. For 𝔽_q, we show that ⌈(d/(n+d))(n+d choose d)⌉ queries suffice to achieve probability approaching 1 for large field order q", and "The classical query complexity of this problem is (n+d choose d), so our result provides a speedup by a factor of n+1, (n+1)/2, and (n+d)/d for ℂ, ℝ, and 𝔽_q, respectively." Outside the quotations the finite field is written GF(q) throughout, as in the Zoo entry; the multivariate paper writes the same field as a blackboard-bold F with subscript q, and the Zoo states the multivariate quantum counts in O(·) form rather than as the paper\'s ceilings.',
    caveat:
      "This is a literature record: no oracle was instantiated, no circuit was compiled, simulated, or run, and no polynomial was reconstructed here. Every count above is a number of queries in the oracle model, and the two univariate upper bounds are not interchangeable, since d/2 + 1/2 queries are for bounded error while d/2 + 1 queries buy success probability approaching 1 and hold for large q, an asymptotic statement in the field order rather than a guarantee at a fixed q. The multivariate ⌈(1/(n+1))·(n+d choose d)⌉ count is stated with exceptions, for d = 2 and four other special cases, the GF(q) multivariate result again requires large field order, and the authors leave open their conjecture that twice that count also suffices over GF(q). The gate complexity poly(log q) is quoted with no exponent or constant, and no qubit count, circuit depth, or error-correction cost is established. The abstract's cryptographic remark, that these upper bounds improve results of Boneh and Zhandry on the insecurity of cryptographic protocols against quantum attacks, is a statement about query bounds, not a demonstrated attack on any deployed protocol. The remaining variants collected in the same Zoo entry, an oracle returning a quadratic character χ(f(x)), an oracle returning f(x)^e, and reconstruction of rational functions from noisy and incomplete values, rest on papers outside this record, and the speedup class \"Varies\" is the Zoo's classification of its entry rather than anything measured here.",
    caveatJa:
      "本項目は文献に基づく記録であり、オラクルを具体化したことも、回路をコンパイル・シミュレート・実行したことも、実際に多項式を復元したこともありません。上記の数値はいずれもオラクルモデルにおけるクエリ数です。一変数の二つの上界は互換ではなく、d/2 + 1/2 は有界誤りに対する値であるのに対し、d/2 + 1 は成功確率が 1 に近づく場合の値で、しかも q が大きい極限での主張であり、特定の q における保証ではありません。多変数の ⌈(1/(n+1))·(n+d choose d)⌉ には d = 2 とその他四つの特別な場合という例外が付き、GF(q) 上の結果も体の位数が大きい場合の主張です。GF(q) 上でもその 2 倍のクエリ数で足りるという予想は、著者らによって未解決のまま残されています。ゲート計算量 poly(log q) は指数も定数も伴わない形で引用したものであり、量子ビット数、回路深さ、誤り訂正のコストはいずれも確立していません。要旨の暗号に関する言及、すなわちこれらの上界が Boneh と Zhandry による暗号プロトコルの量子攻撃に対する脆弱性の結果を改良するという記述は、クエリ数の上界についての主張であって、実運用されているプロトコルへの攻撃を実証したものではありません。同じ Zoo 項目にまとめられている他の変種、すなわち二次指標 χ(f(x)) を返すオラクル、f(x)^e を返すオラクル、雑音を含む不完全な値からの有理関数の復元は、本記録の対象外の論文に基づきます。速度向上の区分「Varies」も Zoo による項目の分類であって、ここで測定した結果ではありません。",
    tags: ["polynomial interpolation", "oracle", "query complexity", "finite field", "multivariate"],
    source: {
      id: "arxiv:1509.09271",
      title: "Optimal quantum algorithm for polynomial interpolation",
      authors: "Andrew M. Childs, Wim van Dam, Shih-Han Hung, Igor E. Shparlinski",
      year: "2015",
      url: "https://arxiv.org/abs/1509.09271",
    },
    literature: [
      {
        title: "Optimal quantum algorithm for polynomial interpolation",
        authors: "Andrew M. Childs, Wim van Dam, Shih-Han Hung, Igor E. Shparlinski",
        year: "2015",
        url: "https://arxiv.org/abs/1509.09271",
        relevance: "Primary source for the univariate bounds: it reports that the d/2 + 1/2 lower bound of Kane and Kutin and of Meyer and Pommersheim is achievable with bounded error, that d/2 + 1 queries reach success probability approaching 1 for large q, that the success probability as a function of the number of queries is precisely optimal, and that gate complexity poly(log q) suffices with negligible decrease in that probability. It ends with a conjecture about the quantum query complexity of multivariate interpolation, which the companion paper below takes up.",
        relevanceJa: "一変数の場合の上界の一次資料です。Kane と Kutin、Meyer と Pommersheim による下界 d/2 + 1/2 が有界誤りで達成可能であること、d/2 + 1 クエリで成功確率が 1 に近づくこと（q が大きい場合）、クエリ数の関数としての成功確率がちょうど最適であること、成功確率の低下を無視できる範囲でゲート計算量 poly(log q) の実装が可能であることが述べられています。末尾には多変数補間の量子クエリ計算量に関する予想が置かれており、それを引き継ぐのが下記の論文です。",
      },
      {
        title: "Quantum algorithm for multivariate polynomial interpolation",
        authors: "Jianxin Chen, Andrew M. Childs, Shih-Han Hung",
        year: "2017",
        url: "https://arxiv.org/abs/1701.03990",
        relevance: "The multivariate half of the same Zoo entry. The authors present and analyze algorithms over GF(q), ℝ and ℂ, report that ⌈(1/(n+1))·(n+d choose d)⌉ and twice that many queries suffice for probability 1 over ℂ and ℝ apart from d = 2 and four other special cases, and that ⌈(d/(n+d))·(n+d choose d)⌉ queries suffice over GF(q) at large field order, giving speedup factors of n+1, (n+1)/2 and (n+d)/d against the classical (n+d choose d). Consult it for the special cases and for the conjecture it leaves open over GF(q).",
        relevanceJa: "同じ Zoo 項目のうち多変数の側を担う論文です。GF(q)、ℝ、ℂ 上のアルゴリズムを提示・解析し、d = 2 とその他四つの特別な場合を除いて、ℂ では ⌈(1/(n+1))·(n+d choose d)⌉ クエリ、ℝ ではその 2 倍のクエリで成功確率 1 が得られること、GF(q) では体の位数が大きい場合に ⌈(d/(n+d))·(n+d choose d)⌉ クエリで足りることを報告し、古典の (n+d choose d) に対してそれぞれ n+1 倍、(n+1)/2 倍、(n+d)/d 倍の高速化になると述べています。例外となる場合や GF(q) 上で未解決のまま残された予想は原論文で確認してください。",
      },
    ],
    relatedSlugs: ["hidden-shift-problem", "bernstein-vazirani-qiskit", "ordered-search"],
  },
  {
    slug: "string-pattern-matching",
    title: "String pattern matching by quantum search and deterministic sampling",
    titleJa: "量子探索と決定的サンプリングによる文字列パターン照合",
    family: "Quantum query algorithm",
    zooName: "Pattern matching",
    zooSection: "Oracular Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given a text T of length n and a pattern P of length m < n, both over a finite alphabet, find an occurrence of P as a substring of T or report that P is not a substring of T. The Zoo also states the problem for d-dimensional arrays rather than strings, where the task is to return the location of P as an m × m × ... × m block within the n × n × ... × n array T or report that no such location exists.",
    problemJa:
      "有限アルファベット上の長さ n のテキスト T と長さ m (< n) のパターン P が与えられたとき、T の部分文字列として P が現れる位置を一つ見つけるか、P が T の部分文字列ではないことを報告する問題です。また Zoo は、文字列ではなく d 次元配列を対象とする形でもこの問題を述べています。その場合は、n × n × ... × n の配列 T の中に P が m × m × ... × m のブロックとして現れる位置を返すか、そのような位置が存在しないことを報告します。",
    idea:
      "Ramesh and Vinay describe an algorithm that combines quantum searching algorithms with a technique from parallel string matching called deterministic sampling, which the Zoo restates as Grover's algorithm used together with that classical method. The Zoo records that the Ω(√N) query lower bound for unstructured search implies a worst-case quantum query complexity of Ω(√n + √m) for this problem, and that a quantum algorithm achieving that bound up to logarithmic factors was obtained in a work it identifies only by a reference number; the Ramesh and Vinay abstract separately states a running time of Õ(√n + √m), a bound of a different kind, so this record does not assert that the two are the same result. Montanaro's later work takes a different route to the average case in d dimensions: the Zoo describes it as generalizing Kuperberg's quantum sieve algorithm for the dihedral hidden subgroup and hidden shift problems so that it operates in d dimensions and accommodates small amounts of noise, after which pattern matching is classically reduced to that noisy d-dimensional hidden shift. The superpolynomial label the Zoo attaches to this entry belongs to that average-case result: the Zoo states that superpolynomial quantum speedup can be achieved on average-case instances provided m is greater than logarithmic in n.",
    ideaJa:
      "Ramesh と Vinay は、量子探索アルゴリズムと、並列文字列照合の技法である決定的サンプリングを組み合わせたアルゴリズムを記述しており、Zoo はこれを Grover のアルゴリズムとその古典的手法の併用として言い換えています。Zoo によれば、非構造化探索に対する Ω(√N) のクエリ下界から、この問題の最悪時の量子クエリ計算量は Ω(√n + √m) となり、この下界を対数因子を除いて達成する量子アルゴリズムが得られていますが、Zoo はその出典を参照番号でしか示していません。Ramesh と Vinay の要旨が述べるのは Õ(√n + √m) の実行時間であり、これは種類の異なる評価であるため、本記録は両者を同一の結果としては扱いません。Montanaro の後年の研究は、d 次元における平均的な場合へ別の道筋で到達しています。Zoo の説明では、二面体隠れ部分群問題および隠れシフト問題に対する Kuperberg の量子ふるいアルゴリズムを、d 次元で動作し少量の雑音を許容するように一般化したうえで、パターン照合をこの雑音を含む d 次元の隠れシフト問題へ古典的に帰着させます。Zoo がこの項目に与えている超多項式的という区分はこの平均的な場合の結果に対するものであり、Zoo は、m が n の対数より大きい場合に平均的な問題例で超多項式的な量子高速化が得られると述べています。",
    complexity:
      "Õ(√n + √m) quantum time to determine whether a pattern of length m occurs in a text of length n, with inverse polynomial failure probability, where Õ allows for logarithmic factors in m and n/m; the Zoo gives Ω(√n + √m) as the worst-case quantum query complexity of the problem, implied by the Ω(√N) lower bound for unstructured search. For the average case in d dimensions, Montanaro's algorithm solves the pattern matching problem for random patterns and texts in time Õ((n/m)^(d/2) 2^(O(d^(3/2) √(log m)))), against Ω̃((n/m)^d + n^(d/2)) for the best possible classical algorithm, a separation Montanaro's abstract calls super-polynomial for large m.",
    complexityBasis:
      'abstract of arXiv:quant-ph/0011049 (TeX rendered as Unicode throughout: tilde O and widetilde O as Õ, widetilde Omega as Ω̃; square-bracket reference numbers dropped from the Zoo quote): "We show how to determine whether a given pattern p of length m occurs in a given text t of length n in Õ(√n+√m) [abstract footnote: Õ allows for logarithmic factors in m and n/m] time, with inverse polynomial failure probability. This algorithm combines quantum searching algorithms with a technique from parallel string matching, called Deterministic Sampling."; Quantum Algorithm Zoo entry "Pattern matching": "The Ω(√N) query lower bound for unstructured search implies that the worst-case quantum query complexity of this problem is Ω(√n + √m). A quantum algorithm achieving this, up to logarithmic factors, was obtained"; abstract of arXiv:1408.1816: "This work describes a quantum algorithm which solves the pattern matching problem for random patterns and texts in time Õ((n/m)^(d/2) 2^(O(d^(3/2)√(log m)))). For large m this is super-polynomially faster than the best possible classical algorithm, which requires time Ω̃((n/m)^d + n^(d/2))."',
    caveat:
      "This is a literature record: no circuit was constructed, compiled, simulated, or run, and no text was searched for any pattern here. The two headline figures are quoted in different currencies and are not converted into one another: the Ramesh and Vinay abstract states Õ(√n + √m) as a running time whose Õ hides logarithmic factors in m and n/m, whereas Ω(√n + √m) is the Zoo's statement about worst-case quantum query complexity, and neither source gives gate counts, qubit counts, constant factors, or the cost of supplying the oracle. The algorithm is not exact: its abstract claims only inverse polynomial failure probability. Montanaro's bound is an average-case result over random patterns and texts, so it establishes nothing about worst-case instances; the Zoo's condition that m be greater than logarithmic in n governs the superpolynomial speedup it reports there, not the running time itself, and the abstract calls the algorithm super-polynomially faster than the best possible classical algorithm only for large m. The constant inside the 2^(O(d^(3/2) √(log m))) factor is not stated. Cost here also depends on the input model: the Zoo reports a separate Õ(√n) string-matching algorithm in a model where the strings are written out in their entirety using n + m qubits rather than through quantum queries to an oracle providing individual bits, and the paper giving it is outside this record.",
    caveatJa:
      "本項目は文献に基づく記録であり、回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、具体的なテキストからパターンを探索したわけでもありません。中心となる二つの数値は単位が異なり、本記録は両者を換算していません。Ramesh と Vinay の要旨が与える Õ(√n + √m) は実行時間で、Õ は m と n/m に関する対数因子を隠しています。一方 Ω(√n + √m) は最悪時の量子クエリ計算量についての Zoo の記述であり、いずれの資料にもゲート数、量子ビット数、定数因子、オラクルを用意するコストは示されていません。このアルゴリズムは厳密ではなく、要旨は失敗確率が逆多項式であるとだけ述べています。Montanaro の評価はランダムなパターンとテキストに対する平均的な場合の結果であり、最悪の問題例については何も示しません。m が n の対数より大きいという Zoo の条件は、そこで報告されている超多項式的な高速化に付く条件であって、実行時間そのものに付く条件ではありません。最良の古典アルゴリズムより超多項式的に速いと要旨が述べているのも、m が大きい場合に限られます。2^(O(d^(3/2) √(log m))) の O の中の定数も示されていません。さらにコストは入力モデルにも依存します。Zoo は、個々のビットを返すオラクルへの量子クエリではなく文字列全体を n + m 量子ビットに書き出すモデルにおいて、Õ(√n) の文字列照合アルゴリズムがあることを別に述べていますが、その論文は本記録の対象外です。",
    tags: ["pattern matching", "string matching", "grover search", "hidden shift", "query complexity"],
    source: {
      id: "arxiv:quant-ph/0011049",
      title: "String Matching in ${\\tilde O}(\\sqrt{n}+\\sqrt{m})$ Quantum Time",
      authors: "H. Ramesh, V. Vinay",
      year: "2000",
      url: "https://arxiv.org/abs/quant-ph/0011049",
    },
    literature: [
      {
        title: "Quantum pattern matching fast on average",
        authors: "Ashley Montanaro",
        year: "2014",
        url: "https://arxiv.org/abs/1408.1816",
        relevance: "The average-case half of the same Zoo entry, in d dimensions: the paper describes a quantum algorithm that solves pattern matching for random patterns and texts in time Õ((n/m)^(d/2) 2^(O(d^(3/2) √(log m)))), which for large m Montanaro states is super-polynomially faster than the best possible classical algorithm, that classical bound being Ω̃((n/m)^d + n^(d/2)). The algorithm is based on a quantum subroutine for finding hidden shifts in d dimensions, described as a variant of algorithms proposed by Kuperberg. Consult it for what counts as a random instance, since the bound is an average-case one.",
        relevanceJa: "同じ Zoo 項目のうち、d 次元での平均的な場合を担う論文です。ランダムなパターンとテキストに対してパターン照合を時間 Õ((n/m)^(d/2) 2^(O(d^(3/2) √(log m)))) で解く量子アルゴリズムを記述しており、m が大きい場合には、時間 Ω̃((n/m)^d + n^(d/2)) を要する最良の古典アルゴリズムより超多項式的に速いと述べています。このアルゴリズムは d 次元で隠れシフトを見つける量子サブルーチンに基づいており、Kuperberg が提案したアルゴリズムの変種と説明されています。評価は平均的な場合のものであるため、何をランダムな問題例とみなすかは原論文で確認してください。",
      },
    ],
    relatedSlugs: ["grover-unstructured-search", "hidden-shift-problem", "amplitude-amplification"],
  },
  {
    slug: "graph-properties-adjacency-matrix",
    title: "Quantum query complexity of graph properties in the adjacency matrix model",
    titleJa: "隣接行列モデルにおけるグラフの性質の量子クエリ計算量",
    family: "Quantum query algorithm",
    zooName: "Graph Properties in the Adjacency Matrix Model",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given access only to an oracle that, for a pair of integers in {1, 2, ..., n}, says whether the corresponding vertices of an n-vertex graph are joined by an edge, decide a property of that graph or find a structure in it, such as connectivity, a minimum spanning tree, a lowest weight path, or a triangle, using as few queries as possible.",
    problemJa:
      "n 頂点のグラフについて、{1, 2, ..., n} の整数の組に対して対応する二頂点が辺で結ばれているかどうかを答えるオラクルだけが与えられたとき、連結性、最小全域木、最小重みの経路、三角形といったグラフの性質や構造を、できるだけ少ないクエリ数で判定または発見する問題です。",
    idea:
      "Durr, Heiligman, Hoyer and Mhalla treat these tasks in two input models, the adjacency matrix model in which the oracle answers about a pair of vertices and an adjacency list-like array model, and they give almost tight lower and upper bounds for the bounded error quantum query complexity of Connectivity, Strong Connectivity, Minimum Spanning Tree and Single Source Shortest Paths. Their abstract states that the upper bounds utilize search procedures for finding minima of functions under various conditions, without naming them; an earlier algorithm of Durr and Hoyer, catalogued here alongside that paper, finds the index of the minimum entry of a table of size N in time O(c√N) with probability at least 1 - 1/2^c. The Zoo places this work inside a wider body of results in the same model: bipartiteness, cycle detection and st-connectivity in Õ(n^(3/2)) queries and quantum gates using only logarithmically many qubits, and Childs and Kothari's Θ(n^(2/3)) for sparse graph properties, sparse meaning that some constant bounds the ratio of edges to vertices for every graph with the property, provided the property cannot be characterized by a list of forbidden subgraphs. Finding a subgraph is treated separately there, the simplest case being the triangle, for which the Zoo reports O(n^(5/4)) quantum queries as the fastest known.",
    ideaJa:
      "Durr、Heiligman、Hoyer、Mhalla は、これらの課題を二つの入力モデルで扱っています。一つは頂点の組について辺の有無を答える隣接行列モデル、もう一つは隣接リストに近い配列モデルです。論文は、Connectivity、Strong Connectivity、Minimum Spanning Tree、Single Source Shortest Paths の有界誤り量子クエリ計算量について、ほぼ厳密な上界と下界を与えています。要旨は、上界がさまざまな条件のもとで関数の最小値を見つける探索手続きを利用すると述べるだけで、その手続きを名指ししてはいません。本記録が同じ項目に併せて収めている Durr と Hoyer の先行アルゴリズムは、大きさ N の表の最小要素の位置を、時間 O(c√N) で確率 1 - 1/2^c 以上で見つけます。Zoo はこの研究を、同じモデルにおけるより広い結果群の中に位置づけています。二部性の判定、閉路の検出、st 連結性は Õ(n^(3/2)) のクエリ数と量子ゲート数、かつ対数個の量子ビットで実現でき、辺と頂点の比がある定数以下に収まるという意味で疎なグラフの性質については、禁止部分グラフの一覧で特徴付けられない限り Childs と Kothari が Θ(n^(2/3)) を示しています。部分グラフの発見は Zoo では別に扱われており、最も簡単な場合である三角形については、知られている中で最速のものとして O(n^(5/4)) の量子クエリが挙げられています。",
    complexity:
      "Θ(n^(3/2)) quantum queries in the adjacency matrix model for Minimum Spanning Tree and for Connectivity, against Θ(√(nm)) and Θ(n) respectively in the array model; the Zoo adds O(n^(3/2) log² n) for finding lowest weight paths, Õ(n^(3/2)) queries and quantum gates for bipartiteness, cycle detection and st-connectivity, Θ(n^(2/3)) for sparse graph properties that cannot be characterized by a list of forbidden subgraphs, and O(n^(5/4)) queries for finding a triangle. On the classical side the Zoo puts every problem it lists ahead of triangle finding at Ω(n²) queries only under the widely-believed Aanderaa-Karp-Rosenberg conjecture, whereas for triangle finding it states Ω(n²) classical queries outright. Durr and Hoyer's minimum-finding algorithm runs in time O(c√N) on a table of size N and returns the index of the minimum with probability at least 1 - 1/2^c.",
    complexityBasis:
      'abstract of arXiv:quant-ph/0401091 (plain-text TeX rendered as Unicode, and widetilde O written as Õ where quoted from the Zoo): "we show that the query complexity of Minimum Spanning Tree is in Θ(n^(3/2)) in the matrix model and in Θ(√(nm)) in the array model, while the complexity of Connectivity is also in Θ(n^(3/2)) in the matrix model, but in Θ(n) in the array model", and "The upper bounds utilize search procedures for finding minima of functions under various conditions."; Quantum Algorithm Zoo entry "Graph Properties in the Adjacency Matrix Model": "finding lowest weight paths has O(n^(3/2) log² n) quantum query complexity", "Deciding whether a graph is bipartite, detecting cycles, and deciding whether a given vertex can be reached from another (st-connectivity) can all be achieved using a number of queries and quantum gates that both scale as Õ(n^(3/2)), and only logarithmically many qubits", "all sparse graph properties have query complexity Θ(n^(2/3)) if they cannot be characterized by a list of forbidden subgraphs and o(n^(2/3)) (little-o) if they can", "The fastest known quantum algorithm for this finds a triangle in O(n^(5/4)) quantum queries", "According to the widely-believed Aanderaa-Karp-Rosenberg conjecture, all of the above problems have Ω(n²) classical query complexity", and "Classically, triangle finding requires Ω(n²) queries"; abstract of arXiv:quant-ph/9607014: "We give a quantum algorithm to find the index y in a table T of size N such that in time O(c sqrt N), T[y] is minimum with probability at least 1-1/2^c."',
    caveat:
      "This is a literature record: no oracle was instantiated, no circuit was compiled, simulated, or run, and no graph was decided here. Every figure above is a count of queries in a black-box model except where stated otherwise, so gate counts, ancilla requirements, the cost of realizing the adjacency oracle, and constant factors all sit outside it; the only gate and qubit statement quoted is the Zoo's own, for bipartiteness, cycle detection and st-connectivity. A bound here means little without its input model, since the primary paper reports Connectivity at Θ(n^(3/2)) in the matrix model but Θ(n) in the array model, and Minimum Spanning Tree at Θ(n^(3/2)) against Θ(√(nm)), where the abstract introduces m without defining it and it is reproduced here unexplained; that paper also describes its bounds as almost tight rather than exact. The classical Ω(n²) side is conditional, because the Zoo attributes it to the widely-believed Aanderaa-Karp-Rosenberg conjecture; the exception is triangle finding, for which the Zoo states the classical Ω(n²) outright. The Õ(n^(3/2)) figure for bipartiteness, cycle detection and st-connectivity, the Θ(n^(2/3)) sparse-property result, the O(n^(5/4)) triangle bound and its classical Ω(n²), the Õ(n) span-program algorithm for detecting tree minors, the general k-vertex subgraph exponent and the O(n^(1.883)) result for sub-hypergraphs of 3-uniform hypergraphs all rest on papers outside this record, cited by the Zoo and not read here. The minimum-finding figure is a running time on a table of size N whose success probability, at least 1 - 1/2^c, is set by c, and the graph paper's abstract does not name which minimum-finding procedure its upper bounds use, so no citation between the two papers is claimed here.",
    caveatJa:
      "本項目は文献に基づく記録であり、オラクルを具体化したことも、回路をコンパイル、シミュレーション、実行したこともなく、具体的なグラフの判定も行っていません。上記の数値は、断りのある箇所を除きすべてブラックボックスモデルでのクエリ数であり、ゲート数、補助量子ビット、隣接オラクルを実現するコスト、定数因子はいずれも対象外です。ゲート数と量子ビット数に触れているのは、二部性の判定、閉路の検出、st 連結性についての Zoo 自身の記述だけです。また、評価は入力モデルを離れてはほとんど意味を持ちません。主論文は Connectivity を隣接行列モデルで Θ(n^(3/2))、配列モデルでは Θ(n) と報告し、Minimum Spanning Tree についても Θ(n^(3/2)) と Θ(√(nm)) を対比しています。この Θ(√(nm)) の m は要旨では定義されておらず、本記録でも説明のないまま引き写しています。また同論文は、これらの上下界を厳密ではなく「ほぼ厳密」と述べています。古典側の Ω(n²) は条件付きで、Zoo はこれを広く信じられている Aanderaa-Karp-Rosenberg 予想に帰しています。例外は三角形の発見で、こちらは古典的に Ω(n²) クエリを要すると Zoo が断定しています。二部性の判定、閉路の検出、st 連結性に対する Õ(n^(3/2))、疎なグラフの性質に対する Θ(n^(2/3))、三角形の O(n^(5/4)) とその古典的な Ω(n²)、木のマイナーを検出する span プログラムに基づく Õ(n)、k 頂点の部分グラフ一般に対する指数、3 一様ハイパーグラフの部分ハイパーグラフに対する O(n^(1.883)) は、いずれも Zoo が引用している本記録の対象外の論文に基づくもので、それらの原論文は参照していません。最小値探索の数値は大きさ N の表に対する実行時間であり、成功確率は c によって決まり、少なくとも 1 - 1/2^c です。グラフの論文の要旨は、上界がどの最小値探索手続きを用いるかを明示していないため、二つの論文の間に引用関係があるとは本記録では主張していません。",
    tags: ["graph properties", "adjacency matrix", "query complexity", "minimum finding", "oracle"],
    source: {
      id: "arxiv:quant-ph/0401091",
      title: "Quantum query complexity of some graph problems",
      authors: "Christoph Durr, Mark Heiligman, Peter Hoyer, Mehdi Mhalla",
      year: "2004",
      url: "https://arxiv.org/abs/quant-ph/0401091",
    },
    literature: [
      {
        title: "A Quantum Algorithm for Finding the Minimum",
        authors: "Christoph Durr, Peter Hoyer",
        year: "1996",
        url: "https://arxiv.org/abs/quant-ph/9607014",
        relevance: "A minimum-finding algorithm, catalogued alongside the graph paper rather than as a component of it. Durr and Hoyer give a quantum algorithm that finds the index y in a table T of size N such that T[y] is minimum, in time O(c√N) and with probability at least 1 - 1/2^c. The graph paper's abstract states that its upper bounds utilize search procedures for finding minima of functions under various conditions; it does not name them, so consult both papers before treating this one as the subroutine used there.",
        relevanceJa: "最小値探索のアルゴリズムを与える論文で、グラフの論文の構成要素としてではなく、それと併せて本項目に収めています。大きさ N の表 T について T[y] が最小となる位置 y を、時間 O(c√N) で確率 1 - 1/2^c 以上で見つける量子アルゴリズムを示しています。グラフの論文の要旨は、上界がさまざまな条件のもとで関数の最小値を見つける探索手続きを利用するとだけ述べており、その手続きを名指ししてはいないため、これをそこで用いられたサブルーチンとみなす前に双方の原論文を確認してください。",
      },
    ],
    relatedSlugs: ["grover-unstructured-search", "element-distinctness", "quantum-walk-line"],
  },
  {
    slug: "counterfeit-coin-problem",
    title: "Counterfeit coin problem by quantum queries",
    titleJa: "量子クエリによる偽コイン問題",
    family: "Quantum query algorithm",
    zooName: "Counterfeit Coins",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given N coins of which exactly k are counterfeit, where the real coins all share one weight and the counterfeit coins all share another, and given a pan balance that can compare the weight of any pair of subsets of the coins but reports only whether they balance or tilt, identify all of the counterfeit coins in as few weighings as possible.",
    problemJa:
      "N枚のコインのうちちょうどk枚が偽コインであり、本物のコインはすべて同じ重さ、偽コインもすべてそれとは別の同じ重さであるとします。コインの任意の2つの部分集合の重さを比較できるものの、釣り合ったか傾いたかだけを報告する天秤が与えられたとき、できるだけ少ない秤量回数ですべての偽コインを特定する問題です。",
    idea:
      "Both sources turn the balance into an oracle. The Zoo introduces one that, given a pair of subsets of the coins of equal cardinality, outputs one bit indicating balanced or unbalanced; the paper says the balance scale gives only balanced or tilted information, and that the query complexity of such an oracle measures the cost of a weighing algorithm, namely the number of weighings. Iwama, Nishimura, Raymond and Teruyama study the quantum query complexity Q(k,N) of finding all k false coins among N given coins, with the number k assumed known in advance, and their abstract contrasts the O(k^(1/4)) bound they obtain with the classical query complexity Ω(k log(N/k)), which it says depends on N. The Zoo describes the core techniques behind the quantum speedup as amplitude amplification and the Bernstein-Vazirani algorithm, and records the construction as building on previous work by Terhal and Smolin. The paper states that it has no matching lower bound, offering instead evidence that its upper bound is tight: any algorithm that satisfies certain properties, the paper's own included, needs Ω(k^(1/4)) queries.",
    ideaJa:
      "いずれの出典も天秤をオラクルとして扱います。Zoo は、枚数の等しい2つの部分集合を受け取って釣り合ったか否かを1ビットで返すオラクルを導入しており、論文は、天秤が釣り合ったか傾いたかの情報のみを与えること、およびそのオラクルのクエリ計算量が秤量アルゴリズムのコスト、すなわち秤量回数を測る尺度になることを述べています。Iwama、Nishimura、Raymond、Teruyama は、偽コインの枚数kが既知であるという前提のもとで、N枚のコインからk枚の偽コインをすべて見つける量子クエリ計算量 Q(k,N) を調べており、その要旨は、得られた上界 O(k^(1/4)) を、Nに依存すると述べる古典クエリ計算量 Ω(k log(N/k)) と対比しています。Zoo は、この高速化の中核をなす技法として振幅増幅と Bernstein-Vazirani アルゴリズムを挙げ、この構成が Terhal と Smolin の先行研究の上に築かれていると記しています。論文は、一致する下界は得られていないと述べたうえで、代わりに、論文自身のものを含め、ある性質を満たす任意のアルゴリズムには Ω(k^(1/4)) クエリが必要であるという、上界が最良であることの証拠を示しています。",
    complexity:
      "Q(k,N) = O(k^(1/4)) quantum queries to the balance oracle for any k and N with k < N/2, where Q(k,N) is the quantum query complexity of finding all k false coins among the N given coins; the classical query complexity is Ω(k log(N/k)), a bound that depends on N, so the paper reports a quartic speed-up. No matching lower bound is given: the paper shows only that any algorithm that satisfies certain properties, its own algorithm included, needs Ω(k^(1/4)) queries.",
    complexityBasis:
      'abstract of arXiv:1009.0416, quoted verbatim except that TeX control sequences are rendered as Unicode while superscripts are left in TeX form: "Let Q(k,N) be the quantum query complexity of finding all k false coins from the N given coins. We show that for any k and N such that k < N/2, Q(k,N)=O(k^{1/4}), contrasting with the classical query complexity, Ω(k log(N/k)), that depends on N. So our quantum algorithm achieves a quartic speed-up for this problem", and, for the absence of a matching lower bound, "We do not have a matching lower bound, but we show some evidence that the upper bound is tight: any algorithm, including our algorithm, that satisfies certain properties needs Ω(k^{1/4}) queries." The Quantum Algorithm Zoo entry "Counterfeit Coins" states the same two figures, quoted here the same way: "Classically, we need Ω(k log(N/k)) weighings to identify all of the counterfeit coins", and, attributing the upper bound to Iwama et al., "on a quantum computer, one can identify all of the counterfeit coins using O(k^{1/4}) queries". Neither source states a constant factor or a gate count.',
    caveat:
      "This is a literature record: no circuit was constructed, compiled, simulated, or run, and no set of coins was weighed. Every figure above is a count of queries to the balance oracle, so gate counts, qubit counts, circuit depth, and the cost of realizing that oracle for an actual pan balance all fall outside it, as do the constant factors hidden by O(·). The upper bound is stated under the condition k < N/2 and assumes the number k of counterfeit coins is known in advance, so it establishes nothing about instances where k is unknown or where k is at least N/2. Optimality is not settled: the paper says it has no matching lower bound, and the Ω(k^(1/4)) evidence it offers is restricted to algorithms satisfying certain properties, which the abstract does not spell out and which this record does not reproduce. The attribution of the speedup to amplitude amplification and the Bernstein-Vazirani algorithm is the Zoo's account of how the construction works, and the earlier Terhal and Smolin result the Zoo credits rests on a paper outside this record.",
    caveatJa:
      "本項目は文献に基づく記録であり、回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、実際にコインを秤量したわけでもありません。上記の数値はすべて天秤オラクルへのクエリ数であるため、ゲート数、量子ビット数、回路深さ、実際の天秤に対してそのオラクルを実装するコストはいずれも対象外であり、O(·) に隠れた定数因子も同様です。上界は k < N/2 という条件のもとでの主張であり、偽コインの枚数kが事前に既知であることを前提としています。したがって、kが未知の場合や k が N/2 以上の場合については何も述べていません。最適性も確定していません。論文自身が一致する下界を持たないと述べており、示されている Ω(k^(1/4)) の証拠も、ある性質を満たすアルゴリズムに限られます。その性質は要旨に明示されておらず、本記録でも再現していません。高速化を振幅増幅と Bernstein-Vazirani アルゴリズムに帰する説明は Zoo による構成の解説であり、Zoo が挙げる Terhal と Smolin の先行結果は本記録の対象外の論文に基づきます。",
    tags: ["counterfeit coins", "query complexity", "oracle", "amplitude amplification", "bernstein-vazirani"],
    source: {
      id: "arxiv:1009.0416",
      title: "Quantum Counterfeit Coin Problems",
      authors: "Kazuo Iwama, Harumichi Nishimura, Rudy Raymond, Junichi Teruyama",
      year: "2010",
      url: "https://arxiv.org/abs/1009.0416",
    },
    literature: [
      {
        title: "Quantum Counterfeit Coin Problems",
        authors: "Kazuo Iwama, Harumichi Nishimura, Rudy Raymond, Junichi Teruyama",
        year: "2010",
        url: "https://arxiv.org/abs/1009.0416",
        relevance:
          "Primary source: it models the balance scale as an oracle giving only balanced or tilted information, takes the number of weighings as the cost measure, and gives the O(k^(1/4)) upper bound on the quantum query complexity Q(k,N) for k < N/2, against the classical Ω(k log(N/k)). Consult it for the properties an algorithm must satisfy for the accompanying Ω(k^(1/4)) tightness evidence to apply.",
        relevanceJa:
          "一次資料です。天秤を、釣り合ったか傾いたかの情報のみを返すオラクルとしてモデル化し、秤量回数をコストの尺度としたうえで、k < N/2 のときの量子クエリ計算量 Q(k,N) に対する上界 O(k^(1/4)) を、古典の Ω(k log(N/k)) と対比して与えています。付随する Ω(k^(1/4)) の最良性の証拠がどのような性質を満たすアルゴリズムに適用されるかは、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "amplitude-amplification",
      "bernstein-vazirani-qiskit",
      "grover-unstructured-search",
      "element-distinctness",
    ],
  },
  {
    slug: "spectral-sum-estimation",
    title: "Estimating log-determinants and other spectral sums",
    titleJa: "対数行列式をはじめとするスペクトル和の推定",
    family: "Quantum linear algebra",
    zooName: "Estimating Determinants and Other Spectral Sums",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Superpolynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given a function f and a positive semi-definite matrix A whose eigenvalues are λⱼ, estimate the spectral sum Tr[f(A)] = Σⱼ f(λⱼ), a family whose typical examples the paper gives as the von Neumann entropy, the trace of A⁻¹, the log-determinant and the Schatten p-norm, the last of which it says does not require the matrix to be positive semi-definite.",
    problemJa:
      "関数fと、固有値をλⱼとする半正定値行列Aが与えられたとき、スペクトル和 Tr[f(A)] = Σⱼ f(λⱼ) を推定する問題です。論文はその典型例として von Neumannエントロピー、A⁻¹のトレース、対数行列式、Schatten p-ノルムを挙げ、このうち Schatten p-ノルムについては行列が半正定値である必要はないと述べています。",
    idea:
      "The Zoo sets out one route. For a 2ⁿ × 2ⁿ Hermitian matrix A with only poly(n) nonzero entries per row, given an oracle for those entries, Hamiltonian simulation approximates the unitary e^(-iAt) with poly(n,t) gates, Kitaev's phase estimation turns such time evolutions into an approximate measurement in the eigenbasis of A, and applying that measurement to the maximally mixed state samples uniformly from the eigenvalues, so a Monte Carlo estimate of a spectral sum can be assembled from those samples; taking f(λ) = log(λ) makes the logarithm of the determinant one such sum. Luongo and Shao propose new quantum algorithms for estimating spectral sums of positive semi-definite matrices, stating their results under the assumption of access to a block-encoding of the matrix; their abstract does not mention the entry oracle the Zoo's route assumes. They state that the resulting algorithms are sub-linear in the matrix size and depend at most quadratically on other parameters such as the condition number and the approximation error, and that this polynomially improves the runtime of other quantum algorithms proposed for the same problems. The paper also shows how the same algorithms and techniques apply to three problems in spectral graph theory: approximating the number of triangles, the effective resistance and the number of spanning trees within a graph.",
    ideaJa:
      "Zoo は一つの道筋を示しています。各行の非零成分が poly(n) 個しかない 2ⁿ × 2ⁿ のエルミート行列Aについて、それらの成分を返すオラクルが与えられれば、Hamiltonian シミュレーションによりユニタリ e^(-iAt) を poly(n,t) 個のゲートで近似でき、Kitaev の位相推定はこうした時間発展をAの固有基底での近似的な測定に変えます。この測定を最大混合状態に対して行うとAの固有値から一様にサンプリングでき、得られたサンプルからスペクトル和の Monte Carlo 推定を組み立てられます。f(λ) = log(λ) と取れば、行列式の対数がこの形のスペクトル和になります。Luongo と Shao は、半正定値行列のスペクトル和を推定する新しい量子アルゴリズムを提案しており、その結果は行列のブロック符号化へのアクセスを仮定したうえで述べられています。要旨には、Zoo の道筋が仮定する成分オラクルへの言及はありません。得られるアルゴリズムは行列のサイズについて劣線形であり、条件数や近似誤差といった他のパラメータへの依存も高々二次であって、同じ問題に対して提案されてきた他の量子アルゴリズムの実行時間を多項式的に改善すると述べられています。論文はさらに、同じアルゴリズムと技法がスペクトルグラフ理論の3つの問題、すなわち三角形の個数、実効抵抗、全域木の個数の近似に適用できることを示しています。",
    complexity:
      "Sub-linear in the matrix size, assuming access to a block-encoding of the matrix, and at most quadratic in other parameters such as the condition number and the approximation error, against what the abstract calls the current best classical randomized algorithms for these quantities, whose runtime it states is at least linear in the number of nonzero entries of the matrix and quadratic in the estimation error; that abstract states no closed-form runtime expression, exponent or constant for the quantum algorithms. The Zoo supplies the surrounding costs for its own route: the unitary e^(-iAt) is approximable by a circuit with only poly(n,t) gates for a 2ⁿ × 2ⁿ Hermitian matrix with poly(n) nonzero entries per row, while computing such a sum classically has worst case computational cost that is exponential in n.",
    complexityBasis:
      'abstract of arXiv:2011.06475: "The current best classical randomized algorithms estimating these quantities have a runtime that is at least linearly in the number of nonzero entries of the matrix and quadratic in the estimation error. Assuming access to a block-encoding of a matrix, our algorithms are sub-linear in the matrix size, and depend at most quadratically on other parameters, like the condition number and the approximation error, and thus can compete with most of the randomized and distributed classical algorithms proposed in the literature, and polynomially improve the runtime of other quantum algorithms proposed for the same problems." That abstract gives no closed-form runtime and names no exponent or constant. The Quantum Algorithm Zoo entry "Estimating Determinants and Other Spectral Sums" supplies the costs quoted for its own route, quoted verbatim except that the source\'s LaTeX is rendered here as plain text, e^{-i A t} written e^(-iAt): "the unitary e^(-iAt) can be approximated by a quantum circuit with only poly( n,t ) gates using standard techniques for Hamiltonian simulation", and "Computing such a sum classically has worst case computational cost that is exponential in n."',
    caveat:
      "This is a literature record. Nothing was constructed, compiled, simulated, run or benchmarked for it, and no spectral sum of any matrix was estimated. The cost statement is qualitative: sub-linear in the matrix size and at most quadratic in the condition number and the approximation error, with no closed-form expression, exponent or constant stated for it in either source, so nothing here fixes the cost for a given matrix, accuracy or success probability. It is also conditional on the input model. The paper assumes access to a block-encoding of the matrix, and the cost of producing that block-encoding is not established here; the Zoo's route instead assumes an oracle for the poly(n) nonzero entries per row of a 2ⁿ × 2ⁿ Hermitian matrix, so the two cost statements are made in different input models and are not directly comparable. The matrices are positive semi-definite, with the Schatten p-norm the stated exception that does not require the matrix to be PSD, and the classical comparison is against the current best classical randomized algorithms rather than a proved separation. The Zoo attaches its superpolynomial classification to the phase-estimation-on-maximally-mixed-states method of two references it cites by number only; this record does not establish that the paper cited here is either of them, and the exposition and analysis the Zoo credits to the second of those numbers rests on a paper outside this record.",
    caveatJa:
      "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行、ベンチマークはいずれも行っておらず、具体的な行列のスペクトル和を推定したこともありません。コストに関する記述は定性的で、行列のサイズについて劣線形、条件数と近似誤差については高々二次というものであり、この主張について閉じた形の式、指数、定数を示した出典はありません。したがって、特定の行列・精度・成功確率に対するコストは本記録からは分かりません。この記述は入力モデルにも依存します。論文は行列のブロック符号化へのアクセスを仮定していますが、そのブロック符号化を用意するコストはここでは確立していません。一方 Zoo の道筋は、各行の非零成分が poly(n) 個である 2ⁿ × 2ⁿ のエルミート行列に対する成分オラクルを仮定しており、両者のコストは異なる入力モデルにおける主張であって直接は比較できません。対象は半正定値行列であり、要旨が明示する例外は行列の半正定値性を必要としない Schatten p-ノルムのみです。古典との比較も、現在知られている最良の古典乱択アルゴリズムに対する比較であって、証明された分離ではありません。Zoo が超多項式的と分類しているのは、最大混合状態に位相推定を適用するこの手法であり、Zoo はその出典を番号でのみ引用しています。本記録は、ここで引用した論文がそのいずれかであることを確認したものではなく、Zoo が2番目の番号に帰している詳しい解説と解析も、本記録の対象外の論文に基づきます。",
    tags: ["spectral sums", "log-determinant", "phase estimation", "block encoding", "trace estimation"],
    source: {
      id: "arxiv:2011.06475",
      title: "Quantum algorithms for spectral sums",
      authors: "Alessandro Luongo, Changpeng Shao",
      year: "2020",
      url: "https://arxiv.org/abs/2011.06475",
    },
    literature: [
      {
        title: "Quantum algorithms for spectral sums",
        authors: "Alessandro Luongo, Changpeng Shao",
        year: "2020",
        url: "https://arxiv.org/abs/2011.06475",
        relevance:
          "Primary source: it defines the spectral sum Tr[f(A)] = Σⱼ f(λⱼ) of a positive semi-definite matrix, names the log-determinant, the von Neumann entropy, the trace of A⁻¹ and the Schatten p-norm as its typical examples, and states the block-encoding input model together with the sub-linear-in-matrix-size, at-most-quadratic-in-condition-number-and-error scaling quoted in the complexity field. It also applies the techniques to approximating the number of triangles, the effective resistance and the number of spanning trees within a graph.",
        relevanceJa:
          "一次資料です。半正定値行列のスペクトル和 Tr[f(A)] = Σⱼ f(λⱼ) を定義し、その典型例として対数行列式、von Neumannエントロピー、A⁻¹のトレース、Schatten p-ノルムを挙げ、ブロック符号化という入力モデルと、計算量欄に引用した「行列サイズについて劣線形、条件数と近似誤差については高々二次」というスケーリングを述べています。さらに、グラフの三角形の個数、実効抵抗、全域木の個数の近似にもこの技法を適用しています。",
      },
    ],
    relatedSlugs: [
      "quantum-phase-estimation",
      "quantum-singular-value-transformation",
      "hhl-linear-systems",
      "hamiltonian-simulation-ising",
    ],
  },
  {
    slug: "matrix-commutativity-testing",
    title: "Commutativity testing of a matrix set by quantum walk",
    titleJa: "量子ウォークによる行列集合の可換性判定",
    family: "Quantum query algorithm",
    zooName: "Matrix Commutativity",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given oracle access to k matrices of size n × n, where a query names a matrix index x together with a pair of indices i, j and returns the ij entry of the x-th matrix, decide whether all k of the matrices commute with one another.",
    problemJa:
      "n × n の行列 k 個へオラクル経由でアクセスでき、行列の番号 x と添字の組 i, j を指定するとその行列の ij 成分が返されるとき、k 個の行列がすべて互いに可換であるかどうかを判定する問題です。",
    idea:
      "The paper uses a theorem of Mario Szegedy that relates the hitting time of a classical random walk to that of a quantum walk, and it also takes a look at Ambainis's method of quantum walk, applying both walks to the triangle finding problem and to the matrix verification problem in order to compare the powers of the two different walks. The abstract reports that Szegedy's algorithm turns out to be generalizable to similar problems and that Szegedy's theorem is therefore the one the paper uses to analyze matrix set commutativity, and it states that the technique behind the upper bound is generalized to a broader range of similar problems. The paper also presents Ambainis's method of lower bounding technique in order to obtain a lower bound for this problem. The abstract records that this is probably the first problem to be studied on the quantum query complexity using quantum walks that involves more than one parameter, here k and n.",
    ideaJa:
      "論文は、古典ランダムウォークのヒッティング時間を量子ウォークのそれと関係づける Mario Szegedy の定理を用い、あわせて Ambainis による量子ウォークの手法も取り上げて、両者を三角形発見問題と行列検証問題に適用することで2つのウォークの能力を比較しています。要旨は、Szegedy のアルゴリズムが類似の問題へ一般化できることが分かったため、行列集合の可換性の解析には Szegedy の定理を用いると述べており、さらに上界を導く際の技法をより広い範囲の類似問題へ一般化したとしています。論文はまた、この問題の下界を得るために Ambainis の下界導出の技法を提示しています。要旨は、量子ウォークを用いて量子クエリ計算量が調べられた問題のうち、k と n という2つのパラメータを含むものはおそらくこれが最初であると述べています。",
    complexity:
      "O(k^(4/5) n^(9/5)) oracle queries to decide whether all k of the n × n matrices commute; the Zoo states that classically the task requires Ω(k n²) queries. The abstract separately states a lower bound of Ω(k^(1/2) n) for the problem, obtained with Ambainis's lower-bounding technique, so the two bounds the abstract gives do not meet.",
    complexityBasis:
      'abstract of arXiv:quant-ph/0509206: "We give an O(k^{4/5}n^{9/5}) algorithm as well as a lower bound of Omega(k^{1/2}n)", with the technique named earlier in the same abstract, "We also present Ambainis\'s method of lower bounding technique (quant-ph/0002066) to obtain a lower bound for this problem"; Quantum Algorithm Zoo entry "Matrix Commutativity" (LaTeX rendered into Unicode): "this can be achieved on a quantum computer using O(k^(4/5)n^(9/5)) queries, whereas classically this requires Ω( k n² ) queries."',
    caveat:
      "This is a literature record: no oracle was instantiated, no circuit was built, compiled, simulated or run, and no set of matrices was tested for commutativity. All three figures above count oracle queries in the black-box model, so gate count, circuit depth, the memory the walk needs in order to hold matrix entries and the constant factors hidden by O(·) and Ω(·) are all outside this record. The paper's upper and lower bounds do not meet — O(k^(4/5) n^(9/5)) against Ω(k^(1/2) n) — so nothing here establishes that the algorithm is optimal, and because both expressions carry two free parameters, which term dominates depends on how k and n are related. The Zoo's Ω(k n²) is the Zoo's own statement about the classical query cost and is a different claim from the paper's Ω(k^(1/2) n); the quoted clause of the abstract does not name the model its lower bound is stated for, attributing only the technique to Ambainis. The generalization the abstract claims to \"a broader range of similar problems\" is not delimited here, and the comparison of Szegedy's walk with Ambainis's on triangle finding and matrix verification is reported, not reproduced.",
    caveatJa:
      "本項目は文献に基づく記録です。オラクルを具体化したことも、回路を構成・コンパイル・シミュレーション・実行したこともなく、実際に行列集合の可換性を判定したわけでもありません。上記の3つの数値はいずれもブラックボックスモデルにおけるオラクルへのクエリ数であり、ゲート数、回路深さ、ウォークが行列成分を保持するために必要な記憶量、O(·) や Ω(·) に隠れた定数因子は、いずれも本項目の対象外です。論文の上界 O(k^(4/5) n^(9/5)) と下界 Ω(k^(1/2) n) は一致しておらず、このアルゴリズムが最適であることは本項目からは言えません。また双方の式が k と n という2つのパラメータを含むため、どちらの項が支配的になるかは両者の関係に依存します。Zoo が挙げる Ω(k n²) は古典クエリ数についての Zoo 自身の記述であり、論文の Ω(k^(1/2) n) とは別の主張です。ここで引用した要旨の一節は、下界がどのモデルに対するものかを明示しておらず、技法が Ambainis によるものであることを述べるにとどまります。要旨のいう「より広い範囲の類似問題」への一般化についても、その範囲は本項目では特定しておらず、三角形発見問題と行列検証問題における2つのウォークの比較も、報告を記録したものであって追試ではありません。",
    tags: ["matrix commutativity", "quantum walk", "query complexity", "oracle", "szegedy quantization"],
    source: {
      id: "arxiv:quant-ph/0509206",
      title: "Quantum Algorithm for Commutativity Testing of a Matrix Set",
      authors: "Yuki Kelly Itakura",
      year: "2005",
      url: "https://arxiv.org/abs/quant-ph/0509206",
    },
    literature: [
      {
        title: "Quantum Algorithm for Commutativity Testing of a Matrix Set",
        authors: "Yuki Kelly Itakura",
        year: "2005",
        url: "https://arxiv.org/abs/quant-ph/0509206",
        relevance:
          "Primary source: it applies Szegedy's theorem relating the hitting time of a classical random walk to that of a quantum walk to the commutativity of a matrix set, states the O(k^(4/5) n^(9/5)) algorithm quoted in the complexity field together with a lower bound of Ω(k^(1/2) n), and compares Szegedy's walk against Ambainis's on the triangle finding and matrix verification problems. Consult it for the walk the upper bound is built on and for which similar problems the generalized technique is claimed to cover.",
        relevanceJa:
          "一次資料です。古典ランダムウォークのヒッティング時間を量子ウォークのそれと結びつける Szegedy の定理を行列集合の可換性判定に適用し、計算量欄に引いた O(k^(4/5) n^(9/5)) のアルゴリズムと下界 Ω(k^(1/2) n) を示すとともに、三角形発見問題と行列検証問題において Szegedy のウォークと Ambainis のウォークを比較しています。上界の基礎となるウォークの構成や、一般化された技法が対象とする類似問題の範囲は原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "matrix-product-verification",
      "element-distinctness",
      "quantum-walk-line",
      "graph-properties-adjacency-matrix",
    ],
  },
  {
    slug: "group-commutativity-testing",
    title: "Testing commutativity of a black-box group",
    titleJa: "ブラックボックス群の可換性判定",
    family: "Quantum query algorithm",
    zooName: "Group Commutativity",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given a list of k generators for a group G together with black-box access to group multiplication, decide whether G is commutative using as few queries to that black box as possible.",
    problemJa:
      "群 G の生成元 k 個の一覧と、群の乗法を実行するブラックボックスへのアクセスが与えられたとき、そのブラックボックスへのクエリ数をできるだけ少なくして、G が可換であるかどうかを判定する問題です。",
    idea:
      "The paper considers the commutativity of a black-box group specified by its k generators, a problem whose complexity in terms of k was first considered by Pak, whose randomized algorithm involves O(k) group operations. Magniez and Nayak construct a quantum algorithm for this problem whose complexity is in O(k^(2/3)), and the paper states that the algorithm uses and highlights the power of the quantization method of Szegedy. For the lower bound of Ω(k^(2/3)) the paper gives a reduction from a special case of Element Distinctness to the commutativity problem, and it describes its own construction, in the abstract's own wording, as a quite optimal one. The authors also report that along the way they prove the optimality of Pak's algorithm for the randomized model, while the Zoo describes Pak's O(k) algorithm as the best known classical one.",
    ideaJa:
      "論文が扱うのは、k 個の生成元で指定されるブラックボックス群の可換性であり、k に関するこの問題の計算量を最初に検討したのは Pak で、その乱択アルゴリズムは O(k) 回の群演算を要します。Magniez と Nayak は、計算量が O(k^(2/3)) に収まる量子アルゴリズムを構成しており、論文はこのアルゴリズムが Szegedy の量子化手法の威力を活用し、かつそれを際立たせるものであると述べています。下界 Ω(k^(2/3)) については、要素相異性問題の特別な場合から可換性判定問題への帰着が与えられており、論文は自らの構成を、要旨自身の表現によれば「ほぼ最適」なものと述べています。著者らはさらに、その過程で Pak のアルゴリズムが乱択モデルにおいて最適であることを証明したと報告しており、Zoo は Pak の O(k) のアルゴリズムを既知の古典アルゴリズムのうち最良のものとしています。",
    complexity:
      "O(k^(2/3)) for a black-box group given by k generators, with a lower bound of Ω(k^(2/3)) obtained by reduction from a special case of Element Distinctness; the Zoo records the resulting quantum query complexity as Θ̃(k^(2/3)). The classical baseline is Pak's randomized algorithm involving O(k) group operations, which the same paper states it proves optimal for the randomized model.",
    complexityBasis:
      'abstract of arXiv:quant-ph/0506265, quoted as it is written there: "We construct a quite optimal quantum algorithm for this problem whose complexity is in O (k^{2/3})", "For the lower bound of Omega(k^{2/3}), we give a reduction from a special case of Element Distinctness to our problem", and, for the classical side, "who gave a randomized algorithm involving O(k) group operations" together with "we prove the optimality of the algorithm of Pak for the randomized model"; Quantum Algorithm Zoo entry "Group Commutativity" (LaTeX rendered into Unicode): "Magniez and Nayak have shown that the quantum query complexity of this task is Θ̃(k^(2/3))". The Zoo\'s tilde absorbs logarithmic factors that the abstract\'s "O (k^{2/3})" does not display.',
    caveat:
      "This is a literature record: no group was represented, no multiplication black box was implemented, and no circuit was built, compiled, simulated or run. The counts are queries to that black box — group operations — so they bound neither gate count nor circuit depth, and the cost of realizing group multiplication for a concrete G on hardware is outside this record. The two sources state the bound in two notations that are not identical: the Zoo writes Θ̃(k^(2/3)), whose tilde absorbs logarithmic factors, while the abstract's clause carries no tilde and calls the algorithm quite optimal rather than optimal; this record does not resolve the gap those two hedges leave. Everything above is measured in k, the number of generators supplied, and not in the order of G or the length of its element encodings, so nothing here bounds cost as a function of group size. The Ω(k^(2/3)) lower bound is recorded as the paper's, by reduction from a special case of Element Distinctness that is not characterized here, and the proof of optimality for Pak's randomized algorithm is likewise reported rather than re-derived.",
    caveatJa:
      "本項目は文献に基づく記録です。群を具体的に表現したことも、乗法のブラックボックスを実装したことも、回路を構成・コンパイル・シミュレーション・実行したこともありません。数えているのはそのブラックボックスへのクエリ数、すなわち群演算の回数であり、ゲート数も回路深さも押さえるものではなく、具体的な G について群の乗法を実機で実現するコストも本項目の対象外です。2つの出典が示す評価の表記は同一ではありません。Zoo は対数因子を吸収するチルダを付して Θ̃(k^(2/3)) と書くのに対し、要旨の該当箇所にはチルダがなく、アルゴリズムを「最適」ではなく「ほぼ最適」と表現しています。この2つの留保が残す差を本項目で埋めてはいません。上記の量はいずれも与えられる生成元の個数 k で測られており、G の位数や元の符号化長で測られてはいないため、群の大きさに対するコストについては何も述べていません。下界 Ω(k^(2/3)) は論文の主張として記録したものであり、帰着に用いられる要素相異性問題の特別な場合の内容は本項目では特定していません。Pak の乱択アルゴリズムの最適性の証明も同様に、報告を記録したものであって再導出ではありません。",
    tags: ["group commutativity", "black-box group", "element distinctness", "query complexity", "szegedy quantization"],
    source: {
      id: "arxiv:quant-ph/0506265",
      title: "Quantum Complexity of Testing Group Commutativity",
      authors: "Frederic Magniez, Ashwin Nayak",
      year: "2005",
      url: "https://arxiv.org/abs/quant-ph/0506265",
    },
    literature: [
      {
        title: "Quantum Complexity of Testing Group Commutativity",
        authors: "Frederic Magniez, Ashwin Nayak",
        year: "2005",
        url: "https://arxiv.org/abs/quant-ph/0506265",
        relevance:
          "Primary source: it constructs the quantum algorithm whose complexity is in O(k^(2/3)) for a black-box group given by k generators, credits the construction to the quantization method of Szegedy, derives the Ω(k^(2/3)) lower bound by reduction from a special case of Element Distinctness, and reports a proof that Pak's O(k) randomized algorithm is optimal for the randomized model. Consult it for the black-box group model it assumes and for the special case of Element Distinctness the reduction uses.",
        relevanceJa:
          "一次資料です。k 個の生成元で与えられるブラックボックス群に対し計算量が O(k^(2/3)) に収まる量子アルゴリズムを構成し、その構成を Szegedy の量子化手法によるものとしたうえで、要素相異性問題の特別な場合からの帰着により下界 Ω(k^(2/3)) を導き、さらに Pak の O(k) の乱択アルゴリズムが乱択モデルで最適であることの証明を報告しています。前提となるブラックボックス群のモデルや、帰着に用いる要素相異性問題の特別な場合は原論文で確認してください。",
      },
    ],
    relatedSlugs: ["element-distinctness", "quantum-walk-line", "quantum-simulated-annealing"],
  },
  {
    slug: "hidden-nonlinear-structures",
    title: "Hidden nonlinear structures over finite fields",
    titleJa: "有限体上の隠れた非線形構造",
    family: "Quantum query algorithm",
    zooName: "Hidden Nonlinear Structures",
    zooSection: "Oracular Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given oracle access to a hidden subset over a finite field that is not a lattice, that is, a hidden nonlinear structure, identify that subset.",
    problemJa:
      "有限体上の、格子ではない隠れた部分集合、すなわち隠れた非線形構造が与えられ、それにオラクル経由でアクセスできるとき、その部分集合を同定する問題です。",
    idea:
      "The Zoo pictures an Abelian group as a lattice, a subgroup as a sublattice and the cosets of that subgroup as the shifts of the sublattice, and records that the Abelian hidden subgroup problem is then normally solved by obtaining a superposition over a random coset of the hidden subgroup and taking the Fourier transform, so as to sample from the dual lattice. Rather than generalizing that picture to non-Abelian groups, Childs, Schulman and Vazirani suggest an alternative generalization, to hidden subsets that are not lattices at all, which the paper calls hidden nonlinear structures over finite fields. The paper gives examples of two such problems that it states can be solved efficiently by a quantum computer but not by a classical computer, and it also gives some positive results on the quantum query complexity of finding hidden nonlinear structures. The Zoo records that, as shown by Childs et al., this problem is efficiently solvable on quantum computers for certain subsets defined by polynomials, such as spheres, and that Decker et al. showed how to efficiently solve some related problems.",
    ideaJa:
      "Zoo は可換群を格子として、部分群をその部分格子として、部分群の剰余類を部分格子の平行移動として描き、可換な隠れ部分群問題は通常、隠れ部分群のランダムな剰余類上の重ね合わせを得たうえで Fourier 変換を施し、双対格子からサンプリングすることで解かれると記しています。Childs、Schulman、Vazirani は、この描像を非可換群へ一般化するのではなく、そもそも格子ではない隠れた部分集合へ一般化する方向を代替案として提案しており、これを有限体上の隠れた非線形構造と呼んでいます。論文は、量子計算機では効率的に解けるが古典計算機では解けないと述べる例を 2 つ挙げ、さらに隠れた非線形構造を見つける問題の量子クエリ計算量について肯定的な結果を与えています。Zoo は、Childs らが示したとおり、この問題が球面のような多項式で定義される特定の部分集合については量子計算機で効率的に解けること、および Decker らが関連するいくつかの問題を効率的に解く方法を示したことを記しています。",
    complexity: "",
    complexityBasis:
      'Two sources were read and neither states a bound. The Quantum Algorithm Zoo entry "Hidden Nonlinear Structures" says only that "this problem is efficiently solvable on quantum computers for certain subsets defined by polynomials, such as spheres", with no query count and no running time. The abstract of arXiv:0705.2784 likewise quotes no figure: "We give examples of two such problems that can be solved efficiently by a quantum computer, but not by a classical computer. We also give some positive results on the quantum query complexity of finding hidden nonlinear structures." Since neither source states an exponent, a constant, a query count or a gate count, the complexity field is left empty rather than filled from elsewhere.',
    caveat:
      "This is a literature record: nothing was constructed, compiled, simulated or run here, and no hidden subset was identified. Neither source states a query count, a running time, a gate count or a qubit count, so the record fixes no cost for any instance and supports no claim about problem sizes or hardware feasibility; the word efficiently is doing all the work in both sources and is left unquantified in each. Efficient solution is stated for two example problems and, in the Zoo, for certain subsets defined by polynomials such as spheres, not for hidden nonlinear structures in general. The separation from classical computation is the paper's own claim as reported here, not a bound re-derived in this record, and the positive results on quantum query complexity that the abstract mentions are not itemized by either source. The related problems the Zoo attributes to Decker et al. rest on papers outside this record, as does the cost of building the oracle for any concrete polynomial subset.",
    caveatJa:
      "本項目は文献に基づく記録であり、ここで回路の構成、コンパイル、シミュレーション、実行を行ったことはなく、隠れた部分集合を実際に同定したわけでもありません。いずれの資料もクエリ数、実行時間、ゲート数、量子ビット数を示していないため、具体的な問題例に対するコストは確定しておらず、扱える問題規模やハードウェア上の実現可能性についても何も言えません。両資料とも「効率的」という語が主張の中心にありますが、その定量的な内容は示されていません。効率的に解けるとされているのは 2 つの例題、および Zoo の記述では球面のような多項式で定義される特定の部分集合についてであって、隠れた非線形構造一般についてではありません。古典計算との差は論文自身の主張をそのまま記録したものであり、本記録で導出し直したものではありません。要旨が言及する量子クエリ計算量に関する肯定的な結果も、いずれの資料にも個別の内容は示されていません。Zoo が Decker らに帰する関連問題は本記録の対象外の論文に基づいており、具体的な多項式部分集合に対するオラクルの実装コストも同様です。",
    tags: ["hidden nonlinear structures", "oracle", "finite fields", "query complexity", "hidden subgroup"],
    source: {
      id: "arxiv:0705.2784",
      title: "Quantum algorithms for hidden nonlinear structures",
      authors: "Andrew M. Childs, Leonard J. Schulman, Umesh V. Vazirani",
      year: "2007",
      url: "https://arxiv.org/abs/0705.2784",
    },
    literature: [
      {
        title: "Quantum algorithms for hidden nonlinear structures",
        authors: "Andrew M. Childs, Leonard J. Schulman, Umesh V. Vazirani",
        year: "2007",
        url: "https://arxiv.org/abs/0705.2784",
        relevance:
          "Primary source: it proposes finding hidden nonlinear structures over finite fields as an alternative to the nonabelian hidden subgroup problem, gives two such problems it states are solvable efficiently by a quantum computer but not classically, and reports positive results on the quantum query complexity of the task. Consult it for the two example problems and for the query complexity results themselves, since the abstract names neither.",
        relevanceJa:
          "一次資料です。非可換な隠れ部分群問題に代わる方向として、有限体上の隠れた非線形構造を見つける問題を提案し、量子計算機では効率的に解けるが古典計算機では解けないとする問題を 2 つ示したうえで、その量子クエリ計算量について肯定的な結果を報告しています。2 つの例題の内容も、量子クエリ計算量の結果そのものも要旨には示されていないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["hidden-shift-problem", "quantum-fourier-transform", "discrete-logarithm", "shor-period-finding"],
  },
  {
    slug: "matrix-rank-span-program",
    title: "Matrix rank by a span program",
    titleJa: "spanプログラムによる行列の階数問題",
    family: "Quantum query algorithm",
    zooName: "Matrix Rank",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given oracle access to the integer entries of an n×m matrix A, determine the rank of A.",
    problemJa:
      "n×m の整数行列 A の各成分へオラクル経由でアクセスできるとき、その行列の階数を求める問題です。",
    idea:
      "Belovs' paper opens from the statement that span programs have recently been shown to be equivalent to quantum query algorithms, calls it an open problem whether that equivalence can be used to come up with new quantum algorithms, and addresses that problem by providing span programs for some linear algebra problems. It develops a notion of a high level span program, which abstracts away the loading of input vectors into a span program, and gives such a high level span program for the rank problem. Its closing section reduces a high level span program to an ordinary span program, which known quantum query algorithms can then evaluate. The Zoo describes the result as an algorithm that can use fewer queries than the classical order-nm cost given a promise that the rank of the matrix is at least r, with the count depending on the r largest singular values of A and on how sparse A is.",
    ideaJa:
      "Belovs の論文は、spanプログラムと量子クエリアルゴリズムが等価であることが近年示されたという記述から出発し、この等価性を新しい量子アルゴリズムの構成に活用できるかは未解決の問題であるとしたうえで、いくつかの線形代数の問題に対するspanプログラムを与えることでこの問題に取り組んでいます。論文は、入力ベクトルをspanプログラムへ読み込む部分を抽象化した高水準spanプログラムという概念を導入し、階数問題に対する高水準spanプログラムを与えています。最後の節では、高水準spanプログラムを通常のspanプログラムへ還元しており、こちらは既知の量子クエリアルゴリズムで評価できます。Zoo は、こうして得られる結果を、階数が r 以上であるという約束のもとで古典側の nm のオーダーより少ないクエリ数で済むアルゴリズムとして紹介しており、そのクエリ数は A の大きいほうから r 個の特異値と A の疎性に依存します。",
    complexity:
      "O(√(r(n-r+1)) L T) queries to the entries of an n×m integer matrix A under a promise that the rank of A is at least r, where L is the root-mean-square of the reciprocals of the r largest singular values of A and T is a factor set by the sparsity of A: T = O(√(nm)) for general A, and T = O(k log(n+m)) when A has at most k nonzero entries in any row or column. The Zoo gives the classical cost as order nm queries. Every figure here is the Zoo's; the paper's own abstract states no query count.",
    complexityBasis:
      'Quantum Algorithm Zoo entry "Matrix Rank" (LaTeX rendered into Unicode): "Belovs\' algorithm uses O(√(r(n-r+1))LT) queries, where L is the root-mean-square of the reciprocals of the r largest singular values of A and T is a factor that depends on the sparsity of the matrix. For general A , T = O(√(nm)) . If A has at most k nonzero entries in any row or column then T = O(k log(n+m))"; the classical side and the problem statement are from the same entry: "Suppose we are given oracle access to the (integer) entries of an n × m matrix A . We wish to determine the rank of the matrix. Classically this requires order nm queries." The abstract of arXiv:1103.0842 quotes no query count, gate count or runtime anywhere; it describes the construction only, closing "The last section of the paper deals with reducing a high level span program to an ordinary span program that can be solved using known quantum query algorithms." The bound above therefore rests on the Zoo entry alone, not on the primary paper\'s abstract.',
    caveat:
      "This is a literature record: no circuit was constructed, compiled, simulated or run, and no matrix instance was solved. The query count above is the Zoo's summary of Belovs' result, and the paper's abstract states no bound at all, so nothing here was checked against the paper's own analysis. The count is stated under a promise that the rank is at least r, and it carries two instance-dependent factors that are not known in advance: L is the root-mean-square of the reciprocals of the r largest singular values of A, so on that definition a matrix whose r largest singular values are small gives a larger L and a larger count, and T is set by the sparsity of A. The Zoo is explicit that the k-sparse figure T = O(k log(n+m)) requires a stronger oracle than the entry access in which the problem is posed, one that takes a column index as input and returns a list of the nonzero elements of that column. Everything is counted in queries, so gate counts, circuit depth, the arithmetic on the integer entries and the cost of realising either oracle are outside this record. For the special case of deciding whether a square matrix is singular, the determinant problem, the Zoo reports on a paper outside this record that for general A the quantum query complexity is no lower than the classical one, while noting that this does not rule out a speedup under a promise such as sparseness or the absence of small singular values.",
    caveatJa:
      "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、具体的な行列を解いたわけでもありません。上記のクエリ数は Zoo が Belovs の結果をまとめたものであり、論文の要旨自体は計算量を一切述べていないため、論文の解析と突き合わせた確認はここでは行っていません。この評価は階数が r 以上であるという約束のもとで述べられており、さらに事前には分からない二つの量に依存します。L は A の大きいほうから r 個の特異値の逆数の二乗平均平方根であり、この定義に従えば、大きいほうから r 個の特異値が小さい行列ほど L は大きくなり、クエリ数も増えます。T は A の疎性で決まります。また Zoo は、k 疎の場合の T = O(k log(n+m)) を得るには、問題設定にある成分アクセスのオラクルより強いオラクル、すなわち列の添字を入力として受け取り、その列の非零成分の一覧を返すオラクルが必要だと明記しています。数えているのはクエリ数のみであり、ゲート数、回路深さ、整数成分に対する算術、いずれのオラクルを実装するコストも対象外です。正方行列が特異かどうかを判定する特別な場合、すなわち行列式の問題については、一般の A に対する量子クエリ計算量は古典のそれを下回らないと Zoo が本記録の対象外の論文を引いて報告しており、同時に、疎であることや小さい特異値を持たないことといった約束のもとでの高速化までは否定されていないと述べています。",
    tags: ["matrix rank", "span program", "query complexity", "oracle", "linear algebra"],
    source: {
      id: "arxiv:1103.0842",
      title: "Span-program-based quantum algorithm for the rank problem",
      authors: "Aleksandrs Belovs",
      year: "2011",
      url: "https://arxiv.org/abs/1103.0842",
    },
    literature: [
      {
        title: "Span-program-based quantum algorithm for the rank problem",
        authors: "Aleksandrs Belovs",
        year: "2011",
        url: "https://arxiv.org/abs/1103.0842",
        relevance:
          "Primary source. It provides span programs for some linear algebra problems, develops the notion of a high level span program that abstracts from loading input vectors into a span program, gives a high level span program for the rank problem, and reduces it to an ordinary span program solvable by known quantum query algorithms. The abstract states no query count, so the cost claim recorded here comes from the Zoo entry rather than from this paper; consult the paper itself for the analysis behind it.",
        relevanceJa:
          "一次資料です。いくつかの線形代数の問題に対するspanプログラムを与え、入力ベクトルの読み込みを抽象化した高水準spanプログラムという概念を導入し、階数問題に対する高水準spanプログラムを示したうえで、既知の量子クエリアルゴリズムで解ける通常のspanプログラムへ還元しています。要旨に計算量の記載はないため、計算量欄の主張は本論文ではなく Zoo の項目に由来します。その根拠となる解析は原論文で確認してください。",
      },
      {
        title:
          "Span programs and quantum query complexity: The general adversary bound is nearly tight for every boolean function",
        authors: "Ben W. Reichardt",
        year: "2009",
        url: "https://arxiv.org/abs/0904.2759",
        relevance:
          "Companion source for the equivalence the primary paper opens from. Belovs' abstract states that span programs have recently been shown to be equivalent to quantum query algorithms without naming a source for it, and this paper states that equivalence as a result of its own. It turns the general adversary bound, a semi-definite program that lower-bounds quantum query complexity, into an upper bound: one SDP outputs for any boolean function a span program of optimal witness size, that optimal witness size is shown to coincide with the general adversary bound, and a quantum algorithm evaluates span programs with only a logarithmic query overhead on the witness size. The paper states the resulting universality in both directions, that a good quantum query algorithm for a problem implies a good span program and vice versa, and it reports a corollary of an optimal quantum algorithm for evaluating balanced formulas over any finite boolean gate set.",
        relevanceJa:
          "一次資料が出発点とする等価性に対応する関連資料です。Belovs の要旨は、spanプログラムと量子クエリアルゴリズムが等価であることが近年示されたと述べるだけで出典を挙げていませんが、本論文はこの等価性を自らの結果として述べています。量子クエリ計算量の下界を与える半正定値計画である一般敵対者限界を上界へ転じており、まず一つの半正定値計画が任意のブール関数に対して最適な証拠サイズを持つspanプログラムを出力し、その最適な証拠サイズが一般敵対者限界と一致することを示したうえで、証拠サイズに対して対数のクエリオーバーヘッドだけでspanプログラムを評価する量子アルゴリズムを与えています。論文はこの結果を双方向の普遍性として述べており、ある問題に対する良い量子クエリアルゴリズムは良いspanプログラムを含意し、その逆も成り立つとしています。また系として、任意の有限ブールゲート集合上の均衡な式を評価する最適な量子アルゴリズムが得られると報告しています。",
      },
    ],
    relatedSlugs: ["matrix-product-verification", "nand-tree-evaluation", "graph-properties-adjacency-matrix"],
  },
  {
    slug: "search-with-wildcards",
    title: "Search with wildcards",
    titleJa: "ワイルドカード付き探索",
    family: "Quantum query algorithm",
    zooName: "Search with Wildcards",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Identify a hidden n-bit string x using an oracle that, for a chosen subset S of the n positions and a string y of length |S|, returns one when the substring of x specified by S equals y and zero otherwise.",
    problemJa:
      "隠された n ビット文字列 x を、n 個の位置のうち選んだ部分集合 S と長さ |S| の文字列 y に対して、S が指定する x の部分文字列が y と一致するとき 1 を、そうでないとき 0 を返すオラクルへの問い合わせだけから同定する問題です。",
    idea:
      "Each query tests a partial guess: the chosen positions S carry the guessed bits y, the positions left out of S are left unconstrained, and the query is answered yes only when the guess is right on every position it commits to. Ambainis and Montanaro describe an algorithm for recovering x that rests neither on amplitude amplification nor on a quantum walk, but ultimately on the solution to a state discrimination problem; the Zoo names the measurement it uses as the Pretty Good Measurement. The same paper gives a separate and, in its own description, simple quantum algorithm for combinatorial group testing, the task of identifying at most k special items among n when each query asks whether a chosen subset contains any special item.",
    ideaJa:
      "各クエリは部分的な推測を検査するものです。選んだ位置の集合 S に推測したビット列 y を置き、S に含めなかった位置には何も課さないため、1 回のクエリに肯定が返るのは、確定させた位置すべてで推測が正しい場合に限られます。Ambainis と Montanaro は、x を復元するアルゴリズムを与えていますが、それは振幅増幅にも量子ウォークにも依拠せず、最終的には状態識別問題の解に基づいています。Zoo は、そこで用いられる測定を Pretty Good Measurement と呼んでいます。同じ論文は、組合せ的グループテスト、すなわち各クエリで選んだ部分集合が特別な要素を含むかどうかを尋ねながら、n 個の中から高々 k 個の特別な要素を同定する課題に対しても、著者ら自身が単純と述べる別の量子アルゴリズムを与えています。",
    complexity:
      "O(√n log n) quantum queries to recover the hidden n-bit string, against the classical lower bound of Ω(n) queries. The Zoo states the problem's quantum query complexity as Θ(√n) and its classical query complexity as Θ(n); the paper's abstract claims only the upper bound and calls its algorithm nearly optimal, so the Zoo's Θ(√n) is the stronger of the two statements and both are recorded rather than reconciled. For combinatorial group testing, the second problem in the same paper, O(k log k) queries against the classical lower bound of Ω(k log(n/k)) queries, where n counts the items in the set and k bounds the special items among them rather than the bits of the hidden string above.",
    complexityBasis:
      'abstract of arXiv:1210.1148: "We give a nearly optimal O(sqrt(n) log n) quantum query algorithm for search with wildcards, beating the classical lower bound of Omega(n) queries", and, for the second problem, "We give a simple quantum algorithm which uses O(k log k) queries to solve this problem, as compared with the classical lower bound of Omega(k log(n/k)) queries". The tight figures are from the Quantum Algorithm Zoo entry "Search with Wildcards" (LaTeX rendered into Unicode, spacing inside the reference bracket normalized): "Classically, this problem has query complexity Θ(n). As shown in [167], the quantum query complexity of this problem is Θ(√n)." The Zoo asserts a tight Θ(√n) where the abstract quoted above states only the upper bound O(sqrt(n) log n); this record carries both and settles neither.',
    caveat:
      "This is a literature record: no circuit was constructed, compiled, simulated or run, and no hidden string was recovered here. The two sources do not agree on the tightness of the quantum bound, the abstract giving O(√n log n) as nearly optimal and the Zoo giving Θ(√n), and this record reports the disagreement rather than resolving it. Everything above is a query count in the oracle model, so gate counts, circuit depth, the number of bits a query carries and the cost of realising the wildcard oracle on hardware are outside it, as are the constant factors hidden by O(·). The attribution of the measurement to the Pretty Good Measurement is the Zoo's wording; the abstract says only that the algorithm is ultimately based on the solution to a state discrimination problem. The classical Ω(n) is quoted from the abstract as a lower bound, which is a stronger kind of claim than a comparison against the best algorithm currently known, but this record re-derives neither it nor the quantum bounds. The group-testing result is the paper's second problem and is not the subject of this Zoo entry; the Zoo places it, together with later and faster quantum algorithms for group testing that rest on papers outside this record, under its Junta Testing and Group Testing entry.",
    caveatJa:
      "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、ここで隠された文字列を復元したわけでもありません。量子側の評価が緊密かどうかについて二つの資料は一致しておらず、要旨は O(√n log n) をほぼ最適と述べ、Zoo は Θ(√n) としています。本記録はこの相違を解消せず、そのまま記載しています。上記はいずれもオラクルモデルにおけるクエリ数であり、ゲート数、回路深さ、1 回のクエリが運ぶビット数、ワイルドカード付きのオラクルを実機で実現するコスト、および O(·) に隠れた定数因子は対象外です。測定を Pretty Good Measurement とする言い方は Zoo によるものであり、要旨は、アルゴリズムが最終的に状態識別問題の解に基づくとしか述べていません。古典側の Ω(n) は要旨から引いた下界であり、現在知られている最良のアルゴリズムとの比較よりも強い種類の主張ですが、本記録ではこれも量子側の評価も導出し直してはいません。グループテストの結果は同じ論文の二つ目の問題であって、この Zoo 項目の主題ではありません。Zoo はこれを、本記録の対象外の論文による後年のより高速な量子アルゴリズムとあわせて、Junta Testing and Group Testing の項目に置いています。",
    tags: ["search with wildcards", "query complexity", "oracle", "state discrimination", "group testing"],
    source: {
      id: "arxiv:1210.1148",
      title: "Quantum algorithms for search with wildcards and combinatorial group testing",
      authors: "Andris Ambainis, Ashley Montanaro",
      year: "2012",
      url: "https://arxiv.org/abs/1210.1148",
    },
    literature: [
      {
        title: "Quantum algorithms for search with wildcards and combinatorial group testing",
        authors: "Andris Ambainis, Ashley Montanaro",
        year: "2012",
        url: "https://arxiv.org/abs/1210.1148",
        relevance:
          "Primary source and the origin of the upper bounds in the cost claim: the O(√n log n) query algorithm for search with wildcards, described as nearly optimal and as beating the classical lower bound of Ω(n) queries, and the O(k log k) query algorithm for combinatorial group testing against the classical lower bound of Ω(k log(n/k)) queries. The abstract also records what the algorithm is not built from, stating that rather than using amplitude amplification or a quantum walk it is ultimately based on the solution to a state discrimination problem.",
        relevanceJa:
          "一次資料であり、計算量欄の上界はここに由来します。ワイルドカード付き探索に対する O(√n log n) クエリのアルゴリズムはほぼ最適であり、古典側の下界 Ω(n) クエリを下回ると述べられています。組合せ的グループテストについては、古典側の下界 Ω(k log(n/k)) クエリに対し O(k log k) クエリのアルゴリズムが示されています。要旨は、このアルゴリズムが何に基づいていないかも記しており、振幅増幅や量子ウォークではなく、最終的には状態識別問題の解に基づくと述べています。",
      },
    ],
    relatedSlugs: [
      "bernstein-vazirani-qiskit",
      "grover-unstructured-search",
      "string-pattern-matching",
      "counterfeit-coin-problem",
    ],
  },
  {
    slug: "hypercube-dynamic-programming",
    title: "Quantum dynamic programming for path in the hypercube",
    titleJa: "超立方体上の路問題に対する量子動的計画法",
    family: "Quantum query algorithm",
    zooName: "Quantum Dynamic Programming for path-in-the-hypercube",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given a subgraph of the Boolean hypercube on bit strings of length n, whose edges all run from smaller to larger Hamming weight, decide whether it contains a path from the all-zeros vertex 0^n to the all-ones vertex 1^n.",
    problemJa:
      "長さ n のビット列を頂点とするブール超立方体の部分グラフで、辺がすべて Hamming 重みの小さい側から大きい側へ向いているものが与えられたとき、全 0 の頂点 0^n から全 1 の頂点 1^n への路が存在するかどうかを判定する問題です。",
    idea:
      "Ambainis, Balodis, Iraids, Kokainis, Prūsis and Vihrovs introduce the path in the hypercube problem, which the paper states models many of the NP-complete problems whose best classical algorithm is an exponential-time application of dynamic programming, and the Zoo likewise records that many such problems can be modelled as instances of it. The technique the paper describes combines Grover's search with computing a partial dynamic programming table, and the bound it reports for that technique, O*(1.817^n), has a smaller base than the O*(2^n) the Zoo gives for the fastest known classical algorithm. The same approach is then applied to a variety of vertex ordering problems on graphs and to graph bandwidth, and similar ideas to the travelling salesman problem and minimum set cover. The Zoo adds the reading of the graph itself, that the vertices of the hypercube graph correspond to bit strings of length n and that the graph joins vertices of Hamming distance one, and it lists feedback arc set alongside the travelling salesman problem among the problems this primitive is applied to.",
    ideaJa:
      "Ambainis、Balodis、Iraids、Kokainis、Prūsis、Vihrovs は超立方体上の路問題を導入しており、論文はこの問題が、最良の古典アルゴリズムが指数時間の動的計画法となる NP 完全問題の多くをモデル化すると述べています。Zoo も同様に、そうした問題の多くがこの問題の事例としてモデル化できると記しています。論文が述べる手法は Grover 探索と動的計画法の部分表の計算を組み合わせたものであり、報告されている評価 O*(1.817^n) の底は、Zoo が最速の既知の古典アルゴリズムとして挙げる O*(2^n) の底を下回ります。同じ手法はグラフ上の各種の頂点順序付け問題とグラフ帯域幅に適用され、同様の考え方が巡回セールスマン問題と最小集合被覆にも適用されています。Zoo はさらにグラフ自体の読み方として、超立方体グラフの頂点が長さ n のビット列に対応し、Hamming 距離 1 の頂点どうしが結ばれることを述べ、この基本手法の適用先として巡回セールスマン問題と並べてフィードバック辺集合問題も挙げています。",
    complexity:
      "O*(1.817^n) for path in the hypercube on bit strings of length n, where O* omits polynomial factors, against O*(2^n) for the fastest known classical algorithm; the abstract reports the same approach for vertex ordering problems in O*(1.817^n), which the Zoo sets against O*(2^n) classically, and for graph bandwidth in O*(2.946^n), set against O*(4.383^n) classically, and reports similar ideas for the travelling salesman problem and minimum set cover in O*(1.728^n), with minimum set cover stated by the Zoo as O(poly(m,n) 1.728^n) against O(nm2^n) classically. The two sources differ on one figure: where the abstract writes 1.728^n for the travelling salesman problem and minimum set cover together, the Zoo writes 1.729^n for traveling salesman and feedback arc set against O*(2^n) classically and gives minimum set cover a figure of its own.",
    complexityBasis:
      'Abstract of arXiv:1807.05209 (TeX math delimiters removed, exponents left in caret form): "We give a quantum algorithm that solves path in the hypercube in time O^*(1.817^n). The technique combines Grover\'s search with computing a partial dynamic programming table. We use this approach to solve a variety of vertex ordering problems on graphs in the same time O^*(1.817^n), and graph bandwidth in time O^*(2.946^n). Then we use similar ideas to solve the travelling salesman problem and minimum set cover in time O^*(1.728^n)." The classical baselines and the per-problem contrasts are from the Quantum Algorithm Zoo entry "Quantum Dynamic Programming for path-in-the-hypercube" (LaTeX rendered into Unicode: math delimiters removed, the mathrm markup around poly dropped, spacing inside the math closed up): "a quantum algorithm can solve path-in-the-hypercube in time O^*(1.817^n), where the notation O^* indicates that polynomial factors are being omitted. The fastest known classical algorithm for this problem runs in time O^*(2^n)", and "vertex ordering problems in O^*(1.817^n) vs. O^*(2^n) classically, graph bandwidth in O^*(2.946^n) vs. O^*(4.383^n) classically, traveling salesman and feedback arc set in O^*(1.729^n) vs. O^*(2^n) classically, and minimum set cover in O(poly(m,n) 1.728^n) vs. O(nm2^n) classically." The 1.728 / 1.729 difference is recorded as both sources read: the abstract pairs 1.728^n with the travelling salesman problem and minimum set cover together, while the Zoo gives 1.728^n to minimum set cover alone and 1.729^n to traveling salesman and feedback arc set. Neither reading was reconciled here.',
    caveat:
      "This is a literature record: no circuit was constructed, compiled, simulated or run, and no instance of path in the hypercube was decided here. Every figure above is an asymptotic running time as the two sources state it, with O* omitting polynomial factors, so none of it fixes a gate count, a circuit depth, a qubit count, a constant factor or an error-correction budget, and none of it says which n is reachable on a device. The comparison is against the fastest classical algorithm currently known, which the Zoo gives as O*(2^n) for this problem, rather than against a proved classical lower bound, and both sides remain exponential in n. The Zoo classes the speedup as polynomial; neither source gives a reason for that classification and none is supplied here. The two sources also attach the 1.728^n figure to different problems, as noted above, and give the travelling salesman problem different bases, 1.728 in the abstract against 1.729 in the Zoo; nothing here resolves either difference. How the partial dynamic programming table is held and addressed on a quantum device, and the cost of the Grover subroutine's oracle for a concrete graph, are outside this record, as are the NP-complete problems the Zoo says can be modelled as instances of path-in-the-hypercube beyond the ones named.",
    caveatJa:
      "本項目は文献に基づく記録であり、回路の構成、コンパイル、シミュレーション、実行は行っておらず、超立方体上の路問題の具体例を判定したこともありません。上記の値はいずれも 2 つの資料が示すとおりの漸近的な実行時間であり、O* は多項式因子を省略した記法です。したがってゲート数、回路深さ、量子ビット数、定数因子、誤り訂正の見積もりはいずれも確定しておらず、実機でどの程度の n まで扱えるかについても何も言えません。比較対象は現在知られている最速の古典アルゴリズム、この問題については Zoo が挙げる O*(2^n) であって、証明された古典側の下界ではありません。量子側も古典側も n について指数時間のままです。Zoo は高速化を多項式的と分類していますが、その理由はいずれの資料にも示されておらず、ここでも補っていません。1.728^n という値がどの問題に対応するかは 2 つの資料で異なり、巡回セールスマン問題の底も要旨では 1.728、Zoo では 1.729 と食い違っています。上記のとおり記録するにとどめ、どちらが正しいかはここでは判断していません。動的計画法の部分表を量子デバイス上でどのように保持し参照するか、また具体的なグラフに対する Grover 探索のオラクルの実装コストは本記録の対象外です。Zoo が超立方体上の路問題としてモデル化できるとする NP 完全問題のうち、名前の挙がっていないものも同様です。",
    tags: ["dynamic programming", "grover search", "hypercube", "np-complete", "exponential time"],
    source: {
      id: "arxiv:1807.05209",
      title: "Quantum Speedups for Exponential-Time Dynamic Programming Algorithms",
      authors: "Andris Ambainis, Kaspars Balodis, Jānis Iraids, Martins Kokainis, Krišjānis Prūsis, Jevgēnijs Vihrovs",
      year: "2018",
      url: "https://arxiv.org/abs/1807.05209",
    },
    literature: [
      {
        title: "Quantum Speedups for Exponential-Time Dynamic Programming Algorithms",
        authors: "Andris Ambainis, Kaspars Balodis, Jānis Iraids, Martins Kokainis, Krišjānis Prūsis, Jevgēnijs Vihrovs",
        year: "2018",
        url: "https://arxiv.org/abs/1807.05209",
        relevance:
          "Primary source: it introduces path in the hypercube as a model for NP-complete problems whose best classical algorithm is an exponential-time dynamic program, states the O*(1.817^n) algorithm built from Grover's search plus a partial dynamic programming table, and carries the technique to vertex ordering problems, graph bandwidth, the travelling salesman problem and minimum set cover. Consult it for what the partial table costs and for the assumptions behind each derived bound, none of which the abstract states.",
        relevanceJa:
          "一次資料です。最良の古典アルゴリズムが指数時間の動的計画法となる NP 完全問題のモデルとして超立方体上の路問題を導入し、Grover 探索と動的計画法の部分表を組み合わせた O*(1.817^n) のアルゴリズムを示したうえで、その手法を頂点順序付け問題、グラフ帯域幅、巡回セールスマン問題、最小集合被覆へ広げています。部分表の計算コストや各評価が前提とする条件は要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["grover-unstructured-search", "amplitude-amplification", "qaoa-maxcut-ring"],
  },
  {
    slug: "graph-property-testing",
    title: "Property testing of bounded-degree graphs in the adjacency list model",
    titleJa: "隣接リストモデルにおける次数有界グラフの性質検査",
    family: "Quantum query algorithm",
    zooName: "Graph Properties in the Adjacency List Model",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given only an oracle that, for a vertex of an N-vertex graph of degree d together with an index j in {1, 2, ..., d}, returns that vertex's j-th neighbor or null when the vertex has degree less than d, decide in as few queries as possible whether the graph is bipartite or far from bipartite — far meaning that a constant fraction of the edges would have to be removed to achieve bipartiteness — and, in the same model, whether the graph is an expander or far from being one.",
    problemJa:
      "N 頂点で次数 d のグラフについて、頂点のラベルと j ∈ {1, 2, ..., d} を与えるとその頂点の j 番目の隣接頂点を返し、次数が d に満たないときは null を返すオラクルだけが与えられたとき、そのグラフが二部グラフであるか、それとも二部グラフにするには辺の一定割合を取り除かねばならないという意味で二部性から遠いかを、できるだけ少ないクエリ数で判定し、同じモデルのもとでエキスパンダーであるかエキスパンダーから遠いかも同様に判定する問題です。",
    idea:
      "Ambainis, Childs and Liu treat the testing of bipartiteness and of expansion for bounded-degree graphs. Their abstract credits the construction to a combination of classical property testing techniques due to Goldreich and Ron, derandomization, and the quantum algorithm for element distinctness, and the Zoo likewise names element distinctness as the key quantum algorithmic tool. For expansion testing the paper also proves a quantum query lower bound, obtained by the polynomial method with algebraic techniques and combinatorial analysis that the abstract calls novel and describes as accommodating the graph structure, and it presents that bound as ruling out the possibility of an exponential quantum speedup. The Zoo sets this beside other results in the same adjacency list model — query complexities for a minimal spanning tree, for connectivity in the undirected and directed cases and for the lowest weight path from a given source on a weighted graph, and algorithms for st-connectivity, bipartiteness and forest testing that run in Õ(N√d) time using only logarithmically many qubits — all of which rest on papers outside this record.",
    ideaJa:
      "Ambainis、Childs、Liu は、次数有界グラフの二部性とエキスパンダー性を検査する量子アルゴリズムを扱っています。要旨によれば、この構成は Goldreich と Ron による古典的な性質検査の技法、脱乱択化、そして要素相異性問題に対する量子アルゴリズムを組み合わせたものであり、Zoo も要素相異性問題のアルゴリズムを中核的な量子的道具として挙げています。エキスパンダー性の検査については量子クエリの下界も証明されており、要旨はこれを多項式法によるものとし、グラフの構造を扱うために新しい代数的技法と組合せ論的解析を用いたと述べたうえで、この下界が指数関数的な量子高速化の可能性を排除すると位置づけています。Zoo はこの結果を、同じ隣接リストモデルにおける別の結果群と並べて示しています。すなわち、最小全域木、無向および有向の連結性、重み付きグラフ上のある始点からの最小重み経路に対するクエリ計算量と、st 連結性・二部性・森であることの判定を Õ(N√d) 時間かつ対数個の量子ビットのみで行うアルゴリズムであり、いずれも本記録の対象外の論文に基づきます。",
    complexity:
      "Õ(N^(1/3)) quantum complexity, in the Zoo's words, for deciding bipartiteness on an N-vertex bounded-degree graph promised to be either bipartite or far from bipartite, and Õ(N^(1/3)) together with an Ω̃(N^(1/4)) quantum lower bound, the two not meeting, for distinguishing expanders from graphs far from being expanders, against a classical Θ̃(√N); the primary paper states the same upper bound as time O(N^(1/3)) for both problems, its quantum lower bound as Ω(N^(1/4)) and the classical side as an Ω(√N) lower bound holding for both problems, all without tildes. The Zoo adds, from papers outside this record, Θ(√(NM)) quantum query complexity for finding a minimal spanning tree, Θ(N) for deciding connectivity in the undirected case and Θ̃(√(NM)) in the directed case, Θ̃(√(NM)) for computing the lowest weight path from a given source to all other vertices on a weighted graph, and Õ(N√d) running time for st-connectivity, bipartiteness and forest testing using only logarithmically many qubits, where N is the number of vertices, M the number of edges and d the degree.",
    complexityBasis:
      'abstract of arXiv:1012.3174, which writes its bounds in plain text without tildes: "We give quantum algorithms that solve these problems in time O(N^(1/3)), beating the Omega(sqrt(N)) classical lower bound", and "For testing expansion, we also prove an Omega(N^(1/4)) quantum query lower bound, thus ruling out the possibility of an exponential quantum speedup." Quantum Algorithm Zoo entry "Graph Properties in the Adjacency List Model", with LaTeX rendered into Unicode and widetilde written as a tilde over the symbol (Õ, Ω̃, Θ̃): "Suppose we are given the promise that G is either bipartite or is far from bipartite in the sense that a constant fraction of the edges would need to be removed to achieve bipartiteness", "the quantum complexity of deciding bipartiteness is Õ(N^(1/3))", "distinguishing expander graphs from graphs that are far from being expanders has quantum complexity Õ(N^(1/3)) and Ω̃(N^(1/4)), whereas the classical complexity is Θ̃(√N)", "finding a minimal spanning tree has quantum query complexity Θ(√(NM)), deciding graph connectivity has quantum query complexity Θ(N) in the undirected case, and Θ̃(√(NM)) in the directed case, and computing the lowest weight path from a given source to all other vertices on a weighted graph has quantum query complexity Θ̃(√(NM))", and "quantum algorithms are given for st-connectivity, deciding bipartiteness, and deciding whether a graph is a forest, which run in Õ(N √d) time and use only logarithmically many qubits". Neither source states a gate count or a constant factor.',
    caveat:
      "This is a literature record: no oracle was instantiated, no circuit was compiled, simulated or run, and no graph was tested here. The bipartiteness and expansion bounds belong to a property-testing setting, so they hold only under the promise the Zoo states — the graph either has the property or is far from having it, far from bipartite meaning that a constant fraction of the edges would have to be removed — and they say nothing about deciding bipartiteness or expansion on an arbitrary graph. The input model carries as much of the claim as the exponent does: every figure here is stated for the adjacency list model on a graph of bounded degree d, and this record says nothing about how the same properties behave in any other input model. Every figure above is quoted in its source's own words: the Zoo says quantum complexity for the bipartiteness and expansion figures and quantum query complexity for the spanning tree, connectivity and lowest weight path figures, the primary paper says time, and the Õ(N√d) figure is a running time. Gate counts, the cost of realizing the neighbor oracle, and the constant and logarithmic factors hidden by O(·) and by the tildes all sit outside this record; the only qubit statement anywhere here is the Zoo's own, for the st-connectivity, bipartiteness and forest algorithms. Two forms of the same results are quoted rather than reconciled: the abstract writes time O(N^(1/3)), a quantum lower bound Ω(N^(1/4)) and a classical Ω(√N) with no tilde, while the Zoo writes Õ(N^(1/3)), Ω̃(N^(1/4)) and Θ̃(√N). The paper presents its lower bound as ruling out an exponential quantum speedup for expansion testing; it does not close the gap to the upper bound, so nothing here says Õ(N^(1/3)) is optimal, and no quantum lower bound at all is recorded for bipartiteness — the Ω(√N) the paper states for both problems is a classical one. The classical side is quoted from the two sources and not re-derived. The remaining results in the same Zoo entry — the minimal spanning tree, connectivity and lowest weight path complexities, and the Õ(N√d)-time st-connectivity, bipartiteness and forest algorithms with logarithmically many qubits — rest on papers the Zoo cites and this record does not read.",
    caveatJa:
      "本項目は文献に基づく記録であり、オラクルを具体化したことも、回路をコンパイル・シミュレーション・実行したこともなく、実際にグラフを検査したわけでもありません。二部性とエキスパンダー性についての評価は性質検査の枠組みにおける主張であり、Zoo が述べる約束、すなわちグラフがその性質を持つか、あるいはそこから遠いか（二部性から遠いとは、二部グラフにするために辺の一定割合を取り除く必要があることを指します）のいずれかであるという前提のもとでのみ成り立ち、任意のグラフに対する二部性やエキスパンダー性の判定については何も述べていません。入力モデルは指数と同じだけ主張を支えています。ここに挙げた数値はいずれも、次数有界のグラフに対する隣接リストモデルのもとで述べられたものであり、同じ性質が他の入力モデルでどうなるかについて本記録は何も述べていません。上記の数値はいずれも出典の言葉のまま引いたものです。Zoo は二部性とエキスパンダー性については quantum complexity、最小全域木・連結性・最小重み経路については quantum query complexity と書き、主論文は time と書いており、Õ(N√d) は実行時間です。ゲート数、隣接頂点オラクルを実現するコスト、O(·) やチルダに隠れる定数因子と対数因子はいずれも対象外です。量子ビット数に触れているのは、st 連結性・二部性・森の判定についての Zoo 自身の記述だけです。同じ結果の二通りの書き方をそのまま併記しており、整合させてはいません。要旨はチルダなしで time O(N^(1/3))、量子下界 Ω(N^(1/4))、古典下界 Ω(√N) と書き、Zoo は Õ(N^(1/3))、Ω̃(N^(1/4))、Θ̃(√N) と書いています。論文はこの下界を、エキスパンダー性の検査について指数関数的な量子高速化の可能性を排除するものと位置づけていますが、上界との差を埋めるものではないため、Õ(N^(1/3)) が最適であるとは本記録では述べていません。また、二部性については量子の下界を記録していません。論文が両方の問題について挙げる Ω(√N) は古典の下界です。古典側の数値も二つの出典からの引用であり、導出し直したものではありません。同じ Zoo 項目に含まれる最小全域木・連結性・最小重み経路の計算量、および Õ(N√d) 時間で対数個の量子ビットのみを用いる st 連結性・二部性・森の判定は、いずれも Zoo が引用する本記録の対象外の論文に基づきます。",
    tags: ["property testing", "adjacency list", "bipartiteness", "expansion", "query complexity"],
    source: {
      id: "arxiv:1012.3174",
      title: "Quantum property testing for bounded-degree graphs",
      authors: "Andris Ambainis, Andrew M. Childs, Yi-Kai Liu",
      year: "2010",
      url: "https://arxiv.org/abs/1012.3174",
    },
    literature: [
      {
        title: "Quantum property testing for bounded-degree graphs",
        authors: "Andris Ambainis, Andrew M. Childs, Yi-Kai Liu",
        year: "2010",
        url: "https://arxiv.org/abs/1012.3174",
        relevance:
          "Primary source for the bipartiteness and expansion figures in this record, and for those only. It gives quantum algorithms for testing bipartiteness and expansion of bounded-degree graphs in time O(N^(1/3)) against an Ω(√N) classical lower bound, proves an Ω(N^(1/4)) quantum query lower bound for testing expansion, and credits the algorithms to classical property testing techniques due to Goldreich and Ron, derandomization, and the quantum algorithm for element distinctness. Consult it for the promise each test assumes, for the degree bound, and for how the polynomial-method lower bound is set up, none of which the abstract spells out.",
        relevanceJa:
          "本記録に含まれる数値のうち、二部性とエキスパンダー性に関するものについてのみ一次資料にあたります。次数有界グラフの二部性とエキスパンダー性の検査を time O(N^(1/3)) で行う量子アルゴリズムを、古典の下界 Ω(√N) と対比して与え、エキスパンダー性の検査については量子クエリ下界 Ω(N^(1/4)) を証明し、アルゴリズムの由来を Goldreich と Ron による古典的な性質検査の技法、脱乱択化、要素相異性問題に対する量子アルゴリズムに帰しています。各検査が前提とする約束、次数の上限、多項式法による下界の設定は要旨に明示されていないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["element-distinctness", "graph-properties-adjacency-matrix", "quantum-walk-line"],
  },
  {
    slug: "radial-function-center",
    title: "Finding the center of a radial function with the curvelet transform",
    titleJa: "カーブレット変換による球対称関数の中心の探索",
    family: "Quantum query algorithm",
    zooName: "Center of Radial Function",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given oracle access to a spherically symmetric function f from R^d to an arbitrary set S, locate its center of symmetry to a fixed precision using as few queries as possible.",
    problemJa:
      "R^d から任意の集合 S への球対称な関数 f にオラクル経由でアクセスできるとき、その対称中心を、あらかじめ固定した精度で、できるだけ少ないクエリ数で求める問題です。",
    idea:
      "Liu takes up the curvelet transform, a directional wavelet transform over R^n used to analyze functions that have singularities along smooth surfaces, and gives an efficient implementation of a quantum curvelet transform. Two applications rest on that implementation: a single-shot measurement procedure that approximately finds the center of a ball in R^n from a quantum-sample over the ball, and — the algorithm this record covers — a quantum algorithm for finding the center of a radial function over R^n from oracle access to the function. The Zoo records the condition under which the second one applies, namely that f fluctuates on sufficiently small scales, for example when the level sets of f are sufficiently thin spherical shells. What the paper proves are bounds on the distribution of probability mass for the continuous curvelet transform, offered as support for its own conjecture and showing that the algorithms work in an idealized continuous model.",
    ideaJa:
      "Liu は、滑らかな曲面上に特異性を持つ関数を解析するために用いられる R^n 上の方向性ウェーブレット変換であるカーブレット変換を取り上げ、その量子版の効率的な実装を与えています。この実装の上に二つの応用が置かれており、一つは球上の量子サンプルから R^n における球の中心を近似的に求める単発測定の手続き、もう一つが本項目の対象、すなわち関数へのオラクルアクセスから R^n 上の球対称関数の中心を求める量子アルゴリズムです。Zoo は後者が働く条件を記しており、f が十分小さいスケールで変動すること、たとえば f の等位集合が十分に薄い球殻である場合を挙げています。論文が証明しているのは連続カーブレット変換における確率質量の分布に関する評価であり、これは論文自身の予想を支える根拠として示され、上記のアルゴリズムが理想化された連続モデルで機能することを示すものです。",
    complexity:
      "A constant number of quantum queries independent of the dimension, written O(1) oracle queries, against a classical lower bound of Ω(d) queries, the Zoo naming that dimension d where the paper names it n. The Zoo states the constant-query result flatly, but the paper puts the count forward as a conjecture rather than a theorem: it conjectures that the algorithms succeed with constant probability using one quantum-sample and O(1) oracle queries respectively, independent of the dimension n. What the paper reports as proved are rigorous bounds on the distribution of probability mass for the continuous curvelet transform, which show that the algorithms work in an idealized continuous model. The precision to which the center is located is fixed for simplicity in the Zoo statement, and neither source states a gate count.",
    complexityBasis:
      'abstract of arXiv:0810.4968: "I conjecture that these algorithms succeed with constant probability, using one quantum-sample and O(1) oracle queries, respectively, independent of the dimension n -- this can be interpreted as a quantum speed-up", and, for what is actually established, "To support this conjecture, I prove rigorous bounds on the distribution of probability mass for the continuous curvelet transform. This shows that the above algorithms work in an idealized \'continuous\' model." The abstract encloses continuous in double quotation marks; they appear here as single marks so as not to close the quotation around them. Quantum Algorithm Zoo entry "Center of Radial Function", LaTeX rendered into Unicode: "We wish to locate the center of symmetry, up to some precision. (For simplicity, let the precision be fixed.)", "Liu gives a quantum algorithm, based on a curvelet transform, that solves this problem using a constant number of quantum queries independent of d. This constitutes a polynomial speedup over the classical lower bound, which is Ω(d) queries", together with "The quantum algorithm is shown to work in an idealized continuous model, and nonrigorous arguments suggest that discretization effects should be small." Neither source states a gate count, a circuit depth or a constant factor, and the two name the dimension differently, n in the paper and d in the Zoo.',
    caveat:
      "This is a literature record: no circuit was constructed, compiled, simulated or run, no curvelet transform was implemented here, and no center was located. The headline cost is a conjecture rather than a theorem — the paper conjectures that its algorithms succeed with constant probability using O(1) oracle queries independent of the dimension, and what it proves is a set of bounds on the distribution of probability mass for the continuous curvelet transform — so this record establishes only that the paper states the constant-query claim, not the claim itself. The Zoo carries the same result without that hedge, saying outright that the algorithm solves the problem in a constant number of queries; the hedge is the paper's own, and this record keeps it. That proof covers an idealized continuous model; the Zoo says nonrigorous arguments suggest that discretization effects should be small, which is an expectation and not a result, and nothing here bounds the cost of a discretized version. The figure is a query count, so gate counts, qubit counts, circuit depth, the cost of realizing the oracle for a given f, and the cost of the quantum curvelet transform itself, which the abstract calls efficient without quoting a figure, all fall outside this record. The claim is conditional on the function: the Zoo states that the algorithm works when f fluctuates on sufficiently small scales, for instance when its level sets are sufficiently thin spherical shells, so a smooth or slowly varying radial function is not covered. Precision is treated as fixed for simplicity, so nothing here says how the cost grows as the center is demanded more precisely, and neither source gives a success probability beyond calling it constant. The classical Ω(d) lower bound is the Zoo's figure, quoted and not re-derived. The single-shot ball-center procedure in the same paper is a separate application that consumes a quantum-sample rather than oracle queries, and it is not the algorithm this entry covers.",
    caveatJa:
      "本項目は文献に基づく記録であり、回路の構成・コンパイル・シミュレーション・実行はいずれも行っておらず、カーブレット変換を実装したことも、実際に中心を求めたこともありません。本項目が掲げるコストの主張は定理ではなく予想です。論文は、次元によらず O(1) 回のオラクルクエリで定数の確率で成功すると予想する一方、実際に証明しているのは連続カーブレット変換における確率質量の分布に関する評価です。したがって本記録が示せるのは、論文がこの定数クエリの主張を述べているという事実までであり、主張そのものではありません。Zoo は同じ結果をこの留保なしに、定数回のクエリで問題を解くと言い切って記していますが、留保は論文自身のものであり、本記録はそれに従います。証明の対象は理想化された連続モデルです。Zoo は離散化の影響が小さいことを示唆する厳密でない議論があると述べていますが、これは見込みであって結果ではなく、離散化した場合のコストについて本記録は何も保証していません。示されている数値はクエリ数であるため、ゲート数、量子ビット数、回路深さ、与えられた f に対するオラクルの実現コスト、および要旨が efficient と述べるだけで具体的な数値を挙げていない量子カーブレット変換自体のコストは、いずれも対象外です。主張は関数の性質に依存します。Zoo は、f が十分小さいスケールで変動する場合、たとえば等位集合が十分に薄い球殻である場合にアルゴリズムが働くと述べており、滑らかで緩やかにしか変化しない球対称関数は対象に含まれません。精度は簡単のため固定した扱いであり、より高い精度を要求したときにコストがどう増えるかは本記録では述べておらず、成功確率についても定数であるという以上の記述は両出典にありません。古典側の下界 Ω(d) は Zoo の記述の引用であり、導出し直したものではありません。同じ論文にあるもう一つの応用、すなわち球の中心を求める単発測定の手続きは、オラクルクエリではなく量子サンプルを消費するものであり、本項目が扱うアルゴリズムではありません。",
    tags: ["curvelet transform", "radial function", "center finding", "query complexity", "oracle"],
    source: {
      id: "arxiv:0810.4968",
      title: "Quantum Algorithms Using the Curvelet Transform",
      authors: "Yi-Kai Liu",
      year: "2008",
      url: "https://arxiv.org/abs/0810.4968",
    },
    literature: [
      {
        title: "Quantum Algorithms Using the Curvelet Transform",
        authors: "Yi-Kai Liu",
        year: "2008",
        url: "https://arxiv.org/abs/0810.4968",
        relevance:
          "Primary source. It gives an efficient implementation of a quantum curvelet transform — the curvelet transform being a directional wavelet transform over R^n for functions with singularities along smooth surfaces, which the abstract attributes to Candes and Donoho, 2002 — and applies it both to finding the center of a ball from a quantum-sample and to finding the center of a radial function from oracle access. The O(1)-query cost is stated there as a conjecture supported by bounds on the distribution of probability mass for the continuous curvelet transform, so consult the paper for what the continuous model assumes and for how far the rigorous bounds reach.",
        relevanceJa:
          "一次資料です。滑らかな曲面上に特異性を持つ関数を扱う R^n 上の方向性ウェーブレット変換であるカーブレット変換について、量子版の効率的な実装を与え（要旨はこの変換を Candes と Donoho の 2002 年の仕事に帰しています）、量子サンプルから球の中心を求める場合と、オラクルアクセスから球対称関数の中心を求める場合の双方に適用しています。O(1) クエリというコストは、連続カーブレット変換における確率質量の分布の評価に支えられた予想として述べられているため、連続モデルが何を前提とし、厳密な評価がどこまで及ぶのかは原論文で確認してください。",
      },
    ],
    relatedSlugs: ["hidden-nonlinear-structures", "hidden-shift-problem", "quantum-fourier-transform"],
  },
  {
    slug: "group-order-and-membership",
    title: "Group order and membership for black-box groups",
    titleJa: "ブラックボックス群の位数計算と所属判定",
    family: "Quantum query algorithm",
    zooName: "Group Order and Membership",
    zooSection: "Oracular Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given a finite group G presented only through an oracle that takes an ordered pair of element labels and returns the label of their product, compute the order of G from the labels of a set of generators, and decide whether a given bitstring is the label of a group element — in the constructive form of the membership question, exhibiting that element as a product of the generators.",
    problemJa:
      "有限群 G が、2 元のラベルの順序対を受け取ってその積のラベルを返すオラクルとしてのみ与えられているとき、生成元のラベルの一覧から G の位数を求め、また与えられたビット列が群の元のラベルであるかどうかを判定する問題です。所属判定の構成的な形では、肯定の場合にその元を生成元の積として書き下すことまでが求められます。",
    idea:
      "The Zoo records that for Abelian groups these tasks reduce to the Abelian hidden subgroup problem, which is how Mosca solves them with polylog(|G|) queries. Watrous extends the reach to solvable groups: the paper gives a polynomial-time quantum algorithm for computing orders of solvable groups, and its abstract states that testing membership in a solvable group, testing equality of two subgroups of a given solvable group and testing normality of a subgroup all reduce to that order computation, so each admits a polynomial-time quantum algorithm as well. The abstract describes an important byproduct: the algorithm is able to produce a pure quantum state that is uniform over the elements in any chosen subgroup of a solvable group, which it says yields a natural way to apply existing quantum algorithms to factor groups of solvable groups. The setting throughout is black-box groups, in which, the abstract states, none of these problems can be computed classically in polynomial time.",
    ideaJa:
      "Zoo は、可換群の場合これらの課題が可換な隠れ部分群問題に帰着され、Mosca がそれによって polylog(|G|) クエリで解いたと記しています。Watrous の論文は対象を可解群へ広げ、可解群の位数を計算する多項式時間の量子アルゴリズムを与えたうえで、可解群における所属判定、与えられた可解群の 2 つの部分群が等しいかどうかの判定、部分群が正規部分群であるかどうかの判定はいずれも位数計算に帰着するため、同じく多項式時間の量子アルゴリズムを持つと要旨で述べています。要旨は重要な副産物も挙げており、このアルゴリズムは可解群の任意の部分群の元の上で一様な純粋状態を生成でき、それによって可解群の剰余群に既存の量子アルゴリズムを適用する自然な方法が得られるとしています。前提となるのは一貫してブラックボックス群の設定であり、要旨は、この設定ではこれらの問題はいずれも古典的には多項式時間で計算できないと述べています。",
    complexity:
      "polylog(|G|) queries to compute the order and to decide membership when G is solvable, and likewise when G is Abelian, against a classical query cost that the Zoo says cannot be brought down to polylog(|G|) even for Abelian G. Watrous states the solvable case as a polynomial-time quantum algorithm for computing orders of solvable groups, and the abstract names no query count and no parameter that its polynomial time is measured in.",
    complexityBasis:
      'Quantum Algorithm Zoo entry "Group Order and Membership", quoted with the entry reference numerals omitted and the spacing inside | G | left as the Zoo prints it: "Classically, these problems cannot be solved using polylog(| G |) queries even if G is Abelian. For Abelian groups, quantum computers can solve these problems using polylog(| G |) queries by reduction to the Abelian hidden subgroup problem, as shown by Mosca", and "quantum computers can solve these problems using polylog(| G |) queries for any solvable group"; abstract of arXiv:quant-ph/0011023: "In this paper we give a polynomial-time quantum algorithm for computing orders of solvable groups" together with "Our algorithm works in the setting of black-box groups, wherein none of these problems can be computed classically in polynomial time." The polylog(|G|) figures are the Zoo entry\'s; the abstract states neither a query count nor the quantity its polynomial is in.',
    caveat:
      "This is a literature record: no group was represented, no group oracle was implemented, and no circuit was built, compiled, simulated or run; no order was computed and no membership question was decided here. The polylog(|G|) figures count queries to the group oracle in the black-box model, so they bound neither gate count nor circuit depth nor the cost of realizing the group oracle for a concrete G, and polylog leaves both the power of the logarithm and the constant in front of it unstated. The two sources measure different things — the Zoo counts queries, while the Watrous abstract claims polynomial time without naming the parameter — and this record does not equate them. The reach is Abelian groups, on Mosca's result as reported by the Zoo, and solvable groups, on Watrous; nothing here covers a general finite group, and Mosca's paper is cited through the Zoo rather than read for this record. The abstract names membership testing but not the constructive version, and the Zoo clause quoted above states its polylog(|G|) figure for these problems without listing them inside the quoted fragment, so no clause quoted here establishes on its own the cost of decomposing a given element into a product of generators. The classical side is the Zoo's and the abstract's own statement about the black-box setting, not a lower bound re-derived here. The Zoo's separate remark that for groups given as matrices over a finite field rather than oracularly the order finding and constructive membership problems can be solved in polynomial time using the quantum algorithms for discrete log and factoring concerns a different input model and rests on papers outside this record, as does the group isomorphism entry the Zoo points to next.",
    caveatJa:
      "本項目は文献に基づく記録です。群を具体的に表現したことも、群オラクルを実装したことも、回路を構成・コンパイル・シミュレーション・実行したこともなく、実際に位数を求めたり所属を判定したりしたわけでもありません。polylog(|G|) はブラックボックスモデルにおける群オラクルへのクエリ数であり、ゲート数も回路深さも、具体的な G について群オラクルを実現するコストも押さえるものではありません。また polylog は対数の次数も前に付く定数も明示していません。2 つの出典が測っているものは同一ではありません。Zoo はクエリ数を数える一方、Watrous の要旨は多項式時間と述べるだけでその変数を明示しておらず、本項目で両者を同一視してはいません。対象範囲は、Zoo が伝える Mosca の結果による可換群と、Watrous による可解群であり、一般の有限群については何も述べていません。Mosca の論文は Zoo を通じて引用したものであって、本記録のために読んだものではありません。要旨は所属判定に触れていますが構成的な版には触れておらず、上で引用した Zoo の文も polylog(|G|) を「これらの問題」について述べるだけで、その内訳は引用した範囲に含まれていません。したがって、与えられた元を生成元の積へ分解するコストは、ここに引用したどの文だけからも定まりません。古典側についても、ブラックボックス設定に関する Zoo と要旨自身の記述であり、本記録で導出し直した下界ではありません。オラクルではなく有限体上の行列として群が与えられる場合、位数計算と構成的な所属判定は離散対数と素因数分解の量子アルゴリズムによって多項式時間で解ける、という Zoo の別の記述は入力のモデルが異なり、本記録の対象外の論文に基づきます。Zoo が続けて参照する群同型問題の項目も同様です。",
    tags: ["black-box group", "group order", "membership testing", "solvable groups", "hidden subgroup"],
    source: {
      id: "arxiv:quant-ph/0011023",
      title: "Quantum algorithms for solvable groups",
      authors: "John Watrous",
      year: "2000",
      url: "https://arxiv.org/abs/quant-ph/0011023",
    },
    literature: [
      {
        title: "Quantum algorithms for solvable groups",
        authors: "John Watrous",
        year: "2000",
        url: "https://arxiv.org/abs/quant-ph/0011023",
        relevance:
          "Primary source: it gives the polynomial-time quantum algorithm for computing orders of solvable groups that this record rests on, states that membership testing, equality of subgroups and normality of a subgroup reduce to that order computation, works throughout in the black-box group setting where the abstract says none of these problems is classically polynomial-time, and reports the byproduct that the algorithm can produce a pure quantum state uniform over the elements of any chosen subgroup. Consult it for the black-box group model it assumes and for the quantity its polynomial time is measured in, which the abstract does not name.",
        relevanceJa:
          "一次資料です。本記録が依拠する、可解群の位数を計算する多項式時間の量子アルゴリズムを与え、所属判定、部分群の一致判定、部分群の正規性判定がいずれも位数計算に帰着すると述べています。議論は一貫してブラックボックス群の設定で行われ、要旨はこの設定でこれらの問題が古典的には多項式時間で解けないとしています。さらに、任意の部分群の元の上で一様な純粋状態を生成できるという副産物も報告しています。前提となるブラックボックス群のモデルと、多項式時間がどの量について測られているのかは、いずれも原論文で確認してください。後者は要旨に示されていません。",
      },
    ],
    relatedSlugs: ["group-commutativity-testing", "discrete-logarithm", "shor-period-finding", "quantum-fourier-transform"],
  },
  {
    slug: "distribution-property-testing",
    title: "Testing properties of distributions given by sample oracles",
    titleJa: "サンプルオラクルで与えられる分布の性質判定",
    family: "Quantum query algorithm",
    zooName: "Statistical Difference",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given oracle access to two unknown probability distributions P and Q on an N-element set — in the Zoo's setup, black boxes A and B whose domain is the integers 1 through T and whose range is the integers 1 through N, with the distribution over outputs induced by choosing uniformly at random among allowed inputs — approximate the L1 distance between the two distributions to constant precision.",
    problemJa:
      "N 元集合上の 2 つの未知の確率分布 P と Q のサンプルオラクルへアクセスできるとき、その 2 つの分布の L1 距離を定数精度で近似する問題です。Zoo の設定では、定義域が 1 から T、値域が 1 から N のブラックボックス A と B が与えられ、許される入力の中から一様ランダムに選ぶことで出力の上に確率分布が定まります。",
    idea:
      "Bravyi, Harrow and Hassidim pose the question as one of sample complexity in property testing: given oracles generating samples from two unknown distributions P and Q on an N-element set, how many samples are needed to test whether the two are close or far from each other in the L1 norm. Their paper studies quantum algorithms for testing properties of distributions, and it shows that the L1 distance can be estimated with constant precision using approximately N^(1/2) queries in the quantum setting, where classical computers need Ω(N). The paper also describes quantum algorithms for testing Uniformity and Orthogonality, at query complexity O(N^(1/3)) against a classical query complexity the abstract says is known to be Ω(N^(1/2)). The Zoo names the main tool behind these results as the quantum counting algorithm, and it records that a further improved quantum algorithm for this task has since been obtained in a paper outside this record.",
    ideaJa:
      "Bravyi、Harrow、Hassidim は、この課題を性質判定におけるサンプル数の問題として立てています。すなわち、N 元集合上の 2 つの未知の分布 P と Q からサンプルを生成するオラクルが与えられたとき、両者が L1 ノルムで近いか遠いかを判定するには何個のサンプルが必要か、という問いです。論文は分布の性質判定に対する量子アルゴリズムを論じ、量子の設定では L1 距離をおよそ N^(1/2) クエリで定数精度で推定でき、古典計算機には Ω(N) クエリが必要であることを示しています。さらに、一様性と直交性を判定する量子アルゴリズムも記述しており、そのクエリ計算量は O(N^(1/3))、要旨によれば古典のクエリ計算量は Ω(N^(1/2)) と知られています。Zoo はこれらの結果を支える主要な道具が量子カウンティングのアルゴリズムであると述べ、またこの課題に対してより改良された量子アルゴリズムがその後得られていることも記していますが、その論文は本記録の対象外です。",
    complexity:
      "About N^(1/2) queries to estimate the L1 distance between P and Q with constant precision, where classical computers need Ω(N) queries; O(N^(1/3)) queries for testing Uniformity and Orthogonality, whose classical query complexity the abstract says is known to be Ω(N^(1/2)). The Zoo states the first figure as O(√N) and describes the classical requirement as scaling essentially linearly with N.",
    complexityBasis:
      'abstract of arXiv:0907.3920, with \\Omega rendered into Unicode as Ω: "It is shown that the L_1-distance between P and Q can be estimated with a constant precision using approximately N^{1/2} queries in the quantum settings, whereas classical computers need Ω(N) queries", and "We also describe quantum algorithms for testing Uniformity and Orthogonality with query complexity O(N^{1/3}). The classical query complexity of these problems is known to be Ω(N^{1/2})."; Quantum Algorithm Zoo entry "Statistical Difference", quoted in clauses that omit the entry reference numerals, with the inline-math delimiters \\( \\) stripped and \\sqrt{N} rendered into Unicode as √N: "Classically the number of necessary queries scales essentially linearly with N", "a quantum computer can achieve this using O(√N) queries", and "Approximate uniformity and orthogonality of probability distributions can also be decided on a quantum computer using O(N^{1/3}) queries."',
    caveat:
      "This is a literature record: no oracle was instantiated, no distribution was sampled, and no circuit was built, compiled, simulated or run; no L1 distance was estimated here. Every figure above counts queries to the sample oracles, so none of it bounds gate count, circuit depth, qubit count, or the cost of building A and B for concrete distributions. The abstract writes approximately N^(1/2) rather than a bound with a stated constant, and it attaches that figure to a constant precision only: no dependence on an accuracy parameter ε is quoted by either source, so nothing above bounds the cost of a sharper estimate. The O(N^(1/3)) figure belongs to the Uniformity and Orthogonality tests, which the Zoo states as deciding approximate uniformity and orthogonality, and not to the L1-distance estimate. The classical Ω(N) and Ω(N^(1/2)) figures are recorded as the abstract states them, and are not re-derived here; the Zoo puts the classical side without asymptotic notation, as the number of necessary queries scaling essentially linearly with N, and this record does not treat that phrasing and the abstract's Ω(N) as the same statement. The Zoo's parameter T, the domain size of the two black boxes, appears in neither bound, so the cost above is stated in the range size N alone. That the main tool is the quantum counting algorithm is the Zoo's attribution to a paper outside this record, as is the further improved quantum algorithm the Zoo says was later obtained for this task.",
    caveatJa:
      "本項目は文献に基づく記録です。オラクルを具体化したことも、分布からサンプリングしたことも、回路を構成・コンパイル・シミュレーション・実行したこともなく、実際に L1 距離を推定したわけでもありません。上記の数値はいずれもサンプルオラクルへのクエリ数であり、ゲート数、回路深さ、量子ビット数、具体的な分布に対して A と B を構築するコストのいずれについても上界を与えるものではありません。要旨は定数を明示した評価ではなく「およそ N^(1/2)」と書いており、しかもその数値は定数精度の場合に限られています。精度パラメータ ε への依存性はどちらの資料にも示されていないため、より高精度な推定のコストについては何も言えません。O(N^(1/3)) は一様性と直交性の判定に対する数値であり、Zoo の表現では近似的な一様性と直交性の判定に関するものであって、L1 距離の推定に対するものではありません。古典側の Ω(N) と Ω(N^(1/2)) は要旨の記述をそのまま記録したものであり、本記録で導出し直したものではありません。Zoo 自身は古典側を漸近記法ではなく、必要なクエリ数が N にほぼ比例して増える、という形で述べており、本記録ではこの表現と要旨の Ω(N) を同じ主張としては扱いません。ブラックボックスの定義域の大きさである Zoo のパラメータ T はどちらの評価にも現れないため、上記のコストは値域の大きさ N のみで表されています。主要な道具が量子カウンティングのアルゴリズムであるという点は Zoo が本記録の対象外の論文に帰した記述であり、この課題に対してより改良された量子アルゴリズムが後に得られたという記述も同様です。",
    tags: ["distribution testing", "l1 distance", "property testing", "quantum counting", "query complexity"],
    source: {
      id: "arxiv:0907.3920",
      title: "Quantum algorithms for testing properties of distributions",
      authors: "Sergey Bravyi, Aram W. Harrow, Avinatan Hassidim",
      year: "2009",
      url: "https://arxiv.org/abs/0907.3920",
    },
    literature: [
      {
        title: "Quantum algorithms for testing properties of distributions",
        authors: "Sergey Bravyi, Aram W. Harrow, Avinatan Hassidim",
        year: "2009",
        url: "https://arxiv.org/abs/0907.3920",
        relevance:
          "Primary source: it states the approximately N^(1/2)-query estimate of the L1 distance at constant precision against Ω(N) classically, and the O(N^(1/3))-query tests for Uniformity and Orthogonality against a classical Ω(N^(1/2)). Consult it for the sample-oracle model it assumes, for how the Uniformity and Orthogonality properties are defined, and for the constants and success probabilities the abstract leaves out of approximately N^(1/2).",
        relevanceJa:
          "一次資料です。定数精度での L1 距離の推定がおよそ N^(1/2) クエリで済み、古典計算機には Ω(N) クエリが必要であることを示し、また一様性と直交性の判定が O(N^(1/3)) クエリで済むこと、それらの問題の古典のクエリ計算量が Ω(N^(1/2)) と知られていることを述べています。前提となるサンプルオラクルのモデル、一様性と直交性の定義、そして「およそ N^(1/2)」という表現が省いている定数や成功確率については、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["quantum-counting", "amplitude-estimation", "element-distinctness"],
  },
  {
    slug: "finite-ring-ideals",
    title: "Ideals in a finite black-box ring",
    titleJa: "有限ブラックボックス環におけるイデアル",
    family: "Hidden-period / factoring",
    zooName: "Finite Rings and Ideals",
    zooSection: "Oracular Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given black-box access to a finite ring R, not necessarily commutative, together with a list of generators for an ideal I in R, find an additive basis representation for I.",
    problemJa:
      "可換とは限らない有限環 R へのブラックボックスアクセスと、R のイデアル I の生成元の一覧が与えられたとき、I の加法的な基底表現を求める問題です。",
    idea:
      "The Zoo sets the problem in a model where black boxes implement the addition and multiplication operations on a finite ring R, not necessarily commutative, and records that under addition alone R forms a finite Abelian group (R,+), and that a quantum computer can find in poly(log |R|) time a set of additive generators whose cyclic subgroups decompose (R,+) as a direct product, the number of those generators being polylogarithmic in |R|; that decomposition is what allows efficient computation of a multiplication tensor for R. Wocjan, Jordan, Ahmadi and Brennan carry this from the ring to its ideals: given black-box access to R and a list of generators for an ideal I, their algorithm finds an additive basis representation for I, which the abstract describes as a generalization of a quantum algorithm of Arvind et al. that finds a basis representation for R itself. The paper then treats that basis as a primitive and derives from it procedures to test whether two ideals are identical, find their intersection and their quotient, prove whether a given ring element belongs to a given ideal, prove whether a given element is a unit and if so find its inverse, find the additive and multiplicative identities, compute the order of an ideal, solve linear equations over rings, decide whether an ideal is maximal, find annihilators, and test the injectivity and surjectivity of ring homomorphisms. The abstract states that these problems appear to be hard classically.",
    ideaJa:
      "Zoo は、可換とは限らない有限環 R の加法と乗法を実行するブラックボックスが与えられる設定を前提としたうえで、加法だけに着目すると R が有限可換群 (R,+) をなすこと、そして量子計算機が poly(log |R|) 時間で加法的な生成元の組を求められることを記しています。その生成元が生成する巡回群の直積として (R,+) が分解され、生成元の個数は |R| の多対数程度に収まります。この分解によって R の乗法テンソルを効率的に計算できます。Wocjan、Jordan、Ahmadi、Brennan は、これを環そのものからイデアルへ広げています。R へのブラックボックスアクセスと、イデアル I の生成元の一覧が与えられたとき、彼らのアルゴリズムは I の加法的な基底表現を求めます。要旨はこれを、R 自身の基底表現を求める Arvind らの量子アルゴリズムの一般化であると述べています。論文はこの基底表現をプリミティブとして扱い、そこから、2つのイデアルが一致するかの判定、共通部分と商の計算、与えられた環の元が与えられたイデアルに属することの証明、与えられた元が単元であるかの証明とその場合の逆元の計算、加法単位元と乗法単位元の決定、イデアルの位数の計算、環上の線形方程式の求解、イデアルが極大かどうかの判定、零化子の計算、環準同型の単射性・全射性の判定といった手続きを導いています。要旨は、これらの問題が古典的には困難と見られると述べています。",
    complexity:
      "poly(log |R|) time to find an additive basis representation for an ideal I in a finite ring R, the same order the Zoo states for finding additive generators of (R,+) itself, against known classical algorithms that the Zoo says scale as poly(|R|); neither source quotes an exponent, a constant factor or a gate count, and neither quotes a separate cost for any of the ideal problems derived from the basis.",
    complexityBasis:
      'abstract of arXiv:0908.0022: "We show how to find an additive basis representation for I in poly(log |R|) time." Quantum Algorithm Zoo entry "Finite Rings and Ideals", with the scraped spacing normalized and its LaTeX rendered into Unicode: "on a quantum computer one can find in poly(log |R|) time a set of additive generators {h₁, …, hₘ} ⊂ R" and, from the clause that follows in the same sentence, "m is polylogarithmic in |R|", and, for the classical side, "Known classical algorithms for these problems scale as poly(|R|)." Neither clause carries an exponent, a constant factor, a gate count or a qubit count.',
    caveat:
      "This is a literature record: no ring was represented, no addition or multiplication black box was implemented, and no circuit was built, compiled, simulated or run. poly(log |R|) is asymptotic in the cardinality of the ring, and with no exponent, constant factor, gate count or qubit count stated on either side, nothing here bounds the cost for a concrete ring; the cost of realizing the two black boxes, and of supplying the generating sets both sources assume as input, is outside this record. The long list of ideal problems is reported as a consequence of the basis primitive, and neither source quotes a separate cost for any one of them, so this record fixes no cost for deciding maximality, finding annihilators, or any other item on that list. The classical comparison is the Zoo's own statement that known classical algorithms for these problems scale as poly(|R|), and the abstract says only that these problems appear to be hard classically, so the superpolynomial separation is not a proven lower bound. The decomposition of (R,+), which the Zoo credits to a numbered reference rather than to any named author, the algorithm of Arvind et al. for R itself that the abstract says this result generalizes, and the Zoo's further result that a quantum computer can efficiently decide whether a given polynomial is identically zero on a given finite black-box ring all rest on papers outside this record.",
    caveatJa:
      "本項目は文献に基づく記録です。環を具体的に表現したことも、加法や乗法のブラックボックスを実装したことも、回路を構成・コンパイル・シミュレーション・実行したこともありません。poly(log |R|) は環の位数に関する漸近的な主張であり、量子側にも古典側にも指数・定数因子・ゲート数・量子ビット数の記載がないため、具体的な環に対するコストはここからは分かりません。2つのブラックボックスを実現するコストや、両資料が入力として前提している生成元の組を用意するコストも本項目の対象外です。イデアルに関する一連の問題は、この基底表現をプリミティブとした帰結として報告されているだけで、個々の問題についてのコストはいずれの資料にも示されていません。したがって、極大性の判定や零化子の計算をはじめ、その一覧のどの項目についてもコストは確定していません。古典側は、これらの問題について既知の古典アルゴリズムは poly(|R|) 程度であるという Zoo 自身の記述であり、要旨も「これらの問題は古典的には困難と見られる」と述べているにすぎないため、超多項式的な差は証明された下界ではありません。Zoo が著者名ではなく番号のみで参照している文献に帰している (R,+) の分解、要旨が本結果はその一般化であると述べる Arvind らの R 自身に対するアルゴリズム、および与えられた多項式が与えられた有限ブラックボックス環上で恒等的に零かどうかを量子計算機が効率的に判定できるという Zoo のもう一つの記述は、いずれも本記録の対象外の論文に基づきます。",
    tags: ["finite rings", "ideals", "black-box ring", "abelian group", "additive basis"],
    source: {
      id: "arxiv:0908.0022",
      title: "Efficient quantum processing of ideals in finite rings",
      authors: "Pawel M. Wocjan, Stephen P. Jordan, Hamed Ahmadi, Joseph P. Brennan",
      year: "2009",
      url: "https://arxiv.org/abs/0908.0022",
    },
    literature: [
      {
        title: "Efficient quantum processing of ideals in finite rings",
        authors: "Pawel M. Wocjan, Stephen P. Jordan, Hamed Ahmadi, Joseph P. Brennan",
        year: "2009",
        url: "https://arxiv.org/abs/0908.0022",
        relevance:
          "Primary source: it states the poly(log |R|) additive basis representation for an ideal I given by a list of generators, describes that result as generalizing the quantum algorithm of Arvind et al. for R itself, and presents the basis as a primitive from which the ideal problems listed above are derived. Consult it for the black-box ring model it assumes and for the cost of each derived problem, since the abstract quotes only the one bound.",
        relevanceJa:
          "一次資料です。生成元の一覧で与えられたイデアル I の加法的な基底表現が poly(log |R|) 時間で求まることを述べ、これを R 自身に対する Arvind らの量子アルゴリズムの一般化と位置づけたうえで、その基底表現をプリミティブとして上記のイデアル関連の問題を導いています。要旨に示された評価はこの1つだけなので、前提となるブラックボックス環のモデルや、導出された各問題のコストは原論文で確認してください。",
      },
    ],
    relatedSlugs: ["discrete-logarithm", "shor-period-finding", "hidden-nonlinear-structures", "quantum-fourier-transform"],
  },
  {
    slug: "turaev-viro-invariants",
    title: "Additive approximation of Turaev-Viro 3-manifold invariants",
    titleJa: "Turaev-Viro 3次元多様体不変量の加法的近似",
    family: "Topological invariants",
    zooName: "Three-manifold Invariants",
    zooSection: "Approximation and Simulation Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given a compact, orientable three-manifold presented by a Heegaard splitting, compute a certain additive approximation to its Turaev-Viro invariant, the scalar topological invariant that takes the same value on homeomorphic manifolds.",
    problemJa:
      "Heegaard 分解によって与えられたコンパクトで向き付け可能な3次元多様体に対し、その Turaev-Viro 不変量のある加法的近似を求める問題です。Turaev-Viro 不変量は、同相な多様体には同じ値を与えるスカラーの位相不変量です。",
    idea:
      "The Turaev-Viro invariants are scalar topological invariants of compact, orientable 3-manifolds, and Alagic, Jordan, Koenig and Reichardt give a quantum algorithm that additively approximates them for a manifold presented by a Heegaard splitting. The paper describes the algorithm as motivated by the relationship between topological quantum computers and (2+1)-D topological quantum field theories. The abstract states that its accuracy is shown to be nontrivial in the following sense: the same algorithm, after efficient classical preprocessing, can solve any problem efficiently decidable by a quantum computer, so approximating certain Turaev-Viro invariants of manifolds presented by Heegaard splittings is a universal problem for quantum computation, which the Zoo records by saying that this approximation is BQP-complete. The Zoo sets the result beside an earlier polynomial-time quantum algorithm that additively approximates the Witten-Reshitikhin-Turaev (WRT) invariant of a manifold given by a surgery presentation, notes that squaring the WRT invariant yields the Turaev-Viro invariant, and states that whether the earlier approximation is BQP-complete is unknown.",
    ideaJa:
      "Turaev-Viro 不変量は、コンパクトで向き付け可能な3次元多様体に対するスカラーの位相不変量です。Alagic、Jordan、Koenig、Reichardt は、Heegaard 分解で与えられた多様体についてこの不変量を加法的に近似する量子アルゴリズムを与えています。論文は、このアルゴリズムが位相的量子計算機と (2+1) 次元の位相的量子場理論との関係に動機づけられたものであると述べています。要旨は、その精度が自明でないことが次の意味で示されていると述べています。すなわち、同じアルゴリズムは効率的な古典的前処理を経ることで、量子計算機で効率的に判定できる任意の問題を解くことができ、したがって Heegaard 分解で与えられた多様体の特定の Turaev-Viro 不変量を近似する問題は、量子計算に対して普遍的です。Zoo はこれを、この近似が BQP完全であるという形で記しています。Zoo はさらに、手術表示で与えられた多様体の Witten-Reshitikhin-Turaev (WRT) 不変量を加法的に近似する先行の多項式時間量子アルゴリズムを並べて挙げ、WRT 不変量を2乗すると Turaev-Viro 不変量が得られること、そして先行研究の近似が BQP完全かどうかは分かっていないことを述べています。",
    complexity: "",
    complexityBasis:
      'Two sources were read and neither states a cost for this algorithm. The abstract of arXiv:1003.0923 quotes no running time, query count, gate count or qubit count: it says only "We give a quantum algorithm for additively approximating Turaev-Viro invariants of a manifold presented by a Heegaard splitting" and that "the same algorithm, after efficient classical preprocessing, can solve any problem efficiently decidable by a quantum computer". The Quantum Algorithm Zoo entry "Three-manifold Invariants" is likewise unquantified for this result: "a quantum computer can efficiently find a certain additive approximation to its Turaev-Viro invariant, and this approximation is BQP-complete [ 129 ]." The only clause in that entry naming a running time belongs to a different algorithm in a different reference — "Earlier, in [ 114 ], a polynomial-time quantum algorithm was given to additively approximate the Witten-Reshitikhin-Turaev (WRT) invariant of a manifold given by a surgery presentation" — and that paper is not part of this record, so its bound is not carried over here. BQP-completeness is a statement of hardness rather than a cost, so the field is left empty rather than filled from elsewhere.',
    caveat:
      "This is a literature record: no manifold was presented to any program, no circuit was built, compiled, simulated or run, and no invariant was computed here. Neither source states a running time, query count, gate count or qubit count for this algorithm, so nothing here bounds the cost for a manifold of any given size or genus; the word efficiently carries the claim in the Zoo entry and is left unquantified there. The approximation is additive and neither source quantifies its window, so this record does not establish that the output is usable as a multiplicative estimate of the invariant, and the abstract's claim is that the accuracy is nontrivial rather than that it meets any stated tolerance. BQP-completeness and universality are statements about which problems a quantum computer can solve, not evidence about any device, and they do not by themselves establish that a particular pair of non-homeomorphic 3-manifolds can be told apart. The result is stated for manifolds presented by a Heegaard splitting, and that presentation is part of the statement: the earlier WRT algorithm the Zoo cites takes a surgery presentation, the Zoo records the BQP-completeness of its approximation as unknown, and that algorithm, together with the suggested link between quantum computation and three-manifold invariants that the Zoo cites separately, rests on papers outside this record. The relation that squaring the WRT invariant yields the Turaev-Viro invariant is recorded as the Zoo states it and is not re-derived here.",
    caveatJa:
      "本項目は文献に基づく記録です。多様体を何らかのプログラムに与えたことも、回路を構成・コンパイル・シミュレーション・実行したこともなく、不変量を実際に計算したわけでもありません。いずれの資料も、このアルゴリズムについて実行時間・クエリ数・ゲート数・量子ビット数を示していないため、どの大きさや種数の多様体に対してもコストは確定していません。Zoo の記述では「効率的に」という語が主張の中心にありますが、その定量的な内容は示されていません。近似は加法的なものであり、その誤差幅はどちらの資料にも定量的に示されていないため、出力が不変量の乗法的な推定として使えることは本項目では保証しません。要旨の主張も、精度が自明でないというものであって、特定の許容誤差を満たすというものではありません。BQP完全性や普遍性は、量子計算機がどの問題を解けるかについての主張であって、実機についての証拠ではなく、同相でない特定の3次元多様体の組を区別できることを、それ自体で保証するものでもありません。結果は Heegaard 分解で与えられた多様体についての主張であり、この表示の与え方も主張の一部です。Zoo が挙げる先行の WRT アルゴリズムは手術表示を入力とし、その近似が BQP完全かどうかは分かっていないと Zoo は記しています。この先行アルゴリズムも、Zoo が別途言及する量子計算と3次元多様体不変量との関連の示唆も、本記録の対象外の論文に基づきます。WRT 不変量を2乗すると Turaev-Viro 不変量が得られるという関係は、Zoo の記述をそのまま記録したものであり、ここで導出し直したものではありません。",
    tags: ["turaev-viro", "3-manifold", "topological invariants", "heegaard splitting", "bqp-complete"],
    source: {
      id: "arxiv:1003.0923",
      title: "Approximating Turaev-Viro 3-manifold invariants is universal for quantum computation",
      authors: "Gorjan Alagic, Stephen P. Jordan, Robert Koenig, Ben W. Reichardt",
      year: "2010",
      url: "https://arxiv.org/abs/1003.0923",
    },
    literature: [
      {
        title: "Approximating Turaev-Viro 3-manifold invariants is universal for quantum computation",
        authors: "Gorjan Alagic, Stephen P. Jordan, Robert Koenig, Ben W. Reichardt",
        year: "2010",
        url: "https://arxiv.org/abs/1003.0923",
        relevance:
          "Primary source: it gives the quantum algorithm that additively approximates Turaev-Viro invariants of a manifold presented by a Heegaard splitting, motivates the construction by the relationship between topological quantum computers and (2+1)-D topological quantum field theories, and establishes that approximating certain such invariants is a universal problem for quantum computation, which it presents as a novel relation between distinguishing non-homeomorphic 3-manifolds and the power of a general quantum computer. Consult it for the accuracy the approximation achieves and for the classical preprocessing the universality claim assumes, since the abstract quantifies neither and states no running time.",
        relevanceJa:
          "一次資料です。Heegaard 分解で与えられた多様体の Turaev-Viro 不変量を加法的に近似する量子アルゴリズムを与え、その構成を位相的量子計算機と (2+1) 次元の位相的量子場理論との関係から動機づけたうえで、特定の不変量の近似が量子計算に対して普遍的な問題であることを示しています。論文はこれを、同相でない3次元多様体を区別する課題と一般の量子計算機の能力とを結ぶ新しい関係として提示しています。近似が達成する精度も、普遍性の主張が前提とする古典的前処理も要旨には定量的に示されておらず、実行時間の記載もないため、いずれも原論文で確認してください。",
      },
    ],
    relatedSlugs: ["jones-polynomial-approximation", "amplitude-estimation", "hamiltonian-simulation-ising"],
  },
  {
    slug: "top-eigenvector-estimation",
    title: "Approximating the top eigenvector of a Hermitian matrix",
    titleJa: "エルミート行列の主固有ベクトルの近似",
    family: "Quantum linear algebra",
    zooName: "Computing the Principal Eigenvector",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given query access to the entries of a d × d Hermitian matrix A, output a classical description of a good approximation of its top eigenvector, the eigenvector belonging to the largest eigenvalue.",
    problemJa:
      "d × d のエルミート行列 A の成分へのクエリアクセスが与えられたとき、その主固有ベクトル、すなわち最大固有値に属する固有ベクトルの良い近似を、古典的な記述として出力する問題です。",
    idea:
      "The Zoo separates this from the ground state problem: obtaining the top eigenvector as a quantum state would be equivalent to that problem, whereas what is wanted here is a classical description of the vector. Chen, Gilyén and de Wolf give two quantum algorithms under an assumed constant eigenvalue gap, and the paper describes both as running a version of the classical power method that is robust to certain benign kinds of errors, with each matrix-vector multiplication implemented on a quantum computer with small and well-behaved error. The two differ in how that multiplication is done: the first estimates the matrix-vector product one entry at a time, by a new procedure the paper calls Gaussian phase estimation, while the second uses block-encoding techniques to compute the product as a quantum state and then obtains a classical description from it by a new time-efficient unbiased pure-state tomography procedure. The same paper extends the construction to a classical description of the subspace spanned by the top-q eigenvectors, and proves a nearly-optimal lower bound on the quantum query complexity of approximating the top eigenvector.",
    ideaJa:
      "Zoo はこの問題を基底状態問題と区別しています。主固有ベクトルを量子状態として得るだけであれば基底状態問題と同等ですが、ここで求めるのはそのベクトルの古典的な記述です。Chen、Gilyén、de Wolf は固有値ギャップが定数であるという仮定のもとで二つの量子アルゴリズムを与えており、論文はいずれについても、ある種の穏やかな誤差に対して頑健にした古典のべき乗法を用い、各回の行列ベクトル積を量子計算機上で小さく扱いやすい誤差のもとに実装するものだと説明しています。両者の違いはこの行列ベクトル積の実装方法にあります。一つ目は、論文が Gaussian phase estimation と呼ぶ新しい手続きによって行列ベクトル積を成分ごとに推定し、二つ目は、ブロック符号化の技法によって行列ベクトル積を量子状態として計算したうえで、新しい時間効率のよい不偏な純粋状態トモグラフィーの手続きによってそこから古典的な記述を取り出します。同じ論文は、この構成を上位 q 個の固有ベクトルが張る部分空間の古典的な記述へと拡張し、さらに主固有ベクトルの近似に対する量子クエリ計算量のほぼ最適な下界も示しています。",
    complexity:
      "Two algorithms for a d × d Hermitian matrix under an assumed constant eigenvalue gap: one of time complexity Õ(d^1.75), one of time complexity d^(1.5+o(1)), against the best-possible classical algorithm, which the abstract states needs Ω(d²) queries to the entries of A and hence Ω(d²) time. The same abstract states time q·d^(1.5+o(1)) for a classical description of the subspace spanned by the top-q eigenvectors, and a nearly-optimal lower bound of Ω̃(d^1.5) on the quantum query complexity of approximating the top eigenvector. The Zoo instead gives a single figure, Õ(d^(3/2)) against a best classical Õ(d²), which matches neither of the abstract's two upper bounds exactly.",
    complexityBasis:
      'abstract of arXiv:2405.14765 (TeX rendered into Unicode: the abstract\'s tilde-O written Õ, tilde-Omega written Ω̃, math delimiters removed): "We give two different quantum algorithms that, given query access to the entries of a Hermitian matrix A and assuming a constant eigenvalue gap, output a classical description of a good approximation of the top eigenvector: one algorithm with time complexity Õ(d^{1.75}) and one with time complexity d^{1.5+o(1)}", "Both of our quantum algorithms provide a polynomial speed-up over the best-possible classical algorithm, which needs Ω(d^2) queries to entries of A, and hence Ω(d^2) time", "We extend this to a quantum algorithm that outputs a classical description of the subspace spanned by the top-q eigenvectors in time qd^{1.5+o(1)}", and "We also prove a nearly-optimal lower bound of Ω̃(d^{1.5}) on the quantum query complexity of approximating the top eigenvector." The single Zoo figure is from the Quantum Algorithm Zoo entry "Computing the Principal Eigenvector" (widetilde O rendered Õ, math delimiters removed, reference number and its spacing left as written): "The quantum of [ 462 ] runs in time Õ(d^{3/2}) whereas the best classical algorithm runs in time Õ(d^2)." That sentence is quoted as the Zoo has it, missing noun included.',
    caveat:
      "This is a literature record: nothing was constructed, compiled, simulated, run or benchmarked here, and no matrix's top eigenvector was approximated. Both upper bounds are stated under the constant eigenvalue gap the abstract assumes, and neither source says what the cost becomes when that gap is small or absent. The figures are asymptotic complexities in a model whose input is query access to the entries of A, so no gate count, qubit count, constant factor or error-correction budget follows from them, and the cost of realizing that entry oracle is outside this record. The exponent in d^(1.5+o(1)) carries an o(1) that the abstract does not quantify, so it is not the same claim as Õ(d^1.5), and the Ω̃(d^1.5) lower bound is stated for quantum query complexity rather than for time; nothing here closes the distance between the two. The output quality is stated only as a good approximation: the abstract says the first algorithm has a slightly better dependence on the ℓ₂-error of the approximating vector than the second, without giving either dependence, so no accuracy is fixed by this record. The Zoo's Õ(d^(3/2)) matches neither of the abstract's two upper bounds exactly, and the Zoo cites its reference by number only, so this record does not establish that the two sources describe the same algorithm; the difference is recorded, not reconciled. The classical Ω(d²) is the abstract's own statement about the best-possible classical algorithm, and the argument behind it was not read here.",
    caveatJa:
      "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行、ベンチマークはいずれも行っておらず、具体的な行列の主固有ベクトルを近似したこともありません。二つの上界はいずれも、要旨が仮定する定数の固有値ギャップのもとでの主張であり、そのギャップが小さい場合や存在しない場合にコストがどうなるかは、いずれの資料にも述べられていません。示されている値は、A の成分へのクエリアクセスを入力とするモデルでの漸近的な計算量であり、ゲート数、量子ビット数、定数因子、誤り訂正の見積もりはいずれも導けません。成分オラクルを実現するコストも本記録の対象外です。d^(1.5+o(1)) の指数に含まれる o(1) は要旨では定量化されていないため、これは Õ(d^1.5) とは別の主張です。また Ω̃(d^1.5) は時間ではなく量子クエリ計算量に対する下界であり、両者の隔たりは本記録では埋まっていません。出力の精度についても「良い近似」と述べられているだけです。要旨は、一つ目のアルゴリズムのほうが近似ベクトルの ℓ₂ 誤差への依存性がわずかに良いと述べていますが、その依存性そのものは示していないため、本記録は精度を確定していません。Zoo の Õ(d^(3/2)) は要旨の二つの上界のいずれとも正確には一致せず、Zoo は出典を参照番号でしか示していないため、本記録は両資料が同じアルゴリズムを述べていることを確認したものではありません。この食い違いは記録するにとどめ、ここでは解消していません。古典側の Ω(d²) も、可能な最良の古典アルゴリズムについての要旨自身の主張であり、その根拠はここでは参照していません。",
    tags: ["principal eigenvector", "power method", "block encoding", "tomography", "query complexity"],
    source: {
      id: "arxiv:2405.14765",
      title: "A Quantum Speed-Up for Approximating the Top Eigenvectors of a Matrix",
      authors: "Yanlin Chen, András Gilyén, Ronald de Wolf",
      year: "2024",
      url: "https://arxiv.org/abs/2405.14765",
    },
    literature: [
      {
        title: "A Quantum Speed-Up for Approximating the Top Eigenvectors of a Matrix",
        authors: "Yanlin Chen, András Gilyén, Ronald de Wolf",
        year: "2024",
        url: "https://arxiv.org/abs/2405.14765",
        relevance:
          "Primary source: it states the query-access input model, the constant eigenvalue gap assumption, the two time complexities Õ(d^1.75) and d^(1.5+o(1)), the classical Ω(d²) it measures them against, the q·d^(1.5+o(1)) extension to the top-q eigenvector subspace and the Ω̃(d^1.5) quantum query lower bound. It also names the two mechanisms, Gaussian phase estimation for the entry-by-entry route and block-encoding plus unbiased pure-state tomography for the state-based route. Consult it for the ℓ₂-error dependence of each algorithm and for what the o(1) in the exponent hides, neither of which the abstract states.",
        relevanceJa:
          "一次資料です。クエリアクセスという入力モデル、定数の固有値ギャップという仮定、二つの時間計算量 Õ(d^1.75) と d^(1.5+o(1))、比較対象となる古典側の Ω(d²)、上位 q 個の固有ベクトルが張る部分空間への q·d^(1.5+o(1)) の拡張、および量子クエリ計算量の下界 Ω̃(d^1.5) が述べられています。機構についても、成分ごとに推定する経路の Gaussian phase estimation と、量子状態を経由する経路のブロック符号化および不偏な純粋状態トモグラフィーという二つが名指しされています。各アルゴリズムの ℓ₂ 誤差への依存性と、指数に含まれる o(1) の中身は要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: [
      "spectral-sum-estimation",
      "quantum-phase-estimation",
      "quantum-singular-value-transformation",
      "hhl-linear-systems",
    ],
  },
  {
    slug: "zero-sum-game-equilibria",
    title: "Approximate Nash equilibria of zero-sum games by dynamic Gibbs sampling",
    titleJa: "動的 Gibbs サンプリングによるゼロ和ゲームの近似 Nash 均衡",
    family: "Markov-chain sampling",
    zooName: "Approximating Nash Equilibria",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Polynomial",
    speedupPrimary: { states: "unknown" },
    problem:
      "Given oracle access to the m × n payoff matrix of a zero-sum game with bounded entries, compute a classical representation of an ε-approximate Nash equilibrium of that game.",
    problemJa:
      "成分が有界な m × n の利得行列で与えられるゼロ和ゲームについて、その行列へのオラクルアクセスのもとで ε 近似 Nash 均衡の古典的な表現を求める問題です。",
    idea:
      "The Zoo states the route in one clause: the runtime is reached by making a connection between Nash equilibria and Gibbs sampling. Bouland, Getachew, Jin, Sidford and Tian write that they obtain their result by designing new quantum data structures for efficiently sampling from a slowly-changing Gibbs distribution, which the paper's title calls improved dynamic Gibbs sampling. The input model is a standard quantum oracle for accessing the payoff matrix, whose entries are assumed bounded, and the stated output is a classical representation of the ε-approximate Nash equilibrium. The paper sets that runtime against the best prior quantum runtime and against the classical runtime it cites, and names the range of ε over which its improvement is claimed.",
    ideaJa:
      "Zoo はこの道筋を一節で述べています。すなわち、Nash 均衡と Gibbs サンプリングを結びつけることでこの実行時間に到達する、というものです。Bouland、Getachew、Jin、Sidford、Tian は、ゆっくり変化する Gibbs 分布から効率的にサンプリングするための新しい量子データ構造を設計することでこの結果を得たと述べており、論文の表題はこれを改良された動的 Gibbs サンプリングと呼んでいます。入力モデルは利得行列にアクセスするための標準的な量子オラクルで、その成分は有界であると仮定されており、出力として述べられているのは ε 近似 Nash 均衡の古典的な表現です。論文はこの実行時間を、従来の最良の量子アルゴリズムの実行時間と、論文が挙げる古典アルゴリズムの実行時間の双方と対比し、改善が主張できる ε の範囲も明示しています。",
    complexity:
      "Õ(√(m+n)·ε^(-2.5) + ε^(-3)) time, given a standard quantum oracle for accessing the payoff matrix, to output a classical representation of an ε-approximate Nash equilibrium; the abstract sets this against the best prior quantum runtime Õ(√(m+n)·ε^(-3)) and the classic Õ((m+n)·ε^(-2)), and states the improvement whenever ε = Ω((m+n)^(-1)). The Zoo quotes the same quantum runtime and the same classical Õ((m+n)·ε^(-2)), and states no runtime for the prior result it says this algorithm improves on.",
    complexityBasis:
      'abstract of arXiv:2301.03763 (TeX rendered into Unicode: widetilde O written Õ, epsilon written ε, \\cdot written ·, \\sqrt{m+n} written √(m+n), math delimiters removed): "Given a standard quantum oracle for accessing the payoff matrix our algorithm runs in time Õ(√(m + n)·ε^{-2.5} + ε^{-3}) and outputs a classical representation of the ε-approximate Nash equilibrium", and "This improves upon the best prior quantum runtime of Õ(√(m + n)·ε^{-3}) obtained by [vAG19] and the classic Õ((m + n)·ε^{-2}) runtime due to [GK95] whenever ε = Ω((m +n)^{-1})." The Quantum Algorithm Zoo entry "Approximating Nash Equilibria" states the same contrast, rendered the same way and with its reference-number spacing left as written: "Classically, the best algorithm for this has runtime Õ((m+n) ε^{-2}). The quantum algorithm of [ 485 ], improving on the prior result of [ 486 ] achieves this in runtime Õ(√(m+n) ε^{-2.5} + ε^{-3}) by making a connection between Nash equilibria and Gibbs sampling."',
    caveat:
      "This is a literature record: nothing was constructed, compiled, simulated, run or benchmarked, and no game was solved here. The runtime is asymptotic and its Õ suppresses factors neither source names, so no gate count, qubit count, constant factor, error-correction budget or wall-clock time follows from it. The abstract attaches the condition ε = Ω((m+n)^(-1)) to its improvement claim, so outside that range of ε neither comparison it makes is asserted, and the gain in dimension, √(m+n) against m+n, is bought with a worse dependence on the accuracy, ε^(-2.5) plus an additive ε^(-3) against ε^(-2); this record does not establish where the crossover falls for any concrete m, n and ε. The result assumes a standard quantum oracle for the payoff matrix and bounded entries, and the cost of providing that oracle, together with what the new quantum data structures cost to build and maintain, is outside this record. Neither source defines what ε-approximate means for the equilibrium, and the statement is for zero-sum games only, so nothing here bears on general-sum games. The classical figure is attributed by the abstract to [GK95] as the runtime being improved on rather than as a proved lower bound, and the prior quantum runtime is attributed to [vAG19]. The Zoo cites by number only, and its numbers do not line up with those two: [ 485 ] is the algorithm this record covers and [ 486 ] the prior result it improves on. The Zoo states no runtime for [ 486 ] and attaches no reference number to the classical figure at all. This record reads none of those references and does not establish which papers the Zoo's numbers denote.",
    caveatJa:
      "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行、ベンチマークはいずれも行っておらず、具体的なゲームを解いたこともありません。示されている実行時間は漸近的なもので、Õ が隠している因子はいずれの資料にも示されていないため、ゲート数、量子ビット数、定数因子、誤り訂正の見積もり、実時間はここからは分かりません。要旨は改善の主張に ε = Ω((m+n)^(-1)) という条件を付しており、この範囲を外れる ε については、要旨が挙げる二つの比較のいずれも主張されていません。また、次元に関する m+n から √(m+n) への利得は、精度への依存性の悪化、すなわち ε^(-2) に対する ε^(-2.5) と加法項 ε^(-3) と引き換えに得られたものであり、具体的な m、n、ε でどこが分かれ目になるかは本記録では確定していません。この結果は利得行列に対する標準的な量子オラクルと成分の有界性を仮定しており、そのオラクルを用意するコストや、新しい量子データ構造の構築と更新に要するコストは本記録の対象外です。ε 近似の定義はいずれの資料にも示されておらず、主張の対象はゼロ和ゲームに限られるため、一般和ゲームについては何も述べていません。古典側の値は、要旨において改善の対象として [GK95] に帰されたものであって証明された下界ではなく、従来の最良の量子アルゴリズムの実行時間は [vAG19] に帰されています。Zoo の引用は番号のみで、その番号はこの二つとは対応していません。[ 485 ] は本記録が扱う量子アルゴリズム、[ 486 ] はそれが改善した従来の結果です。Zoo は [ 486 ] の実行時間を示しておらず、古典側の値には参照番号自体を付していません。本記録はこれらの参照文献をいずれも参照しておらず、Zoo の番号がどの論文を指すかも確認していません。",
    tags: ["zero-sum game", "nash equilibrium", "gibbs sampling", "payoff matrix", "quantum data structures"],
    source: {
      id: "arxiv:2301.03763",
      title: "Quantum Speedups for Zero-Sum Games via Improved Dynamic Gibbs Sampling",
      authors: "Adam Bouland, Yosheb Getachew, Yujia Jin, Aaron Sidford, Kevin Tian",
      year: "2023",
      url: "https://arxiv.org/abs/2301.03763",
    },
    literature: [
      {
        title: "Quantum Speedups for Zero-Sum Games via Improved Dynamic Gibbs Sampling",
        authors: "Adam Bouland, Yosheb Getachew, Yujia Jin, Aaron Sidford, Kevin Tian",
        year: "2023",
        url: "https://arxiv.org/abs/2301.03763",
        relevance:
          "Primary source: it states the bounded-entry m × n payoff matrix, the standard quantum oracle input model, the Õ(√(m+n)·ε^(-2.5) + ε^(-3)) runtime, the classical representation of the output, and the comparison with Õ(√(m+n)·ε^(-3)) from [vAG19] and Õ((m+n)·ε^(-2)) from [GK95] under ε = Ω((m+n)^(-1)). It attributes the speedup to new quantum data structures for efficiently sampling from a slowly-changing Gibbs distribution. Consult it for the definition of the ε-approximation and for what those data structures cost per update, neither of which the abstract states.",
        relevanceJa:
          "一次資料です。成分が有界な m × n の利得行列、標準的な量子オラクルという入力モデル、実行時間 Õ(√(m+n)·ε^(-2.5) + ε^(-3))、出力が古典的な表現であること、および ε = Ω((m+n)^(-1)) のもとでの [vAG19] の Õ(√(m+n)·ε^(-3)) と [GK95] の Õ((m+n)·ε^(-2)) との比較が述べられています。高速化の要因は、ゆっくり変化する Gibbs 分布から効率的にサンプリングするための新しい量子データ構造に帰されています。ε 近似の定義と、そのデータ構造の更新1回あたりのコストは要旨に記載がないため、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["gibbs-state-sampling", "quantum-simulated-annealing", "decoded-quantum-interferometry"],
  },
  {
    slug: "sparse-matrix-power-diagonal-entries",
    title: "Diagonal entries of powers of a sparse symmetric matrix",
    titleJa: "疎な対称行列のべき乗の対角成分",
    family: "PromiseBQP-complete problem",
    zooName: "Matrix Powers",
    zooSection: "Approximation and Simulation Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: {
      states: "reported",
      quote: "Our results show that quantum computation outperforms classical computation in estimating the diagonal entries (provided that BQP≠BPP). But one has to be very careful on which scale this result remains true.",
    },
    problem: "Given a real symmetric N × N matrix A whose rows are sparse — the non-zero positions and values of any row returned by an efficiently computable function rather than stored — together with an index j, an integer power m, an a priori bound b on the norm of A, a threshold g and a precision ε, decide whether the diagonal entry (A^m)_jj is at least g + εb^m or at most g − εb^m.",
    problemJa: "実対称な N × N 行列 A について、各行が疎であり、その行の非零成分の位置と値が、行列を格納するのではなく効率的に計算可能な関数によって返されるとします。添字 j、べき指数 m、ノルムの事前上界 b、しきい値 g、精度 ε が与えられたとき、対角成分 (A^m)_jj が g + εb^m 以上であるか、g − εb^m 以下であるかを判定する問題です。",
    idea: "Janzing and Wocjan read the matrix as a Hamiltonian. Because A is sparse the evolution exp(iA) can be simulated efficiently, so phase estimation applied to the basis state |j⟩ samples the spectral measure of which the diagonal entry is the m-th moment; raising each measured eigenvalue to the m-th power and averaging estimates (A^m)_jj. The hardness direction runs the other way and is what makes the problem interesting: an arbitrary BQP circuit Y is turned into U := Y σ_z Y†, then into a cyclic-shift unitary W built from U's elementary gates, and A := (W + W†)/2 is sparse and self-adjoint, with a diagonal entry of a suitable power of A recovering the circuit's difference between accepting and rejecting probabilities. The paper states the size of the phase-estimation control register explicitly, at p := 2⌈log((48m)/ε)⌉ qubits. Off-diagonal entries are also shown to lie in BQP, but the hardness proof needs only the diagonal ones, so that is where the authors concentrate. A later section strengthens the hardness to matrices whose entries are drawn from {0, ±1}.",
    ideaJa: "Janzing と Wocjan は、この行列をハミルトニアンとして読みます。A が疎であるため発展 exp(iA) は効率的にシミュレートでき、基底状態 |j⟩ に位相推定を適用すると、対角成分がその m 次モーメントであるようなスペクトル測度からの標本が得られます。測定された各固有値を m 乗して平均をとれば (A^m)_jj が推定できます。この問題を興味深いものにしているのは逆向きの困難性の証明です。任意の BQP 回路 Y から U := Y σ_z Y† を作り、さらに U の基本ゲートから巡回シフトのユニタリ W を構成すると、A := (W + W†)/2 は疎かつ自己共役となり、その適当なべきの対角成分が、回路の受理確率と棄却確率の差を復元します。論文は位相推定の制御レジスタの大きさを p := 2⌈log((48m)/ε)⌉ 量子ビットと明示しています。非対角成分も BQP に属することが示されていますが、困難性の証明に必要なのは対角成分だけであり、著者らはそちらに集中しています。後の節では、成分が {0, ±1} に限られる行列にまで困難性が強められています。",
    complexity: "Polylogarithmic in the matrix dimension. The abstract places the problem in BQP when m and ε are respectively polylogarithmic and inverse polylogarithmic in N, and the proof states that the estimate can be produced with time and space polynomial in n, m and 1/ε, where N = 2^n. Phase estimation is run with p := 2⌈log((48m)/ε)⌉ control qubits.",
    complexityBasis: 'abstract of arXiv:quant-ph/0606229: "m and ǫ are polylogarithmic and inverse polylogarithmic in N, respectively"; section 3: "Furthermore, this can be achieved by using time and space resources which are polynomial in n, m, and 1/ǫ. This completes the proof that diagonal entry estimation is in BQP."; and, for the control register, section 3 equation (4): "The number of control qubits can be chosen to be p := 2⌈log((48 m)/ǫ)⌉".',
    caveat: "This is a literature record: no circuit was built, compiled, simulated or run, and no matrix entry was estimated here. The precision is relative to a scale the caller supplies, and the paper is explicit that this is where the result lives or dies — section 2 states that the scale on which the estimation has reasonable precision is b^m, so a caller who knows only the looser bound b′ := 2b on the norm loses accuracy by the exponential factor 2^m. An additive error of εb^m is therefore not an additive error of ε, and a bound on the norm that is wrong by a constant factor degrades the guarantee exponentially in m. The matrix is not given as data but through an efficiently computable function returning a row's non-zero entries and their positions, so nothing here bounds the cost of providing that access for a matrix that is merely stored. The separation from classical computation is conditional on BQP ≠ BPP, which is unproven, and the paper says so at both places it makes the claim. BQP-hardness is established for diagonal entries only; off-diagonal entries are shown to be in BQP but are not shown to be hard. Finally this is a completeness result about a promise problem, not a finding that any matrix arising in practice is hard, and the Zoo's title for this entry — \"A simple promiseBQP-complete matrix problem\", the Theory of Computing version — is not the title the arXiv document cited here prints.",
    caveatJa: "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、具体的な行列成分を推定したわけでもありません。精度は呼び出し側が与える尺度に対する相対的なものであり、論文はこの点こそが結果の成否を分けると明言しています。第2節は、まともな精度が得られる尺度が b^m であることを述べており、ノルムの上界として b′ := 2b というより緩いものしか知らない場合、精度は 2^m という指数因子だけ悪化します。したがって εb^m の加法誤差は ε の加法誤差ではなく、ノルムの上界が定数倍だけ外れているだけで、保証は m について指数的に劣化します。行列はデータとして与えられるのではなく、指定された行の非零成分とその位置を返す効率的に計算可能な関数を通じて与えられるため、単に格納された行列に対してそのアクセスを用意するコストについては、ここからは何も言えません。古典計算との分離は未証明の仮定 BQP ≠ BPP に依存しており、論文もこの主張を行う二箇所の両方でそう述べています。BQP 困難性が示されているのは対角成分についてのみであり、非対角成分は BQP に属することは示されていますが、困難であることは示されていません。またこれは約束問題に関する完全性の結果であって、実際に現れる行列が困難であるという主張ではありません。なお Zoo がこの項目に与えている題名「A simple promiseBQP-complete matrix problem」は Theory of Computing 版のものであり、ここで引用している arXiv 版の論文が掲げる題名とは異なります。",
    tags: ["matrix powers", "promisebqp-complete", "sparse matrix", "phase estimation", "spectral measure"],
    source: {
      id: "arxiv:quant-ph/0606229",
      title: "Estimating diagonal entries of powers of sparse symmetric matrices is BQP-complete",
      authors: "Dominik Janzing, Pawel Wocjan",
      year: "2006",
      url: "https://arxiv.org/abs/quant-ph/0606229",
    },
    literature: [
      {
        title: "Estimating diagonal entries of powers of sparse symmetric matrices is BQP-complete",
        authors: "Dominik Janzing, Pawel Wocjan",
        year: "2006",
        url: "https://arxiv.org/abs/quant-ph/0606229",
        relevance: "Primary source, and the source of this record's cost claim. Consult it for the sparse-access model it assumes, for the b^m scale that the accuracy guarantee is stated relative to, and for the reduction from an arbitrary BQP circuit to a diagonal entry of a matrix power. The Quantum Algorithm Zoo cites this work under the title of its Theory of Computing version, \"A simple promiseBQP-complete matrix problem\"; the arXiv document is the same work by the same two authors under a different title.",
        relevanceJa: "一次資料であり、本記録の計算量の出典です。前提とされている疎行列へのアクセスモデル、精度保証が相対的に述べられている尺度 b^m、および任意の BQP 回路から行列べきの対角成分への帰着については、原論文で確認してください。Quantum Algorithm Zoo はこの研究を Theory of Computing 版の題名「A simple promiseBQP-complete matrix problem」で引用していますが、arXiv 版は同じ二人の著者による同じ研究が別の題名で公開されたものです。",
      },
    ],
    relatedSlugs: ["string-rewriting-derivation-counts", "jones-polynomial-approximation", "hamiltonian-simulation-ising"],
  },
  {
    slug: "string-rewriting-derivation-counts",
    title: "String rewriting derivation counts",
    titleJa: "文字列書き換えにおける導出数の差",
    family: "PromiseBQP-complete problem",
    zooName: "String Rewriting",
    zooSection: "Approximation and Simulation Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: {
      states: "reported",
      quote: "Given that BQP≠BPP, our result shows that the quantum computer outperforms the classical computer in estimating differences of combinatorial quantities.",
    },
    problem: "Fix a relation that permits replacing one substring by another. Given strings s, t and t′ of length L, let Δ(n) be the number of ways of reaching t from s in exactly n replacements minus the number of ways of reaching t′. Given a promise that |Δ(m)| ≥ εc^m for the input m, and a growth promise that Δ(n) ≤ c^n for every n, determine the sign of Δ(m).",
    problemJa: "ある部分文字列を別の部分文字列に置き換えることを許す関係を固定します。長さ L の文字列 s, t, t′ が与えられたとき、s からちょうど n 回の置換で t に到達する方法の数から、t′ に到達する方法の数を引いたものを Δ(n) とします。入力 m に対する約束 |Δ(m)| ≥ εc^m と、すべての n についての増大に関する約束 Δ(n) ≤ c^n のもとで、Δ(m) の符号を決定する問題です。",
    idea: "The replacement relation defines an adjacency matrix A on strings, and Δ(m) becomes a difference of expectation values of A^m in the two states (|s⟩ ± |φ⟩)/√2, which Hamiltonian simulation and phase estimation can estimate. Rather than estimating A^m directly the algorithm estimates a Lipschitz-clipped function of A, clipped at ±c^m, and it is this clipping that lets the growth promise control the error. The hardness direction encodes an arbitrary quantum circuit into a translationally invariant, finite-range Hamiltonian on a chain of qudits — program, data and auxiliary bands, using only Toffoli and Hadamard gates — and shows that an entry of a power of that Hamiltonian equals the circuit's difference of accepting and rejecting probabilities. A final step converts the Hamiltonian into a genuine 0/1 adjacency matrix by adding a simulator band that absorbs the ±1/√2 entries the Hadamard gate contributes. The authors are explicit that this is not a corollary of their own earlier sparse-matrix result: string rewriting appears as an instance of that problem only if one neglects the promises, so the entire argument had to be reworked.",
    ideaJa: "置換の関係は文字列上の隣接行列 A を定めており、Δ(m) は二つの状態 (|s⟩ ± |φ⟩)/√2 における A^m の期待値の差として表されるため、ハミルトニアンシミュレーションと位相推定によって推定できます。アルゴリズムは A^m を直接推定するのではなく、±c^m で切り詰めた A のLipschitz連続な関数を推定します。誤差を増大の約束によって制御できるのは、この切り詰めのおかげです。困難性の証明では、任意の量子回路を、qudit の鎖の上の並進不変で有限レンジのハミルトニアンへ符号化します。プログラム帯、データ帯、補助帯を用い、ゲートは Toffoli と Hadamard のみです。そしてそのハミルトニアンのべきの成分が、回路の受理確率と棄却確率の差に一致することを示します。最後の段階では、Hadamard ゲートが生む ±1/√2 の成分を吸収するシミュレータ帯を加えることで、ハミルトニアンを正真正銘の 0/1 隣接行列へと変換します。著者らは、これが自分たちの以前の疎行列の結果の系ではないことを明言しています。文字列書き換えがその問題の一例に見えるのは約束を無視した場合だけであり、議論全体を作り直す必要があったと述べています。",
    complexity: "",
    complexityBasis: 'The source states no resource bound for this record. arXiv:0705.1180 section 3 gives an accuracy rather than a cost — "we obtain an estimation of ∆s,t,t′(m) up to an error of ǫc^m with any desired probability that is inverse polynomially close to 1" — and defers the circuit itself: "It is straightforward but technical to construct a quantum circuit ... that it solves String Rewriting in the sense of Definition 2." Read for this: the abstract, sections 1, 2, 3 and 5, and the definitions and footnotes in section 2. Note also that the abstract and the body disagree on how m may grow — the abstract says "an integer m that is polylog- arithmic in L", while Definition 1 in section 2 takes "a positive integer m = poly(L) as input" — so no growth rate for m is stated here either.',
    caveat: "This is a literature record: no circuit was built, compiled, simulated or run, and no rewriting instance was decided here. The result is stated for a promise problem and rests on two promises at once, a gap promise and a growth promise, and the paper says the estimation procedure is quite sensitive to the growth bound — the bound is not a formality but the thing that fixes the smallest scale on which Δ(m) can be estimated at all. The hardness half is proved only for length-preserving replacement relations; the paper asserts, in a footnote, that a relation identifying substrings of different lengths still yields a problem in PromiseBQP, but does not prove hardness for that case here. The separation from classical computation is conditional on BQP ≠ BPP, which is unproven. No gate count, qubit count or running time is stated anywhere in the text read, and the abstract and body disagree about whether m is polylogarithmic in L or polynomial in it, so this record states no cost rather than picking one of the two.",
    caveatJa: "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、具体的な書き換えの問題例を判定したわけでもありません。結果は約束問題として述べられ、隔たりに関する約束と増大に関する約束という二つの約束に同時に依存しています。論文は、推定手続きがこの増大の上界に対してかなり敏感であると述べており、この上界は形式的な条件ではなく、そもそも Δ(m) を推定できる最小の尺度を定めるものです。困難性の側が証明されているのは長さを保つ置換関係についてのみです。論文は脚注で、異なる長さの部分文字列を同一視する関係でも問題は PromiseBQP に属すると述べていますが、その場合の困難性はここでは証明していません。古典計算との分離は未証明の仮定 BQP ≠ BPP に依存します。参照した本文のどこにもゲート数、量子ビット数、実行時間は示されておらず、さらに m が L の多重対数か多項式かについて要旨と本文が食い違っているため、本記録はどちらかを選ぶのではなく、計算量を述べないという立場をとっています。",
    tags: ["string rewriting", "promisebqp-complete", "adjacency matrix", "phase estimation", "combinatorial counting"],
    source: {
      id: "arxiv:0705.1180",
      title: "A PromiseBQP-complete String Rewriting Problem",
      authors: "Dominik Janzing, Pawel Wocjan",
      year: "2007",
      url: "https://arxiv.org/abs/0705.1180",
    },
    literature: [
      {
        title: "A PromiseBQP-complete String Rewriting Problem",
        authors: "Dominik Janzing, Pawel Wocjan",
        year: "2007",
        url: "https://arxiv.org/abs/0705.1180",
        relevance: "Primary source. Consult it for the two promises the result depends on, for the Lipschitz clipping that makes the growth promise usable, and for the encoding of a quantum circuit into a translationally invariant qudit chain. It is also the place to check the disagreement between the abstract and Definition 1 about how the power m may grow with the string length, which is why this record states no cost.",
        relevanceJa: "一次資料です。結果が依存する二つの約束、増大の約束を利用可能にする Lipschitz 切り詰め、そして量子回路を並進不変な qudit 鎖へ符号化する方法については、原論文で確認してください。また、べき指数 m が文字列長に対してどのように増大しうるかについて要旨と定義1が食い違っている点も原論文で確認できます。本記録が計算量を述べていないのはこのためです。",
      },
    ],
    relatedSlugs: ["sparse-matrix-power-diagonal-entries", "jones-polynomial-approximation", "quantum-phase-estimation"],
  },
  {
    slug: "zeta-function-of-a-curve",
    title: "Zeta function of a curve over a finite field",
    titleJa: "有限体上の曲線のゼータ関数",
    family: "Computational number theory",
    zooName: "Zeta Functions",
    zooSection: "Approximation and Simulation Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: {
      states: "reported",
      quote: "For g fixed, the approach introduced by Schoof [22] ... gives an algorithm which is polynomial in log(q) but exponential in g ... imitating Dwork's proof ... yields an algorithm which is polynomial in p, g and logp(q), as observed by Lauder and Wan [15]. However, a single algorithm for computing P(t) in time polynomial both in g and log(q) remains elusive.",
    },
    problem: "Given a curve C of genus g over a finite field F_q, compute the numerator P(t) of its zeta function Z(C,t) = P(t)/((1−t)(1−qt)), a polynomial of degree 2g with integer coefficients, in time polynomial in g and log q jointly rather than in one at the expense of the other.",
    problemJa: "有限体 F_q 上の種数 g の曲線 C が与えられたとき、そのゼータ関数 Z(C,t) = P(t)/((1−t)(1−qt)) の分子 P(t)、すなわち整数係数の 2g 次多項式を計算する問題です。目標は、g と log q のどちらか一方を犠牲にするのではなく、両方について同時に多項式時間で計算することです。",
    idea: "Kedlaya reduces the problem to computing the order of the degree-zero divisor class group Cl(C_n) for several small n, and then recovers the coefficients of P(t) from those orders through the Newton-Girard identities — an effectivization of a theorem of Fried on cyclic resultants. Each group order is obtained by presenting Cl(C_n) as a black box group with unique encodings, its elements being reduced effective divisors supplied by an effective Riemann-Roch theorem, and then invoking Watrous's quantum algorithm for the order of a black box abelian group, itself a Shor-type Fourier-sampling method. A generating set for Cl(C) is produced by a Monte Carlo procedure that samples random points and divisors on the curve, and the correctness of that sampling is controlled by the Riemann hypothesis for curves, which bounds the point counts. The paper is a reduction of a number-theoretic problem to an abelian hidden-subgroup routine rather than a new quantum primitive.",
    ideaJa: "Kedlaya はこの問題を、いくつかの小さな n について次数0の因子類群 Cl(C_n) の位数を求める問題へ帰着させ、その位数から Newton-Girard の公式によって P(t) の係数を復元します。これは巡回終結式に関する Fried の定理を実効的にしたものです。各群の位数は、Cl(C_n) を一意な符号化をもつブラックボックス群として表示することで得られます。その元は実効的な Riemann-Roch の定理から得られる被約な有効因子であり、そこに可換ブラックボックス群の位数を求める Watrous の量子アルゴリズム、すなわち Shor 型の Fourier サンプリング法を適用します。Cl(C) の生成系は、曲線上の点や因子を無作為に取る Monte Carlo 的な手続きによって得られ、その正しさは点の個数を評価する曲線に対する Riemann 予想によって保証されます。この論文は新しい量子プリミティブを与えるものではなく、数論的な問題を可換隠れ部分群のルーチンへ帰着させたものです。",
    complexity: "Polynomial in g and log q jointly. The paper states this as a theorem for computing the numerator P(t), and states the subroutine bounds separately: Watrous's black-box group order routine runs in time polynomial in mn, and the class number #Cl(C_e) is computable in time polynomial in g, log q and e. No exponent or constant factor is given.",
    complexityBasis: 'abstract of arXiv:math/0411623: "We exhibit a quantum algorithm for determining the zeta function of a genus g curve over a finite field Fq, which is polynomial in g and log(q)."; section 1, Theorem 1: "There is a quantum algorithm for computing the numerator P(t) of the zeta function, which is polynomial time in g, log(q)."; section 7, Proposition 11: "there exists a quantum algorithm to compute #Cl(Ce) in time polynomial in g, log(q), e."; section 3, Lemma 2, for the subroutine: "there is a quantum algorithm, running in time polynomial in mn, for computing the order of G".',
    caveat: "This is a literature record: nothing was constructed, compiled, simulated or run, and no zeta function was computed here. The headline theorem is stated unconditionally, but the machinery that finds a generating set is proved only under the assumption 16g < q^(1/2), and lifting that restriction to obtain the general theorem imports an external prime-gap result from analytic number theory, a theorem of Harman, rather than deriving it — so the general statement rests on a separately published result whose effective constants the author notes seem to be new to that paper. The author is himself uneasy about this route, calling the resulting lemma awkwardly intricate and remarking that in practice a generating set is quite likely to come from any reasonably arbitrary process. The result covers curves only; the paper says that varieties of fixed higher dimension seem to pose more serious challenges and leaves them as an open question. The algorithm makes 2g calls to the quantum oracle and the paper describes breaking that barrier as requiring a fundamental new idea. It also notes that while the exponent of a black box group is easy to verify, it is less clear how to verify its order efficiently, so the output is not accompanied by a cheap classical check. The complexity is asymptotic and no gate count, qubit count or constant factor is stated. The classical comparison quoted above is against the best algorithms the author names, Schoof and Lauder-Wan, not against a proved lower bound, and the paper does not use the word superpolynomial.",
    caveatJa: "本項目は文献に基づく記録です。ここで何かを構成・コンパイル・シミュレート・実行したことはなく、具体的なゼータ関数を計算したわけでもありません。主定理は無条件の形で述べられていますが、生成系を見つける機構が証明されているのは 16g < q^(1/2) という仮定のもとだけであり、この制限を外して一般の定理を得る段階では、解析的整数論における素数間隔に関する外部の結果、すなわち Harman の定理を導出するのではなく引用しています。したがって一般の主張は、実効的な定数がその論文で初めて得られたと著者が述べている別発表の結果に依存しています。著者自身もこの経路には落ち着かないようで、そこから得られる補題を扱いにくく入り組んだものと呼び、実際にはどんなありふれた方法で選んでも生成系は十分得られそうだと述べています。結果の対象は曲線に限られ、次元を固定したより高次元の多様体については、より深刻な困難があるように見えるとして未解決の問題としています。アルゴリズムは量子オラクルを 2g 回呼び出しますが、論文はこの壁を破るには本質的に新しい着想が要るだろうと述べています。またブラックボックス群の指数は容易に検証できる一方、その位数を効率的に検証する方法は明らかでないとも述べており、出力に安価な古典的検算が伴うわけではありません。計算量は漸近的なものであり、ゲート数、量子ビット数、定数因子はいずれも示されていません。上に引用した古典計算との比較は、著者が名前を挙げた最良のアルゴリズム、すなわち Schoof と Lauder-Wan に対するものであって証明された下界に対するものではなく、論文は超多項式という語を用いていません。",
    tags: ["zeta function", "algebraic curve", "class group", "black box group", "order finding"],
    source: {
      id: "arxiv:math/0411623",
      title: "Quantum computation of zeta functions of curves",
      authors: "Kiran S. Kedlaya",
      year: "2004",
      url: "https://arxiv.org/abs/math/0411623",
    },
    literature: [
      {
        title: "Quantum computation of zeta functions of curves",
        authors: "Kiran S. Kedlaya",
        year: "2004",
        url: "https://arxiv.org/abs/math/0411623",
        relevance: "Primary source, and the source of this record's cost claim. Consult it for the reduction from the zeta function to a sequence of class numbers, for the 16g < q^(1/2) hypothesis under which the generator-finding lemmas are proved, and for the analytic-number-theory result imported in section 8 to remove that hypothesis. It is also where the 2g oracle calls and the difficulty of verifying a black-box group order are discussed.",
        relevanceJa: "一次資料であり、本記録の計算量の出典です。ゼータ関数から類数の列への帰着、生成系を求める補題が証明される仮定 16g < q^(1/2)、およびその仮定を外すために第8節で引用される解析的整数論の結果については、原論文で確認してください。量子オラクルの 2g 回の呼び出しや、ブラックボックス群の位数の検証の難しさについても同論文で論じられています。",
      },
    ],
    relatedSlugs: ["shor-period-finding", "group-order-and-membership", "finite-ring-ideals"],
  },
  {
    slug: "gauss-sum-estimation",
    title: "Estimating Gauss sums over finite fields and rings",
    titleJa: "有限体および環上のGauss和の推定",
    family: "Computational number theory",
    zooName: "Gauss Sums",
    zooSection: "Algebraic and Number Theoretic Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: {
      states: "absent",
      read: "the full text of arXiv:quant-ph/0207131 — abstract, sections 1 through 8 and the conclusion. Section 5 raises the classical question and answers it with a reduction rather than a bound: \"Although we are not able to prove that this is hard, we can give the following reduction, which indicates that a classical polynomial time algorithm is unlikely.\" Section 8 then leaves it open: \"For the results of this article it remains therefore an important open question if Gauss sum estimation is hard classically, even under the assumption that factoring and discrete logarithms are easy.\" No classical running time is stated anywhere in the text.",
    },
    problem: "Given the specification of a nontrivial multiplicative character χ and an additive character indexed by β over a finite field F_{p^r}, estimate the angle γ modulo 2π in the Gauss sum G(F_{p^r}, χ, β) = √(p^r) · e^(iγ). The same question is then asked for Dirichlet characters over Z/nZ.",
    problemJa: "有限体 F_{p^r} 上の自明でない乗法指標 χ と、β で添字づけられた加法指標の仕様が与えられたとき、Gauss 和 G(F_{p^r}, χ, β) = √(p^r) · e^(iγ) における角 γ を 2π を法として推定する問題です。同じ問いが Z/nZ 上の Dirichlet 指標についても立てられます。",
    idea: "The specification of the character lets the algorithm build the state |χ⟩ efficiently, using Shor's discrete-logarithm algorithm together with a phase-kickback trick and amplitude amplification. Applying the finite-field quantum Fourier transform to |χ⟩ and then the phase change |y⟩ → χ²(y)|y⟩ produces an eigenrelation in which the Gauss sum divided by √(p^r) appears as the eigenvalue. Preparing a superposition of |χ⟩ with a stale component turns that eigenvalue into a relative phase e^(iγ), which standard phase estimation reads out with O(1/ε) samples. The same machinery, applied to Dirichlet characters and combined with a reduction to primitive characters through the Chinese remainder theorem, extends the result from finite fields to Z/nZ, and a corollary covers Jacobi sums.",
    ideaJa: "指標の仕様が与えられていることにより、状態 |χ⟩ を効率的に構成できます。ここでは Shor の離散対数アルゴリズムに加えて、位相キックバックの技法と振幅増幅が用いられます。|χ⟩ に有限体上の量子 Fourier 変換を施し、続いて位相変化 |y⟩ → χ²(y)|y⟩ を作用させると、Gauss 和を √(p^r) で割ったものが固有値として現れる固有関係が得られます。|χ⟩ と、変換を受けていない成分との重ね合わせを用意することで、この固有値は相対位相 e^(iγ) となり、通常の位相推定によって O(1/ε) 回の標本で読み出せます。同じ機構を Dirichlet 指標に適用し、中国剰余定理による原始指標への帰着と組み合わせることで、結果は有限体から Z/nZ へ拡張され、系として Jacobi 和も扱われます。",
    complexity: "O((1/ε) · polylog(p^r)) time to estimate the angle to within ε over a finite field F_{p^r}, and O((1/ε) · polylog(n)) over Z/nZ, with the norm |G(Z/nZ, χ, β)| determinable in polylog(n) time. The Jacobi-sum corollary carries the same O((1/ε) · polylog(p^r)) bound.",
    complexityBasis: 'section 4, Theorem 1 of arXiv:quant-ph/0207131: "The time complexity of this algorithm is bounded by O( 1/ε · polylog(p^r))."; section 7, Theorem 2: "The time complexity of this algorithm is bounded by O( 1/ε · polylog(n)). Also the norm |G(Z/nZ, χ, β)| can be determined in polylog(n) time."; section 4.1, Corollary 1, for Jacobi sums: "…with expected error ε with time complexity O( 1/ε · polylog(p^r))." The introduction states the same bound in the general form O( 1/ε · polylog|R|).',
    caveat: "This is a literature record: nothing was constructed, compiled, simulated or run, and no Gauss sum was estimated here. The Zoo files this entry as a superpolynomial speedup, and the paper it cites does not claim one — the authors write that they are not able to prove that classical estimation is hard, offer a reduction as evidence that a classical polynomial-time algorithm is unlikely, and then name the question as an important open one in their conclusion, explicitly leaving it open even under the assumption that factoring and discrete logarithms are easy. So the class on this record is the Zoo's, and the primary source is silent on it. The bounds above assume a nontrivial character and β ≠ 0; the trivial cases are excluded by convention rather than handled. The cost is stated as time complexity in an asymptotic form with polylog factors unnamed, so no gate count, qubit count or constant follows from it, and the 1/ε dependence is linear rather than logarithmic, which matters for any concrete precision. The authors also note that the problem is defined over finite fields and rings rather than groups, which they read as a departure from the hidden-subgroup framework, so the result does not inherit that framework's guarantees.",
    caveatJa: "本項目は文献に基づく記録です。ここで何かを構成・コンパイル・シミュレート・実行したことはなく、具体的な Gauss 和を推定したわけでもありません。Zoo はこの項目を超多項式的な高速化として分類していますが、Zoo が引用しているこの論文自体はそのような主張をしていません。著者らは、古典的な推定が困難であることを証明できないと述べ、古典多項式時間アルゴリズムが存在しそうにないことの根拠として帰着を与えるにとどめ、結論部ではこれを重要な未解決問題として明示し、素因数分解と離散対数が容易であると仮定してもなお未解決であるとしています。したがって本記録の区分は Zoo によるものであり、一次資料はこの点について何も述べていません。上記の評価は自明でない指標と β ≠ 0 を前提としており、自明な場合は扱われるのではなく規約として除外されています。計算量は polylog の因子を明示しない漸近的な時間計算量として述べられているため、ゲート数、量子ビット数、定数はここからは分かりません。また 1/ε への依存は対数ではなく線形であり、具体的な精度を求める場合にはこの点が効いてきます。著者らはさらに、この問題が群ではなく有限体や環の上で定義されている点を隠れ部分群の枠組みからの逸脱と読んでおり、結果はその枠組みの保証を継承しません。",
    tags: ["gauss sum", "jacobi sum", "dirichlet character", "finite field", "phase estimation"],
    source: {
      id: "arxiv:quant-ph/0207131",
      title: "Efficient Quantum Algorithms for Estimating Gauss Sums",
      authors: "Wim van Dam, Gadiel Seroussi",
      year: "2002",
      url: "https://arxiv.org/abs/quant-ph/0207131",
    },
    literature: [
      {
        title: "Efficient Quantum Algorithms for Estimating Gauss Sums",
        authors: "Wim van Dam, Gadiel Seroussi",
        year: "2002",
        url: "https://arxiv.org/abs/quant-ph/0207131",
        relevance: "Primary source, and the source of this record's cost claim. It is also the document that shows the Zoo's speedup class for this entry is not the paper's: section 5 offers a reduction rather than a hardness proof, and section 8 names classical hardness of Gauss sum estimation as an open question. Consult it for the character specification the algorithm needs as input and for the eigenrelation the phase estimation is run against.",
        relevanceJa: "一次資料であり、本記録の計算量の出典です。またこの文献は、Zoo がこの項目に与えている高速化の区分が論文自身のものではないことを示す資料でもあります。第5節は困難性の証明ではなく帰着を与えるにとどまり、第8節は Gauss 和の推定が古典的に困難かどうかを未解決問題として挙げています。アルゴリズムが入力として要する指標の仕様や、位相推定が適用される固有関係については、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["discrete-logarithm", "shor-period-finding", "quantum-fourier-transform"],
  },
  {
    slug: "exponential-congruences",
    title: "Exponential congruences over a finite field",
    titleJa: "有限体上の指数合同式",
    family: "Computational number theory",
    zooName: "Solving Exponential Congruences",
    zooSection: "Algebraic and Number Theoretic Algorithms",
    speedup: "Polynomial",
    speedupPrimary: {
      states: "reported",
      quote: "While still superpolynomial in log q, this quantum algorithm is significantly faster than the best known classical algorithm, which has time complexity q^{9/8}(log q)^{O(1)}. Thus it gives an example of a natural problem where quantum algorithms provide about a cubic speed-up over classical ones.",
    },
    problem: "Given elements a, b, c, f, g of the multiplicative group of a finite field F_q, decide whether the exponential congruence af^x + bg^y = c has a solution in nonnegative integers x and y, and find one if it does. The problem generalizes the discrete logarithm and is connected to the hidden subgroup problem over semidirect product groups.",
    problemJa: "有限体 F_q の乗法群の元 a, b, c, f, g が与えられたとき、指数合同式 af^x + bg^y = c が非負整数 x, y による解をもつかどうかを判定し、もつ場合には解を一つ求める問題です。これは離散対数問題の一般化であり、半直積群上の隠れ部分群問題とも関係しています。",
    idea: "Character-sum bounds do the number-theoretic work: if f and g have large enough multiplicative orders, a solution is guaranteed to exist inside a provably small search box, and a variance and Parseval argument sharpens that box in the typical case. The classical algorithm then factors q−1, bounds the box, and for each y in it computes a classical discrete logarithm to test for a matching x. The quantum algorithm keeps that structure and changes two things: Shor's algorithm replaces the classical discrete-logarithm subroutine, and Grover search replaces the exhaustive scan over the y-range. A sharper variant runs the Boyer-Brassard-Høyer-Tapp bounded-error search directly over the actual solutions when the product of the two orders is large enough. The paper reports six bounds in all, classical and quantum, worst case and typical case.",
    ideaJa: "数論的な部分を担うのは指標和の評価です。f と g の乗法位数が十分大きければ、解は証明可能に小さい探索範囲の中に存在することが保証され、典型的な場合には分散と Parseval の等式による議論によってその範囲がさらに絞られます。古典アルゴリズムはまず q−1 を素因数分解し、この範囲を評価したうえで、範囲内の各 y について古典的な離散対数を計算して対応する x の有無を調べます。量子アルゴリズムはこの構造を保ったまま二点を変更します。古典的な離散対数の副手続きを Shor のアルゴリズムに置き換え、y の範囲の総当たり走査を Grover 探索に置き換えます。二つの位数の積が十分大きい場合には、Boyer, Brassard, Høyer, Tapp による誤り有界な探索の変種を実際の解の集合に直接適用する、より鋭い変種も与えられています。論文は古典と量子、最悪の場合と典型的な場合を合わせて六つの評価を報告しています。",
    complexity: "q^(3/8)(log q)^(O(1)) on a quantum computer in the worst case, against q^(9/8)(log q)^(O(1)) for the best known classical algorithm. In the typical case the figures are q^(1/3)(log q)^(O(1)) quantum and q(log q)^(O(1)) classical. A sharper quantum variant runs in q^(1/2)(st)^(−1/4)(log q)^(O(1)) in terms of the multiplicative orders s and t, which the paper bounds above by O(q^(1/8)(log q)^(O(1))).",
    complexityBasis: 'abstract of arXiv:0804.1109: "A quantum algorithm with time com- plexity q^{3/8}(log q)^{O(1)} is presented… this quantum algorithm is significantly faster than the best known classi- cal algorithm, which has time complexity q^{9/8}(log q)^{O(1)}."; section 4.1, Theorem 3: "…in time q^{3/8}(log q)^{O(1)} on a quantum computer."; section 4.2, Theorem 5, for the typical case: "…in time q^{1/3}(log q)^{O(1)} on a quantum computer."; section 3.2, Theorem 2, for the classical typical case: "…in deterministic time q(log q)^{O(1)} on a classical computer."; section 4.1, Theorem 4: "…in time q^{1/2}(st)^{-1/4}(log q)^{O(1)} on a quantum computer," with "the running time of the algorithm of Theorem 4 is upper bounded by O(q^{1/8}(log q)^{O(1)})".',
    caveat: "This is a literature record: nothing was constructed, compiled, simulated or run, and no congruence was solved here. The speedup is real and stated by the authors, but it is a speedup between two algorithms that are both superpolynomial in the input size — the input is q written in binary, so log q is the length, and the abstract itself opens the comparison with \"While still superpolynomial in log q\". Section 5 says the same of every algorithm in the paper, and section 6 keeps efficient solution in time (log q)^(O(1)) open as a problem. So a cubic speedup here does not make the problem tractable, and this record should not be read as one that does. The classical figure is the best known algorithm rather than a proved lower bound. The rigorous subexponential discrete-logarithm algorithms that could sharpen the classical side are, as the paper notes, known only for special fields such as prime fields and binary fields. The elliptic-curve analogue is asserted to follow at the cost of only typographical changes but is not carried out. The bounds are asymptotic with unnamed (log q)^(O(1)) factors, so no gate count, qubit count or constant follows from them.",
    caveatJa: "本項目は文献に基づく記録です。ここで何かを構成・コンパイル・シミュレート・実行したことはなく、具体的な合同式を解いたわけでもありません。高速化は実在し著者自身が述べているものですが、それは入力長について超多項式である二つのアルゴリズムの間の高速化です。入力は二進表記の q であり、その長さは log q ですが、要旨自身が比較を「While still superpolynomial in log q」と切り出しています。第5節は本論文のすべてのアルゴリズムについて同じことを述べ、第6節は (log q)^(O(1)) 時間での効率的な求解を未解決問題として残しています。したがってここでの三乗程度の高速化は問題を扱いやすくするものではなく、本記録をそのように読むべきではありません。古典側の値は証明された下界ではなく、知られている最良のアルゴリズムのものです。古典側を改善しうる厳密な劣指数時間の離散対数アルゴリズムは、論文が述べるとおり、素体や二元体といった特別な体についてしか知られていません。楕円曲線版については、表記上の変更だけで完全な類似物が得られるとされていますが、実際には遂行されていません。評価はいずれも漸近的で (log q)^(O(1)) の因子が明示されていないため、ゲート数、量子ビット数、定数はここからは分かりません。",
    tags: ["exponential congruence", "discrete logarithm", "character sums", "grover search", "finite field"],
    source: {
      id: "arxiv:0804.1109",
      title: "Classical and Quantum Algorithms for Exponential Congruences",
      authors: "Wim van Dam, Igor E. Shparlinski",
      year: "2008",
      url: "https://arxiv.org/abs/0804.1109",
    },
    literature: [
      {
        title: "Classical and Quantum Algorithms for Exponential Congruences",
        authors: "Wim van Dam, Igor E. Shparlinski",
        year: "2008",
        url: "https://arxiv.org/abs/0804.1109",
        relevance: "Primary source, and the source of both the quantum and the classical figures this record compares. Consult it for the character-sum bounds that fix the search box, for the distinction between the worst case and the typical case that produces two different pairs of bounds, and for section 6, where the authors keep efficient solution in time polynomial in log q open — the sentence that stops the cubic speedup from being read as tractability.",
        relevanceJa: "一次資料であり、本記録が比較している量子側と古典側の双方の値の出典です。探索範囲を定める指標和の評価、二組の異なる評価を生む最悪の場合と典型的な場合の区別、そして log q の多項式時間での効率的な求解を未解決問題として残している第6節については、原論文で確認してください。この第6節の記述こそが、三乗の高速化を扱いやすさと読み違えることを防ぐものです。",
      },
    ],
    relatedSlugs: ["discrete-logarithm", "grover-unstructured-search", "shor-period-finding"],
  },
  {
    slug: "subset-finding-quantum-walk",
    title: "Subset finding by quantum walk",
    titleJa: "量子ウォークによる部分集合発見",
    family: "Quantum walk",
    zooName: "Subset finding",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    speedupPrimary: {
      states: "absent",
      read: "the full text of arXiv:quant-ph/0311038 — abstract, section I (introduction), section II (algorithm), section III (analysis), section IV (applications), section V (open problems), the note added and the references. The word \"classical\" does not appear in the body text. Every comparison the paper makes is against quantum query lower bounds — the Ω(√N) bound for L = 1 and the Ω(N^(2/3)) bound for element distinctness — rather than against the cost of a classical algorithm.",
    },
    problem: "In L-subset finding, a black box f maps a domain D of size N into a range R, and a property P picks out some L-element subsets by their arguments and values. The task is to find an L-subset {x₁, …, x_L} of D whose pairs ((x₁, f(x₁)), …, (x_L, f(x_L))) satisfy P, or to reject if none exists, using as few queries as possible. Unstructured search is the case L = 1 and element distinctness the case L = 2.",
    problemJa: "L-部分集合発見の問題では、ブラックボックス f が大きさ N の定義域 D を値域 R へ写し、性質 P が引数と値によっていくつかの L 元部分集合を指定します。目標は、対 ((x₁, f(x₁)), …, (x_L, f(x_L))) が P を満たすような D の L 元部分集合 {x₁, …, x_L} を、できるだけ少ないクエリ数で見つけるか、存在しない場合には棄却することです。L = 1 が非構造化探索、L = 2 が要素相異性に対応します。",
    idea: "Childs and Eisenberg rework Ambainis's discrete-time quantum walk for element distinctness. The walk runs on a bipartite graph whose vertices are the size-M and size-(M+1) subsets of D, each vertex carrying the subset together with the function values already queried for it. A shift operator costing one query moves between the two subset sizes, Grover diffusion operators act as coins on the element added or removed, and a phase flip marks any subset that already contains a solution — a check that costs no further queries once the values are stored. Running the walk interleaved with the phase flip, for iteration counts chosen from a spectral and perturbative analysis of the walk operator, rotates amplitude from the symmetric initial state onto a solution state with probability close to one. The same construction is then applied to finding an L-clique in a graph, in two variants.",
    ideaJa: "Childs と Eisenberg は、要素相異性に対する Ambainis の離散時間量子ウォークを組み直します。ウォークは、頂点が D の大きさ M および M+1 の部分集合であるような二部グラフの上を走り、各頂点はその部分集合と、そこについて既に問い合わせた関数値をあわせて保持します。クエリ1回のコストをもつシフト作用素が二つの部分集合の大きさの間を移り、追加または削除される元に対して Grover 拡散作用素がコインとして働き、位相反転が既に解を含む部分集合に印をつけます。値が保存されているため、この判定に追加のクエリは要りません。ウォーク作用素のスペクトル解析と摂動解析から選んだ反復回数で、ウォークと位相反転を交互に走らせると、対称な初期状態から解の状態へ振幅が回転し、その確率は1に近づきます。同じ構成は続いて、二つの変種によってグラフ中の L 個の頂点からなるクリークの発見にも適用されます。",
    complexity: "O(N^(L/(L+1))) queries for L-subset finding. The L-clique application is given in two variants: a simple one using O(N^(2L/(L+1))) edge queries and a recursive one using Õ(N^((5L−2)/(2L+4))), which the abstract says is an improvement for L ≤ 5.",
    complexityBasis: 'abstract of arXiv:quant-ph/0311038: "an O(N^{L/(L+1)})-query algorithm for finding L equal numbers… One of these algorithms uses O(N^{2L/(L+1)}) edge queries, and the other uses Õ(N^{(5L−2)/(2L+4)}), which is an improvement for L ≤ 5."; section III, Theorem 1: "The quantum query complexity of L-subset finding is O(N^{L/(L+1)})."; section IV, for the two clique variants: "choosing M = ⌊N^{L/(L+1)}⌋ gives an overall query complexity of O(N^{2L/(L+1)})" and "choosing M = ⌊N^{L/(L+2)}⌋ gives an overall query complexity of Õ(N^{(5L−2)/(2L+4)})".',
    caveat: "This is a literature record: no circuit was built, compiled, simulated or run, and no subset was found here. The clean bound is proved under a uniqueness promise — section II supposes there is exactly one special subset, and hands the general case to standard sampling techniques in Ambainis's separate paper rather than analysing it here — so the multi-solution case is not covered by anything in this document. The figures are query counts in an oracle model and the paper says outright that for the general problem it is not concerned with how P is given or how efficiently it can be checked, so time complexity, gate counts and the cost of realizing the oracle are all outside it. No matching lower bound is proved for general L: the paper conjectures Ω(N^(L/(L+1))) and states that the best lower bound known is Ω(N^(2/3)), independent of L, for every L ≥ 2, and it does not claim its clique algorithms are optimal. The Zoo classes this entry as a polynomial speedup; that class is the Zoo's, because the paper compares itself only to quantum lower bounds and never states a classical cost.",
    caveatJa: "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、具体的な部分集合を見つけたわけでもありません。きれいな評価は一意性の約束のもとで証明されています。第2節は特別な部分集合がちょうど一つ存在すると仮定し、一般の場合はここで解析するのではなく、Ambainis の別論文にある標準的な標本抽出の技法に委ねているため、解が複数ある場合はこの文献のどこでも扱われていません。示されている値はオラクルモデルにおけるクエリ数であり、一般の問題について P がどのように与えられ、どれだけ効率的に判定できるかは関心の対象ではないと論文が明言しているため、時間計算量、ゲート数、オラクルを実現するコストはいずれも対象外です。一般の L に対する一致する下界は証明されていません。論文は Ω(N^(L/(L+1))) を予想として述べたうえで、知られている最良の下界は L ≥ 2 のすべてについて L に依存しない Ω(N^(2/3)) であるとしており、クリークのアルゴリズムが最適であるとも主張していません。Zoo はこの項目を多項式的な高速化に分類していますが、その区分は Zoo によるものです。論文は自身を量子の下界とのみ比較しており、古典的なコストを述べていないからです。",
    tags: ["subset finding", "element distinctness", "quantum walk", "query complexity", "clique"],
    source: {
      id: "arxiv:quant-ph/0311038",
      title: "Quantum algorithms for subset finding",
      authors: "Andrew M. Childs, Jason M. Eisenberg",
      year: "2003",
      url: "https://arxiv.org/abs/quant-ph/0311038",
    },
    literature: [
      {
        title: "Quantum algorithms for subset finding",
        authors: "Andrew M. Childs, Jason M. Eisenberg",
        year: "2003",
        url: "https://arxiv.org/abs/quant-ph/0311038",
        relevance: "Primary source, and the source of this record's cost claim. Consult it for the uniqueness promise the analysis assumes, for the spectral argument that fixes the two iteration counts, and for section V, where the matching lower bound for general L is left as a conjecture and the best known bound is stated as Ω(N^(2/3)) independent of L.",
        relevanceJa: "一次資料であり、本記録の計算量の出典です。解析が前提とする一意性の約束、二つの反復回数を定めるスペクトルに関する議論、および一般の L に対する一致する下界が予想として残され、知られている最良の下界が L に依存しない Ω(N^(2/3)) であると述べられている第5節については、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["element-distinctness", "grover-unstructured-search", "quantum-walk-line"],
  },
  {
    slug: "matrix-products-over-semirings",
    title: "Matrix products over semirings",
    titleJa: "半環上の行列積",
    family: "Quantum query algorithm",
    zooName: "Matrix Multiplication over Semirings",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    speedupPrimary: {
      states: "reported",
      quote: "In comparison, the best known classical algorithm for the same problem, by Duan and Pettie (SODA'09), has complexity O(n^2.687).",
    },
    problem: "Compute the product of two n × n matrices over a semiring rather than a ring — the (max, min) product, the distance product, and the Boolean product — where the absence of subtraction rules out the fast algebraic algorithms that make ring matrix multiplication cost n^ω. The question the paper poses is whether anything beats the Õ(n^(5/2)) that follows from applying Grover search or quantum minimum-finding entry by entry.",
    problemJa: "環ではなく半環の上で、n × n 行列二つの積を計算する問題です。対象は (max, min) 積、距離積、およびブール積です。半環には減算がないため、環上の行列積を n^ω に抑える高速な代数的アルゴリズムは使えません。論文が立てる問いは、Grover 探索や量子最小値探索を成分ごとに適用して得られる自明な Õ(n^(5/2)) を上回るものがあるかどうかです。",
    idea: "Le Gall and Nishimura introduce what they call quantum enumeration, a variant of Grover's search, and apply it to a problem they define as the generalized existence dominance product, which generalizes the existence dominance product of Duan and Pettie. The classical Duan-Pettie approach combines a search step with classical algebraic rectangular matrix multiplication; the paper adapts that combination to the quantum setting, then reduces the (max, min) product, the most significant bits of the distance product, and the sparse Boolean product to instances of the generalized product. The result is the first pair of quantum algorithms that beat the straightforward entrywise Õ(n^(5/2)) and, for these semirings, the best classical algorithms as well, without assuming anything about sparsity.",
    ideaJa: "Le Gall と Nishimura は、Grover 探索の変種である量子列挙と呼ぶ手法を導入し、それを一般化存在優越積として自ら定義した問題に適用します。これは Duan と Pettie による存在優越積を一般化したものです。古典的な Duan-Pettie の方法は、探索の段階と古典的な代数的長方行列積とを組み合わせるものであり、論文はこの組み合わせを量子の設定へ移します。そのうえで、(max, min) 積、距離積の上位ビット、および疎なブール積を、この一般化積の問題例へ帰着させます。得られたのは、成分ごとの自明な Õ(n^(5/2)) を上回り、しかもこれらの半環については疎性を仮定せずに最良の古典アルゴリズムをも上回る、最初の量子アルゴリズムの組です。",
    complexity: "O(n^2.473) for the (max, min) product of two n × n matrices, against O(n^2.687) for the best known classical algorithm. For the distance product, the ℓ most significant bits of each entry are computed in O(2^(0.64ℓ) n^2.46). The sparse Boolean product is given as a four-case piecewise bound in the number of non-zero entries, and the paper says its algorithm performs better when n^1.151 < m < n^(ω−1/2).",
    complexityBasis: 'abstract of arXiv:1310.3898: "We construct a quantum algorithm computing the product of two n × n matrices over the (max, min) semiring with time complexity O(n^2.473)." and "We construct a quantum algorithm computing the ℓ most significant bits of each entry of the distance product of two n × n matrices in time O(2^0.64ℓ n^2.46)."; the classical figure is the abstract\'s own: "In comparison, the best known classical algorithm for the same problem, by Duan and Pettie (SODA\'09), has complexity O(n^2.687)."; section 1 for the sparse regime: "Our algorithm performs better when n^1.151 < m < n^(ω−1/2)".',
    caveat: "This is a literature record: nothing was constructed, compiled, simulated or run, and no matrix product was computed here. Every stated time complexity is in an oracle cost model that charges one unit per entry access — section 2 defines oracles that map |i⟩|j⟩|0⟩|z⟩ to |i⟩|j⟩|A[i,j]⟩|z⟩ and says the counting corresponds to the case where quantum access to the inputs can be done at unit cost, for example in a random access model working in quantum superposition. That is a quantum-RAM assumption, and the cost of providing it is not in these figures. The distance-product speedup applies to the ℓ most significant bits of each entry, not to the exact product: the proof assumes ℓ small enough that the bound stays below the trivial Õ(n^(5/2)), and full precision falls back to that trivial algorithm. The sparse Boolean improvement holds only inside the stated range of the number of non-zero entries. The paper is explicit that no speedup is offered for dense matrix multiplication over a ring, where it says quantum algorithms may not be able to outperform the classical Õ(n^ω). The classical figures quoted are the best algorithms known rather than proved lower bounds, and the paper notes that for the distance product no truly subcubic classical algorithm is known at all without assumptions, so the comparison there is against a weaker baseline than the exponents alone suggest.",
    caveatJa: "本項目は文献に基づく記録です。ここで何かを構成・コンパイル・シミュレート・実行したことはなく、具体的な行列積を計算したわけでもありません。示されている時間計算量はすべて、成分へのアクセス1回につき単位コストを課すオラクルモデルにおけるものです。第2節は |i⟩|j⟩|0⟩|z⟩ を |i⟩|j⟩|A[i,j]⟩|z⟩ へ写すオラクルを定義し、この計数は入力への量子的アクセスが単位コストで行える場合、たとえば量子重ね合わせのもとで動作するランダムアクセスモデルに対応すると述べています。これは量子 RAM の仮定であり、それを用意するコストはこれらの数値に含まれていません。距離積に関する高速化は各成分の上位 ℓ ビットについてのものであり、厳密な積についてではありません。証明では、評価が自明な Õ(n^(5/2)) を下回る程度に ℓ が小さいことを仮定しており、完全な精度では自明なアルゴリズムに戻ります。疎なブール積の改善も、非零成分の個数が述べられた範囲にあるときにのみ成り立ちます。論文は、環上の密行列積については高速化を与えないことを明言しており、そこでは量子アルゴリズムは古典的な Õ(n^ω) を上回れないかもしれないと述べています。引用した古典側の値は証明された下界ではなく知られている最良のアルゴリズムのものであり、距離積については仮定を置かない真に劣三次の古典アルゴリズムがそもそも知られていないとも述べられているため、その比較は指数の見かけほど強いものではありません。",
    tags: ["matrix multiplication", "semiring", "distance product", "grover search", "query complexity"],
    source: {
      id: "arxiv:1310.3898",
      title: "Quantum Algorithms for Matrix Products over Semirings",
      authors: "François Le Gall, Harumichi Nishimura",
      year: "2013",
      url: "https://arxiv.org/abs/1310.3898",
    },
    literature: [
      {
        title: "Quantum Algorithms for Matrix Products over Semirings",
        authors: "François Le Gall, Harumichi Nishimura",
        year: "2013",
        url: "https://arxiv.org/abs/1310.3898",
        relevance: "Primary source, and the source of both the quantum and the classical figures this record compares. Consult it for the unit-cost oracle model of section 2 that every stated complexity depends on, for the generalized existence dominance product the reductions all pass through, and for the regime conditions attached to the distance-product and sparse Boolean results.",
        relevanceJa: "一次資料であり、本記録が比較している量子側と古典側の双方の値の出典です。示されているすべての計算量が依存する第2節の単位コストのオラクルモデル、すべての帰着が経由する一般化存在優越積、および距離積と疎なブール積の結果に付されている範囲の条件については、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["subset-finding-quantum-walk", "element-distinctness", "grover-unstructured-search"],
  },
  {
    slug: "quadratically-signed-weight-enumerators",
    title: "Quadratically signed weight enumerators",
    titleJa: "二次符号付き重み多項式",
    family: "PromiseBQP-complete problem",
    zooName: "Weight Enumerators",
    zooSection: "Approximation and Simulation Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: {
      states: "absent",
      read: "the full text of arXiv:quant-ph/9909094 — abstract, sections I through V and appendix A. The paper's claim is a polynomial-equivalence and BQP-completeness result, not a speedup: an oracle for the sign problem makes classical probabilistic computation as powerful as quantum computation. No statement anywhere compares a quantum algorithm's cost with a classical algorithm's cost for a shared task.",
    },
    problem: "A quadratically signed weight enumerator is the sum S(A, B, x, y) = Σ (−1)^(bᵀBb) x^|b| y^(n−|b|) over the 0/1 vectors b with Ab = 0. Given that the diagonal of A is the identity, that k and l are positive integers, and a promise that |S(A, lwtr(A), k, l)| is at least (k² + l²)^(n/2)/2, determine the sign of S.",
    problemJa: "二次符号付き重み多項式とは、Ab = 0 を満たす 0/1 ベクトル b にわたる和 S(A, B, x, y) = Σ (−1)^(bᵀBb) x^|b| y^(n−|b|) のことです。A の対角成分が単位行列であること、k と l が正の整数であること、および |S(A, lwtr(A), k, l)| が (k² + l²)^(n/2)/2 以上であるという約束のもとで、S の符号を決定する問題です。",
    idea: "Knill and Laflamme expand a quantum circuit's amplitude by multiplying out its gate sequence, writing each gate as (4 + 3σ̃)/5 so that the product becomes a sum over 0/1 vectors with signs given by a quadratic form. That sum is then recognized as an instance of the quadratically signed weight enumerator above. The two directions follow: an oracle deciding the sign of such a sum lets a classical probabilistic machine simulate a quantum computer, and conversely a quantum computer can decide the sign under the promise, so the problem is BQP-complete. A more restricted variant is shown to be solvable by the one-bit model of quantum computation, in which only a single qubit is initialized and the rest of the register is maximally mixed. The paper is a bridge between quantum computation and a purely combinatorial quantity, not a faster way of computing anything.",
    ideaJa: "Knill と Laflamme は、量子回路の振幅をゲート列の積として展開する際に、各ゲートを (4 + 3σ̃)/5 の形に書きます。すると積は 0/1 ベクトルにわたる和となり、その符号は二次形式によって与えられます。この和が、上に述べた二次符号付き重み多項式の一例として認識されます。ここから両方向の主張が従います。すなわち、そのような和の符号を判定するオラクルがあれば古典確率的計算機は量子計算機をシミュレートでき、逆に約束のもとで量子計算機はその符号を判定できるため、この問題は BQP 完全です。さらに制限した変種は、1量子ビットのみを初期化し残りのレジスタを最大混合状態とする「1ビットモデル」の量子計算によって解けることが示されています。この論文は量子計算と純粋に組合せ論的な量との橋渡しであって、何かをより速く計算する方法ではありません。",
    complexity: "",
    complexityBasis: 'The source states no complexity bound for this record, because its results are equivalence and completeness theorems rather than an algorithm with a runtime. The only asymptotic figures in the text are internal steps: section III, proof of Theorem 7 — "By using binary search on x, the desired probability can be determined to within O(ǫ/N) in O(log(N/ǫ)) queries" — and section IV — "these gates can be approximated to within O(ǫ/N) using the standard ones with polylog(N/ǫ) overhead in gates". Read for this: the abstract, sections I through V and appendix A.',
    caveat: "This is a literature record: nothing was constructed, compiled, simulated or run, and no weight enumerator was evaluated here. The Zoo files this entry as a superpolynomial speedup; the paper it cites claims no speedup at all, and states a polynomial equivalence between quantum computation and classical probabilistic computation given an oracle for this sum. Nothing here should be read as a quantum algorithm that beats a classical one. The completeness results are stated for promise problems, and the authors themselves name that as a disadvantage relative to other BQP-hard problems, observing that factoring and discrete logarithm have the advantage of not requiring a potentially difficult to verify promise — so an instance of this problem is not obviously one you can check you are allowed to hand to the algorithm. Two questions are left open in the paper: whether the converse of the one-bit-model theorem holds, and whether a simulation theorem analogous to the main one holds for the one-bit model. The record therefore states no complexity rather than borrowing a figure from an internal step.",
    caveatJa: "本項目は文献に基づく記録です。ここで何かを構成・コンパイル・シミュレート・実行したことはなく、具体的な重み多項式を評価したわけでもありません。Zoo はこの項目を超多項式的な高速化として分類していますが、Zoo が引用しているこの論文は高速化を一切主張しておらず、この和に対するオラクルを与えたときの量子計算と古典確率的計算との多項式的な同等性を述べています。ここに書かれていることを、古典を上回る量子アルゴリズムとして読むべきではありません。完全性の結果は約束問題として述べられており、著者ら自身がこれを他の BQP 困難な問題に対する欠点として挙げ、素因数分解と離散対数には検証が困難でありうる約束を必要としないという利点があると述べています。したがって、この問題の具体例をアルゴリズムに渡してよいかどうかを確認できるとは限りません。論文は二つの問題を未解決として残しています。1ビットモデルに関する定理の逆が成り立つかどうかと、主定理に対応するシミュレーション定理が1ビットモデルについて成り立つかどうかです。以上より本記録は、内部の一段階から数値を借りてくるのではなく、計算量を述べないという立場をとっています。",
    tags: ["weight enumerator", "bqp-complete", "one-bit model", "promise problem", "ising partition function"],
    source: {
      id: "arxiv:quant-ph/9909094",
      title: "Quantum Computation and Quadratically Signed Weight Enumerators",
      authors: "E. Knill, R. Laflamme",
      year: "1999",
      url: "https://arxiv.org/abs/quant-ph/9909094",
    },
    literature: [
      {
        title: "Quantum Computation and Quadratically Signed Weight Enumerators",
        authors: "E. Knill, R. Laflamme",
        year: "1999",
        url: "https://arxiv.org/abs/quant-ph/9909094",
        relevance: "Primary source. Consult it for the expansion of a circuit amplitude into a signed sum over 0/1 vectors, for the exact promise the completeness results are stated under, and for the authors' own remark in the conclusion that this promise may be difficult to verify — which is the reason this record carries no complexity and makes no speedup claim.",
        relevanceJa: "一次資料です。回路の振幅を 0/1 ベクトルにわたる符号付きの和へ展開する方法、完全性の結果が述べられている正確な約束、およびその約束の検証が困難でありうるという結論部での著者ら自身の指摘については、原論文で確認してください。本記録が計算量をもたず高速化を主張しないのは、この指摘によります。",
      },
    ],
    relatedSlugs: ["sparse-matrix-power-diagonal-entries", "string-rewriting-derivation-counts", "jones-polynomial-approximation"],
  },
  {
    slug: "viterbi-decoding-convolutional-codes",
    title: "Viterbi decoding of classical convolutional codes",
    titleJa: "古典畳み込み符号のViterbi復号",
    family: "Generalized Grover / amplitude amplification",
    zooName: "Decoding",
    zooSection: "Algebraic and Number Theoretic Algorithms",
    speedup: "Varies",
    speedupPrimary: {
      states: "reported",
      quote: "We present a quantum Viterbi algorithm (QVA) with better than classical performance under certain conditions. … The quantum speedup is possible because the performance of the QVA depends on the fanout (number of possible transitions from any given state in the hidden Markov model) which is in general much less than Q.",
    },
    problem: "The Viterbi algorithm finds the most likely sequence of hidden states a hidden Markov model passed through, given a sequence of emissions. Applied to decoding, the hidden states are the encoder states of a classical convolutional code and the emissions are the received symbols, so the most likely path is the decoded message.",
    problemJa: "Viterbi アルゴリズムは、放射の系列が与えられたときに、隠れ Markov モデルが辿った最も確からしい隠れ状態の系列を求めるものです。復号に応用する場合、隠れ状態は古典畳み込み符号の符号化器の状態、放射は受信された記号にあたるため、最も確からしい経路が復号された通報となります。",
    idea: "Grice and Meyer exploit the observation that the decoding trellis has the shape of the butterfly diagram of the fast Fourier transform, which has a fast quantum counterpart. The algorithm builds a superposition over all admissible paths through the decoding lattice, then marks each path with a phase that depends on its probability, then applies a specialized amplitude amplification procedure — analogous to Grover's algorithm — one or more times, so that the most probable path has a high probability of being measured. The paper works the construction through explicitly for a rate-1/2, memory-2 binary convolutional code, and tabulates the best phase parameter numerically for frame lengths from three to ten.",
    ideaJa: "Grice と Meyer は、復号トレリスが高速 Fourier 変換のバタフライ図と同じ形をしており、その量子版が高速であることに着目します。アルゴリズムはまず復号格子を通るすべての許容経路の重ね合わせを作り、次に各経路にその確率に応じた位相を付し、そのうえで Grover のアルゴリズムに類似した専用の振幅増幅の手続きを1回以上適用して、最も確からしい経路が測定される確率を高めます。論文はこの構成を、符号化率 1/2、記憶長 2 の二元畳み込み符号について明示的に追い、位相パラメータの最良値をフレーム長 3 から 10 まで数値的に表にしています。",
    complexity: "A single iteration has gate complexity O(N |Q| F (log F)²) and time complexity O(N log F) if |Q| quantum systems can be manipulated simultaneously, where N is the frame length, Q the state set and F the fanout. The number of iterations can be up to O(√L) as in Grover's algorithm, with L = N F log F, giving O(√(F^N) N log F) overall when the maximal amount of parallelism is used.",
    complexityBasis: 'section 1 of arXiv:1405.7479: "A single iteration of the QVA will be shown to have gate complexity O(N |Q|F(log F)²) and time complexity O(N log F), if |Q| quantum systems can be manipulated simultaneously."; same section: "The number of iterations in general can be up to O(√L) as in Grover\'s algorithm [1], where here L = N F log F."; and "If using the maximal amount of parallelism, the QVA decodes the convolutional code in time O(√(F^N) N log F)."',
    caveat: "This is a literature record: no circuit was built, compiled, simulated or run, and no codeword was decoded here. The advantage is conditional and the paper says so — it is most apparent for fanout much smaller than the state set and for short decode frames, so nothing here claims a speedup for a general hidden Markov model. The headline time complexity is bought with an explicit hardware assumption stated in the same sentence, that |Q| quantum systems can be manipulated simultaneously; without that parallelism the gate complexity, not the time complexity, is the figure that applies. No formula for the classical Viterbi algorithm's own cost appears anywhere in the text read, so the comparison is argued through the relationship between the fanout and the state set rather than by putting two bounds side by side, and this record cannot state the classical baseline. A single iteration is explicitly not enough — the paper notes it is only a constant factor better than a random guess, which is correct with probability 2^(−N) — so the advantage depends on the iteration count. The paper also leaves open whether its optimization step is optimal, and says the general analysis is difficult, with the phase parameter chosen numerically for small frame lengths rather than derived. Finally the Zoo's speedup class for this entry is \"Varies\", which is a class about the entry rather than about this paper.",
    caveatJa: "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、具体的な符号語を復号したわけでもありません。優位性は条件付きであり、論文自身がそう述べています。すなわち、ファンアウトが状態集合よりはるかに小さく、復号フレームが短い場合に最も顕著であるとされているため、一般の隠れ Markov モデルに対する高速化を主張するものではありません。主要な時間計算量は、同じ文の中で明示されているハードウェア上の仮定、すなわち |Q| 個の量子系を同時に操作できるという仮定と引き換えに得られています。その並列性がない場合に効いてくるのは、時間計算量ではなくゲート計算量です。参照した本文のどこにも古典 Viterbi アルゴリズム自体のコストの式は現れないため、比較は二つの評価を並べる形ではなく、ファンアウトと状態集合の関係を通じて論じられており、本記録は古典側の基準値を述べることができません。1回の反復では明示的に不十分であり、論文はそれが確率 2^(−N) で正解する当てずっぽうより定数倍良いだけであると述べているため、優位性は反復回数に依存します。また論文は、最適化の段階が最適かどうかを未解決とし、一般の解析は困難であるとして、位相パラメータを導出ではなく小さいフレーム長について数値的に選んでいます。最後に、Zoo がこの項目に与えている高速化の区分「Varies」は、この論文についてではなく項目についての区分です。",
    tags: ["viterbi algorithm", "convolutional code", "decoding", "hidden markov model", "amplitude amplification"],
    source: {
      id: "arxiv:1405.7479",
      title: "A quantum algorithm for Viterbi decoding of classical convolutional codes",
      authors: "Jon R. Grice, David A. Meyer",
      year: "2014",
      url: "https://arxiv.org/abs/1405.7479",
    },
    literature: [
      {
        title: "A quantum algorithm for Viterbi decoding of classical convolutional codes",
        authors: "Jon R. Grice, David A. Meyer",
        year: "2014",
        url: "https://arxiv.org/abs/1405.7479",
        relevance: "Primary source, and the source of this record's cost claim. Consult it for the simultaneous-manipulation assumption that the time complexity is conditioned on, for the fanout-versus-state-set relationship that the whole advantage argument rests on, and for section 3, where the phase parameter is chosen numerically because the general analysis is difficult.",
        relevanceJa: "一次資料であり、本記録の計算量の出典です。時間計算量が前提としている同時操作の仮定、優位性の議論全体が依拠するファンアウトと状態集合の関係、および一般の解析が困難であるために位相パラメータを数値的に選んでいる第3節については、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["grover-unstructured-search", "amplitude-amplification", "quantum-fourier-transform"],
  },
  {
    slug: "average-case-lattice-problems-by-filtering",
    title: "Average-case lattice problem variants by filtering",
    titleJa: "フィルタリングによる平均時計算量の格子問題の変種",
    family: "Lattice problems",
    zooName: "Lattice Problems by Filtering",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Exponential",
    speedupPrimary: {
      states: "reported",
      quote: "Still, no classical or quantum polynomial-time algorithms were known for the variants of SIS and LWE we consider.",
    },
    problem: "Give polynomial-time quantum algorithms for three average-case lattice problems in parameter regimes where none was known: the short integer solution problem under the infinity norm, the learning-with-errors problem when the input is supplied as LWE-like quantum states rather than classical samples, and the extrapolated dihedral coset problem.",
    problemJa: "従来はいかなるアルゴリズムも知られていなかったパラメータ領域において、平均時計算量の格子問題三つに対する多項式時間の量子アルゴリズムを与える問題です。対象は、無限大ノルムのもとでの短整数解問題、入力が古典的な標本ではなく LWE 型の量子状態として与えられる場合の誤り付き学習問題、および外挿二面体剰余類問題です。",
    idea: "The technique the paper calls filtering solves two quantum-state problems — constructing an LWE-like quantum state, and solving LWE given such a state — for noise distributions whose Fourier transform is non-negligible. The construction rests on Gram-Schmidt orthogonalization of circulant matrices together with a quantum Fourier transform step. The results for the short integer solution problem and for the extrapolated dihedral coset problem are then obtained not by new machinery but by composing this filtering algorithm with quantum reductions that already existed in the literature: a reduction from SIS to the LWE-state problem implicit in earlier work, and a reduction from the coset problem to the same place.",
    ideaJa: "論文がフィルタリングと呼ぶ技法は、Fourier 変換が無視できない大きさをもつ雑音分布について、二つの量子状態に関する問題を解きます。すなわち、LWE 型の量子状態を構成する問題と、そのような状態が与えられたもとで LWE を解く問題です。この構成は、巡回行列に対する Gram-Schmidt の直交化と量子 Fourier 変換の段階に基づいています。短整数解問題と外挿二面体剰余類問題に対する結果は、新しい機構によってではなく、このフィルタリングのアルゴリズムを、既に文献にあった量子的な帰着と合成することで得られます。すなわち、先行研究に暗に含まれる SIS から LWE 状態問題への帰着と、剰余類問題から同じ問題への帰着です。",
    complexity: "Polynomial time in the lattice dimension n, for each of the three problems, in the stated parameter regimes. The paper gives the regimes rather than an exponent: the short integer solution result holds for a number of samples m in Ω((q−c)³ · n^(c+1) · q · log q), and the two quantum-state problems for m in Ω(n · q/η²).",
    complexityBasis: 'abstract of arXiv:2108.11015: "We show polynomial-time quantum algorithms for the following problems: 1. Short integer solution (SIS) problem under the infinity norm… 2. Learning with errors (LWE) problem given LWE-like quantum states… 3. Extrapolated dihedral coset problem (EDCP) with certain parameters."; section 1.1.1, Theorem 2, for the SIS regime; section 1.1.2, Theorem 8: "there exist polynomial-time quantum algorithms that solve C|LWE⟩n,m,q,f and S|LWE⟩n,m,q,f". Read for this record: the abstract, the whole of section 1 including the future-directions discussion, section 2, the theorem statements, and the references. The technical proofs in sections 4 through 7 were not retrieved and were not read, so the record covers what the paper claims and under what conditions, not how the claims are established.',
    caveat: "This is a literature record: nothing was constructed, compiled, simulated or run, and no lattice instance was solved here. The single most important thing about this result is what it does not cover, and the abstract says it in the paper's own words: the standard forms of these problems are as hard as worst-case lattice problems, but the variants solved here are not in the parameter regimes known to be as hard as worst-case lattice problems. The learning-with-errors result assumes the input arrives as quantum states, not as classical samples, and it does not cover Gaussian noise — the paper says the theorem does not cover the case where the noise distribution is Gaussian, covering instead super-Gaussian and bounded uniform distributions. The authors state plainly that the results do not appear to affect the security of any lattice-based cryptosystem in use, and separately that the work does not improve attacks on the Dilithium signature scheme because the sample count required is very large. For the dihedral coset problem, the paper notes that the parameters of its own theorem had already been handled by earlier work with similar complexity. The Zoo's class for this entry is \"Exponential\"; the paper's own comparison is the narrower statement quoted on this record, that no polynomial-time algorithm classical or quantum was known for these variants. Finally, this record was written from the abstract, the introduction and the theorem statements; the proofs were not read, so nothing here reports on how the results are established.",
    caveatJa: "本項目は文献に基づく記録です。ここで何かを構成・コンパイル・シミュレート・実行したことはなく、具体的な格子の問題例を解いたわけでもありません。この結果について最も重要なのは、それが何を対象としていないかであり、要旨が論文自身の言葉でそれを述べています。すなわち、これらの問題の標準的な形は最悪時の格子問題と同程度に困難ですが、ここで解かれている変種は、最悪時の格子問題と同程度に困難であることが知られているパラメータ領域には含まれていません。誤り付き学習に関する結果は、入力が古典的な標本ではなく量子状態として与えられることを仮定しており、Gauss 型の雑音は対象外です。論文は、定理が雑音分布が Gauss である場合を対象としないと述べ、代わりに超 Gauss 型や有界一様分布を対象とするとしています。著者らは、この結果が実際に使われているいかなる格子暗号系の安全性にも影響しないと見られること、また必要な標本数が非常に大きいため Dilithium 署名方式への攻撃を改善しないことを明言しています。二面体剰余類問題については、自らの定理のパラメータが同程度の計算量で先行研究によって既に扱われていたとも述べています。Zoo がこの項目に与えている区分は「Exponential」ですが、論文自身の比較は本記録に引用したより狭い主張、すなわちこれらの変種については古典・量子を問わず多項式時間アルゴリズムが知られていなかったというものです。なお本記録は要旨、序論、定理の主張から書かれており、証明は参照していないため、結果がどのように確立されているかについては何も述べていません。",
    tags: ["lattice problems", "learning with errors", "short integer solution", "filtering", "post-quantum cryptography"],
    source: {
      id: "arxiv:2108.11015",
      title: "Quantum Algorithms for Variants of Average-Case Lattice Problems via Filtering",
      authors: "Yilei Chen, Qipeng Liu, Mark Zhandry",
      year: "2021",
      url: "https://arxiv.org/abs/2108.11015",
    },
    literature: [
      {
        title: "Quantum Algorithms for Variants of Average-Case Lattice Problems via Filtering",
        authors: "Yilei Chen, Qipeng Liu, Mark Zhandry",
        year: "2021",
        url: "https://arxiv.org/abs/2108.11015",
        relevance: "Primary source, and the source of this record's cost claim. Consult it above all for the boundary of the result: the abstract's statement that the variants solved are not in the parameter regimes known to be as hard as worst-case lattice problems, the remark after Theorem 8 that Gaussian noise is not covered, and the future-directions section where the authors state the work does not appear to affect the security of any lattice-based cryptosystem in use. The proofs in sections 4 through 7 were not read for this record.",
        relevanceJa: "一次資料であり、本記録の計算量の出典です。とりわけ結果の境界については原論文で確認してください。すなわち、解かれている変種が最悪時の格子問題と同程度に困難と知られるパラメータ領域には含まれないという要旨の記述、Gauss 型の雑音を対象としないという定理8の後の注意、および実際に使われている格子暗号系の安全性には影響しないと見られるという今後の方向性の節の記述です。第4節から第7節の証明は本記録のためには参照していません。",
      },
    ],
    relatedSlugs: ["shor-period-finding", "discrete-logarithm", "quantum-fourier-transform"],
  },
  {
    slug: "double-bracket-diagonalization",
    title: "Double-bracket iterations for diagonalization",
    titleJa: "対角化のための二重括弧反復",
    family: "Diagonalization · double-bracket flow",
    zooName: "Double-bracket quantum algorithms",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Unknown",
    speedupPrimary: {
      states: "absent",
      read: "arXiv:2206.11772 as retrieved — the abstract, the full introduction, sections 1.1 to 1.3, sections 1.6 and 1.7 where the query recursion is derived, part of section 2.2, Proposition 5 in section 3, section 4 on open questions, and fragments of the appendices. Every comparison in that text is against other quantum approaches — brute-force variational circuit optimization and quantum phase estimation — and the classical Lanczos algorithm appears only as context for a different paper's quantum adaptation, never as a baseline for this algorithm's cost. Section 2's numerical examples, section 5 and most of the appendix proofs were not retrieved and were not read.",
    },
    problem: "Find quantum circuits that diagonalize a given input Hamiltonian, that is, approximate its eigenstates, without resorting to brute-force optimization of an unstructured variational circuit, which runs into barren plateaus.",
    problemJa: "与えられた入力ハミルトニアンを対角化する、すなわちその固有状態を近似する量子回路を求める問題です。ただし、不毛の台地に阻まれる構造をもたない変分回路の力任せの最適化には頼らないことが目標です。",
    idea: "The method is a recursion in which each step conjugates the current Hamiltonian by the exponential of a commutator between it and a diagonal operator, the diagonal operator and the step duration both being chosen variationally. Each step is realized on a quantum computer by a group-commutator construction built purely from queries to an oblivious evolution oracle and from diagonal Clifford evolutions, so the abstract can say that no qubit overheads or controlled-unitary operations are needed. A transpiling algorithm assembles the query list recursively for a chosen number of steps. The paper's framing is that this replaces unstructured optimization with a structured flow that does not suffer the same trainability limitations, at an implementation cost lower than quantum phase estimation requires.",
    ideaJa: "この手法は、各段階で現在のハミルトニアンを、それと対角作用素との交換子の指数によって共役変換する再帰です。対角作用素と各段階の継続時間は、いずれも変分的に選ばれます。各段階は量子計算機上で群交換子の構成によって実現され、それは無記憶な時間発展オラクルへの問い合わせと対角的な Clifford 発展のみから組み立てられます。そのため要旨は、追加の量子ビットも制御ユニタリも必要としないと述べることができます。トランスパイルのアルゴリズムが、指定された段数に対して問い合わせの列を再帰的に組み立てます。論文の位置づけは、構造をもたない最適化を、同じ訓練可能性の限界を被らない構造化された流れで置き換えるものであり、その実装コストは量子位相推定が要するものより低い、というものです。",
    complexity: "Exponential in the number of recursion steps, and stated as such by the paper about its own method. The query count to the evolution oracle satisfies N(k+1) = 3N(k) + 1, whose solution with N(1) = 1 gives at most (3 + o(1))^K queries for K group-commutator recursion steps.",
    complexityBasis: 'abstract of arXiv:2206.11772: "the method is recursive which makes the circuit depth grow exponentially with the number of recursion steps."; sections 1.6 and 1.7, equations 51-52: "N (k + 1) = 3N (k) + 1 . The solution of this recursion, with N(1) = 1 as the starting point, gives the final result of queries to the evolution oracle to perform K GCI recursion steps N(K) ≤ (3 + o(1))^K , so an exponential scaling in the number of steps."; the introduction states the same: "The recursive character of double-bracket iterations leads to an exponential runtime of the quantum algorithms in the number of iteration steps."',
    caveat: "This is a literature record: no circuit was built, compiled, simulated or run here. The paper does not claim a speedup over classical computation and this record does not either; its comparisons are with other quantum methods. The cost above is the paper's own statement about its own method and it is exponential in the number of recursion steps, so the method is not a polynomial-time diagonalization procedure. The version that would actually be run carries no runtime guarantee at all — section 4 says there is no runtime guarantee for variational double-bracket iterations and calls understanding it a key theoretical challenge — and the convergence result the paper does have applies when the step durations are sufficiently short. The heuristic argument that the cost stays manageable leans on sparsity through Lieb-Robinson bounds, and the paper itself records Hastings's conjecture that such bounds do not hold for all double-bracket flows, so sparsity may be lost quickly. An appendix goes further and says that unless the behaviour is an artifact of the proof technique, a quantum device cannot approximate the continuous flow in polynomial runtime. The Zoo's speedup class for this entry is \"Unknown\", which is consistent with the paper. This record was written from a partial retrieval: the numerical examples in section 2, the conclusions in section 5 and most of the appendix proofs were not read.",
    caveatJa: "本項目は文献に基づく記録です。ここで回路を構成・コンパイル・シミュレート・実行したことはありません。論文は古典計算に対する高速化を主張しておらず、本記録もそれを主張しません。論文の比較対象は他の量子的手法です。上に示したコストは論文自身が自らの手法について述べたものであり、再帰の段数について指数的であるため、この手法は多項式時間の対角化手続きではありません。実際に実行されることになる版には、そもそも実行時間の保証がありません。第4節は、変分的な二重括弧反復には実行時間の保証がなく、その理解が重要な理論的課題であると述べています。論文が有する収束の結果は、各段階の継続時間が十分短い場合に適用されるものです。コストが扱える範囲に収まるという発見的な議論は Lieb-Robinson 限界による疎性に依拠していますが、論文自身が、そうした限界がすべての二重括弧の流れについて成り立つわけではないという Hastings の予想を記録しており、疎性は速やかに失われうるとしています。付録はさらに踏み込み、この振る舞いが証明技法の副産物でない限り、量子デバイスは連続的な流れを多項式実行時間で近似できないと述べています。Zoo がこの項目に与えている区分「Unknown」は論文と整合しています。なお本記録は部分的な取得に基づいて書かれており、第2節の数値例、第5節の結論、および付録の証明の大部分は参照していません。",
    tags: ["diagonalization", "double-bracket flow", "group commutator", "barren plateaus", "eigenstate preparation"],
    source: {
      id: "arxiv:2206.11772",
      title: "Double-bracket quantum algorithms for diagonalization",
      authors: "Marek Gluza",
      year: "2022",
      url: "https://arxiv.org/abs/2206.11772",
    },
    literature: [
      {
        title: "Double-bracket quantum algorithms for diagonalization",
        authors: "Marek Gluza",
        year: "2022",
        url: "https://arxiv.org/abs/2206.11772",
        relevance: "Primary source, and the source of this record's cost claim. Consult it for the group-commutator construction that realizes one step from evolution-oracle queries alone, for the recursion in sections 1.6 and 1.7 that makes the query count exponential in the number of steps, and for section 4, where the author states there is no runtime guarantee for the variational version that would actually be run.",
        relevanceJa: "一次資料であり、本記録の計算量の出典です。時間発展オラクルへの問い合わせだけで1段階を実現する群交換子の構成、問い合わせ回数を段数について指数的にする第1.6節と第1.7節の再帰、および実際に実行されることになる変分版には実行時間の保証がないと著者が述べている第4節については、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["qite-imaginary-time", "vqe-ground-state-energy", "quantum-phase-estimation"],
  },
  {
    slug: "quantum-primality-test-order-finding",
    title: "Primality proving by quantum order finding",
    titleJa: "量子的な位数発見による素数性の証明",
    family: "Computational number theory",
    zooName: "Primality Proving",
    zooSection: "Algebraic and Number Theoretic Algorithms",
    speedup: "Polynomial",
    speedupPrimary: {
      states: "reported",
      quote: "Its complexity is essentially quadratic in the asymptotic limit, which is more efficient than classical tests that prove primality with certainty, which are usually restricted to integers of a particular form, or require a number of operations of the order of the sixth power of the number of bits (AKS test).",
    },
    problem: "Prove that a given integer N is prime, or in most cases prove it composite and produce a witness, rather than merely declaring it probably prime as a randomized primality test does.",
    problemJa: "与えられた整数 N が素数であることを証明するか、多くの場合には合成数であることを証拠つきで証明する問題です。確率的な素数判定法のように、おそらく素数であると宣言するだけにとどめないことが目標です。",
    idea: "By Lucas's theorem, if some element of the multiplicative group modulo N has order exactly N − 1, then N is prime. The algorithm picks a random a; if the greatest common divisor of a and N is not one, the divisor itself proves N composite. Otherwise it computes a^((N−1)/2) mod N classically as a cheap Fermat screen: if the result is neither +1 nor −1 then N is composite with a as witness, if it is +1 the algorithm restarts, and only if it is −1 — which guarantees that the order divides N − 1 — does it invoke quantum order finding to compute the order exactly. If that order is N − 1, then N is prime and a is a quantum certificate of its primality. The classical screen exists precisely to avoid paying for the quantum subroutine when it would not yet be informative.",
    ideaJa: "Lucas の定理により、N を法とする乗法群のある元の位数がちょうど N − 1 であれば、N は素数です。アルゴリズムはまず a を無作為に選びます。a と N の最大公約数が1でなければ、その約数自体が N が合成数であることの証明になります。そうでなければ、安価な Fermat 型のふるいとして a^((N−1)/2) mod N を古典的に計算します。結果が +1 でも −1 でもなければ N は合成数であり a がその証拠となります。+1 であればアルゴリズムはやり直します。−1 の場合にのみ、位数が N − 1 を割り切ることが保証されるため、量子的な位数発見を呼び出して位数を厳密に求めます。その位数が N − 1 であれば N は素数であり、a はその素数性の量子的な証明書となります。この古典的なふるいは、まだ有益でない段階で量子副手続きの費用を払わずに済ませるためにこそ置かれています。",
    complexity: "O((log n)² n³) operations for an n-bit number N, reducible to O(log log n (log n)³ n²) in the asymptotic limit if fast multiplication is used. The paper states that this reduces the asymptotic complexity of the earlier Chau-Lo quantum primality test from O((log n)(log log n) n³) to O((log log n)(log n)³ n²).",
    complexityBasis: 'abstract of arXiv:1711.02616: "The algorithm requires O((log n)^2 n^3) operations for a number N with n bits, which can be reduced to O(log log n(log n)^3 n^2) operations in the asymptotic limit if we use fast multiplication."; body: "The total expected complexity of our algorithm is O((log n)^2 n^3) for the log n repetitions needed to find an element of order N − 1 with high probability."; and, for the comparison with the earlier test: "Our algorithm reduces the asymptotic complexity of the Chau-Lo quantum primality test from O((log n)(log log n)n^3) to O((log log n)(log n)^3n^2)."',
    caveat: "This is a literature record: no circuit was built, compiled, simulated or run, and no integer was tested here. The stated complexity treats quantum order finding as a black box costing O((log n) n³) operations rather than as an implemented primitive, so the figures inherit whatever that subroutine actually costs, including its error-correction overhead, which is not addressed. The faster asymptotic bound requires fast multiplication, and the paper says the constant factors make it worthwhile only in the asymptotic limit for very large N, so it is not the figure that applies at practical sizes. The test trades away something real: the authors state that they lose the classical certificate of primality of the Chau-Lo test and offer a quantum certificate instead, so the output cannot be checked on a classical machine. Compositeness is proved with certainty and a witness only most of the time; otherwise, after a bounded number of unsuccessful attempts, the algorithm declares N composite with high probability rather than certainty. The comparison with the AKS test is against a deterministic classical algorithm that proves primality with certainty, which is a narrower class than primality testing in general, and the paper notes that no classical algorithm is known that determines the order of an integer efficiently — so this is not a speedup over an available classical primitive but a method that is quantum by construction.",
    caveatJa: "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、具体的な整数を判定したわけでもありません。示されている計算量は、量子的な位数発見を実装されたプリミティブとしてではなく、O((log n) n³) 回の演算を要するブラックボックスとして扱っています。したがってこれらの数値は、その副手続きが実際に要するコストを、誤り訂正のオーバーヘッドも含めてそのまま引き継ぎますが、その点は論じられていません。より速い漸近的な評価は高速乗算を必要とし、論文は、定数因子のためにそれが割に合うのは非常に大きな N についての漸近的な極限においてのみであると述べているため、実用的な大きさで当てはまる数値ではありません。この判定法は実在するものを手放してもいます。著者らは、Chau-Lo の判定法がもつ古典的な素数性の証明書を失い、代わりに量子的な証明書を与えると述べており、出力を古典計算機で検証することはできません。合成数であることが証拠つきで確実に示されるのは多くの場合にとどまり、そうでない場合には、一定回数の試行が失敗した後、確実にではなく高い確率で N を合成数と宣言します。AKS 判定法との比較の対象は、素数性を確実に証明する決定的な古典アルゴリズムであり、これは素数判定一般より狭い枠組みです。また論文は、整数の位数を効率的に決定する古典アルゴリズムは知られていないと述べており、したがってこれは利用可能な古典プリミティブに対する高速化ではなく、構成上そもそも量子的な手法です。",
    tags: ["primality proving", "order finding", "lucas theorem", "aks test", "number theory"],
    source: {
      id: "arxiv:1711.02616",
      title: "A quantum primality test with order finding",
      authors: "Alvaro Donis-Vela, Juan Carlos Garcia-Escartin",
      year: "2017",
      url: "https://arxiv.org/abs/1711.02616",
    },
    literature: [
      {
        title: "A quantum primality test with order finding",
        authors: "Alvaro Donis-Vela, Juan Carlos Garcia-Escartin",
        year: "2017",
        url: "https://arxiv.org/abs/1711.02616",
        relevance: "Primary source, and the source of this record's cost claim. Consult it for the classical Fermat screen that decides when the quantum subroutine is worth invoking, for the black-box treatment of order finding that every stated figure depends on, and for the passage where the authors accept losing the classical certificate of primality in exchange for a quantum one.",
        relevanceJa: "一次資料であり、本記録の計算量の出典です。量子副手続きを呼び出す価値があるかを判断する古典的な Fermat 型のふるい、示されているすべての数値が依存する位数発見のブラックボックスとしての扱い、および古典的な素数性の証明書を失う代わりに量子的な証明書を得ることを著者らが受け入れている箇所については、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["shor-period-finding", "discrete-logarithm", "exponential-congruences"],
  },
  {
    slug: "pell-equation-regulator",
    title: "Pell's equation by computing the regulator",
    titleJa: "基本単数の対数の計算によるPell方程式の求解",
    family: "Computational number theory",
    zooName: "Pell's Equation",
    zooSection: "Algebraic and Number Theoretic Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: {
      states: "reported",
      quote: "The best algorithm for factoring integers has expected time L(1/3,b) for some constant b [LL93]. Assuming the GRH, the best algorithms for Pell's equation and the principal ideal problem have expected time L(1/2,b′), for some constant b′, so there is a sub-exponential gap between the best known classical algorithms.",
    },
    problem: "Given a positive non-square integer d, Pell's equation is x² − dy² = 1 and the goal is to find all integer solutions. The least solution can have exponentially many bits, so it cannot be written down; the computational problem is instead to compute the integer part of the regulator R = ln(x₁ + y₁√d), from which the solution can be recovered.",
    problemJa: "平方数でない正の整数 d が与えられたとき、Pell 方程式 x² − dy² = 1 のすべての整数解を求めることが目標です。ただし最小解はビット数が指数的に大きくなりうるため、そのまま書き下すことはできません。そこで計算上の問題は、基本解から定まる調整子 R = ln(x₁ + y₁√d) の整数部分を求めることに置き換えられます。解はそこから復元できます。",
    idea: "Hallgren extends the hidden subgroup problem from finite groups to the group of real numbers. The regulator is an irrational period of a function defined on reduced ideals through a distance function, so the task becomes period finding where the period is not an integer and the group is not discrete. A discretized, pseudo-periodic version of that function is Fourier sampled twice over Z_q, and the two integer outputs are combined by a continued-fraction expansion to recover an integer close to the irrational period. Classical ideal composition and reduction on reduced quadratic ideals supply the function evaluations, which the paper shows can be done in time polynomial in log Δ. The framework is Shor's, applied to a group-like subset of the reals rather than to a group.",
    ideaJa: "Hallgren は隠れ部分群問題を有限群から実数の加法群へ拡張します。調整子は、距離関数を通じて被約イデアル上に定義される関数の無理数の周期であるため、問題は、周期が整数でなく群も離散でない状況における周期発見となります。この関数を離散化した擬周期的な版を Z_q 上で二度 Fourier サンプリングし、得られた二つの整数を連分数展開によって組み合わせることで、無理数の周期に近い整数を復元します。関数の値は被約な二次イデアルに対する古典的なイデアルの合成と簡約によって与えられ、論文はこれが log Δ の多項式時間で行えることを示しています。枠組みは Shor のものですが、適用先は群ではなく実数の中の群に似た部分集合です。",
    complexity: "Polynomial in log Δ and log δ, where Δ is the quadratic discriminant and δ the precision to which the regulator is approximated, with probability exponentially close to one.",
    complexityBasis: 'section 3.2, Theorem 2 of the J. ACM version (doi:10.1145/1206035.1206039): "There is a polynomial-time quantum algorithm that, given a quadratic discriminant ∆, approximates the regulator to within δ of the associated order O in time polynomial in log∆ and logδ with probability exponentially close to one."; the supporting evaluation bound is section 2, Theorem 1, which states that the discretized function can be evaluated in time polynomial in log∆ with high probability.',
    caveat: "This is a literature record: nothing was constructed, compiled, simulated or run, and no instance of Pell's equation was solved here. What the algorithm returns is an approximation of the regulator to a requested precision, not the least solution and not an exact regulator; the paper says the approximation is refined afterwards using classical algorithms. The result holds for real quadratic fields — degree two over the rationals — and nothing here covers higher degree; the paper says so and treats the general case as later work. The paper flags a genuine gap in the period-finding-over-the-reals machinery it introduces, noting in section 3.1 that it is an open question whether some fixed precision works for all ideals, so the choice of working precision is not settled in general by this document. The quantum result itself is unconditional and that is the paper's point — it contrasts with the classical algorithms, whose running time and correctness both depend on the generalized Riemann hypothesis. But the sub-exponential gap quoted on this record is a gap against the best classical algorithms known, not a proved lower bound, and one side of that comparison is itself GRH-conditional. Computing the class group is a separate matter that the same paper says does need the GRH.",
    caveatJa: "本項目は文献に基づく記録です。ここで何かを構成・コンパイル・シミュレート・実行したことはなく、具体的な Pell 方程式を解いたわけでもありません。アルゴリズムが返すのは要求された精度での調整子の近似値であり、最小解でも厳密な調整子でもありません。論文は、この近似がその後に古典的なアルゴリズムによって精密化されると述べています。結果が成り立つのは実二次体、すなわち有理数体上の次数2の体についてであり、より高次の場合はここでは扱われていません。論文もそう述べ、一般の場合を後の課題としています。また論文は、自ら導入した実数上の周期発見の機構に実在する隙間を指摘しており、第3.1節において、ある固定した精度がすべてのイデアルについて有効かどうかは未解決問題であると述べています。したがって、作業精度の選び方は本文献によって一般に解決されているわけではありません。量子側の結果自体は無条件であり、それこそが論文の主眼です。すなわち、実行時間と正しさの双方が一般化 Riemann 予想に依存する古典アルゴリズムとの対比です。ただし本記録に引用した劣指数的な差は、知られている最良の古典アルゴリズムに対する差であって証明された下界ではなく、しかもその比較の一方は それ自体が一般化 Riemann 予想に依存しています。類群の計算は別の話であり、同じ論文が、そちらには一般化 Riemann 予想が必要であると述べています。",
    tags: ["pell equation", "regulator", "real quadratic field", "hidden subgroup problem", "period finding"],
    source: {
      id: "doi:10.1145/1206035.1206039",
      title: "Polynomial-Time Quantum Algorithms for Pell's Equation and the Principal Ideal Problem",
      authors: "Sean Hallgren",
      year: "2007",
      url: "https://doi.org/10.1145/1206035.1206039",
    },
    literature: [
      {
        title: "Polynomial-Time Quantum Algorithms for Pell's Equation and the Principal Ideal Problem",
        authors: "Sean Hallgren",
        year: "2007",
        url: "https://doi.org/10.1145/1206035.1206039",
        relevance: "Primary source, and the source of this record's cost claim. The full text is freely available from the author's page at the Pennsylvania State University; the version read for this record is the longer journal manuscript, whose own footnote says a preliminary version appeared at STOC 2002, which is the version the Quantum Algorithm Zoo cites. Consult it for the extension of the hidden subgroup problem to the reals, for the two Fourier samplings combined by continued fractions, and for the open question in section 3.1 about whether a fixed precision suffices for all ideals.",
        relevanceJa: "一次資料であり、本記録の計算量の出典です。全文は著者のペンシルベニア州立大学のページから自由に入手できます。本記録のために参照したのは、より長い雑誌版の原稿であり、その脚注自身が、予稿版が STOC 2002 に現れたと述べています。Quantum Algorithm Zoo が引用しているのはその予稿版です。隠れ部分群問題の実数への拡張、連分数によって組み合わされる二度の Fourier サンプリング、および固定した精度がすべてのイデアルに対して十分かどうかという第3.1節の未解決問題については、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["principal-ideal-problem", "shor-period-finding", "discrete-logarithm"],
  },
  {
    slug: "principal-ideal-problem",
    title: "The principal ideal problem in a real quadratic field",
    titleJa: "実二次体における単項イデアル問題",
    family: "Computational number theory",
    zooName: "Principal Ideal",
    zooSection: "Algebraic and Number Theoretic Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: {
      states: "reported",
      quote: "Assuming the GRH, the best algorithms for Pell's equation and the principal ideal problem have expected time L(1/2,b′), for some constant b′, so there is a sub-exponential gap between the best known classical algorithms.",
    },
    problem: "Given an invertible ideal I in a real quadratic field, determine whether there exists an α with I = αZ[√d] — that is, whether the ideal is principal — and if there is, find α.",
    problemJa: "実二次体の可逆イデアル I が与えられたとき、I = αZ[√d] を満たす α が存在するかどうか、すなわちそのイデアルが単項であるかどうかを判定し、存在する場合には α を求める問題です。",
    idea: "The principal ideal problem is solved with the same period-finding-over-the-reals machinery that gives the regulator, but in two dimensions rather than one. Where the regulator is the period of a function on the reals, deciding principality asks for the distance of a given ideal, which the paper handles on Z × R by analogy with Shor's discrete-logarithm algorithm — the two-dimensional version of the same construction. The paper is explicit that the object being sampled is not a group but, as it puts it, a group-like subset of the reals, modulo an irrational number, which is why the standard hidden-subgroup analysis does not apply unchanged.",
    ideaJa: "単項イデアル問題は、調整子を与えるのと同じ実数上の周期発見の機構によって解かれますが、次元は1ではなく2になります。調整子が実数上の関数の周期であるのに対し、単項性の判定は与えられたイデアルの距離を求めることに帰着し、論文はこれを Shor の離散対数アルゴリズムとの類比により Z × R 上で扱います。すなわち同じ構成の二次元版です。論文は、標本を取る対象が群ではなく、論文の言葉でいえば無理数を法とする実数の中の群に似た部分集合であることを明言しており、そのために標準的な隠れ部分群の解析がそのままでは適用できないと述べています。",
    complexity: "Polynomial in log Δ when the regulator is larger than some absolute constant, with success probability Ω(1/log Δ) per run; polynomially many repetitions in log Δ raise that to probability exponentially close to one.",
    complexityBasis: 'section 4, Theorem 3 of doi:10.1145/1206035.1206039: "The above algorithm approximates the distance of a principal ideal in time polynomial in log∆ when the regulator is larger than some absolute constant. The algorithm is successful with probability Ω(1/log(∆)). Polynomial in log∆ repetitions gives probability exponentially close to one."',
    caveat: "This is a literature record: nothing was constructed, compiled, simulated or run, and no ideal was tested for principality here. The theorem is narrower than the regulator theorem in the same paper and the difference is worth carrying: it applies only when the regulator exceeds an absolute constant, and a single run succeeds with probability only Ω(1/log Δ), so the useful statement requires polynomially many repetitions rather than being a one-shot high-probability test. What is approximated is the distance of the ideal, not an exact generator α. The result is for real quadratic fields only; arbitrary degree is not covered by this paper, and the companion STOC 2005 paper that goes further reaches only constant degree. The classical comparison quoted here is against the best known algorithms and is itself conditional on the generalized Riemann hypothesis on the classical side, so the sub-exponential gap is a gap between a proved quantum bound and a conditional classical one, not a proved separation. The same paper notes separately that computing the class group does need the GRH.",
    caveatJa: "本項目は文献に基づく記録です。ここで何かを構成・コンパイル・シミュレート・実行したことはなく、具体的なイデアルの単項性を判定したわけでもありません。この定理は同じ論文の調整子に関する定理より狭く、その差は記録しておく価値があります。すなわち、適用できるのは調整子がある絶対定数を超える場合に限られ、1回の実行が成功する確率は Ω(1/log Δ) にすぎないため、有用な主張を得るには多項式回の反復が必要であり、一度きりで高確率に判定できるわけではありません。近似されるのはイデアルの距離であって、厳密な生成元 α ではありません。結果の対象は実二次体のみであり、任意次数はこの論文では扱われていません。さらに進んだ後続の STOC 2005 論文でも到達しているのは定数次数までです。ここに引用した古典側との比較は知られている最良のアルゴリズムに対するものであり、しかも古典側は一般化 Riemann 予想に依存しているため、この劣指数的な差は、証明された量子側の評価と条件付きの古典側の評価との差であって、証明された分離ではありません。同じ論文は、類群の計算には一般化 Riemann 予想が必要であることを別に述べています。",
    tags: ["principal ideal problem", "real quadratic field", "ideal class", "hidden subgroup problem", "period finding"],
    source: {
      id: "doi:10.1145/1206035.1206039",
      title: "Polynomial-Time Quantum Algorithms for Pell's Equation and the Principal Ideal Problem",
      authors: "Sean Hallgren",
      year: "2007",
      url: "https://doi.org/10.1145/1206035.1206039",
    },
    literature: [
      {
        title: "Polynomial-Time Quantum Algorithms for Pell's Equation and the Principal Ideal Problem",
        authors: "Sean Hallgren",
        year: "2007",
        url: "https://doi.org/10.1145/1206035.1206039",
        relevance: "Primary source, and the source of this record's cost claim. Consult it for Theorem 3 specifically, which carries two conditions the regulator theorem does not — a lower bound on the regulator and a per-run success probability of only Ω(1/log Δ) — and for the two-dimensional analogue of the real hidden-subgroup construction that the principality test is built on.",
        relevanceJa: "一次資料であり、本記録の計算量の出典です。とりわけ定理3を原論文で確認してください。この定理には、調整子に関する定理にはない二つの条件、すなわち調整子の下界と、1回の実行あたり Ω(1/log Δ) にとどまる成功確率が付されています。単項性の判定が拠って立つ、実数上の隠れ部分群の構成の二次元版についても同論文で確認できます。",
      },
    ],
    relatedSlugs: ["pell-equation-regulator", "class-group-of-a-number-field", "shor-period-finding"],
  },
  {
    slug: "unit-group-of-a-number-field",
    title: "The unit group of a constant-degree number field",
    titleJa: "定数次数の代数体の単数群",
    family: "Computational number theory",
    zooName: "Unit Group",
    zooSection: "Algebraic and Number Theoretic Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: {
      states: "absent",
      read: "the full text of doi:10.1145/1060590.1060660 as published on the author's page — abstract and sections 1 through 6, acknowledgments and references, all ten pages. The paper compares itself with classical work only structurally, not by cost: it observes that factoring reduces to Pell's equation, which is a special case of computing the unit group, while a reduction in the other direction is not known and appears more difficult, and that the best classical algorithm for either the unit group or the class group solves both at once. No classical running time is stated anywhere, in L-notation or otherwise, unlike the companion Pell paper which does state one.",
    },
    problem: "The unit group of a number field is the set of invertible algebraic integers inside it. By Dirichlet's unit theorem it is, up to a root of unity, free abelian of a rank determined by the field's real and complex embeddings, so computing it means finding a fundamental system of units.",
    problemJa: "代数体の単数群とは、その中の可逆な代数的整数全体のなす群です。Dirichlet の単数定理により、この群は1の冪根を除いて自由アーベル群であり、その階数は体の実埋め込みと複素埋め込みの個数から定まります。したがってこの群を計算するとは、基本単数系を求めることを意味します。",
    idea: "Hallgren generalizes the real-valued hidden subgroup framework of his Pell's equation paper from one dimension to r dimensions, for constant r, recasting the unit group computation as finding the basis of an unknown real-valued lattice — the logarithmic embedding of the unit group. The algorithm Fourier samples a function that hides that lattice and uses a zero-filling trick, padding the Fourier domain, to recover enough of the dual lattice from a constant number of samples, then inverts to obtain a basis for the lattice itself. Reaching the lattice at all requires computing reduced ideals near arbitrary points, which the paper obtains from a classical subroutine. The unit group algorithm is the base of a stack: the paper's principal ideal algorithm uses it, and its class group algorithm uses both.",
    ideaJa: "Hallgren は、Pell 方程式の論文における実数値の隠れ部分群の枠組みを、1次元から定数 r 次元へ一般化し、単数群の計算を、未知の実数値格子の基底を求める問題、すなわち単数群の対数埋め込みの格子の基底を求める問題として捉え直します。アルゴリズムはこの格子を隠す関数を Fourier サンプリングし、Fourier 領域を詰め物で埋めるゼロ充填の技法によって、定数個の標本から双対格子の十分な部分を復元し、それを逆にして格子自身の基底を得ます。そもそもこの格子に到達するには、任意の点の近くの被約イデアルを計算する必要があり、論文はそれを古典的な副手続きから得ています。単数群のアルゴリズムは積み重ねの土台であり、同論文の単項イデアルのアルゴリズムはこれを用い、類群のアルゴリズムはその両方を用います。",
    complexity: "Quantum polynomial time, for a number field of constant degree. The paper states the bound as a theorem in exactly those terms and gives no exponent, and the degree appears as a restriction rather than as a parameter of the bound.",
    complexityBasis: 'section 3.2, Theorem 1 of doi:10.1145/1060590.1060660: "Algorithm 3.1 computes the unit group of a constant degree number field in quantum polynomial-time."; the abstract states the same scope for both results in the paper: "We give polynomial-time quantum algorithms for computing the unit group and class group when the number field has constant degree."',
    caveat: "This is a literature record: nothing was constructed, compiled, simulated or run, and no unit group was computed here. The constant-degree restriction is not a convenience, it is the boundary of the result, and the paper explains why it is there: the method only appears to work for a constant number of dimensions because the rounding introduces noise not present in the integer lattice case, and the ideal-reduction machinery is itself polynomial-time only for constant degree because it computes shortest vectors of lattices whose dimension is tied to the field degree. Arbitrary degree is named as an open problem. The theorem carries a further technical hypothesis, that the lattice be well conditioned in the sense that the product of the norms of a basis matrix and its inverse is bounded, which is presented as a required condition rather than shown to hold in general. The classical access step depends on results the paper cites as unpublished at the time — a thesis result for computing reduced ideals near arbitrary points, and a then-unpublished algorithm of Schoof — so the end-to-end claim rests on documents outside this record. Unlike the class group result in the same paper, this one does not assume the generalized Riemann hypothesis, and that distinction is deliberate on the author's part. The Zoo files this entry as a superpolynomial speedup; that class is the Zoo's, because the paper states no classical running time to compare against.",
    caveatJa: "本項目は文献に基づく記録です。ここで何かを構成・コンパイル・シミュレート・実行したことはなく、具体的な単数群を計算したわけでもありません。定数次数という制限は便宜上のものではなく結果の境界であり、論文はその理由を説明しています。すなわち、丸めが整数格子の場合には現れない雑音を持ち込むため、この方法は次元が定数の場合にしか有効に見えないこと、またイデアルの簡約の機構自体も、体の次数に結びついた次元の格子の最短ベクトルを計算するため、定数次数の場合にのみ多項式時間であることです。任意次数は未解決問題として挙げられています。定理にはさらに技術的な仮定があり、格子が良条件であること、すなわち基底行列とその逆行列のノルムの積が有界であることが要求されますが、これは一般に成り立つことが示されるのではなく必要条件として提示されています。古典的なアクセスの段階は、論文が当時未公刊として引用している結果、すなわち任意の点の近くの被約イデアルを計算する学位論文の結果と、当時未公刊であった Schoof のアルゴリズムに依存しているため、端から端までの主張は本記録の対象外の文献に依拠しています。同じ論文の類群に関する結果とは異なり、こちらは一般化 Riemann 予想を仮定しておらず、その区別は著者が意図的に設けたものです。Zoo はこの項目を超多項式的な高速化に分類していますが、その区分は Zoo によるものです。論文は比較対象となる古典的な実行時間を述べていないからです。",
    tags: ["unit group", "number field", "dirichlet unit theorem", "lattice basis", "hidden subgroup problem"],
    source: {
      id: "doi:10.1145/1060590.1060660",
      title: "Fast Quantum Algorithms for Computing the Unit Group and Class Group of a Number Field",
      authors: "Sean Hallgren",
      year: "2005",
      url: "https://doi.org/10.1145/1060590.1060660",
    },
    literature: [
      {
        title: "Fast Quantum Algorithms for Computing the Unit Group and Class Group of a Number Field",
        authors: "Sean Hallgren",
        year: "2005",
        url: "https://doi.org/10.1145/1060590.1060660",
        relevance: "Primary source, and the source of this record's cost claim. The full text is freely available from the author's page at the Pennsylvania State University. Consult it for the two separate reasons the constant-degree restriction exists, for the well-conditioned-lattice hypothesis attached to Theorem 1, and for the sentence in section 1 that separates this result from the class group one — the algorithms use no assumptions except when computing the class group, where the GRH is needed.",
        relevanceJa: "一次資料であり、本記録の計算量の出典です。全文は著者のペンシルベニア州立大学のページから自由に入手できます。定数次数という制限が存在する二つの別々の理由、定理1に付された良条件の格子という仮定、およびこの結果を類群の結果から切り分けている第1節の一文、すなわち類群を計算する場合を除いてアルゴリズムはいかなる仮定も用いないという記述については、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["class-group-of-a-number-field", "principal-ideal-problem", "pell-equation-regulator"],
  },
  {
    slug: "class-group-of-a-number-field",
    title: "The class group of a constant-degree number field",
    titleJa: "定数次数の代数体のイデアル類群",
    family: "Computational number theory",
    zooName: "Class Group",
    zooSection: "Algebraic and Number Theoretic Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: {
      states: "absent",
      read: "the full text of doi:10.1145/1060590.1060660 as published on the author's page — abstract and sections 1 through 6, acknowledgments and references, all ten pages. The only comparison with classical work is structural: that the best classical algorithm for either the unit group or the class group solves both simultaneously, whereas the quantum algorithms here are layered, the class group one calling the previous two. No classical running time is stated anywhere.",
    },
    problem: "The class group of a number field is the finite abelian group of ideals modulo principal ideals. Computing it means computing the structure of that abelian group, not merely its order.",
    problemJa: "代数体のイデアル類群とは、イデアル全体を単項イデアルで割って得られる有限アーベル群です。これを計算するとは、その位数だけでなくアーベル群としての構造を求めることを意味します。",
    idea: "The class group algorithm sits on top of the other two results in the same paper. Ideals have no unique representatives, which is what blocks a direct application of the standard finite-abelian-group hidden subgroup machinery, so the algorithm instead prepares a quantum superposition over all reduced ideals in an equivalence class, using the principal ideal algorithm as a subroutine, and that superposition serves as the unique encoding the standard machinery needs. Feeding those states into the usual abelian hidden subgroup algorithm and a Smith normal form decomposition then yields the group structure. A set of generators for the class group must be available before any of this runs, and that is the step where the generalized Riemann hypothesis enters.",
    ideaJa: "類群のアルゴリズムは、同じ論文の他の二つの結果の上に乗っています。イデアルには一意な代表元がなく、それが有限アーベル群に対する標準的な隠れ部分群の機構を直接適用することを妨げています。そこでアルゴリズムは、単項イデアルのアルゴリズムを副手続きとして用いて、一つの同値類に属するすべての被約イデアルにわたる量子的な重ね合わせを用意し、その重ね合わせが標準的な機構の要求する一意な符号化の役割を果たします。これらの状態を通常の可換隠れ部分群のアルゴリズムと Smith 標準形の分解にかけることで、群の構造が得られます。以上のすべてを走らせる前に類群の生成系が必要であり、一般化 Riemann 予想が入ってくるのはまさにこの段階です。",
    complexity: "Quantum polynomial time for a number field of constant degree, assuming the generalized Riemann hypothesis. Both conditions are stated in the theorem itself and neither is dropped elsewhere in the paper.",
    complexityBasis: 'section 5, Theorem 3 of doi:10.1145/1060590.1060660: "The class group of a constant degree number field can be computed in quantum polynomial-time assuming the GRH."; the paper localises the assumption in section 1: "Our algorithms here do not use any assumptions, except for when computing the class group where the GRH is needed to compute a set of generators for the group", and again at the point of use in section 5: "Generators g1,...,gm for Cl can be chosen in polynomial-time assuming the GRH".',
    caveat: "This is a literature record: nothing was constructed, compiled, simulated or run, and no class group was computed here. This result is conditional and its companion is not, which is the single most important thing to carry from the paper: the unit group theorem in the same document assumes nothing, while this one assumes the generalized Riemann hypothesis. The assumption is not decorative and the paper says exactly where it bites — it is needed to choose a set of generators for the group in polynomial time, which is a precondition of the whole construction rather than a step inside it. The constant-degree restriction applies here as it does to the unit group, for the same two reasons, and arbitrary degree is an open problem. The algorithm is layered on the paper's own unit group and principal ideal algorithms, so every hypothesis those carry, including the well-conditioned-lattice condition and the reliance on classical subroutines the paper cites as unpublished, is inherited here. The Zoo files this entry as a superpolynomial speedup; that class is the Zoo's, because the paper states no classical running time and compares itself with classical work only structurally.",
    caveatJa: "本項目は文献に基づく記録です。ここで何かを構成・コンパイル・シミュレート・実行したことはなく、具体的な類群を計算したわけでもありません。この結果は条件付きであり、対になる結果はそうではないという点が、この論文から持ち帰るべき最も重要な事実です。すなわち、同じ文献の中の単数群に関する定理は何も仮定しないのに対し、こちらは一般化 Riemann 予想を仮定します。この仮定は飾りではなく、論文はそれがどこで効いてくるかを正確に述べています。それは群の生成系を多項式時間で選ぶために必要であり、構成の中の一段階というより構成全体の前提条件です。定数次数の制限は単数群の場合と同じ二つの理由からここにも適用され、任意次数は未解決問題です。このアルゴリズムは同論文の単数群および単項イデアルのアルゴリズムの上に積み重なっているため、良条件の格子という条件や、論文が未公刊として引用している古典的な副手続きへの依存を含め、それらが負うすべての仮定をここでも引き継ぎます。Zoo はこの項目を超多項式的な高速化に分類していますが、その区分は Zoo によるものです。論文は古典的な実行時間を述べておらず、古典的な研究との比較も構造的なものにとどまるからです。",
    tags: ["class group", "number field", "ideal class group", "generalized riemann hypothesis", "hidden subgroup problem"],
    source: {
      id: "doi:10.1145/1060590.1060660",
      title: "Fast Quantum Algorithms for Computing the Unit Group and Class Group of a Number Field",
      authors: "Sean Hallgren",
      year: "2005",
      url: "https://doi.org/10.1145/1060590.1060660",
    },
    literature: [
      {
        title: "Fast Quantum Algorithms for Computing the Unit Group and Class Group of a Number Field",
        authors: "Sean Hallgren",
        year: "2005",
        url: "https://doi.org/10.1145/1060590.1060660",
        relevance: "Primary source, and the source of this record's cost claim. Consult it for section 5, where the GRH assumption is localised to choosing a generating set, and for the superposition over reduced ideals in an equivalence class that stands in for the unique encoding the abelian hidden subgroup machinery requires. Reading it beside the unit group record is the point: one theorem in this paper is unconditional and the other is not.",
        relevanceJa: "一次資料であり、本記録の計算量の出典です。一般化 Riemann 予想の仮定が生成系の選択に限定されている第5節、および可換隠れ部分群の機構が要求する一意な符号化の代わりを務める、同値類内の被約イデアルにわたる重ね合わせについては、原論文で確認してください。単数群の記録と並べて読むことにこそ意味があります。この論文の一方の定理は無条件であり、他方はそうではないからです。",
      },
    ],
    relatedSlugs: ["unit-group-of-a-number-field", "principal-ideal-problem", "pell-equation-regulator"],
  },
  {
    slug: "irreducible-representation-matrix-elements",
    title: "Matrix elements of irreducible group representations",
    titleJa: "群の既約表現の行列成分",
    family: "Quantum Fourier transform",
    zooName: "Matrix Elements and Multiplicity Coefficients of Group Representations",
    zooSection: "Algebraic and Number Theoretic Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: {
      states: "reported",
      quote: "These quantum algorithms offer exponential speedup in worst case complexity over the fastest known classical algorithms. On the other hand, we show that average case instances are classically easy, and that the techniques analyzed here do not offer a speedup over classical computation for the estimation of group characters.",
    },
    problem: "Estimate a matrix element of a unitary irreducible representation of a group — a single entry of a matrix whose dimension may be exponentially large — to within an additive error, for the symmetric and alternating groups and for the unitary, special unitary and special orthogonal groups of polynomial highest weight.",
    problemJa: "群のユニタリ既約表現の行列成分、すなわち次元が指数的に大きくなりうる行列のただ一つの成分を、加法的な誤差の範囲で推定する問題です。対象は対称群と交代群、および多項式的な最高ウェイトをもつユニタリ群、特殊ユニタリ群、特殊直交群です。",
    idea: "Everything routes through the Hadamard test, which turns an efficient circuit for a unitary together with efficient state preparation into an additive estimate of an expectation value. For a finite group with an efficient quantum Fourier transform, conjugating the regular representation by the transform yields the direct sum of all irreducible representations, which gives the matrix elements. For the unitary and symmetric groups jointly, the quantum Schur transform block-diagonalizes both actions at once. For the Lie groups of polynomial highest weight, the matrix elements come from simulating a sparse, row-computable Hamiltonian built from Gel'fand-Tsetlin generators. For the symmetric and alternating groups directly, a permutation is decomposed into neighbour transpositions by bubblesort, and the Young-Yamanouchi representation of a neighbour transposition is a simple direct sum of small blocks.",
    ideaJa: "すべての道筋は Hadamard テストを経由します。これは、あるユニタリに対する効率的な回路と効率的な状態準備とを、期待値の加法的な推定へ変えるものです。効率的な量子 Fourier 変換をもつ有限群については、正則表現をその変換で共役変換すると、すべての既約表現の直和が得られ、そこから行列成分が得られます。ユニタリ群と対称群を同時に扱う場合には、量子 Schur 変換が両方の作用を一度にブロック対角化します。多項式的な最高ウェイトをもつ Lie 群については、行列成分は Gel'fand-Tsetlin 生成元から作られる疎で行が計算可能なハミルトニアンをシミュレートすることで得られます。対称群と交代群を直接扱う場合には、置換をバブルソートによって隣接互換の積へ分解し、隣接互換の Young-Yamanouchi 表現は小さなブロックの単純な直和になります。",
    complexity: "Time polynomial in n and 1/ε to obtain any matrix element of any irreducible representation of the symmetric or alternating group to within ±ε, and likewise for any irreducible representation of polynomial highest weight of the unitary, special unitary and special orthogonal groups. The Hadamard test itself needs O(1/ε²) measurements.",
    complexityBasis: 'section 1 of arXiv:0811.0562: "for the finite groups Sn and An we obtain any matrix element of any irreducible representation to within ±ǫ in time that scales polynomially in 1/ǫ and n. For the Lie groups U(n), SU(n), and SO(n) we obtain any matrix element of any irreducible representation of polynomial highest weight to within ±ǫ in time that scales polynomially in 1/ǫ and n."; section 5: "quantum computers can solve the following problem with probability 1 − δ in poly(n, 1/ǫ, log(1/δ)) time."; section 2, for the subroutine: "one can obtain the real part of ⟨ψ|U|ψ⟩ to precision ǫ by making O(1/ǫ²) measurements."',
    caveat: "This is a literature record: nothing was constructed, compiled, simulated or run, and no matrix element was estimated here. The approximation is additive, not multiplicative, and the paper says why that matters more than it sounds: for exponentially large unitary matrices the typical matrix element is exponentially small, so on average instances a polynomially precise additive approximation provides almost no information — section 5 puts it bluntly, that one could instead simply guess zero every time with similar results. The exponential speedup quoted on this record is therefore a worst-case statement, and the very sentence that states it also says average case instances are classically easy. The paper proves no hardness result for the interesting instances; it offers an unproven hypothesis naming a possible class of instances not solvable classically in polynomial time, and observes that the strategy used to prove the Jones polynomial case cannot transfer because the symmetric group is finite and so no representation of it can be dense in a continuous group. There is explicitly no speedup for group characters, and the Lie group results are restricted to polynomial highest weight, with exponential highest weight and the symplectic group left open. The Quantum Algorithm Zoo cites this work as \"Fast quantum algorithms for approximating the irreducible representations of groups\"; the paper's own title page reads \"approximating some irreducible representations of groups\". Finally, the Zoo entry also names later work on Kronecker coefficients and representation-theoretic multiplicities, which this record does not cover.",
    caveatJa: "本項目は文献に基づく記録です。ここで何かを構成・コンパイル・シミュレート・実行したことはなく、具体的な行列成分を推定したわけでもありません。近似は乗法的ではなく加法的であり、論文はそれが聞こえ以上に重要である理由を述べています。すなわち、指数的に大きなユニタリ行列では典型的な行列成分は指数的に小さいため、平均的な問題例では多項式精度の加法的近似はほとんど情報を与えません。第5節はそれを率直に、毎回単に零と答えても同程度の結果になると述べています。したがって本記録に引用した指数的な高速化は最悪時についての主張であり、それを述べているまさに同じ文が、平均的な問題例は古典的に容易であるとも述べています。論文は興味深い問題例について困難性を証明しておらず、古典的に多項式時間で解けない可能性のある問題例の族を挙げる未証明の仮説を提示するにとどめています。また、Jones 多項式の場合に用いられた証明の戦略は転用できないと述べています。対称群は有限であり、その表現が連続群の中で稠密になることはありえないからです。群指標については高速化がないことが明示されており、Lie 群に関する結果は多項式的な最高ウェイトに限られ、指数的な最高ウェイトと斜交群は未解決として残されています。Quantum Algorithm Zoo はこの研究を「Fast quantum algorithms for approximating the irreducible representations of groups」として引用していますが、論文自身の標題紙には「approximating some irreducible representations of groups」とあります。最後に、Zoo のこの項目は Kronecker 係数や表現論的な重複度に関するより新しい研究にも言及していますが、本記録はそれらを対象としていません。",
    tags: ["group representation", "matrix element", "schur transform", "hadamard test", "symmetric group"],
    source: {
      id: "arxiv:0811.0562",
      title: "Fast quantum algorithms for approximating some irreducible representations of groups",
      authors: "Stephen P. Jordan",
      year: "2008",
      url: "https://arxiv.org/abs/0811.0562",
    },
    literature: [
      {
        title: "Fast quantum algorithms for approximating some irreducible representations of groups",
        authors: "Stephen P. Jordan",
        year: "2008",
        url: "https://arxiv.org/abs/0811.0562",
        relevance: "Primary source, and the source of this record's cost claim. Consult it for section 5 above all, where the additive-approximation caveat is worked out — the typical matrix element of an exponentially large representation is exponentially small, so the average case is classically easy and the paper's own hardness claim is an unproven hypothesis rather than a theorem. Note the title: the paper says \"some irreducible representations\" where the Zoo's citation says \"the irreducible representations\".",
        relevanceJa: "一次資料であり、本記録の計算量の出典です。とりわけ第5節を原論文で確認してください。そこでは加法的近似に伴う留保が詳しく展開されています。すなわち、指数的に大きな表現の典型的な行列成分は指数的に小さいため平均的な場合は古典的に容易であり、論文自身の困難性の主張も定理ではなく未証明の仮説にとどまります。標題にも注意してください。Zoo の引用が「the irreducible representations」とするところを、論文は「some irreducible representations」としています。",
      },
    ],
    relatedSlugs: ["quantum-fourier-transform", "jones-polynomial-approximation", "group-order-and-membership"],
  },
  {
    slug: "boson-sampling-linear-optics",
    title: "Sampling the output of a linear-optical network",
    titleJa: "線形光学ネットワークの出力からの標本抽出",
    family: "Quantum sampling algorithm",
    zooName: "Probabilistic Sampling",
    zooSection: "Approximation and Simulation Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: {
      states: "reported",
      quote: "in the classical case, the aij's are nonnegative real numbers—which means that we can approximate Per(A) in probabilistic polynomial time, by using the celebrated algorithm of Jerrum, Sinclair, and Vigoda [30]. In the quantum case, by contrast, the aij's are complex numbers. And it is not hard to show that, given a general matrix A ∈ Cn×n, even approximating Per(A) to within a constant factor is #P-complete.",
    },
    problem: "Sample from the output distribution of a rudimentary optical device: identical photons are generated, sent through a network of beamsplitters and phase shifters, and then non-adaptively measured to count the photons in each mode. The question is whether a classical computer can do the same sampling efficiently.",
    problemJa: "きわめて単純な光学装置の出力分布から標本を抽出する問題です。同一の光子を生成し、ビームスプリッタと位相シフタからなるネットワークを通し、そのうえで適応的でない測定によって各モードの光子数を数えます。問われるのは、古典計算機が同じ標本抽出を効率的に行えるかどうかです。",
    idea: "The probability of any particular output equals the squared modulus of the permanent of a submatrix of the network's unitary. Permanents of non-negative matrices are approximable in probabilistic polynomial time by the Jerrum-Sinclair-Vigoda algorithm, but approximating a complex permanent to within a constant factor is hard, and the authors call this difference the starting point for everything in the paper. The main technical device is that a submatrix of a Haar-random unitary is close in variation distance to a matrix of independent complex Gaussians once the network is large enough relative to the photon number. That lets an arbitrary Gaussian permanent estimation instance be hidden inside one output probability of the sampler, so a classical approximate sampler would yield an algorithm for that estimation problem in the polynomial hierarchy.",
    ideaJa: "特定の出力が得られる確率は、ネットワークのユニタリの部分行列のパーマネントの絶対値の二乗に等しくなります。非負行列のパーマネントは Jerrum, Sinclair, Vigoda のアルゴリズムによって確率的多項式時間で近似できますが、複素行列のパーマネントを定数倍の精度で近似することは困難であり、著者らはこの違いを本論文のすべての出発点と呼んでいます。中心的な技術的道具は、光子数に比してネットワークが十分大きければ、Haar 無作為なユニタリの部分行列が独立な複素 Gauss 行列と変動距離において近いという事実です。これにより、任意の Gauss パーマネント推定の問題例を標本抽出器の出力確率一つの中に隠すことができ、古典的な近似標本抽出器が存在すれば、その推定問題が多項式階層の中で解けてしまうことになります。",
    complexity: "Stated as complexity-theoretic consequences rather than as a running time. Exact sampling is not efficiently solvable classically unless P^#P = BPP^NP and the polynomial hierarchy collapses to the third level. For approximate sampling, a classical sampler running in time polynomial in the input size and 1/ε would put the Gaussian permanent estimation problem in BPP^NP.",
    complexityBasis: 'section 1.2.1, Theorem 1 of arXiv:1011.3245: "The exact BosonSampling problem is not efficiently solvable by a classical computer, unless P#P = BPPNP and the polynomial hierarchy collapses to the third level."; section 1.2.2, Theorem 3: "Suppose there exists a classical algorithm C that takes as input a description of A as well as an error bound ε, and that samples from a probability distribution D′A such that ‖D′A − DA‖ ≤ ε in poly(|A|, 1/ε) time. Then the |GPE|²± problem is solvable in BPPNP." Read for this record: the abstract and contents, the whole of section 1, the definitions in section 2, the setup of section 4, section 5.1-5.2 including the Haar-unitary hiding theorem, the statement of Theorem 7 and the two conjectures, and section 10. The bulk of the technical proofs in sections 3 through 9 was not read.',
    caveat: "This is a literature record: nothing was constructed, compiled, simulated or run, and no sampling experiment was performed here. The division between what is proved and what is conjectured is the whole substance of this entry. The exact-sampling hardness result is unconditional, but the authors themselves flag in the abstract that it assumes an extremely accurate simulation, which is not what any device does. The realistic result, for approximate sampling, is conditional on two named and explicitly unproven conjectures — the Permanent-of-Gaussians Conjecture and the Permanent Anti-Concentration Conjecture — and the paper's own summary figure states the chain of implications as holding modulo those conjectures, with a section devoted to evidence for one of them and to the barrier to proving it. This model is not known or believed to be universal for quantum computation, and the authors say it even seems unlikely that it can do universal classical computation. They state that they have no evidence such a device could factor integers or solve any decision or promise problem outside BPP. And unlike factoring there is believed to be no NP witness, so a successful large experiment cannot be checked classically the way a claimed factorization can. The Zoo's entry groups this with other sampling results, including instantaneous quantum polynomial-time circuits and log-concave sampling, which this record does not cover.",
    caveatJa: "本項目は文献に基づく記録です。ここで何かを構成・コンパイル・シミュレート・実行したことはなく、標本抽出の実験を行ったわけでもありません。この項目の核心は、証明されていることと予想にとどまることの区別そのものです。厳密な標本抽出に関する困難性の結果は無条件ですが、著者ら自身が要旨において、それがきわめて正確なシミュレーションを仮定していることを注意喚起しており、それはいかなる実機の振る舞いでもありません。現実的な結果、すなわち近似的な標本抽出に関する結果は、明示的に未証明とされた二つの予想、Gauss パーマネント予想とパーマネント反集中予想に依存しています。論文自身の要約図も、含意の連鎖がこれらの予想を前提として成り立つと述べており、一方の予想については根拠を論じる節と、その証明を阻む障壁を論じる節が設けられています。このモデルは量子計算に対して万能であるとは知られておらず、そう信じられてもいません。著者らは、万能な古典計算すら行えそうにないと述べています。また、この装置が整数を素因数分解できる、あるいは BPP の外の決定問題や約束問題を解けるという根拠は何も持たないとも述べています。さらに素因数分解と異なり NP 証拠は存在しないと考えられているため、大規模な実験が成功しても、素因数分解の主張のように古典的に検証することはできません。Zoo のこの項目は、瞬時量子多項式時間の回路や対数凹分布からの標本抽出といった他の標本抽出の結果もまとめて扱っていますが、本記録はそれらを対象としていません。",
    tags: ["boson sampling", "linear optics", "permanent", "polynomial hierarchy", "sampling complexity"],
    source: {
      id: "arxiv:1011.3245",
      title: "The Computational Complexity of Linear Optics",
      authors: "Scott Aaronson, Alex Arkhipov",
      year: "2010",
      url: "https://arxiv.org/abs/1011.3245",
    },
    literature: [
      {
        title: "The Computational Complexity of Linear Optics",
        authors: "Scott Aaronson, Alex Arkhipov",
        year: "2010",
        url: "https://arxiv.org/abs/1011.3245",
        relevance: "Primary source, and the source of this record's claims. Consult it for the split that matters: Theorem 1 is unconditional but assumes exact sampling, while the approximate-sampling result rests on the Permanent-of-Gaussians Conjecture and the Permanent Anti-Concentration Conjecture, both stated as conjectures in section 1.2.3 and neither proved. Section 9 is where the authors set out the evidence for the first and the barrier to proving it. The technical proofs were not read for this record.",
        relevanceJa: "一次資料であり、本記録の主張の出典です。とりわけ重要な区別を原論文で確認してください。定理1は無条件ですが厳密な標本抽出を仮定しており、近似的な標本抽出に関する結果は Gauss パーマネント予想とパーマネント反集中予想に依拠しています。いずれも第1.2.3節で予想として述べられ、証明はされていません。第9節では、前者の根拠とその証明を阻む障壁が示されています。技術的な証明は本記録のためには参照していません。",
      },
    ],
    relatedSlugs: ["quantum-fourier-transform", "gibbs-state-sampling", "jones-polynomial-approximation"],
  },
  // ---------------------------------------------------------------------------
  // The last two records of the W22 pass cover Zoo entries that are **subject
  // headings rather than results**, and they are declared differently from every
  // record above them.
  //
  // `check-zoo-parity.mjs` marks a Zoo entry covered when `row.slugs.length > 0`
  // — one slug is enough. For a single-result entry that is exactly right. For a
  // heading the Zoo files with eight references it is not: one record would make
  // the whole heading read as closed, and the gauge would move on the strength of
  // one strand out of eight. That inflates the number fastest precisely where
  // coverage is thinnest, which is the `print-the-denominator` failure.
  //
  // Lane 1's doctrine ruling (ADR-0026, applying ai-ops#51 and #12): coverage of
  // such a heading is a **union** of narrow records, each cited to a paper that
  // genuinely contains its own claim — and the declaration must say which of the
  // heading's references are carried and which are outstanding. So each of the two
  // records below lists exactly that, here and in its own caveat, and neither
  // claims the heading is closed.
  //
  // What is forbidden, and what these two are not: one record for the whole
  // heading cited to whichever reference looks most canonical. That record would
  // claim a paper says something it does not — the ai-ops#12 failure, which #51
  // did not touch.
  // ---------------------------------------------------------------------------
  //
  // "Quantum Cryptanalysis" — the Zoo lists 8 references. Carried: Shor 1995 and
  // its FOCS 1994 predecessor, by the existing `shor-period-finding` and
  // `discrete-logarithm` records; and Proos and Zalka, by the record below.
  // **Outstanding: 5** — Boneh and Lipton on hidden linear functions; Childs, Jao
  // and Soukharev on isogenies (arXiv:1012.4019); Eldar and Hallgren on lattices
  // (arXiv:2201.13450) together with Ducas and van Woerden's note disputing it;
  // and Chen and Gao on Boolean equation solving (arXiv:1712.06239).
  {
    slug: "elliptic-curve-discrete-log-resources",
    title: "Resource counts for elliptic-curve discrete logarithms",
    titleJa: "楕円曲線離散対数に要する資源の見積り",
    family: "Hidden-period / factoring",
    zooName: "Quantum Cryptanalysis",
    zooSection: "Algebraic and Number Theoretic Algorithms",
    speedup: "Various",
    speedupPrimary: {
      states: "reported",
      quote: "The classical complexity of this problem seems to depend strongly on the underlying group… for discrete logarithms over elliptic curves, nothing better than \"generic\" algorithms are known… e.g. the Pollard ρ algorithm [3], have truly exponential complexity.",
    },
    problem: "Carry Shor's discrete-logarithm algorithm through concretely for the group of points on an elliptic curve over GF(p), and count the qubits and operations it needs, so that the cost of attacking elliptic-curve cryptography can be compared with the cost of attacking RSA at an equivalent classical security level.",
    problemJa: "Shor の離散対数アルゴリズムを、GF(p) 上の楕円曲線の点がなす群について具体的に遂行し、必要な量子ビット数と演算回数を数え上げる問題です。これにより、楕円曲線暗号への攻撃コストを、古典的な安全性水準が同等な RSA への攻撃コストと比較できるようになります。",
    idea: "The algorithm is Shor's two-dimensional hidden-subgroup construction: build the superposition over |x, y, xP + yQ⟩ using double-and-add point arithmetic on the curve, then apply a two-dimensional quantum Fourier transform and read the discrete logarithm off the dual lattice. The work is in the arithmetic. Each group operation decomposes into modular divisions and multiplications, and each division needs a reversible extended Euclidean algorithm — whose classical running time depends on its input, which is the obstacle the authors call the quantum halting problem. Their contribution is a piecewise-reversible implementation that lets different branches of the superposition desynchronize and move through the algorithm's five basic operations at their own pace instead of in lockstep, taking that subroutine from cubic to quadratic. Sharing registers between intermediate values then brings the qubit count down further.",
    ideaJa: "アルゴリズムは Shor の二次元隠れ部分群の構成そのものです。曲線上の点の二倍算と加算によって |x, y, xP + yQ⟩ の重ね合わせを作り、二次元の量子 Fourier 変換を施して、双対格子から離散対数を読み取ります。実際の作業は算術の部分にあります。各群演算は剰余の除算と乗算に分解され、除算のたびに可逆な拡張 Euclid の互除法が必要になりますが、その古典的な実行時間は入力に依存します。著者らはこれを量子版の停止問題と呼び、最大の障害としています。彼らの寄与は区分的に可逆な実装であり、重ね合わせの各分岐が歩調をそろえるのではなく、五つの基本演算をそれぞれの速さで進むことを許します。これによりこの副手続きは三次から二次になります。さらに中間結果でレジスタを共有することで、量子ビット数も削減されます。",
    complexity: "About 6n **logical** qubits and order n³ operations for an n-bit prime field, given as roughly 360n³ n-bit additions against about 4kn³ for factoring. Concretely the paper's table pairs a 160-bit elliptic-curve key at around 1000 logical qubits on a machine the authors twice call perfect and noise-free, with the security-equivalent 1024-bit RSA modulus at about 2000, and it gives the same pairing at 512, 2048, 3072 and 15360-bit RSA against 110, 224, 256 and 512-bit curves.",
    complexityBasis: 'abstract of arXiv:quant-ph/0301141: "A 160 bit elliptic curve cryptographic key could be broken on a quantum computer using around 1000 qubits while factoring the security-wise equivalent 1024 bit RSA modulus would require about 2000 qubits."; section 6.2: "the DLP algorithm requires either f(n) = 7n + 4 log₂ n + ǫ or f′(n) = 5n + 8√n + 4 log₂ n + ǫ bits depending o[n] whether register sharing is used"; section 6.1: "the discrete logarithm algorithm is O(n³) … has a running time of approximately 360kn³ compared to only about 4kn³ for factoring."',
    caveat: "This is a literature record: no circuit was built, compiled, simulated or run here, and no key was broken. The famous headline number is a count of **logical** qubits on an idealised machine, and the paper says so in both places it matters — parenthetically, that this is on a perfect, noise free, quantum computer, and in section 6.3, that for large scale quantum computation error correction or full fault tolerance is very probably necessary, so each logical qubit has to be encoded into several physical qubits, possibly dozens, and each logical gate becomes many physical ones. **None of the counts here include that overhead**, so \"around 1000 qubits\" is not a statement about any machine anyone would build. The figures are also estimates rather than a gate-level tally: section 6.1 says outright that the authors do not go to the lowest level and count gates but count n-bit additions instead, and the factor converting quantum-quantum to classical-quantum additions is estimated from networks in another paper. The scope is curves over GF(p) only; the abstract says curves over GF(2^n) and other fields are not yet considered. Parallelisation is not analysed, and the authors note factoring may parallelise more easily, which would move the comparison. Finally, this record covers one strand of the Zoo's \"Quantum Cryptanalysis\" heading — the elliptic-curve resource analysis. That heading cites **23** papers, not the eight an earlier reading of it reported: the pinned index this repository measures against had been truncating every reference list at eight, so the shortfall was understated by a factor of three. Three are carried: Shor 1995 and its FOCS 1994 predecessor, by the shor-period-finding and discrete-logarithm records, and Proos and Zalka by this one. The other twenty are covered by no record here — Boneh and Lipton on hidden linear functions; Childs, Jao and Soukharev on isogenies; Eldar and Hallgren on lattices, with the Ducas and van Woerden note disputing it; Chen and Gao and two successors on multivariate and Boolean systems; five papers on Grover-based key search and hash collisions; three on Grover speedups of public-key attacks; and five on superposition-query attacks against block ciphers.",
    caveatJa: "本項目は文献に基づく記録です。ここで回路を構成・コンパイル・シミュレート・実行したことはなく、鍵を破ったわけでもありません。よく引かれる見出しの数値は、理想化された機械における**論理**量子ビットの数であり、論文もそれが重要な二箇所でそう述べています。すなわち、これは完全で雑音のない量子計算機上の話だと括弧書きで述べ、第6.3節では、大規模な量子計算には誤り訂正あるいは完全な誤り耐性がほぼ確実に必要であり、その場合には各論理量子ビットを複数の、おそらく数十の物理量子ビットに符号化しなければならず、各論理ゲートも多数の物理ゲートになると述べています。**ここに示された数値にはそのオーバーヘッドが一切含まれていません**ので、「およそ1000量子ビット」は誰かが実際に作る機械についての主張ではありません。またこれらの数値はゲートレベルの集計ではなく見積りです。第6.1節は、最下層まで降りてゲート数を数えるのではなく n ビット加算の回数を数えると明言しており、量子・量子加算と古典・量子加算の比も別の論文の回路から見積もったものだと述べています。対象は GF(p) 上の曲線に限られ、要旨は GF(2^n) やその他の体の上の曲線はまだ扱っていないと述べています。並列化は解析されておらず、著者らは素因数分解のほうが並列化しやすいかもしれないと注記していますが、それは比較を動かしうる点です。最後に、本記録が扱うのは Zoo の「Quantum Cryptanalysis」という見出しの一つの筋、すなわち楕円曲線の資源解析です。この見出しが挙げる論文は **23 本** であり、以前の記述にある八つではありません。本リポジトリが基準とする索引が、参考文献の一覧をすべて八件で打ち切っていたためで、不足の度合いを三分の一に見せていました。うち三本は扱われています。Shor 1995 とその FOCS 1994 の前身は shor-period-finding と discrete-logarithm の各記録が、Proos と Zalka は本記録が担っています。残る二十本は、ここのどの記録でも扱われていません。隠れ線形関数に関する Boneh と Lipton、同種写像に関する Childs, Jao, Soukharev、格子に関する Eldar と Hallgren およびそれに異を唱える Ducas と van Woerden の覚書、多変数系および Boole 系の求解に関する Chen と Gao ほか二本、Grover による鍵探索とハッシュ衝突に関する五本、公開鍵攻撃の Grover 加速に関する三本、そしてブロック暗号への重ね合わせ問い合わせ攻撃に関する五本です。",
    tags: ["elliptic curve cryptography", "discrete logarithm", "resource estimation", "modular arithmetic", "cryptanalysis"],
    source: {
      id: "arxiv:quant-ph/0301141",
      title: "Shor's discrete logarithm quantum algorithm for elliptic curves",
      authors: "John Proos, Christof Zalka",
      year: "2003",
      url: "https://arxiv.org/abs/quant-ph/0301141",
    },
    literature: [
      {
        title: "Shor's discrete logarithm quantum algorithm for elliptic curves",
        authors: "John Proos, Christof Zalka",
        year: "2003",
        url: "https://arxiv.org/abs/quant-ph/0301141",
        relevance: "Primary source, and the source of this record's cost claim. The qubit and operation counts are in section 6, with the RSA-versus-curve table in section 6.3; the reversible extended Euclidean algorithm that the whole cost turns on is in section 5. Consult section 6.3 in particular before quoting any number from this record: it is where the authors say that error correction or fault tolerance is very probably necessary and that each logical qubit would then become several physical ones, which is the overhead none of the published figures include.",
        relevanceJa: "一次資料であり、本記録の計算量の出典です。量子ビット数と演算回数は第6節にあり、RSA と楕円曲線を対比する表は第6.3節にあります。コスト全体を左右する可逆な拡張 Euclid の互除法は第5節です。本記録から数値を引用する前に、とりわけ第6.3節を確認してください。そこでは、誤り訂正あるいは誤り耐性がほぼ確実に必要であり、その場合には各論理量子ビットが複数の物理量子ビットになると著者らが述べています。公表されている数値はいずれもそのオーバーヘッドを含んでいません。",
      },
    ],
    relatedSlugs: ["discrete-logarithm", "shor-period-finding", "quantum-fourier-transform"],
  },
  // "Polynomial Quantum Speedups for Constraint Satisfaction Problems" — the Zoo
  // lists 8 references. Carried: Montanaro's quantum walk speedup of backtracking,
  // by the record below. **Outstanding: 7** — the adiabatic cross-reference;
  // Ambainis's SIGACT survey; Cerf, Grover and Williams on nested quantum search;
  // Mandra, Guerreschi and Aspuru-Guzik (arXiv:1512.00859); Hastings's short-path
  // algorithm (arXiv:1802.10124); Dalzell, Pancotti, Campbell and Brandão
  // (arXiv:2212.01513); and Brandão, Kueng and Stilck França (arXiv:1909.04613).
  {
    slug: "backtracking-quantum-walk-speedup",
    title: "Quantum walk speedup of backtracking",
    titleJa: "量子ウォークによるバックトラッキングの高速化",
    family: "Quantum walk",
    zooName: "Polynomial Quantum Speedups for Constraint Satisfaction Problems",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Polynomial",
    speedupPrimary: {
      states: "reported",
      quote: "We usually think of T as being exponential in n; in this regime this complexity is a near-quadratic speedup over the classical algorithm.",
    },
    problem: "Backtracking is the general classical technique for exploiting problem structure in constraint satisfaction: explore a tree of partial assignments and prune the branches a predicate rules out. The question is whether an arbitrary backtracking algorithm — any predicate and any branching heuristic — can be sped up quantumly, rather than replaced by brute-force search over the whole assignment space.",
    problemJa: "バックトラッキングは、制約充足において問題の構造を活用するための一般的な古典技法です。部分割当ての木を探索し、述語が排除する枝を刈り込みます。ここでの問いは、任意のバックトラッキングアルゴリズム、すなわち任意の述語と任意の分岐ヒューリスティックに対して、割当て空間全体への力任せの探索に置き換えるのではなく、量子的な高速化が可能かどうかです。",
    idea: "The algorithm runs a discrete-time quantum walk on the tree that the classical backtracking algorithm implicitly defines, without knowing that tree's structure in advance. It is a special case of Belovs's correspondence between quantum walks and effective resistance, itself the quantum analogue of the classical link between random walks and electrical networks. Diffusion operators at each vertex mix it with its children and are defined purely from local calls to the predicate and the heuristic, so the walk never needs the tree laid out. Phase estimation on the walk operator then distinguishes the case where a marked vertex exists — the eigenvalue-one eigenvector stays close to the starting state — from the case where none does. Detection is extended to actually finding a solution by binary search down the tree, repeating detection on subtrees, and a separate eigenvector analysis gives a faster algorithm when the solution is promised unique.",
    ideaJa: "このアルゴリズムは、古典的なバックトラッキングアルゴリズムが暗に定める木の上で離散時間量子ウォークを走らせます。その木の構造をあらかじめ知る必要はありません。これは、量子ウォークと実効抵抗との Belovs による対応の特別な場合であり、その対応自体、ランダムウォークと電気回路網との古典的な関係の量子版です。各頂点における拡散作用素はその頂点と子頂点とを混ぜ合わせ、述語とヒューリスティックへの局所的な呼び出しのみから定義されるため、ウォークが木の全体像を必要とすることはありません。次にウォーク作用素に対する位相推定によって、印のついた頂点が存在する場合、すなわち固有値1の固有ベクトルが初期状態の近くに留まる場合と、存在しない場合とを区別します。検出から実際に解を見つけることへの拡張は、木を下る二分探索によって行われ、部分木に対して検出を繰り返します。解が一意であると約束されている場合には、別の固有ベクトルの解析によってより速いアルゴリズムが得られます。",
    complexity: "O(√T · n^(3/2) · log n) evaluations of the predicate and the heuristic to find a solution or report none, where T is the number of vertices in the classical backtracking algorithm's tree and n the number of variables. Detecting whether a solution exists is cheaper, at O(√T · n) evaluations, and the promised-unique case costs O(√T · n · log³ n).",
    complexityBasis: 'abstract of arXiv:1509.02374: "Assume there is a classical backtracking algorithm which finds a solution to a CSP on n variables, or outputs that none exists, and whose corresponding tree contains T vertices, each vertex corresponding to a test of a partial solution. Then we show that there is a bounded-error quantum algorithm which completes the same task using O(√T n^{3/2} log n) tests."; section 1.1, Theorem 1, for detection: "there is a quantum algorithm which, given T, evaluates P and h O(√T n log(1/δ)) times each, outputs true if there exists x such that P(x) is true, and outputs false otherwise"; section 1.1, Theorem 2, for the unique case: "there is a quantum algorithm which outputs x₀ using P and h O(√T n log³ n log(1/δ)) times each."',
    caveat: "This is a literature record: nothing was constructed, compiled, simulated or run, and no constraint satisfaction problem was solved here. **The square root is taken of the tree size T, not of the problem size**, and n enters only as a polynomial overhead — so this is a near-quadratic speedup over the classical backtracking algorithm's own running time, not a quadratic speedup in the number of variables, and it says nothing about problems where backtracking explores few nodes. Detecting whether a solution exists and finding one are separate theorems with different costs, and the finding algorithm is the more expensive by a factor of √n; the finding extension also assumes every vertex has bounded degree. The bound is stated with T given as input, though the paper notes that doubling a guess costs only a logarithmic factor. The paper is explicit that its algorithm may not beat the classical one on every instance: where classical backtracking is lucky and finds a solution without exploring the whole tree, the quantum algorithm, which is forced to explore it, may not outperform it. The dramatic exponential separation the paper also derives holds in a non-standard average-case setting under particular input distributions, not in the worst case. Finally, this record covers one strand of the Zoo's heading, which cites eight papers and cross-references the Zoo's own Adiabatic Algorithms entry. Seven of those eight papers are covered by no record here: Ambainis's survey; Cerf, Grover and Williams on nested quantum search; Mandra, Guerreschi and Aspuru-Guzik; Hastings's short-path algorithm; Dalzell, Pancotti, Campbell and Brandão; Brandão, Kueng and Stilck França on semidefinite approximations; and Ambainis and Kokainis on tree size estimation — which an earlier reading of this heading omitted, while counting the cross-reference as if it were a paper.",
    caveatJa: "本項目は文献に基づく記録です。ここで何かを構成・コンパイル・シミュレート・実行したことはなく、具体的な制約充足問題を解いたわけでもありません。**平方根がとられているのは木の大きさ T であって問題の大きさではなく**、n は多項式のオーバーヘッドとしてのみ現れます。したがってこれは古典的なバックトラッキングアルゴリズム自身の実行時間に対するほぼ二乗の高速化であって、変数の個数についての二乗の高速化ではなく、バックトラッキングが少数の節点しか探索しない問題については何も述べていません。解の存在を検出することと解を実際に見つけることは別々の定理であり、コストも異なります。発見のアルゴリズムのほうが √n の因子だけ高価であり、さらにすべての頂点の次数が有界であることを仮定します。評価は T が入力として与えられる前提で述べられていますが、推測値を倍々にしていく方法では対数因子しかかからないと論文は注記しています。論文は、自らのアルゴリズムがすべての問題例で古典を上回るとは限らないことを明言しています。古典的なバックトラッキングが幸運にも木全体を探索せずに解を見つける場合、木全体を探索せざるをえない量子アルゴリズムはそれを上回らないかもしれません。論文が併せて導く劇的な指数的分離は、通常とは異なる平均時の設定において特定の入力分布のもとで成り立つものであり、最悪時のものではありません。最後に、本記録が扱うのは Zoo のこの見出しの一つの筋にすぎません。この見出しは八本の論文を挙げ、さらに Zoo 自身の Adiabatic Algorithms の項目を相互参照しています。八本のうち七本は、ここのどの記録でも扱われていません。Ambainis の解説、入れ子量子探索に関する Cerf, Grover, Williams、Mandra, Guerreschi, Aspuru-Guzik、Hastings の短経路アルゴリズム、Dalzell, Pancotti, Campbell, Brandão、半正定値緩和に関する Brandão, Kueng, Stilck França、そして木のサイズ推定に関する Ambainis と Kokainis です。最後の一本は以前の記述が落としており、代わりに相互参照を論文として数えていました。",
    tags: ["backtracking", "constraint satisfaction", "quantum walk", "effective resistance", "tree search"],
    source: {
      id: "arxiv:1509.02374",
      title: "Quantum walk speedup of backtracking algorithms",
      authors: "Ashley Montanaro",
      year: "2015",
      url: "https://arxiv.org/abs/1509.02374",
    },
    literature: [
      {
        title: "Quantum walk speedup of backtracking algorithms",
        authors: "Ashley Montanaro",
        year: "2015",
        url: "https://arxiv.org/abs/1509.02374",
        relevance: "Primary source, and the source of this record's cost claim. Theorem 1 in section 1.1 is detection and Theorem 2 is finding — different costs, and worth reading as two results rather than one. Section 2.1 carries the bounded-degree assumption and the doubling trick that removes the need to know the tree size in advance. Section 5 is where the author states the limit that matters most in practice: where classical backtracking finds a solution early without exploring the whole tree, this algorithm may not outperform it.",
        relevanceJa: "一次資料であり、本記録の計算量の出典です。第1.1節の定理1は検出、定理2は発見であり、コストが異なるため一つの結果としてではなく二つの結果として読む価値があります。第2.1節には次数有界の仮定と、木の大きさを事前に知る必要をなくす倍加の技法があります。実務上もっとも重要な限界が述べられているのは第5節です。すなわち、古典的なバックトラッキングが木全体を探索せずに早く解を見つける場合、このアルゴリズムはそれを上回らないかもしれない、という指摘です。",
      },
    ],
    relatedSlugs: ["subset-finding-quantum-walk", "grover-unstructured-search", "element-distinctness"],
  },
  // ---------------------------------------------------------------------------
  // The Zoo's last uncovered Algebraic and Number Theoretic row, and the reason it
  // stood open was not sourcing. The paper was read in full in W22; what stopped
  // the record was `paperSlug`. Its only identifier is the Springer chapter DOI
  // 10.1007/978-3-642-38616-9_2, whose suffix already ends in `_2`, and the url
  // segment mapped `/` to `_` — so the id came back as ...-9/2 and
  // `validatePaperRegister` refused it, exactly as papers.ts says it should. The
  // identity scheme now escapes the underscore and the entry can exist. Not a
  // sourcing problem, and worth saying so: a row that stays open for a mechanical
  // reason looks identical, from the gauge, to one nobody could source.
  // ---------------------------------------------------------------------------
  {
    slug: "subset-sum-quantum-walk",
    title: "Subset-sum by quantum walk over representations",
    titleJa: "表現法と量子ウォークによる部分和問題",
    family: "Quantum walk",
    zooName: "Subset-sum",
    zooSection: "Algebraic and Number Theoretic Algorithms",
    speedup: "Polynomial",
    speedupPrimary: {
      states: "reported",
      quote: "We introduce the first subset-sum algorithm that beats 2^{n/4}. Specifically, we introduce a quantum algorithm that, under reasonable assumptions, uses at most 2^{(0.241…+o(1))n} qubit operations to solve a subset-sum problem.",
    },
    problem: "Given integers x₁, x₂, …, xₙ and s, decide whether some subset I of {1, 2, …, n} satisfies the sum of xᵢ over I equal to s. The authors take as the typical hard case that the xᵢ are independent uniform random integers in {0, 1, …, 2ⁿ}. Subset-sum was one of the first problems shown NP-complete, so the question the paper asks is not whether it can be solved in polynomial time but how far below the 2ⁿ cost of searching every subset an exponential-time algorithm can get.",
    problemJa: "整数 x₁, x₂, …, xₙ と s が与えられたとき、添字集合 {1, 2, …, n} のある部分集合 I について xᵢ の総和が s に等しくなるかどうかを判定する問題です。著者らは、xᵢ が {0, 1, …, 2ⁿ} 上の独立一様乱数である場合を典型的な難しい事例として扱います。部分和問題は最初に NP 完全性が示された問題の一つであり、したがって本論文の問いは多項式時間で解けるかどうかではなく、すべての部分集合を調べる 2ⁿ のコストからどれだけ下げられるか、という点にあります。",
    idea: "The algorithm layers three things. From Howgrave-Graham and Joux it takes the representation technique: a solution of weight n/2 is split into overlapping halves in many ways at once, so a solution can be found from any one of its representations rather than from a single fixed decomposition. From Ambainis's element-distinctness algorithm it takes a discrete-time quantum walk on a Johnson graph, whose vertices are r-element subsets of the b-bit strings and whose edges join sets differing in one element. The paper's own contribution is the data structure that makes the walk implementable: Ambainis handles the walk's memory with what the authors call an ad-hoc combination of a hash table and a skip list requiring several pages of analysis, and they replace it with a radix tree. The problem a walk's memory has is history dependence — the stored state must not remember the order in which elements arrived, or the superposition fails to interfere — and the authors solve it by putting a uniform superposition over all possible memory layouts of the nodes, which they say produces a unique quantum data structure representing the set.",
    ideaJa: "このアルゴリズムは三つの要素を重ねています。第一に Howgrave-Graham と Joux による表現法です。重み n/2 の解を、重なりを持つ半分同士に多通りに分割し、一つの固定した分解ではなく、いずれかの表現から解を見つけられるようにします。第二に Ambainis の要素相異アルゴリズムに由来する、Johnson グラフ上の離散時間量子ウォークです。頂点は b ビット列の r 元部分集合であり、辺は一つの元だけ異なる集合を結びます。第三が本論文自身の寄与で、ウォークを実装可能にするデータ構造です。Ambainis はウォークの記憶を、著者らの言う「ハッシュ表とスキップリストの場当たり的な組合せ」で扱い、数ページの解析を要しましたが、著者らはこれを基数木に置き換えます。ウォークの記憶が抱える問題は履歴依存性、すなわち格納された状態が元の到着順を覚えていてはならないという点であり、著者らは節点のとりうるすべての記憶配置にわたる一様重ね合わせをとることでこれを解決し、それが集合を表す一意な量子データ構造を与えると述べています。",
    complexity: "2^{(0.241…+o(1))n} qubit operations, where n is the number of integers x₁, …, xₙ and the paper lists an algorithm using 2^{(e+o(1))n} operations as exponent e. The classical algorithms the paper names for the same problem: brute force at 2ⁿ, the Horowitz-Sahni left-right split at 2^{n/2}, and Howgrave-Graham and Joux's representation algorithm at 2^{(0.337…+o(1))n}. The best classical exponent, 0.291… from Becker, Coron and Joux, appears in the paper's comparison table and in no sentence of its text.",
    complexityBasis: 'abstract: "This paper introduces a subset-sum algorithm with heuristic asymptotic cost exponent below 0.25."; section 1: "We introduce the first subset-sum algorithm that beats 2^{n/4}. Specifically, we introduce a quantum algorithm that, under reasonable assumptions, uses at most 2^{(0.241…+o(1))n} qubit operations to solve a subset-sum problem."; the exponent convention is Table 1.1\'s own caption, "An algorithm using 2^{(e+o(1))n} operations is listed as \'exponent\' e."; for the classical baseline, section 5: "Howgrave-Graham and Joux introduced this technique in [17] and obtained a subset-sum algorithm that costs just 2^{(0.337…+o(1))n}." Read from the authors\' own full text (cr.yp.to, dated 2013.04.07), all eighteen pages, not from the abstract.',
    caveat: "This is a literature record: no circuit was built, compiled, simulated or run here, and no subset-sum instance was solved. Four limits the authors state themselves, and the first is the one that decides what the number means. **The cost model assumes free quantum RAM.** Section 1 says that random access to an array of size 2^{O(n)} is assumed to cost only n^{O(1)}, even if the array index is a quantum superposition — and the algorithm's memory is exponential. The authors raise the objection three times and decline it each time, adding that they do not claim that improved operation counts imply improvements in other cost models. **The analysis is heuristic, not proved.** Section 1: their analyses are heuristic, they do not claim the algorithms work for all inputs, and they do not claim that what they call the hard case is the worst case; they speculate a proof is possible by adapting another paper's ideas. **It is asymptotic to the point that the input is free** — polynomial cost factors are suppressed systematically, so by the paper's own example reading the entire input costs only 1, and twice the authors note a real improvement is invisible at this level of detail. **And the statement is simplified**: sections 3 to 5 consider only half-weight solutions, n is assumed divisible by 16, the success probability is inverse polynomial in n rather than constant, and one sub-claim about that probability rests on experiments rather than analysis. Finally, two things about the Zoo's framing rather than the paper's. The Zoo files this entry under the speedup class Polynomial; **the word polynomial never describes this paper's own speedup** — all seventeen of its occurrences are about suppressed cost factors, the P versus NP framing, the data-structure limits, the success probability, or a reference's title. And the comparison against the best classical algorithm, Becker, Coron and Joux at exponent 0.291…, is made only in the comparison table, which has a Quantum yes/no column; no sentence of the paper states the margin.",
    caveatJa: "本項目は文献に基づく記録です。ここで回路を構成・コンパイル・シミュレート・実行したことはなく、具体的な部分和問題の実例を解いたわけでもありません。著者ら自身が述べる四つの限界があり、最初のものがこの数値の意味を決めます。**コストモデルが量子 RAM を無償と仮定しています。** 第1節は、大きさ 2^{O(n)} の配列へのランダムアクセスのコストを、添字が量子的な重ね合わせであっても n^{O(1)} にすぎないと仮定すると述べており、このアルゴリズムの記憶量は指数的です。著者らはこの異論を三度提起して三度とも退け、演算回数の改善が他のコストモデルにおける改善を意味するとは主張しないと付け加えています。**解析は発見的であって証明ではありません。** 第1節によれば、解析は発見的であり、アルゴリズムがすべての入力に対して動作するとは主張せず、自ら「難しい」と呼ぶ場合が最悪の場合であるとも主張していません。別の論文の証明の着想を応用すれば証明できるだろうと推測するにとどまります。**漸近的であり、入力の読み込みすら無償です。** 多項式のコスト因子を系統的に無視するため、論文自身の例によれば入力全体を読むコストは 1 であり、著者らは現実の高速化がこの粒度では見えないと二度注記しています。**さらに定式化も簡略化されています。** 第3節から第5節は重み n/2 の解のみを扱い、n は 16 の倍数と仮定され、成功確率は定数ではなく n の逆多項式であり、その確率に関する一つの副次的主張は解析ではなく実験に基づいています。最後に、論文ではなく Zoo の分類について二点あります。Zoo は本項目を Polynomial という速度向上の区分に置いていますが、**この論文自身の速度向上を「多項式」と形容する箇所はありません**。十七箇所ある「polynomial」の用例はすべて、無視されるコスト因子、P と NP の対比、データ構造の上限、成功確率、または参考文献の題名についてのものです。また、最良の古典アルゴリズムである Becker, Coron, Joux の指数 0.291… との比較は、量子か否かの欄を持つ比較表の中でのみ行われており、その差を述べた文は本文のどこにもありません。",
    tags: ["subset-sum", "quantum walk", "element distinctness", "representations", "knapsack"],
    source: {
      id: "doi:10.1007/978-3-642-38616-9_2",
      title: "Quantum algorithms for the subset-sum problem",
      authors: "Daniel J. Bernstein, Stacey Jeffery, Tanja Lange, Alexander Meurer",
      year: "2013",
      url: "https://doi.org/10.1007/978-3-642-38616-9_2",
    },
    literature: [
      {
        title: "Quantum algorithms for the subset-sum problem",
        authors: "Daniel J. Bernstein, Stacey Jeffery, Tanja Lange, Alexander Meurer",
        year: "2013",
        url: "https://doi.org/10.1007/978-3-642-38616-9_2",
        relevance: "Primary source and the source of every figure here. Section 1 carries both the cost exponent and the two sentences that scope it — the free-quantum-RAM convention and the statement that the analyses are heuristic. Table 1.1 is the comparison against the other eleven algorithms, quantum and classical, and is the only place the best classical exponent appears. Section 3 is the walk and the radix tree that replaces Ambainis's memory structure; section 5 is the representation technique and the final cost. The version of record is the Springer chapter; the authors' own full text is on cr.yp.to and carries no DOI or venue on its face.",
        relevanceJa: "一次資料であり、ここに示したすべての数値の出典です。第1節にはコストの指数と、それを限定する二つの文、すなわち量子 RAM を無償とする約束事と、解析が発見的であるという言明の双方があります。表1.1 は量子・古典あわせて他の十一のアルゴリズムとの比較であり、最良の古典指数が現れる唯一の箇所です。第3節はウォークと、Ambainis の記憶構造を置き換える基数木であり、第5節は表現法と最終的なコストです。版としての正本は Springer の章であり、著者ら自身による全文は cr.yp.to にあって、その表面には DOI も掲載媒体も記されていません。",
      },
    ],
    relatedSlugs: ["subset-finding-quantum-walk", "element-distinctness", "grover-unstructured-search", "average-case-lattice-problems-by-filtering"],
  },
  {
    slug: "electrical-resistance",
    title: "Effective resistance of an electrical network",
    titleJa: "電気回路網の実効抵抗",
    family: "Quantum query algorithm",
    zooName: "Electrical Resistance",
    zooSection: "Oracular Algorithms",
    speedup: "Exponential",
    speedupPrimary: { states: "reported", quote: "In particular, their dependence on N is exponentially better than that of known classical algorithms." },
    problem: "Given oracle access to a weighted graph on N vertices of maximum degree d whose edge weights are conductances, so that an edge of weight w carries resistance 1/w, estimate the effective resistance between a chosen pair of vertices s and t to within a factor of 1 + ε. Wang poses it as ENA-ER: for a network with |V| = N, deg(G) ≤ d, edge conductances normalized to 1 ≤ w_e ≤ c for every edge — equivalently edge resistances in [1/c, 1] — and spectral gap λ2(L_G) ≥ λ > 0, estimate R_eff(s, t) up to multiplicative error ε, succeeding with probability at least 2/3, given a procedure Pv that on input a vertex index and a number k returns the k-th edge incident to that vertex and a procedure Pe that on input an edge index returns that edge's two endpoints and its weight, both of which Wang assumes can be implemented in time poly(log(N)).",
    problemJa: "最大次数が d の N 頂点の重み付きグラフへオラクル経由でアクセスできるとき、指定した 2 頂点 s と t の間の実効抵抗を 1 + ε 倍の範囲に収まる精度で推定する問題です。ここで辺の重みはコンダクタンスであり、重み w の辺は抵抗 1/w を持ちます。Wang はこれを ENA-ER として定式化しています。すなわち、|V| = N、deg(G) ≤ d であり、各辺のコンダクタンスが 1 ≤ w_e ≤ c に正規化され（言い換えれば各辺の抵抗が [1/c, 1] にあり）、スペクトルギャップが λ2(L_G) ≥ λ > 0 である回路網について、頂点の添字と数 k を入力するとその頂点に接続する k 番目の辺を返す手続き Pv と、辺の添字を入力するとその辺の両端点と重みを返す手続き Pe が与えられたもとで、R_eff(s, t) を乗法的な誤差 ε の範囲で、確率 2/3 以上で成功するように推定する、という形です。Wang はこの 2 つの手続きがいずれも poly(log(N)) 時間で実装できると仮定しています。",
    idea: "Wang gives two classes of quantum algorithms for analyzing large sparse electrical networks — networks that might contain exponentially many vertices, but in which each vertex has only a small number of neighbours that can be efficiently found — and reaches the effective resistance as a special case of the dissipated-power problem, because when the external current is the unit current injected at s and extracted at t, the power of the induced flow equals R_eff(s, t). On the current version's own numbering, the first class builds linear systems whose solutions encode the electric potentials and the electric currents and extracts a number from them rather than a state, which is what makes the output an estimate of a physical quantity instead of a state proportional to the solution. The second class instead takes advantage of the graph structure: Wang first establishes a relationship between the kernel of the signed weighted incidence matrix of a network and the electrical flow in that network, then obtains a state encoding that flow by performing a boosted version of phase estimation on the quantum walk corresponding to that matrix, and reads the resistance off it. He reports this walk-based class as beating the first class in computing dissipated powers and effective resistances, though his own side-by-side comparison of the two says that holds unconditionally only for one of the two procedures he gives for implementing the walk operator; with the other, the walk-based one has much better dependence on d but slightly worse dependence on 1/λ. Ito and Jeffery arrive at the same quantity from span programs: they relax the requirement that 1-inputs hit some target exactly, so that any span program deciding a function can also approximate its positive witness size, and the st-connectivity span program of Belovs and Reichardt has positive witness size equal to half the effective resistance, which turns witness-size estimation into resistance estimation. The Zoo attributes one of Wang's two algorithms to the Harrow, Hassidim and Lloyd linear-systems algorithm, which is the route the paper's first version takes; the Zoo numbers neither algorithm, and the paper's own numbering of the two is reversed between its first version and its current one, so no ordinal is safe here.",
    ideaJa: "Wang は、大規模で疎な電気回路網、すなわち頂点数が指数的に大きくなりうる一方で各頂点の隣接頂点は少数であって効率的に求められるような回路網を解析するために、2 つの種類の量子アルゴリズムを与えています。実効抵抗には消費電力の問題の特別な場合として到達しており、外部電流が s から流し込んで t から取り出す単位電流である場合、誘起される流れの電力が R_eff(s, t) に等しくなるからです。現行版自身の番号付けによれば、第一の種類は、その解が電位と電流を符号化するような線形方程式を立て、そこから状態ではなく数値を取り出します。出力が解に比例する状態ではなく物理量の推定値になるのは、この点によります。第二の種類は代わりにグラフの構造を利用します。Wang はまず、回路網の符号付き重み付き接続行列の核と、その回路網における電流の流れとの関係を確立し、次にその行列に対応する量子ウォークに対して位相推定の強化版を実行することでその流れを符号化する状態を得て、そこから抵抗を読み取ります。Wang は、消費電力と実効抵抗の計算においてこのウォークに基づく種類が第一の種類を上回ると報告していますが、両者を並べた彼自身の比較によれば、それが無条件に成り立つのは、ウォーク作用素を実装するために彼が与える 2 つの手続きのうち一方を用いた場合だけです。もう一方を用いると、ウォークに基づくほうは d への依存性がはるかに良い一方で、1/λ への依存性はわずかに悪くなります。Ito と Jeffery は、spanプログラムの側から同じ量に到達しています。1 入力がある目標にちょうど到達するという要請を緩めることで、ある関数を判定する任意のspanプログラムがその正の証拠サイズを近似することにも使えるようにしており、Belovs と Reichardt による st 連結性のspanプログラムは正の証拠サイズが実効抵抗の半分に等しいため、証拠サイズの推定がそのまま抵抗の推定になります。Zoo は Wang の 2 つのアルゴリズムのうち一方を Harrow、Hassidim、Lloyd の線形方程式アルゴリズムに帰しており、これは論文の初版が取る道筋です。Zoo はどちらのアルゴリズムにも番号を付けておらず、また 2 つのアルゴリズムに対する論文自身の番号付けも初版と現行版とで逆になっているため、ここではどの序数も安全ではありません。",
    complexity: "Wang's abstract states a running time of poly(d, c, log(N), 1/λ, 1/ε) for computing voltages, currents, dissipated powers and effective resistances, where N is the number of vertices, d the maximum unweighted degree, c the ratio of largest to smallest edge resistance, λ the spectral gap of the normalized Laplacian and ε the accuracy; that this is a time bound and not only a query count rests on his assumption that the graph-access procedures can themselves be implemented in time poly(log(N)). For the resistance problem alone the paper gives two counts, both in uses of the two graph-access procedures Pv and Pe and both gate-efficient in its own sense: the linear-systems route is O((c d^2/(λ ε)) · poly log(c d/(λ ε))), and the quantum-walk route is O(min{c^0.5 d^1.5/(ε λ), c d^0.5/(ε λ^1.5)} · poly log(c d/(ε λ))). Wang also proves a lower bound of Ω(1/√λ) queries for any of his four electrical-network problems, and reads it as saying his algorithms are optimal up to polynomial factors. Ito and Jeffery report bounds of a different kind in a different query model: Õ(n √(R_st(G)) / ε^(3/2)) for estimating R_st(G) to relative accuracy ε, and Õ(n √(R_st(G)/µ) / ε) when µ is a lower bound on λ2(G), both in O(log n) space, and both linear rather than logarithmic in n.",
    complexityBasis: "Abstract of arXiv:1311.1851 as arxiv.org/abs/1311.1851 serves it today, which is v10 (LaTeX rendered into Unicode): \"These algorithms compute various electrical quantities, including voltages, currents, dissipated powers and effective resistances, in time poly(d, c, log(N), 1/λ, 1/ε), where N is the number of vertices in the network, d is the maximum unweighted degree of the vertices, c is the ratio of largest to smallest edge resistance, λ is the spectral gap of the normalized Laplacian of the network, and ε is the accuracy. Furthermore, we show that the polynomial dependence on 1/λ is necessary.\" The assumption that turns the query counts below into a time bound is section 2.4 of that version, closing the model description: \"We assume that Pv, Pe and Pi are all efficient, in the sense that they can be implemented in time poly(log(N)).\" The two resistance-specific counts are Corollary 2 of that version, \"The ENA-ER problem can be solved by a gate-efficient quantum algorithm that makes O(cd^2/(λε) · poly log(cd/(λε))) uses of Pv and Pe\", and Corollary 3, \"The ENA-ER problem can be solved by a gate-efficient quantum algorithm that makes O(min{c^0.5 d^1.5/(ελ), cd^0.5/(ελ^1.5)} · poly log(cd/(ελ))) uses of Pv and Pe\", each with its bound transcribed out of the display equation the corollary sets it in; the lower bound is the opening of section 5, \"we prove that in order to solve any of the ENA-V, ENA-C, ENA-P, ENA-ER problems, one has to make Ω(1/√λ) queries to the graph. This lower bound implies that our algorithms are optimal up to polynomial factors and hence cannot be greatly improved.\" The adjacency-model figures are the abstract of arXiv:1507.00432 as arxiv.org/abs/1507.00432 serves it (LaTeX rendered into Unicode), which is worded differently from the abstract typeset inside the paper's only version: \"we give the first upper bounds in the adjacency query model on the quantum time complexity of estimating the effective resistance between s and t, R_{s,t}(G), of Õ((1/ε^(3/2)) n √(R_{s,t}(G))), and, when µ is a lower bound on λ2(G), by our phase gap lower bound, we can obtain Õ((1/ε) n √(R_{s,t}(G)/µ)), both using O(log n) space.\" The same two bounds are Theorem 4.2 and Theorem 4.3 of that version, where they are stated as time complexities with space complexity O(log n). The Zoo states the running time in a third parameterisation, \"poly( log n, d, 1/φ, 1/ε), where φ is the expansion of the graph\", which is the v1 abstract's \"Both of them have running time poly(log n, d, c, 1/φ, 1/ε)\" with c dropped.",
    caveat: "This is a literature record: no circuit was built, compiled, simulated or run, and no network instance was solved. Every figure above is asymptotic and states no constant, and what Wang counts is uses of the two graph-access procedures, so gate counts beyond his gate-efficiency claim, the cost of implementing those procedures — which he assumes to be poly(log(N)) rather than bounding it — and any runtime on hardware are outside it. The exponential separation is narrower than the Zoo's one-word class: Wang states it about the dependence on the graph's size alone, the running time is polynomial in d, c, 1/λ and 1/ε, and the paper's first version is explicit that the algorithms run much faster than the known classical algorithms in the case that the graph is sufficiently sparse and expanding, and the edge weights do not vary much. The classical side is the fastest algorithm known — Wang cites Spielman and Teng for a nearly-linear-time solve of the Laplacian system, and Spielman and Srivastava for an Ω(m) cost of approximating effective resistances, m being the number of edges — not a proven lower bound, so the separation is conditional on that state of the art. The three references the Zoo groups here are not interchangeable: Ito and Jeffery state that theirs are the first quantum algorithms for this problem in the adjacency query model and that Wang studied it in the edge-list model, and their own bounds are linear in n rather than logarithmic, so the Exponential class does not describe them. Finally, the Zoo's statement of this row diverges from the paper in four places, and a reader arriving from the Zoo should expect all four: it cites the paper under the title of its first version; it reads the edge weights as the resistances, where Wang reads them as the conductances and normalizes those to [1, c], which is the reciprocal convention; it attributes the linear-systems route to Harrow, Hassidim and Lloyd, which is what that first version does, while the current version builds its variants on Childs, Kothari and Somma instead; and it states the bound in the expansion of the graph, where the current version states it in the spectral gap of the normalized Laplacian.",
    caveatJa: "本項目は文献に基づく記録です。回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、具体的な回路網の問題例を解いたわけでもありません。上記の数値はいずれも漸近的なもので定数を示しておらず、Wang が数えているのはグラフへアクセスする 2 つの手続きの呼び出し回数です。したがって、彼のゲート効率性の主張を超えるゲート数、それらの手続きを実装するコスト（彼はこれを押さえるのではなく poly(log(N)) と仮定しています）、実機での所要時間は、いずれも対象外です。指数的な差は Zoo の一語の区分よりも狭いものです。Wang がそれを述べているのはグラフの規模への依存性についてだけであり、実行時間は d, c, 1/λ, 1/ε については多項式です。さらに論文の初版は、これらのアルゴリズムが既知の古典アルゴリズムよりはるかに高速に動くのは、グラフが十分に疎かつエキスパンダー的で、辺の重みの変動が大きくない場合であると明記しています。古典側は現在知られている最速のアルゴリズムであって証明された下界ではありません。Wang は、ラプラシアンの線形方程式をほぼ線形時間で解くことについて Spielman と Teng を、実効抵抗を近似するコストが Ω(m)（m は辺の数）であることについて Spielman と Srivastava を引いており、この差はその時点で知られている技術水準に依存します。Zoo がここにまとめている 3 つの文献は互いに置き換えられるものではありません。Ito と Jeffery は、隣接クエリモデルにおけるこの問題に対する量子アルゴリズムとしては自分たちのものが最初であり、Wang は辺リストモデルでこの問題を扱ったと述べています。彼らの評価は n について対数ではなく線形であるため、「Exponential」という区分は彼らの結果を表すものではありません。最後に、この項目についての Zoo の記述は 4 か所で論文と食い違っており、Zoo から来た読者はその 4 つすべてを見込んでおく必要があります。第一に、Zoo は論文を初版の題名で引用しています。第二に、辺の重みを抵抗として読んでいますが、Wang はこれをコンダクタンスとして読み、[1, c] に正規化しており、両者は互いに逆数の規約です。第三に、線形方程式による道筋を Harrow、Hassidim、Lloyd に帰していますが、そうしているのは初版であり、現行版はその変種を Childs、Kothari、Somma の結果の上に構成しています。第四に、評価をグラフの拡大率で述べていますが、現行版は正規化ラプラシアンのスペクトルギャップで述べています。",
    tags: ["effective resistance", "electrical network", "quantum walk", "linear systems", "span program", "oracle"],
    source: {
      id: "arxiv:1311.1851",
      title: "Efficient Quantum Algorithms for Analyzing Large Sparse Electrical Networks",
      authors: "Guoming Wang",
      year: "2013",
      url: "https://arxiv.org/abs/1311.1851",
    },
    literature: [
      {
        title: "Efficient Quantum Algorithms for Analyzing Large Sparse Electrical Networks",
        authors: "Guoming Wang",
        year: "2013",
        url: "https://arxiv.org/abs/1311.1851",
        relevance: "Primary source, and the only one of the three whose own text states an exponential separation for this row's problem. It proposes two classes of quantum algorithms for analyzing large sparse electrical networks, the first based on solving linear systems and the second on using quantum walks, computes voltages, currents, dissipated powers and effective resistances in time poly(d, c, log(N), 1/λ, 1/ε), and states that their dependence on N is exponentially better than that of known classical algorithms. It also shows that the polynomial dependence on 1/λ is necessary, which it reads as its algorithms being optimal up to polynomial factors. Consult it for the graph-access model, since the time bound rests on the assumption that those procedures run in time poly(log(N)), and for its convention that edge weights are conductances and an edge of weight w has resistance 1/w. Note that the title and the parameterisation both changed across versions: the Zoo cites the first version, titled Quantum algorithms for approximating the effective resistances of electrical networks, whose abstract is stated in terms of the expansion φ of the graph and which uses the Harrow, Hassidim and Lloyd algorithm directly.",
        relevanceJa: "一次資料であり、3 つの文献のうち、この項目の問題について指数的な差を自らの本文で述べている唯一のものです。大規模で疎な電気回路網を解析するための 2 つの種類の量子アルゴリズムを提案しており、一方は線形方程式を解くことに、もう一方は量子ウォークを用いることに基づいています。電圧、電流、消費電力、実効抵抗を poly(d, c, log(N), 1/λ, 1/ε) 時間で計算し、これらの N への依存性は既知の古典アルゴリズムより指数的に良いと述べています。また 1/λ への多項式的な依存が必要であることも示しており、これを自らのアルゴリズムが多項式因子を除いて最適であることの根拠として読んでいます。時間の評価はこれらの手続きが poly(log(N)) 時間で動くという仮定に依存するため、グラフへのアクセスモデルについては原論文で確認してください。辺の重みをコンダクタンスとし、重み w の辺の抵抗を 1/w とする規約についても同様です。なお題名もパラメータの取り方も版によって変わっています。Zoo が引用しているのは初版であり、その題名は「Quantum algorithms for approximating the effective resistances of electrical networks」で、要旨はグラフの拡大率 φ を用いて述べられ、Harrow、Hassidim、Lloyd のアルゴリズムを直接用いています。",
      },
      {
        title: "Approximate Span Programs",
        authors: "Tsuyoshi Ito, Stacey Jeffery",
        year: "2015",
        url: "https://arxiv.org/abs/1507.00432",
        relevance: "Companion source for the span-program bounds the Zoo cites for this row. It shows how any span program that decides a problem can also be used to approximate the span program witness size, and applies that to effective resistance through the st-connectivity span program of Belovs and Reichardt, whose positive witness size is half of R_st(G). It reports the first upper bounds in the adjacency query model on the quantum time complexity of estimating R_st(G), and states that a linear dependence on n is necessary, so its results cannot be significantly improved. Consult it for the comparison it draws itself between the adjacency and edge-list query models, and for the caveats it lists on estimating a witness size through a linear-systems algorithm instead. Note that the abstract arxiv.org/abs/1507.00432 serves is worded differently from the abstract typeset in the paper itself, though the two bounds are the same.",
        relevanceJa: "Zoo がこの項目に対して引くspanプログラムによる評価に対応する関連資料です。ある問題を判定する任意のspanプログラムが、spanプログラムの証拠サイズを近似するためにも使えることを示し、これを Belovs と Reichardt による st 連結性のspanプログラムを通じて実効抵抗へ適用しています。このspanプログラムの正の証拠サイズは R_st(G) の半分です。論文は、R_st(G) を推定する量子時間計算量について隣接クエリモデルにおける最初の上界を報告し、n への線形な依存が必要であるため自らの結果を大きく改善することはできないと述べています。隣接クエリモデルと辺リストのクエリモデルとの比較は論文自身が行っており、証拠サイズを線形方程式アルゴリズムによって推定する場合に挙げている注意点とあわせて、原論文で確認してください。なお arxiv.org/abs/1507.00432 が提供する要旨は、論文本体に組まれた要旨とは表現が異なりますが、2 つの評価は同じものです。",
      },
      {
        title: "Quantum algorithm for solving linear systems of equations",
        authors: "Aram W. Harrow, Avinatan Hassidim, Seth Lloyd",
        year: "2008",
        url: "https://arxiv.org/abs/0811.3171",
        relevance: "The linear-systems algorithm the Zoo names as the basis of one of Wang's two algorithms. Given a sparse N by N matrix A with condition number kappa and a vector b, it estimates the expectation value of an operator with respect to the solution of Ax = b in poly(log N, kappa) time, which its abstract calls an exponential improvement over the best classical algorithm; that exponential is about solving linear systems, not about estimating a resistance. The first version of Wang's paper applies it to the Laplacian system whose solution encodes the electric potentials; the current version uses a later linear-system algorithm in its place.",
        relevanceJa: "Zoo が Wang の 2 つのアルゴリズムの一方の土台として挙げている線形方程式アルゴリズムです。条件数 kappa を持つ疎な N×N 行列 A とベクトル b が与えられたとき、Ax = b の解に関する演算子の期待値を poly(log N, kappa) 時間で推定するもので、要旨はこれを最良の古典アルゴリズムに対する指数的な改善と呼んでいます。ただしこの指数的というのは線形方程式を解くことについての主張であって、抵抗を推定することについてのものではありません。Wang の論文の初版はこれを、解が電位を符号化するラプラシアンの線形方程式に適用しています。現行版はその位置に、後年の線形方程式アルゴリズムを用いています。",
      },
    ],
    relatedSlugs: ["hhl-linear-systems", "spectral-sum-estimation", "matrix-rank-span-program", "quantum-walk-line", "graph-properties-adjacency-matrix"],
  },
  {
    slug: "graph-collision",
    title: "Graph collision on a known graph",
    titleJa: "既知のグラフ上のグラフ衝突問題",
    family: "Quantum query algorithm",
    zooName: "Graph Collision",
    zooSection: "Oracular Algorithms",
    speedup: "Polynomial",
    speedupPrimary: { states: "absent", read: "the abstract of arXiv:quant-ph/0310134 and its section 4.2 (Graph Collision Problem), where Theorem 3 and its proof state the graph collision bound. The abstract reports only the triangle bounds Õ(n^(10/7)) and Õ(n^(13/10)) and does not mention graph collision at all; neither it nor section 4.2 states a classical query cost for graph collision, and neither compares the Õ(n^(2/3)) bound against one. The word classical occurs six times in the body of the paper and twice more in its bibliography, never in section 4.2; the nearest it comes to this problem is the remark opening section 4.1 that the algorithm of Ambainis is somewhat similar to the brand of classical algorithms, where a database is used, which states no cost." },
    problem: "We are given an undirected graph G on n vertices, known explicitly in advance, together with oracle access to a labeling of the vertices by 1 and 0; the graph collision problem is to decide, by querying that labeling, whether there exist a pair of vertices, connected by an edge, both of which are labeled 1. Only the labeling is queried and never the graph, which is why Magniez, Santha and Szegedy can restate the task as deciding whether the set of vertices of value 1 forms an independent set in G. It is not either of the two problems it is easily confused with: collision finding asks for two arguments of a two-to-one function that share a value, and element distinctness drops that promise and asks whether any two of N items are equal. Those two share a single other Zoo entry, Collision Finding and Element Distinctness, and a single record here, element-distinctness; neither of them has a graph or an edge relation in it.",
    problemJa: "n 頂点の無向グラフ G があらかじめ明示的に与えられ、さらに各頂点を 1 と 0 でラベル付けする写像へオラクル経由でアクセスできるとします。グラフ衝突問題は、そのラベル付けに問い合わせることによって、辺で結ばれた頂点の対であって両方とも 1 とラベル付けされているものが存在するかどうかを判定する問題です。問い合わせるのはラベル付けだけであってグラフではなく、そのため Magniez, Santha, Szegedy はこの課題を、値が 1 の頂点の集合が G の独立集合をなすかどうかの判定として言い換えています。混同されやすい2つの問題のいずれとも異なります。衝突発見は 2 対 1 の写像について同じ値をとる2つの引数を求める問題であり、要素相異性はその約束を外して、N 個の要素のうちに等しいものがあるかどうかを問う問題です。この2つは Zoo では本項目とは別の1項目「Collision Finding and Element Distinctness」に、本リポジトリでは別の1件の記録 element-distinctness にまとめられており、どちらにもグラフも辺の関係も現れません。",
    idea: "Magniez, Santha and Szegedy introduced graph collision as a subproblem of triangle finding, as Jeffery, Kothari and Magniez record in section 3.1 of their own paper, and solved it inside the dynamic quantum query framework built in the same paper by generalizing Ambainis's quantum walk for element distinctness. The framework walks over the r-element subsets U of the vertex set, carrying with each subset a database D(U) of the pairs (v, f(v)) for the labels already queried; setting a subset up costs r queries, moving one element in or out costs one, and checking whether U already contains a collision costs no query at all, because the stored labels exhibit it. Theorem 3 takes r = n^(2/3) and gets Õ(n^(2/3)) queries on an arbitrary graph. The tilde comes from Corollary 2, the form of the framework that drops the promise of at most one collision: the paper obtains it by a random reduction using a logarithmic number of randomly chosen relations, and says that hence an additional logarithmic factor appears in the complexity. That general bound has not moved since, so the later papers in this row sharpen it by parameterizing the graph rather than by improving the worst case, and their bounds hold on every graph — Belovs notes that his own collapses to the general O(n^(2/3)) once the parameter is as large as it can be. Jeffery, Kothari and Magniez, who need graph collision as the inner problem of Boolean matrix multiplication, use no quantum walk: their instances are bipartite and close to complete, so they search one side for a marked vertex, read the values of the vertices remaining on that side, and search its neighbours on the other side. Belovs derives a bound in the independence number as a warm-up for the modified learning-graph method he builds for k-distinctness. Gavinsky and Ito put an approximate count of degrees in front of a span program and parameterize by the maximum total degree of the vertices in an independent set, which also gives a near-optimal bound on random graphs; Ambainis, Balodis, Iraids, Ozols and Smotrovs add a tree-decomposition algorithm in the treewidth, a span-program algorithm improving the Gavinsky-Ito parameter, and an algorithm for a subclass of circulant graphs. The Zoo records the observation that fixes the lower end: a star graph with its centre labeled 1 and its leaves labeled by the database entries embeds Grover's unstructured search, so graph collision is at least as hard as search.",
    ideaJa: "Magniez, Santha, Szegedy はグラフ衝突を三角形発見問題の部分問題として導入しました。この経緯は Jeffery, Kothari, Magniez が自身の論文の第3.1節に記しています。彼らは同じ論文で構成した動的な量子クエリの枠組みの中で、要素相異性に対する Ambainis の量子ウォークを一般化することによってこの問題を解いています。この枠組みは頂点集合の r 元部分集合 U の上を歩き、各部分集合とともに、既に問い合わせたラベルについての対 (v, f(v)) からなるデータベース D(U) を保持します。部分集合を用意するのに r 回のクエリ、元を1つ出し入れするのに1回のクエリがかかり、U が既に衝突を含むかどうかの判定にはクエリが一切かかりません。保持されたラベルがそれを示しているからです。定理3は r = n^(2/3) と選び、任意のグラフ上で Õ(n^(2/3)) クエリを得ます。チルダは系2に由来します。系2は、衝突が高々1つという約束を外した形の枠組みであり、論文はこれを、対数個のランダムに選んだ関係を用いる乱択的な帰着によって得たうえで、したがって計算量に対数因子が1つ余分に現れると述べています。この一般の場合の上界はその後動いておらず、そのため本項目の後年の論文は、最悪の場合を改善するのではなくグラフをパラメータ付けすることで評価を精密化しており、その評価はどのグラフ上でも成り立ちます。Belovs は、パラメータが取りうる最大の値になると自身の評価が一般の O(n^(2/3)) に一致することを注記しています。Jeffery, Kothari, Magniez はブール行列積の内側の問題としてグラフ衝突を必要としており、量子ウォークを用いません。彼らの問題例は二部グラフであって完全二部グラフに近いため、一方の側で印の付いた頂点を探索し、その側に残る頂点の値を読み出し、もう一方の側でその近傍を探索します。Belovs は、k-distinctness のために構成する修正版の学習グラフの手法に向けた準備として、独立数による評価を導いています。Gavinsky と Ito は次数の近似的な数え上げを spanプログラムの前段に置き、独立集合に含まれる頂点の次数の総和の最大値でパラメータ付けしており、これはランダムグラフ上でのほぼ最適な評価も与えます。Ambainis, Balodis, Iraids, Ozols, Smotrovs はさらに、木幅による木分解のアルゴリズム、Gavinsky-Ito のパラメータを改善する spanプログラムのアルゴリズム、および循環グラフの部分クラスに対するアルゴリズムを加えています。Zoo は下端を定める次の観察を記しています。中心を 1 とラベル付けし、葉をデータベースの各項目でラベル付けした星グラフは Grover の非構造化探索を埋め込むため、グラフ衝突は探索と少なくとも同じだけ難しい、というものです。",
    complexity: "Õ(n^(2/3)) quantum queries on an arbitrary n-vertex graph, which is Theorem 3 of Magniez, Santha and Szegedy and which the Zoo reports without the tilde as O(N^(2/3)) and calls the best upper bound on quantum query complexity known for this problem on general graphs; against that, the Zoo gives quantum query complexity Ω(√n) and classical query complexity Θ(n), both from embedding Grover's unstructured search in a star graph. The sharper bounds are parameterized rather than restricted to a class of graphs: each holds on every graph and degrades to the general bound as its parameter grows. They are O(√n α^(1/6)) in the independence number α (Belovs, Theorem 7); O(√n + √(α*(G))) where α*(G) is the maximum total degree of the vertices in an independent set of G (Gavinsky and Ito, Theorem 1), with O(√(n log n)) queries on most graphs when every edge is present independently with a fixed probability; and O(√n t^(1/6)) in the treewidth t together with O(√n + √(α**(G))) where α**(G) is the smallest, over the vertex covers of G, of the largest total degree of an independent subset of that cover (Ambainis, Balodis, Iraids, Ozols and Smotrovs, Theorems 1 and 4). Only two of the bounds are genuinely restricted to a class: Õ(√n + √m) for a balanced bipartite graph on 2n vertices, where m counts the pairs of the two sides that are not edges, with Õ(√(nλ) + √m) for finding all λ collisions rather than deciding that one exists (Jeffery, Kothari and Magniez, Theorem 3.1), and O(√n) for a subclass of circulant graphs (Ambainis, Balodis, Iraids, Ozols and Smotrovs, Theorem 5).",
    complexityBasis: "section 4.2 of arXiv:quant-ph/0310134, Theorem 3: \"Graph Collision(G) can be solved with positive constant probability in quantum query complexity Õ(n^(2/3))\", with its proof \"We solve Unique Graph Collision(G) using Corollary 2, with S = [n] and r = n^(2/3)\" and \"Observe that s(r) = r, u(r) = 1 and c(r) = 0\", and the paragraph before Corollary 2 for the tilde: \"The reduction goes in the standard way using a logarithmic number of randomly chosen relations R, and hence an additional logarithmic factor appears in the complexity\"; Quantum Algorithm Zoo entry \"Graph Collision\": \"One can embed Grover's unstructured search problem as an instance of graph collision by choosing the star graph, labeling the center 1, and labeling the remaining vertices by the database entries. Hence, this problem has quantum query complexity Ω(√n) and classical query complexity Θ(n)\" and \"In [70], Magniez, Nayak, and Szegedy gave a O(N^(2/3))-query quantum algorithm for graph collision on general graphs. This remains the best upper bound on quantum query complexity for this problem on general graphs\" — the Zoo's prose names Nayak, while its own bibliography entry 70 and the arXiv abs page both give Santha; Theorem 3.1 of arXiv:1112.5855: \"For all λ ≥ 1, GC_all(n, m, λ) ∈ Õ(√(nλ) + √m) and GC(n, m) ∈ Õ(√n + √m)\", whose graph is fixed in section 3.1 as \"Let G = (A, B, E) be a balanced bipartite graph on 2n vertices\" and whose m is fixed in section 3.3 as \"the query complexity of finding a graph collision in some graph with m non-edges, which we denote GC(n, m)\"; Theorem 7 of arXiv:1205.1534: \"Graph collision on graph G can be solved in O(√n α^(1/6)) quantum queries with bounded error, where α = α(G) is the independence number of G\", with the same section's \"In the general case, α(G) = O(n), and the complexity of the algorithm is O(n^(2/3)) that coincides with the complexity of the algorithm for a general graph\"; Theorem 1 of arXiv:1204.1527: \"For a graph G on n vertices, the quantum query complexity of the graph collision problem on G is O(√n + √(α*(G))), where α*(G) is the maximum total degree of the vertices in an independent set of G\", with its abstract \"if G is a random graph where every edge is present with a fixed probability independently of other edges, then our algorithm requires O(sqrt(n log n)) queries on most graphs\"; and arXiv:1305.1021, Theorem 1: \"Graph collision on graph G on n vertices can be solved with a bounded error quantum algorithm with O(√n t^(1/6)) queries where t is the treewidth of the graph\", Theorem 4: \"Q(COL(G)) = O(√(|V(G)|) + √(α**(G)))\", and Theorem 5: \"For graphs CI(n, a, b): Q(COL(CI(n, a, b))) = O(√n)\".",
    caveat: "This is a literature record: no oracle was instantiated, no circuit was built, compiled, simulated or run, and no graph collision instance was decided here. Every figure above is a query count for the vertex-labeling oracle alone — G is given explicitly and is never queried — so none of it bounds gate count, circuit depth, the classical work of reading G and computing the treewidth, independence number or degree parameter that the sharpened bounds are stated in, or the constants and logarithmic factors that Õ(·) hides. The Θ(n) classical figure is the Zoo's own and is attributed to no reference there; the Ω(√n) quantum lower bound is also stated by Jeffery, Kothari and Magniez and by Gavinsky and Ito, who call it an easy consequence of the search lower bound. Neither is re-derived here, and both describe the general problem rather than the parameterized bounds quoted beside them. The gap between them on general graphs is open: Jeffery, Kothari and Magniez call closing it an important open problem, and Ambainis, Balodis, Iraids, Ozols and Smotrovs present what they call, possibly, the first example of an explicit graph for which none of the existing quantum algorithms finds graph collision with substantially less than O(n^(2/3)) queries. The Zoo restates the Jeffery-Kothari-Magniez bound as Õ(√n + √l) with l the number of non-edges in G, dropping the balanced bipartite graph on 2n vertices that the paper proves it for; there m counts pairs of the two sides that are not edges, which Gavinsky and Ito describe as the number of missing edges compared to the complete bipartite graph, so the Zoo's l and the paper's m are not the same measurement. The Belovs bound is a warm-up result inside a paper about k-distinctness. The general bound is written Õ(n^(2/3)) in Theorem 3 of the primary paper but O(N^(2/3)) in the Zoo's prose and O(n^(2/3)) in section 3.1 of Jeffery, Kothari and Magniez, so the log factors are not reported consistently even across the sources gathered here. The Polynomial class is the Zoo's, not the primary paper's: arXiv:quant-ph/0310134 states no classical baseline for graph collision in its abstract or in section 4.2. Finally, graph collision is not collision finding and not element distinctness — those two share one other Zoo entry and this repository's single element-distinctness record — and no bound above transfers between them.",
    caveatJa: "本項目は文献に基づく記録です。オラクルを具体化したことも、回路を構成・コンパイル・シミュレート・実行したことも、具体的なグラフ衝突の問題例を判定したこともありません。上記の数値はいずれも頂点のラベル付けのオラクルに対するクエリ数だけを数えたものであり、G は明示的に与えられていて問い合わせの対象にはなりません。したがって、ゲート数、回路深さ、G を読み込んで、精密化された評価が用いる木幅・独立数・次数のパラメータを計算する古典的な作業量、および Õ(·) が隠している定数や対数因子のいずれについても、上界を与えるものではありません。古典側の Θ(n) は Zoo 自身の記述であり、そこでは出典となる文献が示されていません。量子の下界 Ω(√n) は Jeffery, Kothari, Magniez と Gavinsky, Ito も述べており、彼らはこれを探索の下界からの容易な帰結と呼んでいます。いずれも本記録で導出し直したものではなく、またどちらも、並べて引用したパラメータ付きの評価ではなく一般の問題についての記述です。一般のグラフにおける両者の隔たりは未解決です。Jeffery, Kothari, Magniez はこれを埋めることを重要な未解決問題と呼び、Ambainis, Balodis, Iraids, Ozols, Smotrovs は、既存のどの量子アルゴリズムも O(n^(2/3)) より実質的に少ないクエリではグラフ衝突を見つけられない明示的なグラフの、著者らの言葉によればおそらく最初の例を与えています。Zoo は Jeffery-Kothari-Magniez の評価を、l を G の非辺の個数として Õ(√n + √l) と言い換えており、論文がそれを証明している 2n 頂点の均衡二部グラフという設定を落としています。論文の m は両側の頂点の対のうち辺になっていないものを数えたものであり、Gavinsky と Ito はこれを、完全二部グラフと比べたときに欠けている辺の本数と表現しています。したがって Zoo の l と論文の m は同じ量ではありません。Belovs の評価は k-distinctness を主題とする論文の中の準備的な結果です。一般の場合の上界は、一次資料の定理3では Õ(n^(2/3))、Zoo の本文では O(N^(2/3))、Jeffery, Kothari, Magniez の第3.1節では O(n^(2/3)) と書かれており、ここに集めた資料の間でさえ対数因子の報告は一貫していません。高速化の区分「Polynomial」は Zoo によるものであって一次資料によるものではありません。arXiv:quant-ph/0310134 は、要旨でも第4.2節でも、グラフ衝突について古典側の基準となる計算量を述べていないからです。最後に、グラフ衝突は衝突発見でも要素相異性でもありません。その2つは別の1つの Zoo 項目と、本リポジトリの1件の記録 element-distinctness にまとめられており、上記のどの評価も両者の間で移し替えることはできません。",
    tags: ["graph collision", "query complexity", "oracle", "quantum walk", "triangle finding"],
    source: {
      id: "arxiv:quant-ph/0310134",
      title: "Quantum Algorithms for the Triangle Problem",
      authors: "Frederic Magniez, Miklos Santha, Mario Szegedy",
      year: "2003",
      url: "https://arxiv.org/abs/quant-ph/0310134",
    },
    literature: [
      {
        title: "Improving Quantum Query Complexity of Boolean Matrix Multiplication Using Graph Collision",
        authors: "Stacey Jeffery, Robin Kothari, Frédéric Magniez",
        year: "2011",
        url: "https://arxiv.org/abs/1112.5855",
        relevance: "Sharpens the bound by counting non-edges, and does it without a quantum walk. The authors reduce Boolean matrix multiplication to instances of graph collision and note that those instances have at most as many non-edges as there are 1s in the output matrix, the quantity their abstract writes as the number of 1s in the output and their section 3.3 calls an upper bound on the non-edge count m. They say outright that they do not use the graph collision algorithm the triangle-finding line depends on: their algorithm does not have any quantum walks. Theorem 3.1 gives Õ(√n + √m) for deciding and Õ(√(nλ) + √m) for finding all λ collisions, which is the form the matrix-multiplication application needs. Consult it for the model in section 3.1, a balanced bipartite graph on 2n vertices, which is narrower than graph collision as the Zoo states it, and for the same section's remark that the best known lower bound is Ω(√n) and closing the gap is an important open problem — the same section that records Magniez, Santha and Szegedy as the origin of the problem.",
        relevanceJa: "非辺の個数を数えることで評価を精密化しており、しかも量子ウォークを用いません。著者らはブール行列積をグラフ衝突の問題例へ帰着させ、それらの問題例の非辺の個数が出力行列に含まれる 1 の個数以下であることを指摘しています。この量を要旨は出力に含まれる 1 の個数と書き、第3.3節は非辺の個数 m の上界と呼んでいます。彼らは、三角形発見の系譜が依拠するグラフ衝突のアルゴリズムを用いないことを明言しており、自分たちのアルゴリズムには量子ウォークが一切現れないと述べています。定理3.1は、判定については Õ(√n + √m) を、λ 個の衝突をすべて見つける場合については Õ(√(nλ) + √m) を与えており、これが行列積への応用が必要とする形です。第3.1節のモデル、すなわち 2n 頂点の均衡二部グラフが Zoo の述べるグラフ衝突より狭い設定であること、および同じ節にある、知られている最良の下界は Ω(√n) であってその隔たりを埋めることは重要な未解決問題だという指摘については、原論文で確認してください。この節はまた、問題の起源が Magniez, Santha, Szegedy であることを記した節でもあります。",
      },
      {
        title: "Learning-Graph-Based Quantum Algorithm for k-distinctness",
        authors: "Aleksandrs Belovs",
        year: "2012",
        url: "https://arxiv.org/abs/1205.1534",
        relevance: "Sharpens the bound in the independence number. The paper's subject is a k-distinctness algorithm built on a modified learning graph approach, and its section 4, headed as a warm-up for that algorithm, proves in Theorem 7 that graph collision on a graph G can be solved in O(√n α^(1/6)) quantum queries with bounded error, where α is the independence number of G — the parameter the Zoo describes as the size of the largest independent set. The theorem carries no condition the abstract omits. The same section fixes how the bound should be read: it interpolates between the complete graph, where α = 1 and two Grover searches suffice, and the general case, where α = O(n) and the bound coincides with the general O(n^(2/3)). Consult it for the learning-graph construction the bound rests on, and note that graph collision is a preparatory result there rather than the subject.",
        relevanceJa: "独立数によって評価を精密化しています。論文の主題は、修正した学習グラフの手法に基づく k-distinctness のアルゴリズムであり、そのアルゴリズムに向けた準備と題された第4節の定理7が、グラフ G 上のグラフ衝突を有界誤差で O(√n α^(1/6)) 回の量子クエリで解けることを示しています。ここで α は G の独立数であり、Zoo が最大の独立集合の大きさと説明しているパラメータです。この定理には、要旨が省いている条件はありません。同じ節は評価の読み方も定めており、α = 1 であって Grover 探索2回で足りる完全グラフと、α = O(n) であって評価が一般の O(n^(2/3)) に一致する一般の場合との間を補間するものだとしています。評価が依拠する学習グラフの構成については原論文で確認してください。またそこでは、グラフ衝突は主題ではなく準備的な結果であることに注意してください。",
      },
      {
        title: "A quantum query algorithm for the graph collision problem",
        authors: "Dmitry Gavinsky, Tsuyoshi Ito",
        year: "2012",
        url: "https://arxiv.org/abs/1204.1527",
        relevance: "The one paper in this row whose subject is graph collision itself. Its Theorem 1 parameterizes by α*(G), the maximum total degree of the vertices in an independent set of G, for a query complexity of O(√n + √(α*(G))) on any graph on n vertices, reached by an approximate count of degrees followed by a span program. The abstract adds that if G is a random graph where every edge is present with a fixed probability independently of other edges then the algorithm requires O(sqrt(n log n)) queries on most graphs, which the authors call optimal up to the sqrt(log n) factor on most graphs; Corollary 2 is the quantitative form of that statement. Consult it for the sense in which the random-graph bound holds, since it quantifies over most graphs rather than over a worst case, and for its related-work section, which restates the Jeffery-Kothari-Magniez m as the number of missing edges compared to the complete bipartite graph.",
        relevanceJa: "本項目の中で、グラフ衝突そのものを主題とする唯一の論文です。定理1は、G の独立集合に含まれる頂点の次数の総和の最大値 α*(G) によってパラメータ付けし、n 頂点の任意のグラフ上でクエリ計算量 O(√n + √(α*(G))) を与えます。これは次数の近似的な数え上げに続いて spanプログラムを用いることで達成されます。要旨はさらに、G が各辺を他の辺とは独立に一定の確率で含むランダムグラフであれば、このアルゴリズムはほとんどのグラフ上で O(sqrt(n log n)) クエリしか要しないと述べており、著者らはこれを、ほとんどのグラフ上で sqrt(log n) の因子を除いて最適だと呼んでいます。系2がその主張を定量的な形にしたものです。ランダムグラフに対する評価が最悪の場合ではなくほとんどのグラフについて量化されている点で、それがどのような意味で成り立つのかについては、原論文で確認してください。また関連研究の節は、Jeffery-Kothari-Magniez の m を、完全二部グラフと比べたときに欠けている辺の本数と言い換えています。",
      },
      {
        title: "Parameterized Quantum Query Complexity of Graph Collision",
        authors: "Andris Ambainis, Kaspars Balodis, Jānis Iraids, Raitis Ozols, Juris Smotrovs",
        year: "2013",
        url: "https://arxiv.org/abs/1305.1021",
        relevance: "Three further upper bounds, and the summary the Zoo points readers to. Theorem 1 gives a tree-decomposition algorithm using O(√n t^(1/6)) queries in the treewidth t, Theorem 4 a span-program algorithm using O(√n + √(α**(G))) queries that improves the Gavinsky-Ito result, with α**(G) the minimum over vertex covers of G of the maximum, over independent subsets of that cover, of the sum of the degrees, and Theorem 5 an algorithm for the circulant graphs CI(n, a, b) using O(√n) queries. None of the three carries a condition its abstract omits. Section 5 then gives what the authors call, possibly, the first example of an explicit graph for which none of the existing quantum algorithms finds graph collision with substantially less than O(n^(2/3)) queries; the abstract states the same example against the weaker threshold O(√n log^c n) and, in the authors' own wording, says that all the known graphs fail — evidently a slip for all the known algorithms. Consult it for that graph and for the two additional classes the Zoo declines to describe.",
        relevanceJa: "さらに3つの上界を与える論文であり、Zoo が読者を案内している総括でもあります。定理1は木幅 t による木分解のアルゴリズムで O(√n t^(1/6)) クエリを、定理4は Gavinsky-Ito の結果を改善する spanプログラムのアルゴリズムで O(√n + √(α**(G))) クエリを与えます。ここで α**(G) は、G の頂点被覆をわたる最小値であって、各被覆についてはその独立な部分集合をわたる次数の総和の最大値をとったものです。定理5は循環グラフ CI(n, a, b) に対するアルゴリズムで O(√n) クエリを与えます。3つのいずれにも、要旨が省いている条件はありません。続く第5節は、既存のどの量子アルゴリズムも O(n^(2/3)) より実質的に少ないクエリではグラフ衝突を見つけられない明示的なグラフの、著者らの言葉によればおそらく最初の例を与えています。要旨は同じ例を O(√n log^c n) というより弱い閾値に対して述べており、しかも著者ら自身の表現では、知られているすべてのグラフが失敗すると書かれています。これは知られているすべてのアルゴリズムの誤りと見られます。そのグラフ、および Zoo が説明を控えている2つの追加のクラスについては、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["element-distinctness", "grover-unstructured-search", "subset-finding-quantum-walk", "matrix-products-over-semirings"],
  },
  {
    slug: "semidefinite-programming",
    title: "Semidefinite programming by quantum Gibbs sampling",
    titleJa: "量子 Gibbs サンプリングによる半正定値計画",
    family: "Optimization · semidefinite programming",
    zooName: "Semidefinite Programming",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Polynomial (with some exceptions)",
    speedupPrimary: { states: "reported", quote: "This gives a square-root unconditional speed-up over any classical method for solving SDPs both in n and m." },
    problem: "Given a list of m + 1 Hermitian n × n matrices C, A_1, A_2, …, A_m and m numbers b_1, …, b_m, find the positive semidefinite n × n matrix X that maximizes tr(CX) subject to the constraints tr(A_j X) ≤ b_j for j = 1, 2, …, m, approximately, to within ± ε of the optimum. The Zoo states that semidefinite programming has many applications in operations research, combinatorial optimization, and quantum information, and that it includes linear programming as a special case. All three papers reduce that optimization to a feasibility question by binary search on a guess for the optimal value, but not to the same feasibility question, and the difference carries a parameter that the runtimes below then depend on. Brandão and Svore add the constraint tr(X) ≤ R, with R a measure of the size of the optimal solution, and test the dual: they sample from the distribution y divided by the 1-norm of y for a dual feasible vector y. Van Apeldoorn, Gilyén, Gribling and de Wolf likewise test membership in a dual polytope induced by the current primal candidate, with R bounding the trace of an optimal primal X. Brandão, Kalev, Li, Lin, Svore and Wu instead normalise the primal to tr(X) = 1 and test it directly, deciding whether the constraints tr(A_i X) ≤ a_i + ε admit a positive semidefinite X of unit trace; Chia, Gilyén, Li, Lin, Tang and Wang adopt that same trace-one form for the dequantized version.",
    problemJa: "m + 1 個のエルミートな n × n 行列 C, A_1, A_2, …, A_m と m 個の数 b_1, …, b_m が与えられたとき、制約 tr(A_j X) ≤ b_j（j = 1, 2, …, m）のもとで tr(CX) を最大化する半正定値な n × n 行列 X を、最適値から ± ε の範囲で近似的に求める問題です。Zoo は、半正定値計画がオペレーションズリサーチ、組合せ最適化、量子情報に多くの応用を持ち、線形計画を特別な場合として含むと述べています。三つの論文はいずれも、最適値の推測値に対する二分探索によってこの最適化問題を実行可能性の判定へ帰着させますが、帰着先の実行可能性問題は同一ではなく、その違いは、後述する実行時間が依存するパラメータを伴います。Brandão と Svore は、最適解の大きさの尺度である R を用いた制約 tr(X) ≤ R を加えたうえで双対側を判定し、双対実行可能なベクトル y について、y をその 1-ノルムで割った分布からサンプリングします。van Apeldoorn、Gilyén、Gribling、de Wolf も同様に、現在の主問題の候補から定まる双対多面体への所属を判定しており、そこでの R は最適な主解 X のトレースの上界です。Brandão、Kalev、Li、Lin、Svore、Wu はこれとは異なり、主問題を tr(X) = 1 に正規化して直接判定し、制約 tr(A_i X) ≤ a_i + ε を満たすトレース 1 の半正定値行列 X が存在するかを決定します。Chia、Gilyén、Li、Lin、Tang、Wang は、古典化した版でも同じトレース 1 の形式を採用しています。",
    idea: "Brandão and Svore quantize the Arora-Kale matrix multiplicative weights method for SDPs. That classical framework iterates: an oracle turns a primal candidate X into a dual candidate y, y defines a Hermitian matrix H, and the next primal candidate is proportional to e^(-H). The quantum move is that a matrix proportional to e^(-H) is a Gibbs state, so it can be prepared on log(n) qubits by quantum Gibbs sampling in much less time than it takes to compute X as an n × n matrix, and the oracle can then be implemented from copies of that state, since the quantities Tr(A_j X) it needs are expectation values of the constraint matrices in that state. Their abstract states the algorithm is a combination of quantum Gibbs sampling and the multiplicative weight method, and that they modify Arora and Kale's algorithm to eliminate the need for solving an inner linear program. Van Apeldoorn, Gilyén, Gribling and de Wolf quantize the same framework differently and faster: they coherently prepare a purification of the Gibbs state rather than copies of a mixed state, estimate the trace quantities by amplitude estimation, and find an explicit 2-sparse dual vector using a generalization of the Dürr-Høyer minimum-finding algorithm, which is based on Grover search; their purified Gibbs sampler has logarithmic dependence on the error, which they call exponentially better than the Poulin and Wocjan sampler Brandão and Svore invoke. Brandão, Kalev, Li, Lin, Svore and Wu give two solvers rather than one improvement. In the plain entry-oracle model they decouple the dependence on m and n, which used to be √(mn) and becomes √m + √n, an observation they credit jointly with van Apeldoorn and Gilyén to the quantum OR lemma. In a second, fully quantum input model the constraint matrices arrive as quantum states, and there their main technical contribution applies: a Gibbs state sampler for low-rank Hamiltonians, given quantum states encoding those Hamiltonians, whose dependence on the dimension is only poly-logarithmic. That sampler is stated over the same quantum-input oracles as the solver it enables, so it is not a model-free ingredient available to the entry-oracle solvers. The Zoo summarizes the whole line as based on amplitude amplification and quantum Gibbs sampling.",
    ideaJa: "Brandão と Svore は、半正定値計画に対する Arora-Kale の行列乗法的重み法を量子化しています。この古典的な枠組みは次の反復から成ります。オラクルが主問題の候補 X を双対の候補 y に変換し、y がエルミート行列 H を定め、次の主問題の候補は e^(-H) に比例する行列となります。量子側の要点は、e^(-H) に比例する行列が Gibbs 状態であることです。そのため量子 Gibbs サンプリングによって log(n) 量子ビット上に、X を n × n 行列として計算するよりはるかに短い時間で準備でき、オラクルが必要とする量 Tr(A_j X) はその状態における制約行列の期待値であるため、オラクル自体もその状態のコピーから実装できます。著者らの要旨は、このアルゴリズムが量子 Gibbs サンプリングと乗法的重み法の組み合わせであること、および内部の線形計画を解く必要をなくすために Arora と Kale のアルゴリズムを変更したことを述べています。van Apeldoorn、Gilyén、Gribling、de Wolf は、同じ枠組みを別の仕方で、より速く量子化しています。混合状態のコピーではなく Gibbs 状態の純粋化をコヒーレントに準備し、トレースの量は振幅推定で見積もり、さらに Grover 探索に基づく Dürr-Høyer の最小値探索アルゴリズムの一般化によって、2 疎の双対ベクトルを明示的に求めます。彼らの純粋化 Gibbs サンプラーは誤差への依存が対数的であり、著者らはこれを、Brandão と Svore が用いる Poulin と Wocjan のサンプラーより指数的に良いと呼んでいます。Brandão、Kalev、Li、Lin、Svore、Wu が与えるのは、一つの改良ではなく二つのソルバーです。素朴な成分オラクルモデルでは、従来 √(mn) であった m と n への依存を切り離して √m + √n とします。この観察を、著者らは van Apeldoorn および Gilyén との共同のものとしたうえで、量子 OR 補題に帰しています。もう一つの、完全に量子的な入力モデルでは制約行列が量子状態として与えられ、そこで彼らの主要な技術的貢献が効きます。すなわち、低ランクの Hamiltonian を符号化した量子状態が与えられたときの、次元への依存が多重対数的でしかない Gibbs 状態のサンプラーです。このサンプラーは、それが可能にするソルバーと同じ量子入力のオラクルのもとで述べられており、成分オラクルのソルバーが使えるモデル非依存の部品ではありません。Zoo はこの一連の研究全体を、振幅増幅と量子 Gibbs サンプリングに基づくものとしてまとめています。",
    complexity: "Brandão and Svore's abstract gives a worst-case running time n^(1/2) m^(1/2) s^2 poly(log(n), log(m), R, r, 1/δ), with n the dimension and s the row-sparsity of the input matrices, m the number of constraints, δ the accuracy of the solution, and R and r upper bounds on the size of the optimal primal and dual solutions — in that paper r is a solution-size bound, not a rank — together with an Ω(n^(1/2) + m^(1/2)) quantum lower bound for constant s, R, r and δ. Their own Corollary 5 instantiates that poly as Õ(n^(1/2) m^(1/2) s^2 R^32/δ^18), and van Apeldoorn, Gilyén, Gribling and de Wolf record that this figure is for multiplicative error 1 ± δ in the special case b_j ≥ 1 and OPT ≥ 1, and that the reduction from a general SDP to that special case significantly worsens the dependence on R, r and δ; the paper's own reduction sends δ to δ/r and R to 2R + 1. Van Apeldoorn et al. keep the same dependence on m, n and s and improve the rest, reporting Õ(√(mn) s^2 (Rr/ε)^8), and Õ(√(mn) (Rr/ε)^5) for the special case of linear programs; in their paper R bounds the trace of an optimal primal X and r the sum of entries of an optimal dual y, and they argue that R, r and 1/ε trade against one another and should be read as the single parameter Rr/ε. Brandão, Kalev, Li, Lin, Svore and Wu report Õ(s^2 (√m ε^(-10) + √n ε^(-12))) in the entry-oracle model, but for their own normalised feasibility problem, which carries tr(X) = 1: they state that converting a general primal with width bound tr(X) ≤ R into that form changes ε to ε/R, and to ε divided by R times their dual bound if a strictly feasible solution is wanted, so the ε in those exponents is not the ε of a general SDP and the bound is not a version in which the size parameters have vanished. The same paper performs exactly that substitution when it restates Brandão and Svore's cost as Õ(√(mn) s^2 (R R-tilde/ε)^32), R-tilde being its name for the bound on the optimal dual solution. Its second bound, Õ(√m + poly(r)) · poly(log m, log n, B, ε^(-1)) with r the rank of the constraint matrices and B an upper bound on their trace norm, belongs to a fully quantum input model in which the matrices are supplied as quantum states. The Zoo's composite figure O(√m log m · poly(log n, r, ε^(-1))), with r read as the rank, is that second bound: it is the paper's Remark D.7, which takes the decomposition of each A_j to be its eigen-decomposition so that under the low-rank assumption B collapses to r, and s is absent because that model does not use sparsity at all. It is therefore not a bound in the entry-oracle model, where the same authors' Ω(√n) lower bound applies.",
    complexityBasis: "Abstract of arXiv:1609.05537 (inline TeX rendered into plain text: the fraction exponents are written n^(1/2) m^(1/2), and \"a upper bounds\" is the abstract's own wording): \"It has worst-case running time n^(1/2) m^(1/2) s^2 poly(log(n), log(m), R, r, 1/δ), with n and s the dimension and row-sparsity of the input matrices, respectively, m the number of constraints, δ the accuracy of the solution, and R, r a upper bounds on the size of the optimal primal and dual solutions\", and \"We prove the algorithm cannot be substantially improved (in terms of n and m) giving a Ω(n^(1/2)+m^(1/2)) quantum lower bound for solving semidefinite programs with constant s, R, r and δ\". The same paper, Corollary 5 (page 8 of v5): \"Using the Gibbs Sampler from Ref. [13], Algorithm 3 runs in time Õ(n^(1/2) m^(1/2) s^2 R^32/δ^18)\"; its section 2.2: \"Our algorithm will only work for SDPs for which b_i ≥ 1 for all i ∈ [m]\", \"We will also assume that α ≥ 1\", and Lemma 2, which supplies \"a δ-optimal solution\" of the general SDP \"given the ability to sample from a (δ/r)-optimal solution\" of an SDP \"with dimension n + 1, m + 1 variables and size parameter 2R + 1\" in which b_i ≥ 1. The scoping of that corollary is arXiv:1705.01843 section 1.3: \"Using these ideas, Brandão and Svore obtain a quantum SDP-solver of complexity Õ(√(mn) s^2 R^32/δ^18), with multiplicative error 1 ± δ for the special case where b_j ≥ 1 for all j ∈ [m], and OPT ≥ 1 … They describe a reduction to transform a general SDP of the form (1) to this special case, but that reduction significantly worsens the dependence of the complexity on the parameters R, r, and δ\". Section 1.4.1 of arXiv:1705.01843, headed \"Improved quantum SDP-solver\": \"These modifications both simplify and speed up the quantum SDP-solver, resulting in complexity Õ(√(mn) s^2 (Rr/ε)^8)\", \"The dependence on m, n, and s is the same as in Brandão-Svore, but our dependence on R, r, and 1/ε is substantially better\", \"These trade-offs suggest we should actually think of Rr/ε as one parameter of the primal-dual pair of SDPs, not three separate parameters\", and \"For the special case of LPs, we can improve the runtime to Õ(√(mn)(Rr/ε)^5)\"; the same paper's section 1.2 defines those parameters — \"Let R be an upper bound on the trace of an optimal X of the primal, r be an upper bound on the sum of entries of an optimal y for the dual\" — and its footnote 3 states \"The Õ(·) notation hides polylogarithmic factors in all parameters\". Abstract of arXiv:1710.02581: \"We consider SDP instances with m constraint matrices, each of dimension n, rank at most r, and sparsity s\", \"We show that it has run time Õ(s^2(√m ε^(-10)+√n ε^(-12))), with ε the error of the solution. This gives an optimal dependence in terms of m, n and quadratic improvement over previous quantum algorithms when m≈n\", and \"We show that its run time is Õ(√m+poly(r))·poly(log m, log n, B, ε^(-1)), with B an upper bound on the trace-norm of all input matrices. In particular the complexity depends only poly-logarithmically in n and polynomially in r\". Its problem (1.1) carries \"Tr(A_i X) ≤ a_i + ε ∀ i ∈ [m]; X ⪰ 0; Tr[X] = 1\", and the conversion is stated in the same section 1: \"for general feasible solution X ⪰ 0 with width bound Tr(X) ≤ R, there is a procedure to derive an equivalent SDP feasibility instance with variable X-hat s.t. Tr(X-hat) = 1. Note, however, the change of ε to ε/R in this conversion. Also note one can use an approximate feasibility solver to find a strictly feasible solution, by changing ε to ε/R R-tilde (see Lemma 18 of Ref. [9])\" — R-tilde is that paper's R with a tilde and X-hat its X with a hat, both rendered here as plain text. The same section restates the primary paper's cost under that substitution: \"giving a quantum algorithm with worst-case running time Õ(√(mn) s^2 (R R-tilde/ε)^32) … and R, R-tilde upper bounds on the norm of the optimal primal and dual solutions\". The Zoo's composite figure is that paper's Remark D.7: \"If we assume this decomposition to be the eigen-decomposition … then by the low-rank assumption and −I ⪯ A_j ⪯ I, Tr[A_j^+] + Tr[A_j^−] ≤ r. In this case, Corollary 5 takes at most √m · poly(log m, log n, r, ε^(-1)) quantum gates and queries to Oracle D.1, Oracle D.2, and Oracle D.3\" — where Corollary 5 is introduced as \"the following complexity result for solving SDPs under the quantum input model\", and the same paper notes \"our quantum SDP solver in Corollary 9 does not assume the sparsity of A_i's, which are crucial for the quantum SDP solvers with the plain model\". The Zoo's own wording (LaTeX rendered into plain text) is: \"quantum algorithms are now known that can approximately solve semidefinite programs to within ± ε in time O(√m log m · poly(log n, r, ε^(-1))), where r is the rank of the semidefinite program. This constitutes a quadratic speedup over the fastest classical algorithms when r is small compared to n\".",
    caveat: "This is a literature record. No semidefinite program was solved here, no circuit was built, compiled, simulated or run, and no instance of C, A_j or b_j was constructed. Every figure above is an asymptotic worst-case bound with no constants, and all three papers state theirs in Õ notation, which van Apeldoorn et al. define as hiding polylogarithmic factors in all parameters, so none of them costs a named SDP instance. The bounds are also not interchangeable, and dropping a parameter changes which regime the speedup exists in. Three drops in particular reverse the reading: the r in Brandão and Svore and in van Apeldoorn et al. is a bound on the size of the optimal dual solution, while the r in Brandão, Kalev, Li, Lin, Svore and Wu and in the Zoo's composite figure is the rank of the constraint matrices; the ε^(-10) and ε^(-12) exponents are stated for a trace-one normalisation whose conversion from a general SDP changes ε to ε/R, so they are not a bound free of the size parameters; and the Zoo's headline runtime is a fully-quantum-input-model bound, not an entry-oracle one. The authors are explicit about where their own speedups do and do not live: van Apeldoorn et al. state that the Brandão-Svore algorithm provides a speed-up only in regimes where R, r, s and 1/ε are fairly small compared to mn, adding that finding good examples of SDPs in such regimes is an open problem, and Brandão et al. say of their own m-and-n-optimal solver that it is nontrivial to obtain quantum speed-ups by directly applying it to SDP instances from classical combinatorial problems, the obstacle being the poly-dependence on 1/ε, since for interesting instances such as Max-Cut 1/ε is linear in n — which is the class of application the problem statement above advertises. The classical side is the fastest algorithms currently known, as the Zoo puts it, not a proven lower bound on classical SDP solving. On the quantum side there are real limits: van Apeldoorn et al. prove that in the worst case the complexity of every quantum LP-solver, and hence of every quantum SDP-solver, has to scale linearly with mn when m is about n, the same as classical, and their section 3, headed \"Downside of this method: general oracles are restrictive\", shows the multiplicative-weights approach fails for families of SDPs with a lot of symmetry. The superpolynomial reading the Zoo mentions belongs only to the fully quantum input model, and the authors who report it warn to be cautious, because that input model is inherently quantum and therefore incomparable to classical SDP solvers. The dequantization is a genuine limit rather than a footnote: Chia, Gilyén, Li, Lin, Tang and Wang solve the same trace-one SDP feasibility problem classically, under sampling and query access to the input matrices, at a cost polylogarithmic in n, and present their framework as compelling evidence that in the corresponding QRAM data structure input model quantum singular value transformation does not yield exponential quantum speedups. That result is scoped to that input model; its stated cost is linear in m where the quantum bounds are √m, and carries exponents up to 22 in the Frobenius-norm bound and up to 46 in 1/ε, so it bounds the asymptotic separation without being a practical classical solver. Finally, the three papers the Zoo cites are not the end of the state of the art: Brandão et al. record that a later independent work of van Apeldoorn and Gilyén improved their entry-oracle bound to Õ(s(√m/ε^4 + √n/ε^5)), in a quantum operator model they call stronger than the plain one, and their quantum-input bound to Õ(B√m/ε^4 + B^3.5/ε^7.5), and Chia et al. call that work the paper with the current best runtime for SDP solving. It lies outside this row's references and outside this record.",
    caveatJa: "本項目は文献に基づく記録です。ここで半正定値計画を解いたことはなく、回路の構成、コンパイル、シミュレーション、実行はいずれも行っておらず、C、A_j、b_j の具体例を構成したわけでもありません。上記の数値はいずれも定数を伴わない漸近的な最悪時の上界であり、三つの論文はどれもそれを Õ 記法で述べています。van Apeldoorn らはこの記法を、すべてのパラメータについて多重対数因子を隠すものと定義しているため、いずれの数値も具体的な半正定値計画の問題例のコストを与えるものではありません。これらの上界は互いに置き換えのきくものでもなく、パラメータを一つ落とすと、高速化が存在する領域そのものが変わります。とくに次の三つの脱落は読みを反転させます。第一に、Brandão と Svore および van Apeldoorn らにおける r は最適な双対解の大きさの上界ですが、Brandão、Kalev、Li、Lin、Svore、Wu および Zoo の合成された数値における r は制約行列のランクです。第二に、ε^(-10) と ε^(-12) という指数はトレース 1 への正規化のもとで述べられており、一般の半正定値計画からこの形式への変換は ε を ε/R に変えるため、これらは大きさのパラメータが消えた上界ではありません。第三に、Zoo が掲げる実行時間は完全に量子的な入力モデルにおける上界であって、成分オラクルモデルのものではありません。著者ら自身は、自分たちの高速化がどこで成り立ちどこで成り立たないかを明示しています。van Apeldoorn らは、Brandão-Svore のアルゴリズムが高速化を与えるのは R、r、s、1/ε が mn と比べてかなり小さい領域に限られると述べ、そのような領域にある半正定値計画の良い例を見つけること自体が未解決問題だと付け加えています。Brandão らも、m と n について最適な自分たちのソルバーについて、古典的な組合せ問題から来る半正定値計画の問題例にそれを直接適用して量子的な高速化を得るのは容易ではないと述べており、障害は 1/ε への多項式依存であって、Max-Cut のような興味深い問題例では 1/ε が n について線形になるからだとしています。これは、上記の問題文が応用として挙げている種類の問題そのものです。古典側は、Zoo の言い方では現在知られている最速のアルゴリズムであって、古典的に半正定値計画を解くことについて証明された下界ではありません。量子側にも実際の限界があります。van Apeldoorn らは、最悪の場合、あらゆる量子線形計画ソルバー、したがってあらゆる量子半正定値計画ソルバーの計算量が、m が n と同程度のとき古典と同じく mn について線形にスケールせざるをえないことを証明しており、「Downside of this method: general oracles are restrictive」と題された同論文の第 3 節では、乗法的重みに基づくこの手法が、対称性の高い半正定値計画の族に対しては機能しないことを示しています。Zoo が触れている超多項式的という読みは、完全に量子的な入力モデルにのみ属するものであり、それを報告した著者ら自身が、この入力モデルは本質的に量子的であって古典の半正定値計画ソルバーとは比較できないため慎重であるべきだと注意しています。古典化は脚注ではなく本物の限界です。Chia、Gilyén、Li、Lin、Tang、Wang は、同じトレース 1 の半正定値計画の実行可能性問題を、入力行列へのサンプリングアクセスとクエリアクセスのもとで、n について多重対数的なコストで古典的に解いており、自分たちの枠組みは、対応する QRAM データ構造の入力モデルのもとで量子特異値変換が指数的な量子高速化をもたらさないことを示す有力な証拠だと述べています。この結果はその入力モデルに限定されたものです。示されているコストは、量子側の上界が √m であるところで m について線形であり、Frobenius ノルムの上界について最大 22、1/ε について最大 46 という指数を伴うため、漸近的な分離を抑えてはいても実用的な古典ソルバーではありません。最後に、Zoo が引く三つの論文は最先端の終点ではありません。Brandão らは、後の独立した研究である van Apeldoorn と Gilyén の仕事が、成分オラクルの上界を、素朴なモデルより強いと彼らが呼ぶ量子作用素モデルのもとで Õ(s(√m/ε^4 + √n/ε^5)) に改善し、量子入力の上界を Õ(B√m/ε^4 + B^3.5/ε^7.5) に改善したと記録しており、Chia らはその研究を、半正定値計画を解く現在最良の実行時間を持つ論文と呼んでいます。この研究は本項目が扱う Zoo の行の参照文献の外にあり、本記録の対象外です。",
    tags: ["semidefinite programming", "convex optimization", "matrix multiplicative weights", "gibbs sampling", "dequantization"],
    source: {
      id: "arxiv:1609.05537",
      title: "Quantum Speed-ups for Semidefinite Programming",
      authors: "Fernando G. S. L. Brandao, Krysta Svore",
      year: "2016",
      url: "https://arxiv.org/abs/1609.05537",
    },
    literature: [
      {
        title: "Quantum SDP-Solvers: Better upper and lower bounds",
        authors: "Joran van Apeldoorn, András Gilyén, Sander Gribling, Ronald de Wolf",
        year: "2017",
        url: "https://arxiv.org/abs/1705.01843",
        relevance: "One of the two improvements the Zoo cites, and the paper that states the limits of the approach most sharply. It improves the Brandão-Svore dependence on R, r and 1/ε to Õ(√(mn) s^2 (Rr/ε)^8) while keeping the same dependence on m, n and s, using a purified Gibbs sampler with logarithmic error-dependence and a generalized minimum-finding procedure; for linear programs it reports Õ(√(mn) (Rr/ε)^5). Consult it for four things this record depends on: the definitions of R and r as bounds on the trace of an optimal primal solution and on the sum of entries of an optimal dual solution; its restatement of the Brandão-Svore figure Õ(√(mn) s^2 R^32/δ^18) as holding with multiplicative error for the special case b_j ≥ 1 and OPT ≥ 1, with the reduction to that case significantly worsening the dependence on R, r and δ; the worst-case lower bound showing every quantum LP-solver and hence every quantum SDP-solver has to scale linearly with mn when m is about n; and its section 3, which shows that this approach fails for families of SDPs with a lot of symmetry.",
        relevanceJa: "Zoo が挙げる二つの改良のうちの一つであり、この手法の限界を最も鋭く述べている論文です。誤差への依存が対数的な純粋化 Gibbs サンプラーと、一般化された最小値探索の手続きを用いて、m、n、s への依存は同じままに、Brandão-Svore の R、r、1/ε への依存を Õ(√(mn) s^2 (Rr/ε)^8) へ改善しており、線形計画については Õ(√(mn) (Rr/ε)^5) を報告しています。本記録が依拠している点は四つあり、いずれも原論文で確認してください。第一に、R と r がそれぞれ最適な主解のトレースの上界と、最適な双対解の成分の総和の上界として定義されていることです。第二に、Brandão-Svore の数値 Õ(√(mn) s^2 R^32/δ^18) が、b_j ≥ 1 かつ OPT ≥ 1 という特別な場合について乗法的な誤差のもとで成り立つものだと言い換えられており、その場合への帰着が R、r、δ への依存を大きく悪化させると述べられていることです。第三に、m が n と同程度のとき、あらゆる量子線形計画ソルバー、したがってあらゆる量子半正定値計画ソルバーが mn について線形にスケールせざるをえないことを示す最悪時の下界です。第四に、この手法が対称性の高い半正定値計画の族に対しては機能しないことを示す第 3 節です。",
      },
      {
        title: "Quantum SDP Solvers: Large Speed-ups, Optimality, and Applications to Quantum Learning",
        authors: "Fernando G. S. L. Brandão, Amir Kalev, Tongyang Li, Cedric Yen-Yu Lin, Krysta M. Svore, Xiaodi Wu",
        year: "2017",
        url: "https://arxiv.org/abs/1710.02581",
        relevance: "The other improvement the Zoo cites, and the source of the Zoo's own headline runtime. It gives two solvers for SDP instances with m constraint matrices of dimension n, rank at most r and sparsity s, both stated for its normalised feasibility problem with tr(X) = 1: one in the entry-oracle model at Õ(s^2(√m ε^(-10) + √n ε^(-12))), which the authors call an optimal dependence in terms of m and n and a quadratic improvement over previous quantum algorithms when m is about n, and one in a fully quantum input model where the matrices are given as quantum states, at Õ(√m + poly(r)) · poly(log m, log n, B, ε^(-1)) with B a bound on the trace norm of all input matrices. Read its section 1 before quoting either: converting a general primal with tr(X) ≤ R into the trace-one form changes ε to ε/R, and to ε divided by R times the dual bound for a strictly feasible solution, which is the substitution the same section applies when it restates Brandão and Svore's cost as Õ(√(mn) s^2 (R R-tilde/ε)^32). Its main technical contribution is a quantum Gibbs state sampler for low-rank Hamiltonians given quantum states encoding those Hamiltonians, with a poly-logarithmic dependence on dimension — the PDF abstract carries the \"given quantum states\" qualifier that the arXiv metadata abstract drops. Consult it also for Remark D.7, which is where the Zoo's O(√m log m · poly(log n, r, ε^(-1))) comes from, under the quantum-input oracles with B collapsed to r by the eigen-decomposition; for Remark 1.5, where the authors warn that the poly-dependence on 1/ε makes it nontrivial to get speed-ups on combinatorial SDPs such as Max-Cut; and for the input-model caution the Zoo's superpolynomial remark rests on, that the poly-logarithmic dependence on n suggests exponential speed-ups for some SDP instances but that one has to be cautious because the input model is inherently quantum and so incomparable to classical SDP solvers.",
        relevanceJa: "Zoo が挙げるもう一つの改良であり、Zoo が掲げる実行時間の出典でもあります。次元 n、ランク高々 r、疎性 s の制約行列 m 個からなる半正定値計画の問題例に対して二つのソルバーを与えており、いずれも tr(X) = 1 に正規化された実行可能性問題について述べられています。一つは成分オラクルモデルでの Õ(s^2(√m ε^(-10) + √n ε^(-12))) であり、著者らはこれを m と n に関して最適な依存であり、m が n と同程度のときには従来の量子アルゴリズムに対する二次的な改善だと呼んでいます。もう一つは、行列が量子状態として与えられる完全に量子的な入力モデルでの Õ(√m + poly(r)) · poly(log m, log n, B, ε^(-1)) であり、B はすべての入力行列のトレースノルムの上界です。どちらを引用する場合も、まず同論文の第 1 節を読んでください。tr(X) ≤ R を満たす一般の主問題をトレース 1 の形式に変換すると ε は ε/R に変わり、狭義に実行可能な解を求める場合には ε を R と双対側の上界の積で割ったものに変わります。同じ節は、この置き換えを適用したうえで Brandão と Svore のコストを Õ(√(mn) s^2 (R R-tilde/ε)^32) と言い換えています。主要な技術的貢献は、低ランクの Hamiltonian を符号化した量子状態が与えられたときの、次元への依存が多重対数的な量子 Gibbs 状態サンプラーです。PDF の要旨には「given quantum states」という限定が付いていますが、arXiv のメタデータの要旨ではそれが落ちています。あわせて次の三点も原論文で確認してください。Zoo の O(√m log m · poly(log n, r, ε^(-1))) の出どころである注意 D.7 で、量子入力のオラクルのもとで、固有値分解によって B が r に収まる場合の主張です。1/ε への多項式依存のために、Max-Cut のような組合せ的な半正定値計画で高速化を得るのが容易でないと著者らが警告している注意 1.5 です。そして、Zoo の超多項式的という記述が拠っている入力モデルについての但し書き、すなわち、n への多重対数的な依存はいくつかの半正定値計画の問題例について指数的な高速化を示唆するものの、この入力モデルは本質的に量子的であって古典の半正定値計画ソルバーとは比較できないため慎重であるべきだ、という記述です。",
      },
      {
        title: "Quantum algorithms for Gibbs sampling and hitting-time estimation",
        authors: "Anirban Narayan Chowdhury, Rolando D. Somma",
        year: "2016",
        url: "https://arxiv.org/abs/1603.02940",
        relevance: "One of the two Gibbs-sampling references the Zoo names as the ingredient this solver is built on. Its first algorithm prepares the thermal Gibbs state of a quantum system in time almost linear in √(N β / Z) and polynomial in log(1/ε), with N the Hilbert space dimension, β the inverse temperature, Z the partition function and ε the precision of the output state, which the abstract describes as an exponential improvement in the dependence on 1/ε and a quadratic improvement in the dependence on β over known quantum algorithms for the problem. Van Apeldoorn et al. note that this sampler assumes query access to the entries of the square root of the Hamiltonian rather than to the Hamiltonian itself, which is why their own solver does not simply adopt it.",
        relevanceJa: "このソルバーが土台とする構成要素として Zoo が挙げる二つの Gibbs サンプリングの文献のうちの一つです。第一のアルゴリズムは、量子系の熱的 Gibbs 状態を、√(N β / Z) についてほぼ線形、log(1/ε) について多項式の時間で準備します。ここで N は Hilbert 空間の次元、β は逆温度、Z は分配関数、ε は出力状態の精度です。要旨はこれを、この問題に対する既知の量子アルゴリズムと比べて、1/ε への依存については指数的な改善、β への依存については二次的な改善だと述べています。van Apeldoorn らは、このサンプラーが Hamiltonian そのものではなくその平方根の成分へのクエリアクセスを仮定していることを指摘しており、それが、彼ら自身のソルバーがこれをそのまま採用しない理由です。",
      },
      {
        title: "Sampling-based sublinear low-rank matrix arithmetic framework for dequantizing quantum machine learning",
        authors: "Nai-Hui Chia, András Gilyén, Tongyang Li, Han-Hsuan Lin, Ewin Tang, Chunhao Wang",
        year: "2019",
        url: "https://arxiv.org/abs/1910.06151",
        relevance: "The dequantization result the Zoo cites as delineating where a superpolynomial speedup is possible. Its Problem 6.24 is the same trace-one SDP feasibility problem Brandão, Kalev et al. solve, and its Corollary 6.25 solves it classically, given sampling and query access to the constraint matrices, at a cost polylogarithmic in n; the authors state their algorithm both solves a more general problem than the previous quantum-inspired SDP solver and greatly improves its runtime. Consult it for the scope of the claim: the framework is presented as compelling evidence that in the corresponding QRAM data structure input model quantum singular value transformation does not yield exponential quantum speedups, and the stated SDP cost is linear in m and carries exponents up to 22 in the Frobenius-norm bound F and up to 46 in 1/ε. Its section 6.8 also names van Apeldoorn and Gilyén, not any of the Zoo's three references, as the paper with the current best runtime for SDP solving.",
        relevanceJa: "超多項式的な高速化がどこで可能かを画定するものとして Zoo が引く古典化の結果です。その問題 6.24 は Brandão、Kalev らが解くのと同じトレース 1 の半正定値計画の実行可能性問題であり、系 6.25 は、制約行列へのサンプリングアクセスとクエリアクセスが与えられたもとで、これを n について多重対数的なコストで古典的に解いています。著者らは、自分たちのアルゴリズムが従来の量子に着想を得た半正定値計画ソルバーより一般の問題を解き、かつその実行時間を大きく改善すると述べています。主張の適用範囲は原論文で確認してください。この枠組みは、対応する QRAM データ構造の入力モデルのもとで量子特異値変換が指数的な量子高速化をもたらさないことを示す有力な証拠として提示されており、示されている半正定値計画のコストは m について線形で、Frobenius ノルムの上界 F について最大 22、1/ε について最大 46 の指数を伴います。また同論文の 6.8 節は、半正定値計画を解く現在最良の実行時間を持つ論文として、Zoo の三つの参照文献のいずれでもなく van Apeldoorn と Gilyén を挙げています。",
      },
    ],
    relatedSlugs: ["gibbs-state-sampling", "amplitude-amplification", "grover-unstructured-search", "quantum-singular-value-transformation"],
  },
  {
    slug: "tensor-principal-component-analysis",
    title: "Tensor principal component analysis for the spiked tensor model",
    titleJa: "スパイクテンソルモデルに対するテンソル主成分分析",
    family: "Statistical inference · spiked tensor",
    zooName: "Tensor Principal Component Analysis",
    zooSection: "Optimization, Numerics, and Machine Learning",
    speedup: "Polynomial (quartic)",
    speedupPrimary: { states: "reported", quote: "The quantum algorithm achieves a quartic speedup while using exponentially smaller space than the fastest classical spectral algorithm, and a super-polynomial speedup over classical algorithms that use only polynomial space." },
    problem: "In the spiked tensor model, an unknown signal vector v_sig in R^N of magnitude √N is hidden inside a p-th order tensor T0 = λ v_sig^⊗p + G, where G is noise whose entries are chosen independently from a Gaussian distribution of zero mean and unit variance and λ is a scalar representing a signal-to-noise ratio; the task called recovery is to infer v_sig to some accuracy given T0, and the simpler task called detection is to distinguish the case λ = 0 from λ = λ̄ for some λ̄ > 0, again just given T0. The paper treats the symmetrized and non-symmetrized cases as reducible to each other, and says that for odd p it is convenient in the analysis not to symmetrize T0 and to take complex G. Recovery is information-theoretically possible for λ much larger than N^((1-p)/2), but no polynomial-time algorithm is known that achieves that performance; the two best known algorithms are spectral and sum-of-squares, and for even p the spectral method works for λ much larger than N^(-p/4), with a variant conjectured to perform similarly for odd p. The regime this record is about is the hard one at and below that spectral threshold: write λ = α N^(-p/4), and the question is what recovery costs as α shrinks.",
    problemJa: "スパイクテンソルモデルでは、大きさ √N の未知の信号ベクトル v_sig ∈ R^N が、p 階のテンソル T0 = λ v_sig^⊗p + G の中に隠されています。ここで G は雑音であり、その各成分は平均 0、分散 1 の Gauss 分布から独立に選ばれ、λ は信号対雑音比を表すスカラーです。復元と呼ばれる課題は、T0 が与えられたときに v_sig をある精度で推定することであり、より易しい検出と呼ばれる課題は、同じく T0 だけが与えられたときに λ = 0 の場合と、ある λ̄ > 0 についての λ = λ̄ の場合とを区別することです。論文は、対称化した場合としない場合は互いに帰着できるものとして扱い、奇数の p については解析上 T0 を対称化せず G を複素にとるのが便利だと述べています。復元は λ が N^((1-p)/2) よりはるかに大きければ情報理論的には可能ですが、その性能を達成する多項式時間アルゴリズムは知られていません。知られている中で最良のアルゴリズムはスペクトル法と sum-of-squares 法の 2 つであり、偶数の p についてはスペクトル法が λ が N^(-p/4) よりはるかに大きい場合に機能し、奇数の p についても同様に働くと予想されている変種があります。本項目が対象とするのは、このスペクトル法の閾値上およびそれ以下という困難な領域です。λ = α N^(-p/4) と書いたとき、α が小さくなるにつれて復元にどれだけのコストがかかるのか、というのがここでの問いになります。",
    idea: "Hastings turns the spiked-tensor problem into a many-body eigenvector problem. The tensor T0 defines a Hamiltonian H(T0) on some number nbos of qudits of dimension N, restricted to their symmetric subspace so that the nbos qudits behave as bosons, and mean-field theory suggests that for large nbos the leading eigenvector can be approximated by a product state; the paper proves that for this statistical model the mean-field approximation becomes accurate with high probability at much smaller nbos than the bounds for arbitrary pairwise Hamiltonians would require. It is careful about what that buys. It does not prove that the nbos-fold tensor product of the single-particle state built from v_sig approximates the leading eigenvector, only that it is a good approximation to some state in an eigenspace with large eigenvalue, and section 5 opens by emphasizing that it is not necessary to find the leading eigenvector itself. Theorems 3 and 5, for even and odd p, then show that any state whose energy exceeds (1 + c′) Emax has, with high probability, a single-particle density matrix whose normalized overlap with v_sig is at least (c′ − o(1)) Emax/E0, so recovery reduces to producing some vector in the eigenspace above the cut. Classically that is the power method on a vector of dimension D(N, nbos), the dimension of the symmetric subspace, which the paper approximates by N^nbos / nbos! and which costs time and space of that order. The quantum algorithm instead phase estimates with H(T0) on a prepared input state and keeps the run only when the eigenvalue lands above the cut: a random input succeeds with probability very close to 1/D(N, nbos), so the plain version buys nothing over classical, amplitude amplification takes the expected time down to D(N, nbos)^(1/2), and a second idea — using the tensor T0 itself to prepare an input state with larger projection onto the target eigenvector — gives a further quadratic speedup, D(N, nbos)^(1/4), which is the quartic. Raising nbos buys recovery at smaller λ at exponentially higher cost, and the abstract sums up the classical side as algorithms with an improved threshold for recovery that work for both even and odd order tensors.",
    ideaJa: "Hastings はスパイクテンソルの問題を多体系の固有ベクトル問題へ置き換えます。テンソル T0 は、次元 N の qudit を nbos 個並べた系の上のハミルトニアン H(T0) を定めます。系はその対称部分空間に制限され、nbos 個の qudit はボゾンとして振る舞います。平均場理論からは、nbos が大きければ主固有ベクトルを積状態で近似できることが示唆されます。論文は、この統計モデルにおいては、任意の 2 体ハミルトニアンに対する評価が要求するよりもはるかに小さい nbos で平均場近似が高い確率で正確になることを証明しています。論文は、そこから何が得られるのかについて慎重です。v_sig から作られる 1 粒子状態の nbos 重テンソル積が主固有ベクトルを近似することは証明しておらず、大きな固有値をもつ固有空間内のある状態のよい近似であることを示すにとどめており、第5節の冒頭では、主固有ベクトルそのものを求める必要はないと強調しています。そのうえで、偶数の p に対する定理3と奇数の p に対する定理5は、エネルギーが (1 + c′) Emax を超える任意の状態について、その 1 粒子密度行列と v_sig との規格化された重なりが高い確率で (c′ − o(1)) Emax/E0 以上になることを示します。したがって復元は、この境目より上の固有空間に属する何らかのベクトルを作り出すことに帰着します。古典的には、これは次元 D(N, nbos) のベクトルに対するべき乗法になります。D(N, nbos) は対称部分空間の次元であり、論文はこれを N^nbos / nbos! で近似しています。時間も空間もその程度必要になります。量子アルゴリズムはこれに代えて、用意した入力状態に対して H(T0) による位相推定を行い、固有値が境目より上に来た試行だけを採用します。無作為な入力が成功する確率は 1/D(N, nbos) にきわめて近いため、素朴な版では古典に対して何も得られません。振幅増幅を用いると期待時間は D(N, nbos)^(1/2) まで下がり、さらにもう一つの工夫、すなわちテンソル T0 自身を使って目標の固有ベクトルへの射影がより大きい入力状態を用意する工夫によって、もう一段の二乗の高速化が得られ D(N, nbos)^(1/4) となります。これが quartic にあたります。nbos を大きくすれば、より小さい λ でも復元できるようになりますが、そのコストは指数関数的に高くなります。要旨は古典側について、復元の閾値を改善し、偶数階と奇数階の双方のテンソルで機能するアルゴリズムだとまとめています。",
    complexity: "Both sides of the comparison are indexed by nbos, and the object whose size sets the cost is D(N, nbos), the dimension of the symmetric subspace of nbos qudits of dimension N, which the paper approximates by N^nbos / nbos! for N much greater than nbos; Emax is its high-probability bound on the largest eigenvalue of the noise Hamiltonian H(G) and E0 the signal energy scale, with the algorithms analysed for E0 at least (1 + c) Emax. Classically, one iteration of the power method on H(T0) takes time Õ(D(N, nbos)) in space Õ(D(N, nbos)), and O(log(D(N, nbos)) / log(E0/Emax)) iterations suffice for detection and recovery, so the paper's total is Õ(D(N, nbos))O(1 / log(E0/Emax)) with space exponential in nbos. Theorem 6 bounds the quantum algorithm's expected runtime by poly(N, nbos, 1/(E0 − Emax), log(D(N, nbos)/ε)) exp(O(nbos)) log(N)^(4 nbos) (N^(-p/4)/λ)^(nbos/p) D(N, nbos)^(1/4); the intermediate versions of the same algorithm cost D(N, nbos) and D(N, nbos)^(1/2) times that same poly factor, with plain phase estimation and with amplitude amplification respectively. The polynomial-space claim is not part of theorem 6: it is section 5.2's statement that, in contrast to the classical algorithms above, all these quantum algorithms take only polynomial space. The quartic is a statement about exponents in a stated limit — the log of the quantum runtime divided by the log of the classical runtime approaches 1/4 as N → ∞ at fixed N^(-p/4)/λ, that is, at fixed α. The regime is Assumption 1 together with the paper's standing assumption on λ: nbos = O(N^θ) for a p-dependent constant θ > 0 chosen sufficiently small, λ = Ω(N^(-θ′)) for a p-dependent constant θ′ > p/4, and λ = O(N^(-p/4)) — above that last bound the paper says simple spectral methods already succeed. Below the threshold the price is paid in nbos, which the paper states increases polynomially in λ^(-1) as polylog(N)(N^(-p/4)/λ)^(4/(p-2)) while the runtime increases exponentially. The Zoo's own form for the classical cost, exponential in α^(-1), is the one the paper gives for the sum-of-squares sequence and for the Kikuchi-hierarchy spectral algorithms of Wein, El Alaoui and Moore, not for Hastings's own nbos ladder, whose exponent 4/(p-2) equals 1 only at p = 6.",
    complexityBasis: "Abstract of arXiv:1907.12724, read off the arXiv abs page: \"The quantum algorithm achieves a quartic speedup while using exponentially smaller space than the fastest classical spectral algorithm, and a super-polynomial speedup over classical algorithms that use only polynomial space.\" What \"quartic\" is defined to mean is in section 1.2 of the same paper: \"The runtime bound for the fastest quantum algorithm is in theorem 6. This theorem gives a quartic improvement in the runtime compared to the fastest classical spectral algorithm; more precisely the log of the runtime with the quantum algorithm divided by the log of the runtime of the classical algorithm approaches 1/4 as N → ∞ at fixed N^(-p/4)/λ.\" Theorem 6: \"Let Assumption 1 hold. For E0 ≥ Emax · (1 + c), for any c > 0, with high probability, the expected runtime of the algorithm is at most poly(N, nbos, 1/(E0 − Emax, log(D(N, nbos)/ε)) exp(O(nbos)) log(N)^(4 nbos) (N^(-p/4)/λ)^(nbos/p) D(N, nbos)^(1/4).\" (The unbalanced bracket after 1/(E0 − Emax is the source's own and is reproduced here as printed rather than repaired; subscripts and superscripts are flattened by pdftotext and restored, and the ε was checked against the ar5iv MathML of the same theorem, which spells that symbol out as epsilon inside the same expression.) Classical side, section 5.1: \"The space required is then only Õ(D(N, nbos)). The time required for a single iteration of the power method is Õ(D(N, nbos))\", and \"So, the time is Õ(D(N, nbos))O(1/ log(E0/Emax))\". Polynomial space is claimed in section 5.2, not in theorem 6: \"In contrast to the classical algorithms above, all these algorithms take only polynomial space.\" Intermediate quantum bounds, section 5.2.1: \"with high probability the time for phase estimation is poly(N, nbos, 1/(E0 − Emax), log(D(N, nbos)/ε)), giving an algorithm runtime D(N, nbos) poly(N, nbos, 1/(E0 − Emax), log(D(N, nbos)/ε))\", and \"applying amplitude amplification, with high probability the algorithm succeeds in expected time D(N, nbos)^(1/2) poly(N, nbos, 1/(E0 − Emax), log(D(N, nbos)/ε))\". Regime, Assumption 1 in section 1.1: \"We assume that nbos = O(N^θ) for some p-dependent constant θ > 0 chosen sufficiently small. We will also assume that λ is Ω(N^(-θ′)) for some p-dependent constant θ′ > p/4.\", followed by \"Finally, we assume that λ = O(N^(-p/4)). Remark: there is of course no reason to consider λ larger than this since simple spectral methods succeed if λ is ω(N^(-p/4))\". Cost of dropping below the threshold, section 1: \"the required nbos increases polynomially in λ^(-1) as polylog(N)(N^(-p/4)/λ)^(4/(p-2)), but the runtime increases exponentially.\" The exponential-in-α^(-1) form belongs to different algorithms, same section: \"The sum-of-squares method [4, 5] for this problem gives rise to a sequence of algorithms [6, 7], in which one can recover at λ smaller than N^(-p/4) at the cost of runtime and space increasing exponentially in polylog(N)N^(-p/4)/λ. In Ref. [1], a sequence of spectral algorithms with similar performance was shown.\" Symmetric-subspace dimension, section 3.1: \"For N ≫ nbos, we can approximate D(N, nbos) ≈ N^nbos/nbos!\". Recovery guarantee, theorem 3 (even p) and the word-for-word identical theorem 5 (odd p): \"Given any vector Ψ such that ⟨Ψ|H(T0)|Ψ⟩ ≥ (1 + c′)Emax for any scalar c′ > 0, then with high probability the corresponding single particle density matrix ρ1 obeys ⟨vsig|ρ1|vsig⟩ / N ≥ (c′ − o(1)) Emax/E0.\" The Zoo entry \"Tensor Principal Component Analysis\" does its own arithmetic on the same quantities: \"Consider λ = α N^(-p/4). The best classical algorithms succeed when α ≫ 1 and have time and space complexity that scale exponentially in α^(-1). The quantum algorithm of [424] solves this problem in polynomial space and with runtime scaling quartically better in α^(-1) than the classical spectral algorithm.\"",
    caveat: "This is a literature record: nothing was built, compiled, simulated, or run here, and no spiked tensor was recovered. The quartic is an exponent, not a factor on a wall clock — it is defined as the log of the quantum runtime divided by the log of the classical runtime tending to 1/4, taken at fixed N^(-p/4)/λ as N grows, and both runtimes are exponential in nbos, so the exp(O(nbos)), log(N)^(4 nbos) and poly(N, nbos, 1/(E0 − Emax), log(D(N, nbos)/ε)) factors that theorem 6 leaves unnamed are bounded nowhere in this record. The regime is narrow on both sides: for λ = ω(N^(-p/4)) the paper says simple spectral methods already succeed, so there is nothing to speed up, while below the threshold the required nbos increases as polylog(N)(N^(-p/4)/λ)^(4/(p-2)) and the runtime increases exponentially in it, so a quartic exponent improvement is being applied to a quantity that is itself blowing up. The Zoo's statement that the best classical algorithms have time and space complexity scaling exponentially in α^(-1) is the paper's form for the sum-of-squares sequence and for the spectral sequence of Wein, El Alaoui and Moore, and is not the same expression as the paper's own polylog(N)(N^(-p/4)/λ)^(4/(p-2)); the two coincide only at p = 6. The classical baseline is what standard algorithms achieve, not a lower bound — Hastings writes that the classical time and space requirements \"are of course not intended to represent a lower bound\" — and the comparison is only against spectral methods: the paper states that it is \"not able to make an accurate comparison of the runtime to sum-of-squares methods\" and that it expects many of these estimates of thresholds to be off by a polylogarithmic factor. The noise is Gaussian, the symmetrized and non-symmetrized cases are treated as reducible to each other, and for odd p the analysis takes T0 unsymmetrized with complex G; the paper also notes that some of the best sum-of-squares results are for a different, biased distribution on entries drawn from minus one and plus one, which it avoids treating. The proven runtime bound belongs to the modified algorithm behind theorem 6; for the earlier amplified algorithm 6 the paper gives \"heuristic evidence (not a proof)\" and records only a conjecture that it too has a quartic speedup. Nothing here is a gate count, a qubit count, an error-correction budget, or a statement about hardware; the algorithm assumes controlled simulation of H(T0) and Kitaev-style phase estimation as black boxes costed by citation, and the paper reports no numerics of its own.",
    caveatJa: "本項目は文献に基づく記録です。ここで何かを構成・コンパイル・シミュレート・実行したことはなく、具体的なスパイクテンソルを復元したこともありません。quartic は指数についての主張であって、実時間に掛かる因子ではありません。これは、N^(-p/4)/λ を固定したまま N を大きくしたときに、量子アルゴリズムの実行時間の対数を古典アルゴリズムの実行時間の対数で割った値が 1/4 に近づく、という形で定義されています。どちらの実行時間も nbos について指数関数的であり、定理6が具体的な形を与えていない exp(O(nbos))、log(N)^(4 nbos)、poly(N, nbos, 1/(E0 − Emax), log(D(N, nbos)/ε)) といった因子については、本記録はどこにも上界を与えていません。対象となる領域は両側から狭められています。λ = ω(N^(-p/4)) の場合、論文は単純なスペクトル法で既に成功すると述べており、高速化すべきものがありません。一方で閾値より下では、必要な nbos が polylog(N)(N^(-p/4)/λ)^(4/(p-2)) のように増え、実行時間はそれについて指数関数的に増えます。つまり、指数についての quartic の改善は、それ自体が急激に膨らんでいく量に対して適用されていることになります。最良の古典アルゴリズムは時間計算量も空間計算量も α^(-1) について指数関数的にスケールする、という Zoo の記述は、論文が sum-of-squares の系列と Wein、El Alaoui、Moore のスペクトル法の系列について述べている形であって、論文自身の polylog(N)(N^(-p/4)/λ)^(4/(p-2)) と同じ式ではありません。両者が一致するのは p = 6 のときだけです。古典側の基準は標準的なアルゴリズムが達成する値であって、下界ではありません。Hastings は古典側の時間と空間の要件について「are of course not intended to represent a lower bound」と書いています。また比較の対象はスペクトル法だけです。論文は「not able to make an accurate comparison of the runtime to sum-of-squares methods」と述べ、さらに、これらの閾値の見積もりの多くは多対数因子の分だけずれていると予想されるとも述べています。雑音は Gauss 分布であり、対称化した場合としない場合は互いに帰着できるものとして扱われ、奇数の p については T0 を対称化せず G を複素にとって解析されています。また論文は、最良の sum-of-squares の結果の一部は、成分が −1 と +1 から取られる、これとは異なる偏った分布についてのものであり、その場合は扱わないと注記しています。証明されている実行時間の評価は、定理6の背後にある修正版のアルゴリズムに対するものです。それ以前の、振幅増幅を用いた algorithm 6 については、論文は「heuristic evidence (not a proof)」を与えるにとどめ、これにも quartic の高速化があるという予想を記しているだけです。ここにはゲート数も量子ビット数も誤り訂正の見積もりもなく、ハードウェアについての主張も含まれていません。アルゴリズムは、H(T0) の制御付きシミュレーションと Kitaev 流の位相推定を、引用によってコストが与えられるブラックボックスとして前提しており、論文自身は数値実験を報告していません。",
    tags: ["tensor pca", "spiked tensor", "signal recovery", "spectral algorithm", "phase estimation", "amplitude amplification"],
    source: {
      id: "arxiv:1907.12724",
      title: "Classical and Quantum Algorithms for Tensor Principal Component Analysis",
      authors: "M. B. Hastings",
      year: "2019",
      url: "https://arxiv.org/abs/1907.12724",
    },
    literature: [
      {
        title: "Classical and Quantum Algorithms for Tensor Principal Component Analysis",
        authors: "M. B. Hastings",
        year: "2019",
        url: "https://arxiv.org/abs/1907.12724",
        relevance: "Primary source. It gives the spectral algorithm, the mean-field Hamiltonian H(T0) that encodes the tensor, recovery guarantees for even p in theorem 3 and for odd p in theorem 5, and the runtime bound in theorem 6 whose exponent is the quartic the Zoo's class quotes. Consult it for what Assumption 1 restricts, for the definition of the quartic as a ratio of logarithms at fixed N^(-p/4)/λ, for the prefactors theorem 6 leaves as poly and exp(O(nbos)), and for section 5's own emphasis that it is not necessary to find the leading eigenvector itself — the paper explicitly declines to prove that the mean-field product state approximates that eigenvector.",
        relevanceJa: "一次資料です。スペクトル法のアルゴリズム、テンソルを符号化する平均場のハミルトニアン H(T0)、偶数の p に対する定理3と奇数の p に対する定理5の復元の保証、および Zoo の区分が引く quartic という指数をもつ定理6の実行時間の評価が、いずれもこの論文にあります。Assumption 1 が何を制限しているのか、N^(-p/4)/λ を固定したときの対数の比として quartic がどう定義されているのか、定理6が poly と exp(O(nbos)) のまま残している前因子が何か、そして第5節が主固有ベクトルそのものを求める必要はないと自ら強調している点については、原論文で確認してください。論文は、平均場の積状態がその固有ベクトルを近似することの証明を明示的に控えています。",
      },
      {
        title: "The Kikuchi Hierarchy and Tensor PCA",
        authors: "Alexander S. Wein, Ahmed El Alaoui, Cristopher Moore",
        year: "2019",
        url: "https://arxiv.org/abs/1904.03858",
        relevance: "The classical work Hastings's spectral algorithm is closest to and whose normalization he adopts; his abstract describes his classical algorithms as related to, but slightly different from those presented recently in it, with an improved threshold for recovery and coverage of both even and odd order tensors. His remark that no guarantees were given there for odd p is version-scoped: the April 2019 version's abstract states that its results hold for even-order tensors and conjectures that they also hold for odd-order tensors, while the revision now served at this link states that the results apply to tensor PCA for tensors of all orders, and Hastings did not update the remark. Consult it for the classical side of the runtime-versus-statistical-power tradeoff the quantum bound is measured against — its abstract describes a hierarchy of increasingly powerful algorithms with increasing runtime, based on the Kikuchi Hessian, that matches the performance of sum-of-squares in polynomial time and yields a continuum of subexponential-time algorithms.",
        relevanceJa: "Hastings のスペクトル法に最も近い古典側の研究であり、規格化の取り方も彼はこの論文に合わせています。彼の要旨は、自身の古典アルゴリズムをこの論文で最近示されたものと関連するがわずかに異なるものと述べ、復元の閾値が改善されていること、偶数階と奇数階の双方のテンソルを扱えることを挙げています。奇数の p について保証が与えられていないという彼の注記は、参照した版に限った話です。2019年4月の版の要旨は、結果が偶数階のテンソルについて成り立つと述べ、奇数階のテンソルについても成り立つと予想していますが、現在このリンクで配信されている改訂版は、結果があらゆる階数のテンソルの tensor PCA に適用されると述べており、Hastings はこの注記を更新していません。量子側の評価が比較される、実行時間と統計的な能力のトレードオフの古典側については、原論文で確認してください。その要旨は、Kikuchi Hessian に基づき、実行時間の増加とともに能力が増していくアルゴリズムの階層を述べており、この階層は多項式時間で sum-of-squares の性能に一致し、劣指数時間のアルゴリズムの連続体を与えます。",
      },
      {
        title: "A statistical model for tensor PCA",
        authors: "Andrea Montanari, Emile Richard",
        year: "2014",
        url: "https://arxiv.org/abs/1411.1076",
        relevance: "Where the spiked tensor model this record states comes from: Hastings cites it as the paper that introduced this statistical model, which it terms the spiked tensor problem, and as where spectral algorithms for it were first suggested. Its abstract uses information theory to establish necessary and sufficient conditions under which the principal component can be estimated using unbounded computational resources, and then analyses polynomial-time estimation algorithms based on tensor unfolding, power iteration and message passing, showing that unless the signal-to-noise ratio diverges in the system dimensions none of those approaches succeeds. Consult it for the information-theoretic threshold that the algorithmic thresholds quoted here fall short of.",
        relevanceJa: "本記録が述べるスパイクテンソルモデルの出どころです。Hastings は、この統計モデルを導入し spiked tensor problem と名付けた論文として、またそれに対するスペクトル法が最初に提案された場所として、この論文を引用しています。その要旨は、計算資源に制限を設けない場合に主成分を推定できるための必要十分条件を情報理論によって定め、続いてテンソルのアンフォールディング、べき乗法、メッセージパッシングに基づく多項式時間の推定アルゴリズムを解析し、信号対雑音比が系の次元に対して発散するのでないかぎり、いずれの手法も成功しないことを示しています。ここで引いた各アルゴリズムの閾値が届いていない情報理論的な閾値については、原論文で確認してください。",
      },
    ],
    relatedSlugs: ["quantum-phase-estimation", "amplitude-amplification", "top-eigenvector-estimation", "spectral-sum-estimation"],
  },
  {
    slug: "abelian-hidden-subgroup",
    title: "The Abelian hidden subgroup problem",
    titleJa: "可換隠れ部分群問題",
    family: "Quantum query algorithm",
    zooName: "Abelian Hidden Subgroup",
    zooSection: "Oracular Algorithms",
    speedup: "Superpolynomial",
    speedupPrimary: { states: "absent", read: "the full text of Boneh and Lipton's 14-page CRYPTO '95 extended abstract, read as a PDF from the first author's Stanford page: abstract, section 1 (Introduction), section 2 (Main Results), section 3 (Applications), the lemmas and proofs of sections 4 through 8, and section 9 (Conclusions and Open Problems). It claims random quantum polynomial time for its own two theorems and for the general discrete logarithm problem and factoring, and names no classical running time, query count or lower bound to compare those against. Searching the extracted text for 'classical', 'exponential', 'lower bound', 'superpolynomial', 'speedup' and 'faster' returns 'classical' only in the abstract's closing sentence about junk bits, and 'lower bound' only in a lemma bounding a sum of roots of unity and in a counting step inside the proof of Theorem 1." },
    problem: "Let G be a finitely generated Abelian group and let H be a subgroup of G such that G/H is finite, and let f be a function on G with the promise that f(g1) = f(g2) if and only if g1 and g2 lie in the same coset of H. The task is to find H, that is, a set of generators for H, by making queries to f. Mosca and Ekert work order finding and period finding as G = Z with hidden subgroup rZ, Simon's problem as G = Z_2^l, and the discrete logarithm as G = Z_r × Z_r.",
    problemJa: "有限生成の可換群 G と、G/H が有限となる部分群 H、および f(g1) = f(g2) となるのは g1 と g2 が H の同じ剰余類に属するとき、かつそのときに限るという約束を満たす G 上の関数 f が与えられます。f へのクエリによって H、すなわち H の生成元の組を求める問題です。Mosca と Ekert は、位数発見と周期発見を隠れ部分群 rZ をもつ G = Z、Simon の問題を G = Z_2^l、離散対数を G = Z_r × Z_r の場合として扱っています。",
    idea: "The Zoo credits the first general formulation to Boneh and Lipton and calls attribution difficult: it subsumes many historically important algorithms as special cases, Simon's among them, which inspired Shor's period finding, and underlies the Pell's equation, principal ideal, unit group and class group algorithms. Their Theorem 1 recovers the hidden linear structure of a function from Z^k, Theorem 2 the period of a function on Z that need not be injective; the Abelian generality is one introductory sentence. Mosca and Ekert give the mechanism: f is constant on cosets of a subgroup K and distinct on each coset, and when G is a product of finitely many cyclic groups all are solved by a Fourier transform, a function application and an inverse transform. They then extend the eigenvalue-estimation reading, known already for order finding, factoring, discrete logarithms and Abelian stabilisers, to the general case. The row adds a special case one quantum query solves (Beaudrap, Cleve and Watrous) and two relaxations: Hales and Hallgren for period finding without injectivity, Shparlinski and Winterhof for most-significant-bit oracles.",
    ideaJa: "Zoo は最初の一般的定式化を Boneh と Lipton に帰しつつ、帰属は難しいとしています。この問題は歴史的に重要な多くのアルゴリズムを特別な場合として含み、Shor の周期発見の着想源となった Simon のアルゴリズムもその一つで、Pell 方程式、単項イデアル、単数群、イデアル類群のアルゴリズムの基礎でもあります。Boneh と Lipton の定理1は Z^k 上の関数の隠れた線形構造を、定理2は単射とは限らない Z 上の関数の周期を復元し、可換群への一般化は導入部の一文にとどまります。Mosca と Ekert は仕組みを与えます。f は部分群 K の剰余類上で一定かつ剰余類ごとに異なり、G が有限個の巡回群の直積であれば、いずれも Fourier変換、関数適用、逆変換で解けます。両氏は、位数発見、素因数分解、離散対数、可換群の安定化群についてすでに知られていた固有値推定としての読み方を一般の場合へ広げます。Zoo はさらに、量子クエリ1回で解ける特別な場合（Beaudrap ら）と、単射性を課さない周期発見の Hales・Hallgren、最上位ビットのオラクルの Shparlinski・Winterhof の2つの緩和を挙げます。",
    complexity: "O(log |G|) quantum queries to f against Ω(|G|) classically, both the Zoo's own, and black-box counts, not gate counts. Boneh and Lipton state their results as random quantum polynomial time in n = log q, not a query count, under conditions on the multiplicity m: Theorem 1 needs m and the variable count k at most n^O(1) and m below the smallest prime divisor of q, Theorem 2 the same on m alone. Beaudrap, Cleve and Watrous give a 2n-bit query problem over GF(2^n) solved exactly by one quantum query plus polynomially many auxiliary operations, where standard technique spends Θ(n) queries and bounded-error classical Ω(2^(n/2)).",
    complexityBasis: "Quantum Algorithm Zoo entry \"Abelian Hidden Subgroup\" (LaTeX rendered into Unicode): \"This is solvable on a quantum computer using O(log |G|) queries, whereas classically Ω(|G|) are required.\" Boneh and Lipton, \"Quantum Cryptanalysis of Hidden Linear Functions\", section 2 (Main Results), the two conditions of Theorem 1: \"Let n = log q then m and k are at most n^O(1).\" and \"Let p be the smallest prime divisor of q; then m < p.\"; Theorem 2 repeats the second and imposes the first on m alone. Abstract of arXiv:quant-ph/0011065: \"can be solved exactly in the quantum case with a single query (and a polynomial number of auxiliary operations)\"; its section 1 adds \"exhibiting a 2n-bit query problem\", \"In the classical setting, Ω(2^(n/2)) queries to the black-box are necessary to solve the problem with bounded error.\" and the Θ(n) figure for standard hidden-subgroup technique.",
    caveat: "This is a literature record: nothing was built, compiled, simulated or run here, and no hidden subgroup was recovered. Both figures on it are query counts in a black-box model, so they say nothing about the gates needed to realize the Fourier transform of G or the oracle for f, and the classical Ω(|G|) side is a statement in the Zoo's own entry rather than a bound proved in any paper read for this record. The primary source is thinner than the row it anchors: Boneh and Lipton's theorems are about hidden linear structure over Z^k and about periods of functions on Z, the word \"Abelian\" occurs in the paper exactly once, in an introduction sentence saying their results can be generalized to any finite Abelian group, and both theorems carry conditions on the multiplicity of the hidden function that the Zoo's problem statement does not mention. Mosca and Ekert's one-sentence summary of the general Abelian case gives its cost as polynomial in n applications of the shift operators \"where n is the index of K in G\", while the opening of their section 2 defines \"the input size, n, to be of order log2 [G : K]\", so this record does not quote that figure and does not resolve which reading the authors meant. Beaudrap, Cleve and Watrous say themselves that their problem is related to but different from Boneh and Lipton's, and that their exponential classical lower bound depends on the field structure and does not always hold for finite rings, where over Z_(2^n) the classical query complexity is n + 1 rather than exponential, so the single-query result is one special case and not a general improvement on O(log |G|). The Zoo's implementation links on this row point at implementations of Simon's algorithm, itself a special case. The two relaxations the row cites, Hales and Hallgren and Shparlinski and Winterhof, were not read for this record; what is said of them here is relayed from the Zoo's entry text and named as such.",
    caveatJa: "本項目は文献に基づく記録であり、ここで何かを構成・コンパイル・シミュレーション・実行したことはなく、隠れ部分群を実際に復元したわけでもありません。掲げた2つの数値はいずれもブラックボックスモデルにおけるクエリ数であり、G の Fourier変換や f のオラクルを実現するために必要なゲート数については何も述べていません。また古典側の Ω(|G|) は Zoo の項目自身の記述であって、本記録のために読んだいずれの論文でも証明された下界ではありません。一次資料は、それが支える項目より内容が薄いものです。Boneh と Lipton の定理は Z^k 上の隠れた線形構造と Z 上の関数の周期に関するものであり、論文中に「Abelian」の語が現れるのはただ一度、結果は任意の有限可換群へ一般化できると述べた導入部の一文だけです。しかも両定理はいずれも、Zoo の問題設定が触れていない、隠れた関数の多重度に関する条件を伴います。Mosca と Ekert が一般の可換な場合を要約した一文は、そのコストをシフト作用素の適用回数について n の多項式とし、そこでは「where n is the index of K in G」としていますが、同論文の第2節冒頭は「the input size, n, to be of order log2 [G : K]」と定義しています。両者は一致しないため、本記録はこの数値を引用せず、著者がどちらの意味で用いたのかも判断していません。Beaudrap、Cleve、Watrous 自身は、自分たちの問題が Boneh と Lipton のものと関連はするが別物であること、そして指数関数的な古典側の下界は体の構造に依存し、有限環に対しては常に成り立つわけではないことを述べています。実際 Z_(2^n) 上では古典クエリ計算量は指数関数的ではなく n + 1 です。したがって単一クエリの結果は一つの特別な場合であって、O(log |G|) を一般に改善するものではありません。この項目に Zoo が張っている実装へのリンクは、それ自体が特別な場合である Simon のアルゴリズムの実装を指しています。項目が挙げる2つの緩和、すなわち Hales と Hallgren、および Shparlinski と Winterhof は本記録のためには読んでおらず、ここに書かれている内容は Zoo の項目本文からの伝聞であり、そのように明記しています。",
    tags: ["hidden subgroup problem", "abelian group", "coset", "oracle", "query complexity", "fourier transform"],
    source: {
      id: "doi:10.1007/3-540-44750-4_34",
      title: "Quantum Cryptanalysis of Hidden Linear Functions",
      authors: "Dan Boneh, Richard J. Lipton",
      year: "1995",
      url: "https://doi.org/10.1007/3-540-44750-4_34",
    },
    literature: [
      {
        title: "Quantum Cryptanalysis of Hidden Linear Functions",
        authors: "Dan Boneh, Richard J. Lipton",
        year: "1995",
        url: "https://doi.org/10.1007/3-540-44750-4_34",
        relevance: "Primary source, and the paper the Quantum Algorithm Zoo credits with first formulating this algorithm in full generality. Theorem 1 recovers the hidden linear structure of a function from Z^k to an arbitrary range from an oracle for it, in random quantum polynomial time; Theorem 2 recovers the smallest positive period of a function on the integers that need not be one to one. Its corollaries are that the general discrete logarithm problem and factoring are each solvable in random quantum polynomial time. Consult it for the conditions on the multiplicity of the hidden function, which Theorem 1 pairs with a bound on the number of variables and Theorem 2 does not, and for the junk-bits construction. The generalization to any finite Abelian group is stated once, in the introduction, as a remark.",
        relevanceJa: "一次資料であり、Zoo がこのアルゴリズムを初めて一般の形で定式化したものとして挙げる論文です。定理1は、Z^k から任意の値域への関数の隠れた線形構造を、そのオラクルから確率的量子多項式時間で復元します。定理2は、一対一とは限らない整数上の関数の最小の正の周期を復元します。系として、一般の離散対数問題と素因数分解がいずれも確率的量子多項式時間で解けることが導かれます。隠れた関数の多重度に課される条件、すなわち定理1がこれに変数の個数の上界を併せる一方で定理2は併せない点と、不要ビットの構成については原論文で確認してください。任意の有限可換群への一般化は、導入部で一度、注意として述べられているだけです。",
      },
      {
        title: "The Hidden Subgroup Problem and Eigenvalue Estimation on a Quantum Computer",
        authors: "Michele Mosca, Artur Ekert",
        year: "1999",
        url: "https://arxiv.org/abs/quant-ph/9903071",
        relevance: "The general Abelian case as one algorithm. The abstract lists order finding, factoring, discrete logarithms, stabilisers in Abelian groups and hidden subgroups of Abelian groups together, says the eigenvalue-estimation reading of the first four was already known, and shows the general Abelian case can be described and analysed as such too. Section 2 works order finding, Simon's problem, the discrete logarithm and the Abelian stabiliser problem as instances; section 4.3 states the promise; section 5 shrinks the control register to one bit. The appendix, on the many-to-one case, credits the question to Boneh and Lipton and reaches a condition of the same shape as theirs but on the order of the hidden subgroup rather than the period: the multiplicity must be below the smallest prime factor of |K|.",
        relevanceJa: "一般の可換な場合を一つのアルゴリズムとして扱う論文です。要旨は、位数発見、素因数分解、離散対数、可換群の安定化群、可換群の隠れ部分群を並べて挙げ、前の4つを固有値推定として読めることはすでに知られていたと述べたうえで、一般の可換な場合も同様に記述・解析できることを示しています。第2節は位数発見、Simon の問題、離散対数、可換な安定化群問題を具体例として扱い、第4.3節が約束を述べ、第5節は制御レジスタを1量子ビットに縮めています。多対一の場合を扱う付録は、この問いを Boneh と Lipton に帰したうえで、周期ではなく隠れ部分群の位数について同じ形の条件、すなわち多重度が |K| の最小の素因数より小さいという条件に達しています。",
      },
      {
        title: "Sharp Quantum vs. Classical Query Complexity Separations",
        authors: "J. Niel de Beaudrap, Richard Cleve, John Watrous",
        year: "2000",
        url: "https://arxiv.org/abs/quant-ph/0011065",
        relevance: "The single-query special case the Zoo cites here, and a special case rather than a relaxation: section 1 calls the hidden linear structure problem a special case of the hidden subgroup problem as defined by Brassard and Høyer and by Mosca and Ekert, credits Hallgren with pointing the relationship out, and notes that standard technique would spend Θ(n) queries on it. It is a 2n-bit query problem over the field GF(2^n), solved exactly with one quantum query and a polynomial number of auxiliary operations, namely O(n) Hadamard gates then O(n^2) classical operations after a measurement, against Ω(2^(n/2)) queries classically. The exponential classical bound depends on the field structure and does not carry over to finite rings, and their problem differs from Boneh and Lipton's.",
        relevanceJa: "Zoo がここで挙げる単一クエリの事例であり、緩和ではなく特別な場合です。第1節は、隠れた線形構造の問題を Brassard と Høyer および Mosca と Ekert の定義による隠れ部分群問題の特別な場合と呼び、この関係の指摘を Hallgren に帰し、標準的な技法ではこれに Θ(n) クエリを要すると述べています。対象は体 GF(2^n) 上の 2n ビットのクエリ問題で、量子では1回のクエリと多項式個の補助操作、すなわち O(n) 個の Hadamard ゲートと測定後の O(n^2) 回の古典操作で厳密に解ける一方、古典では Ω(2^(n/2)) クエリを要します。指数関数的な古典側の下界は体の構造に依存して有限環へは引き継がれず、彼らの問題は Boneh と Lipton のものとは異なります。",
      },
    ],
    relatedSlugs: ["shor-period-finding", "discrete-logarithm", "hidden-shift-problem", "quantum-fourier-transform"],
  },
];

/** The Zoo entry each record covers — read by scripts/check-zoo-parity.mjs. */
export const ZOO_PARITY_COVERAGE: ReadonlyArray<{ slug: string; zooName: string }> =
  ZOO_ALGORITHMS.map((concept) => ({ slug: concept.slug, zooName: concept.zooName }));

/**
 * Where each record's speedup class stands against its own primary paper — read
 * by `scripts/check-zoo-parity.mjs`, which pins the census exactly.
 *
 * Exported as the whole discriminated value rather than just the state word, so
 * the checker can refuse a `reported` with no quote and an `absent` with nothing
 * named as read. A state with no evidence behind it is the shape this field was
 * added to prevent, and it would type-check perfectly well as an empty string.
 */
export const ZOO_SPEEDUP_PROVENANCE: ReadonlyArray<{
  slug: string;
  title: string;
  titleJa: string;
  zooName: string;
  zooSection: string;
  speedup: string;
  source: ZooAlgorithm["source"];
  primary: ZooAlgorithm["speedupPrimary"];
}> = ZOO_ALGORITHMS.map((concept) => ({
  slug: concept.slug,
  title: concept.title,
  titleJa: concept.titleJa,
  zooName: concept.zooName,
  zooSection: concept.zooSection,
  speedup: concept.speedup,
  source: concept.source,
  primary: concept.speedupPrimary,
}));

/**
 * What a reader is told about who stands behind the speedup class, in one line
 * per locale.
 *
 * A sentence rather than a bare state word: "unknown" on a card means nothing to
 * whoever is reading it, and the difference between *nobody has looked* and *we
 * looked and it is not there* is exactly the difference this field exists to make
 * legible. `absent` names what was read, because the claim is only as wide as the
 * text behind it.
 */
function speedupPrimaryLine(concept: ZooAlgorithm): { en: string; ja: string } {
  switch (concept.speedupPrimary.states) {
    case "reported":
      return {
        en: `Stated by the primary source: "${concept.speedupPrimary.quote}"`,
        ja: `一次資料に記載があります：「${concept.speedupPrimary.quote}」`,
      };
    case "absent":
      return {
        en: `Not stated by the primary source — ${concept.speedupPrimary.read} was read and makes no such claim`,
        ja: `一次資料には記載がありません（${concept.speedupPrimary.read} を確認）`,
      };
    default:
      return {
        en: "Not checked against the primary source yet",
        ja: "一次資料との照合はまだ行っていません",
      };
  }
}

function zooEntry(concept: ZooAlgorithm): PublicRepositoryEntry {
  const complexityLine = concept.complexity === ""
    ? "Not stated by the sources read"
    : concept.complexity;
  const primary = speedupPrimaryLine(concept);
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
      "Literature record · problem statement and speedup class checked against the Quantum Algorithm Zoo entry"
      + " · primary reference checked against its arXiv abs page",
    verificationMethods: ["research_paper"],
    method:
      "Curation only. The problem statement and speedup class were checked against the Quantum Algorithm Zoo's"
      + ` entry "${concept.zooName}" (${concept.zooSection}); the primary reference's title, authors and`
      + " submission year were read from its arXiv abs page; the complexity claim was taken from a clause of that"
      + ` paper's abstract (${concept.complexityBasis}). No circuit was constructed, simulated or run.`,
    result:
      "Pass · the record's problem, speedup class and primary reference agree with the two sources named above.",
    caveat: concept.caveat,
    exportStatus: "Literature reference · no circuit supplied",
    provenance: "Leona Quantum Zoo-parity intake",
    updatedAt: "2026-08-12",
    description: concept.problem,
    descriptionJa: concept.problemJa,
    introduction: `${concept.problem} ${concept.idea}`,
    introductionJa: `${concept.problemJa}${concept.ideaJa}`,
    // The Zoo's name came out of this paragraph, and out of the resource label
    // below, on the owner's ruling that *"less references to them the better"*.
    // What did NOT come out is the claim's provenance: the sentence still says
    // the class is a secondary-source classification and not this paper's, and
    // the index is still named once, in `metadata`, which is the "keep track of
    // which claims are from secondary sources" half of the same ruling. Dropping
    // the attribution entirely would have turned a quotation into our own claim,
    // which is the opposite of what he asked for.
    explanation:
      `${concept.idea} This record's speedup class, "${concept.speedup}", is a secondary source's`
      + ` classification of the ${concept.zooSection.toLowerCase()} it files this under — not a claim its`
      + ` primary paper makes. ${primary.en}. ${
        concept.complexity === ""
          ? `The sources read state no complexity bound for this record (${concept.complexityBasis}).`
          : `Reported cost: ${concept.complexity}.`
      }`,
    explanationJa:
      `${concept.ideaJa}本記録の速度向上の区分「${concept.speedup}」は、二次資料が分類したものであり、`
      + `一次論文の主張ではありません。${primary.ja}。${
        concept.complexity === ""
          ? "参照した出典は本記録に対する計算量の上界を述べていません。"
          : `報告されている計算量は ${concept.complexity} です。`
      }`,
    tags: concept.tags,
    resources: [
      { label: "Record type", value: "Literature reference" },
      // Named for whose classification it is. An outside index assigns a speedup
      // class to its *entry* — sometimes to a whole section of them — and a reader
      // who sees a bare "Speedup" on a single-paper record will read it as a claim
      // this record is making about that paper. It is not; it is a quotation.
      //
      // The line below it is the one the owner asked for: whether the paper this
      // record is actually about backs the class, is silent on it, or has not been
      // read for it yet. Without that second line the first is a rating with no
      // standing, and a reader cannot tell a checked claim from an unchecked one.
      { label: "Speedup class (secondary source)", value: concept.speedup },
      { label: "Primary source on the speedup", value: primary.en },
      { label: "Reported cost", value: complexityLine },
    ],
    metadata: [
      // The tracking half of the owner's #18 ruling, and the ONE place the outside
      // index is named to a reader. It is here rather than in the prose because
      // this is the row somebody re-deriving the class from first principles needs
      // — "which claims are from secondary sources, so i can get expert opinion
      // and rederive it" — and it is a lookup, not part of the argument.
      { label: "Secondary source for the speedup class", value: `Quantum Algorithm Zoo — "${concept.zooName}"` },
      { label: "Section it is filed under", value: concept.zooSection },
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
      + `PRIMARY SOURCE: ${concept.source.authors} (${concept.source.year}), ${concept.source.title} — ${concept.source.url}\n\n`
      + "This is a literature reference record, not an executable circuit.",
    filename: `${concept.slug}.txt`,
    language: "text",
    relatedSlugs: concept.relatedSlugs,
    // The primary source is always cited. A concept that already carries its own,
    // better-written line for that same url keeps it — citing one paper twice under
    // two different `relevance` strings is how a record starts disagreeing with itself.
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

export const ZOO_PARITY_ENTRIES: PublicRepositoryEntry[] = ZOO_ALGORITHMS.map(zooEntry);
