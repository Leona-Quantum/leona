#!/usr/bin/env node
/**
 * Does the live CDN actually cache `/repository/layers`, the route PR 591 exists
 * to put there? Nothing else answers that question — `client-bundle`'s
 * `check-static-routes.mjs` reads a local build's route table, and neither it nor
 * any other required check ever makes a request to the deployed site.
 *
 * Runs post-deploy (`on: deployment_status`, `verify-web-cache.yml`), never as a
 * PR gate — there is no build artifact to check before a merge, only the live
 * edge after one. That also means nothing is blocked by this script failing;
 * see the WARN case below for why that is deliberate rather than a gap.
 *
 * ## Why a fixed URL, never a cache-buster
 *
 * `/repository/layers` keys its CDN cache on the full request URL, including the
 * query string (`next.config.ts`) — that is what lets every deep link get its own
 * entry rather than colliding. A cache-buster is therefore a URL the edge has by
 * construction never seen, so it reports MISS every time, forever, regardless of
 * whether caching works. Measured live 2026-08-14: a cache-busted request to this
 * exact route MISSed three times in a row on a deploy later confirmed to cache
 * correctly on the bare URL (MISS, then HIT, then HIT). Proving a *deploy landed*
 * wants a cache-buster (`verify-leona-live`); proving a *cache works* wants the
 * opposite. This script answers the second question, not the first.
 *
 * ## Why a MISS-only result is a WARN, not a FAIL
 *
 * Two back-to-back requests from one CI runner can land on different edge PoPs
 * before the newest deploy has been read anywhere on that edge — a cold cache, not
 * a broken one. Retrying rides out that window; if every attempt still MISSes,
 * this script says so loudly (an `::error::` annotation, so it is not missed on
 * the Actions tab) but exits 0. A gate that can go red on nothing but cache
 * temperature gets deleted the first time it cries wolf during a quiet deploy —
 * this repo has already lost a check that way. The only exit-1 case is every
 * attempt returning a non-200: that is not ambiguous, and nothing about a cold
 * edge explains it.
 *
 * Usage: node scripts/check-live-repository-cache.mjs [--self-test]
 */

const SITE_ORIGIN = process.env.LEONA_LIVE_ORIGIN ?? "https://leonaqt.com";
const CHECKED_PATHS = ["/repository/layers"];
const ATTEMPTS = 5;
const RETRY_DELAY_MS = 1500;
const CACHED_VALUES = new Set(["HIT", "PRERENDER"]);

/**
 * Pure classifier: one path's attempts in, one verdict out. No network here, so
 * `--self-test` can exercise every branch without reaching the live site.
 *
 * `observations`: `{ status: number, cacheHeader: string | null }[]`, oldest
 * attempt first.
 */
export function classify(observations) {
  if (observations.length === 0) {
    return { verdict: "fail", reason: "no attempts were made" };
  }
  const nonOk = observations.filter((o) => o.status !== 200);
  if (nonOk.length === observations.length) {
    const statuses = nonOk.map((o) => o.status).join(", ");
    return { verdict: "fail", reason: `every attempt returned a non-200 status (${statuses})` };
  }
  const cachedHit = observations.some((o) => o.status === 200 && CACHED_VALUES.has(o.cacheHeader ?? ""));
  if (cachedHit) {
    const n = observations.findIndex((o) => o.status === 200 && CACHED_VALUES.has(o.cacheHeader ?? "")) + 1;
    return { verdict: "pass", reason: `attempt ${n}/${observations.length} returned x-vercel-cache: ${observations[n - 1].cacheHeader}` };
  }
  const seen = observations.map((o) => (o.status === 200 ? (o.cacheHeader ?? "(no header)") : `HTTP ${o.status}`));
  return {
    verdict: "warn",
    reason: `${observations.length} attempts, none reached HIT or PRERENDER (saw: ${seen.join(", ")}) — likely a cold edge, not necessarily a regression`,
  };
}

function selfTest() {
  const cases = [
    {
      name: "HIT on the second attempt passes",
      observations: [{ status: 200, cacheHeader: "MISS" }, { status: 200, cacheHeader: "HIT" }],
      verdict: "pass",
    },
    {
      name: "PRERENDER counts the same as HIT",
      observations: [{ status: 200, cacheHeader: "MISS" }, { status: 200, cacheHeader: "PRERENDER" }],
      verdict: "pass",
    },
    {
      name: "all-MISS warns rather than fails",
      observations: [{ status: 200, cacheHeader: "MISS" }, { status: 200, cacheHeader: "MISS" }, { status: 200, cacheHeader: "MISS" }],
      verdict: "warn",
    },
    {
      name: "a missing cache header among 200s warns, does not fail",
      observations: [{ status: 200, cacheHeader: null }, { status: 200, cacheHeader: "MISS" }],
      verdict: "warn",
    },
    {
      name: "every attempt non-200 fails",
      observations: [{ status: 500, cacheHeader: null }, { status: 502, cacheHeader: null }],
      verdict: "fail",
    },
    {
      name: "one 200 MISS among failures still only warns — the edge answered, it just had not cached yet",
      observations: [{ status: 500, cacheHeader: null }, { status: 200, cacheHeader: "MISS" }],
      verdict: "warn",
    },
    {
      name: "no attempts at all fails rather than passing vacuously",
      observations: [],
      verdict: "fail",
    },
  ];

  let failed = 0;
  for (const { name, observations, verdict } of cases) {
    const got = classify(observations);
    if (got.verdict !== verdict) {
      console.error(`check-live-repository-cache: SELF-TEST FAILED — ${name}: expected ${verdict}, got ${got.verdict} (${got.reason})`);
      failed += 1;
    }
  }
  if (failed > 0) process.exit(1);
  console.log(`check-live-repository-cache: self-test ok (${cases.length} cases, pass/warn/fail all exercised)`);
}

async function probe(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    return { status: res.status, cacheHeader: res.headers.get("x-vercel-cache") };
  } catch (err) {
    // A network failure is not a 200, so it folds into the same "non-200" bucket
    // `classify` already handles — no separate branch needed for it.
    //
    // `err` is not guaranteed to be an Error — fetch can reject with other
    // shapes — so `.message` alone risks logging "undefined" instead of
    // whatever was actually thrown.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`check-live-repository-cache: request to ${url} threw: ${message}`);
    return { status: 0, cacheHeader: null };
  }
}

async function checkPath(path) {
  const url = `${SITE_ORIGIN}${path}`;
  const observations = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const observation = await probe(url);
    observations.push(observation);
    console.log(
      `check-live-repository-cache: ${path} attempt ${attempt}/${ATTEMPTS} — status ${observation.status}, x-vercel-cache: ${observation.cacheHeader ?? "(none)"}`,
    );
    const runningVerdict = classify(observations);
    if (runningVerdict.verdict === "pass") break;
    if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  return { path, ...classify(observations) };
}

async function main() {
  const results = await Promise.all(CHECKED_PATHS.map((path) => checkPath(path)));
  let worstExit = 0;
  for (const { path, verdict, reason } of results) {
    if (verdict === "pass") {
      console.log(`check-live-repository-cache: PASS ${SITE_ORIGIN}${path} — ${reason}`);
    } else if (verdict === "warn") {
      // ::error:: for visibility on the Actions tab, NOT for exit status — see the
      // file header for why this stays exit 0.
      console.log(`::error::check-live-repository-cache: UNCONFIRMED ${SITE_ORIGIN}${path} — ${reason}`);
    } else {
      console.log(`::error::check-live-repository-cache: FAIL ${SITE_ORIGIN}${path} — ${reason}`);
      worstExit = 1;
    }
  }
  process.exit(worstExit);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  main();
}
