import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { CircuitBuilder } from "../../app/(app)/studio/studio-workspace.tsx";
import type { BuilderCodeVariants, BuilderStep, CustomGateDefinition } from "../../lib/studio-builder.ts";
import { WORKSPACE_COPY } from "../../lib/workspace-locale.ts";
import { stubFetch } from "./dom-env.ts";

const copy = WORKSPACE_COPY.en.studio;

const REDUNDANT_STEPS: BuilderStep[] = [
  { id: "h-a", gate: "H", qubits: [0] },
  { id: "x", gate: "X", qubits: [1] },
  { id: "h-b", gate: "H", qubits: [0] },
];

function renderCompressionBuilder(steps = REDUNDANT_STEPS, syncState: { kind: "in_sync" | "diverged" | "unrepresentable" } = { kind: "in_sync" }) {
  const changes: { steps: BuilderStep[] }[] = [];
  const applied: BuilderCodeVariants[] = [];
  const view = render(
    <CircuitBuilder
      seed={{
        key: "compression-seed",
        artifactIdentity: null,
        qubitCount: 2,
        steps,
        customGates: [] as CustomGateDefinition[],
        readOnly: false,
        readOnlyReasons: [],
        operationCount: steps.length,
      }}
      framework="qiskit"
      selectedGate="H"
      onSelectGate={() => {}}
      onApply={(codes) => applied.push(codes)}
      onCircuitChange={(circuit) => changes.push(circuit)}
      hidden={false}
      popout={false}
      onTogglePopout={() => {}}
      copy={copy}
      syncState={syncState}
      onRebuildFromCode={() => {}}
      sourceCode=""
    />,
  );
  assert.ok(view.container.querySelector("section.mj-studio-optimizer"));
  return { ...view, changes, applied };
}

function openLocalCompression(view: ReturnType<typeof renderCompressionBuilder>) {
  fireEvent.click(view.getByRole("tab", { name: new RegExp(copy.optimizationLocal) }));
}

test("Studio compression previews, applies to every framework draft, and can be undone", async () => {
  const view = renderCompressionBuilder();
  openLocalCompression(view);

  assert.ok(view.getByRole("radio", { name: new RegExp(copy.compressionBalanced) }).hasAttribute("checked"));
  fireEvent.click(view.getByRole("button", { name: copy.compressionApply }));

  await waitFor(() => assert.ok(view.changes.some((change) => change.steps.length === 1)));
  assert.deepEqual(view.changes.find((change) => change.steps.length === 1)!.steps, [
    { id: "x", gate: "X", qubits: [1] },
  ]);
  assert.equal(view.applied.length, 1);
  assert.match(view.applied[0].qiskit, /qc\.x\(1\)/);
  assert.doesNotMatch(view.applied[0].qiskit, /qc\.h\(/);
  assert.ok(view.getByText(copy.compressionApplied(2, 2, 1)));

  fireEvent.click(view.getByRole("button", { name: copy.compressionUndo }));
  await waitFor(() => assert.equal(view.applied.length, 2));
  await waitFor(() => assert.ok(view.changes.some((change) => change.steps.length === 3)));
  assert.match(view.applied[1].qiskit, /qc\.h\(0\)/);
  assert.match(view.applied[1].qiskit, /qc\.x\(1\)/);
  assert.ok(view.getByText(copy.compressionUndone));
});

test("Studio compression disables application when the selected strategy has no exact rewrite", () => {
  const view = renderCompressionBuilder([
    { id: "h", gate: "H", qubits: [0] },
    { id: "x", gate: "X", qubits: [0] },
  ]);
  openLocalCompression(view);

  assert.ok(view.getByText(copy.compressionNoChange));
  assert.equal((view.getByRole("button", { name: copy.compressionApply }) as HTMLButtonElement).disabled, true);
});

test("Studio compression confirms before replacing code that no longer matches the diagram", () => {
  const view = renderCompressionBuilder(REDUNDANT_STEPS, { kind: "diverged" });
  openLocalCompression(view);

  fireEvent.click(view.getByRole("button", { name: copy.compressionApply }));
  assert.equal(view.applied.length, 0);
  assert.ok(view.getByText(copy.compressionOverwrite));

  fireEvent.click(view.getByRole("button", { name: copy.compressionConfirmApply }));
  assert.equal(view.applied.length, 1);
  assert.match(view.applied[0].qiskit, /qc\.x\(1\)/);
});

test("Studio queues an external compiler, previews its result, and applies it explicitly", async () => {
  const originalEventSource = globalThis.EventSource;
  const fakeFetch = stubFetch(() => ({ status: 201, body: { id: "external-run" } }));
  const sources: FakeEventSource[] = [];
  class FakeEventSource {
    readonly url: string;
    onerror: ((event: Event) => unknown) | null = null;
    private readonly listeners = new Map<string, ((event: Event) => void)[]>();

    constructor(url: string | URL) {
      this.url = String(url);
      sources.push(this);
    }

    addEventListener(type: string, listener: (event: Event) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    close() {}

    emit(type: string, payload: unknown) {
      const event = new MessageEvent(type, { data: JSON.stringify(payload) });
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
  }
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;

  try {
    const view = renderCompressionBuilder();
    assert.equal(view.getAllByRole("radio").length, 6);
    assert.equal(view.getByRole("tab", { name: new RegExp(copy.optimizationExternal) }).getAttribute("aria-selected"), "true");
    fireEvent.click(view.getByRole("radio", { name: new RegExp(copy.externalBqskit) }));
    fireEvent.click(view.getByRole("button", { name: copy.externalRunSelected("BQSKit") }));

    await waitFor(() => assert.equal(fakeFetch.calls.length, 1));
    assert.deepEqual(fakeFetch.calls[0].body, {
      task_prompt: "Compile the bounded Studio circuit with bqskit.",
      mode: "execute",
      framework: "qiskit",
      circuit_optimization: {
        compiler: "bqskit",
        qubit_count: 2,
        optimization_level: 2,
        operations: [
          { gate: "H", qubits: [0], angle_radians: null },
          { gate: "X", qubits: [1], angle_radians: null },
          { gate: "H", qubits: [0], angle_radians: null },
        ],
      },
    });
    await waitFor(() => assert.equal(sources.length, 1));
    assert.equal(sources[0].url, "/api/runs/external-run/events/stream");

    await act(async () => {
      sources[0].emit("compilation.result", {
        type: "compilation.result",
        accepted: true,
        compatibility: {
          circuit_optimization: {
            compiler: "bqskit",
            compiler_version: "1.2.1",
            optimization_level: 2,
            operations: [{ gate: "X", qubits: [1], angle_radians: null }],
            before: { qubits: 2, depth: 2, gate_count: 3, two_qubit_gate_count: 0, measurement_count: 0, estimated_runtime_ms: null },
            after: { qubits: 2, depth: 1, gate_count: 1, two_qubit_gate_count: 0, measurement_count: 0, estimated_runtime_ms: null },
            input_fingerprint: "a".repeat(64),
            output_fingerprint: "b".repeat(64),
            equivalence: "unitary_up_to_global_phase",
            warnings: ["Compiler output is not verification evidence."],
          },
        },
      });
    });

    await waitFor(() => assert.ok(view.getByText(copy.externalPreview("BQSKit", "1.2.1"))));
    assert.equal(view.applied.length, 0);
    fireEvent.click(view.getByRole("button", { name: copy.externalApply }));

    await waitFor(() => assert.equal(view.applied.length, 1));
    assert.match(view.applied[0].qiskit, /qc\.x\(1\)/);
    assert.doesNotMatch(view.applied[0].qiskit, /qc\.h\(/);
    await waitFor(() => assert.ok(view.changes.some((change) => change.steps.length === 1)));
  } finally {
    fakeFetch.restore();
    globalThis.EventSource = originalEventSource;
  }
});
