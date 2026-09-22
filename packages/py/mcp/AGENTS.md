# AGENTS.md — leona-mcp

A stdio MCP server over the public Quantum Atlas (proposal 7, Phase A, ai-ops 349).
Distribution `leona-mcp`, module `leona_mcp`, console script `leona-mcp`.

| Module | Holds |
|---|---|
| `atlas.py` | Pure rules: limit verdicts, stated cost and regime, verification tier, literature, OpenQASM. No network. |
| `client.py` | The one HTTP read: `GET /v1/catalog/entries` (full view, pages of 100), with a 10-minute cache. |
| `server.py` | The three tools, the server instructions, and `main()`. |

Rules that are load-bearing:

- **Read-only and credential-free, and that is the whole scope.** The only network call
  is the anonymous catalog listing. No token, no write, no route on the API, nothing that
  runs or estimates on a user's behalf. Anything that does is §1a of
  `~/Developer/ai-ops/desk/leona/plans/rebuild/05-security.md` (personal access tokens are
  a new credential type) and needs its own design and the owner's rulings. The
  import-linter contract "the MCP server is only an HTTP client of the public API" in the
  root `pyproject.toml` keeps it from importing the API, worker, contracts or a DB driver.
- **The TypeScript is the source of truth.** Every rule in `atlas.py` names the file it
  copies (`finder.ts`, `topics.ts`, `search.ts`, `verification.ts`, `studio-builder.ts`).
  Change the TypeScript first, then the copy. `tests/test_leona_mcp_mirrors.py` reads those
  files and fails on drift.
- **Never rank, never fill in.** How the finder should rank is an open owner question
  (ai-ops 358), so results are sorted by slug. A field a record does not carry is
  `NOT_STATED`; a limit a record does not state never excludes it.
- **Full view, not `?view=list`.** The list projection keeps only the "Qubits" resource
  row, and the finder's rules read five others. A mirror test pins that projection so this
  can be revisited if it widens.
- **Self-contained.** `uvx --from "git+...#subdirectory=packages/py/mcp"` builds this
  directory alone, so it must not depend on any workspace package.
- **Stdout is the protocol.** Log to stderr only.

Commands: `uv run pytest packages/py/mcp -q` · `uv run leona-mcp --version`.
