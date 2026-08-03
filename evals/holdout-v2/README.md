# End-to-end generalization holdout v2

This set was frozen after diagnosing holdout v1 and before the first v2 LLM run.
It contains no v1 task instances and must not be edited in response to v2 outcomes.
If an oracle is invalid, retain the original report and publish a new corpus version.

Protocol:

1. Only each YAML `prompt`, framework, and normal run context are passed to the
   pipeline. The harness alone reads `expect` after execution.
2. Keep model routing, prompts, retry policy, and implementation fixed for the full
   v2 run. Do not repair or rerun selected cases as the headline v2 result.
3. Report pass rate with its Wilson interval, first-candidate passes, mean candidates,
   false positives, false negatives, and recorded token usage. Recorded usage excludes
   failed provider calls that were not durably persisted and is not a billing total.
4. Local subprocess runs evaluate agent behavior, not the production network-locked
   sandbox boundary.

The numeric oracles were derived independently before the first run:

- phase estimation, GHZ stabilizers, SWAP-test identities, amplitude damping, and GHZ
  quantum Fisher information use closed-form calculations;
- project selection and job assignment use exhaustive enumeration of every binary
  decision string;
- the Loschmidt echo uses independent SciPy matrix exponentiation of both Hamiltonians.

No expected answer is embedded in the product prompt or runtime code.
