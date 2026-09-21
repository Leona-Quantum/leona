import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { QappForkButton } from "../../app/q/[slug]/qapp-fork-button.tsx";
import { stubFetch } from "./dom-env.ts";

test("a signed-out visitor sees a sign-in link instead of a fork button", () => {
  const view = render(
    <QappForkButton slug="phase-explorer" signedIn={false} signInPath="/auth/sign-in?returnTo=/q/phase-explorer" locale="en" />,
  );
  const link = view.getByRole("link", { name: "Sign in to fork this Qapp." });
  assert.equal(link.getAttribute("href"), "/auth/sign-in?returnTo=/q/phase-explorer");
  assert.equal(view.queryByRole("button"), null);
});

test("a signed-in visitor forks the Qapp and is sent to its new workspace page", async () => {
  const pushed: string[] = [];
  (globalThis as { __formTestRouterPush?: (value: string) => void }).__formTestRouterPush = (value) => pushed.push(value);

  const fetchStub = stubFetch((request) => {
    assert.equal(request.url, "/api/qapps/public/phase-explorer/fork");
    assert.equal(request.method, "POST");
    return { status: 201, body: { qapp: { id: "new-qapp-id" }, version: {} } };
  });

  try {
    const view = render(
      <QappForkButton slug="phase-explorer" signedIn signInPath="/auth/sign-in" locale="en" />,
    );
    fireEvent.click(view.getByRole("button", { name: "Fork this Qapp" }));
    await waitFor(() => assert.deepEqual(pushed, ["/qapps/new-qapp-id"]));
  } finally {
    fetchStub.restore();
    delete (globalThis as { __formTestRouterPush?: unknown }).__formTestRouterPush;
  }
});

test("forking a Qapp that is not published shows the server's refusal", async () => {
  const fetchStub = stubFetch(() => ({ status: 409, body: { title: "only a published Qapp may be forked" } }));

  try {
    const view = render(
      <QappForkButton slug="draft-qapp" signedIn signInPath="/auth/sign-in" locale="en" />,
    );
    fireEvent.click(view.getByRole("button", { name: "Fork this Qapp" }));
    await waitFor(() => assert.match(view.getByRole("alert").textContent ?? "", /only a published Qapp may be forked/));
  } finally {
    fetchStub.restore();
  }
});
