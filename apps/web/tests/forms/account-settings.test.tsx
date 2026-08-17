// Real submission coverage for the account settings "display name" form
// (ai-ops issue 123). apps/web/app/(app)/account/account-settings.tsx — behind
// WorkOS auth in the real app, but the component itself only talks to
// fetch("/api/me")/("/api/workspace"); rendering it directly and stubbing
// those calls exercises the real submit handler with no live session needed
// (MAJORANA_LOCAL_DEV_AUTH cannot run in CI at all — it explicitly checks
// `!process.env.CI` — so this is the level that actually runs here).
import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { AccountSettings } from "../../app/(app)/account/account-settings.tsx";
import { stubFetch } from "./dom-env.ts";

const ME = {
  user_id: "user_1",
  email: "ada@example.com",
  display_name: "Ada",
  workspace_id: "ws_1",
  workspace_name: "Ada's workspace",
  role: "owner",
  is_personal_workspace: true,
};

const WORKSPACE = {
  workspace: { id: "ws_1", name: "Ada's workspace", plan: "free", auto_keep_artifacts: false },
  members: [{ user_id: "user_1", email: "ada@example.com", display_name: "Ada", role: "owner" }],
  artifact_count: 3,
  run_count: 12,
};

// AccountSettings renders WorkspaceSharing as a child, and THAT component's
// own mount effect fetches /api/workspaces — a request none of these tests
// stubbed. The stub's default `throw` on an unhandled request made that
// unhandled fetch reject, which WorkspaceSharing's loadWorkspaces() swallows
// silently ("the panel simply does not list; the rest of Settings still
// works") — so every test here ran the nested panel in an artificial
// failed-load state that real users never see, rather than the page's real
// loaded state. Stubbing this is what makes the rendered page match
// production.
const WORKSPACES_LIST = [{ id: "ws_1", name: "Ada's workspace", role: "owner", is_active: true, is_personal: true }];

function stubIdentity(overrides: { me?: Partial<typeof ME> } = {}) {
  return stubFetch((request) => {
    if (request.method === "GET" && request.url === "/api/me") {
      return { status: 200, body: { ...ME, ...overrides.me } };
    }
    if (request.method === "GET" && request.url === "/api/workspace") {
      return { status: 200, body: WORKSPACE };
    }
    if (request.method === "GET" && request.url === "/api/workspaces") {
      return { status: 200, body: WORKSPACES_LIST };
    }
    // saveProfile() PATCHes /api/me with the new display_name and expects the
    // full Me record back — echo the change, the way the real route does.
    if (request.method === "PATCH" && request.url === "/api/me") {
      const patch = request.body as { display_name?: string };
      return { status: 200, body: { ...ME, ...overrides.me, display_name: patch.display_name } };
    }
    throw new Error(`unexpected request in this test: ${request.method} ${request.url}`);
  });
}

async function renderAndWaitForLoad() {
  const view = render(<AccountSettings initialEmail="ada@example.com" locale="en" />);
  await waitFor(() => assert.ok(view.queryByLabelText("Display name")));
  const form = view.container.querySelector("form.mj-account-profile-form");
  assert.ok(form, "account settings did not render the profile <form>");
  return { ...view, form: form as HTMLFormElement };
}

test("account settings: saving the display name PATCHes /api/me with the typed value", async () => {
  const fetchStub = stubIdentity();
  try {
    const { form, getByLabelText, getByRole } = await renderAndWaitForLoad();

    fireEvent.change(getByLabelText("Display name"), { target: { value: "Ada Lovelace" } });

    fetchStub.calls.length = 0; // drop the two mount-time GETs; only the submit matters below
    await act(async () => {
      fireEvent.submit(form);
    });

    const patch = fetchStub.calls.find((c) => c.method === "PATCH");
    assert.ok(patch, "saving the name never PATCHed /api/me");
    assert.equal(patch.url, "/api/me");
    assert.deepEqual(patch.body, { display_name: "Ada Lovelace" });

    await waitFor(() => {
      assert.equal(getByRole("status").textContent, "Profile saved.");
    });
  } finally {
    fetchStub.restore();
  }
});

test("account settings: a failed save shows the server's error and leaves the button enabled to retry", async () => {
  const calls: string[] = [];
  const fetchStub = stubFetch((request) => {
    calls.push(`${request.method} ${request.url}`);
    if (request.method === "GET" && request.url === "/api/me") return { status: 200, body: ME };
    if (request.method === "GET" && request.url === "/api/workspace") return { status: 200, body: WORKSPACE };
    if (request.method === "PATCH" && request.url === "/api/me") {
      return { status: 500, body: { error: "Database unavailable" } };
    }
    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  });
  try {
    const { form, getByLabelText, getByRole } = await renderAndWaitForLoad();
    fireEvent.change(getByLabelText("Display name"), { target: { value: "Ada Lovelace" } });

    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() => {
      assert.equal(getByRole("status").textContent, "Database unavailable");
    });
    const button = getByRole("button", { name: /Save name/i });
    assert.equal(button.hasAttribute("disabled"), false);
  } finally {
    fetchStub.restore();
  }
});

test("account settings: the auto-keep-artifacts toggle PATCHes /api/workspace/settings and reverts on failure", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "GET" && request.url === "/api/me") return { status: 200, body: ME };
    if (request.method === "GET" && request.url === "/api/workspace") return { status: 200, body: WORKSPACE };
    if (request.method === "PATCH" && request.url === "/api/workspace/settings") return { status: 500, body: {} };
    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  });
  try {
    const { getByLabelText, getByRole } = await renderAndWaitForLoad();
    const toggle = getByLabelText(/Automatically save results/i) as HTMLInputElement;
    assert.equal(toggle.checked, false);

    await act(async () => {
      fireEvent.click(toggle);
    });

    const patch = fetchStub.calls.find((c) => c.method === "PATCH");
    assert.ok(patch, "toggling auto-keep never PATCHed /api/workspace/settings");
    assert.deepEqual(patch.body, { auto_keep_artifacts: true });

    // Optimistic update reverted once the server refuses it — the checkbox is
    // the only feedback there is, so it must not keep claiming a state the
    // workspace does not actually have.
    await waitFor(() => assert.equal(toggle.checked, false));
    assert.ok((getByRole("status").textContent?.length ?? 0) > 0, "a failure must say so, not just quietly revert");
  } finally {
    fetchStub.restore();
  }
});
