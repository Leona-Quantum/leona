# AGENTS.md — majorana-ir

Canonical circuit IR + framework connectors + export classification. Salvaged and
renamespaced from the quepo `qhte` engine (plans/rebuild/08-phases.md §Phase 2 step 5).

- **Pure**: pydantic + stdlib only. `qiskit` is an optional extra used solely by the
  object-import path in `connectors/qiskit_bridge.py`; never import it at module top level.
- **The IR is deliberately narrow** (`docs/CAPABILITY_MATRIX.md` in the salvage): terminal
  measurement only, no mid-circuit feed-forward, fixed gate set. Do not widen it casually —
  the narrowness is what makes export classification honest.
- **Export classification is the honesty promise** (`export.py`). Two rules, from the eval
  adjudications (`evals/benchmark-suite-v0.md`):
  - JC-2: never hard-code a status for a (gate, target) pair — derive it from what the
    connectors can actually produce.
  - JC-5: when the blocker is the IR's limit, the reason cites the *IR layer* and
    acknowledges the target format could otherwise express it.
- **Fingerprints** (`circuit_fingerprint`) dedupe artifact versions; canonicalization must
  make any two semantically-identical circuits byte-identical (incl. typed_params).
