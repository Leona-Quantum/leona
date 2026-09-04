# Week 00 — Setup

A short onboarding session, about 30 minutes. There is no quantum computing content
yet. The goal is a working Qiskit 2.5 environment you have personally verified, so
Week 01 can start on the material instead of on installation problems.

**Deliverable:** a verified Qiskit install — `lab.ipynb` run top to bottom with both
checkpoints passing.

## Install

Run these commands from the repository root. They are the exact commands from the
course's own quick start.

```bash
uv python install 3.11
uv sync --locked --extra notebooks
uv run --locked --extra notebooks jupyter lab
```

`uv sync` creates a repository-local `.venv` and installs the exact package versions
recorded in `uv.lock` — you do not need to create or activate a virtual environment
yourself when using `uv run`. The last command opens JupyterLab in your browser.

If your organization does not permit installing `uv`, use the compatibility fallback
instead:

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
jupyter lab
```

## Open the lab notebook and select the kernel

1. In the JupyterLab file browser, open `week00_setup/lab.ipynb`.
2. From the kernel picker (top right of the notebook, or **Kernel → Change Kernel**),
   choose the **Python 3** kernel that points at this project's `.venv` — it is
   usually the only one offered right after `uv sync`.
3. If you are using VS Code instead of JupyterLab: open the Command Palette, run
   **Python: Select Interpreter**, and pick `.venv/bin/python` (macOS/Linux) or
   `.venv\Scripts\python.exe` (Windows).

## What the setup cell must print

Run the notebook's first code cell (`role=setup`, near the top). It prints three
version lines and then asserts on the first one. You are looking for:

```
qiskit    2.5.x
```

Any `2.5.x` — for example `2.5.0` or `2.5.2` — is correct. If the printed version
starts with anything else (`1.x`, `0.x`, or a different `2.x`), the assertion in that
cell stops the notebook there with a message pointing back to this file.

## Common install failures

- **`uv: command not found`.** `uv` itself is not installed. Follow
  [the uv install guide](https://docs.astral.sh/uv/getting-started/installation/), then
  retry `uv python install 3.11`.
- **`uv sync --locked` fails with a lock-file error.** The lock file and your platform
  disagree, or `uv.lock` is out of date. Ask in the study-group channel before dropping
  `--locked` — a silently re-resolved lock file can quietly change what the whole group
  is running.
- **The kernel picker shows no `.venv` option, or shows several unrelated Pythons.**
  JupyterLab was probably launched outside `uv run`, so it never saw this project's
  environment. Close it and relaunch with
  `uv run --locked --extra notebooks jupyter lab` from the repository root.
- **The setup cell prints a Qiskit version that is not `2.5.x`.** A different,
  previously installed Qiskit is shadowing this project's `.venv` — usually because the
  wrong kernel is selected (see above), or because `jupyter lab` was started from a
  global install rather than through `uv run`. Reselect the kernel; if that does not
  fix it, delete `.venv` and rerun `uv sync --locked --extra notebooks`.
- **`qc.draw("mpl")` or a histogram cell errors instead of showing a figure.**
  Matplotlib and `pylatexenc` are installed by the `notebooks` extra, so this usually
  means the `--extra notebooks` flag was left off `uv sync`. Rerun the install command
  above exactly as written.
- **Everything printed correctly but the notebook still won't run.** Restart the
  kernel (**Kernel → Restart Kernel**) and run all cells from the top — an earlier,
  half-finished run can leave variables in a confusing state.

## Next

Once both checkpoints in `lab.ipynb` pass, try `challenge.ipynb`, then compare your
answer with `solutions/week00_setup/challenge_solution.ipynb` and complete
`solutions/week00_setup/SELF_EVALUATION.md`. Week 01 assumes this environment works.
