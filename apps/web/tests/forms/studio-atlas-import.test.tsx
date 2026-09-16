import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { render, waitFor } from "@testing-library/react";
import { StudioWorkspace } from "../../app/(app)/studio/studio-workspace.tsx";
import { stubFetch } from "./dom-env.ts";

const globals = globalThis as typeof globalThis & { __formTestRouterReplace?: (value: string) => void };

test("Studio imports the Atlas record it was sent to and replaces the URL with the new artifact", async () => {
  const replaced: string[] = [];
  globals.__formTestRouterReplace = (value) => replaced.push(value);
  const fetchStub = stubFetch((request) => {
    if (request.url === "/api/artifacts?limit=100" && request.method === "GET") return { status: 200, body: [] };
    if (request.url === "/api/repository/grover-unstructured-search/export" && request.method === "POST") {
      return { status: 201, body: { id: "art_grover_1", title: "Grover search" } };
    }
    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  });
  try {
    const view = render(<StudioWorkspace atlasSlug="grover-unstructured-search" />);
    assert.ok(view.getByText("Adding this Atlas entry to your Studio…"));
    await waitFor(() => assert.deepEqual(replaced, ["/studio?artifact=art_grover_1"]));
    // Exactly one import for one arrival.
    assert.equal(fetchStub.calls.filter((call) => call.url.endsWith("/export")).length, 1);
  } finally {
    fetchStub.restore();
    delete globals.__formTestRouterReplace;
  }
});

test("a refused import is reported in place, with the server's reason", async () => {
  const replaced: string[] = [];
  globals.__formTestRouterReplace = (value) => replaced.push(value);
  const fetchStub = stubFetch((request) => {
    if (request.url === "/api/artifacts?limit=100" && request.method === "GET") return { status: 200, body: [] };
    if (request.url === "/api/repository/no-native-export/export" && request.method === "POST") {
      return { status: 422, body: { error: "This entry does not have a supported native export yet." } };
    }
    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  });
  try {
    const view = render(<StudioWorkspace atlasSlug="no-native-export" />);
    await waitFor(() => assert.ok(view.getByRole("alert")));
    assert.match(view.getByRole("alert").textContent ?? "", /could not be added to your Studio/);
    assert.deepEqual(replaced, []);
  } finally {
    fetchStub.restore();
    delete globals.__formTestRouterReplace;
  }
});
