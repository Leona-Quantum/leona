"""VQE registry metadata and legacy schema v0.1 contracts.

Pure Pydantic models per ADR-0023 (identity), ADR-0024 (runtime trust
boundary), ADR-0025 (evidence). No Qiskit/PennyLane/FastAPI/SQLAlchemy
imports -- see AGENTS.md. Portable scientific identity v0.2 lives in
``portable.py`` and capability-specific evidence lives in ``result.py``.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA_VERSION = "0.1.0"

SHA256_HEX_PATTERN = r"^[0-9a-f]{64}$"

# Recursive JSON-safe value type. Deliberately excludes anything that isn't a
# JSON primitive/container -- this alone prevents ComponentSpec.spec_json (or
# any other JSONValue-typed field) from ever holding an arbitrary Python
# object (a class, function, module, file handle, ...), independent of the
# string-content checks below.
#
# Must be a PEP 695 `type` statement, not a plain `X = a | b | list["X"]`
# assignment: pydantic-core cannot safely build a core schema for a
# self-referential Union defined that way (it recurses until Python's call
# stack gives out). `type` statements get pydantic's dedicated recursive
# TypeAliasType handling instead.
type JSONValue = str | int | float | bool | None | list[JSONValue] | dict[str, JSONValue]


# --- path/module/code rejection (plan Part II §9: "任意Python code、module名、
# filesystem pathは全contractで禁止する") -----------------------------------
#
# Deliberately an ALLOWLIST-shaped check (the string must look like a plain
# label), not a blocklist of "dangerous" substrings: blocklists are easy to
# bypass and hard to prove complete, whereas rejecting anything that doesn't
# match a bounded label pattern is a fail-closed default. A handful of
# additional patterns are blocked explicitly for a clearer error message on
# the most common offending shapes (paths, dotted imports, call syntax).
#
# The allowlist includes "/" and common prose punctuation (";:'?!\"") --
# real, legitimate content this schema must carry needs it: DOIs like
# "10.1038/ncomms5213", OCI image refs like "vendor/image:tag", paper titles
# with colons ("Qubit-ADAPT-VQE: An Adaptive Algorithm..."), descriptions
# with semicolons ("LiH and BeH2 ground-state energies; 4-qubit Heisenberg
# model" -- an actual rejected string from a real paper annotation during
# Phase 1 testing, which is why this allowlist was widened rather than left
# at its first-draft narrower version). This is still safe: _PATH_LIKE_PATTERN
# below runs first and independently rejects anything starting with "/",
# "./", "~", a Windows drive letter, or containing a "../" traversal
# sequence anywhere -- none of the newly-allowed punctuation defeats that.
#
# Deliberately unbounded length here (no {0,N} cap): this pattern validates
# CHARSET safety only. Length is each field's own concern via its Pydantic
# Field(max_length=...) -- baking a second, different length limit into this
# shared regex caused a real bug (found while generating Phase 2 comparison
# reports): ComparisonDimension.detail declared max_length=500 but this
# pattern silently capped content at 200 chars regardless, rejecting valid
# input under its own declared limit. One limit per constraint, enforced in
# one place.
_SAFE_LABEL_PATTERN = re.compile(r"""^[\w][\w \-./,+()%;:'?!"]*$""")
_PATH_LIKE_PATTERN = re.compile(r"(^[./~]|\.\./|^[A-Za-z]:\\|\x00)")
_CODE_OR_MODULE_LIKE_PATTERN = re.compile(
    r"(__\w+__|\beval\s*\(|\bexec\s*\(|\bimport\s+\w|\bos\.\w|\bsubprocess\.\w"
    r"|\.py$|\.so$|\.dll$|\.dylib$)"
)


def reject_path_module_or_code(value: str, *, field_path: str) -> str:
    if _PATH_LIKE_PATTERN.search(value):
        raise ValueError(
            f"{field_path}: looks like a filesystem path, which is never accepted here"
        )
    if _CODE_OR_MODULE_LIKE_PATTERN.search(value):
        raise ValueError(
            f"{field_path}: looks like Python code or a module reference, "
            "which is never accepted here"
        )
    if not _SAFE_LABEL_PATTERN.match(value):
        raise ValueError(
            f"{field_path}: must be a plain label "
            "(word characters, spaces, and -./,+()%;:'?!\" only; length is "
            "enforced separately by the field's own max_length)"
        )
    return value


def walk_and_validate_json_value(value: JSONValue, *, field_path: str) -> None:
    if isinstance(value, str):
        reject_path_module_or_code(value, field_path=field_path)
    elif isinstance(value, dict):
        for key, item in value.items():
            reject_path_module_or_code(key, field_path=f"{field_path}.{key}")
            walk_and_validate_json_value(item, field_path=f"{field_path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            walk_and_validate_json_value(item, field_path=f"{field_path}[{index}]")
    # int/float/bool/None need no further check.


class VqeBaseModel(BaseModel):
    """Every VQE contract model is immutable and rejects unknown fields --
    an unrecognized field is a bug in the caller, not something to silently
    drop (plan Part IV Phase 1 Tests: "invalid/unknown field rejection")."""

    # Scientific identities and evidence must never carry IEEE-754 sentinels.
    # NaN/Infinity are not stable JSON values (Pydantic serializes them as
    # null, while other serializers may emit NaN/Infinity), so accepting them
    # would let the validated object, persisted JSON, and content digest
    # disagree. Numerical failures are represented by ResultContract.status /
    # failure_code instead.
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)


class SpecJsonMixin(VqeBaseModel):
    """Shared validator for any model carrying a free-form JSONValue payload
    field named `spec_json` or `binding_metadata` -- walks the whole value
    and rejects path/module/code-shaped strings anywhere inside it."""

    @model_validator(mode="after")
    def _validate_json_payload_fields(self) -> Self:
        for field_name in ("spec_json", "binding_metadata"):
            if field_name in type(self).model_fields:
                walk_and_validate_json_value(getattr(self, field_name), field_path=field_name)
        return self


class ComponentType(str, Enum):
    """The 17 component types MVP schema distinguishes (ADR-0028)."""

    PROBLEM = "problem"
    PROBLEM_PREPARATION = "problem_preparation"
    REPRESENTATION = "representation"
    REFERENCE_STATE = "reference_state"
    ANSATZ = "ansatz"
    OPERATOR_POOL = "operator_pool"
    SEARCH_SELECTION = "search_selection"
    GROWTH_BATCHING = "growth_batching"
    PARAMETER_OPTIMIZER = "parameter_optimizer"
    COMPRESSION = "compression"
    MEASUREMENT = "measurement"
    ERROR_MITIGATION = "error_mitigation"
    COMPILATION_BACKEND = "compilation_backend"
    LEARNING_TRAINING = "learning_training"
    EVALUATION_PROTOCOL = "evaluation_protocol"
    STOPPING_PROTOCOL = "stopping_protocol"
    WORKFLOW = "workflow"


# Executable MVP workflows use the component type itself as the link role.
# The mapping is the single source of truth for constructing a
# ScientificExperimentSpec from immutable workflow links in the server
# repository layer. Component kinds absent here remain browsable registry
# metadata but cannot be silently omitted from an executable scientific
# identity; the resolver rejects such a workflow until a versioned spec adds
# an explicit field for them.
SCIENTIFIC_SPEC_ROLE_BINDINGS: dict[ComponentType, str] = {
    ComponentType.PROBLEM: "problem_version_id",
    ComponentType.REPRESENTATION: "representation_version_id",
    ComponentType.REFERENCE_STATE: "reference_state_version_id",
    ComponentType.ANSATZ: "ansatz_version_id",
    ComponentType.OPERATOR_POOL: "operator_pool_version_id",
    ComponentType.SEARCH_SELECTION: "selection_version_id",
    ComponentType.GROWTH_BATCHING: "growth_version_id",
    ComponentType.PARAMETER_OPTIMIZER: "optimizer_version_id",
    ComponentType.COMPRESSION: "compression_version_id",
    ComponentType.MEASUREMENT: "measurement_protocol_version_id",
    ComponentType.EVALUATION_PROTOCOL: "evaluation_protocol_version_id",
    ComponentType.STOPPING_PROTOCOL: "stopping_protocol_version_id",
}


class AnnotationState(str, Enum):
    """Deprecated v0.1 combined state; retained only for reading old bundles."""

    DRAFT = "draft"
    HUMAN_REVIEWED = "human_reviewed"
    UNKNOWN = "unknown"
    CONFLICTING = "conflicting"


class MachineValidationState(str, Enum):
    UNVALIDATED = "unvalidated"
    MACHINE_VALIDATED = "machine_validated"
    VALIDATION_FAILED = "validation_failed"


class ReviewState(str, Enum):
    UNREVIEWED = "unreviewed"
    HUMAN_REVIEWED = "human_reviewed"
    AUTHOR_CONFIRMED = "author_confirmed"
    REVIEW_REJECTED = "review_rejected"
    CONFLICTING = "conflicting"


class ComponentReference(VqeBaseModel):
    """A component identified by its immutable ArtifactVersion (ADR-0023) --
    never a string label. This layer validates shape only (a well-formed
    UUID); existence/Scope checks are the repository layer's job in a later
    phase."""

    artifact_version_id: UUID
    component_type: ComponentType


class ComponentSpec(SpecJsonMixin):
    """Typed metadata attached to an existing Artifact/ArtifactVersion.
    Mirrors the `vqe_component_specs` table shape fixed by ADR-0023 (plan
    Part II §8), without committing to that table until Phase 3."""

    schema_version: str = Field(default=SCHEMA_VERSION, pattern=r"^\d+\.\d+\.\d+$")
    artifact_version_id: UUID
    component_type: ComponentType
    spec_json: dict[str, JSONValue] = Field(default_factory=dict)
    semantic_key: str | None = Field(default=None, min_length=1, max_length=200)
    normalized_spec_sha256: str | None = Field(default=None, pattern=SHA256_HEX_PATTERN)
    machine_validation_state: MachineValidationState = MachineValidationState.UNVALIDATED
    review_state: ReviewState = ReviewState.UNREVIEWED

    @model_validator(mode="after")
    def _semantic_key_is_safe(self) -> Self:
        if self.semantic_key is not None:
            reject_path_module_or_code(self.semantic_key, field_path="semantic_key")
        return self


class WorkflowComponentRef(SpecJsonMixin):
    """Links a Workflow ArtifactVersion to one of its component
    ArtifactVersions with an explicit role and ordinal (mirrors
    `vqe_workflow_components`, plan Part II §8)."""

    component_role: str = Field(min_length=1, max_length=100)
    component_artifact_version_id: UUID
    ordinal: int = Field(ge=0)
    binding_metadata: dict[str, JSONValue] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _role_is_a_safe_label(self) -> Self:
        reject_path_module_or_code(self.component_role, field_path="component_role")
        return self


class WorkflowSpec(VqeBaseModel):
    """A VQE "algorithm" as a composition of versioned components (plan
    Part II §7: "一つの「VQE algorithm」は...versioned componentを組み合わせた
    Workflowと定義する")."""

    schema_version: str = Field(default=SCHEMA_VERSION, pattern=r"^\d+\.\d+\.\d+$")
    workflow_artifact_version_id: UUID
    components: list[WorkflowComponentRef] = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def _ordinals_are_unique_per_role(self) -> Self:
        seen: set[tuple[str, int]] = set()
        for ref in self.components:
            key = (ref.component_role, ref.ordinal)
            if key in seen:
                raise ValueError(f"duplicate (component_role, ordinal) in workflow: {key}")
            seen.add(key)
        return self


class VersionLane(str, Enum):
    """Plan Part II §10: MVP has exactly these two lanes. `latest_observed`
    is explicitly deferred to the GitHub Wrapper phases and must never be
    added here without a superseding ADR (ADR-0024)."""

    FROZEN_REPRODUCTION = "frozen_reproduction"
    CURRENT_COMPATIBILITY = "current_compatibility"


class Framework(str, Enum):
    QISKIT = "qiskit"
    PENNYLANE = "pennylane"


class Capability(str, Enum):
    """Closed allowlist of capabilities a client may request (plan Part II
    §9: "requested_capability"). Extending this is a reviewed change, not a
    free-text field -- only what Phase 0 actually proved exists today."""

    H2_STO3G_EXACT_ENERGY = "h2_sto3g_exact_energy"


class ScientificExperimentSpec(VqeBaseModel):
    """`ScientificExperimentSpec v0.1` -- what to compute, with no framework,
    runtime, or provider information (ADR-0023/ADR-0024 boundary; plan Part
    II §9). Every `*_version_id` field is an ArtifactVersion reference for
    the component playing that role."""

    schema_version: str = Field(default=SCHEMA_VERSION, pattern=r"^\d+\.\d+\.\d+$")
    problem_version_id: UUID
    dataset_snapshot_id: str | None = Field(default=None, max_length=200)
    representation_version_id: UUID
    reference_state_version_id: UUID
    ansatz_version_id: UUID
    operator_pool_version_id: UUID
    selection_version_id: UUID
    growth_version_id: UUID
    optimizer_version_id: UUID
    compression_version_id: UUID
    measurement_protocol_version_id: UUID
    evaluation_protocol_version_id: UUID
    initial_parameters: list[float] = Field(default_factory=list, max_length=256)
    seed: int = Field(ge=0)
    stopping_protocol_version_id: UUID

    @model_validator(mode="after")
    def _dataset_snapshot_id_is_a_safe_label(self) -> Self:
        if self.dataset_snapshot_id is not None:
            reject_path_module_or_code(self.dataset_snapshot_id, field_path="dataset_snapshot_id")
        return self


class ExecutionRequest(VqeBaseModel):
    """What a client may ask for: a capability and an optional framework
    preference. Never a runtime profile, digest, or provider version --
    those are server-resolved (ADR-0024)."""

    experiment_id: UUID
    requested_capability: Capability
    preferred_framework: Framework | None = None


class ExecutionBinding(VqeBaseModel):
    """The server-resolved execution authority for a request (plan Part II
    §9). A client-supplied runtime_profile_key/digest/provider version is
    never authoritative -- this is what the server decided, never an echo of
    what the client asked for."""

    framework: Framework
    provider_versions: dict[str, str] = Field(default_factory=dict, max_length=32)
    runtime_profile_id: str = Field(min_length=1, max_length=200)
    adapter_release_id: str = Field(min_length=1, max_length=200)
    container_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    architecture: str = Field(min_length=1, max_length=50)
    dataset_snapshot_id: str | None = Field(default=None, max_length=200)
    protocol_version: str = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def _labels_are_safe(self) -> Self:
        for field_name in (
            "runtime_profile_id",
            "adapter_release_id",
            "architecture",
            "protocol_version",
        ):
            reject_path_module_or_code(getattr(self, field_name), field_path=field_name)
        for key, val in self.provider_versions.items():
            reject_path_module_or_code(key, field_path=f"provider_versions.{key}")
            reject_path_module_or_code(val, field_path=f"provider_versions.{key}")
        if self.dataset_snapshot_id is not None:
            reject_path_module_or_code(self.dataset_snapshot_id, field_path="dataset_snapshot_id")
        return self


class ExecutionStatus(str, Enum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class FailureCode(str, Enum):
    """Plan Part I §4: the closed set of terminal states a client sees
    instead of an indefinite spinner."""

    INVALID_SPEC = "invalid_spec"
    UNSUPPORTED_CAPABILITY = "unsupported_capability"
    RUNTIME_UNAVAILABLE = "runtime_unavailable"
    RUNTIME_TIMEOUT = "runtime_timeout"
    RUNTIME_OOM = "runtime_oom"
    EXECUTION_FAILED = "execution_failed"
    RESULT_CONTRACT_FAILED = "result_contract_failed"
    NUMERICAL_MISMATCH = "numerical_mismatch"
    INCONCLUSIVE = "inconclusive"


class EvidenceStage(str, Enum):
    """exact vs finite-shot evidence (ADR-0025) -- never conflated. A
    finite_shot result is never by itself sufficient for a scientific pass
    condition in the MVP (plan Part III §13)."""

    EXACT = "exact"
    FINITE_SHOT = "finite_shot"


class CircuitStage(str, Enum):
    """Whether a resource metric (qubits/depth/gate_count/...) was measured
    on the logical circuit or after compilation (ADR-0025: "resource metric
    stage/compiler semanticsを保存")."""

    LOGICAL = "logical"
    COMPILED = "compiled"


class TrajectoryOverflowRef(VqeBaseModel):
    """Where an energy trajectory too large to store inline landed instead
    (ADR-0025: "上限超過時はcontent-addressed objectへ保存")."""

    object_uri: str = Field(min_length=1, max_length=500)
    sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    size_bytes: int = Field(ge=0)


class ResultContract(VqeBaseModel):
    """Plan Part II §11. Deliberately excludes raw runtime stdout/stderr --
    that is bounded, secret-scanned log data, never part of this contract."""

    schema_version: str = Field(default=SCHEMA_VERSION, pattern=r"^\d+\.\d+\.\d+$")
    scientific_spec_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    framework: Framework
    provider_versions: dict[str, str] = Field(default_factory=dict, max_length=32)
    runtime_profile_id: str = Field(min_length=1, max_length=200)
    runtime_image_digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    adapter_release_id: str = Field(min_length=1, max_length=200)
    dataset_snapshot_id: str | None = Field(default=None, max_length=200)
    protocol_version: str = Field(min_length=1, max_length=50)
    hamiltonian_digest: str | None = Field(default=None, pattern=SHA256_HEX_PATTERN)
    status: ExecutionStatus
    failure_code: FailureCode | None = None
    best_energy_ha: float | None = None
    exact_energy_ha: float | None = None
    absolute_error_ha: float | None = Field(default=None, ge=0)
    iterations: int | None = Field(default=None, ge=0)
    converged: bool | None = None
    seed: int = Field(ge=0)
    parameter_count: int | None = Field(default=None, ge=0)
    qubits: int | None = Field(default=None, ge=0)
    depth: int | None = Field(default=None, ge=0)
    gate_count: int | None = Field(default=None, ge=0)
    two_qubit_gate_count: int | None = Field(default=None, ge=0)
    metric_stage: EvidenceStage | None = None
    logical_or_compiled: CircuitStage | None = None
    basis_gates: list[str] | None = Field(default=None, max_length=50)
    compiler: str | None = Field(default=None, max_length=100)
    compiler_version: str | None = Field(default=None, max_length=50)
    optimization_level: int | None = Field(default=None, ge=0)
    layout: list[int] | None = Field(default=None, max_length=64)
    routing: JSONValue | None = None
    compiler_seed: int | None = Field(default=None, ge=0)
    wall_time_ms: float | None = Field(default=None, ge=0)
    energy_trajectory: list[float] | None = Field(default=None, max_length=200)
    energy_trajectory_overflow: TrajectoryOverflowRef | None = None
    warnings: list[str] | None = Field(default=None, max_length=50)

    @model_validator(mode="after")
    def _status_and_evidence_are_consistent(self) -> Self:
        if self.status is ExecutionStatus.FAILED and self.failure_code is None:
            raise ValueError("status=failed requires an explicit failure_code")
        if self.status is ExecutionStatus.SUCCEEDED:
            if self.failure_code is not None:
                raise ValueError("status=succeeded must not carry a failure_code")
            if self.hamiltonian_digest is None:
                raise ValueError("status=succeeded requires hamiltonian_digest")
        if self.energy_trajectory is not None and self.energy_trajectory_overflow is not None:
            raise ValueError(
                "energy_trajectory and energy_trajectory_overflow are mutually exclusive"
            )
        if self.routing is not None:
            walk_and_validate_json_value(self.routing, field_path="routing")
        if self.compiler is not None:
            reject_path_module_or_code(self.compiler, field_path="compiler")
        return self
