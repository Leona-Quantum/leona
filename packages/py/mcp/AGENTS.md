# AGENTS.md — leona-mcp

A stdio MCP server over the public Quantum Atlas (Phase A, ai-ops 349) and, with a
personal access token, verified runs and estimates (Phase C, ai-ops 349/362).
Distribution `leona-mcp`, module `leona_mcp`, console script `leona-mcp`.

| Module | Holds |
|---|---|
| `server.py` | The seven tools, the server instructions, and `main()`. |

The Atlas rules (`atlas.py`) and the HTTP client (`catalog.py`/the control-plane
`Client`) moved to `packages/py/client` (`leona_client`) in Phase D, so `leona-mcp`
and a plain `leona_client.Client` answer identically and there is one HTTP-calling
implementation, not one per package. Read `packages/py/client/AGENTS.md` before
changing anything about how a record is matched, formatted, or fetched.

Rules that are load-bearing:

- **The token comes ONLY from `LEONA_API_TOKEN`.** Never a tool argument — an MCP
  tool argument is something the calling model chooses and can echo back into its
  own transcript, so a token-shaped argument would be one prompt injection away from
  leaving the machine. `_token_client()` reads it once per call via
  `leona_client.Client.from_env()` and raises a plain, token-free message when it is
  absent; nothing here logs the token or puts it in an exception. Without one, the
  three Atlas tools are unaffected.
- **No hardware tool, and none is possible.** `leona_client.Client` has no method
  that could reach `POST /qpu/submissions`; `token_access.py` has no allowlist entry
  for it and `TokenScope` has no `hardware` member. "Hardware jobs come later under
  their own permission" (ai-ops 362) is therefore not a policy this server chooses
  to respect — there is nothing here that could violate it even if it tried to.
- **`run_verified` never claims a result is verified because it finished.** A run's
  `status` can be `succeeded` while `verifier_decision` is not `pass`. Every run
  tool's response carries an explicit `verified` boolean (`_run_result`), computed
  from `verifier_decision == "pass"` and nothing else.
- **Acting calls run off the event loop.** `leona_client.Client` is synchronous
  (shared with `%nala`); `_in_thread` wraps each call in
  `anyio.to_thread.run_sync` so a `run_verified` poll (up to `MAX_WAIT_S` seconds)
  does not block the stdio transport from answering anything else meanwhile.
- **Never rank, never fill in**, for the Atlas tools. How the finder should rank is
  an open owner question (ai-ops 358), so results are sorted by slug. A field a
  record does not carry is `NOT_STATED`; a limit a record does not state never
  excludes it.
- **Self-contained, via `leona_client`, not by having zero workspace dependencies.**
  Before Phase D this package deliberately depended on nothing in the workspace; now
  it depends on `leona_client`, which is ALSO installable standalone (its own
  `AGENTS.md` explains the `uvx --from git+...#subdirectory=` mechanics) — so
  `uvx --from git+...#subdirectory=packages/py/mcp` still works with no other
  workspace member on disk. Do not add a *direct* dependency on `majorana_api`,
  `majorana_worker`, `majorana_agent`, `sqlalchemy` or `psycopg`; the root
  `pyproject.toml`'s import-linter contract enforces it.
- **Stdout is the protocol.** Log to stderr only.

Commands: `uv run pytest packages/py/mcp -q` · `uv run leona-mcp --version`.
