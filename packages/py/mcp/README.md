# leona-mcp

An MCP server that lets an AI assistant look things up in the
[Quantum Atlas](https://leonaqt.com/repository), Leona Quantum's public catalog of
quantum algorithms, gates, states and benchmark circuits.

It is read-only: it reads one public API endpoint, the same anonymous catalog listing
the website uses, and nothing else. You need no account or key. It does not run code
or submit jobs, and it cannot spend money. It runs on your machine and talks to your
MCP client over stdio.

## Tools

| Tool | What it does |
|---|---|
| `search_methods` | Filters the Atlas by free text, problem area, a qubit limit, a depth limit, and NISQ or fault-tolerant, using the same rules as the site's method finder. Results are unranked candidates, sorted by slug. |
| `get_method` | One record in full: description, explanation, the cost it states, its speedup class and whether that was checked against the primary paper, its verification tier, the literature it cites, and the OpenQASM 3 of its circuit when it has one. |
| `list_problem_areas` | The problem areas the Atlas uses, with a definition and a record count for each. |

Everything comes from the published record, with a link back to its page on
leonaqt.com. When a record does not carry a field, the answer says "not stated in the
record" instead of guessing. A record is a claim from the sources it cites, not a
result this server checked.

## Install

You need [uv](https://docs.astral.sh/uv/). There is nothing to install ahead of time:
`uvx` fetches the server from this repository the first time a client starts it.

```bash
uvx --from "git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/mcp" leona-mcp --version
```

To pin a version, add a commit or tag after the repository URL, for example
`git+https://github.com/Leona-Quantum/leona@<commit>#subdirectory=packages/py/mcp`.

## Connect a client

The examples name the server `leona-atlas`. Any name works.

### Claude Code

```bash
claude mcp add --transport stdio leona-atlas -- \
  uvx --from "git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/mcp" leona-mcp
```

Options go before the name and everything after `--` is the command. Add
`--scope user` to make it available in every project, or `--scope project` to write it
to the project's `.mcp.json` for everyone who clones it. The default scope is `local`.

### Cursor

Add this to `~/.cursor/mcp.json`, or to `.cursor/mcp.json` in a project:

```json
{
  "mcpServers": {
    "leona-atlas": {
      "type": "stdio",
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/mcp",
        "leona-mcp"
      ]
    }
  }
}
```

### Claude Desktop

Open the config file (on macOS
`~/Library/Application Support/Claude/claude_desktop_config.json`, on Windows
`%APPDATA%\Claude\claude_desktop_config.json`), add the server, and restart the app:

```json
{
  "mcpServers": {
    "leona-atlas": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/mcp",
        "leona-mcp"
      ]
    }
  }
}
```

Desktop apps often start without your shell's `PATH`. If the server does not start,
replace `"uvx"` with the full path that `which uvx` prints (for example
`/Users/you/.local/bin/uvx`).

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `LEONA_API_URL` | `https://majorana-api-nikekeixtq-uw.a.run.app` | The Leona API to read. Point it at `http://localhost:8000` to read a local API. |

In Claude Code, pass it with `--env LEONA_API_URL=...` before the server name. In the
JSON configs, add `"env": {"LEONA_API_URL": "..."}` beside `args`.

The server reads the whole Atlas once (a few megabytes, in pages of 100) and reuses it
for ten minutes. HTTP calls time out after 30 seconds. If the listing it gets back is
incomplete or changes while it is being read, the tool call fails with a message
saying so, rather than answering from part of the Atlas.

## Develop

From the repository root:

```bash
uv sync --all-packages
uv run pytest packages/py/mcp -q
uv run leona-mcp            # speaks MCP on stdin and stdout; Ctrl-C to stop
```

The filtering rules are copies of TypeScript in `apps/web/lib/repository/`, which is
the source of truth. `tests/test_leona_mcp_mirrors.py` fails when a copied vocabulary
stops matching it. See `AGENTS.md` in this directory before changing a rule.
