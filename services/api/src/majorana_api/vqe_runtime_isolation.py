"""Server-owned VQE runtime launch constraints for Phase 5A.

This module defines the only environment and container-policy shape the
future durable worker may consume.  It intentionally has no function that
merges a client or parent-process environment: secrets and Neon URLs are
omitted by construction.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal, Mapping

from majorana_vqe.models import ExecutionBinding


@dataclass(frozen=True)
class RuntimeLaunchConstraints:
    network_mode: Literal["none"] = "none"
    read_only_root_filesystem: Literal[True] = True
    run_as_non_root: Literal[True] = True
    drop_all_linux_capabilities: Literal[True] = True
    no_new_privileges: Literal[True] = True
    credential_mounts: tuple[()] = ()
    inherited_environment: tuple[()] = ()
    dynamic_package_installation: Literal[False] = False


PHASE5A_RUNTIME_CONSTRAINTS = RuntimeLaunchConstraints()

# This is constructed from constants, not os.environ.  In particular there is
# no DATABASE_URL, Neon URL, cloud token, package-index credential, or proxy.
_FIXED_RUNTIME_ENVIRONMENT = MappingProxyType(
    {
        "PYTHONHASHSEED": "0",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PIP_NO_INDEX": "1",
        "PIP_DISABLE_PIP_VERSION_CHECK": "1",
        "UV_OFFLINE": "1",
    }
)


def runtime_environment(binding: ExecutionBinding) -> Mapping[str, str]:
    """Return the complete runtime environment; never merge caller/host env."""
    if binding.production_runtime_status not in {"unqualified", "qualified"}:
        raise ValueError("unknown VQE runtime qualification state")
    if binding.isolation_policy.network_policy != "deny_all":
        raise ValueError("VQE runtime binding must deny all network egress")
    if binding.isolation_policy.credential_policy != "none":
        raise ValueError("VQE runtime binding cannot receive credentials")
    if binding.isolation_policy.database_url_policy != "omit":
        raise ValueError("VQE runtime binding cannot receive a database URL")
    if binding.isolation_policy.dynamic_package_installation != "forbidden":
        raise ValueError("VQE runtime cannot install packages dynamically")
    return _FIXED_RUNTIME_ENVIRONMENT
