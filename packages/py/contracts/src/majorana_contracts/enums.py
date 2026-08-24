"""Closed enums shared across every boundary. Values match the DB CHECK constraints
(plans/archive/rebuild/04-database.md §2, archived; live schema authority is
majorana/docs/runbooks/database.md) — additive changes only within /v1."""

from collections.abc import Iterable, Mapping
from enum import StrEnum
from typing import Any


class Framework(StrEnum):
    QISKIT = "qiskit"
    PENNYLANE = "pennylane"
    CIRQ = "cirq"
    BRAKET = "braket"
    QIBO = "qibo"
    QULACS = "qulacs"


class CircuitCompiler(StrEnum):
    """Trusted third-party compiler selected for a bounded Studio IR job."""

    QISKIT = "qiskit"
    CIRQ = "cirq"
    PYTKET = "pytket"
    PENNYLANE = "pennylane"
    PYZX = "pyzx"
    BQSKIT = "bqskit"


class CircuitOptimizationGate(StrEnum):
    """Gate subset that Studio can round-trip through every framework draft."""

    H = "H"
    X = "X"
    Y = "Y"
    Z = "Z"
    S = "S"
    T = "T"
    RX = "RX"
    RY = "RY"
    RZ = "RZ"
    CX = "CX"
    CZ = "CZ"
    SWAP = "SWAP"
    MEASURE = "M"


class RunMode(StrEnum):
    # AUTO is a *request*, never an outcome: the worker resolves it to one of the
    # modes below from the user's intent before dispatching, and rewrites the run
    # row to the resolved value. No run should finish still holding it.
    AUTO = "auto"
    CHAT = "chat"
    EXECUTE = "execute"
    IDEATE = "ideate"
    EXPLAIN = "explain"
    QAPP = "qapp"


class QappExecutionStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


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


class SemanticReviewDecision(StrEnum):
    """What the evidence-reading LLM recommends before the strict gate runs."""

    READY = "ready"
    CODE_REPAIR = "code_repair"
    REPLAN = "replan"
    INCONCLUSIVE = "inconclusive"


class VerificationFailureClass(StrEnum):
    """Why verification could not continue or reach PASS."""

    CANDIDATE_DEFECT = "candidate_defect"
    PLAN_DEFECT = "plan_defect"
    EVIDENCE_GAP = "evidence_gap"
    CAPABILITY_LIMIT = "capability_limit"
    VERIFIER_FAILURE = "verifier_failure"
    EVIDENCE_CONFLICT = "evidence_conflict"


class RetryTarget(StrEnum):
    """The component allowed to act on typed verification feedback."""

    CODE_GENERATION = "code_generation"
    PLANNING = "planning"
    SIMULATION = "simulation"
    VERIFICATION = "verification"
    NONE = "none"


class VerificationMethod(StrEnum):
    """Every check name the verifier can emit — not only the plannable ones.

    The list is exhaustive on purpose. `run_events` is the only channel a human or
    the UI has into a run, and its `verification.result` event types `method` as
    this enum. The emitter now fails loudly when a check is missing here
    (`agent_events.py`). Until 2026-07-20 the six contract checks below were absent,
    and the emitter silently discarded six of the ten checks the panel actually
    runs. Production QPE run 019f7f2d-09c9 rejected its first candidate on one of
    them: the critic was never invoked, so a deterministic check had failed, and the
    event stream showed three passing checks and no failure at all. The run bought a
    second candidate and a second sandbox execution for a reason nothing recorded.

    **Adding a member here is half of a change.** The database allowlist
    (`ck_method_enum` on `verification_records`) is the other half and must widen in
    the same deploy — see db/migrations/versions/0024. That pairing is enforced by
    packages/py/contracts/tests/test_method_allowlist.py rather than remembered.
    Also decide which side of `PHYSICAL_VERIFICATION_METHODS` the new name falls on.
    The six historical contract checks police shape only; the Bell/GHZ property
    methods added later prove fixed state-preparation claims.
    """

    # Legacy method: historical events and rows remain readable, but new Plans
    # cannot select it because planner-authored reference circuits are not
    # correctness authority.
    EXACT = "exact"
    STATISTICAL = "statistical"
    # Reported counts vs a trusted re-execution of the actual circuit object
    # through the selected framework's own sampler (fixed seed). The
    # mid-circuit-capable physical check: feed-forward circuits have no
    # statevector but sample fine. Run opportunistically by the worker whenever
    # the observer produced the evidence — not plannable.
    STATISTICAL_NATIVE = "statistical_native"
    BRUTE_FORCE = "brute_force"
    EXACT_DIAG = "exact_diag"
    RETURN_CONTRACT = "return_contract"
    QASM_PARSE = "qasm_parse"
    # Contract checks. The verifier runs these unconditionally, no plan requests
    # them, and none of them is physical evidence.
    STRUCTURAL = "structural"
    RESOURCE_CONTRACT = "resource_contract"
    MEASUREMENT_POLICY = "measurement_policy"
    SUCCESS_CRITERIA = "success_criteria"
    NATIVE_OPTIMIZATION_EVIDENCE = "native_optimization_evidence"
    # Fixed-policy state-preparation checks over framework-native statevectors.
    # Unlike a counts-only comparison, these checks prove the explicitly accepted
    # relative phase as well as the computational-basis support.
    BELL_STATE_PROPERTY = "bell_state_property"
    GHZ_STATE_PROPERTY = "ghz_state_property"
    # Two executions of the SAME candidate agreeing. Excluded from the physical
    # set deliberately: a consistently wrong program also agrees with itself.
    STATISTICAL_REPRODUCIBILITY = "statistical_reproducibility"


class PlannableVerificationMethod(StrEnum):
    """The subset of VerificationMethod the worker can actually evaluate.

    The planner's JSON schema is built from this enum, not from VerificationMethod,
    so a model doing schema-guided decoding cannot request a method that has no
    dispatch branch in the worker. The wider enum stays intact because stored runs
    and the 0001 check constraint still carry the retired values.
    """

    STATISTICAL = "statistical"
    RETURN_CONTRACT = "return_contract"
    # The independent-ground-truth check, and the only physical evidence a
    # variational run can earn: a VQE reports a scalar, so `statistical` has no
    # distribution to judge and `exact` has no reference circuit to match. Added
    # 2026-07-20; `exact_diag` had been in VerificationMethod and in the database
    # allowlist since 0001 with no implementation and no way for a plan to ask.
    EXACT_DIAG = "exact_diag"
    # The combinatorial sibling: enumerate a declared <=16-variable maxcut/QUBO
    # instance and compare the reported objective against the true optimum — the
    # check that speaks a CUT metric's own units, which exact_diag structurally
    # cannot (production run 019f7f81-4a61 pointed an energy check at a cut
    # weight and burned four correct candidates). Same 0001-era dormancy story:
    # the name was in VerificationMethod and the database allowlist all along.
    BRUTE_FORCE = "brute_force"


class VerificationResultKind(StrEnum):
    """Non-overlapping outcomes for one verification check.

    FAIL means a check ran and established a concrete mismatch. SKIPPED means the
    check is not applicable by design. UNAVAILABLE means it is applicable but the
    required capability or evidence is absent. ERROR means the verifier failed to
    produce a judgement. The latter three never establish a candidate defect.
    """

    PASS = "pass"
    FAIL = "fail"
    SKIPPED = "skipped"
    UNAVAILABLE = "unavailable"
    ERROR = "error"


class EvidenceStrength(StrEnum):
    """What a passing run's verdict was actually proved by.

    Deliberately *not* a fourth VerifierDecision value. A run whose only check was
    `return_contract` — "does the result dict have a `counts` key?" — is a real pass:
    nothing it claimed was contradicted. It is just not the same claim as a run whose
    reported distribution was compared against the circuit's Born distribution to
    1.8e-16, and until 2026-07-20 both printed the single word "Verified".

    This grades the checks, not final sufficiency. Verification v2 refuses a final
    PASS when the check set is structural-only or lacks a dedicated property check;
    a physical grade may likewise describe one limited passing claim while the final
    decision remains INCONCLUSIVE because another required claim is unsupported.
    """

    PHYSICAL = "physical"
    STRUCTURAL = "structural"


PHYSICAL_VERIFICATION_METHODS: frozenset[str] = frozenset(
    {
        VerificationMethod.EXACT,
        VerificationMethod.STATISTICAL,
        VerificationMethod.STATISTICAL_NATIVE,
        VerificationMethod.BRUTE_FORCE,
        VerificationMethod.EXACT_DIAG,
        VerificationMethod.BELL_STATE_PROPERTY,
        VerificationMethod.GHZ_STATE_PROPERTY,
    }
)
"""Checks that compare a candidate against what the physics should do.

`statistical_native` is on the strong side deliberately: unlike the
reproducibility pair, the trusted side re-executes the circuit OBJECT the
observer held through the framework's own sampler — the user's result-assembly
code is not in that loop, so fabricated or mis-assembled counts fail it.

Bell/GHZ property checks compare the complete framework-native statevector with
an explicit typed relative-phase target accepted by semantic review. They prove
that bounded state-preparation claim, while statistical methods prove only that
reported counts agree with the executed circuit. Final sufficiency composes those
scopes in majorana-verification.

`statistical_reproducibility` is excluded on purpose: it proves only that the program
agrees with itself across two executions, which a consistently wrong program also does
(see `agent_ports.py::_statistical_checks`). So are the contract checks — `structural`,
`resource_contract`, `measurement_policy`, `success_criteria`,
`native_optimization_evidence`, `return_contract`, `qasm_parse` — which police the
shape of the answer, not its correctness.
"""


def evidence_strength_of(checks: Iterable[Mapping[str, Any]]) -> EvidenceStrength:
    """Grade a verdict by the checks behind it.

    Takes the worker's deterministic-check dicts (`{"method", "result", ...}`) and
    answers PHYSICAL only if at least one check in PHYSICAL_VERIFICATION_METHODS both
    ran and passed. A physical check that ran and *failed* proves nothing, so it does
    not lift the grade — in practice a failed deterministic check already short-circuits
    to VerifierDecision.FAIL, but this function is not entitled to assume its caller.
    """
    for check in checks:
        method = check.get("method")
        if isinstance(method, str) and method in PHYSICAL_VERIFICATION_METHODS:
            if check.get("result") == VerificationResultKind.PASS:
                return EvidenceStrength.PHYSICAL
    return EvidenceStrength.STRUCTURAL


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
    # Pinned in-repo bootstrap manifest (ADR-0019): source bytes are embedded
    # and content-hashed at generation time, so this adapter reads no network
    # and no externally-controlled path -- its adversarial tests live in
    # tests/test_catalog_bootstrap_manifest.py.
    CATALOG_BOOTSTRAP = "catalog_bootstrap"


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


class ShareRole(StrEnum):
    """What a project grant lets someone outside the workspace do (migration 0042).

    Deliberately NOT `Role`, and deliberately not a subset of it. A workspace Role
    answers "what may this member do anywhere in this tenant"; a ShareRole answers
    "what may this outsider do to the contents of one project". They are two
    different questions and the codebase has one gate — `require_write(scope)` —
    that reads a Role. Sharing the type would make that gate look like it answers
    both.

    EDITOR is bounded by what the grant maps onto internally: a MEMBER-level scope
    confined to one project, so every `require_admin` operation (deleting an
    artifact, making one public) refuses a grantee without a denylist anyone could
    forget to extend.
    """

    VIEWER = "viewer"
    EDITOR = "editor"


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


#: `meta.role` on an `LLM_TOKENS` event that a chat turn spent, as opposed to a
#: stage of an execute run (whose role is the agent request's `schema_name`).
#:
#: Here rather than as a literal in each service because the worker WRITES it
#: and the API READS it, and a drift between the two is silent in the worst
#: direction: `/v1/usage` would report zero chat spend on a workspace that had
#: spent plenty, with every test still green on both sides of the boundary.
#:
#: Not a `CONTRACTS_VERSION` bump — the version log tracks the shape of the
#: exported models, and this changes no schema in `openapi.json`.
CHAT_USAGE_ROLE = "chat"


class QpuProvider(StrEnum):
    """Hardware access route, not the device vendor (IonQ via Braket is `braket`)."""

    IBM = "ibm"
    BRAKET = "braket"


class QpuEstimateBasis(StrEnum):
    """Where a pre-run cost figure came from. Mirrors majorana_qpu.EstimateBasis
    (parity pinned by the same services/api test as the other QPU enums)."""

    VENDOR_RATE_CARD = "vendor_rate_card"
    FREE_TIER_ALLOWANCE = "free_tier_allowance"


class ResourceEstimateBasis(StrEnum):
    """On what footing a catalogue entry's fault-tolerant cost is being reported.

    Four values because there are four genuinely different things a page can be
    saying, and collapsing any pair of them is how an estimate starts reading as
    a measurement:

    - `EXACT` — every operation came from a closed vocabulary, so the magic-state
      count is counted, not approximated. In today's corpus these are all
      Clifford-only: the honest display is "consumes no magic states", not a
      small number.
    - `ESTIMATED` — the circuit contains arbitrary-angle rotations, which have no
      T-count until a synthesis precision is named. The figure is real *under
      that stated epsilon* and moves with it, so the epsilon travels with the
      number and is part of the assumption-set identity.
    - `REFUSED` — the circuit holds an operation this stack cannot classify. No
      precision fixes that, so there is no number and the reason is given instead.
    - `NO_CIRCUIT` — the entry carries no portable circuit at all. Distinct from
      REFUSED on purpose: nothing was attempted and nothing failed, and showing
      a refusal here would invent a doubt about the entry that does not exist.
    """

    EXACT = "exact"
    ESTIMATED = "estimated"
    REFUSED = "refused"
    NO_CIRCUIT = "no_circuit"


class QpuRunStatus(StrEnum):
    """Lifecycle of a durable qpu_run record. Values mirror the provider-side
    majorana_qpu.QpuJobStatus (parity is pinned by a test in services/api) and
    will match the qpu_run storage CHECK constraint in the follow-up migration
    PR — the contract ships first because deploys migrate before rollout."""

    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"
