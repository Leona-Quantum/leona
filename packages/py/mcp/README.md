# leona-mcp

An MCP server that lets an AI assistant look things up in the
[Quantum Atlas](https://leonaqt.com/repository), Leona Quantum's public catalog of
quantum algorithms, gates, states and benchmark circuits — and, with a personal
access token, start a verified run, read its result, plan an algorithm and cost it from
its sources, estimate physical resources, call a published Qapp, and have a circuit
checked, all as the token's own account.

Three tools need nothing at all: they read one public API endpoint, the same
anonymous catalog listing the website uses. You need no account or key, and they
cannot spend money. Seven more need a personal access token (minted on leonaqt.com,
Account → Access tokens) in the `LEONA_API_TOKEN` environment variable — never as a
tool argument, and it is never logged or echoed in an error. Without one, those seven
tools answer with a message telling you to set it; the three read-only tools are
unaffected. The server runs on your machine and talks to your MCP client over stdio.

## Tools

| Tool | Needs a token | What it does |
|---|---|---|
| `search_methods` | No | Filters the Atlas by free text, problem area, a qubit limit, a depth limit, and NISQ or fault-tolerant, using the same rules as the site's method finder. Results are unranked candidates, sorted by slug. |
| `get_method` | No | One record in full: description, explanation, the cost it states, its speedup class and whether that was checked against the primary paper, its verification tier, the literature it cites, and the OpenQASM 3 of its circuit when it has one. |
| `list_problem_areas` | No | The problem areas the Atlas uses, with a definition and a record count for each. |
| `run_verified` | Yes (`run` scope) | Starts a Nala run — the same route the website's Run box calls — as your account, and polls for up to `wait_s` seconds for a verified result. |
| `get_run` | Yes | Reads one of your own runs by id, including its verification record. |
| `list_my_runs` | Yes | Lists your own runs, most recent first. |
| `plan_workflow` | Yes (any scope) | Plans an algorithm the way [leonaqt.com/repository/plan](https://leonaqt.com/repository/plan) does and returns the same numbers: the pipeline of Atlas blocks for a problem (factoring, search, ground-state energy, linear systems, MaxCut, amplitude and phase estimation, Hamiltonian simulation, elliptic-curve keys, differential equations), each stage's alternatives, and the cost lines evaluated from published formulas at your sizes. Every line carries its kind (exact, a bound, leading order, a paper's numerical estimate, a scaling with no constant, ...) and its source, and `summary` quotes each number with both. `estimate_point` is ready to pass to `estimate_resources`. Arithmetic only: nothing is run or stored. |
| `estimate_resources` | Yes | Turns a logical cost you state into physical qubits and runtime under a named assumption set. |
| `run_qapp` | Yes (`run` scope) | Calls a published Qapp with input values, through the same route and the same sandboxed execution as the Qapp's own page, and polls for its result. |
| `check_circuit` | Yes (`run` scope) | Checks a small OpenQASM 3 circuit (the tool description gives the widest per kind, from the contract's own limits) against one property: an output state, a unitary, an ideal measured distribution, or an energy. Returns pass, fail or inconclusive with a diagnosis, a plain `passed` boolean, a one-paragraph `summary`, and its teeth: how many deliberately broken copies of the circuit the check caught. Judged by Leona's own code, one circuit at a time (a busy server answers 503; call again in a few seconds); nothing is stored. |

Everything the first three tools return comes from the published Atlas record, with
a link back to its page on leonaqt.com. When a record does not carry a field, the
answer says "not stated in the record" instead of guessing. A record is a claim from
the sources it cites, not a result this server checked.

**A run's `status` can be `"succeeded"` while its verification did not pass.** Read
`verifier_decision` and `verification_summary` — every run tool's response also
carries a plain `verified` boolean, true only when `verifier_decision` is `"pass"` —
before telling anyone a result is verified.

**A `check_circuit` pass means "checked against" what `checked_against` names, and
nothing more.** Quote it that way, never as "verified": the reference can itself be the
wrong target. Its teeth say whether the check could have failed at all; a check that
caught none of the broken copies could not tell a broken circuit from yours.

## Example: "write a 3-qubit QFT and check it with Leona"

A Claude Code user with the server connected and a `run`-scope token set
(`claude mcp add --transport stdio --env LEONA_API_TOKEN=lq_pat_... leona-atlas -- uvx
--from "git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/mcp"
leona-mcp`) asks their agent to write a 3-qubit QFT and check it with Leona. Bitstrings
and Pauli strings use Qiskit's order, q0 rightmost, and `qft(3)` is Qiskit's QFT
including its final swaps. The requests and answers below come from a real run:
`services/api/tests/test_check_circuit_route.py` produces them through the MCP tool,
`leona_client`, the API route and the check engine, and fails if this README drifts from
what they answer.

<!-- check-circuit-example:start (generated by test_check_circuit_route.py) -->

The agent's first attempt leaves out the final swap. It calls:

```json
{
  "tool": "check_circuit",
  "arguments": {
    "qasm": "OPENQASM 3.0;\ninclude \"stdgates.inc\";\nqubit[3] q;\nh q[2];\ncp(pi/2) q[1], q[2];\ncp(pi/4) q[0], q[2];\nh q[1];\ncp(pi/2) q[0], q[1];\nh q[0];\n",
    "kind": "unitary",
    "reference": "qft(3)"
  }
}
```

Leona answers:

```json
{
  "status": "fail",
  "basis": "circuit",
  "checked_against": "Qiskit's QFT on 3 qubits, exact unitary up to global phase",
  "measure": "largest entry of the difference, after removing global phase, 7.07e-01 (needs ≤ 1.00e-06)",
  "detail": "It matches up to a reversal of the qubit order on one side. A QFT written without its final swaps does exactly this.",
  "qubits": 3,
  "subject_fingerprint": "c5fcd4e70621fe09aca5a0421af4d7be5f9e7f4ef3da09d3ae784bcbc4d66880",
  "subject_qasm": "OPENQASM 3.0;\ninclude \"stdgates.inc\";\nqubit[3] q;\nh q[2];\ncp(pi/2) q[1], q[2];\ncp(pi/4) q[0], q[2];\nh q[1];\ncp(pi/2) q[0], q[1];\nh q[0];\n",
  "teeth": {
    "status": "not_measured",
    "reason": "Broken copies are tried only on a check that passes. This one failed, so there was nothing to test.",
    "mutants": 0,
    "equivalent": 0,
    "caught": 0,
    "survivors": [],
    "could_not_run": 0
  },
  "passed": false,
  "summary": "Checked against Qiskit's QFT on 3 qubits, exact unitary up to global phase: fail (largest entry of the difference, after removing global phase, 7.07e-01 (needs ≤ 1.00e-06)). It matches up to a reversal of the qubit order on one side. A QFT written without its final swaps does exactly this. Whether this check can catch a broken circuit was not measured: Broken copies are tried only on a check that passes. This one failed, so there was nothing to test.",
  "teeth_note": "Whether this check can catch a broken circuit was not measured: Broken copies are tried only on a check that passes. This one failed, so there was nothing to test."
}
```

The agent adds `swap q[0], q[2];` at the end and calls again:

```json
{
  "tool": "check_circuit",
  "arguments": {
    "qasm": "OPENQASM 3.0;\ninclude \"stdgates.inc\";\nqubit[3] q;\nh q[2];\ncp(pi/2) q[1], q[2];\ncp(pi/4) q[0], q[2];\nh q[1];\ncp(pi/2) q[0], q[1];\nh q[0];\nswap q[0], q[2];\n",
    "kind": "unitary",
    "reference": "qft(3)"
  }
}
```

Leona answers:

```json
{
  "status": "pass",
  "basis": "circuit",
  "checked_against": "Qiskit's QFT on 3 qubits, exact unitary up to global phase",
  "measure": "largest entry of the difference, after removing global phase, 1.28e-15 (needs ≤ 1.00e-06)",
  "detail": "",
  "qubits": 3,
  "subject_fingerprint": "077aef414f965daa2894271ba1cdea0a7c6090f70779a8f91a3c94ef0ab53509",
  "subject_qasm": "OPENQASM 3.0;\ninclude \"stdgates.inc\";\nqubit[3] q;\nh q[2];\ncp(pi/2) q[1], q[2];\ncp(pi/4) q[0], q[2];\nh q[1];\ncp(pi/2) q[0], q[1];\nh q[0];\nswap q[0], q[2];\n",
  "teeth": {
    "status": "measured",
    "reason": "",
    "mutants": 11,
    "equivalent": 0,
    "caught": 11,
    "survivors": [],
    "could_not_run": 0
  },
  "passed": true,
  "summary": "Checked against Qiskit's QFT on 3 qubits, exact unitary up to global phase: pass (largest entry of the difference, after removing global phase, 1.28e-15 (needs ≤ 1.00e-06)). Leona also made 11 deliberately broken copies of the circuit that change its output, and the check caught all 11."
}
```

<!-- check-circuit-example:end -->

## Example: "how big a machine does RSA-2048 need, by Leona's sources?"

The same user asks their agent what factoring a 2048-bit RSA modulus costs. Any token
will do here; planning and estimating are arithmetic. The requests and answers below come
from a real run: `services/api/tests/test_plan_route.py` makes both calls through the MCP
tools, `leona_client`, the API routes, the planner port and the estimator, and fails if
this README drifts from what they answer. The planner's numbers are the ones
`/repository/plan` shows for the same input: the port is held equal to the TypeScript
planner on about 900 inputs (`packages/py/planner/tests/test_planner_parity.py`).

<!-- plan-workflow-example:start (generated by test_plan_route.py) -->

The agent calls:

```json
{
  "tool": "plan_workflow",
  "arguments": {
    "problem": "factoring",
    "params": {
      "bits": 2048
    }
  }
}
```

Leona answers (the summary, the cost lines, and the point to cost; the full answer also carries every stage, its alternatives and the methods' stated costs, the sources with their quotes, and the published whole-machine figures):

```json
{
  "summary": "Leona's workflow planner, for Factor an integer (RSA) at bits = 2,048 (given): Recover the period of a periodic function by Period finding in a finite cyclic group (the planner's default). Costs: Logical qubits (Gidney–Ekerå 2019): 6,190 logical qubits [leading-order; Gidney & Ekerå 2019 (arxiv:1905.09749), abstract]; Toffoli gates (Gidney–Ekerå 2019): 2.62e9 Toffoli gates [leading-order; Gidney & Ekerå 2019 (arxiv:1905.09749), abstract]; Measurement depth (Gidney–Ekerå 2019): 2.14e9 measurement layers [leading-order; Gidney & Ekerå 2019 (arxiv:1905.09749), abstract]; Logical qubits (Gidney 2025): 1,399 logical qubits [published; Gidney 2025 (arxiv:2505.15917), Table 5]; Toffoli gates per factoring (Gidney 2025): 6.5e9 Toffoli gates [published; Gidney 2025 (arxiv:2505.15917), Table 5]. Published at this size: Noisy qubits, 8 hours (Gidney–Ekerå 2019): 2e7 physical qubits [published; Gidney & Ekerå 2019 (arxiv:1905.09749), title and abstract]; Noisy qubits, under a week (Gidney 2025): < 1,000,000 physical qubits [published; Gidney 2025 (arxiv:2505.15917), abstract]. Figures here are rounded for reading; the lines carry exact values. For physical qubits and runtime, pass estimate_point to estimate_resources.",
  "lines": [
    {
      "id": "ge2021-qubits",
      "label": "Logical qubits (Gidney–Ekerå 2019)",
      "value": 6190,
      "unit": "logical qubits",
      "kind": "leading-order",
      "source": "ge2021-logical",
      "formula": "3n + 0.002·n·lg n"
    },
    {
      "id": "ge2021-toffolis",
      "label": "Toffoli gates (Gidney–Ekerå 2019)",
      "value": 2624225017.856,
      "unit": "Toffoli gates",
      "kind": "leading-order",
      "source": "ge2021-logical",
      "formula": "0.3n³ + 0.0005·n³·lg n"
    },
    {
      "id": "ge2021-depth",
      "label": "Measurement depth (Gidney–Ekerå 2019)",
      "value": 2143289344,
      "unit": "measurement layers",
      "kind": "leading-order",
      "source": "ge2021-logical",
      "formula": "500n² + n²·lg n"
    },
    {
      "id": "g2025-qubits",
      "label": "Logical qubits (Gidney 2025)",
      "value": 1399,
      "unit": "logical qubits",
      "kind": "published",
      "source": "gidney2025-table5",
      "formula": "Table 5, n = 2048"
    },
    {
      "id": "g2025-toffolis",
      "label": "Toffoli gates per factoring (Gidney 2025)",
      "value": 6500000000,
      "unit": "Toffoli gates",
      "kind": "published",
      "source": "gidney2025-table5",
      "formula": "Table 5, n = 2048"
    }
  ],
  "logical": {
    "logical_qubits": "ge2021-qubits",
    "toffolis": "ge2021-toffolis",
    "t_gates": null,
    "queries": null,
    "serial_depth": "ge2021-depth"
  },
  "estimate_point": {
    "label": "factoring (Leona planner)",
    "parameter_value": 2048,
    "logical_qubits": 6190,
    "toffoli_count": 2624225018,
    "t_count": 0,
    "non_clifford_depth": 2143289344
  }
}
```

The agent passes `estimate_point` on:

```json
{
  "tool": "estimate_resources",
  "arguments": {
    "points": [
      {
        "label": "factoring (Leona planner)",
        "parameter_value": 2048,
        "logical_qubits": 6190,
        "toffoli_count": 2624225018,
        "t_count": 0,
        "non_clifford_depth": 2143289344
      }
    ]
  }
}
```

Leona answers (the costed point; the full answer adds the frontier and each assumption set's citation):

```json
{
  "assumptions": "gidney-2025@v2",
  "points": [
    {
      "label": "factoring (Leona planner)",
      "refused": null,
      "distance": {
        "code_distance": 31,
        "logical_operations": 132690604193744,
        "required_error_per_operation": 7.536328635144969e-17,
        "achieved_error_per_operation": 1.0000000000000008e-17,
        "physical_per_logical": 2048
      },
      "fastest": {
        "footprint": {
          "data_patch_qubits": 12677120,
          "routing_qubits": 12677120,
          "factory_qubits": 417792,
          "total_physical_qubits": 25772032
        },
        "runtime": {
          "magic_states": 20993800144,
          "factory_count": 17,
          "throughput_seconds": 21410.58882332941,
          "reaction_limited_seconds": 21432.893440000003,
          "seconds": 21432.893440000003,
          "binding_term": "reaction",
          "factory_crossover": 17
        }
      },
      "smallest": {
        "footprint": {
          "data_patch_qubits": 12677120,
          "routing_qubits": 12677120,
          "factory_qubits": 24576,
          "total_physical_qubits": 25378816
        },
        "runtime": {
          "magic_states": 20993800144,
          "factory_count": 1,
          "throughput_seconds": 363980.0099965999,
          "reaction_limited_seconds": 21432.893440000003,
          "seconds": 363980.0099965999,
          "binding_term": "throughput",
          "factory_crossover": 17
        }
      }
    }
  ]
}
```

<!-- plan-workflow-example:end -->

No tool here submits a hardware job. Submitting to hardware needs a token with the
separate `hardware` scope (ai-ops 376), which the `run` scope does not include, and even
with that scope this server has no tool that submits.

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
| `LEONA_API_TOKEN` | unset | A personal access token, for `run_verified`/`get_run`/`list_my_runs`/`plan_workflow`/`estimate_resources`/`run_qapp`/`check_circuit`. Leave unset to use only the three read-only Atlas tools. |

In Claude Code, pass either with `--env NAME=value` before the server name. In the
JSON configs, add `"env": {"LEONA_API_URL": "...", "LEONA_API_TOKEN": "..."}` beside
`args`. Personal access tokens are a Leona feature still being rolled out
(proposal 7 Phase B); if `run_verified` answers that tokens are not available yet,
that is the account-wide switch, not this server.

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

The Atlas filtering rules and the HTTP client live in `leona_client`
(`packages/py/client`), shared with the `%nala` Jupyter magic and the
`leona-notebooks` CLI — this package now holds only the MCP protocol layer. The
filtering rules are themselves copies of TypeScript in `apps/web/lib/repository/`,
which is the source of truth; `packages/py/client/tests/test_mirrors.py` fails when a
copied vocabulary stops matching it. See `AGENTS.md` in this directory, and in
`packages/py/client`, before changing a rule.
