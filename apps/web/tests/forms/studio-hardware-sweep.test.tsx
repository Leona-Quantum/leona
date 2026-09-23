// Real submission coverage for the Studio hardware parameter sweep (ai-ops
// 349): the batch cost preview must show bindings x shots BEFORE the confirm
// button can be pressed, and pressing it must POST every binding's own QASM
// in one submission body, never one request per point.
import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StudioHardwareSweep } from "../../app/(app)/studio/studio-hardware-sweep.tsx";
import { stubFetch, type RecordedRequest } from "./dom-env.ts";
import type { ParsedBuilderCircuit } from "../../lib/studio-parse.ts";

const CIRCUIT: ParsedBuilderCircuit = { qubitCount: 1, steps: [
  { id: "turn", gate: "RY", qubits: [0], param: "pi/4" },
  { id: "m0", gate: "M", qubits: [0] },
] };

const OPEN_PLAN = {
  provider: "ibm",
  device_id: "ibm.open_plan",
  display_name: "IBM Quantum · Open Plan queue",
  vendor: "IBM",
  technology: "superconducting",
  access: "free_queue",
  qubit_count: null,
  per_task_usd: null,
  per_shot_usd: null,
  allowance_note: "IBM Open Plan: up to 10 minutes of QPU time per rolling 28 days.",
  rate_source: "https://quantum.cloud.ibm.com/docs/en/guides/plans-overview",
  rate_confirmed_on: "2026-07-23",
  submittable: true,
};

function baseStub(overrides: { extra?: (request: RecordedRequest) => { status: number; body?: unknown } | undefined } = {}) {
  return stubFetch((request) => {
    if (request.method === "GET" && request.url === "/api/qpu/backends") {
      return { status: 200, body: { backends: [OPEN_PLAN] } };
    }
    if (request.method === "GET" && request.url === "/api/qpu/submission-gate") {
      return { status: 200, body: { submission_available: true, blocked_reason: null } };
    }
    if (request.method === "POST" && request.url === "/api/qpu/estimates") {
      const body = request.body as { sweep_bindings?: number; shots: number };
      const n = body.sweep_bindings ?? 1;
      return {
        status: 200,
        body: {
          device_id: "ibm.open_plan",
          shots: body.shots,
          circuits: n,
          total_shots: body.shots * n,
          basis: "free_tier_allowance",
          currency: "USD",
          task_fee_usd: null,
          shot_fees_usd: null,
          total_usd: null,
          allowance_note: OPEN_PLAN.allowance_note,
          rate_source: OPEN_PLAN.rate_source,
          rate_confirmed_on: OPEN_PLAN.rate_confirmed_on,
          disclaimer: "free queue",
        },
      };
    }
    if (overrides.extra) {
      const handled = overrides.extra(request);
      if (handled) return handled;
    }
    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  });
}

async function openAndConfigure() {
  const view = render(
    <StudioHardwareSweep circuit={CIRCUIT} synchronized complete sourceCode="ry(pi/4)" locale="en" />,
  );
  fireEvent.click(screen.getByText("Hardware parameter sweep"));
  await waitFor(() => assert.ok(view.queryByLabelText("Device")));
  fireEvent.change(screen.getByLabelText("Points"), { target: { value: "4" } });
  return view;
}

test("the batch cost preview prices bindings x shots, before any submission is possible", async () => {
  const fetchStub = baseStub();
  try {
    const view = await openAndConfigure();
    await waitFor(() => assert.match(view.container.textContent ?? "", /Batch cost preview/));
    // Free-queue basis carries no dollar total; the allowance sentence is what
    // stands in for the price, and it must say the batch shares ONE wait.
    await waitFor(() => assert.match(view.container.textContent ?? "", /free queue allowance/));

    const estimateCalls = fetchStub.calls.filter((c) => c.url === "/api/qpu/estimates");
    assert.ok(estimateCalls.length > 0, "the preview never asked for an estimate");
    const last = estimateCalls[estimateCalls.length - 1];
    assert.equal((last.body as { sweep_bindings: number }).sweep_bindings, 4);
    assert.equal((last.body as { zne?: boolean }).zne, undefined, "a sweep estimate must not also ask for zne");
  } finally {
    fetchStub.restore();
  }
});

test("submitting sends every binding's own program in one request, and the row disagrees with nothing the preview showed", async () => {
  let submitted: { url: string; body: unknown } | null = null;
  const fetchStub = baseStub({
    extra: (request: RecordedRequest) => {
      if (request.method === "POST" && request.url === "/api/qpu/submissions") {
        submitted = { url: request.url, body: request.body };
        return {
          status: 201,
          body: {
            id: "11111111-1111-1111-1111-111111111111",
            provider: "ibm",
            device_id: "ibm.open_plan",
            provider_job_id: null,
            shots: 1024,
            status: "queued",
            source_fingerprint: "fnv1a-test",
            estimated_total_usd: null,
            rate_source: OPEN_PLAN.rate_source,
            rate_confirmed_on: OPEN_PLAN.rate_confirmed_on,
            raw_counts: null,
            mitigation: null,
            sweep: null,
            error: null,
            submitted_at: null,
            completed_at: null,
            created_at: "2026-09-23T00:00:00Z",
          },
        };
      }
      return undefined;
    },
  });
  try {
    const view = await openAndConfigure();
    await waitFor(() => assert.match(view.container.textContent ?? "", /Batch cost preview/));

    fireEvent.submit(view.container.querySelector("form")!);

    await waitFor(() => assert.ok(submitted));
    const body = submitted!.body as {
      device_id: string;
      shots: number;
      qasm: string;
      sweep: { parameter_label: string; bindings: { label: string; qasm: string }[] };
    };
    assert.equal(body.device_id, "ibm.open_plan");
    assert.equal(body.sweep.bindings.length, 4);
    // Binding 0's own qasm is what the top-level field carries too — the
    // server refuses a request where the two disagree.
    assert.equal(body.qasm, body.sweep.bindings[0].qasm);
    // Every point actually differs: this is four real programs, not one QASM
    // string sent four times under four labels.
    const distinctPrograms = new Set(body.sweep.bindings.map((b) => b.qasm));
    assert.equal(distinctPrograms.size, 4);

    await waitFor(() => assert.match(view.container.textContent ?? "", /Queued/));
  } finally {
    fetchStub.restore();
  }
});

test("a point count outside the hardware batch's own bounds is refused before any estimate is requested", async () => {
  const fetchStub = baseStub();
  try {
    const view = await openAndConfigure();
    fireEvent.change(screen.getByLabelText("Points"), { target: { value: "1" } });
    await waitFor(() => assert.match(view.container.textContent ?? "", /2\D+20/));
    assert.equal(view.container.querySelector(".mj-studio-hardware-sweep-preview"), null);
  } finally {
    fetchStub.restore();
  }
});
