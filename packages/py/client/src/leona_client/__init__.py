"""The one Python HTTP client for Leona Quantum's control plane and Atlas.

Proposal 7 Phase D (ai-ops 349, ai-ops 362). Before this package, two independent
HTTP-calling modules existed — `leona_mcp.client.CatalogClient` (the Atlas, read-only,
credential-free) and `leona_notebooks.jupyter.Client` (the control plane, bearer-token
authenticated) — and Phase C's acting tools would have been a third. This package holds
both, plus the run/estimate calls Phase C needs, so `%nala`, the `leona-notebooks` CLI
and `leona-mcp`'s acting tools all speak the API the same way.

    from leona_client import Client
    client = Client.from_env()               # LEONA_API_URL / LEONA_API_TOKEN
    areas = client.list_problem_areas()
    run = client.start_run("Build a 3-qubit GHZ state and verify it")
    run = client.wait_for_run(run.id)
    print(run.verifier_decision, run.verification_summary)

`atlas.py` and `catalog.py` are the read-only Atlas half (moved here from `leona_mcp`
unchanged, still mirror-tested against `apps/web/lib/repository/*.ts`); `client.py` is
the authenticated control-plane half (generalised from `leona_notebooks.jupyter`, with
`run`/`estimate` methods new in this phase). Everything cross-boundary a response is
validated into comes from `majorana_contracts`, which carries no server, worker or
database code and is itself installable standalone — see that package's `pyproject.toml`.
"""

from __future__ import annotations

#: Read by `catalog.py` (`from . import __version__`, kept from before this move) for
#: its `User-Agent` string — set before any sibling import below, or that import
#: sees a partially initialized package and raises `ImportError`.
__version__ = "0.1.0"

from .catalog import CatalogClient, CatalogUnavailable
from .client import (
    Client,
    DEFAULT_API_URL,
    LeonaClientError,
    Transport,
)

__all__ = [
    "CatalogClient",
    "CatalogUnavailable",
    "Client",
    "DEFAULT_API_URL",
    "LeonaClientError",
    "Transport",
]
