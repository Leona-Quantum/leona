# Certification track

This directory is a separate practice track for API recall, code reading, debugging,
visualization, construction, execution, V2 result objects, observables, and OpenQASM 3
in Qiskit 2.5 — the kind of question style used by IBM's Certified Quantum Computation
using Qiskit v2.X Developer – Associate exam.

**This track is not affiliated with, endorsed by, or produced by IBM.** Every question
in it is original: none are copied from IBM's exam, from any exam dump, or from any
other source. Completing this track does not guarantee passing IBM's exam, and IBM's
exam scope and policies can change independently of this material — treat this as
practice for the kind of recall the exam drills, not as a substitute for IBM's own exam
guide.

## How to use this

Complete the main eight-week study-group track (`week00_setup/` through
`week08_project/`) first. This track intentionally is not mixed into the weekly
sessions — it assumes everything the weeks teach and drills it from a different angle,
API-recall and debugging rather than build-something-and-explain-it.

1. Work through `practice_questions.ipynb` at your own pace. Write down an answer
   before you run each answer cell — the same predict-before-you-run habit as the
   weekly labs, just applied to reading code instead of writing it.
2. When you consistently get most areas right, attempt `mock_exam.ipynb` under its
   45-minute time limit, in one sitting, without looking anything up mid-exam.
3. Score yourself against `ANSWER_KEY.md` and note which areas had more than one miss.
   Reread the matching week's lab for that area, then retry `practice_questions.ipynb`'s
   questions in that area before a second mock attempt.

Both notebooks build two ways, the same as a weekly challenge: an answer-free build
(the one you should attempt questions in) and a solution build with every answer cell
filled in and checked. `ANSWER_KEY.md` is the same 57 answers in one short, readable
list with a one-line reason each — useful for a quick scan, but the answer cell in each
notebook is the checked, authoritative form, and the two are kept consistent with each
other by construction.

## API areas and question counts

Every question names its area explicitly, next to its number (for example, "Area:
Transpilation"), so you can jump straight to a weak spot in either notebook.

| Area | `practice_questions.ipynb` | `mock_exam.ipynb` | Total |
|---|---|---|---|
| Circuit construction | 5 | 3 | 8 |
| Visualization | 4 | 3 | 7 |
| Transpilation | 4 | 3 | 7 |
| Primitives (PUBs) | 4 | 3 | 7 |
| V2 result objects | 4 | 3 | 7 |
| Observables | 4 | 3 | 7 |
| OpenQASM 3 | 3 | 3 | 6 |
| Debugging | 4 | 4 | 8 |
| **Total** | **32** | **25** | **57** |

- **Circuit construction** — `QuantumCircuit` constructor shapes, gate argument order
  (`cx(control, target)`), `Parameter`/`assign_parameters`, `compose()` and its
  `inplace` argument, named registers.
- **Visualization** — `qc.draw()`'s default output, `plot_histogram`'s return type and
  keyword defaults, and the easy-to-conflate difference between a circuit diagram's
  top-to-bottom wire order and a bitstring's own bit order.
- **Transpilation** — `Target` and `GenericBackendV2`'s basis and coupling map,
  `generate_preset_pass_manager`'s actual default `optimization_level`, and what
  routing does when a circuit needs a connection the coupling map doesn't have.
- **Primitives (PUBs)** — what a Primitive Unified Bloc is for `StatevectorSampler` and
  `StatevectorEstimator`, default shot counts, and sweeping a `Parameter` across many
  values inside one call.
- **V2 result objects** — indexing a `PrimitiveResult`, reading `.data.<register>`,
  `get_counts()` versus `get_bitstrings()`, `.data.evs`, `.data.stds`, and per-PUB
  `metadata`.
- **Observables** — `SparsePauliOp` arithmetic (`+`, `*`, `@`, `.tensor()`,
  `.simplify()`), its qubit-ordering convention, and `.apply_layout()` for moving an
  observable from logical to physical qubits.
- **OpenQASM 3** — `qiskit.qasm3.dumps`/`loads`, what an OpenQASM 3 export actually
  contains, and what happens when you dump an untranspiled circuit or load malformed
  text.
- **Debugging** — reading bit order correctly, what happens when you forget
  `measure_all()`, what `StatevectorEstimator` does with a circuit that still has
  measurements in it, and the `KeyError` that comes from indexing a counts dict with an
  outcome that never appeared.
