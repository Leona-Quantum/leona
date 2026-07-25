#!/usr/bin/env python3
"""Provision the frozen unreviewed H2 candidate into a local developer workspace.

The command is intentionally unavailable outside a local development process.
It is idempotent and fails closed if an existing semantic key has different
content.  It never publishes, accepts, or human-reviews an Artifact.
"""

from __future__ import annotations

import json
from pathlib import Path

from majorana_contracts import Scope
from majorana_contracts.enums import Algorithm, ExportStatus, Role
from majorana_contracts.enums import Framework as ContractFramework
from majorana_vqe.models import (
    ComponentType,
    MachineValidationState,
    ReviewState,
)
from majorana_vqe.portable import normalized_component_spec_digest

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import artifacts, system, vqe
from majorana_api.settings import Settings

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / ("registry_manifest_v0.2.json")


async def _component(
    scope: Scope,
    session,
    entry: dict,
):
    semantic_key = entry["semantic_key"]
    existing_artifact = await artifacts.get_artifact_by_slug(scope, session, semantic_key)
    if existing_artifact is not None:
        if existing_artifact.current_version_id is None:
            raise RuntimeError(f"{semantic_key} exists without a current version")
        existing = await vqe.get_component_spec(
            scope,
            session,
            existing_artifact.current_version_id,
        )
        if (
            existing.semantic_key != semantic_key
            or existing.normalized_spec_sha256 != entry["normalized_spec_sha256"]
            or existing.review_state != ReviewState.UNREVIEWED.value
        ):
            raise RuntimeError(f"{semantic_key} exists with conflicting scientific content")
        return existing.artifact_version_id

    artifact = await artifacts.create_artifact(
        scope,
        session,
        slug=semantic_key,
        title=semantic_key,
        family=Algorithm.VQE,
        framework=ContractFramework.QISKIT,
    )
    code = json.dumps(entry["spec_json"], sort_keys=True, indent=2)
    version = await artifacts.create_version(
        scope,
        session,
        artifact.id,
        qasm_version=None,
        qasm=None,
        metadata={
            "source": "frozen_h2_phase5_candidate",
            "human_review_state": "unreviewed",
            "publication": "blocked",
            "scientific_release": "blocked",
        },
        code=code,
        code_lang="json",
        fingerprint=entry["normalized_spec_sha256"],
        export_status=ExportStatus.UNSUPPORTED,
        export_reason="scientific registry metadata is not an executable circuit export",
    )
    spec = await vqe.create_component_spec(
        scope,
        session,
        artifact_version_id=version.id,
        schema_version="0.2.0",
        component_type=ComponentType(entry["component_type"]),
        semantic_key=semantic_key,
        spec_json=entry["spec_json"],
        normalized_spec_sha256=entry["normalized_spec_sha256"],
        machine_validation_state=MachineValidationState.MACHINE_VALIDATED,
        review_state=ReviewState.UNREVIEWED,
    )
    return spec.artifact_version_id


async def provision() -> str:
    settings = Settings.from_env()
    if not (
        settings.environment == "development"
        and settings.local_dev_auth
        and settings.vqe_candidate_execution
    ):
        raise RuntimeError(
            "H2 candidate provisioning requires local development auth and "
            "MAJORANA_VQE_CANDIDATE_EXECUTION=true"
        )
    manifest = json.loads(MANIFEST_PATH.read_text())
    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        async with factory() as session:
            user, workspace = await system.get_or_provision_user(
                session,
                workos_user_id=settings.local_dev_user_id,
                email=settings.local_dev_email,
            )
            scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)
            component_ids = {}
            for entry in manifest["components"]:
                component_ids[entry["role"]] = await _component(scope, session, entry)

            workflow_entry = {
                "component_type": ComponentType.WORKFLOW.value,
                "semantic_key": manifest["workflow"]["semantic_key"],
                "normalized_spec_sha256": normalized_component_spec_digest(
                    component_type=ComponentType.WORKFLOW,
                    spec_json={
                        "schema_version": "0.2.0",
                        "kind": "portable_vqe_workflow",
                        "semantic_digest": manifest["workflow"]["semantic_digest"],
                        "required_roles": manifest["workflow"]["required_roles"],
                    },
                ),
                "spec_json": {
                    "schema_version": "0.2.0",
                    "kind": "portable_vqe_workflow",
                    "semantic_digest": manifest["workflow"]["semantic_digest"],
                    "required_roles": manifest["workflow"]["required_roles"],
                },
            }
            workflow_id = await _component(scope, session, workflow_entry)
            existing_links = await vqe.list_workflow_components(
                scope,
                session,
                workflow_id,
            )
            if existing_links:
                actual = {
                    (link.component_role, link.component_artifact_version_id)
                    for link in existing_links
                }
                expected = {(role, component_id) for role, component_id in component_ids.items()}
                if actual != expected:
                    raise RuntimeError("existing H2 workflow links conflict with the manifest")
            else:
                for role, component_id in component_ids.items():
                    await vqe.create_workflow_component(
                        scope,
                        session,
                        workflow_artifact_version_id=workflow_id,
                        component_role=role,
                        component_artifact_version_id=component_id,
                        ordinal=0,
                    )
            await session.commit()
            return str(workflow_id)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    import asyncio

    print(asyncio.run(provision()))
