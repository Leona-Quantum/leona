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
- `Simulate` opens an artifact-owned CPU surface. It executes only the parsed,
  bounded gate model in the browser for saved artifacts, then records the
  source fingerprint, inputs, and sampled result locally. It never starts
  Nala, claims verification, updates the saved version, or executes hardware.
  Unsupported source, export-only frameworks, unsaved drafts, and out-of-bound
  circuits fail closed with a visible reason. Re-runs require confirmation and
  append a new local record.
- `Verify & save` submits the edited code through the control plane's deny-all
  sandbox. UI success is only shown after typed run evidence arrives.
- GPU and QPU lanes can be shown as unavailable roadmap controls only. They
  become actionable after their provider, cost, security, and confirmation
  contracts exist.
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

| Region | Required behavior |
|---|---|
| Header | `Studio`, artifact breadcrumb, framework selector, `Simulate`, `Verify & save` |
| Code pane | Editable source, copy action, framework/version tabs, dirty-state indicator |
| Circuit pane | Qubit wires, semantic gates, selection, pan/zoom affordances, parameter selection |
| Inspector | `Circuit`, `Resources`, `Verification` tabs; selected-gate details and evidence |
| Simulation pane | CPU eligibility, inputs, artifact-owned local result records, rerun confirmation, and unavailable GPU/QPU lanes. A local CPU result is never styled as verification or hardware evidence. |
| Responsive fallback | Stack code, circuit, inspector, and output in that order; no horizontal page overflow |

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
