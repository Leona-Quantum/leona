import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

/** The three cards that sell an enforced tier. Enterprise sells none. */
const ENFORCED_CARDS = ["Free", "Plus", "Professional"] as const;

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

test("no enforced card states an allowance number, in either language", async () => {
  // ## This test is the inverse of the one it replaces, and the inversion is the
  // ## owner's (ai-ops#82, 2026-08-14)
  //
  // > *"prices stay, 50 moves to /account. shorten each of the bullet points to
  // > be <=4 words each."*
  //
  // Until this commit, three tests pinned every figure on these cards to
  // `TIER_LIMITS` — the right guard for prose that states allowances, because
  // prose that overstates one is a promise the product breaks the first time
  // somebody reaches it. Generic prose cannot be pinned that way; there is
  // nothing left to compare.
  //
  // So the protection is taken from the other side: no digit may appear in a
  // feature list on an enforced card at all. Numbers came back onto this page
  // one at a time before, and a card that regains "75 agent runs a week" while
  // `TIER_LIMITS.pro` says something else has no symptom on the page — the
  // symptom reaches the person who hits the cap.
  //
  // Prices are untouched and deliberately outside this: `$0`, `$50`, `$240` and
  // `$420+` are what the owner kept, and they are read from `plan.price`, not
  // from `plan.features`.
  const { PRICING_COPY } = await import("./public-copy.ts");
  for (const language of ["en", "ja"] as const) {
    for (const name of ENFORCED_CARDS) {
      const plan = PRICING_COPY[language].plans.find((entry) => entry.name === name);
      assert.ok(plan, `the ${name} plan disappeared from the ${language} pricing page`);
      for (const feature of plan.features) {
        assert.doesNotMatch(
          feature,
          /[0-9]/,
          `the ${language} ${name} card states an allowance nothing on this page enforces: "${feature}"`,
        );
      }
    }
  }
  // And the prices did stay, which is the half of the ruling a digit ban could
  // quietly undo.
  for (const [name, price] of [["Free", "$0"], ["Plus", "$50"], ["Professional", "$240"], ["Enterprise", "$420+"]] as const) {
    const plan = PRICING_COPY.en.plans.find((entry) => entry.name === name);
    assert.equal(plan?.price, price, `${name} lost its price`);
  }
});

test("every feature bullet is four words or fewer", async () => {
  // The owner's rule, asserted rather than asked for. English only: the
  // Japanese cards are held to the same terseness in spirit, but splitting
  // Japanese on whitespace counts every card's bullets as one word and would
  // make this pass for a reason unrelated to the copy.
  const { PRICING_COPY } = await import("./public-copy.ts");
  for (const plan of PRICING_COPY.en.plans) {
    for (const feature of plan.features) {
      const words = feature.trim().split(/\s+/);
      assert.ok(
        words.length <= 4,
        `the ${plan.name} card's "${feature}" is ${words.length} words, and the limit is four`,
      );
    }
  }
});

test("no card carries a tagline, because the field no longer exists", async () => {
  // > *"no headliners like 'Enough to browse the public evidence and put the
  // > workbench through a real problem.'"* — owner, ai-ops#82
  //
  // Asserted on the data rather than on the renderers: `description` was read
  // by /pricing and by /upgrade, and a field left on the type is one the next
  // copy pass fills back in without either page changing.
  const { PRICING_COPY } = await import("./public-copy.ts");
  for (const language of ["en", "ja"] as const) {
    for (const plan of PRICING_COPY[language].plans) {
      assert.equal(
        Object.hasOwn(plan, "description"),
        false,
        `the ${language} ${plan.name} card grew a tagline back`,
      );
    }
  }
});

test("the account page states the per-project artifact limit", async () => {
  // Where the 50 went. It is not a tier allowance — it belongs to the project
  // and its owner can change it — so it has no entry in `TIER_LIMITS` and
  // nothing but this ties the screen to the constant the server mirrors.
  //
  // Read rather than rendered: the page is an async server component that
  // reaches WorkOS through `lib/auth`, which the bare node runner cannot load.
  // The assertion is that the reference was FOUND as well as that it is the
  // constant — a scan that matches nothing passes forever.
  assert.equal(DEFAULT_PROJECT_ARTIFACT_LIMIT, 50);
  const web = fileURLToPath(new URL("../", import.meta.url));
  const source = readFileSync(join(web, "app", "(app)", "account", "account-content.tsx"), "utf8");
  assert.match(
    source,
    /copy\.usageProjectArtifactsValue\(DEFAULT_PROJECT_ARTIFACT_LIMIT\)/,
    "the account page no longer states the per-project artifact limit",
  );
  const { ACCOUNT_COPY } = await import("./workspace-locale.ts");
  for (const locale of ["en", "ja"] as const) {
    assert.match(
      ACCOUNT_COPY[locale].usageProjectArtifactsValue(DEFAULT_PROJECT_ARTIFACT_LIMIT),
      /50/,
      `the ${locale} account page does not print the limit it was given`,
    );
  }
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
    // The browser lane joined this sweep with ai-ops#82. It was outside it while
    // the cards quoted "up to 8 / 12 / 18 qubits" and a test compared each
    // figure to its tier; the cards now say "Browser simulation" / "Wider" /
    // "Widest", and a comparative nothing enforces is exactly the unbacked claim
    // the numbered copy existed to prevent. `preview` shares free's 8, so the
    // relation is >= rather than >.
    assert.ok(
      upper.cpuSimQubits >= lower.cpuSimQubits,
      `${ACCOUNT_TIERS[i]} browser qubits below ${ACCOUNT_TIERS[i - 1]}`,
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

test("sharing is claimed on Professional and on neither card below it", async () => {
  // The capability the control plane REFUSES rather than counts: `projectSharing`
  // is false for `free` and `pro`, and the API answers 403. A sharing line on
  // either card therefore sells something that breaks on the first click, which
  // is a worse failure than an overstated allowance — there is no cap to reach,
  // the button simply does not work.
  //
  // Until ai-ops#82 this was one `doesNotMatch` on the Plus card and nothing at
  // all on Free. Free is the card most people read.
  const { PRICING_COPY } = await import("./public-copy.ts");
  const sharing = { en: /shar(e|ed|ing)/i, ja: /共有/ } as const;
  for (const language of ["en", "ja"] as const) {
    for (const [name, tier] of [["Free", "free"], ["Plus", "pro"]] as const) {
      assert.equal(limitsForTier(tier).projectSharing, false, `${tier} gained sharing`);
      const plan = PRICING_COPY[language].plans.find((entry) => entry.name === name);
      assert.ok(plan, `the ${name} plan disappeared from the ${language} pricing page`);
      assert.doesNotMatch(
        plan.features.join(" | "),
        sharing[language],
        `the ${language} ${name} card sells sharing, which the control plane 403s`,
      );
    }
    // And the card that DOES have it says so — otherwise this test passes on a
    // page that never mentions sharing at all.
    const professional = PRICING_COPY[language].plans.find((entry) => entry.name === "Professional");
    assert.ok(professional, `the Professional plan disappeared from the ${language} pricing page`);
    assert.match(
      professional.features.join(" | "),
      sharing[language],
      `the ${language} Professional card no longer offers the capability that distinguishes it`,
    );
  }
  assert.equal(limitsForTier("team").projectSharing, true);
});

test("a plan costs the same in both languages", async () => {
  // The Japanese page is a separate literal, so a value changed on one side
  // stays wrong on the other until somebody reads both — that is exactly how
  // the JA privacy section disappeared in PR 194.
  //
  // This used to compare the allowance figures across the two scripts as well.
  // There are none left to compare (ai-ops#82); the price is what remains, and
  // a plan that costs $50 in one language and $240 in the other is worse than a
  // plan with no price.
  const { PRICING_COPY } = await import("./public-copy.ts");
  for (const plan of PRICING_COPY.en.plans) {
    const ja = PRICING_COPY.ja.plans.find((entry) => entry.name === plan.name);
    assert.ok(ja, `the ${plan.name} plan disappeared from the Japanese pricing page`);
    assert.equal(plan.price, ja.price, `${plan.name} is priced differently per language`);
  }
});

test("the two cards below Professional differ from each other and from it", async () => {
  // Without numbers the ladder is carried entirely by wording, so three cards
  // reading the same is a live failure mode rather than a pedantic one: a
  // reader comparing them would see no reason for the $50.
  const { PRICING_COPY } = await import("./public-copy.ts");
  for (const language of ["en", "ja"] as const) {
    const lists = ENFORCED_CARDS.map((name) => {
      const plan = PRICING_COPY[language].plans.find((entry) => entry.name === name);
      assert.ok(plan, `the ${name} plan disappeared from the ${language} pricing page`);
      return plan.features.join(" | ");
    });
    assert.equal(new Set(lists).size, lists.length, `${language}: two enforced cards say the same thing`);
  }
});

test("no enforced tier advertises an allowance its cap refuses", async () => {
  const { PRICING_COPY } = await import("./public-copy.ts");
  // ## This test used to assert the opposite, and the reversal is the owner's
  //
  // > *"10 artifacts is the cap and the unlimited line should go."* — owner,
  // > ai-ops#77, 2026-08-14
  //
  // Until this commit it read "both published plans say unshared projects are
  // unlimited", and required `unlimited private projects` / `無制限` on all
  // three cards. That came from an owner correction on 2026-08-02 with a real
  // reason: stating "4 shared projects" and nothing else reads as a cap on
  // every project.
  //
  // The 2026-08-14 ruling supersedes it, and the reason the older one gave is
  // **not** answered by the newer one — it is narrowed. What the owner was
  // reading is a Free card that says "10 private artifacts" and then, one line
  // down, unlimited projects holding fifty each. Under a per-account cap those
  // two lines cannot both be what bills.
  //
  // So the assertion is inverted rather than deleted: an enforced card may not
  // put the word "unlimited" beside its artifact allowance. The older concern
  // is live and unaddressed — it wants a sentence about projects that a reader
  // cannot mistake for an artifact allowance, which is a wording the owner has
  // to choose. Raised, not guessed.
  for (const [language, unlimited] of [
    ["en", /\bunlimited\b/i],
    ["ja", /無制限/],
  ] as const) {
    for (const name of ["Free", "Plus", "Professional"]) {
      const plan = PRICING_COPY[language].plans.find((entry) => entry.name === name);
      assert.ok(plan, `the ${name} plan disappeared from the ${language} pricing page`);
      assert.doesNotMatch(
        plan.features.join(" | "),
        unlimited,
        `the ${language} ${name} card offers an unlimited allowance beside a capped one`,
      );
    }
  }
  // Enterprise is exempt and stays exempt: it has no entry in `TIER_LIMITS`, so
  // it has no cap for a word to contradict. Its allowances are negotiated.
  const enterprise = PRICING_COPY.en.plans.find((plan) => plan.name === "Enterprise");
  assert.ok(enterprise);
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

// The "the pricing note still says checkout is not live" test that used to
// live here guarded `PRICING_COPY.note`, which owned the pricing page's only
// disclosure that checkout is not live. The whole "A transparent starting
// point" section — the note included — was removed from `/pricing` by owner
// instruction (ai-ops#94), so there is nothing left on this page for the test
// to check. The fact itself is still stated to a reader: `UPGRADE_COPY`'s
// `checkoutTitle`/`checkoutBody` carry it on `/upgrade`, and `TERMS_COPY`'s
// "Early-access packaging" section carries it site-wide. Neither is pinned by
// a test today — flagged to the owner rather than added here silently, since
// which surface is the load-bearing one for "no payment method exists yet" is
// a product call, not a copy-file cleanup.
