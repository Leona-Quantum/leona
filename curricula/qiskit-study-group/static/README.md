# Qiskit 2.x Study Group

A code-first curriculum for software engineers who know Python and are new to quantum
computing. Learners build, run, modify, and debug small circuits before adding the minimum
mathematics needed to explain what they observed.

The course builds practical Qiskit 2.x skill and a foundation for further study toward the
**IBM Certified Quantum Computation using Qiskit v2.X Developer – Associate** certification.
It is not affiliated with IBM, and its practice questions are original.

## Who this is for

You should be comfortable with Python and Jupyter notebooks. You do **not** need physics,
linear algebra, Dirac notation, or quantum-computing experience. The recurring loop is:

> **Predict → Run → Observe → Explain → Modify**

Circuits stay small, jargon is introduced only when it becomes useful, and each session ends
with something working.

## Curriculum

Week 00 is a short onboarding session. Weeks 01–08 form the eight-week study-group track.

| Week | Topic | Key concepts | Deliverable |
|---|---|---|---|
| [00](week00_setup/) | Setup | Environment, circuit, local sampling | Verified Qiskit install |
| [01](week01_qubits_circuits/) | Qubits and circuits | X, H, measurement, shots | Quantum coin |
| [02](week02_entanglement/) | Multiple qubits | CX, Bell state, correlation | Correlated bit generator |
| [03](week03_quantum_gates/) | Gates and state | Phase, rotations, statevector | Gate prediction experiments |
| [04](week04_transpilation/) | Transpilation | Target, basis, routing, ISA | Target-compatible circuit |
| [05](week05_primitives/) | Primitives | SamplerV2, EstimatorV2, observables | Primitive selection exercise |
| [06](week06_grover/) | Grover search | Oracle, phase marking, interference | Two-qubit Grover circuit |
| [07](week07_variational/) | Hybrid algorithms | Parameters, objective, optimizer | One-qubit variational solver |
| [08](week08_project/) | Mini project | Integration, explanation, demo | Team demo |
| [Bonus](bonus_ibm_quantum_hardware/) | IBM Quantum hardware | Account, Runtime, ISA job, retrieval | Optional QPU result |

Each teaching week contains a concise guide, an executable `lab.ipynb`, and an answer-free
`challenge.ipynb`. Runnable answers and self-evaluation checklists live separately in
[`solutions/`](solutions/) so independent learners can compare their work after attempting each
challenge. Week 08 includes a complete reference project for every template.

Labs and solutions now include circuit diagrams, histograms, Bloch views, and algorithm-specific
plots. Run their visual checkpoint cells to display the figures. See the
[visualization guide](VISUALIZATION_GUIDE.md) for interpretation, optional dependencies, and
troubleshooting. Text output and automated assertions remain available alongside every plot.

## Quick start

Install [`uv`](https://docs.astral.sh/uv/getting-started/installation/), then run these commands
from the repository root:

```bash
uv python install 3.11
uv sync --locked --extra notebooks
uv run --locked --extra notebooks jupyter lab
```

`uv sync` creates a repository-local `.venv` automatically and installs the versions recorded in
`uv.lock`. You do not need to create a virtual environment separately or activate it when using
`uv run`.

Open `week00_setup/lab.ipynb` and choose the Python 3 kernel. Confirm that the version cell reports
Qiskit `2.5.x`. In VS Code, select `.venv/bin/python` on macOS/Linux or
`.venv\Scripts\python.exe` on Windows.

Activation is optional if you prefer the traditional virtual-environment workflow:

```bash
source .venv/bin/activate          # macOS/Linux
.venv\Scripts\Activate.ps1         # Windows PowerShell
jupyter lab
```

If your organization does not permit `uv`, use the compatibility files instead:

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt -r requirements-notebooks.txt
jupyter lab
```

For contributors:

```bash
uv sync --locked --extra notebooks --extra dev
uv run --locked --extra notebooks --extra dev pytest
uv run --locked --extra notebooks --extra dev python scripts/validate_notebooks.py --execute
uv run --locked --extra notebooks --extra dev ruff check shared tests scripts
```

## Version strategy

- Python is `>=3.11` for a modern, consistent company environment.
- `.python-version` selects Python 3.11 for the course, while `uv.lock` records the exact resolved
  package versions across supported platforms. Commit both files.
- Qiskit is constrained to `>=2.5,<2.6`. This accepts bug-fix releases while preventing a
  future minor release from silently changing teaching output.
- Local labs use the V2 reference implementations `StatevectorSampler` and
  `StatevectorEstimator`; legacy `Sampler` and `Estimator` V1 APIs are not used.
- IBM Quantum Runtime is a separate optional `hardware` dependency extra.
  No course lab, test, or CI job needs an IBM account.

`pyproject.toml` is the dependency source of truth. The `requirements*.txt` files are retained only
as a `pip` fallback for environments where `uv` cannot be installed.

When intentionally upgrading the Qiskit minor version, update the constraint and run the full
notebook execution job before merging.

## Repository map

```text
.
├── week00_setup/ … week08_project/  # learner guides, labs, challenges
├── solutions/                       # reference answers and self-evaluation
├── certification/                   # separate exam-preparation track
├── bonus_ibm_quantum_hardware/      # optional account and real-QPU guide
├── shared/                           # small result-handling helpers
├── scripts/                          # notebook validation
├── tests/                            # example and utility tests
├── .python-version                  # local Python selection for uv
├── uv.lock                          # reproducible dependency resolution
├── INSTRUCTOR_GUIDE.md
├── VISUALIZATION_GUIDE.md
├── CONTRIBUTING.md
├── LICENSE
└── pyproject.toml                    # project and dependency configuration
```

## Suggested weekly workflow

1. Read that week's short README before the meeting.
2. In the session, predict before executing each marked experiment.
3. Change one thing at a time and explain the changed result to a partner.
4. Attempt the challenge without opening `solutions/`.
5. Restart/run all, record your result, then compare with the linked reference solution.
6. Complete the solution's self-evaluation checklist and record one remaining question.
7. Use optional homework only when it supports your learning goal.

Sessions are designed for 90 minutes: roughly 10 minutes of warm-up, 20 minutes of concepts,
40 minutes of lab, 15 minutes of challenge, and 5 minutes of wrap-up. See the
[instructor guide](INSTRUCTOR_GUIDE.md) for a fuller session plan and common misconceptions.

## Local simulation, Runtime, and real QPUs

These are different execution environments:

- **Local statevector primitives** run on your computer, are deterministic apart from sampling,
  and require no credentials. They power the core course.
- **IBM Quantum Runtime** is a cloud service accessed through the optional
  `qiskit-ibm-runtime` package. Its V2 primitives submit ISA circuits and observables.
- **Real QPUs** are hardware backends selected through Runtime. They have queueing, noise,
  connectivity, basis-gate, account, and usage constraints.

Never put an API token in a notebook, source file, or `.env` committed to Git. Follow the
current IBM Quantum account setup guide when an instructor offers an optional hardware demo. The
credential-safe [`bonus_ibm_quantum_hardware/`](bonus_ibm_quantum_hardware/) chapter provides a
guarded, end-to-end account, ISA circuit, job submission, monitoring, and retrieval workflow.

## Certification track

The [`certification/`](certification/) directory emphasizes API recall, code reading,
debugging, visualization, construction, execution, V2 result objects, observables, and
OpenQASM 3. It includes detailed original practice questions and a timed mock exam with a
separate answer key. Complete the main course first; the certification track is intentionally
not mixed into weekly sessions.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). In short: keep examples local-first, use modern V2
APIs, preserve the predict/run/observe/explain rhythm, and execute every changed lab or
solution. Never commit notebook secrets or real exam content.

## FAQ

**Is a quantum computer required?**
No. Everything except an explicitly optional hardware demonstration runs locally.

**Why do counts change between runs?**
Sampling returns individual outcomes. Frequencies fluctuate, especially with few shots, even
when the underlying probabilities do not change.

**Why are Qiskit bitstrings displayed "backwards"?**
For a register containing qubits `q0, q1`, Qiskit displays `q1q0`. Week 02 makes this concrete.

**Do I need to memorize matrices?**
No. Learn gate behavior by experiments first. Week 03 uses a few compact mathematical ideas
only to explain observations that code alone cannot reveal.

**Why not use Aer?**
The SDK's `StatevectorSampler` and `StatevectorEstimator` are sufficient for these small,
ideal circuits and teach the same V2 primitive shape used by other implementations.

**Does completing this guarantee certification?**
No. It gives a strong practical foundation. Exam scope and policies can change; always compare
the separate practice track with the current official exam information.

## Official resources

- [IBM Quantum Documentation](https://quantum.cloud.ibm.com/docs/)
- [Install Qiskit](https://quantum.cloud.ibm.com/docs/en/guides/install-qiskit)
- [Exact simulation with SDK primitives](https://quantum.cloud.ibm.com/docs/en/guides/simulate-with-qiskit-sdk-primitives)
- [Primitive inputs and outputs](https://quantum.cloud.ibm.com/docs/en/guides/primitive-input-output)
- [Transpile with pass managers](https://quantum.cloud.ibm.com/docs/en/guides/transpile-with-pass-managers)
- [OpenQASM 3 export and import](https://quantum.cloud.ibm.com/docs/en/guides/qasm-feature-table)
- [Qiskit API reference](https://quantum.cloud.ibm.com/docs/en/api/qiskit)

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
