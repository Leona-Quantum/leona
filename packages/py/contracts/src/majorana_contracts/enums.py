"""Closed enums shared across every boundary. Values match the DB CHECK constraints
(plans/rebuild/04-database.md §2) — additive changes only within /v1."""

from enum import StrEnum


class Framework(StrEnum):
    QISKIT = "qiskit"
    PENNYLANE = "pennylane"
    CIRQ = "cirq"


class RunMode(StrEnum):
    CHAT = "chat"
    EXECUTE = "execute"
    IDEATE = "ideate"
    EXPLAIN = "explain"


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Stage(StrEnum):
    """Pipeline stages in execution order; the orchestrator owns transitions."""

    PLAN = "plan"
    GENERATE = "generate"
    SCREEN = "screen"
    RESOURCE_ESTIMATE = "resource_estimate"
    VERIFY = "verify"
    COMPILE = "compile"
    COMPILED_RESOURCE_ESTIMATE = "compiled_resource_estimate"
    FINALIZE = "finalize"
    FINAL_EXECUTE = "final_execute"
    BASELINE = "baseline"
    ANALYZE = "analyze"
    SAVE = "save"

    # Legacy event values remain parseable for stored runs created before the
    # expanded pipeline contract. They are not part of the new execution order.
    SIMULATE = "simulate"
    EXPORT = "export"


class VerifierDecision(StrEnum):
    PASS = "pass"
    FAIL = "fail"
    INCONCLUSIVE = "inconclusive"


class VerificationMethod(StrEnum):
    EXACT = "exact"
    STATISTICAL = "statistical"
    BRUTE_FORCE = "brute_force"
    EXACT_DIAG = "exact_diag"
    RETURN_CONTRACT = "return_contract"
    QASM_PARSE = "qasm_parse"


class VerificationResultKind(StrEnum):
    PASS = "pass"
    FAIL = "fail"


class ExportStatus(StrEnum):
    LOSSLESS = "lossless"
    LOSSY_WITH_REASON = "lossy_with_reason"
    DOWNLOAD_ONLY = "download_only"
    UNSUPPORTED = "unsupported"


class Visibility(StrEnum):
    PRIVATE = "private"
    PUBLIC = "public"


class WorkspaceKind(StrEnum):
    PERSONAL = "personal"
    TEAM = "team"
    SYSTEM = "system"


class ArtifactKind(StrEnum):
    """Catalog classification (repository Step 3); unset for pre-catalog artifacts."""

    CIRCUIT = "circuit"
    GATE = "gate"
    ALGORITHM_TEMPLATE = "algorithm_template"
    STATE_PREPARATION = "state_preparation"
    OPERATOR = "operator"
    BENCHMARK_INSTANCE = "benchmark_instance"
    LITERATURE_METHOD = "literature_method"


class ExecutionState(StrEnum):
    EXECUTABLE = "executable"
    TEMPLATE_ONLY = "template_only"
    DOCUMENTATION_ONLY = "documentation_only"
    UNSUPPORTED = "unsupported"


class ReviewState(StrEnum):
    DRAFT = "draft"
    QUARANTINED = "quarantined"
    PENDING_REVIEW = "pending_review"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class PublicationState(StrEnum):
    PRIVATE = "private"
    STAGED = "staged"
    PUBLIC = "public"
    RETRACTED = "retracted"
    DEPRECATED = "deprecated"


class SourceKind(StrEnum):
    """Catalog provenance (repository Step 4)."""

    GIT = "git"
    PACKAGE = "package"
    UPLOAD = "upload"
    BENCHMARK_MANIFEST = "benchmark_manifest"
    LITERATURE = "literature"


class LicenseAssertionKind(StrEnum):
    DECLARED = "declared"
    DETECTED = "detected"


class LicenseScope(StrEnum):
    WHOLE = "whole"
    FILE = "file"
    VARIANT = "variant"


class LicenseDecision(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    QUARANTINED = "quarantined"


class CitationRelation(StrEnum):
    DESCRIBES = "describes"
    ORIGINAL_SOURCE = "original_source"
    BENCHMARK_REFERENCE = "benchmark_reference"
    IMPLEMENTATION_OF = "implementation_of"


class ImportProvider(StrEnum):
    """Closed allowlist (repository Step 5 plan §5.3/§7.1); grows only after a
    new adapter's adversarial fixture tests pass."""

    LOCAL_FIXTURE = "local_fixture"


class ImportJobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    COMPLETED_WITH_REJECTIONS = "completed_with_rejections"
    FAILED = "failed"
    DEAD = "dead"


class ImportItemState(StrEnum):
    """`quarantined` means raw bytes safely stored awaiting parse (plan §6
    step 4) — distinct from the catalog review_state quarantine (rights
    hold, migrations 0014/0015)."""

    QUEUED = "queued"
    FETCHING = "fetching"
    QUARANTINED = "quarantined"
    PARSING = "parsing"
    STAGED = "staged"
    REJECTED = "rejected"
    RETRY_WAIT = "retry_wait"
    DEAD = "dead"


class Role(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"
    VIEWER = "viewer"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    DEAD = "dead"


class Algorithm(StrEnum):
    VQE = "VQE"
    QAOA = "QAOA"
    GROVER = "Grover"
    BELL = "Bell"
    GHZ = "GHZ"
    QFT = "QFT"
    QPE = "QPE"
    AMPLITUDE_ESTIMATION = "AmplitudeEstimation"
    STATE_PREPARATION = "StatePreparation"
    CIRCUIT_SYNTHESIS = "CircuitSynthesis"
    GATE_DECOMPOSITION = "GateDecomposition"
    TRANSPILATION = "Transpilation"
    SIMULATION = "Simulation"
    ERROR_CORRECTION = "ErrorCorrection"
    OTHER = "other"


class Optimizer(StrEnum):
    COBYLA = "COBYLA"
    SPSA = "SPSA"
    L_BFGS_B = "L_BFGS_B"


class ArtifactType(StrEnum):
    SCRIPT = "script"
    FUNCTION = "function"
    CLASS = "class"
    QUANTUM_CIRCUIT = "QuantumCircuit"
    OPENQASM = "OpenQASM"
    COUNTS = "counts"
    STATEVECTOR = "statevector"
    OPERATOR = "operator"
    CLIFFORD = "clifford"
    PASS_MANAGER = "pass_manager"
    OTHER = "other"


class MeasurementPolicy(StrEnum):
    NONE = "none"
    ONLY_IF_REQUESTED = "only_if_requested"
    MEASURE_ALL = "measure_all"
    SPECIFIED = "specified"
    NOT_APPLICABLE = "not_applicable"


class TopLevelExecution(StrEnum):
    REQUIRED = "required"
    DEMO_ONLY = "demo_only"
    FORBIDDEN = "forbidden"


class BaselineKind(StrEnum):
    MAXCUT = "maxcut"
    QUBO = "qubo"
    PORTFOLIO = "portfolio"
    HAMILTONIAN = "hamiltonian"
    NONE = "none"


class UsageKind(StrEnum):
    RUN = "run"
    LLM_TOKENS = "llm_tokens"
    SANDBOX_SECONDS = "sandbox_seconds"
