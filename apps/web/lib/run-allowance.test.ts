import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { artifactAllowanceRefusal } from "./run-allowance.ts";

/**
 * The `assessRunAllowance` suite that used to sit here is gone with the function.
 *
 * It was thorough and it passed — rolling window, shared-workspace attribution,
 * reset dates — about a gate the control plane had already stopped applying. Its
 * green tick said nothing about whether a user could submit a run, which is the
 * only question that mattered, and it would have kept saying nothing while the
 * BFF refused free accounts the server was willing to admit.
 *
 * The weekly allowance is tested where it is now enforced:
 * `services/api/tests/test_run_tier_allowance.py` and `test_usage_endpoint.py`.
 */

describe("refusal payloads", () => {
  it("artifact refusal explains the way forward, not just the wall", () => {
    const refusal = artifactAllowanceRefusal(25, 25);
    assert.equal(refusal.reason, "artifact_allowance_exhausted");
    assert.match(refusal.error, /Archive an artifact/);
    assert.equal(refusal.used, 25);
    assert.equal(refusal.limit, 25);
  });
});
