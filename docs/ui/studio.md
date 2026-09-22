# Studio — R&D surface

**Status:** owner-directed implementation slice, 2026-07-14.

Studio is the durable editing and verification workspace for a saved artifact.
Its list view holds verified circuits and their evidence; the editor creates new
versions, edits code, previews the circuit, runs safe simulations/checks, and
saves the resulting evidence.

## Product contract

- `/library` is retired and redirects here. Its former action was opening a saved artifact in
  Studio or opening the context in Run; it never becomes an editor.
- `/studio?artifact=<id>` is addressable and refresh-safe. It loads the saved
  artifact, current code, provenance, and the current framework version.
- The editor is code-native and copyable. The circuit preview is a semantic
  SVG/HTML view, not a screenshot. Selecting a gate exposes its parameters in
  the inspector.
- The visual circuit editor offers exact-identity compression strategies and
  previews operation count, logical depth, and two-qubit operation count before
  applying a rewrite. Applying compression regenerates every supported
  framework draft; diverged source requires explicit replacement confirmation,
  and the result can be undone. Measurements and opaque custom gates remain
  rewrite boundaries on the qubits they touch. This surface does not claim
  hardware routing or device-native optimization.
- The compression panel can also queue a bounded circuit IR to the Worker for
  Qiskit, Cirq, pytket, PennyLane, PyZX, or BQSKit compilation. Studio sends no
  user source code in this lane, keeps the returned circuit as a preview until
  the user explicitly applies it, and then regenerates every framework draft.
  Inputs are limited to 64 qubits and 1,024 built-in operations; PyZX
  additionally accepts only its smaller Clifford+T-compatible subset. Compiler
  output is an equivalence claim up to global phase, not verification evidence.
  Applying it makes prior evidence stale and requires a fresh `Verify & save`
  run. The compilers execute in the sandbox rootfs, not in the Worker
  process (ai-ops#186): the Worker holds credentials and the sandbox holds
  none, and a sandbox timeout can actually stop a compile where cancelling
  a thread could not.
- `Simulate` opens an artifact-owned CPU surface. It executes only the parsed,
  bounded gate model in the browser for saved artifacts, then records the
  source fingerprint, inputs, and sampled result locally. It never starts
  Nala, claims verification, updates the saved version, or executes hardware.
  Unsupported source, export-only frameworks, unsaved drafts, and out-of-bound
  circuits fail closed with a visible reason. Re-runs require confirmation and
  append a new local record.
- `Parameter sweep` explores one angle gate on a synchronized visual circuit,
  including an unsaved draft. It computes the ideal probability of measuring
  one and the Pauli-Z expectation for a chosen qubit over 3–41 angles. The
  browser worker bounds this to 12 qubits, 512 operations, and a whole-sweep
  work budget. Mid-circuit measurement and opaque custom gates are refused.
  Results are temporary, with CSV and JSON downloads; the JSON includes the
  source and circuit snapshot. No shots, noise, hardware, verification, or
  saved artifact version are involved.
- `Verify & save` submits the edited code through the control plane's deny-all
  sandbox. UI success is only shown after typed run evidence arrives.
- QPU submission uses a stored interchange circuit, a backend estimate, and
  explicit confirmation. The GPU lane remains unavailable until its provider,
  cost, security, and confirmation contracts exist.
- `Save version` writes a new artifact version with a provenance edge to the
  parent artifact. Unsaved edits are marked as a draft and are never presented
  as verified.
- Qiskit is the default; explicit PennyLane or Cirq selection is preserved. A
  passing Execute run emits copyable native variants for every supported
  framework, with export status and caveats, and saves those variants on the
  artifact version so the list and the editor reopen the same set.

## Screen spec

The accepted Studio concept uses the existing Leona Quantum dark-first warm-gray
tokens: open layout, hairline dividers, JetBrains Mono for code and numerical
evidence, moss-green focus, and no gradients, glow, or decorative dashboard
metrics.

There is no Inspector region and no header `Simulate` button — both were replaced
(Owner Inbox 2026-07-31) when circuit selection details moved into a folded
gate-note disclosure on the Visual tab and Simulate/Copy code moved onto the tab
that owns each action, rather than sitting above a tab bar that already had them.

| Region | Required behavior |
|---|---|
| Header | Working-circuit title, draft/version status, verdict chip (hidden on the Summary tab, where the panel it summarizes is already visible), Download export, Save without running, `Verify & save`, and the Qapp disclosure |
| Tabs | `Code`, `Simulation`, `Visual`, `Summary`, in that pinned order |
| Code tab | Framework selector, copy action, editable source, and an "About these conversions" disclosure |
| Simulation tab | CPU lane (shots, seed, run control, ineligibility reasons with a sandbox-execution fallback), local parameter sweep, QPU lane (device selector, cost estimate, submission), and a list of local CPU simulation records |
| Visual tab | Gate palette, custom gates, circuit-sync banner, the circuit diagram, circuit-compression controls (local strategies shown directly; external-compiler queueing folded behind a closed-by-default disclosure), builder controls, and a folded gate-note disclosure for the selected gate |
| Summary tab | Circuit fact strip, evidence panel, version history, and a folded verification-contract disclosure |
| Responsive fallback | Single column at every width; the tab bar and its panel never force horizontal page overflow |

## Run modes

The user-facing choices are `Execute`, `Learn`, and `Explain`.

- `Execute` is the verified pipeline. Its stage rail is visible and moves to
  the top of the work area on the execute screen.
- `Learn` teaches the concept step by step and can answer broad educational
  prompts without inventing a circuit or claiming a run.
- `Explain` answers, explains, or reviews the supplied material directly. It
  may cite recorded evidence when an artifact is attached, but it does not
  silently create a verified artifact.

The existing `/v1` `ideate` enum value remains an internal compatibility value
for `Learn` until a versioned additive contract migration is approved; it is
never shown to users.

Mode is guidance, not a narrow classifier. A natural-language request such as
`Hi`, `what is quantum computing`, or `review this circuit` is answered in the
selected mode, while Execute can still classify whether the request needs a
quantum, quantum-inspired, or classical path.
