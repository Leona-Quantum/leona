import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_TIERS,
  DEFAULT_PROJECT_ARTIFACT_LIMIT,
  TIER_LIMITS,
  atLeastTier,
  developerEmails,
  grantsQpuSubmission,
  isUnlimited,
  limitsForTier,
  proEmails,
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

test("the pro allowlist is empty by default and never hardcoded", () => {
  // Same rule as the other two: this repository is public, so a default holding
  // real addresses would publish them.
  //
  // `proEmails(undefined)` falls back to `process.env.LEONA_PRO_EMAILS`, so
  // asserting it is empty asserts something about the machine running the test,
  // not about the parser. Today that variable is unset everywhere and the
  // assertion passes for a reason that has nothing to do with the code. The
  // environment is therefore staged and restored, and the default is checked
  // for what it actually is: a read of that variable.
  const saved = process.env.LEONA_PRO_EMAILS;
  try {
    delete process.env.LEONA_PRO_EMAILS;
    assert.deepEqual(proEmails(undefined), []);
    process.env.LEONA_PRO_EMAILS = "Someone@Example.org";
    assert.deepEqual(proEmails(undefined), ["someone@example.org"]);
  } finally {
    if (saved === undefined) delete process.env.LEONA_PRO_EMAILS;
    else process.env.LEONA_PRO_EMAILS = saved;
  }
  assert.deepEqual(proEmails(""), []);
  assert.deepEqual(proEmails(" Rui@Keio.jp, not-an-email "), ["rui@keio.jp"]);
});

test("the pro allowlist grants pro, and both lists above it win", () => {
  const pro = ["plus@example.org"];
  assert.equal(
    resolveAccountTier("plus@example.org", { allowlist: [], teamAllowlist: [], proAllowlist: pro }),
    "pro",
  );
  // Highest first, in the same order the control plane resolves — a browser
  // that resolved pro for a Team address would hide a Share button that works.
  assert.equal(
    resolveAccountTier("both@example.org", {
      allowlist: [],
      teamAllowlist: ["both@example.org"],
      proAllowlist: ["both@example.org"],
    }),
    "team",
  );
  assert.equal(
    resolveAccountTier("both@example.org", {
      allowlist: ["both@example.org"],
      teamAllowlist: [],
      proAllowlist: ["both@example.org"],
    }),
    "developer",
  );
  assert.equal(
    resolveAccountTier("stranger@example.com", { allowlist: [], teamAllowlist: [], proAllowlist: pro }),
    "free",
  );
});

test("pro is Plus and team is Professional, in both languages", async () => {
  // The id is not the name for two of the tiers, and getting it wrong tells a
  // subscriber they are on the plan above or below the one they pay for. This
  // is the test that fails when somebody "corrects" pro to read Professional.
  const { ACCOUNT_COPY } = await import("./workspace-locale.ts");
  assert.equal(ACCOUNT_COPY.en.tierNames.pro, "Plus");
  assert.equal(ACCOUNT_COPY.en.tierNames.team, "Professional");
  assert.equal(ACCOUNT_COPY.ja.tierNames.pro, "プラス");
  assert.equal(ACCOUNT_COPY.ja.tierNames.team, "プロフェッショナル");
  // Every tier is named, and no two share a label — a duplicate would make one
  // of them unreadable on the account page.
  const names = ACCOUNT_TIERS.map((tier) => ACCOUNT_COPY.en.tierNames[tier]);
  assert.equal(new Set(names).size, names.length, names.join(", "));
});

test("the sidebar and the account page call a tier the same thing", async () => {
  // Two tables, one plan. They drifted the moment a tier was added to only one
  // of them, and the symptom is a sidebar and an account page disagreeing about
  // what the person pays for.
  const { ACCOUNT_COPY, WORKSPACE_COPY } = await import("./workspace-locale.ts");
  for (const locale of ["en", "ja"] as const) {
    for (const tier of ACCOUNT_TIERS) {
      assert.equal(
        WORKSPACE_COPY[locale].sidebar.tierLabel[tier],
        ACCOUNT_COPY[locale].tierNames[tier],
        `${locale} ${tier}`,
      );
    }
  }
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

test("the published Professional plan quotes the allowances the team tier grants", async () => {
  // Same pin as the Free plan above, for the same reason: the pricing page is
  // prose, and prose that overstates an allowance is a promise the product
  // breaks the first time somebody reaches it.
  //
  // "Professional" is the `team` tier. The card was renamed on 2026-08-02; the
  // id was deliberately not.
  const { PRICING_COPY } = await import("./public-copy.ts");
  const team = PRICING_COPY.en.plans.find((plan) => plan.name === "Professional");
  assert.ok(team, "the Professional plan disappeared from the pricing page");
  const features = team.features.join(" | ");
  assert.match(features, new RegExp(`\\b${TIER_LIMITS.team.privateArtifacts}\\b`));
  assert.match(features, new RegExp(`\\b${TIER_LIMITS.team.sharedProjects}\\b.*shared project`, "i"));
});

test("the published Plus plan quotes the numbers the pro tier enforces", async () => {
  // Plus is the `pro` tier. Its card previously said "Higher run limits" and
  // "Priority access to new capabilities" — no number, nothing enforced, for a
  // plan whose accounts were metered as free. Every figure on it is now tied to
  // the table the server mirrors.
  const { PRICING_COPY } = await import("./public-copy.ts");
  const plus = PRICING_COPY.en.plans.find((plan) => plan.name === "Plus");
  assert.ok(plus, "the Plus plan disappeared from the pricing page");
  const features = plus.features.join(" | ");
  const limits = TIER_LIMITS.pro;
  assert.match(features, new RegExp(`\\b${limits.agentRunsPerWeek}\\b.*week`, "i"));
  assert.match(features, new RegExp(`\\b${limits.privateArtifacts}\\b`));
  assert.match(features, new RegExp(`\\b${limits.cpuSimQubits}\\b.*qubit`, "i"));
  // And it must not advertise the capability it does not have. Sharing is what
  // Professional is; a Plus card promising it sells a 403.
  assert.equal(limits.projectSharing, false);
  assert.doesNotMatch(features, /shared? (a )?project/i);
});

test("both published Plus and Professional plans quote the same numbers", async () => {
  // The Japanese page is a separate literal, so a number changed on one side
  // stays wrong on the other until somebody reads both — that is exactly how
  // the JA privacy section disappeared in PR 194. Nothing else on these lines
  // can be compared across the two scripts, but digits are digits.
  const { PRICING_COPY } = await import("./public-copy.ts");
  // Card name -> the tier it sells. The pair is the whole point: a test that
  // looked up "Pro" would silently find nothing and assert over an empty list.
  for (const [name, limits] of [
    ["Plus", TIER_LIMITS.pro],
    ["Professional", TIER_LIMITS.team],
  ] as const) {
    const en = PRICING_COPY.en.plans.find((plan) => plan.name === name);
    const ja = PRICING_COPY.ja.plans.find((plan) => plan.name === name);
    assert.ok(en, `the ${name} plan disappeared from the English pricing page`);
    assert.ok(ja, `the ${name} plan disappeared from the Japanese pricing page`);
    // Each ALLOWANCE, asked for by name, rather than every digit on the line:
    // the first version of this test compared all of them and failed on the "1"
    // in 1人あたり, which is prose. What has to agree is the numbers the tier
    // enforces, and those are these.
    const advertised = [
      limits.agentRunsPerWeek,
      limits.privateArtifacts,
      limits.cpuSimQubits,
      // The per-project limit is the second half of what bounds the shared
      // bucket, so the page states it and this ties it to the same constant the
      // server enforces. Without it the page could advertise "4 shared projects"
      // while saying nothing about how much fits in one.
      DEFAULT_PROJECT_ARTIFACT_LIMIT,
      ...(limits.projectSharing ? [limits.sharedProjects] : []),
    ];
    for (const value of advertised) {
      const pattern = new RegExp(`(^|\\D)${value}(\\D|$)`);
      assert.match(
        en.features.join(" | "),
        pattern,
        `the English ${name} plan does not state ${value}`,
      );
      assert.match(
        ja.features.join(" | "),
        pattern,
        `the Japanese ${name} plan does not state ${value}`,
      );
    }
    // And the same price and cadence on both pages: a plan that costs $50 in
    // one language and $240 in the other is worse than a plan with no price.
    assert.equal(en.price, ja.price, `${name} is priced differently per language`);
  }
});

test("both published plans say unshared projects are unlimited", async () => {
  const { PRICING_COPY } = await import("./public-copy.ts");
  // The owner's rule has two halves and only one of them is a number. A page
  // that states the 4 without stating "unlimited private projects" reads as a
  // cap on every project, which is what the product did before 2026-08-02 and
  // is the thing the owner corrected.
  for (const [language, unlimited] of [
    ["en", /unlimited private projects/i],
    ["ja", /無制限/],
  ] as const) {
    for (const name of ["Free", "Plus", "Professional"]) {
      const plan = PRICING_COPY[language].plans.find((entry) => entry.name === name);
      assert.ok(plan, `the ${name} plan disappeared from the ${language} pricing page`);
      assert.match(
        plan.features.join(" | "),
        unlimited,
        `the ${language} ${name} plan does not say unshared projects are unlimited`,
      );
    }
  }
});

test("the pricing page sells four cards, and Enterprise is not a tier", async () => {
  // Enterprise is a sales motion: negotiated allowances, no entry in
  // TIER_LIMITS, no account that resolves to it. A card carrying an enforced
  // number would be the one figure on this page nothing checks.
  const { PRICING_COPY } = await import("./public-copy.ts");
  for (const language of ["en", "ja"] as const) {
    const names = PRICING_COPY[language].plans.map((plan) => plan.name);
    assert.deepEqual(names, ["Free", "Plus", "Professional", "Enterprise"], language);
  }
  assert.equal(Object.hasOwn(TIER_LIMITS, "enterprise"), false);
  assert.equal(
    ACCOUNT_TIERS.includes("enterprise" as never),
    false,
    "enterprise became a tier without limits to enforce",
  );
});

test("the pricing note still says checkout is not live", async () => {
  // Three cards now carry a dollar figure. Payments are hard-off in this
  // deployment — no card entry, no checkout, no charge — so the page has to
  // keep saying so, or the prices read as something a person can buy today.
  const { PRICING_COPY } = await import("./public-copy.ts");
  assert.match(PRICING_COPY.en.note.body, /no payment method|checkout/i);
  assert.match(PRICING_COPY.en.note.title, /not live|not enabled/i);
  assert.match(PRICING_COPY.ja.note.body, /決済/);
});
