# AGENTS.md — majorana-frameworks

Selected-framework source code is the circuit source of truth. This package owns the
small execution protocol shared by every generated framework-native program:
source normalization/fingerprints, final-circuit binding checks, native-optimization
evidence, and optional OpenQASM interchange extraction.

- Never rewrite verified source through another framework.
- Keep SDK circuit objects inside the sandbox process.
- OpenQASM is optional interchange data for cross-framework conversion, not a
  verification or persistence prerequisite.
- Unsupported framework conversions fail explicitly; never claim a lossy conversion
  is lossless.
