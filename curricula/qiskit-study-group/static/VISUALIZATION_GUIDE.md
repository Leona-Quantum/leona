# Visualization guide

Every lab has at least one figure cell — a histogram, a circuit drawing, or (in week 03) a
Bloch sphere view. This guide explains how to read each figure and what to do when one does
not render.

The rule every figure cell follows: **the picture is never the only copy of the result.**
Alongside every plot, the notebook also prints the same information as plain text — a counts
dict, a circuit's text diagram, or a coordinate list — so a reader running headless, over SSH,
or in an environment without a display still gets the full result.

## Reading a circuit drawing

`qc.draw("text")` always works and needs no optional dependency; it prints the circuit as
ASCII, one wire per qubit, gates left to right in the order they were added. Use it to check
gate order and which qubits a multi-qubit gate touches.

`qc.draw("mpl")` renders the same circuit as a matplotlib figure — clearer for a room of
people looking at a screen, and it draws barriers, classical wires, and multi-qubit gate boxes
more legibly than the text form. It needs `matplotlib` and `pylatexenc` (both installed by the
base dependencies in `pyproject.toml`; see "Optional dependencies" below).

In both forms:

- Wires are qubits, top to bottom, numbered from `q_0`.
- A box on a wire is a single-qubit gate (`H`, `X`, an `RZ(θ)` with its angle printed inside).
- A vertical line connecting a solid dot to a box or an `X` symbol is a two-qubit gate — the
  dot is the control, the connected symbol is the target (`cx` draws a dot and a ⊕).
- A double line at the end of a wire, feeding into a meter symbol, is a measurement into a
  classical bit.

## Reading a histogram

`plot_histogram(counts)` plots one bar per observed bitstring, height proportional to how many
of your shots produced it. Read the x-axis labels carefully — they are exactly the keys in the
`counts` dict the notebook also prints, in Qiskit's bit order (qubit 0 is the **rightmost**
character; week 02 makes this concrete with a worked example).

A few things to expect, not to be alarmed by:

- **Bars are never exactly equal**, even when the underlying probabilities are, because
  sampling is stochastic. A checkpoint that asserts a probability always asserts a band around
  the expected value, not an exact count — that is intentional, not a bug in the checkpoint.
- **A bar you did not expect at all** (rather than an expected bar that is a little off) is
  usually a real signal: check your circuit's gates and measurement order before assuming it's
  noise.
- Re-running the same cell with the same seed reproduces the same histogram exactly. If two
  runs disagree, check whether the seed changed.

## Reading a Bloch sphere view

Week 03 is the only week that uses a Bloch sphere; it shows a single qubit's state as a point
(or arrow) on a sphere, rather than as measurement probabilities. The two poles are the
computational basis states; the equator represents an equal superposition, and where the arrow
points *around* the equator (not just how far up or down it is) encodes the phase that a
histogram cannot show you at all — which is the whole reason week 03 introduces this view. Read
the notebook's own explanation of that week's specific view function; the API changes across
Qiskit releases more than the drawing functions above do.

## Optional dependencies

- **`pylatexenc`** — required for `qc.draw("mpl")` to render gate labels. It is a base
  dependency in `pyproject.toml`, so a normal `uv sync` or `pip install -r requirements.txt`
  installs it. If you see it is missing, install it directly:
  `python -m pip install pylatexenc`.
- **`matplotlib`** — required for `qc.draw("mpl")`, `plot_histogram`, and the Bloch sphere view.
  Also a base dependency; installed the same way.
- **Graphviz is *not* required anywhere in this course.** Week 04's transpilation lab prints a
  backend's coupling map as a plain list of connected qubit pairs instead of a graph diagram,
  specifically so nobody needs to install a system-level graphviz binary to finish the week.

## Troubleshooting

**`MissingOptionalLibraryError: ... pylatexenc ...`**
`qc.draw("mpl")` needs `pylatexenc` at runtime, not just `matplotlib`. Run
`python -m pip install pylatexenc` (or re-run `uv sync --locked --extra notebooks`, which
installs it as a base dependency) and restart the kernel — a package installed after the
kernel started will not be visible until you do.

**A figure does not show up in VS Code**
Make sure the notebook's kernel is the project's `.venv` (bottom-right kernel picker, or
`.venv/bin/python` if you are selecting an interpreter path directly) — a figure silently fails
to render, with no error, if the notebook is running under a different Python that lacks
matplotlib. Also confirm the cell actually ran (a stale "figure did not update" is almost
always a not-yet-executed cell, visible from the `[ ]` empty run-count bracket rather than a
number).

**Nothing seems to have changed after I edited a cell**
Restart the kernel and run all cells from the top. Notebooks allow cells to run out of order,
which can leave you looking at an old figure from a previous run while believing it reflects
your latest edit. Restart-and-run-all is also what the self-evaluation checklist in
`solutions/` asks you to do before comparing your work — get in the habit early.
