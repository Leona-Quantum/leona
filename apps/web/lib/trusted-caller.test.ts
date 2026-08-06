import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CALLER_TRUST_HEADER,
  TRUSTED_CALLER_HEADER,
  reportCallerTrust,
  trustedCallerToken,
  withTrustedCallerHeader,
} from "./trusted-caller.ts";

const TOKEN = "trusted-caller-token-for-tests-0123456789";

function trustHeaders(verdict?: string): Headers {
  return new Headers(verdict === undefined ? {} : { [CALLER_TRUST_HEADER]: verdict });
}

function collect(): { lines: string[]; log: (message: string) => void } {
  const lines: string[] = [];
  return { lines, log: (message) => lines.push(message) };
}

test("a configured deployment sends the secret", () => {
  const headers = withTrustedCallerHeader({ Accept: "application/json" }, TOKEN);

  assert.equal(headers[TRUSTED_CALLER_HEADER], TOKEN);
  assert.equal(headers.Accept, "application/json", "the base headers must survive");
});

test("an unconfigured deployment sends nothing rather than an empty header", () => {
  // Not merely cosmetic: an empty header is a value the API would have to make
  // a decision about, and the decision it would have to make is the one that
  // hands the exemption to every anonymous caller.
  const headers = withTrustedCallerHeader({ Accept: "application/json" }, "");

  assert.deepEqual(headers, { Accept: "application/json" });
  assert.ok(!(TRUSTED_CALLER_HEADER in headers));
});

test("the base headers are not mutated", () => {
  // The caller passes an object literal today, so this is a property rather than
  // a bug fixed — pinned because the fix for a duplicated-header problem is
  // usually to mutate, and this object is shared with the fetch options.
  const base = { Accept: "application/json" };
  withTrustedCallerHeader(base, TOKEN);

  assert.deepEqual(base, { Accept: "application/json" });
});

test("a token that the API rejected is reported loudly", () => {
  // The whole reason the verdict is echoed. This is the state a wrong or stale
  // secret produces, and it has no other symptom: the page renders, from data
  // that is quietly about to go stale.
  const { lines, log } = collect();
  reportCallerTrust(trustHeaders("anonymous"), "https://api.test/v1/catalog/entries", log, TOKEN);

  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /TRUSTED_CALLER_TOKEN/);
  assert.match(lines[0]!, /static corpus/);
});

test("a token the API accepted says nothing", () => {
  const { lines, log } = collect();
  reportCallerTrust(trustHeaders("trusted"), "https://api.test/v1/catalog/entries", log, TOKEN);

  assert.deepEqual(lines, []);
});

test("an unconfigured deployment is not warned about being anonymous", () => {
  // It never claimed otherwise. Logging here would put an error line on every
  // page render of a deployment that is working exactly as configured, which is
  // the noise that makes a real fault hard to see.
  const { lines, log } = collect();
  reportCallerTrust(trustHeaders("anonymous"), "https://api.test/v1/catalog/entries", log, "");

  assert.deepEqual(lines, []);
});

test("an API that predates the exemption is not reported as a fault", () => {
  // No header at all. Nothing is wrong and nothing is provable — a rolling
  // deploy passes through this state, and treating it as a failure would make
  // every deploy of the API look like a broken secret.
  const { lines, log } = collect();
  reportCallerTrust(trustHeaders(), "https://api.test/v1/catalog/entries", log, TOKEN);

  assert.deepEqual(lines, []);
});

test("the verdict is read case- and whitespace-insensitively", () => {
  const { lines, log } = collect();
  reportCallerTrust(trustHeaders("  TRUSTED "), "https://api.test/x", log, TOKEN);

  assert.deepEqual(lines, [], "a header the API padded must not read as a rejection");
});

test("an unset environment variable reads as unconfigured", () => {
  const previous = process.env.MAJORANA_TRUSTED_CALLER_TOKEN;
  try {
    delete process.env.MAJORANA_TRUSTED_CALLER_TOKEN;
    assert.equal(trustedCallerToken(), "");

    // Whitespace-only is the shape a half-filled dashboard field produces, and
    // it must read as absent rather than as a one-space secret.
    process.env.MAJORANA_TRUSTED_CALLER_TOKEN = "   ";
    assert.equal(trustedCallerToken(), "");

    process.env.MAJORANA_TRUSTED_CALLER_TOKEN = `  ${TOKEN}  `;
    assert.equal(trustedCallerToken(), TOKEN);
  } finally {
    if (previous === undefined) delete process.env.MAJORANA_TRUSTED_CALLER_TOKEN;
    else process.env.MAJORANA_TRUSTED_CALLER_TOKEN = previous;
  }
});
