# Verification domain docs

The verification tier framework Nameko follows: classify the circuit, run the
strongest feasible checks, state exactly what is and is not proven. Source: owner
research pack (Coda conversation → `Codex/2026-07-11` distillation), adopted
2026-07-11.

- `nameko_verification_playbook.md` — the operational guide: Tier 1/2/3 confidence
  tiers, feasibility regimes, technique catalog, per-circuit-family checks,
  response template, confidence-language rules.
- `nameko_verification_examples.md` — worked examples (100-qubit QFT Tier-2
  walkthrough, GHZ/stabilizer Tier-1 concept; the source PDF cut off before the
  GHZ results — do not invent them).
- `nameko_verification_ai_context.md` — compact drop-in prompt for agents working
  on Nameko verification behavior (feeds the Phase-3 chat-surface prompts).
- `statistical-counts-check.md` — the framework-native re-execution contract behind
  the pipeline's headless `statistical` method.

How this maps to the engine today (`packages/py/verification`):

| Playbook concept | Engine primitive |
|---|---|
| Framework-native reproducibility | `verify_statistical_counts_pair` over two sandbox executions |
| Direct simulation for explicit conversion checks | `simulate_statevector`, `counts_vs_ideal` |
| OpenQASM interchange parseability | `verify_qasm_parse` (conversion paths only) |
| Structural contract | `verify_return_contract` |
| Exact unitary equivalence (needs a reference circuit) | `verify_exact` (chat surface only, not headless) |

Not yet built (Phase-3+ candidates from the playbook): stabilizer simulation,
echo/inverse tests, sub-block verification, small-instance extrapolation,
tensor-network/MPS, XEB. The confidence-language labels
(`verified_by_direct_simulation`, `statistical_fidelity_evidence`, …) should reach
the user-facing verification records when the Nameko chat surface lands.
