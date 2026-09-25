# AGENTS.md — leona-client

The one Python HTTP client for Leona Quantum. Distribution `leona-client`, module
`leona_client`. Consumed by `leona-mcp` (proposal 7 Phase C's acting tools, and its
Atlas tools since this move) and `leona-notebooks` (`%nala`, the CLI).

| Module | Holds |
|---|---|
| `atlas.py` | Pure rules: limit verdicts, stated cost and regime, verification tier, literature, OpenQASM. No network. Moved from `leona_mcp.atlas`, unchanged. |
| `catalog.py` | The one HTTP read of the Atlas: `GET /v1/catalog/entries` (full view, pages of 100), with a 10-minute cache. Moved from `leona_mcp.client`, unchanged. |
| `client.py` | `Client`: the bearer-token control-plane calls (notebooks, runs, estimates, Qapps, and `check_circuit` → `POST /v1/checks/circuit`, returning a `CheckVerdict`) generalised from `leona_notebooks.jupyter.Client`, plus the Atlas convenience methods that wrap `atlas.py`/`catalog.py`. |

Rules that are load-bearing:

- **This package, and `majorana-contracts`, are both installable standalone.**
  `uv pip install "leona-client @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/client"`
  works from a bare checkout with no other workspace member on disk — verified by
  installing it into a throwaway venv from a `git+file://` URL and confirming `uv`
  resolves `majorana-contracts` via `[tool.uv.sources]`'s workspace-auto-discovery
  even outside `uv sync`. Do not add a dependency on `leona_notebooks`,
  `majorana_api`, `majorana_worker`, `majorana_agent`, `sqlalchemy` or `psycopg` —
  any of those breaks that promise, and the root `pyproject.toml`'s import-linter
  contract for `leona_client` enforces it.
- **`client.py` stays on stdlib `urllib` for its own transport**, not `httpx`, even
  though `catalog.py` (moved in alongside it) already depends on `httpx` for the
  Atlas's async paging. This was `leona_notebooks.jupyter.Client`'s existing,
  tested contract with two call sites (`%nala`, the `leona-notebooks` CLI) whose
  tests inject a plain `(method, url, headers, body) -> (status, bytes)` callable;
  changing the transport shape would have broken both for no behavioural gain.
- **The token is never a constructor-required value, an argument to an acting
  call, a log line, or part of an exception message.** `Client.from_env()` reads
  `LEONA_API_TOKEN`; `_authenticated_call` raises a plain `LeonaClientError` when it
  is unset, before ever building a request. `tests/test_client_runs.py`'s
  `test_the_token_never_appears_in_any_output_or_log` is the control for this.
- **Atlas methods on `Client` share `catalog.py`/`atlas.py` with `leona-mcp`'s
  tools rather than re-implementing them.** `Client.search_methods` runs the async
  `CatalogClient.rows()` via `asyncio.run` — safe here because `Client`'s methods
  are only ever called from ordinary synchronous code (a script, `%nala`), never
  from inside a running event loop.
- **Run methods return `majorana_contracts.Run`.** `verifier_decision` and
  `verification_summary` are real fields on it — read them, not just `status`,
  before calling a run's result verified (`status="succeeded"` and
  `verifier_decision != "pass"` both happen).
- **`atlas.py`/`catalog.py`'s tests (`test_atlas.py`, `test_catalog.py`,
  `test_mirrors.py`) are unchanged from `packages/py/mcp` apart from their import
  paths.** `test_mirrors.py` reads `apps/web/lib/repository/*.ts` as text and skips
  when `apps/web` is not in the checkout (the standalone install ships no tests).

Commands: `uv run pytest packages/py/client -q`.
