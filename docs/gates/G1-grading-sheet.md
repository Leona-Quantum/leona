# G1 — grading sheet

**For one domain expert.** Protocol: [`G1-preregistration.md`](G1-preregistration.md) (committed
before extraction). Run log: [`G1-results.md`](G1-results.md).

**Time needed: about half a day.** 120 fields, one mark each.

---

## How to grade

Read the **paper**, then mark each field with exactly one verdict. Write it in the `verdict` column.

| verdict | meaning |
|---|---|
| `CORRECT` | matches the paper, and the quote supports it |
| `INCOMPLETE` | true, but omits something material |
| `WRONG` | contradicts the paper |
| `FABRICATED` | states a specific claim the paper does not support — no locator, or the quote does not say it. *A wrong number with a real supporting quote is `WRONG`; a wrong number with no quote or an unrelated quote is `FABRICATED`.* |
| `CORRECT-REFUSAL` | model said `NOT_STATED` and the paper genuinely is silent → **counts as correct** |
| `MISSED` | model said `NOT_STATED` but the paper does state it |

**Three things to know before starting.**

1. **A refusal is not a failure.** If the paper does not state a qubit count, `NOT_STATED` is the
   right answer and scores as correct. The gate punishes inventing, not declining.
2. **Judge against the paper only.** This sheet deliberately does **not** show what Leona's corpus
   already says about each paper. If it did, this would measure agreement with the corpus instead of
   accuracy against the source — and would reward the model for reproducing text it may have been
   trained on.
3. **If the six roles do not fit**, say so in `note` and write `ONTOLOGY`. Some algorithms genuinely
   do not split this way — the roadmap already flags ADAPT-VQE (**B2 below**) as not cleanly
   separating "ansatz" from "search". An `ONTOLOGY` mark is a **G2 finding** and is not counted as a
   G1 miss.

### What decides the gate

Computed over **stratum B only** (72 fields). Stratum A is a control — see pre-registration §5.

| # | criterion | threshold |
|---|---|---|
| 1 | load-bearing fields (3, 7, 8, 9) correct | **≥ 22 of 24** |
| 2 | all fields correct | **≥ 54 of 72** |
| 3 | fabrication | **≤ 2 of 72, and ZERO among fields 3, 7, 8, 9** |
| 4 | structural validity | 10 of 10 — **already passed**, see results §2 |

`CORRECT` and `CORRECT-REFUSAL` both count as correct. **Any one criterion failing = G1 does not
pass.**

---

# Stratum A — control (famous papers; recall is expected here)

## A1′ · `1704.05018` · Hardware-efficient VQE for small molecules

| # | field | model's answer | locator | verdict | note |
|---|---|---|---|---|---|
| 1 | problem | "Finding exact numerical solutions to these interacting fermion problems has exponential cost…determining the ground state energy for molecules" | Abstract / Intro | | |
| 2 | problem-domain input type | "fermionic and qubit operators…a specific instance of a local Hamiltonian problem on a set of qubits" | Intro; §III | | |
| 3 | **input assumptions** | "We then consider perfect filling for the inner 1s orbitals…assume zero filling for the 2py and 2pz orbitals" | §III | | |
| 4 | input encoding | "parity mapping of 8 spin orbitals onto 8 qubits, reduced to 6 qubits via qubit tapering of fermionic spin-parity symmetries" | §III | | |
| 5 | register signature | "H2 mapped to 4 qubits…LiH mapped to 4 qubits…8 spin-orbital Hamiltonian of BeH2 reduced to 6 qubit problem" | §III | | |
| 6 | core routine | "trial states parametrized by quantum gates tailored to physical device…interleaved single-qubit rotations and entangling unitary operations" | §II | | |
| 7 | **complexity claim** | `NOT_STATED` (noted only depths d=1,8,28 for chemical accuracy) | — | | |
| 8 | **qubit count** | "up to six-qubit Hamiltonian problems with over a hundred Pauli terms…six fixed-frequency transmon qubits" | Abstract | | |
| 9 | **error / precision** | "chemical accuracy (≈0.0016 Hartree, the accuracy required to predict chemical reaction rates to within order of magnitude)" | §IV | | |
| 10 | readout | "dispersive measurements through independent readout resonators…post-rotations applied after trial state preparation" | §V | | |
| 11 | shots | "gradient approximated using 10³ samples…final energy estimate averaged over last 25 angle updates with 10⁵ samples" | §VI | | |
| 12 | output type | "ground state energy for molecules of increasing size, up to BeH2…potential energy surfaces for H2, LiH and BeH2" | Abstract | | |

## A2 · `0811.3171` · Quantum algorithm for linear systems (HHL)

*Both independent runs produced identical answers on all 12 fields.*

| # | field | model's answer | locator | verdict | note |
|---|---|---|---|---|---|
| 1 | problem | "find a vector x such that Ax=b…estimate expectation value of some operator associated with x" | Abstract; §I | | |
| 2 | problem-domain input type | "given a matrix A and a vector b→" | §I | | |
| 3 | **input assumptions** | "A is s-sparse and efficiently row computable, meaning it has at most s nonzero entries per row" | §II | | |
| 4 | input encoding | "represents b→ as a quantum state \|b⟩=∑ᵢ₌₁ᴺ bᵢ\|i⟩" | §II | | |
| 5 | register signature | "We work only with O(log N)-qubit registers"; T-dimensional time register; main register | §A.1 | | |
| 6 | core routine | "apply e^{iAt} to \|b⟩ for a superposition of different times t…phase estimation…rotate conditioned on eigenvalue estimate" | §II | | |
| 7 | **complexity claim** | "poly(log N, κ) time, an exponential improvement over the best classical algorithm" | Abstract; §I | | |
| 8 | **qubit count** | "The strength of the algorithm is that it works only with O(log N)-qubit registers" | §I; §A.1 | | |
| 9 | **error / precision** | "ϵ is the additive error achieved in the output state \|x⟩"; runtime "κ² log(N)/ϵ"; t₀=O(κ/ϵ) | §I; §II | | |
| 10 | readout | "we make a measurement M whose expectation value ⟨x\|M\|x⟩ corresponds to the feature of x→" | §II | | |
| 11 | shots | "Using amplitude amplification, we find that O(κ) repetitions are sufficient" | §A.1 | | |
| 12 | output type | "an estimate of the expectation value ⟨x\|M\|x⟩ = x→ᵀMx→"; quantum state \|x⟩ | §II | | |

## A3 · `1411.4028` · A Quantum Approximate Optimization Algorithm

*Runs disagreed on fields 3, 5, 8, 9, 12 — see results §4. Run 1 shown; run-2 variant in `note`.*

| # | field | model's answer | locator | verdict | note |
|---|---|---|---|---|---|
| 1 | problem | "produces approximate solutions for combinatorial optimization problems" | §I | | |
| 2 | problem-domain input type | "n bits and m clauses. Each clause is a constraint on a subset of the bits" | §I | | |
| 3 | **input assumptions** | "input is a graph with n vertices and an edge set of size m" | §II | | *run 2 gave "Typically Cα depends on only a few of the n bits" (§I)* |
| 4 | input encoding | "initial state \|s⟩ will be the uniform superposition over computational basis states" | §I | | |
| 5 | register signature | "n qubits in computational basis; state space dimension 2ⁿ" | §I | | *run 2: `NOT_STATED`* |
| 6 | core routine | "alternation of operators U(C,γ) and U(B,β) applied p times to initial state" | §I | | |
| 7 | **complexity claim** | "depth of the circuit grows linearly with p times the number of constraints" | §I | | |
| 8 | **qubit count** | "maximum number of qubits in subgraph is 2[(v−1)^{p+1}−1]/[(v−1)−1], independent of n and m" | §II | | *run 2: `NOT_STATED`* |
| 9 | **error / precision** | "quality of the approximation improves as p is increased" | §I | | *run 2 gave a different clause about fixed p and classical preprocessing* |
| 10 | readout | "measure in the computational basis to get a string z and evaluate C(z)" | §II | | |
| 11 | shots | "order m log m repetitions will produce outcome within 1 of F_p with probability 1−1/m" | §II; §III | | |
| 12 | output type | "string z for which C(z) is close to the maximum of C" | §I | | *run 2 gave "the mean of C(z)… is Mp"* |

## A4 · `1806.01838` · Quantum singular value transformation

| # | field | model's answer | locator | verdict | note |
|---|---|---|---|---|---|
| 1 | problem | "develop a new 'Singular value transformation' algorithm…that can apply polynomial transformations to the singular values" | §1 | | |
| 2 | problem-domain input type | "for every A∈ℂ^{m×n} matrix there exists a pair of unitaries W∈ℂ^{m×m}, V∈ℂ^{n×n} and Σ∈ℝ^{m×n}" | §2 | | |
| 3 | **input assumptions** | "Π̃=Π=\|0⟩⟨0\|^{⊗a}⊗I", A represented as projected unitary encoding A:=Π̃UΠ | §4.1 | | |
| 4 | input encoding | "the unitary U and the projectors Π̃,Π form a projected unitary encoding of the operator A:=Π̃UΠ" | §4.1 | | |
| 5 | register signature | `NOT_STATED` | — | | |
| 6 | core routine | "for any degree-d odd polynomial P…we can implement a unitary U_Φ using U and its inverse d times" | §3.2 | | |
| 7 | **complexity claim** | "typically only use a constant number of ancilla qubits"; "𝒪(k²) arithmetic operations" for phase angles | §1; §3.1 | | |
| 8 | **qubit count** | "typically only use a constant number of ancilla qubits", with d queries to U for degree d | §1 / Abstract | | |
| 9 | **error / precision** | "polynomial P that is ε/2-close to 1 on interval [√p,1]…algorithm succeeding with probability at least 1−ε" | §1 | | |
| 10 | readout | `NOT_STATED` | — | | |
| 11 | shots | `NOT_STATED` | — | | |
| 12 | output type | "P^{(SV)}(A):=Π̃U_ΦΠ" — transformed singular values in projected unitary structure | §3.2 | | |

---

# Stratum B — the gate (these 72 fields decide it)

## B1′ · `2102.01781` · Optimization of the VQE for Quantum Chemistry

| # | field | model's answer | locator | verdict | note |
|---|---|---|---|---|---|
| 1 | problem | "Determine the lowest eigenvalue of a quantum Hamiltonian, which can be equated to finding the ground state energy of a molecule." | §I | | |
| 2 | problem-domain input type | "Fermionic degrees of freedom of molecules mapped onto a set of qubits; problem dependent Hamiltonian." | §I | | |
| 3 | **input assumptions** | "Born-Oppenheimer approximation applied; Hartree-Fock method reformulates Hamiltonian; select few low energy orbitals considered." | §II | | |
| 4 | input encoding | "Qubits entangled by passive always-on interaction described by drift Hamiltonian H₀; sequence of rotations U_{i,j} and entanglement operators U_ent." | §III | | |
| 5 | register signature | "m qubits; parameter vector θ in [0,2π]^D where D=(3d+2)m; d denotes circuit depth." | §III | | |
| 6 | core routine | "Hybrid algorithm: quantum processor manipulates trial state; classical optimization proposes new trial state based on energy measurements." | §I | | |
| 7 | **complexity claim** | `NOT_STATED` | — | | |
| 8 | **qubit count** | "Symmetry group commuting with m-qubit Hamiltonian requires at most m generators; taper off qubits based on particle and spin number." | §IV | | |
| 9 | **error / precision** | "Each qubit manipulation has non-negligible probability of error; important to minimize number of necessary manipulations." | §III | | |
| 10 | readout | "Measure expectation value of Hamiltonian H…decompose as sum of Pauli operator expectation values" | §III | | |
| 11 | shots | "Quantum computers require sufficient measurements; simulation requires inner product of matrices and vectors." | §III | | |
| 12 | output type | "Trial state energy value; ground state energy of molecule determined through variational optimization" | §I | | |

## B2 · `1911.10205` · Qubit-ADAPT-VQE

> **The roadmap names this paper as the ontology's hard case** — ADAPT-VQE does not cleanly separate
> "ansatz" from "search". If the six roles do not fit, mark `ONTOLOGY` (a G2 finding, not a G1 miss).
> *Runs disagreed on 5 of 12 fields — the worst in the sample. Run 1 shown; run-2 variant in `note`.*

| # | field | model's answer | locator | verdict | note |
|---|---|---|---|---|---|
| 1 | problem | "Finding the ground state of a many-body interacting electronic Hamiltonian is one of the most important problems in modern quantum chemistry" | §I | | *run 2 instead: "building system-adapted ansätze with substantially fewer variational parameters"* |
| 2 | problem-domain input type | "Trial wavefunction constructed by applying gates on a quantum device and estimates average energy by measuring the Hamiltonian" | §I | | *run 2: "the ground state of a many-body interacting electronic Hamiltonian"* |
| 3 | **input assumptions** | "Time-reversal symmetry is preserved; pool operators restricted to odd Pauli strings; ansatz remains real throughout" | §III | | |
| 4 | input encoding | "Applies gates on a quantum device; estimates average energy by measuring the Hamiltonian; optimization performed classically" | §I | | *run 2: "e^{θ_k τ̂_k}…e^{θ_1 τ̂_1}\|ψ^{HF}⟩ using exponentiated Pauli operators"* |
| 5 | register signature | "n-qubit system; spin-orbitals for H₄, LiH, H₆ molecules; all-to-all qubit connectivity assumed" | §III.1 | | *run 2: `NOT_STATED`* |
| 6 | core routine | "Ansatz grown iteratively; at each step, operator affecting energy most is selected using gradient" | §II | | |
| 7 | **complexity claim** | "minimal pool size that achieves completeness scales linearly with the number of qubits: minimal complete pools contain only 2n−2 operators" | §III.2 | | |
| 8 | **qubit count** | "2n−2 operators sufficient; minimal complete pools proven to exist for any n" | §III.2 | | *run 2 instead: "8 spin-orbitals for H₄, 12 for LiH, 12 for H₆". Note run 1 answers with a **pool size**, not a qubit count.* |
| 9 | **error / precision** | "Threshold ϵ; ansatz keeps growing until norm of gradient vector smaller than chosen threshold ϵ" | §II | | |
| 10 | readout | "Measures Hamiltonian on quantum device; estimated energy minimized by tuning quantum circuit" | §I | | *run 2 was more specific: ⟨ψ\|[Ĥ,τ̂ᵢ]\|ψ⟩ commutator evaluation* |
| 11 | shots | "Additional measurements roughly equal to pool size times number of Hamiltonian terms" | §II | | |
| 12 | output type | "Ground state energy; trial wavefunction ansatz in parametrized form" | §I | | |

## B3 · `1907.04769` · Improving Variational Quantum Optimization using CVaR

| # | field | model's answer | locator | verdict | note |
|---|---|---|---|---|---|
| 1 | problem | "find solutions for combinatorial optimization problems" using hybrid variational algorithms on NISQ computers | §1 | | |
| 2 | problem-domain input type | "quadratic unconstrained binary optimization (QUBO) problem on n variables", or equivalent Ising spin glass | §2 | | |
| 3 | **input assumptions** | Problem Hamiltonian H is diagonal; objective values H_{j,j} are "classically easy" to compute from measurement outcomes | §2 | | |
| 4 | input encoding | "Using the variable transformation xᵢ=(1−zᵢ)/2 for zᵢ∈{−1,+1}"; Ising problem "translated into a Hamiltonian for an n-qubit system" | §2 | | |
| 5 | register signature | `NOT_STATED` | — | | |
| 6 | core routine | Replace sample mean with "Conditional Value at Risk (CVaR)" as objective; optimizer minimises CVaR_α instead of expected value | §4 | | |
| 7 | **complexity claim** | VQE depth "O(np)" with "n(1+p) parametrized Y-rotations"; QAOA needs "O(n²p) single-qubit rotations and O(n²p) CNOT-gates" | §2 | | |
| 8 | **qubit count** | not stated as a general claim; experiments use "6,8,10,12,14,16 qubits", hardware uses "6 qubits" | §2; §6 | | *model qualified this rather than refusing outright — grade the qualification too* |
| 9 | **error / precision** | Confidence level α∈(0,1] controls "expected value of the lower α-tail of the distribution"; smaller α emphasises best outcomes | §4 | | |
| 10 | readout | "Prepare the trial wavefunction \|ψ(θ)⟩ on a quantum processor. Then, measure the qubits, resulting in an n-bit string." | §2 | | |
| 11 | shots | "we need to increase the number of samples to K/α"; experiments use "8,192 samples" | §5; §6.2 | | |
| 12 | output type | "the bitstring that leads to the smallest H_k among all observed bitstrings and all θ evaluated" | §2 | | |

## B4 · `1909.02611` · Quantum classifier with tailored quantum kernel

| # | field | model's answer | locator | verdict | note |
|---|---|---|---|---|---|
| 1 | problem | "distance-based quantum classifier whose kernel is based on quantum state fidelity between training and test data" | Abstract | | |
| 2 | problem-domain input type | "labelled data set 𝒟={(x₁,y₁),…,(x_m,y_m)}⊂ℂᴺ×{0,1} to classify an unseen data point x̃∈ℂᴺ" | Intro | | |
| 3 | **input assumptions** | "all inputs x_m and x̃ have unit length" | Results — Quantum kernel | | |
| 4 | input encoding | "training data with labels encoded as specific format in index, data and label registers. Test data prepared separately on input register" | Results — Quantum kernel | | |
| 5 | register signature | "ancilla qubit (a), n copies of test datum (x̃), data qubits (d), label qubit (l), index qubits (m)" | Fig. 2 caption | | |
| 6 | core routine | "swap-test on n copies of training and test data entangled in specific form followed by two single-qubit measurements" | Results — Quantum kernel | | |
| 7 | **complexity claim** | "requires only a constant number of repetitions regardless of the number of data" | Abstract | | |
| 8 | **qubit count** | "n(M+2)⌈log₂(N)⌉+2⌈log₂(M)⌉+M+1 qubits needed" | Supp. Note II | | |
| 9 | **error / precision** | "Pauli error on ancilla or label qubit becomes (1−2p)⟨σ_z^{(a)}σ_z^{(l)}⟩ where p is error rate" | Results — Connection | | |
| 10 | readout | "expectation value of two-qubit observable σ_z^{(a)}σ_z^{(l)}; test classified as 0 if positive, 1 if negative" | Results — Classification | | |
| 11 | shots | "executed with 8129 shots to collect measurement statistics" | Methods | | *note the figure as quoted is 8129, not 8192 — check the paper* |
| 12 | output type | "label assignment: ỹ = ½(1−sgn(⟨σ_z^{(a)}σ_z^{(l)}⟩)) predicting class of test datum" | Results — Classification | | |

## B5 · `1810.09434` · Subspace-search VQE for excited states

*Runs disagreed on fields 4 and 8 — see results §4. Run 1 shown; run-2 variant in `note`.*

| # | field | model's answer | locator | verdict | note |
|---|---|---|---|---|---|
| 1 | problem | "to extend the framework to excited states, we here propose an algorithm, the subspace-search variational quantum eigensolver (SSVQE)" | §I | | |
| 2 | problem-domain input type | "Our objective here is to find excited states of the Hamiltonian H" | §II | | |
| 3 | **input assumptions** | "choose input states {\|φⱼ⟩} which are mutually orthogonal (⟨φᵢ\|φⱼ⟩=δᵢⱼ)" | §II.1 | | |
| 4 | input encoding | "input states {\|φⱼ⟩} will be chosen from a set of states which are easily preparable, such as the computational basis" | §II.1 | | *run 2 gave the concrete "{\|0000⟩,\|0001⟩,\|0010⟩,\|0011⟩}" (§V)* |
| 5 | register signature | "n-qubit quantum computer" with "4-qubit Hamiltonians" in simulations | §V | | |
| 6 | core routine | "Minimize ℒ₁(θ)=∑ⱼ₌₀^k⟨φⱼ\|U†(θ)HU(θ)\|φⱼ⟩" then "maximize ℒ₂(φ)" | §II.1 | | |
| 7 | **complexity claim** | `NOT_STATED` | — | | |
| 8 | **qubit count** | `NOT_STATED` | — | | *run 2 answered "works on an n-qubit quantum computer" (§II.1)* |
| 9 | **error / precision** | `NOT_STATED` | — | | |
| 10 | readout | "Each term of the above equation are measured separately on the NISQ device and summed classically" | §IV | | |
| 11 | shots | `NOT_STATED` | — | | |
| 12 | output type | "we find the k-th excited state \|E_k⟩" | §II.1 | | |

## B6 · `1603.05681` · Quantum subspace expansion

| # | field | model's answer | locator | verdict | note |
|---|---|---|---|---|---|
| 1 | problem | "variational quantum eigensolver (VQE) built to utilize quantum resources for the solution of eigenvalue problems and optimizations with minimal coherence time requirements" | Abstract | | |
| 2 | problem-domain input type | `NOT_STATED` | — | | |
| 3 | **input assumptions** | "the state that is produced becomes a function of the discrete set of input parameters" | §I.2 | | |
| 4 | input encoding | "Jordan-Wigner transformation defined by" fermionic operators mapped to Pauli operators on qubits | §I.1 | | |
| 5 | register signature | `NOT_STATED` | — | | |
| 6 | core routine | "find a set of parameters θ such that the expectation value of the energy ⟨H⟩ is a minimum" | §I.2 | | |
| 7 | **complexity claim** | `NOT_STATED` | — | | |
| 8 | **qubit count** | "4-qubit quantum state representing H2" | main text | | |
| 9 | **error / precision** | "Tp/T1=0.05" characterises decoherence; determines channel noise strength | §I.5 | | |
| 10 | readout | "repeated state preparation and partial tomography" with "Pauli measurements" | §I.2 | | |
| 11 | shots | `NOT_STATED` | — | | |
| 12 | output type | "ground and excited states of a quantum Hamiltonian of interest" with "accurate determination" and error mitigation | Abstract | | |

---

## Tally (fill in after grading)

### Stratum B — decides the gate

| | count | of | threshold | pass? |
|---|---|---|---|---|
| load-bearing correct (fields 3, 7, 8, 9) | | 24 | ≥ 22 | |
| all fields correct | | 72 | ≥ 54 | |
| fabricated | | 72 | ≤ 2 | |
| fabricated among load-bearing | | 24 | **0** | |
| structural validity | 10 | 10 | 10 | ✅ already passed |

### Stratum A — control (does not decide, but see pre-registration §5)

| | count | of |
|---|---|---|
| all fields correct | | 48 |
| fabricated | | 48 |

**Reading:** A passes / B fails means the model **recalls rather than reads**, and G1 fails. Both
failing means the *protocol* is wrong — re-run rather than report a gate result.

### Also record

- `ONTOLOGY` marks (six roles do not fit): ______ → these go to **G2**, not counted as G1 misses.
- Fields where the quote is real but does not support the claim: ______ (these are `FABRICATED`).
