# AGENTS.md — leona-notebooks

The notebook lane's pure core: no FastAPI, no SQLAlchemy, no network. Everything a
notebook *is* lives here; everything that *stores* or *serves* one lives in `services/`.

Three forms of one notebook, and the converters between them:

| Form | Where it is used | Module |
|---|---|---|
| `NotebookSpec` (pydantic, JSON) | the canonical stored form — `notebook_versions.spec` | `spec.py` |
| `.nb.py` percent-format source (jupytext-compatible) | what the model writes and what humans author | `source.py` |
| `.ipynb` (nbformat 4.5) | what the reader downloads and what JupyterLab opens | `ipynb.py` |

Rules that are load-bearing:

- **Cells execute in the existing sandbox, unchanged.** `sandbox_program.py` composes one
  program whose `trusted_setup` runs every cell in one namespace, capturing stdout, the
  last expression, exceptions, and matplotlib figures per cell. It widens nothing: the
  guard runs on **every cell's raw source before composition** (the composed program
  embeds cell sources as string literals, which the line-based import check cannot see —
  so a program composed without the per-cell guard is a guard bypass; `compose_notebook_program`
  refuses to build one).
- **A notebook run is one sandbox dispatch**: ≤120 s wall clock, ≤1 MiB of evidence. Figures are
  budgeted (`image_budget_bytes`), the largest dropped first and *named as dropped* rather than
  silently missing. matplotlib may be absent from the image — figures then degrade to text.
- **`role=solution` code cells carry a `stub`.** The challenge build replaces the solution with the
  stub and drops solution/answer markdown; the solution build keeps everything. A challenge
  notebook must still execute end-to-end with the stubs in place.
- **Corpus prose is not Markdown** (`apps/web/lib/math-text.ts`). `atlas.py`'s converter wraps
  `$…$` and leaves `|`, `_`, `*` literal; `explanationMd` *is* Markdown and passes through.
- No `.ipynb` with outputs is ever committed to this repo (gitleaks reads base64 as secrets;
  outputs are regenerated at build time).

Commands: `uv run pytest packages/py/notebooks` · `uv run leona-notebooks --help`.
