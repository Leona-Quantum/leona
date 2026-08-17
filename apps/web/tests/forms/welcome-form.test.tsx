// Real submission coverage for the post-sign-up name form (ai-ops issue 123).
// apps/web/app/welcome/welcome-form.tsx — reachable before the authenticated
// layout ever renders (it is what /welcome IS), so it needs no live WorkOS
// session to submit: the handler itself only calls fetch("/api/account/profile"),
// which this suite stubs.
import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render } from "@testing-library/react";
import { WelcomeNameForm } from "../../app/welcome/welcome-form.tsx";
import { stubFetch, waitForNavigationAttempt } from "./dom-env.ts";

function renderForm() {
  const view = render(
    <WelcomeNameForm locale="en" returnTo="/studio" initialFirstName="" initialLastName="" />,
  );
  const form = view.container.querySelector("form");
  assert.ok(form, "welcome form did not render a <form>");
  return { ...view, form: form as HTMLFormElement };
}

test("welcome form: submitting PATCHes the typed name and navigates onward on success", async () => {
  const fetchStub = stubFetch(() => ({ status: 200, body: { refreshed: true } }));
  try {
    const { form, getByLabelText } = renderForm();
    fireEvent.change(getByLabelText("First name"), { target: { value: "Ada" } });
    fireEvent.change(getByLabelText("Last name"), { target: { value: "Lovelace" } });

    const navigated = waitForNavigationAttempt();
    await act(async () => {
      fireEvent.submit(form);
    });

    assert.equal(fetchStub.calls.length, 1);
    const [call] = fetchStub.calls;
    assert.equal(call.url, "/api/account/profile");
    assert.equal(call.method, "PATCH");
    assert.equal(call.headers["Content-Type"], "application/json");
    assert.deepEqual(call.body, { firstName: "Ada", lastName: "Lovelace" });

    // The whole point of this form: land the visitor at `returnTo` once the
    // session is refreshed — a full navigation (`window.location.assign`),
    // not a client-side route change (see the comment in welcome-form.tsx on
    // why). jsdom cannot report WHERE it was asked to navigate (see
    // waitForNavigationAttempt's comment), only THAT a navigation was
    // attempted; the destination is the `returnTo` prop this test passed in,
    // per the one call site in welcome-form.tsx: `window.location.assign(returnTo)`.
    await navigated;
  } finally {
    fetchStub.restore();
  }
});

test("welcome form: a name with no letters is rejected client-side, before any request goes out", async () => {
  const fetchStub = stubFetch(() => ({ status: 200, body: { refreshed: true } }));
  try {
    const { form, getByLabelText, getByText } = renderForm();
    fireEvent.change(getByLabelText("First name"), { target: { value: "123" } });
    fireEvent.change(getByLabelText("Last name"), { target: { value: "Lovelace" } });

    await act(async () => {
      fireEvent.submit(form);
    });

    assert.equal(fetchStub.calls.length, 0, "an invalid name should never reach the server");
    assert.ok(getByText("Enter your first and last name."));
  } finally {
    fetchStub.restore();
  }
});

test("welcome form: refreshed:false keeps the visitor on the page with a sign-in-again notice, not a bounce", async () => {
  const fetchStub = stubFetch(() => ({ status: 200, body: { refreshed: false } }));
  try {
    const { form, getByLabelText, getByText } = renderForm();
    fireEvent.change(getByLabelText("First name"), { target: { value: "Ada" } });
    fireEvent.change(getByLabelText("Last name"), { target: { value: "Lovelace" } });

    await act(async () => {
      fireEvent.submit(form);
    });

    await assert.rejects(
      waitForNavigationAttempt(150),
      /no navigation attempt/,
      "a stale-cookie response must not navigate the visitor onward",
    );
    assert.ok(getByText("Saved. Sign in again to continue."));
  } finally {
    fetchStub.restore();
  }
});
