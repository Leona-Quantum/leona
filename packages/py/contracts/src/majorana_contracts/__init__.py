"""majorana-contracts: source of truth for every cross-boundary type (ADR-0008).
Pydantic models → OpenAPI (openapi.json) → generated TS (packages/ts/contracts-gen)."""

from .enums import (
    Algorithm,
    ArtifactKind,
    ArtifactType,
    BaselineKind,
    CircuitCompiler,
    CircuitOptimizationGate,
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
    QappExecutionStatus,
    QappRangeSmokeStatus,
    ResourceEstimateBasis,
    ReviewState,
    Role,
    RunMode,
    RunStatus,
    RetryTarget,
    SemanticReviewDecision,
    ShareRole,
    SourceKind,
    Stage,
    SynthesisConnectivity,
    SynthesisObjective,
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
    QappGenerated,
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
    SynthesisResultEvent,
    VerificationResult,
    run_event_adapter,
)
from .comments import (
    MAX_COMMENT_CHARS,
    Comment,
    CommentList,
    CommentPeopleList,
    CommentPerson,
    CommentTargetType,
    CreateCommentRequest,
    UpdateCommentRequest,
)
from .tokens import (
    MAX_TOKEN_LIFETIME_DAYS,
    MAX_TOKENS_PER_USER,
    TOKEN_PREFIX,
    TOKEN_TAIL_CHARS,
    CreateTokenRequest,
    MintedToken,
    PersonalAccessToken,
    PersonalAccessTokenList,
    TokenName,
    TokenScope,
)
from .presence import (
    PresenceHeartbeatRequest,
    PresenceList,
    PresenceTargetType,
    PresenceViewer,
)
from .tour_signals import RecordTourSignalRequest, TourSignalKind
from .notifications import (
    MAX_NOTIFICATION_SUMMARY_CHARS,
    Notification,
    NotificationKind,
    NotificationList,
)
from .courses import (
    Course,
    CourseGradebook,
    CourseList,
    CourseModule,
    CourseModulePatch,
    CourseModuleStatus,
    CoursePlan,
    CourseStatus,
    CourseSummary,
    CourseTurn,
    CourseTurnList,
    CreateCourseRequest,
    CreateCourseResponse,
    CreateCourseTurnRequest,
    CreateCourseTurnResponse,
    GenerateCourseRequest,
    GenerateCourseResponse,
    GradebookEntry,
    GradebookModule,
    GradebookRow,
    GradebookVisibility,
    PlannedModule,
    UpdateCourseRequest,
)
from .notebooks import (
    AnswerPrompt,
    Audience,
    AuthorNotebookVersionRequest,
    AuthorNotebookVersionResponse,
    Cell,
    CellError,
    CellGrade,
    CellOutput,
    CellResult,
    CellRole,
    ChoiceAnswer,
    CreateNotebookRequest,
    CreateNotebookResponse,
    CreateNotebookTurnRequest,
    CreateNotebookTurnResponse,
    ExecutionReport,
    GradeReport,
    HardwareRequest,
    ImportNotebookRequest,
    ImportNotebookResponse,
    Notebook,
    NotebookFramework,
    NotebookKind,
    NotebookList,
    NotebookReview,
    NotebookSpec,
    NotebookStarter,
    NotebookTemplateKind,
    NotebookTemplates,
    NotebookTurn,
    NotebookTurnList,
    NotebookTurnRole,
    NotebookVersion,
    NotebookVersionAuthor,
    NotebookVersionList,
    NotebookVersionStatus,
    NotebookVersionSummary,
    NumericAnswer,
    Reference,
    GradeAttemptRequest,
    GradeAttemptResponse,
    NotebookGradesSnapshot,
    RerunNotebookResponse,
    ReviewFinding,
    RubricAnswer,
    Seed,
    Style,
    TextAnswer,
    UpdateNotebookRequest,
)
from .notebook_shares import (
    MAX_LIVE_SHARE_LINKS_PER_NOTEBOOK,
    MAX_SHARE_LINK_LIFETIME_DAYS,
    SHARE_TOKEN_PREFIX,
    SHARE_TOKEN_TAIL_CHARS,
    CreateNotebookShareLinkRequest,
    LookupNotebookShareRequest,
    MintedNotebookShareLink,
    NotebookShareLink,
    NotebookShareLinkList,
    PublicNotebookView,
)
from .models import (
    Artifact,
    ArtifactVersion,
    AssumptionSetSummary,
    CatalogEntryEstimate,
    CatalogEntryProfile,
    CatalogEstimateList,
    CatalogProfileList,
    CatalogEstimateSummary,
    CatalogProvenance,
    CircuitOptimizationOperation,
    CircuitOptimizationRequest,
    CircuitOptimizationResult,
    CodeDistanceSummary,
    CostOnSmallestMachine,
    FootprintSummary,
    FrontierPointSummary,
    FrontierSummary,
    LogicalCostSummary,
    Project,
    ProjectShare,
    PublicCatalogEntry,
    QpuRunRecord,
    Qapp,
    QappExecution,
    QappRangeSmoke,
    QappVersion,
    PublicQapp,
    ResourceMetrics,
    Run,
    RuntimeSummary,
    ScalingCurvePointSummary,
    ScalingCurveSummary,
    SharedProject,
    SynthesisCandidate,
    SynthesisEquivalence,
    SynthesisRequest,
    SynthesisResult,
    SynthesisTarget,
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
# mid-circuit-capable check (plans/archive/framework-native-verification.md, archived
# as shipped; the implementation is
# packages/py/verification/src/majorana_verification/native.py).
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
# 2.11.0: CatalogEntryEstimate, CatalogEstimateList and their layer summaries — /repository can show a
# catalogue entry's fault-tolerant cost under a named assumption set (E4), or the
# reason it has none. Additive and read-only: derived from the entry's own
# portable circuit on read, so nothing is stored and no existing field changes
# meaning. ResourceEstimateBasis is the field to branch on; a client that renders
# a number without checking it will publish a cost for a circuit that has none.
# 2.12.0: CatalogEntryProfile and CatalogProfileList — /repository can show and
# rank a catalogue entry's circuit size (R1). Additive and read-only, derived on
# read from the entry's own portable circuit like the estimate beside it, so
# nothing is stored. Kept OUT of the estimate payload on purpose: these numbers
# are properties of the circuit, not of an assumption set, so they carry no
# identity and may be ranked across the whole listing — the opposite of the rule
# CatalogEstimateList exists to make structural. `present` is the field to branch
# on; a client that renders a size without checking it will print zeros for an
# entry that has no circuit at all.
# 2.13.0: CostOnSmallestMachine, CatalogEntryEstimate.smallest_machine and
# CatalogEstimateSummary.smallest_machine_qubits — an entry's cost is published as
# the two ends of the magic-state-factory trade rather than one figure. Additive
# and read-only; every existing field keeps its meaning and the browse list still
# ranks on total_physical_qubits alone. The headline was costed at the crossover,
# which is the fastest useful machine and therefore the *largest*: for the
# 16-qubit ansatz that is 836,800 physical qubits, 99.2% of them factories, and
# the same circuit runs on 8,800 at one factory in 6.9 ms instead of 20 µs.
# Neither end is chosen — the crossover is derived and one factory is the floor
# the estimator enforces — which is why exactly these two are published and
# nothing between them.
# 2.14.0: Framework adds offline Amazon Braket, Qibo, and Qulacs SDK lanes.
# Additive: existing framework values keep their meaning and older clients
# continue to use them.
# 2.15.0: Qapp resources, execution status, qapp run mode, and the durable
# qapp.generated event. Additive: existing clients never select the new mode.
# 2.16.0: bounded, code-free Studio circuit-optimization request/result models
# and the Qiskit, pytket, PennyLane, and PyZX compiler enums. Additive; compiler
# output remains an explicitly unverified compilation result.
# 2.17.0: CircuitCompiler adds the offline Cirq and BQSKit optimizer lanes.
# Additive: existing compiler values and result semantics are unchanged.
# 2.18.0: Notebook resources — the notebook spec with role-carrying cells, the
# per-cell execution report, the advisory review, versions and chat turns, plus
# the `notebook` run mode. Additive: existing clients never select the new mode.
# 2.19.0: Course resources — an ordered plan of notebooks generated from one
# prompt: the plan the planner returns (CoursePlan/PlannedModule), the stored
# course with its modules, and the create/update/generate/turn bodies. Additive:
# `NotebookTemplates.course_starters` defaults to empty, so a client built
# against 2.18.0 keeps working unchanged, and a course run reuses `mode=notebook`
# rather than adding a run mode.
#
# 2.19.0: Seed gains kind="circuit" (a reader's own pasted Qiskit/OpenQASM 3 text,
# carried in the new `content` field) and kind="notebook" (reserved for the
# learner lane's notebook-as-seed flow — the enum value only; no fetch path
# ships here). Additive: `content` defaults to "" and every existing Seed kind
# keeps its meaning, so a v1 payload with no `content` still validates.
# 2.19.0: AuthorNotebookVersionRequest/Response — a notebook version the READER
# wrote, from the in-browser editor (spec), a text editor (source) or Jupyter
# (ipynb), executed by the same sandbox path Nala's builds use. Plus
# NotebookReview.warnings and its NotebookVersion.warnings mirror: the structure
# check becomes advisory output on a user's edit instead of a constraint that
# refuses it. Additive — every field defaults, and a client that never posts to
# /notebooks/{id}/versions sees no change.
# 2.20.0: Grading. Cell gains `check` (an assertion the author writes, run against the
# reader's own code to decide the exercise) and `answer` (a choice/numeric/text key, or a
# rubric the model grades), plus CellGrade / GradeReport and the request-response pair
# that carries an attempt. Additive: both new Cell fields default to None, so every
# 2.19.0 payload still validates and an ungraded notebook behaves exactly as before.
# The answer key never leaves the server — `for_learner()` strips it and
# `leaks_answer_key()` asserts that it did.
# 2.21.0: CatalogEntryEstimate gains `frontier` (FrontierSummary — the
# qubits-vs-runtime Pareto frontier across the deployment's built-in
# assumption sets, proposal 4) and `scaling` (ScalingCurveSummary, null
# until an Atlas record states an explicit n-dependence — none does yet).
# Additive: both default to None, mirrored by the same present-iff-priced
# rule the other estimate layers already follow, so a pre-2.21.0 client
# reading an old response shape is unaffected.
# 2.22.0: Targeted synthesis (proposal 3). ResourceMetrics gains `t_count` (optional,
# defaults None — every existing payload still validates). New: SynthesisConnectivity,
# SynthesisObjective, SynthesisTarget, SynthesisRequest, SynthesisEquivalence,
# SynthesisCandidate, SynthesisResult, and the SynthesisResultEvent run event. A second,
# target-aware entry point into the existing trusted compiler lane
# (CircuitOptimizationRequest/Result are untouched): a client picks a device or a generic
# connectivity plus an objective, every compiler in the lane is tried against it, and each
# resulting candidate carries an independent equivalence verdict from majorana_verification
# rather than the compiler's own claim. Purely additive.
# 2.23.0: Proposal 6 (Qapps v2). Qapp.created_by_run_id becomes optional and gains
# forked_from_qapp_id/forked_from_version_id (a fork has no originating run) —
# additive/widening, and every existing Qapp still reports a non-null
# created_by_run_id. QappRangeSmoke is unchanged. New route-local response shapes
# (version history, activity, usage, rollback) are not contracts models.
# 2.24.0: Proposal 5, increment 2. QpuRunRecord gains optional `backend_name`, the
# physical machine the provider ran the job on (migration 0065). Additive: it
# defaults to None, and None is also its value for every run recorded before it.
# 2.25.0: Course gradebook (ai-ops 349 proposal 8). New: CourseGradebook,
# GradebookModule, GradebookRow, GradebookEntry and the closed GradebookVisibility
# enum, the response of GET /v1/courses/{id}/gradebook. Purely additive: no existing
# model changes, and the data is read from `notebook.grades` events already stored.
# 2.26.0: Proposal 5, increment 4. QpuRunRecord gains optional `mitigation`, the
# stored inputs for readout correction and zero-noise extrapolation (migration
# 0066). Additive: it defaults to None, and `raw_counts` keeps its meaning.
# 2.28.0: Course due dates (ai-ops 349 proposal 8, assignments). CourseModule gains
# `due_at`, Course gains `owner_user_id`, CourseModulePatch gains `due_at` (absent
# leaves it, null clears it; creator-only), GradebookModule gains `due_at`,
# GradebookEntry gains `late` and GradebookRow gains `missing_module_ids`. All
# optional with defaults, so a 2.26.0 payload still validates (migration 0067).
# Numbered 2.28.0, not 2.27.0: the comments branch claims 2.27.0, and its line goes
# between 2.26.0 and this one whichever of the two lands first.
# 2.29.0: Proposal 9, first slice. Comment, CommentList, CommentPerson,
# CommentPeopleList, CommentTargetType and the create/update bodies: comments and
# @-mentions on a run, a notebook or a saved circuit (migration 0068). Additive:
# new names only. 2.27.0 was never used: the comments branch held it while the
# landing order was open, and moved here once mitigation (2.26.0) and due dates
# (2.28.0) were set to land first.
# 2.29.1: `GradebookEntry.late` documents the rule the owner chose on ai-ops 364,
# option 1 — late means the member had NO graded attempt by the due date, read
# from their first attempt rather than the latest one the row shows. A PATCH: the
# field, its type and its JSON are unchanged, and only what the value MEANS moved,
# which is exactly the "invisible on the wire" case this package versions anyway,
# because a consumer rendering the flag is rendering a different claim afterwards.
# 2.30.0: Proposal 7 Phase B, personal access tokens (ai-ops 362, option 1 —
# "Tokens may read and start verified runs, and expire after at most 90 days;
# hardware jobs come later under their own permission"). New: PersonalAccessToken,
# PersonalAccessTokenList, MintedToken, CreateTokenRequest and the closed TokenScope
# enum, behind GET/POST /v1/tokens and DELETE /v1/tokens/{id} (migration 0069).
# Additive: new names only, no existing model changes. TokenScope has exactly `read`
# and `run` — the absence of a `hardware` member IS the deferral in the ruling, so
# adding one later is a widening a review can see.
# 2.31.0: Proposal 9, second slice. PresenceViewer, PresenceList,
# PresenceTargetType and PresenceHeartbeatRequest: who else in the workspace is
# looking at a run, a notebook or a saved circuit right now (migration 0070).
# Additive: new names only. PresenceTargetType is its own enum, not a reuse of
# CommentTargetType, so presence and comments can each grow independently.
# 2.32.0: ai-ops 326, the owner's preferred destination on 324 (option 1) for the
# guided tours' ten kinds of signal — "our own API, on a small endpoint that stores
# the counts". New: RecordTourSignalRequest and the closed TourSignalKind enum,
# behind POST /v1/tour-signals (migration 0071, anonymous — renumbered from 0070
# to revise 0070_presence.py, which landed first). Additive: new names
# only. `track`/`step` are bounded here by shape only, not by a contracts-level
# enum — see tour_signals.py's module docstring for why: they are tour CONTENT,
# checked against services/api's tour_signal_vocabulary.py instead, which changes
# at the pace tours change rather than the pace this package's version does.
# 2.33.0: Proposal 7 ("Notebooks and courses for a class"), public read-only
# notebook share links (ai-ops 349 option 2). New: NotebookShareLink,
# NotebookShareLinkList, MintedNotebookShareLink, CreateNotebookShareLinkRequest,
# LookupNotebookShareRequest, PublicNotebookView, behind
# POST/GET /v1/notebooks/{id}/share-links, DELETE
# /v1/notebooks/{id}/share-links/{link_id}, and the anonymous
# POST /v1/notebooks/shared/lookup (migration 0072, revising 0071 — tour signals
# landed first). Additive: new names only, no existing model changes.
# `PublicNotebookView` is deliberately NOT `Notebook` with fields hidden — it is
# its own `extra="forbid"` type with an explicit field list, so nothing added to
# `Notebook` later can ride across the public boundary by omission. The
# anonymous lookup is a POST with the token in the body, not a GET with it in
# the path — see `LookupNotebookShareRequest`'s docstring for why a
# path-embedded secret was the wrong shape for this deployment's own logging.
# 2.34.0: ai-ops 349, option 2, "Job-finished notifications". New: Notification,
# NotificationList, NotificationKind and MAX_NOTIFICATION_SUMMARY_CHARS, behind
# GET /v1/notifications, POST /v1/notifications/{id}/read and POST
# /v1/notifications/read-all (migration 0073, revising 0072). Additive: new names only.
# NotificationKind is closed at exactly `qpu_run_terminal` and `mention` — a
# third producer needs its own migration and its own line here, the same
# discipline 2.30.0 applies to TokenScope.
# 2.35.0: notebooks can ask for hardware (plan 10-notebook-ide, rule 4). New:
# HardwareRequest, and `CellResult.hardware_requests` (default empty, so every
# report stored before it still parses). Additive: one new model, one new field
# with a default. The caps are module constants in `notebooks.py` rather than
# exports, because only the sandbox program and its tests read them.
# 2.36.0: plan 10-notebook-ide, "Live" lane — a notebook developing in real time. New
# RunEvent members: NotebookDraftDelta (notebook.draft.delta), NotebookDraftParsed
# (notebook.draft.parsed, carries NotebookLiveCell), NotebookCells (notebook.cells,
# carries NotebookLiveCellResult) and NotebookRepair (notebook.repair) — emitted by
# `ProductionNotebookPorts` (services/worker/notebook_handlers.py), no route changes.
# Additive: new names only, no existing model changes. Not re-exported from this
# module's `__all__`, matching `NotebookGrades` — a member of `RunEvent` validates and
# emits through `run_event_adapter` without a top-level import.
CONTRACTS_VERSION = "2.36.0"

__all__ = [
    "PresenceHeartbeatRequest",
    "PresenceList",
    "PresenceTargetType",
    "PresenceViewer",
    "MAX_COMMENT_CHARS",
    "MAX_TOKENS_PER_USER",
    "MAX_TOKEN_LIFETIME_DAYS",
    "TOKEN_PREFIX",
    "TOKEN_TAIL_CHARS",
    "CreateTokenRequest",
    "MintedToken",
    "PersonalAccessToken",
    "PersonalAccessTokenList",
    "TokenName",
    "TokenScope",
    "RecordTourSignalRequest",
    "TourSignalKind",
    "MAX_LIVE_SHARE_LINKS_PER_NOTEBOOK",
    "MAX_SHARE_LINK_LIFETIME_DAYS",
    "SHARE_TOKEN_PREFIX",
    "SHARE_TOKEN_TAIL_CHARS",
    "CreateNotebookShareLinkRequest",
    "LookupNotebookShareRequest",
    "MintedNotebookShareLink",
    "NotebookShareLink",
    "NotebookShareLinkList",
    "PublicNotebookView",
    "Comment",
    "CommentList",
    "CommentPeopleList",
    "CommentPerson",
    "CommentTargetType",
    "CreateCommentRequest",
    "UpdateCommentRequest",
    "TextAnswer",
    "RubricAnswer",
    "NumericAnswer",
    "GradeReport",
    "ChoiceAnswer",
    "CellGrade",
    "AnswerPrompt",
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
    "AssumptionSetSummary",
    "CatalogEntryEstimate",
    "CatalogEntryProfile",
    "CatalogEstimateList",
    "CatalogProfileList",
    "CircuitCompiler",
    "CircuitOptimizationGate",
    "CircuitOptimizationOperation",
    "CircuitOptimizationRequest",
    "CircuitOptimizationResult",
    "SynthesisConnectivity",
    "SynthesisObjective",
    "SynthesisTarget",
    "SynthesisRequest",
    "SynthesisEquivalence",
    "SynthesisCandidate",
    "SynthesisResult",
    "SynthesisResultEvent",
    "CatalogEstimateSummary",
    "CatalogProvenance",
    "CodeDistanceSummary",
    "CodeFinalized",
    "CodeVariant",
    "CodeGenerated",
    "CompilationResult",
    "CostOnSmallestMachine",
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
    "Qapp",
    "Audience",
    "Course",
    "CourseGradebook",
    "CourseList",
    "CourseModule",
    "CourseModulePatch",
    "CourseModuleStatus",
    "CoursePlan",
    "CourseStatus",
    "CourseSummary",
    "CourseTurn",
    "CourseTurnList",
    "CreateCourseRequest",
    "CreateCourseResponse",
    "CreateCourseTurnRequest",
    "CreateCourseTurnResponse",
    "GenerateCourseRequest",
    "GenerateCourseResponse",
    "GradebookEntry",
    "GradebookModule",
    "GradebookRow",
    "GradebookVisibility",
    "PlannedModule",
    "AuthorNotebookVersionRequest",
    "AuthorNotebookVersionResponse",
    "Cell",
    "CellError",
    "CellOutput",
    "CellResult",
    "HardwareRequest",
    "CellRole",
    "CreateNotebookRequest",
    "CreateNotebookResponse",
    "CreateNotebookTurnRequest",
    "CreateNotebookTurnResponse",
    "ExecutionReport",
    "ImportNotebookRequest",
    "ImportNotebookResponse",
    "Notebook",
    "NotebookFramework",
    "NotebookKind",
    "NotebookList",
    "NotebookReview",
    "NotebookSpec",
    "NotebookStarter",
    "NotebookTemplateKind",
    "NotebookTemplates",
    "NotebookTurn",
    "NotebookTurnList",
    "NotebookTurnRole",
    "NotebookVersion",
    "NotebookVersionAuthor",
    "NotebookVersionList",
    "NotebookVersionStatus",
    "NotebookVersionSummary",
    "Reference",
    "GradeAttemptRequest",
    "GradeAttemptResponse",
    "NotebookGradesSnapshot",
    "MAX_NOTIFICATION_SUMMARY_CHARS",
    "Notification",
    "NotificationKind",
    "NotificationList",
    "RerunNotebookResponse",
    "ReviewFinding",
    "Seed",
    "Style",
    "UpdateCourseRequest",
    "UpdateNotebookRequest",
    "QappExecution",
    "QappExecutionStatus",
    "QappGenerated",
    "QappRangeSmoke",
    "QappRangeSmokeStatus",
    "QappVersion",
    "PublicQapp",
    "Project",
    "ProjectShare",
    "FootprintSummary",
    "FrontierPointSummary",
    "FrontierSummary",
    "LogicalCostSummary",
    "PublicCatalogEntry",
    "PlannableVerificationMethod",
    "PublicationState",
    "QasmEmission",
    "QpuEstimateBasis",
    "ResourceEstimateBasis",
    "RuntimeSummary",
    "ScalingCurvePointSummary",
    "ScalingCurveSummary",
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
