# Targeted unseen corroboration holdout v4

This four-case set was frozen after all implementation changes and before its first
LLM run. It uses new instances and task families to test whether the reference-audit,
Plan-normalization, matrix-rank, and operator-order changes transfer beyond the cases
that motivated them. Do not edit it after observing outcomes.

Oracles were fixed before the run: exhaustive enumeration for both constrained
optimization cases and independent SciPy matrix exponentiation for both scientific
cases. The harness-only `expect` values are never sent to the product pipeline.

Report first-candidate success, candidates, false positives, false negatives, Wilson
uncertainty, and durably recorded token use. Local sandbox results do not validate the
production network boundary.
