# AGENTS.md — leona-planner

The Atlas workflow planner's arithmetic in Python. Distribution `leona-planner`,
module `leona_planner`. Its one caller is `services/api` (`routes/plans.py`,
`POST /v1/plans`), which is what the connector's `plan_workflow` MCP tool reaches.

**The TypeScript planner is the source of truth.** `apps/web/lib/workflow-planner/`
runs on every keystroke on `/repository/plan`; this is a second implementation of its
arithmetic only, because the connector reaches Leona over HTTP with a personal access
token and Next.js has no token path. Owner ruling, ai-ops 382 (2026-09-25): "Port only
the arithmetic to Python now. CI runs both on a grid of inputs and fails if any number
differs. Each new formula must be written twice, but CI catches any drift."

| Module | Holds |
|---|---|
| `plan.py` | `plan_workflow(problem, params, choices)` (stages, cost lines, logical summary, the estimate point, sources, as JSON) and `input_errors` (what the API refuses). |
| `assemble.py` | The stage walk, ported from `assemble.ts`. |
| `costs.py` | The per-problem formulas, ported from `costs.ts`. Arithmetic and control flow only. |
| `_jsmath.py` | JavaScript's `Math` where Python's differs (float `ceil`/`floor`, half-up rounding, no exceptions). |
| `_data.py` + `planner_data.json` | Everything that is not arithmetic, GENERATED from the TS planner: problems and parameter specs, the reachable layer graph in both languages, every cost line's and note's words, the sources and their papers, Gidney 2025's Table 5. |

## Changing a formula (or adding one)

1. Change `apps/web/lib/workflow-planner/costs.ts` first. It is what the page shows.
2. Make the same change in `costs.py`, in the same evaluation order, using `_jsmath`
   for anything but `+ - * /`.
3. Regenerate: `node --experimental-strip-types scripts/write-planner-fixture.ts` from
   the repo root. It rewrites `planner_data.json`, `tests/parity_grid.json` and
   `packages/py/mcp/src/leona_mcp/plan_catalog.json`.
4. `uv run pytest packages/py/planner -q` and the web test
   `apps/web/lib/workflow-planner-python-port.test.ts`.

A new line id needs no text here: its words come from the data by id. A new NOTE needs
an entry in `COST_NOTES` in `costs.ts` (the builder refuses a report carrying a note
that is not in the table). A new problem needs a model in `costs.MODELS` and grid
values in `TYPICAL` in `python-port.ts`.

## The gate, and what each half catches

- `apps/web/lib/workflow-planner-python-port.test.ts` (the `ts` job): the three
  generated files are byte-for-byte what the TS code produces today, the grid reaches
  every line id `costs.ts` declares (read from its source text), and every note.
- `tests/test_planner_parity.py` (the `py` job): the port answers all ~900 grid points and
  ~370 choice sets as the TS planner did, integers exactly and other numbers to a
  relative 1e-12 (its docstring justifies the number), and every TS line id has a
  Python counterpart.
- Watched go red when written: +1 on `ge2021-qubits`, `0.0005` → `0.0006` in the
  Gidney–Ekerå Toffoli count, and the stage-depth cap one too small each failed the
  parity test and passed again once restored.

## Rules that are load-bearing

- **Standard library only, and imports nothing in the workspace.** The root
  `pyproject.toml`'s import-linter contract for `leona_planner` enforces it.
  `leona_client` and `leona_mcp` must never import this package (they reach
  `POST /v1/plans` over HTTP; a second contract enforces that too).
- **Numbers are never stored.** A plan is recomputed from its inputs every time
  (`routes/runs.py` states the rule); nothing here writes anywhere.
- **Scaling lines stay magnitudes.** A `kind: "scaling"` line's value is never a count
  and never reaches the logical summary or the estimate point (`types.ts` `CostLine`).
- **A null value keeps its `missing` list.** A line that lacks a parameter says which.

Commands: `uv run pytest packages/py/planner -q`.
