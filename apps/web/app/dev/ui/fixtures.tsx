"use client";

// Route fixtures (spec §5 step 2 — Storybook alternative): every rail state, every
// verdict banner, the designed empty state. Screenshot source for PR review + the
// axe-core / visual-diff checks when Playwright lands.
import { EmptyState, RunView, StageRail, VerdictBanner, type RailStage } from "@majorana/ui";
import { RUN_FIXTURES } from "../../(app)/run/[taskId]/fixtures";
import { CircuitDiagram } from "../../../components/circuit-diagram";
import { reconstructInterchangeCircuit } from "../../../lib/circuit-conversion";
import { CIRCUIT_FRAMEWORKS } from "../../../lib/circuit-frameworks";
import { studioDraftBundle, type StudioDraftArtifact } from "../../../lib/studio-drafts";
import { DETAIL_COPY, MeasuredResultPanel } from "../../(app)/library/[artifactId]/artifact-detail";
import { CompletedAssistant, type Turn } from "../../(app)/run/[taskId]/live-run";
import { measuredResultFromMetadata } from "../../../lib/measured-result";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";

/** A GHZ state on `n` qubits as interchange OpenQASM 3. */
function ghzQasm(n: number): string {
  return [
    "OPENQASM 3.0;",
    'include "stdgates.inc";',
    `qubit[${n}] q;`,
    `bit[${n}] c;`,
    "h q[0];",
    ...Array.from({ length: n - 1 }, (_, i) => `cx q[0], q[${i + 1}];`),
    ...Array.from({ length: n }, (_, i) => `c[${i}] = measure q[${i}];`),
  ].join("\n");
}

/** Render whatever the artifact-detail view would render for this QASM.
 *
 * Deliberately goes through `reconstructInterchangeCircuit` rather than taking
 * a pre-built circuit, so these fixtures exercise the same parse → discriminate
 * → draw path the real page uses. A wide circuit here is the only place the
 * read-only branch can be seen without a seeded artifact from the control
 * plane, which a local dev server cannot reach. */
function DiagramFixture({ qasm, title }: { qasm: string; title: string }) {
  const result = reconstructInterchangeCircuit(qasm);
  return (
    <section>
      <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>{title}</h2>
      {result.kind === "ok" ? (
        <CircuitDiagram
          qubitCount={result.circuit.qubitCount}
          steps={result.circuit.steps}
          customGates={[]}
          ariaLabel={title}
        />
      ) : result.kind === "too_large" ? (
        <p className="mj-artifact-copy">
          Too large to draw ({result.qubitCount} qubits, {result.stepCount} operations).
        </p>
      ) : (
        <p className="mj-artifact-copy">No drawable OpenQASM 3.</p>
      )}
    </section>
  );
}

/** The artifact panel that carries what the program measured.
 *
 * Goes through `measuredResultFromMetadata` on a metadata blob shaped exactly as
 * the worker stores it, so this exercises the real parse rather than a
 * hand-built view model — a local dev server cannot reach the control plane, and
 * this panel only appears for an artifact saved by a real run. */
function MeasuredResultFixture({ title, metadata }: { title: string; metadata: unknown }) {
  return (
    <section>
      <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>{title}</h2>
      <div className="mj-artifact-grid">
        <MeasuredResultPanel measured={measuredResultFromMetadata(metadata)} copy={DETAIL_COPY.en} />
      </div>
    </section>
  );
}

/** One finished conversation turn, rendered by the component the Run page uses.
 *
 * These exist because a chat answer was being replaced on screen by an empty
 * "Deliverable / Final Output / Quantum circuit run" card: `runResultFromEvents`
 * returned a view for any non-cancelled `run.finished`, and both render sites
 * prefer that view to the text. Going through the real `CompletedAssistant`
 * rather than asserting on the view model is the point — the defect lived in
 * which branch won, not in either branch. */
function ChatTurnFixture({ title, turn }: { title: string; turn: Turn }) {
  return (
    <section>
      <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>{title}</h2>
      <div className="mj-chat-thread">
        <div className="mj-chat-turn">
          <div className="mj-chat-message mj-chat-message--user">{turn.prompt}</div>
          <CompletedAssistant turn={turn} />
        </div>
      </div>
    </section>
  );
}

/** Events a conversation run really emits, in wire shape (flat, not wrapped). */
function chatTurn(id: string, prompt: string, answer: string): Turn {
  return {
    id,
    prompt,
    answer,
    events: [
      { run_id: id, type: "run.queued", mode: "auto" },
      { run_id: id, type: "run.mode_resolved", requested: "auto", resolved: "chat" },
      { run_id: id, type: "run.started" },
      { run_id: id, type: "chat.completed", text: answer },
      { run_id: id, type: "run.finished", status: "succeeded" },
    ] as Turn["events"],
    verificationSummary: null,
    terminal: true,
  };
}

// Verbatim from production run 019f9ea6-ef13-7ea5-83a4-bd08b4af9764 ("ベル状態とは
// 何ですか？"). Kept as the model actually wrote it: a GFM table, inline `$…$`
// math, a fenced ASCII circuit, and a horizontal rule in one answer.
const JA_BELL_ANSWER = `ベル状態（Bell state）は、2量子ビットの**最大エンタングル状態**の4つの基底です。

## 4つのベル状態

| 状態 | 数式 | よく使う記号 |
|------|------|-------------|
| $|\\Phi^+\\rangle$ | $\\frac{1}{\\sqrt{2}}(|00\\rangle + |11\\rangle)$ | ベル状態 |
| $|\\Phi^-\\rangle$ | $\\frac{1}{\\sqrt{2}}(|00\\rangle - |11\\rangle)$ | |
| $|\\Psi^+\\rangle$ | $\\frac{1}{\\sqrt{2}}(|01\\rangle + |10\\rangle)$ | |
| $|\\Psi^-\\rangle$ | $\\frac{1}{\\sqrt{2}}(|01\\rangle - |10\\rangle)$ | 一重項状態 |

## 生成回路

\`\`\`
q0: ──H──●──
          │
q1: ─────X──
\`\`\`

---

**Execute**で依頼すれば、実際のシミュレーション結果を確認できます。`;

const EN_TABLE_ANSWER = `Both are fine choices — they differ in what they optimise for.

| Framework | Best at | Watch out for |
|---|---|---|
| Qiskit | hardware-facing work, transpilation | verbose primitives API |
| PennyLane | differentiable circuits, QML | slower for large shot counts |
| Cirq | explicit moment/scheduling control | smaller gate library |

Display math still has to render beside a table:

\\[ |\\Phi^+\\rangle = \\frac{1}{\\sqrt{2}}\\left(|00\\rangle + |11\\rangle\\right) \\]

I cannot run anything from this turn — ask in **Execute** to get measured counts.`;

const WIDE_HISTOGRAM = Object.fromEntries(
  Array.from({ length: 64 }, (_, index) => [index.toString(2).padStart(10, "0"), 64 - index]),
);

const MID_RUN: RailStage[] = [
  { id: "plan", name: "Plan", state: "pass", elapsed: "2.1 s" },
  { id: "generate", name: "Generate", state: "pass", elapsed: "8.4 s" },
  { id: "verify", name: "Verify", state: "pending" },
  { id: "analyze", name: "Analysis", state: "pending" },
];

const FAILED_RUN: RailStage[] = [
  { id: "plan", name: "Plan", state: "pass", elapsed: "1.8 s" },
  { id: "generate", name: "Generate", state: "pass", elapsed: "7.2 s" },
  {
    id: "verify",
    name: "Verify",
    state: "fail",
    elapsed: "1.1 s",
    errorSummary: "Statistical check failed: TVD 0.21 > δ 0.05 (seed 42, 4096 shots)",
  },
  { id: "analyze", name: "Analysis", state: "pending" },
];

/**
 * What the Studio framework picker actually holds for one artifact, and whether
 * the canvas can draw it — the two things that used to fail silently. The local
 * dev server cannot reach the control plane, so these run the real
 * studioDraftBundle over inlined records instead of a live artifact.
 */
function DraftBundleFixture({ title, artifact }: { title: string; artifact: StudioDraftArtifact }) {
  const bundle = studioDraftBundle(artifact, WORKSPACE_COPY.en.studio);
  const seed = reconstructInterchangeCircuit(bundle.codes.openqasm3 || "");
  return (
    <section data-testid={`draft-bundle-${title.replaceAll(/\W+/g, "-").toLowerCase()}`}>
      <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>{title}</h2>
      <ul className="mj-artifact-copy" style={{ display: "grid", gap: "var(--sp-1)" }}>
        {CIRCUIT_FRAMEWORKS.map(({ key, label }) => {
          const code = bundle.codes[key];
          const via = bundle.fallbacks[key];
          const state = !code ? "EMPTY" : via ? `source reference (${via})` : "conversion";
          return (
            <li key={key} data-framework={key} data-state={state}>
              <strong>{label}</strong> — {state}
              {code ? ` · ${code.split("\n").length} lines` : ""}
            </li>
          );
        })}
      </ul>
      {seed.kind === "ok" ? (
        <CircuitDiagram
          qubitCount={seed.circuit.qubitCount}
          steps={seed.circuit.steps}
          customGates={[]}
          ariaLabel={`${title} canvas`}
        />
      ) : (
        <p className="mj-artifact-copy">Canvas: no drawable circuit ({seed.kind}).</p>
      )}
    </section>
  );
}

const LLM_QISKIT = `from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator

def build_circuit():
    qc = QuantumCircuit(3, 3)
    qc.h(0)
    qc.cx(0, 1)
    qc.cx(1, 2)
    qc.measure([0, 1, 2], [0, 1, 2])
    return qc

FINAL_CIRCUIT = build_circuit()
sim = AerSimulator()
RESULT = {"counts": sim.run(transpile(FINAL_CIRCUIT, sim), shots=2048).result().get_counts()}
`;

const WIDE_QISKIT = [
  "from qiskit import QuantumCircuit",
  "",
  "qc = QuantumCircuit(8)",
  "qc.h(0)",
  ...Array.from({ length: 7 }, (_, index) => `qc.cx(${index}, ${index + 1})`),
  "qc.measure_all()",
].join("\n");

/** A finished execute run, as the wire really reports one.
 *
 * Guards the other half of the same branch: the chat fix must not have taken the
 * Final Output card away from a run that genuinely produced something. No
 * `artifact.saved`, so `RunCodeExport` stays on its fallback path — which is the
 * path that has to survive a control plane the local dev server cannot reach. */
const EXECUTE_TURN: Turn = {
  id: "run-ghz",
  prompt: "Build a 3-qubit GHZ state and measure all qubits",
  answer: null,
  events: [
    { run_id: "run-ghz", type: "run.queued", mode: "execute" },
    {
      run_id: "run-ghz",
      type: "plan.produced",
      plan: {
        problem_summary: "Prepare a 3-qubit GHZ state and measure every qubit",
        algorithm: "GHZ",
        framework: "qiskit",
        expected_output_keys: ["counts"],
      },
    },
    { run_id: "run-ghz", type: "code.generated", revision: 1, code: LLM_QISKIT, language: "python" },
    { run_id: "run-ghz", type: "sandbox.result", result: { counts: { "000": 508, "111": 516 } } },
    { run_id: "run-ghz", type: "run.finished", status: "succeeded" },
  ] as Turn["events"],
  verificationSummary: null,
  terminal: true,
};

export function UiFixtures() {
  return (
    <div style={{ display: "grid", gap: "var(--sp-8)" }}>
      <ChatTurnFixture
        title="Chat turn — Japanese answer with a GFM table (must show TEXT, never a Final Output card)"
        turn={chatTurn("chat-ja", "ベル状態とは何ですか？", JA_BELL_ANSWER)}
      />
      <ChatTurnFixture
        title="Chat turn — table + display math"
        turn={chatTurn("chat-en", "Should I use Qiskit or PennyLane?", EN_TABLE_ANSWER)}
      />
      <ChatTurnFixture
        title="Chat turn — answer text missing (honest fallback, not loading dots)"
        turn={{ ...chatTurn("chat-empty", "hi", ""), answer: null }}
      />
      <ChatTurnFixture
        title="Execute turn — MUST still show Final Output (histogram, values, code)"
        turn={EXECUTE_TURN}
      />

      <DraftBundleFixture
        title="Draft bundle — LLM run with stored interchange"
        artifact={{ framework: "qiskit", code: LLM_QISKIT, qasm: ghzQasm(3) }}
      />
      <DraftBundleFixture
        title="Draft bundle — LLM run whose export never ran"
        artifact={{ framework: "qiskit", code: LLM_QISKIT, qasm: null }}
      />
      <DraftBundleFixture
        title="Draft bundle — 8 qubits, editable beyond the former limit"
        artifact={{ framework: "qiskit", code: WIDE_QISKIT, qasm: null }}
      />

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>
          Stage rail — mid-run (pass / running / pending)
        </h2>
        <div style={{ display: "flex", minHeight: "320px" }}>
          <StageRail stages={MID_RUN} onSelect={() => {}} />
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>
          Stage rail — failed run (fail + retry / skipped-with-reason)
        </h2>
        <div style={{ display: "flex", minHeight: "320px" }}>
          <StageRail stages={FAILED_RUN} onSelect={() => {}} onRetry={() => {}} />
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>Verdict banners</h2>
        <div style={{ display: "grid", gap: "var(--sp-3)" }}>
          <VerdictBanner
            verdict="verified"
            detail="Verified — statistical (TVD 0.0088 ≤ δ 0.05) · seed 42 · 4096 shots"
          />
          <VerdictBanner
            verdict="structural_only"
            detail="return_contract only — no check compared this circuit against the expected physics"
          />
          <VerdictBanner
            verdict="verified_caveats"
            detail="Contract checks passed; statistical check skipped — statevector output"
          />
          <VerdictBanner
            verdict="not_verified"
            detail="No verification method applies to this task class"
          />
          <VerdictBanner
            verdict="failed"
            detail="Statistical check failed: TVD 0.21 > δ 0.05 · seed 42 · 4096 shots"
          />
        </div>
      </section>

      <DiagramFixture qasm={ghzQasm(3)} title="Circuit diagram — narrow (3q GHZ)" />
      <DiagramFixture
        qasm={ghzQasm(10)}
        title="Circuit diagram — editable, wider than the former builder (10q GHZ)"
      />
      <DiagramFixture
        qasm={ghzQasm(80)}
        title="Circuit diagram — virtualized wide view (80q GHZ)"
      />

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>Empty state</h2>
        <EmptyState
          message="Nothing verified yet. Your first verified run will appear here."
          action={{ label: "Start a run", href: "/run" }}
        />
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>
          Budget exhausted — best effort, unverified
        </h2>
        <RunView
          events={RUN_FIXTURES["demo-exhausted"]}
          emptyMessage="Waiting for the pipeline…"
        />
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>
          Statistical check skipped — structural pass
        </h2>
        <RunView
          events={RUN_FIXTURES["demo-skipped"]}
          emptyMessage="Waiting for the pipeline…"
        />
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-16)", fontWeight: 500 }}>
          Live prose — typed reveal
        </h2>
        <RunView
          events={RUN_FIXTURES["demo-verified"]}
          animateText
          emptyMessage="Waiting for the pipeline…"
        />
      </section>
      <MeasuredResultFixture
        title="Measured result — Bell state, saved artifact"
        metadata={{ measured_result: { counts: { "00": 529, "11": 495 }, shots: 1024, outcome_count: 2, truncated: false } }}
      />

      <MeasuredResultFixture
        title="Measured result — wide histogram, truncated to the heaviest outcomes"
        metadata={{ measured_result: { counts: WIDE_HISTOGRAM, shots: 8192, outcome_count: 412, truncated: true } }}
      />

      <MeasuredResultFixture
        title="Measured result — scalars only (VQE-shaped run)"
        metadata={{ measured_result: { values: { ground_state_energy: -1.137, iterations: 42 } } }}
      />

      <MeasuredResultFixture
        title="Measured result — artifact saved before the field existed (renders nothing)"
        metadata={{ source: "simple_pipeline_candidate" }}
      />

    </div>
  );
}
