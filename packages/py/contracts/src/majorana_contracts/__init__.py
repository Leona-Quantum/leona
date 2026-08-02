"""majorana-contracts: source of truth for every cross-boundary type (ADR-0008).
Pydantic models → OpenAPI (openapi.json) → generated TS (packages/ts/contracts-gen)."""

from .enums import (
    Algorithm,
    ArtifactKind,
    ArtifactType,
    BaselineKind,
    CitationRelation,
    EvidenceStrength,
    ExecutionState,
    ExportStatus,
    Framework,
    ImportItemState,
    ImportJobStatus,
    ImportProvider,
    JobStatus,
    LicenseAssertionKind,
    LicenseDecision,
    LicenseScope,
    MeasurementPolicy,
    Optimizer,
    PlannableVerificationMethod,
    PublicationState,
    QpuEstimateBasis,
    QpuProvider,
    QpuRunStatus,
    ReviewState,
    Role,
    RunMode,
    RunStatus,
    RetryTarget,
    SemanticReviewDecision,
    ShareRole,
    SourceKind,
    Stage,
    TopLevelExecution,
    UsageKind,
    CHAT_USAGE_ROLE,
    VerificationMethod,
    VerificationFailureClass,
    VerificationResultKind,
    VerifierDecision,
    PHYSICAL_VERIFICATION_METHODS,
    evidence_strength_of,
    Visibility,
    WorkspaceKind,
)
from .events import (
    ArtifactSaved,
    BaselineResult,
    CodeFinalized,
    CodeVariant,
    CodeGenerated,
    CompilationResult,
    ChatCompleted,
    ChatDelta,
    ChatError,
    ConversationTitled,
    ExportClassified,
    LlmCall,
    LlmDelta,
    PlanProduced,
    QasmEmission,
    ResearchCitation,
    ResearchCompleted,
    RunBestEffort,
    RunErrorEvent,
    RunEvent,
    RunAnalysis,
    RunDiagnosed,
    RunFinished,
    RunModeResolved,
    RunQueued,
    RunRestarted,
    RunStarted,
    SandboxResult,
    SemanticReviewRecorded,
    ResourceEstimateResult,
    ScreenResult,
    StageFinished,
    StageStarted,
    StrictVerificationRecorded,
    VerificationResult,
    run_event_adapter,
)
from .models import (
    Artifact,
    ArtifactVersion,
    CatalogProvenance,
    Project,
    ProjectShare,
    PublicCatalogEntry,
    QpuRunRecord,
    ResourceMetrics,
    Run,
    SharedProject,
    VerificationRecord,
    VerificationCheckSummary,
    VerificationSummary,
    Workspace,
    Conversation,
    ConversationTurn,
    WorkspaceFolder,
    WorkspaceInvitation,
    WorkspaceMember,
    WorkspaceOverview,
    WorkspaceSummary,
)
from .plan import (
    ArtifactContract,
    ComplexCoefficient,
    ExactDynamicsReference,
    ExactLindbladReference,
    ExactLinearSystemReference,
    ExactPhaseEstimationReference,
    IndexedPauliTerm,
    LindbladDissipator,
    LindbladFactor,
    LindbladOperator,
    LindbladOperatorTerm,
    LindbladResultSpec,
    LinearSystemResultSpec,
    PauliFactor,
    Plan,
    PlanParameters,
    SuccessCriteria,
    StatePreparationClaim,
    VerificationPlan,
)
from .scope import Scope
from .lifecycle import (
    IllegalImportItemTransition,
    IllegalPublicationTransition,
    IllegalReviewTransition,
    IllegalTransition,
    IMPORT_ITEM_TERMINAL_STATES,
    TERMINAL_STATUSES,
    assert_import_item_transition,
    assert_publication_transition,
    assert_review_transition,
    assert_transition,
    is_terminal,
)

# Versioning convention (see AGENTS.md "Versioning"): backward-compatible
# additions (new enum values, new models, new optional fields) bump minor;
# breaking changes bump major. Bump lands in the same PR as the change.
# 1.1.0: Steps 2-5a additions — WorkspaceKind "system"; ArtifactKind /
# ExecutionState / ReviewState / PublicationState; review + import-item
# lifecycles; ImportProvider / ImportJobStatus / ImportItemState.
# 1.2.0: Step 6 (Neon cutover Slice C) — PublicCatalogEntry / CatalogProvenance
# response models; publication-state lifecycle (assert_publication_transition).
# 1.3.0: VerificationResultKind gains "skipped" — a check that was incapable of
# evaluating the circuit (vs. one that ran and disagreed). Never blocks, never
# lifts evidence strength.
# 1.4.0: VerificationMethod gains "statistical_native" (physical) — reported
# counts vs a trusted framework-native re-execution of the circuit object; the
# mid-circuit-capable check (plans/framework-native-verification.md).
# 1.5.0: Artifact (list resource) gains optional verifier_decision /
# evidence_strength from the current version's verification_summary, so the
# Vault list stops fabricating "verified" for unopened artifacts.
# 2.0.0: VerificationPlan removes all reference-QASM fields and planner-selectable
# exact; prior exact records remain readable. Adds three-state review/failure/retry
# taxonomy, unavailable/error check results, and typed final summaries.
# 2.1.0: VerificationMethod gains fixed-policy Bell/GHZ state-property checks;
# VerificationPlan gains an optional typed relative-phase state target.
# 2.2.0: RunEvent gains immutable semantic/strict audit events, attempt bindings,
# and optional machine-readable terminal reasons.
# 2.3.0: Artifact, ArtifactVersion, and Run expose typed bounded verification
# summaries so clients never infer trust from arbitrary metadata.
# 2.4.0: SandboxResult exposes the bounded protected RESULT payload so replaying
# clients can render the actual simulation values without parsing stdout.
# 2.5.0: WorkspaceInvitation — a membership the invited person has not been told
# about yet, so an invite can announce itself instead of relying on the inviter
# to mention it out of band (migration 0038).
# 2.6.0: Project + Artifact.project_id — Studio's grouping moves out of the
# browser's localStorage and onto the workspace (migration 0041). Additive: both
# are optional to read and `project_id` defaults to None, so a client built
# against 2.5.0 keeps working and simply shows every artifact ungrouped.
# 2.7.0: ShareRole + ProjectShare + SharedProject — a project can be granted to a
# person outside the workspace that owns it (migration 0042). Additive: three new
# names, no existing field changes meaning, and a client built against 2.6.0 never
# asks for a shared project and so never sees one.
# 2.8.0: Project.max_artifacts and SharedProject.artifact_limit — how far a share
# grantee may grow a project (migration 0043). Additive in the sense that matters
# here: both are server-to-client, so no client stops being able to CALL anything.
# They are required on the model rather than optional because the server always
# knows the number — `shares.project_artifact_limit` resolves an unset column — and
# an optional one would invite a client to reimplement that default. A web build
# that lands BEFORE the API's sees neither field, so `apps/web/lib/project-shares`
# reads both defensively rather than parsing them as required.
# 2.9.0: VerificationPlan gains bounded typed references for practical binary
# optimization, Pauli dynamics, Lindblad evolution, phase estimation, and dense
# linear systems, plus explicit RESULT-key binding for exact diagonalization.
# These additions strengthen existing evidence paths without a new DB enum.
# 2.10.0: Plan.qubits_estimate is no longer capped by the local sandbox lane;
# execution providers enforce their own limits so larger unexecuted artifacts can
# be authored without pretending that they ran.
CONTRACTS_VERSION = "2.10.0"

__all__ = [
    "CONTRACTS_VERSION",
    "Algorithm",
    "Artifact",
    "ArtifactContract",
    "ArtifactKind",
    "ArtifactSaved",
    "ArtifactType",
    "ArtifactVersion",
    "ComplexCoefficient",
    "ExactDynamicsReference",
    "ExactLindbladReference",
    "ExactLinearSystemReference",
    "ExactPhaseEstimationReference",
    "IndexedPauliTerm",
    "LindbladDissipator",
    "LindbladFactor",
    "LindbladOperator",
    "LindbladOperatorTerm",
    "LindbladResultSpec",
    "LinearSystemResultSpec",
    "BaselineKind",
    "BaselineResult",
    "CatalogProvenance",
    "CodeFinalized",
    "CodeVariant",
    "CodeGenerated",
    "CompilationResult",
    "ChatCompleted",
    "ChatDelta",
    "ChatError",
    "ConversationTitled",
    "CitationRelation",
    "EvidenceStrength",
    "ExecutionState",
    "ExportClassified",
    "ExportStatus",
    "Framework",
    "ImportItemState",
    "ImportJobStatus",
    "ImportProvider",
    "IMPORT_ITEM_TERMINAL_STATES",
    "JobStatus",
    "IllegalImportItemTransition",
    "IllegalPublicationTransition",
    "IllegalReviewTransition",
    "IllegalTransition",
    "LicenseAssertionKind",
    "LicenseDecision",
    "LicenseScope",
    "LlmCall",
    "LlmDelta",
    "MeasurementPolicy",
    "Optimizer",
    "PauliFactor",
    "Plan",
    "PlanParameters",
    "PlanProduced",
    "Project",
    "ProjectShare",
    "PublicCatalogEntry",
    "PlannableVerificationMethod",
    "PublicationState",
    "QasmEmission",
    "QpuEstimateBasis",
    "QpuProvider",
    "QpuRunRecord",
    "QpuRunStatus",
    "ResearchCitation",
    "ResearchCompleted",
    "ReviewState",
    "Role",
    "Run",
    "RunBestEffort",
    "RunErrorEvent",
    "RunEvent",
    "RunAnalysis",
    "RunDiagnosed",
    "RunFinished",
    "SemanticReviewRecorded",
    "RunMode",
    "RunModeResolved",
    "RunQueued",
    "RunRestarted",
    "RunStarted",
    "RunStatus",
    "RetryTarget",
    "SandboxResult",
    "ResourceEstimateResult",
    "ResourceMetrics",
    "ScreenResult",
    "Scope",
    "SemanticReviewDecision",
    "ShareRole",
    "SharedProject",
    "SourceKind",
    "Stage",
    "StageFinished",
    "StageStarted",
    "StatePreparationClaim",
    "SuccessCriteria",
    "TopLevelExecution",
    "TERMINAL_STATUSES",
    "UsageKind",
    "CHAT_USAGE_ROLE",
    "VerificationMethod",
    "VerificationFailureClass",
    "VerificationPlan",
    "VerificationRecord",
    "VerificationSummary",
    "VerificationCheckSummary",
    "VerificationResult",
    "StrictVerificationRecorded",
    "VerificationResultKind",
    "VerifierDecision",
    "Visibility",
    "PHYSICAL_VERIFICATION_METHODS",
    "evidence_strength_of",
    "Workspace",
    "Conversation",
    "ConversationTurn",
    "WorkspaceFolder",
    "WorkspaceInvitation",
    "WorkspaceMember",
    "WorkspaceOverview",
    "WorkspaceSummary",
    "WorkspaceKind",
    "run_event_adapter",
    "assert_import_item_transition",
    "assert_publication_transition",
    "assert_review_transition",
    "assert_transition",
    "is_terminal",
]
