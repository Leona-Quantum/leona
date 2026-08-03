"""Deterministic, I/O-free GitHub request plan for Phase 10 selected files.

The plan is compiled from a validated acquisition authorization.  Callers
cannot provide a URL, header, method, query, API version, response limit, or
redirect policy.  This module does not open a socket and is not a live
connector.  A future dedicated transport must additionally pin the validated
peer, retain the fixed TLS identity, inject any workload credential internally,
enforce one-time job state, and reject every redirect.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
from typing import Any
from urllib.parse import quote

from majorana_api.github_coordinates import GITHUB_API_VERSION
from majorana_api.phase10_acquisition_contract import (
    Phase10AcquisitionAuthorization,
)
from majorana_api.phase10_retrieval_manifest import MAX_SELECTED_FILE_BYTES

GITHUB_REQUEST_PLAN_SCHEMA_VERSION = 1
GITHUB_CONTENT_ACCEPT = "application/vnd.github.object+json"
GITHUB_CONTENT_OPERATION = "get_repository_file_object_at_commit"
GITHUB_REQUEST_PLAN_VERSION = "phase10-s2-github-content-plan/1"
GITHUB_USER_AGENT = "majorana-atlas-vqe-acquisition/phase10-preflight"
MAX_GITHUB_CONTENT_RESPONSE_BYTES = 512 * 1024


class Phase10GitHubRequestPlanError(ValueError):
    """A compiled request plan is noncanonical or has been altered."""

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code
        self.retryable = False


@dataclasses.dataclass(frozen=True)
class Phase10GitHubContentOperation:
    """One fixed GitHub Contents API GET operation, represented as data."""

    selected_path: str
    method: str
    request_path: str
    query: tuple[tuple[str, str], ...]
    headers: tuple[tuple[str, str], ...]
    follow_redirects: bool
    max_response_bytes: int

    def descriptor(self) -> dict[str, Any]:
        return {
            "operation": GITHUB_CONTENT_OPERATION,
            "selected_path": self.selected_path,
            "method": self.method,
            "request_path": self.request_path,
            "query": [list(item) for item in self.query],
            "headers": [list(item) for item in self.headers],
            "follow_redirects": self.follow_redirects,
            "max_response_bytes": self.max_response_bytes,
        }


@dataclasses.dataclass(frozen=True)
class Phase10GitHubRequestPlan:
    """Digest-bound sequence of fixed operations for one authorization."""

    authorization: Phase10AcquisitionAuthorization
    operations: tuple[Phase10GitHubContentOperation, ...]
    plan_version: str = GITHUB_REQUEST_PLAN_VERSION

    def __post_init__(self) -> None:
        _validate_plan(self)

    def body(self) -> dict[str, Any]:
        return {
            "plan_schema_version": GITHUB_REQUEST_PLAN_SCHEMA_VERSION,
            "plan_version": self.plan_version,
            "authorization": self.authorization.to_authorization(),
            "operations": [operation.descriptor() for operation in self.operations],
        }

    @property
    def plan_sha256(self) -> str:
        return _canonical_sha256(self.body())

    def to_plan(self) -> dict[str, Any]:
        return {**self.body(), "plan_sha256": self.plan_sha256}

    @classmethod
    def from_plan(cls, payload: dict[str, Any]) -> Phase10GitHubRequestPlan:
        if not isinstance(payload, dict) or set(payload) != {
            "plan_schema_version",
            "plan_version",
            "authorization",
            "operations",
            "plan_sha256",
        }:
            raise Phase10GitHubRequestPlanError("invalid_github_request_plan")
        if payload["plan_schema_version"] != GITHUB_REQUEST_PLAN_SCHEMA_VERSION:
            raise Phase10GitHubRequestPlanError("unsupported_github_request_plan_schema")
        try:
            authorization = Phase10AcquisitionAuthorization.from_authorization(
                payload["authorization"]
            )
        except (TypeError, ValueError) as exc:
            raise Phase10GitHubRequestPlanError("invalid_github_plan_authorization") from exc
        raw_operations = payload["operations"]
        if not isinstance(raw_operations, list):
            raise Phase10GitHubRequestPlanError("invalid_github_request_operations")
        operations = tuple(_operation_from_descriptor(item) for item in raw_operations)
        plan = cls(
            authorization=authorization,
            operations=operations,
            plan_version=payload["plan_version"],
        )
        claimed_digest = payload["plan_sha256"]
        if not _is_sha256(claimed_digest):
            raise Phase10GitHubRequestPlanError("invalid_github_request_plan_digest")
        if claimed_digest != plan.plan_sha256:
            raise Phase10GitHubRequestPlanError("github_request_plan_digest_mismatch")
        return plan


def build_phase10_github_request_plan(
    authorization: Phase10AcquisitionAuthorization,
) -> Phase10GitHubRequestPlan:
    """Compile fixed GitHub operations without accepting transport options."""

    if not isinstance(authorization, Phase10AcquisitionAuthorization):
        raise Phase10GitHubRequestPlanError("invalid_github_plan_authorization")
    return Phase10GitHubRequestPlan(
        authorization=authorization,
        operations=_expected_operations(authorization),
    )


def _expected_operations(
    authorization: Phase10AcquisitionAuthorization,
) -> tuple[Phase10GitHubContentOperation, ...]:
    owner, repository = authorization.request.full_name.split("/", 1)
    base_path = f"/repos/{quote(owner, safe='')}/{quote(repository, safe='')}/contents"
    query = (("ref", authorization.request.immutable_ref),)
    headers = tuple(
        sorted(
            {
                "Accept": GITHUB_CONTENT_ACCEPT,
                "Accept-Encoding": "identity",
                "User-Agent": GITHUB_USER_AGENT,
                "X-GitHub-Api-Version": GITHUB_API_VERSION,
            }.items()
        )
    )
    return tuple(
        Phase10GitHubContentOperation(
            selected_path=selected_path,
            method="GET",
            request_path=f"{base_path}/{_quote_selected_path(selected_path)}",
            query=query,
            headers=headers,
            follow_redirects=False,
            max_response_bytes=MAX_GITHUB_CONTENT_RESPONSE_BYTES,
        )
        for selected_path in authorization.request.selected_paths
    )


def _validate_plan(plan: Phase10GitHubRequestPlan) -> None:
    if not isinstance(plan.authorization, Phase10AcquisitionAuthorization):
        raise Phase10GitHubRequestPlanError("invalid_github_plan_authorization")
    if plan.plan_version != GITHUB_REQUEST_PLAN_VERSION:
        raise Phase10GitHubRequestPlanError("unsupported_github_request_plan_version")
    if not isinstance(plan.operations, tuple):
        raise Phase10GitHubRequestPlanError("invalid_github_request_operations")
    if plan.operations != _expected_operations(plan.authorization):
        raise Phase10GitHubRequestPlanError("noncanonical_github_request_operations")


def _operation_from_descriptor(value: Any) -> Phase10GitHubContentOperation:
    if not isinstance(value, dict) or set(value) != {
        "operation",
        "selected_path",
        "method",
        "request_path",
        "query",
        "headers",
        "follow_redirects",
        "max_response_bytes",
    }:
        raise Phase10GitHubRequestPlanError("invalid_github_request_operation")
    if value["operation"] != GITHUB_CONTENT_OPERATION:
        raise Phase10GitHubRequestPlanError("github_operation_not_allowed")
    query = _pairs(value["query"], "invalid_github_request_query")
    headers = _pairs(value["headers"], "invalid_github_request_headers")
    return Phase10GitHubContentOperation(
        selected_path=value["selected_path"],
        method=value["method"],
        request_path=value["request_path"],
        query=query,
        headers=headers,
        follow_redirects=value["follow_redirects"],
        max_response_bytes=value["max_response_bytes"],
    )


def _pairs(value: Any, failure_code: str) -> tuple[tuple[str, str], ...]:
    if not isinstance(value, list):
        raise Phase10GitHubRequestPlanError(failure_code)
    pairs: list[tuple[str, str]] = []
    for item in value:
        if (
            not isinstance(item, list)
            or len(item) != 2
            or not all(isinstance(part, str) for part in item)
        ):
            raise Phase10GitHubRequestPlanError(failure_code)
        pairs.append((item[0], item[1]))
    return tuple(pairs)


def _quote_selected_path(selected_path: str) -> str:
    return "/".join(quote(segment, safe="-._~") for segment in selected_path.split("/"))


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _is_sha256(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


assert MAX_GITHUB_CONTENT_RESPONSE_BYTES > MAX_SELECTED_FILE_BYTES
