// Real submission coverage for the project-sharing dialog (ai-ops issue 123).
// apps/web/components/project-share-dialog.tsx — a SEVENTH form the audit's
// count of six missed: it is reachable from the Studio sidebar (shell.tsx),
// distinct from the workspace-level invite in workspace-sharing.tsx (this one
// grants access to a single project, and can name people outside the
// workspace entirely). Its submit handler goes through lib/project-shares.ts,
// which is itself just fetch() — same stubbing approach as every other form
// here.
import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { ProjectShareDialog } from "../../components/project-share-dialog.tsx";
import { stubFetch, type RecordedRequest } from "./dom-env.ts";

function stubProject(extra: (request: RecordedRequest) => { status: number; body?: unknown } | undefined) {
  return stubFetch((request) => {
    if (request.method === "GET" && request.url === "/api/workspace/projects/proj_1/shares") {
      return { status: 200, body: [] };
    }
    if (request.method === "GET" && request.url === "/api/workspace/projects") {
      return { status: 200, body: [{ id: "proj_1", max_artifacts: 20 }] };
    }
    const handled = extra(request);
    if (handled) return handled;
    throw new Error(`unexpected request in this test: ${request.method} ${request.url}`);
  });
}

async function renderDialog() {
  const view = render(
    <ProjectShareDialog projectId="proj_1" projectName="Bell pair" locale="en" onClose={() => {}} />,
  );
  await waitFor(() => assert.ok(view.getByText("This project is not shared with anyone.")));
  const form = view.container.querySelector("form.mj-share-form");
  assert.ok(form, "project share dialog did not render the share <form>");
  return { ...view, form: form as HTMLFormElement };
}

test("project share dialog: granting access POSTs the email and role to the project's shares endpoint", async () => {
  const fetchStub = stubProject((request) => {
    if (request.method === "POST" && request.url === "/api/workspace/projects/proj_1/shares") {
      const body = request.body as { email?: string; role?: string; expires_at?: string | null };
      return {
        status: 200,
        body: {
          project_id: "proj_1",
          grantee_user_id: "user_2",
          grantee_email: body.email,
          grantee_display_name: null,
          role: body.role,
          expires_at: body.expires_at,
          granted_by_email: "ada@example.com",
          created_at: "2026-08-17T00:00:00Z",
        },
      };
    }
  });
  try {
    const { form, getByLabelText, getByText } = await renderDialog();

    fireEvent.change(getByLabelText("Email address"), { target: { value: "reader@example.com" } });
    fireEvent.change(getByLabelText(/^They can/), { target: { value: "editor" } });

    await act(async () => {
      fireEvent.submit(form);
    });

    const post = fetchStub.calls.find((c) => c.method === "POST");
    assert.ok(post, "granting access never POSTed to the project shares endpoint");
    assert.equal(post.url, "/api/workspace/projects/proj_1/shares");
    assert.deepEqual(post.body, { email: "reader@example.com", role: "editor", expires_at: null });

    await waitFor(() => assert.ok(getByText("reader@example.com can now open this project.")));
  } finally {
    fetchStub.restore();
  }
});

test("project share dialog: sharing outside the plan shows the team-plan refusal, not a generic failure", async () => {
  const fetchStub = stubProject((request) => {
    if (request.method === "POST" && request.url === "/api/workspace/projects/proj_1/shares") {
      // Note the shape: project-shares.ts's refusalReason() reads a
      // top-level `reason`, unlike qpu-credentials.tsx's `detail.reason` —
      // two different endpoints, two different envelope conventions.
      return {
        status: 403,
        body: { reason: "project_sharing_not_in_plan", title: "Sharing needs the Team plan" },
      };
    }
  });
  try {
    const { form, getByLabelText, getByText } = await renderDialog();
    fireEvent.change(getByLabelText("Email address"), { target: { value: "reader@example.com" } });

    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() =>
      assert.ok(
        getByText(
          "Sharing a project with someone outside your workspace is part of the Team plan. Your current plan does not include it.",
        ),
      ),
    );
  } finally {
    fetchStub.restore();
  }
});

test("project share dialog: a non-admin viewer sees the admin-only refusal instead of the form", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "GET" && request.url === "/api/workspace/projects/proj_1/shares") {
      return { status: 403, body: {} };
    }
    if (request.method === "GET" && request.url === "/api/workspace/projects") {
      return { status: 200, body: [] };
    }
    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  });
  try {
    const view = render(
      <ProjectShareDialog projectId="proj_1" projectName="Bell pair" locale="en" onClose={() => {}} />,
    );
    await waitFor(() => assert.ok(view.getByText("Only an owner or admin can share a project.")));
    assert.ok(view.queryByLabelText("Email address") === null, "the share form must not render for a forbidden viewer");
  } finally {
    fetchStub.restore();
  }
});
