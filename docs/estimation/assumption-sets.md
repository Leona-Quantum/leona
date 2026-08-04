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

## The two mechanisms, and why there are two

| mechanism | means | rendered as |
|---|---|---|
| `working_allowances` | **No** source states this value. It is a common working allowance. | "It does not state the values …; those are common working allowances rather than paper values" |
| `value_provenance` | The value came from **somewhere else**: a second paper, or this model departing from its own source. | "`field`: `<where it came from>`." |

They are different claims and must not be substituted for one another. Putting a value in
`working_allowances` when its source *does* state something else prints a false sentence —
the exact failure `working_allowances` was added to end.

Both are checked against the real field names of `AssumptionSet` at construction, so a
misspelling raises instead of silently dropping out of the rendered citation, and a field
may not be in both.

## `gidney-2025@v1` — superconducting-style, the default

Source: Gidney, *How to factor 2048 bit RSA integers with less than a million noisy qubits*
([arXiv:2505.15917](https://arxiv.org/abs/2505.15917)).

| field | value | provenance |
|---|---|---|
| `physical_error_rate` | 1e-3 | paper — "uniform depolarizing noise … 1 error per 1000 gates" |
| `threshold` | 1e-2 | standard surface-code figure, consistent with the paper's `p_L` form |
| `logical_error_prefactor` | 0.1 | paper's suppression form |
| `cycle_time_s` | 1e-6 | paper — "a surface code cycle time of 1 microsecond" |
| `reaction_time_s` | 10e-6 | paper — "a control system reaction time of 10 microseconds" |
| `routing_factor` | 2.0 | **working allowance** |
| `factory_footprint_logical` | 15.0 | **working allowance** |
| `t_per_toffoli` | 4 | **working allowance** |
| `factory_cycles_per_state` | 11 | **departure — see below** |

### The fourth one, found by checking rather than by reading the docstring

The pass that introduced `working_allowances` recorded **three** unsourced values in this
set. There are four. `factory_cycles_per_state = 11` was carried as sourced, and the paper
states a factory timing that is not it:

> "In total this amounts to 114.7 rounds per CCZ state, which I round up to 150 rounds for
> slack." — §Runtime

One CCZ state is one Toffoli, which this model charges as `t_per_toffoli = 4` magic states.
So the paper's factory delivers a magic state every **150 / 4 ≈ 37.5** surface-code rounds,
and this set charges **11** — roughly **3.4× faster than the cited hardware**. It flows into
`magic_states_per_second_per_factory`, and from there into the throughput term, the factory
crossover, and — because `factory_count` defaults to the crossover — the reported footprint.

**The number has deliberately not been changed.** Correcting it moves a published figure on
`/repository` and requires a version bump to `gidney-2025@v2`, which is an owner decision
(`memory/OWNER_TODO.md`). What has changed is that the citation no longer claims the paper
for it. Treating the earlier count of three as complete is what let this sit; treat any
audit's own count of what it fixed as a floor.

## `composed-trapped-ion@v1` — trapped ions with shuttling

**Composed from two papers, and the name says so.** No published trapped-ion parameter set
states all ten values in one place; that is structural rather than bad luck. Two candidates
were checked against the field list in session 74 and both were ruled out — IonQ's April 2026
blueprint uses a different error-correcting code entirely, so its numbers do not mean the
same things, and the Cambridge ASPLOS paper studies memory rather than the magic-state
factories half this cost model is about.

**Physical layer** — Webber, Elfving, Weidt and Hensinger, *The impact of hardware
specifications on reaching quantum advantage in the fault tolerant regime*
([arXiv:2108.12371](https://arxiv.org/abs/2108.12371), AVS Quantum Science **4**, 013801).
Chosen because it costs a trapped-ion architecture **under the surface code**, with the same
logical-error form and the same threshold convention this model already uses — so its numbers
mean here what they mean there.

**Layout layer** — Litinski, *A Game of Surface Codes*
([arXiv:1808.02892](https://arxiv.org/abs/1808.02892), Quantum **3**, 128). Not an arbitrary
second choice: it is the paper Webber et al. take their distillation blocks from.

| field | value | provenance |
|---|---|---|
| `physical_error_rate` | 1e-3 | Webber §3.1 — "The base physical error rate is set to 10⁻³" |
| `threshold` | 1e-2 | Webber §2.2 — "the threshold of the code (here assumed to be 1%)" |
| `logical_error_prefactor` | 0.1 | Webber eq. (2) — `p_L = 0.1(100p)^((d+1)/2)`, i.e. `A = 0.1` at `p_th = 1e-2` |
| `cycle_time_s` | 235e-6 | Webber §2 — "a code cycle time of 235 μs … a future shuttling based trapped ion architecture" |
| `reaction_time_s` | 68.75e-6 | Webber §2.3 — `RT = (CC/4) + 10 μs`; at CC = 235 μs that is 68.75 μs. Arithmetic on two stated values, not a third assumption. |
| `t_per_toffoli` | 4 | Webber §2.1 — "A Toffoli gate can be decomposed using 4 T gates" |
| `routing_factor` | 2.0 | Litinski §2 — the intermediate data block stores n logical qubits in **2n + 4** tiles. This model has no slot for the constant +4, so it charges the 2n and is optimistic by four patches. |
| `factory_footprint_logical` | 11.0 | Litinski §3.3 — "The 15-to-1 distillation block uses **11 tiles**". One tile is one logical patch; Litinski converts tiles to physical qubits as `2d²`, which is what `d² + (d−1)²` computes. |
| `factory_cycles_per_state` | 11 | **departure** — Litinski states 11 *time steps*, and one time step as *d* code cycles: **11d** rounds per magic state. This model holds a distance-independent constant. |

### What it buys, checked against the real corpus

Same 16-qubit hardware-efficient ansatz (`benchmark-hea-rzry-cz-16q`), same ε = 1e-6:

| | `gidney-2025@v1` | `composed-trapped-ion@v1` |
|---|---|---|
| code distance | 9 | 9 |
| data patch qubits | 2,320 | 2,320 |
| factories at the crossover | 599 | 20,474 |
| total physical qubits | 1,307,465 | 32,660,670 |

The two sets share `p`, `p_th` and `A`, so the code distance barely moves and **every qubit
of the difference is factories**. That is the cited paper's own headline conclusion —
hardware with a slower code cycle can still reach a target runtime, but only by being far
more scalable — reproduced by this arithmetic rather than quoted from its abstract.

These two estimates must never be ranked against each other. `comparable_with` refuses on
identity, and `/v1/catalog/estimates` states one set once for the whole payload so a client
holding it has nothing inside it to rank across.

## The model limitation both sets share

`factory_cycles_per_state` is a distance-independent integer, and **every published source
states factory time as a function of the code distance** (Litinski: `11d` rounds;
Gidney: 150 rounds at the paper's own `d = 25`). Both built-in sets therefore understate
distillation time, which makes the throughput term and the default factory count optimistic.

The seam to reopen is the one `plans/leona-estimator-provenance.md` §3 already names:
`AssumptionSet` collapses four Qualtran objects (`physical_params`, `qec_scheme`,
`data_block`, `factory`) into one flat record of scalars. A factory whose cost is a function
of `d` needs the `factory` half of that back. Until then this is disclosed on the page rather
than hidden in a docstring, which is the whole point of `value_provenance`.

## Adding a set

1. It must be **sourced**, not invented. A fabricated set makes an incomparable estimate look
   comparable, which is worse than having one set.
2. Any value not from `source_citation` goes in `working_allowances` (no source states it) or
   `value_provenance` (it came from somewhere else). Picking the wrong one prints a false
   sentence on a public page.
3. Add it to `BUILTIN_ASSUMPTION_SETS`. It is reachable immediately at
   `/v1/catalog/entries/{slug}/estimate?assumptions=<identity>`.
4. **Do not change the default.** Every cost on `/repository` renders without naming a set,
   so the default is what the published numbers mean.
