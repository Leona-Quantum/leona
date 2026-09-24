# Nala inside your own Jupyter — the `%nala` magic

`leona_notebooks.jupyter` puts Nala, Leona Quantum's teaching assistant, in a cell
magic that talks to the same `/v1/notebooks` control plane the web surface
(leonaqt.com/notebooks) uses. A notebook you build with `%nala new`, edit locally in
JupyterLab, VS Code or Colab, and push back with `%nala push --to` is the *same
object*, with the same version history, as one built or edited on the site — there is
no separate local format to keep in sync.

Everything here also works with no Jupyter open at all, as `leona-notebooks`
subcommands (`new`, `pull`, `push`, `status`, `run`, `open`) — see
[CLI](#without-jupyter-the-cli) below.

## Install

### From a checkout of this repository

If you already have the `majorana` repo checked out (working on Leona itself, or in a
notebook the product opens for you):

```bash
uv pip install -e packages/py/notebooks
# or, without uv:
pip install -e packages/py/notebooks
```

That installs the `leona_notebooks` package (and `leona-notebooks` on your `PATH`) into
whatever Python environment your Jupyter kernel uses, with everything the package can
do — including the local `compile`/`execute`/`validate`/`build-curriculum` CLI
subcommands, which need `majorana-contracts` and `majorana-sandbox`, both of which this
form of install resolves from the workspace.

### In your own Jupyter, VS Code or Colab, with no checkout

In a notebook cell:

```python
%pip install -q "leona-notebooks @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/notebooks" "leona-client @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/client" "majorana-contracts @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/contracts" "majorana-sandbox @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/sandbox"
```

From a terminal, the same four requirements without the leading `%`:

```bash
pip install -q "leona-notebooks @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/notebooks" "leona-client @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/client" "majorana-contracts @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/contracts" "majorana-sandbox @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/sandbox"
```

This is what the bootstrap cell at the top of a notebook downloaded from Leona runs
for you (see [The download you get](#the-download-you-get) below). You only need to
type it yourself for a notebook you start outside the product.

**Why four packages, not one.** None of them is on PyPI. `leona-notebooks` names
`leona-client`, `majorana-contracts` and `majorana-sandbox` as dependencies, so
installing `leona-notebooks` on its own fails at dependency resolution ("No matching
distribution found for leona-client") and installs nothing. Naming all four as git
requirements in one command lets pip take each dependency from its URL. They are small:
their other dependencies are pydantic, httpx, nbformat, pyyaml and qiskit, all from
PyPI. A test (`test_the_bootstrap_installs_every_workspace_dependency`) derives this
list from the packages' own `pyproject.toml` files, so it cannot silently fall behind.

**Verified 2026-09-24:** in a fresh virtualenv (Python 3.13, nothing else installed), the
line above installed with pip from this repository's git history (the same
requirements, with the GitHub URL swapped for a local `git+file://` of the same commit).
The single-package line failed as described. Then, in an IPython shell with no token
set: `%load_ext leona_notebooks.jupyter` loaded, `%nala link` and `%nala open` worked,
`from leona_notebooks import leona_submit` ran on a Bell circuit and printed its local
message without submitting anything, `from leona_notebooks.leona import Leona`
imported, and `leona-notebooks validate` checked a curriculum folder. **Not verified:**
the same install over the network from `github.com`, and inside VS Code or Colab
themselves.

## Mint a personal access token

On leonaqt.com: **Account → Access tokens**. Give it a name, a lifetime, and check
**"Also let it start verified runs"** — unchecked by default, and `%nala new`, `push`,
`ask`, `fix`, `run` and the CLI equivalents all need it (they each start a run; a
read-only token gets a clear "insufficient scope" error instead of silently doing
nothing). The token is shown once; copy it somewhere safe, not into a notebook cell.

```bash
export LEONA_API_URL=https://majorana-api-nikekeixtq-uw.a.run.app   # optional; this is the default
export LEONA_API_TOKEN=<your token>                                  # required
```

Set these in your shell, a `.env` your shell sources, or your Jupyter kernel's
environment — **never** paste a token into a notebook cell or pass it as a magic or
function argument. Every command and function below reads `LEONA_API_TOKEN` from the
process environment; none of them accept a `--token` (or similar) argument, and `%nala`
prints a clear error if the variable is unset rather than silently failing.

## Load the extension

```python
%load_ext leona_notebooks.jupyter
```

Run that once per kernel session (put it in the first cell, or your IPython startup
profile). It registers both `%nala` (line magic) and `%%nala` (cell magic). Running it
twice in the same kernel is harmless — IPython prints a notice that the extension is
already loaded and does nothing further.

## Link a notebook to this kernel — `%nala link`

```
%nala link [<notebook_id>]
```

```python
%nala link 3f2a1c9e-...
# linked 3f2a1c9e-...
%nala link
# linked to 3f2a1c9e-...
```

Remembers a notebook id for the rest of this kernel session, so `ask`, `fix`, `status`,
`versions`, `run` and `open` below can all be typed without repeating the id every
time — the common case once you are iterating on one notebook. Bare `%nala link` (no
id) prints whatever is currently linked, or says nothing is.

This is **process-local, in-memory state** — not saved to a file, and not shared
between two kernels. It does not survive a kernel restart, and opening the same
directory in a second kernel does not inherit the first kernel's link. If a command
below is given an explicit id, that id wins over the link for that one call.

## Every magic

Anywhere a command below takes `<notebook_id>` as its **last-resort** default, it means
"the linked notebook if you have one, otherwise you must pass an id" — the commands say
so explicitly if you have linked nothing and passed nothing.

### `%nala new` — ask Nala to build a notebook from scratch

```
%nala new "<brief>" [--kind lesson|lab|challenge|walkthrough|demo|quiz|hardware|benchmark|project|scratch]
                     [--level newcomer|engineer|student|researcher]
                     [--no-analogies]
                     [--math none|minimal|full]
                     [--lang en|ja]
                     [-o file.ipynb]
```

```python
%nala new "teach me the quantum Fourier transform" --level student --math minimal -o qft.ipynb
```

This `POST`s the brief to `/v1/notebooks`, then polls the notebook until its first
version is ready — printing a friendly `generating <id> .....` progress line, since a
full generation (outline → draft → execute → repair → review) can take a minute or more
— and finally pulls the finished `.ipynb` to disk. It prints the new notebook's id and
the path it saved. If generation fails, `%nala new` raises rather than writing a broken
file; open the notebook on leonaqt.com to see why.

### `%nala pull` — save a Leona notebook next to you

```
%nala pull <notebook_id> [--version N] [-o file.ipynb]
```

```python
%nala pull 3f2a1c9e-...  -o qft.ipynb
%nala pull 3f2a1c9e-... --version 2 -o qft-v2.ipynb
```

Without `--version`, pulls the notebook's current (ready) version. The saved file is a
real `.ipynb` — open it in JupyterLab, VS Code, or Colab like any other notebook.

### `%nala push` — import a notebook, or push a new version

```
%nala push <file.ipynb> [--title "…"]                                  # import as a NEW notebook
%nala push <file.ipynb> --to <notebook_id> [--message "…"] [--no-run]  # a new version of one you own
```

```python
# Bring an existing .ipynb into Leona for the first time:
%nala push my-experiment.ipynb --title "My experiment"

# You edited qft.ipynb locally (added a cell, fixed a typo) — push it back
# as the next version of the SAME notebook:
%nala push qft.ipynb --to 3f2a1c9e-... --message "fixed the phase estimation cell"
```

By default, pushing a version re-runs it in the sandbox, the same as every other
version — so the reader sees fresh, real outputs, not whatever your local kernel
happened to produce. Pass `--no-run` to push without a re-run (rare — mainly for a
notebook you already validated locally and don't want to spend sandbox time on again).

### `%nala versions` — list a notebook's version history

```
%nala versions [<notebook_id>]
```

```python
%nala versions 3f2a1c9e-...
```

Prints one line per version: sequence number, status, who made it (`user` or `nala`),
and its message.

### `%nala status` — the newest version at a glance

```
%nala status [<notebook_id>]
```

```python
%nala status 3f2a1c9e-...
# v3 ready (by nala)
# message: fixed the phase estimation cell
# cells: 11 ran, 0 failed, 0 not run
```

Shows the latest version's status, author, and message, and — once it has an execution
report — how many cells ran cleanly, failed, or never got to run (because an earlier
cell failed first, Jupyter's Run-All semantics).

### `%nala fix` — explain the traceback you just hit

```
%nala fix [<notebook_id>]
```

```python
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 3)   # oops — only 2 qubits
```

```python
%nala fix 3f2a1c9e-...
```

Reads the **last traceback in this IPython session** and the source of the cell that
raised it, and asks Nala: *"This cell failed in my Jupyter: ‹the cell›. Traceback:
‹the traceback›. Explain what went wrong and give me the corrected cell."* — then prints
the reply. Run it right after a cell fails; if nothing has failed yet this session, it
says so rather than guessing.

### `%nala run` — push (or re-run) and wait, with a per-cell report

```
%nala run [<file.ipynb>] [--to <notebook_id>] [--until <cell_id>]
```

```python
%nala run                              # re-run the linked notebook's current version
%nala run --to 3f2a1c9e-...            # re-run a notebook you didn't link
%nala run edited.ipynb --to 3f2a1c9e-...              # push edited.ipynb as a new version and run it
%nala run edited.ipynb --to 3f2a1c9e-... --until c04   # ...but only through cell c04
%nala run new.ipynb                    # import new.ipynb as a brand-new notebook and run it
```

Whichever form: pushes or re-runs, waits for the sandbox, and prints one line per cell
— a checkmark for a cell that ran, an `✗` with the exception type, message and the last
few lines of the traceback for a cell that raised, and a marker for a cell that never
got to run. If any cell raised, `%nala run` raises too (in the CLI, `leona-notebooks
run` exits with status 1) — so a failing run is unambiguous even if you are not reading
every line of output.

### `%nala open` — print the notebook's leonaqt.com URL

```
%nala open [<notebook_id>]
```

```python
%nala open 3f2a1c9e-...
# https://leonaqt.com/notebooks/3f2a1c9e-...
```

Just string formatting — no network call. Useful after `%nala link`, to get the URL of
whatever you're working on without leaving the kernel.

### `%%nala ask` — ask Nala about a notebook, with code

```
%%nala ask [<notebook_id>]
<your question>
---
<optional: the code you're asking about>
```

```python
%%nala ask 3f2a1c9e-...
Why does the counts dictionary only have two keys instead of four?
```

Posts the cell body as a chat turn on that notebook and waits for Nala's reply (a `nala`
turn — the same conversation the chat rail on leonaqt.com shows).

### `%%nala explain` — explain a cell, line by line

```
%%nala explain [<notebook_id>] [--level newcomer|engineer|student|researcher]
<the code you want explained>
```

```python
%%nala explain 3f2a1c9e-... --level newcomer
qc = QuantumCircuit(3)
qc.h(0)
qc.cx(0, 1)
qc.cx(1, 2)
```

Asks Nala to explain the cell body line by line, at the given level (default
`engineer`), and prints the reply.

## A small Python API — for scripts and cells that don't want a magic line

```python
from leona_notebooks.leona import Leona

lq = Leona.from_env()          # reads LEONA_API_URL / LEONA_API_TOKEN, same as %nala
lq.devices()                    # every device Leona has a rate card for
lq.estimate(circuit, device="ibm.kyiv", shots=1024)   # a pre-run price, never a submission
lq.ask("why did this fail?")    # asks Nala about the linked notebook (or pass notebook=)
run = lq.run("Build a 3-qubit GHZ state and verify it", framework="qiskit")
print(run.status, run.verified)
```

`Leona` is `leona_notebooks.jupyter.Client` (itself `leona_client.Client`) under a
friendlier name, with `ask`/`run` convenience wrappers on top — the same token, the
same routes, the same run-scope and rate limits `%nala` already runs into, just a plain
method call for code that is not running inside IPython at all (a script, a scheduled
job, a plain `.py` file). `circuit` to `estimate`/`leona_submit` below can be a qiskit
`QuantumCircuit` or an OpenQASM 3 string; qiskit is only imported if you pass one, and
only lazily, the moment it's needed.

## `leona_submit` — write a hardware cell that works in both places

```python
from leona_notebooks import leona_submit

leona_submit(circuit, shots=1024, label="ghz-check")
```

This one function name means two different things depending on where the cell runs,
and a cell written against either reads the same way in the other:

- **In your own Jupyter/VS Code/Colab** (this package, `leona_notebooks.leona`):
  **never submits anything.** If `LEONA_API_TOKEN` is set, it fetches and prints a
  pre-run price estimate for the circuit on the default (or given) device; either way
  it prints one plain sentence telling you to open the notebook on Leona to actually
  run it on hardware, and returns a small object (`.qasm`, `.shots`, `.num_qubits`)
  for your own inspection. Owner ruling ai-ops 362: a personal access token may read
  and start verified (simulated) runs, not spend real QPU time — "hardware jobs come
  later under their own permission" — so nothing this local function does may either.
  It never raises for a missing qiskit or a missing token (prints a message and
  returns `None` instead); an invalid circuit, shot count or label still raises, like
  calling any other function with bad arguments would.
- **Inside Leona's own sandbox**, when the notebook actually runs there, a *different*
  `leona_submit` (defined by the sandbox, not by this package) records the same
  request into the notebook's execution report, which the web page then offers to run
  on real hardware with your own IBM credential and an explicit confirmation.

Only `circuit`, `shots` and `label` are common to both — the local version also takes
a `device=` keyword (which device to price) that the in-sandbox one does not accept;
leave it unset in a cell you intend to run on Leona too, or drop it before you push.

## The round trip

1. **`%nala new "<brief>"`** — Nala builds a notebook and you get a local `.ipynb`.
2. **`%nala link <notebook_id>`** — so the rest of this session can refer to it by
   nothing at all.
3. **Edit it in JupyterLab, VS Code or Colab** — add a cell, change a parameter, fix a
   typo, whatever you want. It's a normal notebook; edit it however you normally would.
4. **`%nala run edited.ipynb --to <notebook_id>`** — your edit becomes the next
   version, re-run in the sandbox, with a per-cell report right there in your kernel.
5. **The version appears on leonaqt.com** — anyone with access to the notebook sees
   your version, with fresh outputs, in the version picker. `%nala open` prints the URL.
6. **A cell breaks?** Run it, see the traceback, then **`%nala fix`** — Nala reads the
   traceback and the cell straight out of your session and proposes the fix. Apply it,
   re-run, and push again.

## Without Jupyter — the CLI

Every control-plane operation above except `link` is also a `leona-notebooks`
subcommand, sharing the same `Client` and the same two environment variables — useful
in a plain terminal, a script, or CI. (`link` is Jupyter-only: it is remembered for the
life of a kernel, and a CLI invocation is a fresh process every time with nothing to
remember it in — `status`/`run`/`open` take the notebook id directly instead.)

```bash
leona-notebooks new "teach me the quantum Fourier transform" --level student -o qft.ipynb
leona-notebooks pull 3f2a1c9e-... -o qft.ipynb
leona-notebooks push qft.ipynb --to 3f2a1c9e-... --message "fixed the phase estimation cell"
leona-notebooks status 3f2a1c9e-...
leona-notebooks run edited.ipynb --to 3f2a1c9e-... --until c04
leona-notebooks open 3f2a1c9e-...
```

Exit status is 1 the moment any cell in a `run` raised, so a CI step can run it bare.

(`leona-notebooks` also has purely local subcommands — `compile`, `execute`,
`validate`, `build-curriculum`, `import`, `structure` — that never touch the network
and need the full checkout install (see [Install](#install) above), not the plain
`pip install` of this package alone; `leona-notebooks --help` lists all of them.)

## VS Code

VS Code's own Jupyter extension (`ms-toolsai.jupyter`) runs a real IPython kernel
under the hood, the same one `%nala` and `%%nala` register against in JupyterLab or
plain `jupyter notebook` — so everything on this page works unchanged in a `.ipynb`
file opened in VS Code, or in a Python file's interactive window, once
`leona-notebooks` is installed in the interpreter VS Code has selected for that
notebook (Command Palette → "Notebook: Select Notebook Kernel", or the kernel picker
in the notebook toolbar) and `LEONA_API_TOKEN` is set in the environment that
interpreter/terminal sees.

**Not independently verified in this session** (no VS Code available to test against
here) — this follows from how the Jupyter extension and IPython magics are documented
to work, not from having opened VS Code and run `%nala` in it. If something here does
not match what you see, the code itself (`packages/py/notebooks/src/leona_notebooks/jupyter.py`)
is the source of truth.

### `leona-mcp` in VS Code, Claude Code, or GitHub Copilot

For an AI assistant working *alongside* your notebook (not the magic above, a separate
MCP server that looks up the Atlas and can start/read runs), `packages/py/mcp` ships
`leona-mcp`. Its own `README.md` has the full tool list and settings; the short version
for a client that reads standard MCP JSON config (VS Code's `mcp.json`, Claude
Desktop, Cursor):

```json
{
  "mcpServers": {
    "leona-atlas": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/mcp",
        "leona-mcp"
      ],
      "env": {
        "LEONA_API_TOKEN": "<your token>"
      }
    }
  }
}
```

For Claude Code specifically:

```bash
claude mcp add --transport stdio leona-atlas --env LEONA_API_TOKEN=<your token> -- \
  uvx --from "git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/mcp" leona-mcp
```

GitHub Copilot's MCP support (in VS Code, "Chat: Add MCP Server") reads the same
`mcp.json` shape as the JSON block above. This section is transcribed from
`packages/py/mcp/README.md`, which is the maintained source for `leona-mcp` — read it
directly for anything not covered here, including which of its tools need a token and
which are read-only. That README currently still describes personal access tokens as
"a Leona feature still being rolled out (proposal 7 Phase B)"; that line predates this
page and is stale now that tokens are live — flagged for whoever next edits that file,
not fixed here (out of this page's scope).

## Colab

A Colab notebook is a hosted Jupyter kernel with `pip` and `%pip` already available, so
the same install line (all four packages) and `%load_ext` work:

```python
%pip install -q "leona-notebooks @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/notebooks" "leona-client @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/client" "majorana-contracts @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/contracts" "majorana-sandbox @ git+https://github.com/Leona-Quantum/leona#subdirectory=packages/py/sandbox"
%load_ext leona_notebooks.jupyter
```

Set `LEONA_API_TOKEN` for the session with Colab's own "Secrets" panel (the key icon in
the left sidebar) rather than typing it into a cell — `os.environ["LEONA_API_TOKEN"] =
userdata.get("LEONA_API_TOKEN")` in a cell you run once, using Colab's `userdata` API,
keeps the value out of the notebook's saved source.

**Not independently verified in this session** — no Colab environment available to test
against here. This describes how a standard IPython kernel and `%pip`/`%load_ext`
behave in Colab as documented, not a run performed there.

## The download you get

Downloading a notebook from Leona (`GET /v1/notebooks/{id}/versions/{seq}/export.ipynb`,
the download button on leonaqt.com) gives you a real `.ipynb` whose first cell is a
short bootstrap: it runs the `pip install` line above, loads the extension, runs
`%nala link <that notebook's id>`, and imports `leona_submit` — so a hardware cell
copied straight out of Leona's sandbox does not `NameError` the moment you open the
file elsewhere. It is safe to run twice (installing an already-installed package,
loading an already-loaded extension, and re-linking the same id are all no-ops), and it
never contains a token.

## A note on safety

`%nala` never executes anything on your behalf — it only ever calls the `/v1/notebooks`
API, which runs generated code in Leona's own sandbox, the same one every notebook goes
through regardless of how it was created. Nothing in this package reads your Jupyter
kernel's variables, files, or environment except what `%nala fix` explicitly reads (the
last traceback and the failing cell's own source) to ask Nala about it, and
`leona_submit`, run locally, never submits a job to hardware — see
[`leona_submit`](#leona_submit--write-a-hardware-cell-that-works-in-both-places) above.
