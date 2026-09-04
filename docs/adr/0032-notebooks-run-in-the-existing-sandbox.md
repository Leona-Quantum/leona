# ADR-0032: Notebooks are a versioned resource whose cells run in the existing sandbox, one dispatch per version

**Date:** 2026-09-02 · **Status:** proposed (feature/notebooks; owner review — the PR touches
`db/migrations`, `packages/py/contracts` and `apps/web/lib/routed-paths.ts`).

**Context:** A collaborator asked Leona to teach their engineers Qiskit through Jupyter notebooks
(an eight-week, code-first study group). The owner widened the ask: the platform itself should
produce notebooks like that from a prompt, keep them editable through chat with Nala, and grow
toward researchers driving hardware from a notebook. Two things Leona already has bear on the
design. The execute pipeline turns model output into evidence through a deny-all sandbox that
runs *one source string* with provider-owned setup and observer snippets around it
(`majorana_sandbox.spec.compose_execution`). And Qapps (ADR-0031) already established the shape
"parent resource + immutable versions + a run per generation" for a second kind of generated
artifact.

**Decision:**

1. **A notebook is its own domain**: `notebooks`, immutable `notebook_versions` (spec, source,
   executed `.ipynb`, execution report, advisory review), and `notebook_turns` (the chat). A
   generation or a revision is a **Run with `mode=notebook`** — quota, the event stream and the
   tier table apply unchanged — whose product is a version, never a Studio artifact.
2. **The canonical form is a `NotebookSpec` whose cells carry a pedagogical role**
   (`objective`, `predict`, `run`, `observe`, `explain`, `modify`, `checkpoint`, …). The
   structure a *kind* of notebook promises (a lesson follows predict→run→observe→explain→modify;
   a checkpoint asserts) is written once as prompt text and once as a predicate
   (`leona_notebooks.templates`), so it is a check that can fail. The model reads and writes the
   `.nb.py` percent format (jupytext-compatible) — never cells inside JSON strings — and the
   reader downloads nbformat 4.5 with the roles kept in cell metadata and standard `tags`.
3. **Cells execute in the existing sandbox, unchanged, as one dispatch.** `trusted_setup` defines
   a cell runner that executes each cell in one shared namespace and records stdout, the
   trailing expression, exceptions (stop at the first, as Jupyter's Run All does, unless the
   cell is tagged `raises-exception`) and matplotlib figures under a byte budget;
   `trusted_observer` copies the records into the protected observation. A notebook therefore
   inherits every ceiling the lane already has — 120 s, the tier's memory, 27 qubits, 1 MiB of
   evidence — and nothing about the sandbox's boundary moves.
4. **The guard is run on every cell's raw source before composition.** The composed program
   embeds cell sources as string literals, which the guard's line-based import check cannot
   see; a program composed without the per-cell check would pass the guard by construction.
   `compose_notebook_program` refuses to build one. Cells marked `execute=false` (hardware,
   credentials) are never composed and ship in the `.ipynb` for the reader to run where the
   credential exists.
5. **Chat edits are explicit operations on cell ids** (`RevisionPlan`), applied by code: untouched
   cells stay byte-identical, ids are stable across versions, and a bad operation fails at the
   operation rather than silently rewriting the notebook.
6. **The review is advisory**, as ADR-0023 made the alignment review advisory: it never blocks a
   save, and it names what the notebook does not establish.

**Consequences:**

- Figures depend on `matplotlib` (+ `pylatexenc` for circuit drawings), which the sandbox image
  does not pin. Until that image change is reviewed and promoted (a laptop step — the runbook),
  the report says `figures: unavailable` and the viewer says so; the same notebook renders its
  figures in the reader's own Jupyter.
- One dispatch per version means a notebook is bounded by one sandbox run. A lesson that
  legitimately needs more than 120 s is out of scope for this lane; the plan names the split
  (re-run cumulative prefixes) as the option if it is ever needed, not as something built.
- `/notebooks` is a signed-in surface under `app/(app)/`, so it is dynamic and gated by the
  layout, and `check-static-routes` is untouched. Public or shared notebooks would need the
  Qapp-style publication gate; deliberately not built here.
- The first curriculum (`curricula/qiskit-study-group`) is authored in the pipeline's own
  format and validated through a real kernel on the collaborator's Python version, so the
  format, the structure checks and the framework facts were exercised on ~30 notebooks before
  a model ever produced one.

**Alternatives rejected:** a Jupyter kernel inside the sandbox (widens the image and the
process model for no gain the cell runner does not give); notebooks as Studio artifacts (an
artifact is one program with one result; a notebook is many cells with a pedagogy); rendering
the notebook client-side from `.ipynb` only (would lose the roles the checks depend on).
