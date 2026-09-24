// Real submission coverage for the access-tokens panel
// (apps/web/app/(app)/account/access-tokens.tsx), ai-ops 376 option 2: the
// "hardware" checkbox a person ticks when minting a token, and that a token's
// hardware scope shows up in the list. Same pattern as
// workspace-sharing.test.tsx — a plain fetch()-driven client component, no
// live WorkOS session needed.
import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { AccessTokens } from "../../app/(app)/account/access-tokens.tsx";
import { ACCOUNT_COPY } from "../../lib/workspace-locale.ts";
import { stubFetch, type RecordedRequest } from "./dom-env.ts";

const copy = ACCOUNT_COPY.en;

function stubTokens(
  list: unknown[],
  extraHandlers: (request: RecordedRequest) => { status: number; body?: unknown } | undefined = () => undefined,
) {
  return stubFetch((request) => {
    if (request.method === "GET" && request.url === "/api/tokens") {
      return { status: 200, body: { tokens: list } };
    }
    const handled = extraHandlers(request);
    if (handled) return handled;
    throw new Error(`unexpected request in this test: ${request.method} ${request.url}`);
  });
}

async function renderPanel(list: unknown[] = []) {
  const fetchStub = stubTokens(list);
  const view = render(<AccessTokens locale="en" />);
  if (list.length === 0) {
    await waitFor(() => assert.ok(view.getByText(copy.tokensEmpty)));
  } else {
    await waitFor(() => assert.ok(view.queryByText(copy.tokensLoading) === null));
  }
  return { ...view, fetchStub };
}

test("access tokens: the hardware checkbox is unchecked by default, and a token minted without touching it carries no hardware scope", async () => {
  const fetchStub = stubTokens([], (request) => {
    if (request.method === "POST" && request.url === "/api/tokens") {
      return { status: 201, body: { token: "lq_pat_test789", record: {} } };
    }
  });
  try {
    const view = render(<AccessTokens locale="en" />);
    await waitFor(() => assert.ok(view.getByText(copy.tokensEmpty)));

    const hardwareField = view.getByLabelText(copy.tokensAllowHardware) as HTMLInputElement;
    assert.equal(hardwareField.checked, false, "the hardware checkbox must start OFF");
    const runField = view.getByLabelText(copy.tokensAllowRuns) as HTMLInputElement;
    assert.equal(runField.checked, false, "the run checkbox must start OFF too");

    const nameField = view.getByLabelText(copy.tokensName) as HTMLInputElement;
    fireEvent.change(nameField, { target: { value: "CI script" } });
    const form = nameField.closest("form");
    assert.ok(form, "no <form> around the token-name field");
    await act(async () => {
      fireEvent.submit(form!);
    });

    const post = fetchStub.calls.find((c) => c.method === "POST" && c.url === "/api/tokens");
    assert.ok(post, "minting never POSTed to /api/tokens");
    const body = post.body as { scopes?: string[] };
    assert.deepEqual(body.scopes, ["read"]);
  } finally {
    fetchStub.restore();
  }
});

test("access tokens: ticking only 'hardware' POSTs scopes [read, hardware], never run", async () => {
  const fetchStub = stubTokens([], (request) => {
    if (request.method === "POST" && request.url === "/api/tokens") {
      return { status: 201, body: { token: "lq_pat_test123", record: {} } };
    }
  });
  try {
    const view = render(<AccessTokens locale="en" />);
    await waitFor(() => assert.ok(view.getByText(copy.tokensEmpty)));

    const nameField = view.getByLabelText(copy.tokensName) as HTMLInputElement;
    fireEvent.change(nameField, { target: { value: "Notebook bridge" } });
    const hardwareField = view.getByLabelText(copy.tokensAllowHardware);
    fireEvent.click(hardwareField);
    // The `run` checkbox is left untouched — proving hardware does not imply run
    // at the form layer either, mirroring TokenScope's own independence.
    const runField = view.getByLabelText(copy.tokensAllowRuns) as HTMLInputElement;
    assert.equal(runField.checked, false);

    const form = nameField.closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });

    const post = fetchStub.calls.find((c) => c.method === "POST" && c.url === "/api/tokens");
    assert.ok(post, "minting never POSTed to /api/tokens");
    const body = post.body as { scopes?: string[] };
    assert.deepEqual(body.scopes, ["read", "hardware"]);
  } finally {
    fetchStub.restore();
  }
});

test("access tokens: ticking both 'run' and 'hardware' POSTs all three scopes, in order", async () => {
  const fetchStub = stubTokens([], (request) => {
    if (request.method === "POST" && request.url === "/api/tokens") {
      return { status: 201, body: { token: "lq_pat_test456", record: {} } };
    }
  });
  try {
    const view = render(<AccessTokens locale="en" />);
    await waitFor(() => assert.ok(view.getByText(copy.tokensEmpty)));

    fireEvent.change(view.getByLabelText(copy.tokensName), { target: { value: "Both" } });
    fireEvent.click(view.getByLabelText(copy.tokensAllowRuns));
    fireEvent.click(view.getByLabelText(copy.tokensAllowHardware));

    const form = view.getByLabelText(copy.tokensName).closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });

    const post = fetchStub.calls.find((c) => c.method === "POST" && c.url === "/api/tokens");
    assert.ok(post);
    const body = post.body as { scopes?: string[] };
    assert.deepEqual(body.scopes, ["read", "run", "hardware"]);
  } finally {
    fetchStub.restore();
  }
});

test("access tokens: a listed token with the hardware scope shows 'can submit to hardware'; one without does not", async () => {
  const active = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const list = [
    {
      id: "tok_hw",
      tail: "hwtl",
      name: "Hardware token",
      workspace_id: "ws_1",
      scopes: ["read", "hardware"],
      created_at: "2026-01-01T00:00:00Z",
      expires_at: active,
      last_used_at: null,
      revoked_at: null,
    },
    {
      id: "tok_read",
      tail: "rdtl",
      name: "Read only token",
      workspace_id: "ws_1",
      scopes: ["read"],
      created_at: "2026-01-01T00:00:00Z",
      expires_at: active,
      last_used_at: null,
      revoked_at: null,
    },
  ];
  const { getByText, queryAllByText } = await renderPanel(list);

  assert.ok(getByText("Hardware token"));
  assert.ok(getByText("Read only token"));
  // Exactly one row carries the hardware label — the read-only token's row must
  // not also render it.
  assert.equal(queryAllByText(new RegExp(copy.tokensCanSubmitHardware)).length, 1);
});
