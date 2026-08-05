import assert from "node:assert/strict";
import test from "node:test";
import { getPrivateMvpCapabilityManifest } from "./private-mvp-source.ts";

test("private MVP manifest keeps publication and unsupported claims blocked", () => {
  const manifest = getPrivateMvpCapabilityManifest();
  assert.equal(manifest.claim_boundary.publication, "blocked");
  assert.equal(manifest.claim_boundary.scientific_superiority_claim, "blocked");
  assert.equal(manifest.claim_boundary.external_repository_execution, "blocked");
});

test("only parameter_optimizer changes in the primary controlled comparison", () => {
  const comparison = manifest().golden_journeys.controlled_slsqp_to_cobyla;
  assert.deepEqual(comparison.changed_roles, ["parameter_optimizer"]);
  assert.equal(comparison.status, "NOT_RUN");
  assert.equal(comparison.go_decision, "unavailable");
});

function manifest() {
  return getPrivateMvpCapabilityManifest();
}
