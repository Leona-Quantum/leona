import "./dom-env.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { RunWorkspace, type RunPlanner } from "../../app/(app)/run/run-workspace.tsx";
import { LAYER_GRAPH } from "../../lib/repository/layer-graph.ts";
import { slimLayerGraph } from "../../lib/workflow-planner/graph.ts";
import { leanPlannerGraph } from "../../lib/workflow-planner/lean.ts";
import { stubFetch, type RecordedRequest } from "./dom-env.ts";

const PLANNER: RunPlanner = { graph: leanPlannerGraph(slimLayerGraph(LAYER_GRAPH, "en")), exampleTitles: {} };
const RSA = "Factor a 2048-bit RSA modulus.";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
});

function runCalls(calls: RecordedRequest[]) {
  return calls.filter((call) => call.url === "/api/runs" && call.method === "POST");
}

async function submit(prompt: string, planner?: RunPlanner, responder?: (request: RecordedRequest) => { status: number; body?: unknown }) {
  const stub = stubFetch(responder ?? (() => ({ status: 201, body: { id: "run-1" } })));
  const view = render(<RunWorkspace planner={planner} />);
  fireEvent.change(view.getByRole("textbox", { name: "Message" }), { target: { value: prompt } });
  await act(async () => {
    fireEvent.submit(view.container.querySelector("form")!);
  });
  return { view, stub };
}

test("a prompt the planner recognises reaches Nala with its cited workflow, and the cue says so", async () => {
  const { view, stub } = await submit(RSA, PLANNER);
  try {
    await waitFor(() => assert.equal(runCalls(stub.calls).length, 1));
    const body = runCalls(stub.calls)[0].body as { task_prompt: string; workflow_context?: { problem: string; costs: { id: string; source: string | null }[] } };
    assert.equal(body.task_prompt, RSA);
    assert.equal(body.workflow_context?.problem, "factoring");
    const qubits = body.workflow_context?.costs.find((c) => c.id === "ge2021-qubits");
    assert.equal(qubits?.source, "arxiv:1905.09749, abstract");
    assert.match(view.container.textContent ?? "", /Nala plans with that workflow and its cited costs/);
  } finally {
    stub.restore();
  }
});

test("a prompt the planner does not recognise is sent exactly as before", async () => {
  const { stub } = await submit("Build a Bell state and verify it.", PLANNER);
  try {
    await waitFor(() => assert.equal(runCalls(stub.calls).length, 1));
    assert.equal("workflow_context" in (runCalls(stub.calls)[0].body as object), false);
  } finally {
    stub.restore();
  }
});

test("without the planner (the public demo, or a page that never passed it) nothing extra is sent and the cue promises nothing", async () => {
  const { view, stub } = await submit(RSA);
  try {
    await waitFor(() => assert.equal(runCalls(stub.calls).length, 1));
    assert.equal("workflow_context" in (runCalls(stub.calls)[0].body as object), false);
    assert.doesNotMatch(view.container.textContent ?? "", /Nala plans with/);
  } finally {
    stub.restore();
  }
});

test("an API that predates the field refuses it, and the run is sent again without it rather than failing", async () => {
  const { stub } = await submit(RSA, PLANNER, (request) => {
    const body = request.body as Record<string, unknown>;
    if (request.url !== "/api/runs") return { status: 404 };
    return "workflow_context" in body
      ? { status: 422, body: { detail: [{ type: "extra_forbidden", loc: ["body", "workflow_context"], msg: "Extra inputs are not permitted" }] } }
      : { status: 201, body: { id: "run-2" } };
  });
  try {
    await waitFor(() => assert.equal(runCalls(stub.calls).length, 2));
    const [first, second] = runCalls(stub.calls);
    assert.equal("workflow_context" in (first.body as object), true);
    assert.equal("workflow_context" in (second.body as object), false);
    assert.notEqual(first.headers["Idempotency-Key"], second.headers["Idempotency-Key"]);
  } finally {
    stub.restore();
  }
});

test("a 422 about something else is not retried", async () => {
  const { view, stub } = await submit(RSA, PLANNER, () => ({ status: 422, body: { detail: "task_prompt is too long" } }));
  try {
    await waitFor(() => assert.ok(view.getByRole("alert")));
    assert.equal(runCalls(stub.calls).length, 1);
  } finally {
    stub.restore();
  }
});
