# End-to-end generalization holdout v1

This frozen set spans two cases at each of four difficulty levels. It is separate
from `evals/corpus/`, whose failures may be used for calibration.

Protocol:

1. The pipeline receives only each YAML `prompt`, framework, and normal run context.
   The `expect` block is read by the harness after execution and is not sent to an
   LLM.
2. Do not change agent prompts, model routing, retry policy, or code in response to an
   individual v1 outcome. Fix an invalid oracle by publishing a new version and retain
   the original report.
3. Use v1 for the current clean baseline and later regression checks. After inspecting
   v1 outcomes, use a newly frozen v2 for the next unbiased generalization estimate.
4. Report pass rate with its Wilson interval, stable all-trials pass count,
   first-candidate passes, mean candidates, false positives, false negatives, and
   recorded token usage. Recorded usage is not a provider billing total.
5. Local subprocess runs measure agent behavior only. Production acceptance still
   requires the network-locked production sandbox.

The numeric oracles were computed independently before the first LLM run:

- facility selection and knapsack: exhaustive enumeration;
- cycle walk and OTOC: SciPy matrix exponentiation;
- quantum kernel: direct Qiskit Statevector overlaps followed by Hermitian
  eigendecomposition;
- SSH: the phase of the closed product of normalized lower-band overlaps.

The two basic algorithms have exact deterministic support. None of the expected
answers is embedded in the product prompt or runtime code.
