"""Pure VQE domain package. See AGENTS.md for the hard rules (no framework
imports, immutable models, no path/module/code in data fields)."""

# Package-level schema version. Individual model types (ComponentSpec,
# WorkflowSpec, ScientificExperimentSpec, EvaluationProtocol) each carry their
# own `schema_version` field rather than trusting this alone, so a future
# partial migration of one model type doesn't silently misreport another's
# version. Additive-minor convention (see packages/py/contracts/AGENTS.md
# §Versioning): minor = backward-compatible additions, major = breaking,
# patch = wire-invisible fixes.
VQE_SCHEMA_VERSION = "0.1.0"

__all__ = ["VQE_SCHEMA_VERSION"]
