import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { QappWorkspace } from "../../app/(app)/qapps/[qappId]/qapp-workspace.tsx";

function detail(id: string) {
  return {
    qapp: { id, slug: id, title: `Qapp ${id}`, description: "Example circuit", visibility: "private" },
    version: { framework: "qiskit", ui_document: "<p>Example</p>", range_smoke: null },
  };
}

test("Qapp navigation failure replaces old detail with a working retry", async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (String(url) === "/api/qapps/a") return Response.json(detail("a"));
    assert.equal(String(url), "/api/qapps/b");
    attempts += 1;
    return attempts === 1 ? new Response(null, { status: 503 }) : Response.json(detail("b"));
  });
  const view = render(<QappWorkspace qappId="a" />);
  await waitFor(() => assert.ok(view.getByRole("heading", { name: "Qapp a" })));
  view.rerender(<QappWorkspace qappId="b" />);
  await waitFor(() => assert.ok(view.getByRole("alert")));
  assert.equal(view.queryByRole("heading", { name: "Qapp a" }), null);
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  await waitFor(() => assert.ok(view.getByRole("heading", { name: "Qapp b" })));
  assert.equal(attempts, 2);
});

test("deleting a Qapp asks first, sends one DELETE, and returns to the list", async (t) => {
  const calls: { url: string; method: string }[] = [];
  const pushed: string[] = [];
  (globalThis as { __formTestRouterPush?: (value: string) => void }).__formTestRouterPush = (value) => pushed.push(value);
  t.after(() => { delete (globalThis as { __formTestRouterPush?: unknown }).__formTestRouterPush; });
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(url), method });
    return method === "DELETE" ? new Response(null, { status: 204 }) : Response.json(detail("a"));
  });
  const view = render(<QappWorkspace qappId="a" />);
  await waitFor(() => assert.ok(view.getByRole("heading", { name: "Qapp a" })));

  // The first click only arms it: nothing is sent, and the reader is told what goes.
  fireEvent.click(view.getByRole("button", { name: "Delete Qapp" }));
  assert.ok(view.getByText(/takes its public page down/));
  assert.deepEqual(calls.filter((call) => call.method === "DELETE"), []);

  fireEvent.click(view.getByRole("button", { name: "Delete for good" }));
  await waitFor(() => assert.deepEqual(pushed, ["/qapps"]));
  assert.deepEqual(calls.filter((call) => call.method === "DELETE"), [{ url: "/api/qapps/a", method: "DELETE" }]);
});

test("a refused Qapp delete shows the server's reason and keeps the Qapp on screen", async (t) => {
  const pushed: string[] = [];
  (globalThis as { __formTestRouterPush?: (value: string) => void }).__formTestRouterPush = (value) => pushed.push(value);
  t.after(() => { delete (globalThis as { __formTestRouterPush?: unknown }).__formTestRouterPush; });
  t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => (
    init?.method === "DELETE"
      ? Response.json({ title: "only the Qapp creator may delete it" }, { status: 403 })
      : Response.json(detail("a"))
  ));
  const view = render(<QappWorkspace qappId="a" />);
  await waitFor(() => assert.ok(view.getByRole("heading", { name: "Qapp a" })));
  fireEvent.click(view.getByRole("button", { name: "Delete Qapp" }));
  fireEvent.click(view.getByRole("button", { name: "Delete for good" }));
  await waitFor(() => assert.match(view.getByRole("alert").textContent ?? "", /only the Qapp creator may delete it/));
  assert.deepEqual(pushed, []);
  assert.ok(view.getByRole("heading", { name: "Qapp a" }));
  assert.ok(view.getByRole("button", { name: "Delete Qapp" }));
});
