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

/**
 * What the deployed API actually returns to an untrusted caller on a catalog
 * route: `Cache-Control: public`, no verdict header because `public` responses
 * have it stripped, and a `Vary` naming the credential header. Captured from
 * `https://majorana-api-.../v1/catalog/entries` on 2026-08-17 rather than
 * imagined, because the bug this pins was a guess about this exact shape.
 */
function strippedVerdictHeaders(): Headers {
  return new Headers({
    "cache-control": "public, max-age=300, stale-while-revalidate=60",
    vary: `Accept-Encoding, ${TRUSTED_CALLER_HEADER}`,
  });
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
  // No header at all AND no Vary naming ours. Nothing is wrong and nothing is
  // provable — a rolling deploy passes through this state, and treating it as a
  // failure would make every deploy of the API look like a broken secret.
  const { lines, log } = collect();
  reportCallerTrust(trustHeaders(), "https://api.test/v1/catalog/entries", log, TOKEN);

  assert.deepEqual(lines, []);
});

test("a STRIPPED verdict from a current API is reported loudly", () => {
  // The regression this file exists to prevent, and the state production is
  // actually in when the secret is stale. The API strips the verdict from every
  // publicly cacheable response, and all six catalog routes are public — so the
  // failure mode presents as a MISSING header, which this function used to treat
  // as "nothing is wrong". The detector for the one failure it was written for
  // could not fire, and the test above pinned that blindness by asserting
  // silence on a bare Headers object.
  const { lines, log } = collect();
  reportCallerTrust(strippedVerdictHeaders(), "https://api.test/v1/catalog/entries", log, TOKEN);

  assert.equal(lines.length, 1, "a stale secret must not be silent");
  assert.match(lines[0]!, /TRUSTED_CALLER_TOKEN/);
  assert.match(lines[0]!, /static corpus/);
});

test("the Vary discriminator is not vacuous", () => {
  // Both arms, or the test above passes for the wrong reason. The ONLY
  // difference between this case and the loud one is the Vary header, so if
  // this also logged, the implementation would be warning on every response
  // that merely lacks a verdict — which is the false alarm the early return was
  // protecting against in the first place.
  const { lines, log } = collect();
  const noVary = new Headers({ "cache-control": "public, max-age=300" });
  reportCallerTrust(noVary, "https://api.test/v1/catalog/entries", log, TOKEN);

  assert.deepEqual(lines, [], "no Vary naming our header means we cannot tell, so stay quiet");
});

test("Vary is matched as a list entry, not as a substring", () => {
  const { lines, log } = collect();
  // A header that merely CONTAINS ours as a prefix must not count as ours.
  const lookalike = new Headers({ vary: `Accept-Encoding, ${TRUSTED_CALLER_HEADER}-Suffix` });
  reportCallerTrust(lookalike, "https://api.test/v1/catalog/entries", log, TOKEN);

  assert.deepEqual(lines, []);
});

test("an unconfigured deployment is silent even when the verdict was stripped", () => {
  // The new branch must not turn every render of an unconfigured deployment
  // into an error line — that is the noise that hides a real fault.
  const { lines, log } = collect();
  reportCallerTrust(strippedVerdictHeaders(), "https://api.test/v1/catalog/entries", log, "");

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
