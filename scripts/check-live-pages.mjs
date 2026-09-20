#!/usr/bin/env node
// Post-deploy: does a visitor actually get a page, on each KIND of route?
//
// ## The failure this exists for, in full, because it is instructive
//
// On 2026-08-16 an authkit-nextjs 2.17 -> 4.3 upgrade shipped to production and
// every Atlas record page — `/repository/<slug>`, the address every Atlas link
// lands on — returned HTTP 500 for over an hour. Everything that could have
// caught it passed:
//
//   * 1252 web tests, green.
//   * `tsc --noEmit`, clean. The API signature did not change; the runtime
//     behaviour did (`withAuth()` throws in v4 where v2 returned).
//   * The `deploy` workflow, green.
//   * `web-deploy-watch`, green — it confirms a deployment COMPLETED, which is a
//     different claim from a page RENDERING, and the gap between those two
//     claims is exactly one hour of a broken product.
//   * A manual post-deploy check of all seven marketing pages, all 200. None of
//     them is a record page, and the marketing pages are prerendered onto the
//     CDN, so they never execute the call that was throwing.
//
// So the gap was never "nobody looked". It is that nothing looked at a page that
// RENDERS PER REQUEST AND READS THE SESSION, which is one specific kind of route
// and the only kind that broke.
//
// ## What it therefore checks
//
// One URL per rendering strategy, not one URL per page. The point is coverage of
// KINDS: a prerendered marketing page, the edge-cached browse index, and — the
// one that matters — a per-request record page that calls `getMajoranaAuth()`.
// Adding more marketing pages would lengthen the run without widening it.
//
// A known-absent slug is included as a NEGATIVE control. Without it a checker
// that has silently started treating every response as fine still reports a
// clean bill, which is the same blindness the trivy self-test in
// sandbox-image.yml and `check_osv_report.py --self-test` exist to close.
//
// Anonymous on purpose: no cookies, no session. That is what a stranger gets,
// and a stranger is who found nothing wrong with the marketing pages while the
// Atlas was down.
//
// ## A challenged probe is blind, and says so
//
// Since 2026-09-20 leonaqt.com is served through Cloudflare with Bot Fight Mode
// on, and a GitHub runner is a datacentre address. When Cloudflare challenges a
// request it answers 403 with `cf-mitigated: challenge`, and that 403 is a fact
// about the RUNNER, not about the site: every probe here would fail, the
// negative control included, and the run would read as "the product is down"
// while visitors are being served normally. So a challenged response is
// reported as its own thing. It still fails the run — an instrument that cannot
// see must not go green — but it says which of the two it is.

const BASE = process.env.LEONA_BASE_URL || "https://leonaqt.com";
const TIMEOUT_MS = 30_000;

/**
 * @type {{path: string, expect: number, why: string}[]}
 */
const PROBES = [
  {
    path: "/",
    expect: 200,
    why: "prerendered marketing page — served from the CDN, executes no per-request code",
  },
  {
    path: "/repository",
    expect: 200,
    why: "the browse index — edge-cached, and deliberately does NOT read auth (see its page.tsx)",
  },
  {
    path: "/repository/bell-state-qiskit",
    expect: 200,
    why:
      "A RECORD PAGE. Per-request, uncached, and it calls getMajoranaAuth() -> withAuth(). " +
      "This is the class of route that 500'd for an hour on 2026-08-16 while every other " +
      "check was green. If you change one line in this file, do not make it this one.",
  },
  {
    path: "/repository/a-slug-this-corpus-will-never-publish",
    expect: 404,
    why:
      "negative control — proves the checker can still tell responses apart. A checker that " +
      "reports every URL healthy is indistinguishable from a healthy site.",
  },
];

/** The status, and Cloudflare's `cf-mitigated` header when it sent one. */
async function observe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "cache-control": "no-cache" },
    });
    return { status: response.status, mitigated: response.headers.get("cf-mitigated") };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Prove the comparison can fail before believing that it passed.
 *
 * Checks the assertion logic, not the network: a self-test that made real
 * requests would fail whenever the site was down, which is the one moment this
 * script must still be able to run and report.
 */
function selfTest() {
  const failures = [];
  if (verdict({ expect: 200 }, 500) === null) failures.push("a 500 against an expected 200 passed");
  if (verdict({ expect: 200 }, 404) === null) failures.push("a 404 against an expected 200 passed");
  if (verdict({ expect: 404 }, 200) === null) {
    failures.push("a 200 against an expected 404 passed — the negative control is inert");
  }
  if (verdict({ expect: 200 }, 200) !== null) failures.push("a matching status was reported as a failure");
  if (!isBlind(verdict({ expect: 200 }, 403, "challenge"))) failures.push("a Cloudflare challenge was not reported as a blind probe");
  if (verdict({ expect: 200 }, 200, "challenge") === null) failures.push("a challenged response passed because its status happened to match");
  if (isBlind(verdict({ expect: 200 }, 403))) failures.push("a plain 403 was reported as a challenge — a real refusal would be excused");
  if (failures.length) {
    console.error("self-test failed — this checker cannot be trusted:");
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log("self-test: the status comparison fails when it should, in both directions");
}

const BLIND = "BLIND:";

/** null when the probe is satisfied, otherwise why not. */
function verdict(probe, actual, mitigated = null) {
  if (mitigated) {
    return `${BLIND} Cloudflare answered with cf-mitigated: ${mitigated} (HTTP ${actual}) — it challenged this runner, so this says nothing about the page`;
  }
  return actual === probe.expect ? null : `expected ${probe.expect}, got ${actual}`;
}

function isBlind(problem) {
  return typeof problem === "string" && problem.startsWith(BLIND);
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const results = await Promise.all(
  PROBES.map(async (probe) => {
    const url = `${BASE}${probe.path}`;
    try {
      const { status: actual, mitigated } = await observe(url);
      return { probe, actual, problem: verdict(probe, actual, mitigated) };
    } catch (error) {
      return { probe, actual: null, problem: `request failed: ${error?.message ?? error}` };
    }
  }),
);

let failed = 0;
for (const { probe, actual, problem } of results) {
  const mark = problem ? "FAIL" : "ok  ";
  console.log(`${mark} ${String(actual ?? "---").padEnd(4)} ${probe.path}`);
  if (problem) {
    failed += 1;
    console.log(`       ${problem}`);
    console.log(`       this route is: ${probe.why}`);
  }
}

const blind = results.filter(({ problem }) => isBlind(problem)).length;
// `--challenged-ok` is for the one caller that is challenged every time and knows
// it: the post-deploy workflow on a GitHub runner. The owner ruled on 2026-09-20
// (ai-ops 348) that Bot Fight Mode stays on, with the render question answered
// before the traffic shift (deploy-web's smoke test on the private twin) and
// around the clock by the Google uptime checks, which Cloudflare lets through. A
// run that is red after every deploy teaches everyone to ignore red, so there a
// fully challenged run is a notice. It must be EVERY probe: one real failure among
// challenges is still a failure, and without the flag nothing changes.
if (blind && blind === PROBES.length && process.argv.includes("--challenged-ok")) {
  console.log(`::notice::Cloudflare challenged all ${blind} probes against ${BASE}, so this run verified nothing. That is expected from a GitHub runner while Bot Fight Mode is on (ai-ops 348). A record page is rendered before every traffic shift by deploy-web's smoke test, and the Google uptime checks watch the live site.`);
  process.exit(0);
}
if (blind && blind === failed) {
  console.error(`\n::error::Cloudflare challenged ${blind} of ${PROBES.length} probes against ${BASE}. This run could not see the site.`);
  console.error("::error::That is about this runner's address (Bot Fight Mode treats datacentre traffic as a bot), not about what a visitor gets.");
  console.error("::error::Read the site from an ordinary connection before concluding anything: docs/runbooks/cloudflare-origin-certificate.md.");
  process.exit(2);
}

if (failed) {
  console.error(`\n::error::${failed} of ${PROBES.length} live page probes failed against ${BASE}.`);
  console.error("::error::The deployment COMPLETED — that is not in question and is not what this checks.");
  console.error("::error::What this says is that a visitor requesting the route above does not get a page.");
  process.exit(1);
}

console.log(`\nall ${PROBES.length} live page probes passed against ${BASE}`);
