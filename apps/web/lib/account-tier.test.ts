import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_TIERS,
  TIER_LIMITS,
  developerEmails,
  grantsQpuSubmission,
  isUnlimited,
  limitsForTier,
  resolveAccountTier,
} from "./account-tier.ts";

const ALLOWLIST = ["rui@keio.jp", "rei@keio.jp", "ryu@gmail.com"];

test("the allowlist is empty unless the environment supplies one", () => {
  // The repository is public; a default that contained real addresses would
  // publish them. This is the test that keeps that true.
  assert.deepEqual(developerEmails(undefined), []);
  assert.deepEqual(developerEmails(""), []);
});

test("allowlist parsing tolerates commas, whitespace, case and stray entries", () => {
  assert.deepEqual(
    developerEmails(" Rui@Keio.jp,rei@keio.jp\n  ryu@gmail.com , not-an-email "),
    ALLOWLIST,
  );
});

test("an allowlisted address resolves to developer regardless of case or padding", () => {
  for (const email of ["rui@keio.jp", "  RUI@KEIO.JP  "]) {
    assert.equal(resolveAccountTier(email, { allowlist: ALLOWLIST }), "developer");
  }
});

test("a signed-in address that is not allowlisted is free, not developer", () => {
  assert.equal(resolveAccountTier("stranger@example.com", { allowlist: ALLOWLIST }), "free");
});

test("both non-WorkOS operator identities are developer without any allowlist", () => {
  // Production runs behind the single-user lock today, so if this regressed the
  // owner would silently drop to the free tier on their own deployment.
  assert.equal(resolveAccountTier("operator@leonaquantum.com", { allowlist: [] }), "developer");
  assert.equal(resolveAccountTier("local-dev@majorana.test", { allowlist: [] }), "developer");
});

test("a missing identity is demo, never free", () => {
  for (const email of [null, undefined, "", "   "]) {
    assert.equal(resolveAccountTier(email, { allowlist: ALLOWLIST }), "demo");
  }
});

test("the demo surface outranks identity", () => {
  // A developer opening /demo still sees fixtures; the surface writes nothing.
  assert.equal(
    resolveAccountTier("rui@keio.jp", { isDemoSurface: true, allowlist: ALLOWLIST }),
    "demo",
  );
});

test("only the developer tier is unlimited", () => {
  assert.equal(isUnlimited("developer"), true);
  assert.equal(isUnlimited("free"), false);
  assert.equal(isUnlimited("demo"), false);
});

test("developer ceilings are at or above every other tier", () => {
  const dev = limitsForTier("developer");
  for (const tier of ACCOUNT_TIERS) {
    const limits = limitsForTier(tier);
    assert.ok(dev.cpuSimQubits >= limits.cpuSimQubits, `${tier} qubits`);
    assert.ok(dev.cpuSimOperations >= limits.cpuSimOperations, `${tier} operations`);
    assert.ok(dev.cpuSimShots >= limits.cpuSimShots, `${tier} shots`);
  }
});

test("the browser lane stays inside the measured responsiveness budget", () => {
  // 22 qubits measured 5.0 s on fast hardware at ~1,000 gates, on the main
  // thread. Anything at or above that freezes the tab, so no tier may go there.
  for (const tier of ACCOUNT_TIERS) {
    assert.ok(
      TIER_LIMITS[tier].cpuSimQubits <= 20,
      `${tier} exceeds the measured browser budget`,
    );
  }
});

test("the public Free plan quotes the numbers the free tier actually enforces", async () => {
  // The pricing page states allowances as prose, so nothing but a pin stops it
  // drifting from TIER_LIMITS. A plan that overstates the allowance is a
  // promise the product then breaks.
  const { PRICING_COPY } = await import("./public-copy.ts");
  const free = PRICING_COPY.en.plans.find((plan) => plan.name === "Free");
  assert.ok(free, "the Free plan disappeared from the pricing page");
  const features = free.features.join(" | ");
  const limits = TIER_LIMITS.free;
  assert.match(features, new RegExp(`\\b${limits.agentRunsPerWeek}\\b.*week`, "i"));
  assert.match(features, new RegExp(`\\b${limits.privateArtifacts}\\b`));
  assert.match(features, new RegExp(`\\b${limits.cpuSimQubits}\\b.*qubit`, "i"));
});

test("no tier grants QPU submission", () => {
  // "Unlimited" is a product allowance, never a safety gate. Real hardware
  // submission stays fail-closed behind the three deployment decisions.
  for (const tier of ACCOUNT_TIERS) {
    assert.equal(grantsQpuSubmission(tier), false, `${tier} must not bypass the QPU gate`);
  }
});
