"""API-facing resource models mirroring plans/archive/rebuild/04-database.md §2 (archived;
live schema authority is majorana/docs/runbooks/database.md). These are
the /v1 response shapes, not ORM rows — the repository layer maps between them."""

from datetime import datetime
from typing import Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .enums import (
    EvidenceStrength,
    ExportStatus,
    Framework,
    QpuEstimateBasis,
    QpuProvider,
    QpuRunStatus,
    ResourceEstimateBasis,
    Role,
    RunMode,
    RunStatus,
    RetryTarget,
    SemanticReviewDecision,
    ShareRole,
    VerificationFailureClass,
    VerificationMethod,
    VerificationResultKind,
    VerifierDecision,
    Visibility,
    WorkspaceKind,
)


class _ResourceBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VerificationSummary(_ResourceBase):
    """Typed final verification state shared by events and API resources.

    The object is optional on legacy resources, but every newly written summary is
    complete enough to explain the decision without inferring trust from absence.
    """

    decision: VerifierDecision
    semantic_review_decision: SemanticReviewDecision | None = None
    evidence_strength: EvidenceStrength | None = None
    reason_code: str = Field(min_length=1, max_length=120)
    candidate_defect_observed: bool
    failure_class: VerificationFailureClass | None = None
    retry_target: RetryTarget
    unverified_claims: list[str] = Field(default_factory=list, max_length=50)
    checks: list["VerificationCheckSummary"] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def inconclusive_never_blames_the_candidate(self) -> Self:
        if self.decision is VerifierDecision.INCONCLUSIVE and self.candidate_defect_observed:
            raise ValueError("inconclusive requires candidate_defect_observed=false")
        return self


class VerificationCheckSummary(_ResourceBase):
    """Bounded public projection of one trusted verification check."""

    method: VerificationMethod
    result: VerificationResultKind


class Workspace(_ResourceBase):
    id: UUID
    kind: WorkspaceKind
    name: str
    owner_user_id: UUID
    plan: str
    # Settings toggle (0036), default off: when true a finished run files its
    # artifact in the Vault immediately instead of waiting for "Keep this".
    auto_keep_artifacts: bool = False
    created_at: datetime
    deleted_at: datetime | None = None


class WorkspaceMember(_ResourceBase):
    user_id: UUID
    email: str
    display_name: str | None = None
    role: Role
    created_at: datetime


class WorkspaceSummary(_ResourceBase):
    """One row of the workspace switcher: a tenant the caller can act in.

    `is_active` is what the *next* request will scope to, not the raw value of
    the stored pointer — a pointer to a workspace the caller was removed from
    resolves back to personal, and the switcher must show where they actually
    are.
    """

    id: UUID
    kind: WorkspaceKind
    name: str
    role: Role
    #: The caller's own personal workspace. Not `kind == personal`: a member of
    #: someone else's personal workspace sees kind=personal for a tenant that is
    #: not theirs.
    is_personal: bool
    is_active: bool


class WorkspaceInvitation(_ResourceBase):
    """A workspace the caller has been added to and has not been told about.

    Not a pending offer: the membership already grants access, so this is a
    notice rather than an invitation to accept. The distinction matters for the
    copy — "you can open this now", not "do you accept".

    `invited_by_email` is the inviter's address, which the invitee can already
    see in the workspace's member list. It is here because "you were added to
    Ion trap group" with no author reads like something the system did.
    """

    workspace_id: UUID
    workspace_name: str
    role: Role
    #: NULL when the membership predates migration 0038, or when the inviter's
    #: account has been deleted. The notice drops the name rather than the whole
    #: message.
    invited_by_email: str | None = None
    invited_by_name: str | None = None
    created_at: datetime


class WorkspaceOverview(_ResourceBase):
    workspace: Workspace
    members: list[WorkspaceMember]
    artifact_count: int = Field(ge=0)
    run_count: int = Field(ge=0)


class WorkspaceFolder(_ResourceBase):
    id: UUID
    workspace_id: UUID
    name: str = Field(min_length=1, max_length=80)
    created_at: datetime
    updated_at: datetime


class Project(_ResourceBase):
    """Studio's artifact grouping (migration 0041).

    Deliberately identical in shape to `WorkspaceFolder` and deliberately not the
    same model: Run's Folders group runs, Studio's Projects group artifacts, and
    the owner's distinction between the two words is the reason one locale key
    stopped rendering both sections.

    `position` is absent for the same reason it is absent from `WorkspaceFolder`:
    the order is carried by the JSON array, and putting the integer on the wire
    would add a shared-contract field to say what the array already says.
    """

    id: UUID
    workspace_id: UUID
    name: str = Field(min_length=1, max_length=80)
    #: How many artifacts this project may hold when a SHARE grantee contributes
    #: one (migration 0043). Always a number on the wire even though the column is
    #: nullable: NULL means the platform default, and a client that had to know
    #: what NULL resolves to would be a second copy of that default to drift from.
    #: 0 is legal and means "editors may edit what is here and add nothing".
    max_artifacts: int = Field(ge=0, le=500)
    created_at: datetime
    updated_at: datetime


class ProjectShare(_ResourceBase):
    """One grant on one project, as the workspace that owns it sees it (0042).

    Carries the grantee's email because that is what the grant was made with and
    what the person managing it recognises; a user id is not something anybody can
    check a name against. It carries nothing else about the grantee's account —
    the granting workspace learns that this address has access, not what else the
    address is.
    """

    project_id: UUID
    grantee_user_id: UUID
    grantee_email: str
    grantee_display_name: str | None = None
    role: ShareRole
    granted_by_user_id: UUID
    #: NULL when the granter's account has since been deleted — the row keeps
    #: saying who has access even when it can no longer say who let them in.
    granted_by_email: str | None = None
    #: NULL = the grant does not expire.
    expires_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class SharedProject(_ResourceBase):
    """A project someone else's workspace has granted to the caller (0042).

    Deliberately not a `Project`. A `Project` is a row the caller's workspace owns
    and may rename, reorder and delete; this is a window into somebody else's, and
    the fields that do not apply are absent rather than present-and-ignored. A
    client that receives one of these cannot accidentally send it back to a route
    that writes.
    """

    id: UUID
    name: str = Field(min_length=1, max_length=80)
    owner_workspace_id: UUID
    owner_workspace_name: str
    role: ShareRole
    shared_by_email: str | None = None
    shared_by_display_name: str | None = None
    #: NULL = the grant does not expire.
    expires_at: datetime | None = None
    #: When the grant was made, not when the project was created — the project may
    #: predate the share by years and the caller has no business knowing that.
    shared_at: datetime
    #: Kept, undeleted artifacts filed under this project right now.
    artifact_count: int = Field(ge=0)
    #: What the owner will let this project grow to (migration 0043). An EDITOR
    #: whose `artifact_count` has reached it cannot contribute — which is why the
    #: number is here rather than only in the refusal it produces.
    artifact_limit: int = Field(ge=0, le=500)
    #: The latest change to anything the caller can see through this grant — the
    #: project row or any artifact in it. A polling client compares this to what it
    #: last rendered to know somebody else edited, without diffing the contents.
    revision: datetime


class Artifact(_ResourceBase):
    id: UUID
    workspace_id: UUID
    slug: str = Field(description="Unique; used for public pages")
    title: str
    family: str = Field(description="Algorithm category")
    framework: Framework
    visibility: Visibility
    parent_artifact_id: UUID | None = Field(default=None, description="Provenance edge")
    current_version_id: UUID | None = None
    # From the current version's verification_summary, carried on the LIST
    # resource so the Vault list can say what each artifact's verdict was proved
    # by without opening it. Until 2026-07-20 the list had no grade at all, so
    # the web fabricated "verified" as the default and an unopened structurally-
    # verified artifact over-claimed until its detail page corrected it. None
    # means the version predates the summary (or there is no version) — absence,
    # not a verdict.
    verifier_decision: VerifierDecision | None = None
    evidence_strength: EvidenceStrength | None = None
    verification_summary: VerificationSummary | None = None
    created_at: datetime
    updated_at: datetime
    # When the user chose to keep this in the Vault. None means the run
    # materialized it — so the Run surface keeps its conversion tabs and the next
    # turn can fork from it — but it is not filed in the Vault. Distinct from
    # deleted_at: never kept is not the same as thrown away.
    kept_at: datetime | None = None
    # The project this artifact is filed under (migration 0041), or None for the
    # ungrouped list. Carried on the resource rather than fetched per artifact
    # because the sidebar groups the whole list in one pass; a separate
    # assignments call would be a second round trip that can disagree with the
    # first.
    project_id: UUID | None = None
    deleted_at: datetime | None = None


class ArtifactVersion(_ResourceBase):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "allOf": [
                {
                    "if": {
                        "required": ["qasm"],
                        "properties": {"qasm": {"type": "string"}},
                    },
                    "then": {
                        "required": ["qasm_version"],
                        "properties": {"qasm_version": {"const": "3.0"}},
                    },
                }
            ]
        },
    )

    id: UUID
    artifact_id: UUID
    seq: int = Field(ge=1)
    qasm_version: Literal["3.0"] | None = Field(
        default=None, description="Optional OpenQASM interchange version"
    )
    qasm: str | None = Field(
        default=None,
        description="Optional normalized OpenQASM interchange for framework conversion",
    )
    metadata: dict[str, Any] | None = Field(
        default=None,
        description="Canonical-source role, provenance, and legacy migration data",
    )
    code: str
    code_lang: str
    fingerprint: str = Field(
        description=(
            "Digest of the framework and normalized selected-framework source; "
            "identical source may share a fingerprint across artifact versions"
        )
    )
    export_status: ExportStatus
    export_reason: str | None = None
    framework_variants: dict[str, str] | None = None
    resource_estimates: dict[str, Any] | None = None
    limitations: str | None = None
    verification_summary: VerificationSummary | None = None
    created_at: datetime

    @model_validator(mode="after")
    def validate_qasm_version(self) -> Self:
        """Require canonical QASM text and its version marker to appear together."""
        if self.qasm is None and self.qasm_version is not None:
            raise ValueError("qasm_version must be null when qasm is null")
        if self.qasm is not None and self.qasm_version != "3.0":
            raise ValueError('qasm_version must be "3.0" when qasm is present')
        return self


class CatalogProvenance(_ResourceBase):
    """How a published catalog entry entered the catalog (repository Step 6).

    For the ADR-0019 bootstrap corpus this is the pinned-manifest identity: the
    import provider, the manifest's pinned source commit, the per-item manifest
    identity, and the content hash of the exact source bytes. It anchors the
    entry to reproducible provenance without trusting any field inside `record`.
    """

    import_provider: str | None = None
    upstream_ref: str | None = Field(
        default=None, description="Pinned upstream ref (e.g. the manifest source commit)"
    )
    upstream_identity: str | None = Field(
        default=None, description="Per-item manifest identity; equals the public slug"
    )
    source_blob_sha256: str | None = Field(
        default=None, description="sha256 of the exact stored source bytes"
    )


class PublicCatalogEntry(_ResourceBase):
    """A published catalog record served to anonymous readers (repository Step 6).

    The typed fields are database-authoritative facts: the stable public `slug`
    (the pinned manifest identity), the honest `execution_state`, the update
    timestamp, and reproducible `provenance`. `record` carries the pinned
    catalog source blob verbatim — the rich presentation entry (algorithm
    family, category, classical comparisons, verification prose, code variants,
    localized copy). Everything in `record` is *asserted catalog metadata from
    the pinned source*, NOT passing-run evidence or legal approval (ADR-0019);
    clients must render it as a claim. Only accepted+public records are returned.
    """

    slug: str = Field(description="Stable public identity (pinned manifest identity)")
    execution_state: str = Field(
        description="Authoritative honest lifecycle state; the bootstrap corpus is template_only"
    )
    updated_at: datetime
    provenance: CatalogProvenance | None = None
    record: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Pinned catalog source record (the rich presentation entry). A source "
            "claim from the pinned manifest, not execution evidence or legal approval."
        ),
    )


class AssumptionSetSummary(_ResourceBase):
    """The named hardware+protocol claim an estimate was computed under.

    Served with every estimate rather than referenced by id, because an estimate
    read without its assumption set is not a weaker number — it is a different
    kind of thing, and a client that had to fetch the set separately would
    render the number first.
    """

    identity: str = Field(
        description=(
            "Stable identity, e.g. `gidney-2025@v1+eps=1e-06`. Two estimates may "
            "be ranked against each other only when these strings match."
        )
    )
    name: str
    version: int = Field(ge=1)
    citation: str
    rotation_synthesis_epsilon: float | None = Field(
        default=None,
        description=(
            "Per-rotation approximation error the Clifford+T synthesis is held "
            "to. Null when no precision was named, in which case any circuit "
            "containing an arbitrary-angle rotation has no T-count at all."
        ),
    )
    t_per_rotation: int | None = Field(
        default=None,
        ge=1,
        description="T gates one arbitrary-angle rotation costs under this precision.",
    )
    t_per_toffoli: int = Field(ge=1)
    physical_error_rate: float
    cycle_time_s: float
    reaction_time_s: float


class LogicalCostSummary(_ResourceBase):
    """Layer 1: what the algorithm needs, before any hardware is named."""

    logical_qubits: int = Field(ge=1)
    t_count: int = Field(ge=0)
    toffoli_count: int = Field(ge=0)
    non_clifford_depth: int = Field(ge=0, description="Longest serial non-Clifford chain.")
    magic_states: int = Field(ge=0)
    clifford_count: int = Field(
        ge=0, description="Reported so a reader can see the circuit was read."
    )
    synthesis_required: int = Field(
        ge=0, description="Arbitrary-angle rotations whose T-count came from the stated epsilon."
    )
    t_from_synthesis: int = Field(
        ge=0,
        description=(
            "How much of `t_count` is the epsilon's doing rather than the circuit's. "
            "The single number a reader needs to judge how load-bearing the "
            "assumption is; without it the two are indistinguishable in the total."
        ),
    )


class CodeDistanceSummary(_ResourceBase):
    """Layer 2's working, not just its answer."""

    code_distance: int = Field(ge=3)
    logical_operations: int = Field(ge=1)
    required_error_per_operation: float
    achieved_error_per_operation: float
    physical_per_logical: int = Field(ge=1)


class FootprintSummary(_ResourceBase):
    """Layer 3, split so the data/factory trade stays visible rather than lumped."""

    data_patch_qubits: int = Field(ge=0)
    routing_qubits: int = Field(ge=0)
    factory_qubits: int = Field(ge=0)
    total_physical_qubits: int = Field(ge=0)


class RuntimeSummary(_ResourceBase):
    """Layer 4, with both terms kept apart.

    Reporting only `seconds` would hide which constraint binds, and that is the
    whole decision a reader is trying to make: more factories move the
    throughput term and do nothing whatever to the reaction-limited one.
    """

    magic_states: int = Field(ge=0)
    factory_count: int = Field(ge=0)
    throughput_seconds: float | None = Field(
        default=None, description="Null when unbounded, i.e. states to distil and no factory."
    )
    reaction_limited_seconds: float
    seconds: float | None = Field(
        default=None,
        description=(
            "Null when this model cannot state a wall-clock — a Clifford-only "
            "circuit consumes no magic states, so both terms above are zero and "
            "reporting their max would claim the circuit runs instantly."
        ),
    )
    binding_term: Literal["throughput", "reaction", "unstated"]
    factory_crossover: int | None = Field(
        default=None,
        ge=1,
        description="Fewest factories past which buying more buys nothing. Null when no floor is known.",
    )


class CatalogEntryEstimate(_ResourceBase):
    """A catalogue entry's fault-tolerant cost, or a stated reason there is none (E4).

    Derived on read from the published record's own portable circuit — never
    authored, never stored — so it cannot drift from the circuit a visitor is
    looking at on the same page.

    `basis` is the field to branch on. Only EXACT and ESTIMATED carry numbers;
    the other two carry `reason` and nothing else, and a client that renders a
    number without checking `basis` will publish a cost for a circuit that has
    none.
    """

    slug: str
    basis: ResourceEstimateBasis
    assumptions: AssumptionSetSummary
    reason: str | None = Field(
        default=None,
        description=(
            "Why no number is given, in one sentence naming the operations "
            "responsible. Present exactly when `basis` is REFUSED or NO_CIRCUIT."
        ),
    )
    logical: LogicalCostSummary | None = None
    distance: CodeDistanceSummary | None = None
    footprint: FootprintSummary | None = None
    runtime: RuntimeSummary | None = None
    target_failure_probability: float | None = Field(default=None, gt=0, lt=1)
    notes: list[str] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def _numbers_and_reasons_are_mutually_exclusive(self) -> Self:
        """A response carrying both a cost and a refusal is unrenderable.

        Enforced here rather than trusted to the route, because this is the
        invariant the whole feature rests on: the UI decides what to show from
        `basis`, and a payload where `basis` disagrees with the fields present
        would render a number under a refusal heading or the reverse.
        """
        priced = self.basis in (ResourceEstimateBasis.EXACT, ResourceEstimateBasis.ESTIMATED)
        layers = (self.logical, self.distance, self.footprint, self.runtime)
        if priced:
            if any(layer is None for layer in layers):
                raise ValueError(f"basis {self.basis} must carry every layer of the estimate")
            if self.reason is not None:
                raise ValueError(f"basis {self.basis} carries a cost, so it states no reason")
        else:
            if any(layer is not None for layer in layers):
                raise ValueError(f"basis {self.basis} states no cost, so it carries no layers")
            if not self.reason:
                raise ValueError(f"basis {self.basis} must say why there is no cost")
        if priced and self.basis is ResourceEstimateBasis.ESTIMATED:
            if self.assumptions.rotation_synthesis_epsilon is None:
                raise ValueError("an estimated cost must name the precision it was estimated under")
        return self


class CatalogEstimateSummary(_ResourceBase):
    """One row's worth of a catalogue entry's cost, for the browse list.

    A projection of `CatalogEntryEstimate`, not a second computation of it: the
    same function produces both, so a list row and the detail page it links to
    cannot disagree. Carries `assumptions` as a bare identity string because a
    list is costed under one set and repeating the full record 283 times would
    be most of the payload.
    """

    slug: str
    basis: ResourceEstimateBasis
    total_physical_qubits: int | None = Field(default=None, ge=0)
    magic_states: int | None = Field(default=None, ge=0)
    logical_qubits: int | None = Field(default=None, ge=1)
    code_distance: int | None = Field(default=None, ge=3)
    seconds: float | None = None


class CatalogEstimateList(_ResourceBase):
    """Every published entry's cost under one assumption set.

    The set is stated **once, for the whole list**, which is the shape that makes
    the ordering rule enforceable: a client holding this object knows every row
    in it is comparable, and has nothing to compare across. Ranking rows from
    two of these — two epsilons, two hardware sets — is the thing that must not
    happen, and it now requires visibly merging two payloads that each announce
    a different identity.
    """

    assumptions: AssumptionSetSummary
    estimates: list[CatalogEstimateSummary] = Field(default_factory=list)


class ResourceMetrics(_ResourceBase):
    """Comparable circuit-resource measurements for selected-framework source."""

    qubits: int = Field(ge=0)
    depth: int | None = Field(default=None, ge=0)
    gate_count: int | None = Field(default=None, ge=0)
    two_qubit_gate_count: int | None = Field(default=None, ge=0)
    measurement_count: int | None = Field(default=None, ge=0)
    estimated_runtime_ms: int | None = Field(default=None, ge=0)


class Run(_ResourceBase):
    id: UUID
    conversation_id: UUID
    workspace_id: UUID
    user_id: UUID
    artifact_version_id: UUID | None = None
    folder_id: UUID | None = None
    task_prompt: str
    mode: RunMode
    status: RunStatus
    framework: Framework
    seed: int | None = None
    shots: int | None = None
    timeout_s: int | None = None
    sandbox_provider: str | None = None
    sandbox_meta: dict[str, Any] | None = Field(
        default=None, description="Duration, memory, exit code as reported by the provider"
    )
    verifier_decision: VerifierDecision | None = None
    verification_summary: VerificationSummary | None = None
    residual_risks: str | None = None
    baseline: dict[str, Any] | None = Field(
        default=None, description="Baseline result, or {not_applicable_reason}"
    )
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class ConversationTurn(_ResourceBase):
    run: Run
    events: list[dict[str, Any]] = Field(default_factory=list)


class Conversation(_ResourceBase):
    id: UUID
    workspace_id: UUID
    turns: list[ConversationTurn] = Field(default_factory=list)


class VerificationRecord(_ResourceBase):
    id: UUID
    run_id: UUID
    method: VerificationMethod
    params: dict[str, Any]
    result: VerificationResultKind
    details: dict[str, Any]
    created_at: datetime


class QpuRunRecord(_ResourceBase):
    """Provider-attested hardware run — the /v1 shape for the durable qpu_run
    seam. Its storage lands in the follow-up migration PR (deploys migrate
    before rollout, so the contract ships first); until that lands no endpoint
    returns it. `raw_counts` is exactly what the provider returned — raw,
    never averaged or corrected in place."""

    id: UUID
    workspace_id: UUID
    user_id: UUID
    artifact_version_id: UUID | None = None
    provider: QpuProvider
    device_id: str
    provider_job_id: str | None = None
    shots: int = Field(ge=1)
    status: QpuRunStatus
    source_fingerprint: str
    # Snapshot of the estimate exactly as shown at confirmation time, so the
    # record proves what the user agreed to — not what the rate card says now.
    estimate_basis: QpuEstimateBasis
    estimated_total_usd: float | None = None
    rate_source: str
    rate_confirmed_on: str
    raw_counts: dict[str, int] | None = None
    error: str | None = None
    submitted_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
