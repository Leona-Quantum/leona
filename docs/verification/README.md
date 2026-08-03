# Verification domain docs

The verification tier framework Nala follows: classify the circuit, run the
strongest feasible checks, state exactly what is and is not proven. Source: owner
research pack (Coda conversation → `Codex/2026-07-11` distillation), adopted
2026-07-11.

- `nameko_verification_playbook.md` — the operational guide: Tier 1/2/3 confidence
  tiers, feasibility regimes, technique catalog, per-circuit-family checks,
  response template, confidence-language rules. **The closest existing artifact to a
  per-block analysis ledger** — an input to the block-repository design, not a
  historical document.
- `nameko_verification_examples.md` — worked examples (100-qubit QFT Tier-2
  walkthrough, GHZ/stabilizer Tier-1 concept; the source PDF cut off before the
  GHZ results — do not invent them).
- `nameko_verification_ai_context.md` — compact drop-in prompt for agents working
  on Nala verification behavior. **Divergence not measured:** the live prompts are
  `packages/py/llm/prompts.py`, now 123.8 KB. Treat this file as design intent and
  read the module for what actually ships.
- `statistical-counts-check.md` — the two-execution TVD `statistical` check.
  **Historical as of 2026-08-04:** `verify_statistical_counts_pair` is still exported
  from `majorana_verification` but has no non-test caller.

## How this maps to the engine today

Two enums, and the difference between them is the whole picture
(`packages/py/contracts/src/majorana_contracts/enums.py`):

- **`VerificationMethod` — 15 members.** Every check name the verifier can *emit*.
  `run_events` is the only channel a human or the UI has into a run, and its
  `verification.result` event types `method` as this enum, so the list is exhaustive on
  purpose and the emitter fails loudly when a check is missing. Until 2026-07-20 the six
  contract checks were absent and the emitter silently discarded six of the ten checks
  the panel ran.
- **`PlannableVerificationMethod` — 4 members** (`statistical`, `return_contract`,
  `exact_diag`, `brute_force`). The planner's JSON schema is built from *this* enum, so
  a model doing schema-guided decoding cannot request a method with no dispatch branch
  in the worker. Under ADR-0023 the plannable *reference* methods are narrower still:
  `_SUPPORTED_REFERENCE_METHODS` in `simple_plan.py` is `("exact_diag", "brute_force")`.

**Adding a member to `VerificationMethod` is half of a change.** The database allowlist
(`ck_method_enum` on `verification_records`) is the other half and must widen in the same
deploy — it has been rewritten three times so far, by migrations 0023, 0024 and 0027.
`packages/py/contracts/tests/test_method_allowlist.py` enforces the pairing rather than
leaving it to memory. Also decide which side of
`PHYSICAL_VERIFICATION_METHODS` the new name falls on.

| `VerificationMethod` | Plannable | Physical | Engine primitive (`packages/py/verification`) |
|---|---|---|---|
| `exact` | **no — legacy** | yes | `verify_exact` / `verify_exact_native`. No new Plan can select it: a planner-authored reference circuit is not correctness authority. Historical rows and events stay readable |
| `statistical` | yes | yes | `verify_statistical`, `verify_statistical_counts` — reported counts against an ideal distribution |
| `statistical_native` | no | yes | `verify_native_statistical_counts` / `verify_native_sampled_counts`. Run opportunistically by the worker when the observer produced the evidence. The mid-circuit-capable physical check — feed-forward circuits have no statevector but sample fine |
| `exact_diag` | yes | yes | `verify_exact_diag` — independent ground truth, and the only physical evidence a variational run can earn (a VQE reports a scalar, so `statistical` has no distribution to judge) |
| `brute_force` | yes | yes | `verify_brute_force` — enumerate a declared ≤16-variable maxcut/QUBO instance against the true optimum. Speaks a CUT metric's own units, which `exact_diag` structurally cannot |
| `bell_state_property` | no | yes | `verify_bell_state_property` — the complete framework-native statevector against an explicit typed relative-phase target |
| `ghz_state_property` | no | yes | `verify_ghz_state_property` — the same, for GHZ |
| `return_contract` | yes | no | `verify_return_contract` |
| `qasm_parse` | no | no | `verify_qasm_parse` — conversion interchange paths only |
| `structural` | no | no | contract check: run unconditionally, no plan requests it |
| `resource_contract` | no | no | contract check |
| `measurement_policy` | no | no | contract check |
| `success_criteria` | no | no | contract check |
| `native_optimization_evidence` | no | no | contract check |
| `statistical_reproducibility` | no | **no, deliberately** | two executions of the *same* candidate agreeing. Excluded from the physical set because a consistently wrong program also agrees with itself |

Supporting primitives that are not themselves methods: `simulate_statevector`,
`simulate_statevector_matching_width`, `counts_vs_ideal` (`statevector.py`), plus the
reference builders in `baseline.py`, `hamiltonian.py`, `dynamics.py`, `lindblad.py`,
`linear_system.py` and `phase_estimation.py`.

**The six contract checks police shape only.** `PHYSICAL_VERIFICATION_METHODS` is the
line between "the circuit is well-formed" and "the circuit does what the physics says",
and a verdict answers PHYSICAL only if at least one check in that set both ran *and*
passed. That is the distinction "Structurally verified" carries in the UI
(`docs/ui/copy.md`) — a real pass whose evidence was contract checks only.

## Still not built

From the playbook, and still open: stabilizer simulation, echo/inverse tests, sub-block
verification, small-instance extrapolation, tensor-network/MPS, XEB. **Sub-block
verification is the one the block-repository direction makes urgent** — a per-block
evidence ledger is that check, scoped.

Separately unbuilt, from ADR-0018: the version-bound public evidence tables
(`artifact_verifications`, `conversion_attempts`) exist in no migration and no ORM model,
so catalog support labels are not derived from stored evidence. See the annotation on
that ADR.

The confidence-language labels (`verified_by_direct_simulation`,
`statistical_fidelity_evidence`, …) should reach the user-facing verification records
when the Nala chat surface lands.
