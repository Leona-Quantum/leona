// The notebook "Run on hardware" card, rendered inside the real NotebookView and
// clicked through against a stubbed BFF. What these pin: nothing is ever sent without
// the confirm click, one click sends exactly one submission (the route takes no
// idempotency key), the body carries the notebook fingerprint, a missing IBM key
// points at the account page, and a finished run comes back after a reload.
//
// Polling a queued run to `done` is not driven here — it runs on a 10 s interval —
// and is covered by the reducer tests in lib/notebook-hardware.test.ts instead.
import "./dom-env.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { NotebookView } from "../../components/notebook-view.tsx";
import { clearRecentQpuRuns } from "../../lib/notebook-hardware.ts";
import { notebookCellViews } from "../../lib/notebook-view.ts";
import { stubFetch, type RecordedRequest } from "./dom-env.ts";

const NOTEBOOK = "01a0d0f3-b812-77d4-a642-b09b62188874";
const SEQ = 3;
const QASM = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nbit[2] meas;\nqubit[2] q;\nh q[0];\ncx q[0], q[1];\nmeas[0] = measure q[0];\nmeas[1] = measure q[1];\n';
const DIGEST = createHash("sha256").update(QASM).digest("hex").slice(0, 12);
const FINGERPRINT = `notebook:${NOTEBOOK}:v${SEQ}:c02:${DIGEST}`;

const CELL_DEFAULTS = { tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null, property: null };
const CELLS = [
  { id: "c01", kind: "markdown" as const, role: "objective" as const, source: "# Run a Bell pair", ...CELL_DEFAULTS },
  { id: "c02", kind: "code" as const, role: "run" as const, source: "leona_submit(bell, shots=256)", ...CELL_DEFAULTS },
];

function reportWith(status: "ok" | "error" = "ok") {
  return {
    notebook_slug: "bell",
    ok: status === "ok",
    runner: "sandbox" as const,
    duration_ms: 10,
    environment: {},
    dropped_bytes: 0,
    note: "",
    cells: [
      {
        id: "c02",
        status,
        stdout: "",
        stderr: "",
        outputs: [{ mime: "text/plain" as const, data: "Hardware request recorded: 2 qubits, 256 shots. Choose a device under this cell to run it.", truncated: false, original_bytes: null }],
        error: status === "error" ? { ename: "ValueError", evalue: "boom", traceback: [] } : null,
        duration_ms: 5,
        execution_count: 1,
        note: "",
        check: null,
        cache_key: null,
        cached_from_seq: null,
        hardware_requests: [{ qasm: QASM, shots: 256, num_qubits: 2, label: "bell pair" }],
      },
    ],
  };
}

const BACKENDS = [
  {
    provider: "ibm",
    device_id: "ibm.open_plan",
    display_name: "IBM Quantum Open Plan",
    vendor: "IBM",
    technology: "superconducting",
    access: "free_queue",
    qubit_count: 127,
    per_task_usd: null,
    per_shot_usd: null,
    allowance_note: "About 10 minutes of QPU time per 28 days.",
    rate_source: "https://example.test/ibm",
    rate_confirmed_on: "2026-09-01",
    submittable: true,
  },
  {
    provider: "braket",
    device_id: "braket.ionq.forte",
    display_name: "IonQ Forte",
    vendor: "IonQ",
    technology: "trapped_ion",
    access: "on_demand",
    qubit_count: 36,
    per_task_usd: 0.3,
    per_shot_usd: 0.08,
    allowance_note: null,
    rate_source: "https://example.test/braket",
    rate_confirmed_on: "2026-09-01",
    submittable: false,
  },
];

const FREE_ESTIMATE = {
  device_id: "ibm.open_plan",
  shots: 256,
  circuits: 1,
  total_shots: 256,
  basis: "free_tier_allowance",
  currency: "USD",
  task_fee_usd: null,
  shot_fees_usd: null,
  total_usd: null,
  allowance_note: "Counts against about 10 minutes of Open Plan time per 28 days.",
  rate_source: "https://example.test/ibm",
  rate_confirmed_on: "2026-09-01",
  disclaimer: "Estimate only.",
};

function runRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    workspace_id: "w",
    user_id: "u",
    artifact_version_id: null,
    provider: "ibm",
    device_id: "ibm.open_plan",
    provider_job_id: "job-abc",
    backend_name: null,
    shots: 256,
    status: "queued",
    source_fingerprint: FINGERPRINT,
    estimate_basis: "free_tier_allowance",
    estimated_total_usd: null,
    rate_source: "https://example.test/ibm",
    rate_confirmed_on: "2026-09-01",
    raw_counts: null,
    mitigation: null,
    error: null,
    submitted_at: null,
    completed_at: null,
    created_at: "2026-09-23T00:00:00Z",
    qasm: QASM,
    ...overrides,
  };
}

const USAGE = {
  tier: "free",
  runs: { used: 2, limit: 5, remaining: 3, exhausted: false, window_days: 7, next_slot_at: null },
  artifacts: { used: 4, limit: 25, remaining: 21, exhausted: false },
  workspaces: { used: 1, limit: 3, remaining: 2, exhausted: false },
  hardware_spend: { used_usd: 3.4, limit_usd: null, remaining_usd: null, exhausted: false, window_days: 7 },
};

type Options = {
  gate?: { submission_available: boolean; blocked_reason: string | null };
  exact?: unknown[];
  history?: unknown[];
  submit?: (request: RecordedRequest) => { status: number; body?: unknown };
};

function bff(options: Options = {}) {
  return (request: RecordedRequest) => {
    const { method, url } = request;
    if (method === "GET" && url === "/api/qpu/backends") return { status: 200, body: { backends: BACKENDS } };
    if (method === "GET" && url === "/api/qpu/submission-gate") {
      return { status: 200, body: options.gate ?? { submission_available: true, blocked_reason: null } };
    }
    if (method === "GET" && url.startsWith("/api/qpu/runs?")) {
      const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
      const items = params.get("source_fingerprint") ? options.exact ?? [] : options.history ?? [];
      return { status: 200, body: { items, next_cursor: null } };
    }
    if (method === "POST" && url === "/api/qpu/estimates") return { status: 200, body: FREE_ESTIMATE };
    if (method === "GET" && /^\/api\/qpu\/backends\/[^/]+\/queue$/.test(url)) {
      return { status: 200, body: { device_id: "ibm.open_plan", backend_name: "ibm_brisbane", pending_jobs: 4, unavailable_reason: null, checked_at: "2026-09-23T00:00:00Z" } };
    }
    if (method === "GET" && url === "/api/usage") return { status: 200, body: USAGE };
    if (method === "POST" && url === "/api/qpu/submissions") return options.submit?.(request) ?? { status: 201, body: runRecord() };
    throw new Error(`unexpected request: ${method} ${url}`);
  };
}

function renderNotebook(options: { hardware?: boolean; status?: "ok" | "error" } = {}) {
  const cells = notebookCellViews(CELLS, reportWith(options.status ?? "ok"));
  return render(
    <NotebookView
      cells={cells}
      locale="en"
      framework="qiskit"
      hardware={options.hardware === false ? undefined : { notebookId: NOTEBOOK, seq: SEQ }}
    />,
  );
}

const submissions = (calls: RecordedRequest[]) => calls.filter((c) => c.method === "POST" && c.url === "/api/qpu/submissions");

async function settled(fetchStub: ReturnType<typeof stubFetch>) {
  // The catalog and both restore lookups have answered.
  await waitFor(() => {
    assert.ok(fetchStub.calls.some((c) => c.url === "/api/qpu/submission-gate"));
    assert.ok(fetchStub.calls.some((c) => c.url.startsWith("/api/qpu/runs?limit=50")));
  });
}

test("hardware card: a cell that called leona_submit gets one card, and nothing is sent on render", async () => {
  clearRecentQpuRuns();
  const fetchStub = stubFetch(bff());
  try {
    const view = renderNotebook();
    await settled(fetchStub);
    await waitFor(() => assert.ok(view.getByRole("button", { name: "See the price" })));
    assert.ok(view.getByText("bell pair · 2 qubits · 256 shots"));
    assert.ok(view.getByText("Nothing is sent until you confirm, and you see the price first."));
    // The exact lookup asked for THIS request's fingerprint.
    const exact = fetchStub.calls.find((c) => c.url.includes("source_fingerprint="));
    assert.ok(exact);
    assert.equal(new URLSearchParams(exact.url.slice(exact.url.indexOf("?") + 1)).get("source_fingerprint"), FINGERPRINT);
    assert.equal(submissions(fetchStub.calls).length, 0, "no submission without a confirm");
    assert.equal(fetchStub.calls.filter((c) => c.url === "/api/qpu/estimates").length, 0, "no estimate without a click");
  } finally {
    fetchStub.restore();
  }
});

test("hardware card: see the price, confirm once, and exactly one submission carries the notebook fingerprint", async () => {
  clearRecentQpuRuns();
  const fetchStub = stubFetch(bff());
  try {
    const view = renderNotebook();
    await settled(fetchStub);
    const price = await waitFor(() => view.getByRole("button", { name: "See the price" }));
    await act(async () => {
      fireEvent.click(price);
    });
    const estimate = fetchStub.calls.find((c) => c.url === "/api/qpu/estimates");
    assert.deepEqual(estimate?.body, { device_id: "ibm.open_plan", shots: 256 });

    const submit = await waitFor(() => view.getByRole("button", { name: "Submit to the free queue" }));
    assert.ok(view.getByText("This device runs on IBM's free Open Plan time, so there is no charge."));
    await waitFor(() => assert.ok(view.getByText("4 jobs ahead of yours")));
    await waitFor(() => assert.ok(view.getByText("You have authorized $3.40 of hardware time in the last 7 days.")));
    assert.equal(submissions(fetchStub.calls).length, 0, "showing the price sent nothing");

    // Two clicks in one tick, before React can re-render the button away: the ref
    // lock is the only thing that can stop the second one.
    await act(async () => {
      submit.click();
      submit.click();
    });
    await waitFor(() => assert.ok(view.getByText(/Waiting in the device's queue/)));
    const sent = submissions(fetchStub.calls);
    assert.equal(sent.length, 1, "one confirm, one submission");
    assert.deepEqual(sent[0].body, {
      device_id: "ibm.open_plan",
      shots: 256,
      qasm: QASM,
      source_fingerprint: FINGERPRINT,
    });
    assert.ok(view.getByText("job-abc"));
  } finally {
    fetchStub.restore();
  }
});

test("hardware card: with no IBM key the confirm button stays off and the card links to the account page", async () => {
  clearRecentQpuRuns();
  const fetchStub = stubFetch(bff({ gate: { submission_available: false, blocked_reason: "credentials_unconfigured" } }));
  try {
    const view = renderNotebook();
    await settled(fetchStub);
    const link = await waitFor(() => view.getByRole("link", { name: "Add your IBM key" }));
    assert.equal(link.getAttribute("href"), "/account#qpu");
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "See the price" }));
    });
    const submit = await waitFor(() => view.getByRole("button", { name: "Submit to the free queue" }));
    assert.equal((submit as HTMLButtonElement).disabled, true);
    await act(async () => {
      submit.click();
    });
    assert.equal(submissions(fetchStub.calls).length, 0);
  } finally {
    fetchStub.restore();
  }
});

test("hardware card: a submission refused for a missing key says so and links to the account page", async () => {
  clearRecentQpuRuns();
  const fetchStub = stubFetch(
    bff({ submit: () => ({ status: 409, body: { title: "Conflict", status: 409, blocked_reason: "credentials_unconfigured" } }) }),
  );
  try {
    const view = renderNotebook();
    await settled(fetchStub);
    await act(async () => {
      fireEvent.click(await waitFor(() => view.getByRole("button", { name: "See the price" })));
    });
    const submit = await waitFor(() => view.getByRole("button", { name: "Submit to the free queue" }));
    await act(async () => {
      submit.click();
    });
    await waitFor(() => assert.ok(view.getByRole("link", { name: "Add your IBM key" })));
    assert.ok(view.getByRole("alert"));
    assert.ok(view.getByRole("button", { name: "Try again" }));
  } finally {
    fetchStub.restore();
  }
});

test("hardware card: a finished run of this request comes back on load, counts and all", async () => {
  clearRecentQpuRuns();
  const done = runRecord({ status: "done", backend_name: "ibm_brisbane", raw_counts: { "00": 130, "11": 120, "01": 6 } });
  const fetchStub = stubFetch(bff({ exact: [done] }));
  try {
    const view = renderNotebook();
    await waitFor(() => assert.ok(view.getByText("Measured distribution")));
    assert.ok(view.getByText(/Measured on ibm_brisbane\./));
    assert.ok(view.getByRole("button", { name: "Run again" }));
    assert.equal(submissions(fetchStub.calls).length, 0);
  } finally {
    fetchStub.restore();
  }
});

test("hardware card: the same circuit run from an earlier version is found in the history and labelled", async () => {
  clearRecentQpuRuns();
  const earlier = runRecord({ id: "run-0", status: "done", raw_counts: { "00": 128, "11": 128 }, source_fingerprint: `notebook:${NOTEBOOK}:v1:c02:${DIGEST}` });
  const otherCircuit = runRecord({ id: "run-x", status: "done", raw_counts: { "0": 256 }, source_fingerprint: `notebook:${NOTEBOOK}:v2:c02:000000000000` });
  const fetchStub = stubFetch(bff({ exact: [], history: [otherCircuit, earlier] }));
  try {
    const view = renderNotebook();
    await waitFor(() => assert.ok(view.getByText("This result is from version 1 of this notebook, which ran the same circuit.")));
    assert.ok(view.getByText("Measured distribution"));
  } finally {
    fetchStub.restore();
  }
});

test("hardware card: the read-only share view and a cell that raised render no card", async () => {
  clearRecentQpuRuns();
  const fetchStub = stubFetch(bff());
  try {
    const shared = renderNotebook({ hardware: false });
    assert.equal(shared.queryByText("Run on a real quantum computer"), null);
    shared.unmount();
    const raised = renderNotebook({ status: "error" });
    assert.equal(raised.queryByText("Run on a real quantum computer"), null);
    assert.equal(fetchStub.calls.length, 0, "no card, so not even the catalog is read");
  } finally {
    fetchStub.restore();
  }
});
