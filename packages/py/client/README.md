# leona-client

The one Python HTTP client for [Leona Quantum](https://leonaqt.com): the Quantum
Atlas, verified runs, and resource estimates. Used by the `leona-mcp` MCP server, the
`%nala` Jupyter magic and the `leona-notebooks` CLI, so there is one place that knows
how to talk to the API instead of three.

## Quickstart

```bash
pip install "leona-client @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/client"
export LEONA_API_TOKEN=lq_pat_...   # Account → Access tokens on leonaqt.com; omit for Atlas-only use
```

```python
from leona_client import Client

client = Client.from_env()  # reads LEONA_API_URL / LEONA_API_TOKEN

# The Atlas needs no token.
areas = client.list_problem_areas()
hits = client.search_methods("phase estimation", max_qubits=8)
record = client.get_method(hits["results"][0]["slug"])

# Runs and estimates need a token with the `run` scope (ai-ops 362 option 1: tokens
# may read and start verified runs; hardware jobs come later, under their own scope).
run = client.start_run("Build a 3-qubit GHZ state and verify it")
run = client.wait_for_run(run.id, wait_s=300)
print(run.status, run.verifier_decision, run.verification_summary)
```

## What it is

- `Client` (`client.py`) — bearer-token control-plane calls: notebooks (`create`,
  `push`, `pull`, `versions`, `ask`, ...), runs (`start_run`, `get_run`, `list_runs`,
  `cancel_run`, `wait_for_run`) and estimates (`estimate_resources`), plus the Atlas
  convenience methods below. The token comes from `LEONA_API_TOKEN` — set it in your
  shell, never pass it as an argument or put it in a notebook cell — and every method
  that needs one raises a plain `LeonaClientError` (never an HTTP exception, never
  the token itself) when it is absent.
- `catalog.py` (`CatalogClient`) and `atlas.py` — the read-only Atlas: fetching the
  full public catalog (paged, cached, and refusing to answer from a partial read),
  and the site's own finder/search/verification/OpenQASM-export rules, copied from
  `apps/web/lib/repository/*.ts` and mirror-tested against them
  (`tests/test_mirrors.py`). No token, no write, nothing that runs or costs money.
  `Client.search_methods`/`get_method`/`list_problem_areas` and `leona-mcp`'s three
  read-only tools both call into this — one fetch implementation, one set of rules.

## Typed responses

Run methods return `majorana_contracts.Run` (the same type the API's own
`GET /v1/runs/{id}` response validates against) — `majorana_contracts` is pure
pydantic with no server, worker or database code, and is itself installable
standalone the same way this package is. Estimates return the raw JSON: the
estimator's response shape is route-local, not a `majorana_contracts` type, because
nothing outside the web app's own planner reads it.

## Never claim a run is verified unless the record says so

`run.verifier_decision` is one of `pass`/`fail`/`inconclusive`; `run.status` can be
`succeeded` while `verifier_decision` is not `pass` — a run can finish without its
generated code being verified correct. Read `verifier_decision` and
`verification_summary`, not just `status`, before telling anyone a result is
verified.

## Install without `uv`

`majorana-contracts` is not published to PyPI (nothing in this repository is —
`AGENTS.md`'s rename rules only cover names, not distribution). `[tool.uv.sources]`
in this package's `pyproject.toml` resolves it from the workspace automatically for
any `uv`/`uvx` install from this repository's git history, subdirectory and all —
which is what the quickstart above uses. A tool that ignores `[tool.uv.sources]`
(plain `pip`, for instance) needs `majorana-contracts` installed from its own git
subdirectory URL first:

```bash
pip install "majorana-contracts @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/contracts"
pip install "leona-client @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/client"
```

## Commands

`uv run pytest packages/py/client -q`
