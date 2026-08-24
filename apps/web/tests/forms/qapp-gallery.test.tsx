import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { QappGallery } from "../../app/(app)/qapps/qapp-gallery.tsx";
import { stubFetch } from "./dom-env.ts";

test("Qapp gallery lists the signed-in workspace and filters it by search", async () => {
  const fetchStub = stubFetch((request) => {
    assert.equal(request.url, "/api/qapps");
    assert.equal(request.method, "GET");
    return {
      status: 200,
      body: [
        {
          id: "018f0000-0000-7000-8000-000000000001",
          workspace_id: "018f0000-0000-7000-8000-000000000002",
          owner_user_id: "018f0000-0000-7000-8000-000000000003",
          slug: "h2-ground-state-018f",
          title: "H₂基底状態エネルギー",
          description: "結合距離からエネルギー曲線を調べます。",
          visibility: "private",
          current_version_id: "018f0000-0000-7000-8000-000000000004",
          created_by_run_id: "018f0000-0000-7000-8000-000000000005",
          created_at: "2026-08-24T10:00:00Z",
          updated_at: "2026-08-24T11:00:00Z",
          published_at: null,
        },
      ],
    };
  });

  try {
    const view = render(<QappGallery view="mine" locale="ja" />);
    await waitFor(() => assert.ok(view.getByRole("heading", { name: "H₂基底状態エネルギー" })));
    assert.equal(
      view.getByRole("link", { name: "ワークスペースを開く" }).getAttribute("href"),
      "/qapps/018f0000-0000-7000-8000-000000000001",
    );
    assert.equal(view.getByRole("link", { name: "Runで作る" }).getAttribute("href"), "/run?mode=qapp");

    fireEvent.change(view.getByRole("textbox", { name: "Qappを検索" }), { target: { value: "qiskit" } });
    await waitFor(() => assert.ok(view.getByText("検索条件に一致するQappはありません。")));
    fireEvent.change(view.getByRole("textbox", { name: "Qappを検索" }), { target: { value: "エネルギー" } });
    await waitFor(() => assert.ok(view.getByRole("heading", { name: "H₂基底状態エネルギー" })));
  } finally {
    fetchStub.restore();
  }
});

test("Qapp gallery explores public summaries without receiving generated source or UI", async () => {
  const fetchStub = stubFetch((request) => {
    assert.equal(request.url, "/api/qapps/public");
    return {
      status: 200,
      body: [
        {
          slug: "phase-explorer-018f",
          title: "Phase explorer",
          description: "Compare interference as phase changes.",
          framework: "qiskit",
          qubits_estimate: 2,
          version: 3,
          published_at: "2026-08-24T12:00:00Z",
        },
      ],
    };
  });

  try {
    const view = render(<QappGallery view="public" locale="en" />);
    await waitFor(() => assert.ok(view.getByRole("heading", { name: "Phase explorer" })));
    assert.equal(view.getByText("2 qubits").textContent, "2 qubits");
    assert.equal(view.getByText("Version 3").textContent, "Version 3");
    assert.equal(
      view.getByRole("link", { name: "Open Qapp" }).getAttribute("href"),
      "/q/phase-explorer-018f",
    );
    assert.equal(fetchStub.calls.length, 1);
  } finally {
    fetchStub.restore();
  }
});
