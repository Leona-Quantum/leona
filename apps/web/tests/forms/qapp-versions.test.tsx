import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { QappVersions } from "../../app/(app)/qapps/[qappId]/qapp-versions.tsx";
import { stubFetch } from "./dom-env.ts";

function page(currentId: string) {
  return {
    versions: [
      {
        id: "v2", seq: 2, is_current: currentId === "v2", framework: "qiskit",
        qubits_estimate: 3, fingerprint: "b".repeat(64), created_at: "2026-09-20T10:00:00Z", range_smoke: null,
      },
      {
        id: "v1", seq: 1, is_current: currentId === "v1", framework: "qiskit",
        qubits_estimate: 2, fingerprint: "a".repeat(64), created_at: "2026-09-01T10:00:00Z", range_smoke: null,
      },
    ],
    current_version_id: currentId,
    next_before_seq: null,
  };
}

test("Qapp version history shows the live version and rolls back to another one", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "GET") {
      assert.equal(request.url, "/api/qapps/q1/versions");
      return { status: 200, body: page("v2") };
    }
    assert.equal(request.url, "/api/qapps/q1/versions/v1/rollback");
    assert.equal(request.method, "POST");
    return { status: 200, body: { qapp: { id: "q1" }, demoted_to_private: false } };
  });

  try {
    const view = render(<QappVersions qappId="q1" locale="en" />);
    await waitFor(() => assert.ok(view.getByText("Version 2")));
    assert.ok(view.getByText("Live now"));

    fireEvent.click(view.getByRole("button", { name: "Make this version live" }));
    await waitFor(() => assert.ok(view.getByText("Version 1 is now live.")));
    assert.equal(fetchStub.calls.filter((call) => call.method === "POST").length, 1);
  } finally {
    fetchStub.restore();
  }
});

test("a rollback onto a never-run version tells the creator the Qapp went private", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "GET") return { status: 200, body: page("v2") };
    return { status: 200, body: { qapp: { id: "q1" }, demoted_to_private: true } };
  });

  try {
    const view = render(<QappVersions qappId="q1" locale="en" />);
    await waitFor(() => assert.ok(view.getByText("Version 2")));
    fireEvent.click(view.getByRole("button", { name: "Make this version live" }));
    await waitFor(() => assert.ok(view.getByText(/is now live, but it has never run successfully/)));
  } finally {
    fetchStub.restore();
  }
});

test("a refused rollback shows the server's reason", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "GET") return { status: 200, body: page("v2") };
    return { status: 403, body: { title: "only the Qapp creator may change its live version" } };
  });

  try {
    const view = render(<QappVersions qappId="q1" locale="en" />);
    await waitFor(() => assert.ok(view.getByText("Version 2")));
    fireEvent.click(view.getByRole("button", { name: "Make this version live" }));
    await waitFor(() => assert.match(view.getByRole("alert").textContent ?? "", /only the Qapp creator may change its live version/));
  } finally {
    fetchStub.restore();
  }
});
