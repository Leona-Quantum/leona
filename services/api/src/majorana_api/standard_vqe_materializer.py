"""Operator-only materialization of the bounded standard VQE seed catalog.

The static catalog remains the authored source. This module persists immutable,
private ArtifactVersions for Registry identity and comparison. It never
publishes, reviews, or promotes execution evidence.
"""

from __future__ import annotations

import dataclasses
import enum
import hashlib
import json
from dataclasses import dataclass
from typing import Any

from majorana_contracts import Scope
from majorana_contracts.enums import Algorithm, ExportStatus
from majorana_contracts.enums import Framework as ContractFramework
from majorana_vqe.models import ComponentType
from majorana_vqe.portable import normalized_component_spec_digest
from majorana_vqe.standard_catalog import (
    CATALOG_SCHEMA_VERSION,
    STANDARD_COMPONENTS,
    STANDARD_WORKFLOWS,
    check_workflow_compatibility,
)
from .repos import artifacts as artifacts_repo
from .repos import vqe as vqe_repo


class StandardCatalogDriftError(RuntimeError):
    """Persisted immutable content does not match the authored seed."""


@dataclass(frozen=True)
class StandardCatalogMaterializationReport:
    component_created: int
    component_reused: int
    workflow_created: int
    workflow_reused: int
    catalog_digest_sha256: str


def _json_value(value: Any) -> Any:
    if dataclasses.is_dataclass(value):
        return {
            field.name: _json_value(getattr(value, field.name))
            for field in dataclasses.fields(value)
        }
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, tuple):
        return [_json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    return value


def _canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )
        + "\n"
    ).encode()


def _slug(kind: str, semantic_key: str) -> str:
    suffix = hashlib.sha256(semantic_key.encode()).hexdigest()[:24]
    return f"vqe-standard-{kind}-{suffix}"


async def _persist_spec(
    scope: Scope,
    session: Any,
    *,
    kind: str,
    title: str,
    component_type: ComponentType,
    semantic_key: str,
    payload: dict[str, Any],
) -> tuple[Any, bool]:
    code_bytes = _canonical_bytes(payload)
    fingerprint = hashlib.sha256(code_bytes).hexdigest()
    expected_spec_digest = normalized_component_spec_digest(
        component_type=component_type,
        spec_json=payload,
    )
    artifact = await artifacts_repo.get_artifact_by_slug(
        scope,
        session,
        _slug(kind, semantic_key),
    )
    if artifact is not None:
        if artifact.current_version_id is None:
            raise StandardCatalogDriftError(
                f"{semantic_key}: existing artifact has no current version"
            )
        version = await artifacts_repo.get_version(
            scope,
            session,
            artifact.current_version_id,
        )
        spec = await vqe_repo.get_component_spec(scope, session, version.id)
        if (
            version.fingerprint != fingerprint
            or spec.semantic_key != semantic_key
            or spec.component_type != component_type.value
            or spec.normalized_spec_sha256 != expected_spec_digest
        ):
            raise StandardCatalogDriftError(
                f"{semantic_key}: immutable Registry seed differs from authored content"
            )
        return spec, False

    artifact = await artifacts_repo.create_artifact(
        scope,
        session,
        slug=_slug(kind, semantic_key),
        title=title,
        family=Algorithm.VQE,
        # Artifact.framework is a legacy required storage field. Scientific
        # framework identity lives in the component/workflow payload.
        framework=ContractFramework.QISKIT,
    )
    version = await artifacts_repo.create_version(
        scope,
        session,
        artifact.id,
        qasm_version=None,
        qasm=None,
        metadata={
            "source": "atlas_standard_vqe_seed",
            "catalog_schema_version": CATALOG_SCHEMA_VERSION,
            "semantic_key": semantic_key,
            "semantic_framework": "neutral",
            "legacy_framework_field": "qiskit_non_semantic",
            "publication": "blocked",
            "scientific_release": "blocked",
        },
        code=code_bytes.decode(),
        code_lang="json",
        fingerprint=fingerprint,
        export_status=ExportStatus.UNSUPPORTED,
        export_reason="structured VQE component is not a circuit export",
        limitations=(
            "Private standard seed candidate; no human review, publication, "
            "or runtime qualification is implied."
        ),
    )
    spec = await vqe_repo.create_component_spec(
        scope,
        session,
        artifact_version_id=version.id,
        schema_version=CATALOG_SCHEMA_VERSION,
        component_type=component_type,
        semantic_key=semantic_key,
        spec_json=payload,
    )
    return spec, True


async def materialize_standard_vqe_catalog(
    scope: Scope,
    session: Any,
) -> StandardCatalogMaterializationReport:
    """Persist standard definitions and templates idempotently as private seeds."""

    component_versions: dict[str, Any] = {}
    component_created = 0
    for definition in STANDARD_COMPONENTS:
        payload = _json_value(definition)
        spec, created = await _persist_spec(
            scope,
            session,
            kind="component",
            title=f"Standard VQE seed: {definition.display_name}",
            component_type=definition.component_type,
            semantic_key=definition.semantic_key,
            payload=payload,
        )
        component_versions[definition.semantic_key] = spec.artifact_version_id
        component_created += int(created)

    workflow_created = 0
    for workflow in STANDARD_WORKFLOWS:
        payload = {
            **_json_value(workflow),
            "compatibility": _json_value(check_workflow_compatibility(workflow)),
        }
        spec, created = await _persist_spec(
            scope,
            session,
            kind="workflow",
            title=f"Standard VQE workflow seed: {workflow.display_name}",
            component_type=ComponentType.WORKFLOW,
            semantic_key=workflow.workflow_key,
            payload=payload,
        )
        if created:
            for ordinal, selection in enumerate(workflow.selections):
                if selection.component_semantic_key is None:
                    continue
                await vqe_repo.create_workflow_component(
                    scope,
                    session,
                    workflow_artifact_version_id=spec.artifact_version_id,
                    component_role=selection.role.value,
                    component_artifact_version_id=component_versions[
                        selection.component_semantic_key
                    ],
                    ordinal=ordinal,
                    binding_metadata={
                        "source": "atlas_standard_vqe_seed",
                        "applicability": selection.applicability.value,
                        "configuration": _json_value(selection.configuration),
                        "bound_contracts": _json_value(selection.bound_contracts),
                    },
                )
        else:
            expected = {
                selection.role.value: component_versions[
                    selection.component_semantic_key
                ]
                for selection in workflow.selections
                if selection.component_semantic_key is not None
            }
            actual_links = await vqe_repo.list_workflow_components(
                scope,
                session,
                spec.artifact_version_id,
            )
            actual = {
                link.component_role: link.component_artifact_version_id
                for link in actual_links
            }
            if actual != expected:
                raise StandardCatalogDriftError(
                    f"{workflow.workflow_key}: persisted Workflow composition drift"
                )
        workflow_created += int(created)

    digest_payload = {
        "schema_version": CATALOG_SCHEMA_VERSION,
        "components": [
            {
                "semantic_key": definition.semantic_key,
                "normalized_spec_sha256": normalized_component_spec_digest(
                    component_type=definition.component_type,
                    spec_json=_json_value(definition),
                ),
            }
            for definition in STANDARD_COMPONENTS
        ],
        "workflows": [
            {
                "semantic_key": workflow.workflow_key,
                "normalized_spec_sha256": normalized_component_spec_digest(
                    component_type=ComponentType.WORKFLOW,
                    spec_json={
                        **_json_value(workflow),
                        "compatibility": _json_value(
                            check_workflow_compatibility(workflow)
                        ),
                    },
                ),
            }
            for workflow in STANDARD_WORKFLOWS
        ],
    }
    return StandardCatalogMaterializationReport(
        component_created=component_created,
        component_reused=len(STANDARD_COMPONENTS) - component_created,
        workflow_created=workflow_created,
        workflow_reused=len(STANDARD_WORKFLOWS) - workflow_created,
        catalog_digest_sha256=hashlib.sha256(
            _canonical_bytes(digest_payload)
        ).hexdigest(),
    )
