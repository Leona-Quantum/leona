# Nala inside your own Jupyter — the `%nala` magic

`leona_notebooks.jupyter` puts Nala, Leona Quantum's teaching assistant, in a cell
magic that talks to the same `/v1/notebooks` control plane the web surface
(leonaqt.com/notebooks) uses. A notebook you build with `%nala new`, edit locally in
JupyterLab, and push back with `%nala push --to` is the *same object*, with the same
version history, as one built or edited on the site — there is no separate local
format to keep in sync.

Everything here also works with no Jupyter open at all, as `leona-notebooks`
subcommands (`new`, `pull`, `push`, `status`) — see [CLI](#without-jupyter-the-cli)
below.

## Install

From a checkout of this repo:

```bash
uv pip install -e packages/py/notebooks
# or, without uv:
pip install -e packages/py/notebooks
```

That installs the `leona_notebooks` package (and `leona-notebooks` on your `PATH`) into
whatever Python environment your Jupyter kernel uses. `%nala` itself adds no dependency
beyond IPython — its HTTP calls go through the standard library's `urllib`, not
`requests` or `httpx`.

## Configure — two environment variables, never a token in a cell

```bash
export LEONA_API_URL=https://api.leonaqt.com      # optional; this is the default
export LEONA_API_TOKEN=<your bearer token>          # required
```

Set these in your shell, a `.env` your shell sources, or your Jupyter kernel's
environment — **never** paste a token into a notebook cell or pass it as a magic
argument. Every command below reads `LEONA_API_TOKEN` from the process environment; none
of them accept a `--token` (or similar) argument, and `%nala` prints a clear error if the
variable is unset rather than silently failing.

## Load the extension

```python
%load_ext leona_notebooks.jupyter
```

Run that once per kernel session (put it in the first cell, or your IPython startup
profile). It registers both `%nala` (line magic) and `%%nala` (cell magic).

## Every magic

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
%nala versions <notebook_id>
```

```python
%nala versions 3f2a1c9e-...
```

Prints one line per version: sequence number, status, who made it (`user` or `nala`),
and its message.

### `%nala status` — the newest version at a glance

```
%nala status <notebook_id>
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
%nala fix <notebook_id>
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

### `%%nala ask` — ask Nala about a notebook, with code

```
%%nala ask <notebook_id>
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
%%nala explain <notebook_id> [--level newcomer|engineer|student|researcher]
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

## The round trip

1. **`%nala new "<brief>"`** — Nala builds a notebook and you get a local `.ipynb`.
2. **Edit it in JupyterLab** — add a cell, change a parameter, fix a typo, whatever you
   want. It's a normal notebook; edit it however you normally would.
3. **`%nala push <file> --to <notebook_id>`** — your edit becomes the next version,
   re-run in the sandbox.
4. **The version appears on leonaqt.com** — anyone with access to the notebook sees your
   version, with fresh outputs, in the version picker.
5. **A cell breaks?** Run it, see the traceback, then **`%nala fix <notebook_id>`** —
   Nala reads the traceback and the cell straight out of your session and proposes the
   fix. Apply it, re-run, and push again.

## Without Jupyter — the CLI

Every control-plane operation above is also a `leona-notebooks` subcommand, sharing the
same `Client` and the same two environment variables — useful in a plain terminal, a
script, or CI:

```bash
leona-notebooks new "teach me the quantum Fourier transform" --level student -o qft.ipynb
leona-notebooks pull 3f2a1c9e-... -o qft.ipynb
leona-notebooks push qft.ipynb --to 3f2a1c9e-... --message "fixed the phase estimation cell"
leona-notebooks status 3f2a1c9e-...
```

(`leona-notebooks` also has purely local subcommands — `compile`, `execute`,
`validate`, `build-curriculum`, `import`, `structure` — that never touch the network;
`leona-notebooks --help` lists all of them.)

## A note on safety

`%nala` never executes anything on your behalf — it only ever calls the `/v1/notebooks`
API, which runs generated code in Leona's own sandbox, the same one every notebook goes
through regardless of how it was created. Nothing in this package reads your Jupyter
kernel's variables, files, or environment except what `%nala fix` explicitly reads (the
last traceback and the failing cell's own source) to ask Nala about it.
