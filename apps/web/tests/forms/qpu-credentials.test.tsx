// Real submission coverage for the QPU credentials form (ai-ops issue 123).
// apps/web/app/(app)/account/qpu-credentials.tsx — the fields carry no `name`
// attribute by design (see the file's own top comment: a form with named
// fields and no `action` falls back to a GET-to-current-URL if the submit
// handler ever fails to run, which would put the API key in the address bar).
// That means this form's payload can only be checked by asserting on the
// fetch call the handler makes, not by reading FormData off the <form> —
// exactly what this suite does.
import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { QpuCredentials } from "../../app/(app)/account/qpu-credentials.tsx";
import { stubFetch } from "./dom-env.ts";

const NOT_CONNECTED = { connected: false, storage_available: true };

async function renderAndWaitForForm(fetchStub: ReturnType<typeof stubFetch>) {
  const view = render(<QpuCredentials locale="en" />);
  await waitFor(() => assert.ok(view.queryByLabelText(/^IBM API key/)));
  const form = view.container.querySelector("form.mj-qpu-form");
  assert.ok(form, "qpu credentials did not render the connect <form>");
  return { ...view, form: form as HTMLFormElement, fetchStub };
}

test("qpu credentials: connecting PUTs the key, instance and label to /api/qpu/credentials", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "GET" && request.url === "/api/qpu/credentials") return { status: 200, body: NOT_CONNECTED };
    if (request.method === "PUT" && request.url === "/api/qpu/credentials") {
      return {
        status: 200,
        body: {
          connected: true,
          label: "Lab key",
          instance: "crn:v1:bluemix:public:quantum-computing:us-east:...",
          created_at: "2026-08-01T00:00:00Z",
          last_verified_at: "2026-08-01T00:00:00Z",
          last_used_at: null,
          storage_available: true,
        },
      };
    }
    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  });
  try {
    const { form, getByLabelText, getByText } = await renderAndWaitForForm(fetchStub);

    fireEvent.change(getByLabelText(/^IBM API key/), { target: { value: "a".repeat(44) } });
    fireEvent.change(getByLabelText(/^Instance CRN/), { target: { value: "crn:v1:bluemix:public:quantum-computing:us-east:..." } });
    fireEvent.change(getByLabelText(/^Label/), { target: { value: "Lab key" } });

    await act(async () => {
      fireEvent.submit(form);
    });

    const put = fetchStub.calls.find((c) => c.method === "PUT");
    assert.ok(put, "connecting never PUT /api/qpu/credentials");
    assert.equal(put.url, "/api/qpu/credentials");
    assert.deepEqual(put.body, {
      provider: "ibm",
      api_key: "a".repeat(44),
      instance: "crn:v1:bluemix:public:quantum-computing:us-east:...",
      label: "Lab key",
    });

    await waitFor(() => assert.ok(getByText("IBM accepted the key. Leona stored it encrypted and will not show it again.")));
  } finally {
    fetchStub.restore();
  }
});

test("qpu credentials: IBM rejecting the key shows the rejection sentence and the key stays for correction", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "GET" && request.url === "/api/qpu/credentials") return { status: 200, body: NOT_CONNECTED };
    if (request.method === "PUT" && request.url === "/api/qpu/credentials") {
      return {
        status: 400,
        body: { detail: { reason: "credential_rejected", error: "Invalid API key" } },
      };
    }
    throw new Error(`unexpected: ${request.method} ${request.url}`);
  });
  try {
    const { form, getByLabelText, getByText } = await renderAndWaitForForm(fetchStub);
    const keyField = getByLabelText(/^IBM API key/) as HTMLInputElement;
    fireEvent.change(keyField, { target: { value: "not-a-real-key" } });

    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() =>
      assert.ok(
        getByText(
          "IBM did not accept that key. Check that you copied all 44 characters, and that the key has not been revoked or deleted on IBM's dashboard.",
        ),
      ),
    );
    assert.ok(getByText("IBM said: Invalid API key"));
    // A rejected key stays in the field for correction — only the storage
    // failure clears it (see connect() in qpu-credentials.tsx).
    assert.equal(keyField.value, "not-a-real-key");
  } finally {
    fetchStub.restore();
  }
});

test("qpu credentials: a connected account shows Disconnect, and confirming DELETEs the credential", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "GET" && request.url === "/api/qpu/credentials") {
      return {
        status: 200,
        body: {
          connected: true,
          label: "Lab key",
          instance: null,
          created_at: "2026-08-01T00:00:00Z",
          last_verified_at: null,
          last_used_at: null,
          storage_available: true,
        },
      };
    }
    if (request.method === "DELETE" && request.url === "/api/qpu/credentials?provider=ibm") {
      return { status: 200, body: {} };
    }
    throw new Error(`unexpected: ${request.method} ${request.url}`);
  });
  try {
    const view = render(<QpuCredentials locale="en" />);
    const disconnectButton = await view.findByRole("button", { name: "Disconnect" });

    await act(async () => {
      fireEvent.click(disconnectButton);
    });
    const confirmButton = await view.findByRole("button", { name: "Yes, disconnect" });
    await act(async () => {
      fireEvent.click(confirmButton);
    });

    const del = fetchStub.calls.find((c) => c.method === "DELETE");
    assert.ok(del, "confirming disconnect never DELETEd the credential");
    assert.equal(del.url, "/api/qpu/credentials?provider=ibm");
    await waitFor(() => assert.ok(view.getByText("Your IBM key was removed. Leona no longer holds it.")));
  } finally {
    fetchStub.restore();
  }
});
