// Real submission coverage for the two forms in the "workspace sharing" panel
// (ai-ops issue 123): apps/web/app/(app)/account/workspace-sharing.tsx — create a
// new shared workspace, and invite a member into the active one. Both are
// signed-in-only in the real app; both are plain fetch() calls from a client
// component, so this exercises the real submit handlers with no live WorkOS
// session, same reasoning as account-settings.test.tsx.
import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { WorkspaceSharing } from "../../app/(app)/account/workspace-sharing.tsx";
import { stubFetch, type RecordedRequest } from "./dom-env.ts";

const OWNER_MEMBER = {
  user_id: "user_1",
  email: "ada@example.com",
  display_name: "Ada",
  role: "owner" as const,
  created_at: "2026-01-01T00:00:00Z",
};
const ACTIVE_WORKSPACE = { id: "ws_1", name: "Ada's workspace", role: "owner", is_active: true, is_personal: true };

function stubWorkspaces(
  extraHandlers: (request: RecordedRequest) => { status: number; body?: unknown } | undefined = () => undefined,
) {
  return stubFetch((request) => {
    if (request.method === "GET" && request.url === "/api/workspaces") {
      return { status: 200, body: [ACTIVE_WORKSPACE] };
    }
    const handled = extraHandlers(request);
    if (handled) return handled;
    throw new Error(`unexpected request in this test: ${request.method} ${request.url}`);
  });
}

async function renderPanel(members = [OWNER_MEMBER]) {
  const changes: unknown[] = [];
  const view = render(
    <WorkspaceSharing
      locale="en"
      members={members}
      viewerUserId="user_1"
      viewerRole="owner"
      onMembersChanged={(next) => changes.push(next)}
    />,
  );
  await waitFor(() => assert.ok(view.getByText("Ada's workspace")));
  return { ...view, changes };
}

test("workspace sharing: creating a workspace POSTs the typed name to /api/workspaces", async () => {
  const fetchStub = stubWorkspaces((request) => {
    if (request.method === "POST" && request.url === "/api/workspaces") {
      const body = request.body as { name?: string };
      return { status: 200, body: { id: "ws_2", name: body.name, role: "owner", is_active: false, is_personal: false } };
    }
  });
  try {
    const { getByLabelText, getByText } = await renderPanel();
    const nameField = getByLabelText("New shared workspace") as HTMLInputElement;
    fireEvent.change(nameField, { target: { value: "Ion trap group" } });

    const form = nameField.closest("form");
    assert.ok(form, "no <form> around the create-workspace field");
    await act(async () => {
      fireEvent.submit(form!);
    });

    const post = fetchStub.calls.find((c) => c.method === "POST" && c.url === "/api/workspaces");
    assert.ok(post, "creating a workspace never POSTed to /api/workspaces");
    assert.deepEqual(post.body, { name: "Ion trap group" });

    await waitFor(() => assert.ok(getByText(/Ion trap group created/)));
    // Cleared for the next entry, and the workspace list is refetched (one GET
    // /api/workspaces on mount, a second after the POST resolves).
    assert.equal(nameField.value, "");
    const listFetches = fetchStub.calls.filter((c) => c.method === "GET" && c.url === "/api/workspaces");
    assert.equal(listFetches.length, 2);
  } finally {
    fetchStub.restore();
  }
});

test("workspace sharing: creating a workspace with a name the server refuses shows that refusal, not a generic one", async () => {
  const fetchStub = stubWorkspaces((request) => {
    if (request.method === "POST" && request.url === "/api/workspaces") {
      return { status: 409, body: { error: "You already have a workspace with that name." } };
    }
  });
  try {
    const { getByLabelText, getByText } = await renderPanel();
    const nameField = getByLabelText("New shared workspace");
    fireEvent.change(nameField, { target: { value: "Ion trap group" } });
    const form = nameField.closest("form")!;

    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() => assert.ok(getByText("You already have a workspace with that name.")));
  } finally {
    fetchStub.restore();
  }
});

test("workspace sharing: inviting a member POSTs the email and chosen role to /api/workspace/members", async () => {
  const fetchStub = stubWorkspaces((request) => {
    if (request.method === "POST" && request.url === "/api/workspace/members") {
      const body = request.body as { email?: string; role?: string };
      return {
        status: 200,
        body: { user_id: "user_2", email: body.email, role: body.role, display_name: null },
      };
    }
  });
  try {
    const { getByLabelText, getByText } = await renderPanel();
    const emailField = getByLabelText("Invite") as HTMLInputElement;
    fireEvent.change(emailField, { target: { value: "Colleague@Example.com" } });
    // Not an exact match: the label's text also contains the role-help
    // `<small>` ("Can run, save and edit."), concatenated into one accessible
    // name.
    fireEvent.change(getByLabelText(/^Role/), { target: { value: "viewer" } });

    const form = emailField.closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });

    const post = fetchStub.calls.find((c) => c.method === "POST" && c.url === "/api/workspace/members");
    assert.ok(post, "inviting a member never POSTed to /api/workspace/members");
    // Lower-cased and trimmed before it goes out — see invite() in workspace-sharing.tsx.
    assert.deepEqual(post.body, { email: "colleague@example.com", role: "viewer" });

    await waitFor(() => assert.ok(getByText(/can now open this workspace/)));
  } finally {
    fetchStub.restore();
  }
});

test("workspace sharing: inviting an address with no account on this deployment gets the specific 404 sentence", async () => {
  const fetchStub = stubWorkspaces((request) => {
    if (request.method === "POST" && request.url === "/api/workspace/members") {
      return { status: 404, body: {} };
    }
  });
  try {
    const { getByLabelText, getByText } = await renderPanel();
    const emailField = getByLabelText("Invite");
    fireEvent.change(emailField, { target: { value: "nobody@example.com" } });
    const form = emailField.closest("form")!;

    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() =>
      assert.ok(getByText("No account here uses that address yet. Ask them to sign in once, then invite them again.")),
    );
  } finally {
    fetchStub.restore();
  }
});

test("workspace sharing: the invite form is hidden from a non-admin viewer (member/viewer roles cannot invite)", async () => {
  // `canAdminister` is computed from the FETCHED workspaces list's own `role`
  // field once it loads, not from the `viewerRole` prop (the prop is only the
  // server-rendered value at page load — see the comment on `effectiveRole` in
  // workspace-sharing.tsx). The stub has to agree with the prop, or the
  // component correctly prefers the fresher, fetched answer and the test would
  // be asserting against its own inconsistent fixture.
  const fetchStub = stubFetch((request) => {
    if (request.method === "GET" && request.url === "/api/workspaces") {
      return { status: 200, body: [{ ...ACTIVE_WORKSPACE, role: "viewer" }] };
    }
    throw new Error(`unexpected request in this test: ${request.method} ${request.url}`);
  });
  try {
    const view = render(
      <WorkspaceSharing
        locale="en"
        members={[
          OWNER_MEMBER,
          {
            user_id: "user_2",
            email: "reader@example.com",
            display_name: null,
            role: "viewer",
            created_at: "2026-01-02T00:00:00Z",
          },
        ]}
        viewerUserId="user_2"
        viewerRole="viewer"
        onMembersChanged={() => {}}
      />,
    );
    await waitFor(() => assert.ok(view.getByText("Ada's workspace")));
    // `assert.ok(x === null, ...)` rather than `assert.equal(x, null)`: on
    // failure `equal` tries to diff a real DOM node, which drags in its
    // circular React fiber internals and takes the assertion machinery upward
    // of twenty seconds to format — the failure this fixture had before it
    // was fixed above.
    assert.ok(view.queryByLabelText("Invite") === null, "the invite field must not render for a non-admin viewer");
    assert.ok(view.getByText("Only an owner or admin can invite and remove people."));
  } finally {
    fetchStub.restore();
  }
});
