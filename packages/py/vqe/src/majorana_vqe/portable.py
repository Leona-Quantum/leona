"""Portable VQE scientific identity contracts (Phase 4.5, schema v0.2).

Database UUIDs identify registry rows, not scientific meaning.  The models in
this module therefore contain only stable semantic keys, content digests,
canonical parameter-slot values, and scientific inputs.  A separate registry
resolution records which ArtifactVersions supplied those definitions.
"""

from __future__ import annotations

import hashlib
import json
import math
import struct
from typing import Literal, Self
from uuid import UUID

from pydantic import Field, model_validator

from .models import (
    SHA256_HEX_PATTERN,
    ComponentType,
    VqeBaseModel,
    reject_path_module_or_code,
)

PORTABLE_SPEC_VERSION = "0.2.0"
FLOAT64_HEX_PATTERN = r"^[0-9a-f]{16}$"

# The two roles added in v0.2 are comparison-critical: chemistry preparation
# affects the Hamiltonian, and compilation/resource protocol affects every
# circuit-resource claim. Error mitigation and learning/training remain
# explicitly unsupported by the H2 MVP capability rather than disappearing
# from a digest.
PORTABLE_SCIENTIFIC_ROLES: tuple[ComponentType, ...] = (
    ComponentType.PROBLEM,
    ComponentType.PROBLEM_PREPARATION,
    ComponentType.REPRESENTATION,
    ComponentType.REFERENCE_STATE,
    ComponentType.ANSATZ,
    ComponentType.OPERATOR_POOL,
    ComponentType.SEARCH_SELECTION,
    ComponentType.GROWTH_BATCHING,
    ComponentType.PARAMETER_OPTIMIZER,
    ComponentType.COMPRESSION,
    ComponentType.MEASUREMENT,
    ComponentType.COMPILATION_BACKEND,
    ComponentType.EVALUATION_PROTOCOL,
    ComponentType.STOPPING_PROTOCOL,
)


def float_to_ieee754_hex(value: float) -> str:
    """Canonical big-endian IEEE-754 binary64 bytes as lowercase hex."""
    if not math.isfinite(value):
        raise ValueError("scientific parameter values must be finite")
    return struct.pack(">d", value).hex()


def ieee754_hex_to_float(value: str) -> float:
    if len(value) != 16:
        raise ValueError("float64 hex must contain exactly 16 lowercase hex digits")
    decoded = struct.unpack(">d", bytes.fromhex(value))[0]
    if not math.isfinite(decoded):
        raise ValueError("scientific parameter values must be finite")
    return decoded


class ComponentSemanticBinding(VqeBaseModel):
    role: ComponentType
    ordinal: int = Field(default=0, ge=0)
    component_type: ComponentType
    component_semantic_key: str = Field(min_length=1, max_length=200)
    component_spec_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    applicability: Literal["required", "not_applicable"] = "required"

    @model_validator(mode="after")
    def _role_and_key_are_valid(self) -> Self:
        if self.role is not self.component_type:
            raise ValueError("component role and component_type must match in schema v0.2")
        if self.role is ComponentType.WORKFLOW:
            raise ValueError("workflow cannot be a leaf scientific component")
        reject_path_module_or_code(
            self.component_semantic_key,
            field_path="component_semantic_key",
        )
        return self


class ParameterSlotValue(VqeBaseModel):
    slot_id: str = Field(min_length=1, max_length=200)
    float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)

    @model_validator(mode="after")
    def _slot_is_canonical(self) -> Self:
        reject_path_module_or_code(self.slot_id, field_path="slot_id")
        # Decoding catches canonical encodings of NaN/Infinity.
        ieee754_hex_to_float(self.float64_hex)
        return self


def _canonical_json_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def normalized_component_spec_digest(
    *,
    component_type: ComponentType,
    spec_json: dict[str, object],
) -> str:
    """Content identity for a typed component, independent of registry UUID."""
    return _canonical_json_sha256(
        {
            "digest_protocol": "majorana-vqe-component-spec-v1",
            "component_type": component_type.value,
            "spec_json": spec_json,
        }
    )


def workflow_semantic_digest(bindings: list[ComponentSemanticBinding]) -> str:
    ordered = sorted(
        (binding.model_dump(mode="json") for binding in bindings),
        key=lambda item: (item["role"], item["ordinal"]),
    )
    return _canonical_json_sha256(
        {
            "digest_protocol": "majorana-vqe-workflow-v1",
            "component_bindings": ordered,
        }
    )


class PortableScientificExperimentSpec(VqeBaseModel):
    schema_version: Literal["0.2.0"] = PORTABLE_SPEC_VERSION
    workflow_semantic_digest: str = Field(pattern=SHA256_HEX_PATTERN)
    component_bindings: list[ComponentSemanticBinding] = Field(min_length=1, max_length=16)
    dataset_snapshot_sha256: str | None = Field(default=None, pattern=SHA256_HEX_PATTERN)
    initial_parameter_slots: list[ParameterSlotValue] = Field(default_factory=list, max_length=256)
    seed: int = Field(ge=0)

    @model_validator(mode="after")
    def _composition_is_complete_and_digest_matches(self) -> Self:
        keys = [(binding.role, binding.ordinal) for binding in self.component_bindings]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate (role, ordinal) in component_bindings")
        roles = {binding.role for binding in self.component_bindings}
        missing = set(PORTABLE_SCIENTIFIC_ROLES) - roles
        if missing:
            raise ValueError(
                "portable scientific spec is missing required roles: "
                + ", ".join(sorted(role.value for role in missing))
            )
        unsupported = roles - set(PORTABLE_SCIENTIFIC_ROLES)
        if unsupported:
            raise ValueError(
                "portable scientific spec contains unsupported roles: "
                + ", ".join(sorted(role.value for role in unsupported))
            )
        for binding in self.component_bindings:
            if binding.ordinal != 0:
                raise ValueError("schema v0.2 supports exactly one ordinal=0 component per role")
        expected = workflow_semantic_digest(self.component_bindings)
        if self.workflow_semantic_digest != expected:
            raise ValueError("workflow_semantic_digest does not match component_bindings")
        slot_ids = [slot.slot_id for slot in self.initial_parameter_slots]
        if len(slot_ids) != len(set(slot_ids)):
            raise ValueError("duplicate initial parameter slot_id")
        return self


class RegistryComponentResolution(VqeBaseModel):
    role: ComponentType
    ordinal: int = Field(default=0, ge=0)
    artifact_version_id: UUID
    component_semantic_key: str = Field(min_length=1, max_length=200)
    component_spec_sha256: str = Field(pattern=SHA256_HEX_PATTERN)

    @model_validator(mode="after")
    def _key_is_safe(self) -> Self:
        reject_path_module_or_code(
            self.component_semantic_key,
            field_path="component_semantic_key",
        )
        return self


class RegistryResolution(VqeBaseModel):
    schema_version: Literal["0.1.0"] = "0.1.0"
    workflow_artifact_version_id: UUID
    components: list[RegistryComponentResolution] = Field(min_length=14, max_length=16)

    @model_validator(mode="after")
    def _resolution_keys_are_unique(self) -> Self:
        keys = [(item.role, item.ordinal) for item in self.components]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate registry component resolution")
        return self


class ResolvedPortableExperiment(VqeBaseModel):
    scientific_spec: PortableScientificExperimentSpec
    registry_resolution: RegistryResolution


def portable_scientific_spec_digest(spec: PortableScientificExperimentSpec) -> str:
    return _canonical_json_sha256(spec.model_dump(mode="json"))


def registry_resolution_digest(resolution: RegistryResolution) -> str:
    return _canonical_json_sha256(resolution.model_dump(mode="json"))
