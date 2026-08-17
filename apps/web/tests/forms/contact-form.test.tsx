// Real submission coverage for the contact form (ai-ops issue 123).
// apps/web/app/[locale]/contact/contact-form.tsx — public, unauthenticated.
//
// Uses the queries `render()` returns rather than the `screen` global: this
// suite's esbuild bundle merges every local file into one module, so ALL
// external imports (jsdom, @testing-library/react, ...) evaluate before ANY
// of this suite's own top-level code runs — @testing-library/dom's `screen`
// singleton resolves `document.body` once, eagerly, at ITS module-evaluation
// time, which lands before jsdom-globals.ts's setup code ever gets to run.
// `render()`'s bound queries are computed fresh on each call, well after the
// module has finished loading, so they see the real jsdom document.
import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { ContactForm } from "../../app/[locale]/contact/contact-form.tsx";
import { stubFetch, waitForNavigationAttempt } from "./dom-env.ts";

function renderForm() {
  const view = render(<ContactForm locale="en" />);
  const form = view.container.querySelector("form");
  assert.ok(form, "contact form did not render a <form>");
  return { ...view, form: form as HTMLFormElement };
}

test("contact form: probes /api/contact for delivery mode on mount", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "GET" && request.url === "/api/contact") {
      return { status: 200, body: { configured: true } };
    }
    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  });
  try {
    render(<ContactForm locale="en" />);
    await waitFor(() => {
      assert.equal(fetchStub.calls.length, 1);
    });
    assert.equal(fetchStub.calls[0].method, "GET");
    assert.equal(fetchStub.calls[0].url, "/api/contact");
  } finally {
    fetchStub.restore();
  }
});

test("contact form: submitting sends the exact fields the visitor typed, as JSON, to POST /api/contact", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "GET") return { status: 200, body: { configured: true } };
    return { status: 200, body: { ok: true } };
  });
  try {
    const { form, getByLabelText, getByRole } = renderForm();
    await waitFor(() => assert.equal(fetchStub.calls.some((c) => c.method === "GET"), true));

    fireEvent.change(getByLabelText("Name"), { target: { value: "Ada Lovelace" } });
    fireEvent.change(getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(getByLabelText("Message"), { target: { value: "Does Leona support Cirq?" } });

    await act(async () => {
      fireEvent.submit(form);
    });

    const post = fetchStub.calls.find((c) => c.method === "POST");
    assert.ok(post, "submitting the form never POSTed to /api/contact — the actual assertion this suite exists for");
    assert.equal(post.url, "/api/contact");
    assert.equal(post.headers["Content-Type"], "application/json");
    assert.deepEqual(post.body, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      topic: "Product access",
      message: "Does Leona support Cirq?",
      website: "",
    });

    // Success shows the server-delivery thank-you copy — the contract a
    // visitor actually reads, not just "the request went out".
    await waitFor(() => {
      assert.equal(
        getByRole("status").textContent,
        "Thanks — that reached us. We reply from a person, usually within a couple of days.",
      );
    });
  } finally {
    fetchStub.restore();
  }
});

test("contact form: a 400 from the server renders the server's own reason, not a generic failure", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "GET") return { status: 200, body: { configured: true } };
    return { status: 400, body: { error: "That email address does not look right." } };
  });
  try {
    const { form, getByLabelText, getByRole } = renderForm();
    await waitFor(() => assert.equal(fetchStub.calls.some((c) => c.method === "GET"), true));

    fireEvent.change(getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.change(getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.change(getByLabelText("Message"), { target: { value: "Hi" } });

    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() => {
      assert.equal(getByRole("status").textContent, "That email address does not look right.");
    });
    // The button must not be left disabled on a failure — that would strand
    // the visitor on a form they cannot retry.
    assert.equal(getByRole("button", { name: /Send/i }).hasAttribute("disabled"), false);
  } finally {
    fetchStub.restore();
  }
});

// Production runs this branch today: RESEND_API_KEY/CONTACT_FROM/CONTACT_INBOX
// are unset, so GET /api/contact answers configured:false and the form's
// button starts on the conservative "Prepare inquiry" (mailto) wording — see
// the component's own comment on why the default has to be the conservative
// one. Submitting still POSTs first regardless of `delivery`; the mailto
// fallback is driven entirely by the POST response's status, not by what the
// mount-time probe said. These three tests cover that whole branch, which the
// tests above (GET configured:true, POST 200/400) do not touch at all.
test("contact form: an unconfigured deployment shows the mailto wording, not the server-delivery one", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "GET" && request.url === "/api/contact") {
      return { status: 200, body: { configured: false } };
    }
    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  });
  try {
    const { getByRole, getByText } = renderForm();
    await waitFor(() => assert.equal(getByRole("button").textContent, "Prepare inquiry"));
    assert.ok(getByText("Submitting opens a prepared email in your email app."));
  } finally {
    fetchStub.restore();
  }
});

test("contact form: a 503 from POST (no sender configured) opens the mailto fallback with the server's address", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "GET") return { status: 200, body: { configured: false } };
    if (request.method === "POST") {
      return { status: 503, body: { mailto: "mailto:hello@leonaqt.com?subject=placeholder" } };
    }
    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  });
  try {
    const { form, getByLabelText, getByRole } = renderForm();
    await waitFor(() => assert.equal(fetchStub.calls.some((c) => c.method === "GET"), true));

    fireEvent.change(getByLabelText("Name"), { target: { value: "Ada Lovelace" } });
    fireEvent.change(getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(getByLabelText("Message"), { target: { value: "Does Leona support Cirq?" } });

    // The fallback still POSTs first — this proves that, not just that a
    // mailto link eventually opens.
    const navigated = waitForNavigationAttempt();
    await act(async () => {
      fireEvent.submit(form);
    });
    const post = fetchStub.calls.find((c) => c.method === "POST");
    assert.ok(post, "the mailto fallback must still try the real POST first");
    assert.deepEqual(post.body, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      topic: "Product access",
      message: "Does Leona support Cirq?",
      website: "",
    });

    // jsdom cannot report the mailto: URL it was asked to open (see
    // waitForNavigationAttempt's comment) — this proves openMailto() actually
    // ran, which given a valid `mailto:` body it only does past its guard
    // clause (covered by the next test for an invalid one).
    await navigated;
    await waitFor(() => {
      assert.equal(
        getByRole("status").textContent,
        "Your email app should open with the inquiry prepared. Send it to add the note to the queue.",
      );
    });
  } finally {
    fetchStub.restore();
  }
});

test("contact form: a malformed mailto address from the server (misconfigured CONTACT_FALLBACK) fails loudly instead of silently doing nothing", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "GET") return { status: 200, body: { configured: false } };
    // No scheme — exactly the misconfiguration contact-form.tsx's own comment
    // describes as "the obvious way" CONTACT_FALLBACK breaks.
    if (request.method === "POST") return { status: 503, body: { mailto: "hello@leonaqt.com" } };
    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  });
  try {
    const { form, getByLabelText, getByRole } = renderForm();
    await waitFor(() => assert.equal(fetchStub.calls.some((c) => c.method === "GET"), true));

    fireEvent.change(getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.change(getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(getByLabelText("Message"), { target: { value: "Hi" } });

    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() => {
      assert.equal(getByRole("status").textContent, "That did not send. Try again in a moment, or write to us directly.");
    });
  } finally {
    fetchStub.restore();
  }
});

test("contact form: honeypot field is present, hidden, and not part of what a keyboard user tabs through", async () => {
  const { container } = renderForm();
  const honeypot = container.querySelector('input[name="website"]');
  assert.ok(honeypot, "no honeypot field — a bot filling every visible field would go undetected");
  assert.equal(honeypot.getAttribute("tabindex"), "-1");
  assert.equal(honeypot.closest('[aria-hidden="true"]') !== null, true);
});
