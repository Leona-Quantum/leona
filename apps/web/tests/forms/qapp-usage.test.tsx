import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { render, waitFor } from "@testing-library/react";
import { QappUsage } from "../../app/(app)/qapps/[qappId]/qapp-usage.tsx";
import { stubFetch } from "./dom-env.ts";

test("Qapp usage shows per-version execution counts and last run", async () => {
  const fetchStub = stubFetch((request) => {
    assert.equal(request.url, "/api/qapps/q1/usage");
    return {
      status: 200,
      body: [
        {
          qapp_version_id: "v1", total: 4, succeeded: 3, failed: 1, queued: 0, running: 0,
          last_execution_at: "2026-09-20T10:00:00Z", last_execution_status: "succeeded",
        },
      ],
    };
  });

  try {
    const view = render(<QappUsage qappId="q1" locale="en" />);
    await waitFor(() => assert.ok(view.getByRole("cell", { name: "4" })));
    assert.ok(view.getByRole("cell", { name: "3" }));
    assert.ok(view.getByRole("cell", { name: "1" }));
    assert.equal(fetchStub.calls.length, 1);
  } finally {
    fetchStub.restore();
  }
});

test("Qapp usage with no executions says so instead of showing an empty table", async () => {
  const fetchStub = stubFetch(() => ({ status: 200, body: [] }));

  try {
    const view = render(<QappUsage qappId="q1" locale="en" />);
    await waitFor(() => assert.ok(view.getByText("No executions yet.")));
    assert.equal(view.queryByRole("table"), null);
  } finally {
    fetchStub.restore();
  }
});

test("a refused usage read shows the server's reason", async () => {
  const fetchStub = stubFetch(() => ({ status: 403, body: { title: "only the Qapp creator may view its usage" } }));

  try {
    const view = render(<QappUsage qappId="q1" locale="en" />);
    await waitFor(() => assert.match(view.getByRole("alert").textContent ?? "", /only the Qapp creator may view its usage/));
  } finally {
    fetchStub.restore();
  }
});
