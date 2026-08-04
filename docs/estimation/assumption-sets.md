# Assumption sets: what each value is, and which paper states it

**Spec of record for `packages/py/estimation`'s sourcing.** The code cites this file;
this file lives in the repository, so anyone with a checkout can open it.

> The estimator's whole pitch is that it says what it does not know. It refuses to state a
> Clifford-only circuit's runtime, and it refuses to rank two estimates computed under
> different assumption sets. A citation that overstates its sourcing undercuts exactly
> that, so the sourcing is *composed by code* — `AssumptionSet.citation` — and this table
> is the record behind it, not a substitute for it.

Related, and outside the repository because they are planning documents rather than specs:
`Projects/Majorana/plans/leona-resource-estimation.md` (the derivation and the 10⁵→10⁸
ceiling study) and `plans/leona-estimator-provenance.md` (what was borrowed from Qualtran
and Classiq, architecture rather than code).

## v2, and why every published number moved once

Both sets were bumped to **v2 on 2026-08-05**. v1 is gone rather than retained: it held six
values that were not what their cited paper states, and leaving it resolvable would have
kept a wrong-but-citable number one query parameter away from any visitor.

The v1 audit reported three unsourced values in `gidney-2025`, then a fourth. Reading
arXiv:2505.15917 line by line rather than trusting the docstring found **six** — and, the
part worth internalising, found that the paper *states a value for every one of them*.
Nothing had to be invented to fix this.

| value | v1 | v2 | source |
|---|---|---|---|
| physical qubits per patch | `d² + (d−1)²` = 145 at d=9 | `2(d+1)²` = 200 | Gidney §3.2 |
| factory footprint | 15 patches (allowance) | 12 patches | Gidney §3.2, "a 3×4 area" |
| T states per Toffoli | 4 (allowance) | 8 | Gidney §3.2, 8T-to-CCZ |
| factory time | 11 rounds/state, flat | `(14.7 + 4d)/8` rounds/state | Gidney §3.2 |
| threshold | implicitly Gidney's | Fowler & Gidney | arXiv:1808.06709 |
| logical error prefactor | implicitly Gidney's | Fowler & Gidney | arXiv:1808.06709 |

`/repository/benchmark-hea-rzry-cz-16q` went from **1,307,465 to 836,800** physical qubits.
It fell rather than rose because the two largest corrections pull opposite ways: each patch
costs 38% more, and each magic state costs less, because Gidney's factory delivers a CCZ
state in exchange for eight T states where this model prices one state at a time.

**Fourth time an audit's own count has been a floor.** Treat the next one that way.

## The two mechanisms, and why there are two

| mechanism | means | rendered as |
|---|---|---|
| `working_allowances` | **No** source states this value. It is a common working allowance. | "It does not state the values …; those are common working allowances rather than paper values" |
| `value_provenance` | The value came from **somewhere else**: a second paper, or this model departing from its own source. | "`field`: `<where it came from>`." |

They are different claims and must not be substituted for one another. Putting a value in
`working_allowances` when its source *does* state something else prints a false sentence —
the exact failure `working_allowances` was added to end, and the exact failure that then
happened anyway to `t_per_toffoli`, whose source states 8.

Both are checked against the real field names of `AssumptionSet` at construction, so a
misspelling raises instead of silently dropping out of the rendered citation, and a field
may not be in both.

**Neither built-in set has a working allowance in v2.** The mechanism is kept, and exercised
on a set constructed inside the test suite, because the next set added will need it.

## `gidney-2025@v2` — superconducting-style, the default

Source: Gidney, *How to factor 2048 bit RSA integers with less than a million noisy qubits*
([arXiv:2505.15917](https://arxiv.org/abs/2505.15917)).

| field | value | provenance |
|---|---|---|
| `physical_error_rate` | 1e-3 | paper — "a uniform gate error rate of 0.1%" |
| `threshold` | 1e-2 | **Fowler & Gidney** — see below |
| `logical_error_prefactor` | 0.1 | **Fowler & Gidney** — see below |
| `cycle_time_s` | 1e-6 | paper — "a surface code cycle time of 1 microsecond" |
| `reaction_time_s` | 10e-6 | paper — "a control system reaction time of 10 microseconds" |
| `routing_factor` | 2.0 | **Litinski** — the leading term of his data blocks |
| `factory_footprint_logical` | 12.0 | paper — "six magic state factories, each covering a 3×4 area of hot patches" |
| `physical_qubits_per_patch` | `2(d+1)²` | paper — "distance d surface code patches using 2(d + 1)² physical qubits per logical qubit" |
| `t_per_toffoli` | 8 | paper — "8T-to-CCZ distillation [Jon13] to power Toffoli gates … needs 8 T states" |
| `factory_cycles_per_state` | `(14.7 + 4d)/8` | paper's derivation — **departure, see below** |

### The suppression law is not in this paper

`p_L = 0.1(100p)^((d+1)/2)` with a 1% threshold is **Fowler and Gidney,
[arXiv:1808.06709](https://arxiv.org/abs/1808.06709)** — quoted as equation (10) of Litinski
and equation (2) of Webber et al. arXiv:2505.15917 does not use it: it picks a distance by
reading a target of 10⁻¹⁵ per logical qubit round off simulated suppression curves (its
figure 6, fitted as `p_L ∝ 3.5^−d`), which is a shape `AssumptionSet` has no field for.
Carrying `threshold` and `logical_error_prefactor` as if the named paper stated them was the
same class of defect as the four the v1 audit found, and it survived that audit because
nobody checked the two values that looked most standard.

### The factory, and the one departure left in this set

The paper's arithmetic, §3.2:

> "cultivating a T state with a logical error rate of 10⁻⁷ uses 30000 physical qubit ·
> rounds of spacetime volume … suggesting an average cultivation time of 14.7 rounds. The
> factory itself … has 6 layers of lattice surgery. It uses temporally encoded lattice
> surgery so each layer should be able to execute in 2/3d rounds rather than d rounds. **In
> total this amounts to 114.7 rounds per CCZ state, which I round up to 150 rounds for
> slack.**"

So the factory costs `14.7 + 4d` rounds per CCZ state, reproducing 114.7 at the paper's own
`d = 25`. This model takes **the derivation, not the slack-padded 150** the paper carries
forward, because the derivation is the half that says how the cost moves with `d` — which is
the entire reason `factory_cycles_per_state` stopped being a constant. That makes this set
~24% faster at distillation than the figure the paper reports, and the citation says so.

**The constant term is confirmed a second way**, which matters because the first way was
dividing by eight: 30,000 qubit·rounds per cultivated T state, over a 12-patch factory at
d = 25 (12 × 2 × 26² = 16,224 qubits), is 1.85 rounds — and 14.7/8 = 1.84. Those two numbers
never pass through the 114.7. A test pins it.

**One distortion follows from the single magic-state currency, and it is disclosed on the
page.** The paper's factory delivers a *CCZ* state, and its two terms are not alike: the
14.7 cultivates the eight input T states, the `4d` is the 8T-to-CCZ distillation on top.
This model has one currency, so a circuit whose states are plain T gates — every synthesised
rotation in this catalogue — pays a share of a distillation it never performs, and is
pessimistic on factory time by ~3.4× at d = 9. A circuit of Toffolis is charged exactly the
paper's 114.7. Pessimistic is the safe direction for a machine size; splitting the two terms
needs a factory model this flat record does not have.

## `composed-trapped-ion@v2` — trapped ions with shuttling

**Composed from two papers, and the name says so.** No published trapped-ion parameter set
states all of these values in one place; that is structural rather than bad luck. Two
candidates were checked against the field list in session 74 and both were ruled out —
IonQ's April 2026 blueprint uses a different error-correcting code entirely, so its numbers
do not mean the same things, and the Cambridge ASPLOS paper studies memory rather than the
magic-state factories half this cost model is about.

**Physical layer** — Webber, Elfving, Weidt and Hensinger, *The impact of hardware
specifications on reaching quantum advantage in the fault tolerant regime*
([arXiv:2108.12371](https://arxiv.org/abs/2108.12371), AVS Quantum Science **4**, 013801).
Chosen because it costs a trapped-ion architecture **under the surface code**, with the same
logical-error form and the same threshold convention this model already uses — so its numbers
mean here what they mean there.

**Layout layer** — Litinski, *A Game of Surface Codes*
([arXiv:1808.02892](https://arxiv.org/abs/1808.02892), Quantum **3**, 128). Not an arbitrary
second choice: it is the paper Webber et al. take their data blocks from, and its
same-distance convention is the one this model can actually represent.

| field | value | provenance |
|---|---|---|
| `physical_error_rate` | 1e-3 | Webber §3.1 — "The base physical error rate is set to 10⁻³" |
| `threshold` | 1e-2 | Webber §2.2 — "the threshold of the code (here assumed to be 1%)" |
| `logical_error_prefactor` | 0.1 | Webber eq. (2) — `p_L = 0.1(100p)^((d+1)/2)` |
| `cycle_time_s` | 235e-6 | Webber §2 — "a code cycle time of 235 μs … a future shuttling based trapped ion architecture" |
| `reaction_time_s` | 68.75e-6 | Webber §2.3 — `RT = (CC/4) + 10 μs`; at CC = 235 μs that is 68.75 μs |
| `t_per_toffoli` | 4 | Webber §2.1 — "A Toffoli gate can be decomposed using 4 T gates" |
| `physical_qubits_per_patch` | `2d²` | Webber §2.2 — "the number of physical qubits per logical qubit scales as 2d²"; Litinski §4.3 states the same per tile |
| `routing_factor` | 2.0 | Litinski §2 — leading term of both data blocks; **see below** |
| `factory_footprint_logical` | 44.0 | Litinski §4.2 — the 116-to-12 block, **see below** |
| `factory_cycles_per_state` | `9.27d` | Litinski §4.2 + §Translation — **see below** |

### The distillation block was the wrong one for this set's own error rate

v1 used Litinski's **15-to-1** block: 11 tiles, one state every 11 time steps. That is the
block he selects at `p = 10⁻⁴`, and §4.1 is explicit that it does *not* clear `p = 10⁻³` —
its output error of `35p³` misses the 10⁻¹⁰ a billion-gate circuit needs. This set's physical
error rate is 10⁻³. So v1 costed trapped ions with a factory the layout paper rules out at
the error rate the physical-layer paper states.

v2 uses the block he selects at 10⁻³:

> "This 116-to-12 distillation block uses **44 tiles** and distills 12 magic states in 99
> [time steps] with 89% success probability, i.e., **on average one state every 9.27**."

and one time step is `d` code cycles ("Each time step roughly corresponds to d code cycles"),
so `9.27d` rounds per magic state. Four times the space and, at d = 9, 7.6× the time of what
v1 charged.

**What this model cannot represent, stated rather than hidden:** Webber et al. do not use
GoSC's factories. They use the separately-calibrated ones from Litinski's *Magic state
distillation: not as costly as you think* (Quantum **3**, 205), where distillation blocks
carry a *lower* code distance than data blocks. `AssumptionSet` has one distance for the whole
machine. So these factories are more expensive here than in the paper being cited for the
hardware, and the trapped-ion total is correspondingly high.

### The routing constant, still dropped

Litinski's intermediate block stores n logical qubits in `2n + 4` tiles; the fast block Webber
et al. actually use takes `2n + √(8n) + 1`. Both are `2n` to leading order, and this model has
no slot for either constant, so it charges the `2n` and is optimistic by a few patches.
(Litinski's §2.2 prose says 2n+4 while the figure 13 caption says 2.5n+4; the prose figure is
the one repeated in his summary, so it is the one taken.)

### What it buys, checked against the real corpus

Same 16-qubit hardware-efficient ansatz (`benchmark-hea-rzry-cz-16q`), same ε = 1e-6:

| | `gidney-2025@v2` | `composed-trapped-ion@v2` |
|---|---|---|
| code distance | 9 | 9 |
| physical qubits per patch | 200 | 162 |
| data patch qubits | 3,200 | 2,592 |
| factories at the crossover | 346 | 155,280 |
| total physical qubits | 836,800 | 1,106,841,024 |

The two sets share `p`, `p_th` and `A`, so the code distance does not move and **almost every
qubit of the difference is factories**. That is the cited paper's own headline conclusion —
hardware with a slower code cycle can still reach a target runtime, but only by being far more
scalable — reproduced by this arithmetic rather than quoted from its abstract. In v2 the gap is
wider than the 235× clock ratio alone, because the two sets now use the different factories
their sources actually specify.

These two estimates must never be ranked against each other. `comparable_with` refuses on
identity, and `/v1/catalog/estimates` states one set once for the whole payload so a client
holding it has nothing inside it to rank across.

## What both sets still share, and what is still open

- **The default factory count is the crossover**, and for a small circuit it dominates the
  total: a 16-qubit ansatz reports 836,800 qubits of which 830,400 are factories. Both numbers
  are right and the panel shows the split, but "the fewest factories at which the reaction
  floor binds" is a *speed* choice being reported as a *size*. Whether that is the right
  default for a public catalogue is a product decision, filed in `memory/OWNER_TODO.md` rather
  than changed here.
- **Storage error outside the serial chain is ignored** by `_logical_operation_count`, so the
  chosen distance stays optimistic. Stated in that function's docstring.
- **`AssumptionSet` is still one flat record of scalars** where Qualtran has four objects
  (`physical_params`, `qec_scheme`, `data_block`, `factory`). v2 gave the factory back its
  distance dependence and the patch back its per-set conversion, which were the two places that
  flatness was actively producing wrong numbers. The remaining seam is the one above: a factory
  whose per-T and per-Toffoli costs differ needs a `factory` object.

## Adding a set

1. It must be **sourced**, not invented. A fabricated set makes an incomparable estimate look
   comparable, which is worse than having one set.
2. Any value not from `source_citation` goes in `working_allowances` (no source states it) or
   `value_provenance` (it came from somewhere else). Picking the wrong one prints a false
   sentence on a public page.
3. **Open the PDF and find the sentence.** Every value in the v1 table above had a docstring
   claiming a source, and six of them were wrong. A citation is not evidence that anyone
   checked.
4. Add it to `BUILTIN_ASSUMPTION_SETS`. It is reachable immediately at
   `/v1/catalog/entries/{slug}/estimate?assumptions=<identity>`.
5. **Do not change the default.** Every cost on `/repository` renders without naming a set, so
   the default is what the published numbers mean.
