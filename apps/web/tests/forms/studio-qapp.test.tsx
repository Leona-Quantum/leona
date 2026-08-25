import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { StudioWorkspace } from "../../app/(app)/studio/studio-workspace.tsx";
import { stubFetch } from "./dom-env.ts";

test("Studio Qapp submits the custom prompt and opens its Run", async () => {
  const routes: string[] = [];
  const globals = globalThis as typeof globalThis & { __formTestRouterPush?: (value: string) => void };
  globals.__formTestRouterPush = (value) => routes.push(value);

  const fetchStub = stubFetch((request) => {
    if (request.url === "/api/artifacts?limit=100" && request.method === "GET") {
      return { status: 200, body: [] };
    }
    if (request.url === "/api/runs" && request.method === "POST") {
      return { status: 201, body: { id: "run_qapp_custom_123" } };
    }
    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  });

  try {
    const view = render(<StudioWorkspace newDraft locale="ja" />);
    const prompt = view.getByLabelText("Qappプロンプト") as HTMLTextAreaElement;
    fireEvent.change(prompt, {
      target: { value: "  位相を操作して測定分布を比較できるUIにしてください。  " },
    });
    fireEvent.click(view.getByRole("button", { name: "Qappにする" }));

    await waitFor(() => assert.deepEqual(routes, ["/run/run_qapp_custom_123"]));
    const submission = fetchStub.calls.find((call) => call.url === "/api/runs");
    assert.ok(submission, "Studio did not submit a Qapp run");
    const body = submission.body as Record<string, unknown>;
    assert.equal(body.task_prompt, "位相を操作して測定分布を比較できるUIにしてください。");
    assert.equal(body.mode, "qapp");
    assert.equal(body.framework, "qiskit");
    assert.equal(body.response_locale, "ja");
    assert.equal(typeof body.source_code, "string");
    assert.match(body.source_code as string, /QuantumCircuit/);
  } finally {
    fetchStub.restore();
    delete globals.__formTestRouterPush;
  }
});
