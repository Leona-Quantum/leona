import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_TIERS,
  TIER_LIMITS,
  atLeastTier,
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

test("the non-WorkOS operator identities are developer without any allowlist", () => {
  // These are minted by an auth mode rather than by a sign-up, so no allowlist
  // can reach them. If this regressed, a missing environment variable would
  // silently meter the operator's own infrastructure.
  assert.equal(resolveAccountTier("local-dev@majorana.test", { allowlist: [] }), "developer");
  assert.equal(resolveAccountTier("deploy-probe@leonaquantum.com", { allowlist: [] }), "developer");
});

test("a missing identity is preview, never free", () => {
  for (const email of [null, undefined, "", "   "]) {
    assert.equal(resolveAccountTier(email, { allowlist: ALLOWLIST }), "preview");
  }
});

test("the preview surface outranks identity", () => {
  // A developer opening /demo still sees fixtures; the surface writes nothing.
  assert.equal(
    resolveAccountTier("rui@keio.jp", { isPreviewSurface: true, allowlist: ALLOWLIST }),
    "preview",
  );
});

test("only the developer tier is unlimited", () => {
  assert.equal(isUnlimited("developer"), true);
  assert.equal(isUnlimited("team"), false);
  assert.equal(isUnlimited("free"), false);
  assert.equal(isUnlimited("preview"), false);
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

test("the team allowlist grants team, and developer still wins over it", () => {
  const team = ["partner@example.org"];
  assert.equal(
    resolveAccountTier("partner@example.org", { allowlist: [], teamAllowlist: team }),
    "team",
  );
  // On both lists resolves upward, not to whichever check runs first.
  assert.equal(
    resolveAccountTier("rui@keio.jp", { allowlist: ALLOWLIST, teamAllowlist: ["rui@keio.jp"] }),
    "developer",
  );
  // And an address on neither is still free, not team.
  assert.equal(
    resolveAccountTier("stranger@example.com", { allowlist: [], teamAllowlist: team }),
    "free",
  );
});

test("sharing a project is a team capability and nothing below it has one", () => {
  // The web copy of the rule the control plane enforces. If these disagree the
  // browser offers a button that 403s, or hides one that would have worked.
  assert.equal(limitsForTier("preview").projectSharing, false);
  assert.equal(limitsForTier("free").projectSharing, false);
  assert.equal(limitsForTier("team").projectSharing, true);
  assert.equal(limitsForTier("developer").projectSharing, true);
});

test("every capability is monotonic up the ladder", () => {
  // A tier inserted in the middle must not take something away from the tier
  // above it. Written as a sweep rather than as four assertions so that adding
  // a fifth tier is covered without editing this test.
  for (let i = 1; i < ACCOUNT_TIERS.length; i += 1) {
    const lower = limitsForTier(ACCOUNT_TIERS[i - 1]);
    const upper = limitsForTier(ACCOUNT_TIERS[i]);
    const atLeast = (a: number | null, b: number | null) => a === null || (b !== null && a >= b);
    assert.ok(
      atLeast(upper.agentRunsPerWeek, lower.agentRunsPerWeek),
      `${ACCOUNT_TIERS[i]} runs below ${ACCOUNT_TIERS[i - 1]}`,
    );
    assert.ok(
      atLeast(upper.privateArtifacts, lower.privateArtifacts),
      `${ACCOUNT_TIERS[i]} artifacts below ${ACCOUNT_TIERS[i - 1]}`,
    );
    assert.ok(
      !lower.projectSharing || upper.projectSharing,
      `${ACCOUNT_TIERS[i]} loses sharing that ${ACCOUNT_TIERS[i - 1]} has`,
    );
    assert.ok(
      atLeast(upper.sharedProjects, lower.sharedProjects),
      `${ACCOUNT_TIERS[i]} shared projects below ${ACCOUNT_TIERS[i - 1]}`,
    );
  }
});

test("a tier that cannot share has no membership allowance either", () => {
  // The two fields say different things — one refuses granting, the other
  // counts what has been received — and a tier that gains `projectSharing`
  // without a number would gain an unbounded allowance with it, silently.
  for (const tier of ACCOUNT_TIERS) {
    const limits = limitsForTier(tier);
    if (!limits.projectSharing) {
      assert.equal(limits.sharedProjects, 0, `${tier} cannot share but may be in projects`);
    }
  }
});

test("atLeastTier reads the ladder, not a hand-written comparison", () => {
  assert.equal(atLeastTier("team", "team"), true);
  assert.equal(atLeastTier("developer", "team"), true);
  assert.equal(atLeastTier("free", "team"), false);
  assert.equal(atLeastTier("preview", "free"), false);
});

test("the published Team plan quotes the artifact allowance the tier grants", async () => {
  // Same pin as the Free plan above, for the same reason: the pricing page is
  // prose, and prose that overstates an allowance is a promise the product
  // breaks the first time somebody reaches it.
  const { PRICING_COPY } = await import("./public-copy.ts");
  const team = PRICING_COPY.en.plans.find((plan) => plan.name === "Team");
  assert.ok(team, "the Team plan disappeared from the pricing page");
  const features = team.features.join(" | ");
  assert.match(features, new RegExp(`\\b${TIER_LIMITS.team.privateArtifacts}\\b`));
  assert.match(features, new RegExp(`\\b${TIER_LIMITS.team.sharedProjects}\\b.*shared project`, "i"));
});

test("both published Team plans quote the same numbers", async () => {
  // The Japanese page is a separate literal, so a number changed on one side
  // stays wrong on the other until somebody reads both — that is exactly how
  // the JA privacy section disappeared in PR 194. Nothing else on these lines
  // can be compared across the two scripts, but digits are digits.
  const { PRICING_COPY } = await import("./public-copy.ts");
  const en = PRICING_COPY.en.plans.find((plan) => plan.name === "Team");
  const ja = PRICING_COPY.ja.plans.find((plan) => plan.name === "Team");
  assert.ok(en, "the Team plan disappeared from the English pricing page");
  assert.ok(ja, "the Team plan disappeared from the Japanese pricing page");
  // Each ALLOWANCE, asked for by name, rather than every digit on the line:
  // the first version of this test compared all of them and failed on the "1"
  // in 1人あたり, which is prose. What has to agree is the numbers the tier
  // enforces, and those are these four.
  const limits = TIER_LIMITS.team;
  const advertised = [
    limits.sharedProjects,
    limits.agentRunsPerWeek,
    limits.privateArtifacts,
    limits.cpuSimQubits,
  ];
  for (const value of advertised) {
    const pattern = new RegExp(`(^|\\D)${value}(\\D|$)`);
    assert.match(en.features.join(" | "), pattern, `the English Team plan does not state ${value}`);
    assert.match(ja.features.join(" | "), pattern, `the Japanese Team plan does not state ${value}`);
  }
});
