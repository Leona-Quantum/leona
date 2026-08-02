# End-to-end generalization holdout v3

This set was frozen after the v2 baseline and generic-fix diagnostics, before its first
LLM run. It contains new task families or instances and must not be edited in response
to outcomes. Retain every report, including failures and false positives.

Protocol:

1. The LLM receives the YAML `prompt`, framework, and normal runtime context only.
   `expect` remains harness-only.
2. Run every case with identical model routing, prompts, retry policy, and sandbox.
3. Report Wilson uncertainty, first-candidate passes, candidate count, false positives,
   false negatives, and durably recorded token use. Recorded use is not billing total.
4. A local sandbox run evaluates agent behavior but not the production egress boundary.

Independent pre-run oracles:

- superdense coding, the Hadamard test, the bit-flip Choi state, and cluster-state
  entropy use closed-form identities;
- weighted MaxCut and set cover use exhaustive binary enumeration;
- product-formula and spectral-form-factor values use independent SciPy matrix
  exponentiation with explicit array shapes.

No expected result is included in the product prompt or runtime implementation.
