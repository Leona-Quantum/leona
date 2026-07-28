import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAllowedVqeProxyRequest } from "./vqe-proxy-policy.ts";

const SPEC_ID = "11111111-1111-4111-8111-111111111111";

describe("authenticated VQE proxy policy", () => {
  it("permits controlled-comparison create, reopen, and run finalization", () => {
    assert.equal(
      isAllowedVqeProxyRequest("controlled-comparisons", "POST"),
      true,
    );
    assert.equal(
      isAllowedVqeProxyRequest(`controlled-comparisons/${SPEC_ID}`, "GET"),
      true,
    );
    assert.equal(
      isAllowedVqeProxyRequest(
        `controlled-comparisons/${SPEC_ID}/runs`,
        "POST",
      ),
      true,
    );
  });

  it("keeps unsupported methods and path variants fail closed", () => {
    assert.equal(
      isAllowedVqeProxyRequest("controlled-comparisons", "GET"),
      false,
    );
    assert.equal(
      isAllowedVqeProxyRequest(
        `controlled-comparisons/${SPEC_ID}/runs`,
        "GET",
      ),
      false,
    );
    assert.equal(
      isAllowedVqeProxyRequest(
        `controlled-comparisons/${SPEC_ID}/publish`,
        "POST",
      ),
      false,
    );
    assert.equal(
      isAllowedVqeProxyRequest(`controlled-comparisons/${SPEC_ID}`, "DELETE"),
      false,
    );
  });
});
