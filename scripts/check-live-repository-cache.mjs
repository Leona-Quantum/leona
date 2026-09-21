#!/usr/bin/env node
/**
 * Does the live CDN actually cache `/repository/layers`, the route PR 591 exists
 * to put there? Nothing else answers that question — `client-bundle`'s
 * `check-static-routes.mjs` reads a local build's route table, and neither it nor
 * any other required check ever makes a request to the deployed site.
 *
 * Runs post-deploy (`verify-web-cache.yml`, after `deploy-web` finishes), never as a
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
// The three families next.config.ts marks cacheable (`lib/edge-cache-headers.ts`).
const CHECKED_PATHS = ["/repository", "/repository/layers", "/repository/folders"];
const ATTEMPTS = 5;
const RETRY_DELAY_MS = 1500;
// HIT and PRERENDER are Vercel's. REVALIDATED, UPDATING and STALE are
// Cloudflare's and all three mean the edge is holding the page — it served from
// its own copy, whether or not it also checked freshness. Cloudflare's EXPIRED
// and DYNAMIC are deliberately absent: EXPIRED went to the origin for the body,
// and DYNAMIC means the page was never considered cacheable at all, which is
// exactly what an Atlas page looks like when the Cache Rule is missing. Those
// two must read as "not cached", because they are the failure this check exists
// to see.
const CACHED_VALUES = new Set(["HIT", "PRERENDER", "REVALIDATED", "UPDATING", "STALE"]);

/**
 * Which header names an edge cache's verdict, in the order they are consulted.
 *
 * `x-vercel-cache` is Vercel's. `cf-cache-status` is Cloudflare's, and it becomes
 * the one that matters once the site is served from Cloud Run behind Cloudflare
 * (GCP migration, ai-ops `gcp-migration-20260912`). Both are read rather than one
 * replacing the other, because production runs on both stacks through the cutover
 * and its 30-day rollback window — and because the alternative is a check that
 * reads a header nobody sets and reports `(none)` on a perfectly healthy cache,
 * which is the same reading it gives for a cache that has genuinely stopped
 * working. An instrument that cannot tell those two apart is worse than no
 * instrument, because this one is wired to a workflow.
 *
 * Cloudflare's vocabulary is not Vercel's: it says `DYNAMIC` for "not cacheable
 * at all", which is what an uncached Atlas page looks like when the Cache Rule
 * is missing, and `EXPIRED`/`REVALIDATED` for a served-then-refreshed hit. Only
 * the values that mean "this response came from the edge" count as cached.
 */
const CACHE_HEADERS = ["x-vercel-cache", "cf-cache-status"];

function readCacheHeader(headers) {
  for (const name of CACHE_HEADERS) {
    const value = headers.get(name);
    if (value) return { name, value: value.trim().toUpperCase() };
  }
  return { name: null, value: null };
}

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
    // A Cloudflare challenge is a fact about the runner, not the site (see
    // check-live-pages.mjs). Still a failure, because a probe that cannot see
    // must not go green, but it has to say which of the two it is.
    const challenged = nonOk.find((o) => o.mitigated);
    const blind = challenged ? ` — Cloudflare challenged this runner (cf-mitigated: ${challenged.mitigated}), so this says nothing about the page` : "";
    return { verdict: "fail", reason: `every attempt returned a non-200 status (${statuses})${blind}` };
  }
  const cachedHit = observations.some((o) => o.status === 200 && CACHED_VALUES.has(o.cacheHeader ?? ""));
  if (cachedHit) {
    const n = observations.findIndex((o) => o.status === 200 && CACHED_VALUES.has(o.cacheHeader ?? "")) + 1;
    const hit = observations[n - 1];
    return { verdict: "pass", reason: `attempt ${n}/${observations.length} returned ${hit.cacheHeaderName ?? "a cache header"}: ${hit.cacheHeader}` };
  }
  const seen = observations.map((o) => (o.status === 200 ? (o.cacheHeader ?? "(no header)") : `HTTP ${o.status}`));
  return {
    verdict: "warn",
    reason: `${observations.length} attempts, none came from the edge (saw: ${seen.join(", ")}) — likely a cold edge, not necessarily a regression`,
  };
}

/**
 * Requests that must never be answered from a shared cache, nor marked for one.
 *
 * Next's client router asks for the same address with an `RSC` header and gets a
 * different body (a 307 to `?_rsc`, then the raw `text/x-component` payload), and
 * a reader who chose Japanese gets a different language on the same address.
 * Vercel keys its cache on `Vary: rsc` and on the middleware's rewritten path, so
 * neither mixes there. Cloudflare ignores `Vary` and cannot put a cookie in the
 * cache key on this plan, so both depend on two locks: the origin not sending
 * `CDN-Cache-Control` for these requests, and the Cache Rule's filter refusing
 * them. This reads both, without ever trying to poison anything: it only looks
 * at how these requests themselves are answered.
 *
 * A `x-vercel-cache: HIT` here is fine and is not failed on — Vercel's key
 * separates these requests correctly. Only Cloudflare's verdict counts.
 *
 * `edgeOnly` marks the one probe the origin CANNOT lock: a bare `?_rsc` with no
 * header. Next's `missing` matcher treats an empty value as absent, so the origin
 * still marks that response cacheable (it is the ordinary HTML page, the same
 * document as `/repository`). What keeps it out of the edge is the Cache Rule's
 * `_rsc` line, so for this probe only the edge's verdict is read.
 */
const NEVER_SHARED = [
  { path: "/repository", headers: { RSC: "1" }, what: "a React payload request with no ?_rsc (Next answers a 307)" },
  { path: "/repository?_rsc", headers: { RSC: "1" }, what: "the React payload itself" },
  { path: "/repository/layers", headers: { RSC: "1" }, what: "a React payload request on the map" },
  { path: "/repository", headers: { Cookie: "leona.locale.v2=ja" }, what: "a reader who chose Japanese" },
  { path: "/repository?_rsc", headers: {}, what: "the payload address with no header (the Cache Rule's _rsc line is the only lock)", edgeOnly: true },
];

/** Pure: one never-shared observation in, one verdict out. */
export function classifyNeverShared(o, { edgeOnly = false } = {}) {
  if (!o.status) return { verdict: "fail", reason: "the request itself failed" };
  // A broken origin answers these without any cache marker too, so "no marker"
  // on a 5xx or 404 would read as a pass. Next answers them 200 or 307.
  if (o.status < 200 || o.status >= 400) return { verdict: "fail", reason: `unexpected HTTP ${o.status} — these requests are answered 200 or 307` };
  if (o.cdnCacheControl && !edgeOnly) {
    return { verdict: "fail", reason: `the origin marked it cacheable for Cloudflare (CDN-Cache-Control: ${o.cdnCacheControl}) — lib/edge-cache-headers.ts no longer applies` };
  }
  if (o.cacheHeaderName === "cf-cache-status" && CACHED_VALUES.has(o.cacheHeader ?? "")) {
    return { verdict: "fail", reason: `Cloudflare answered it from its cache (cf-cache-status: ${o.cacheHeader}) — the Cache Rule's filter no longer refuses it` };
  }
  // Say what was seen. An edge-only probe passes WITH the origin's marker present, and a
  // line that reported "no CDN-Cache-Control" there would misstate the one fact the probe
  // exists to separate from the edge's verdict.
  const marker = o.cdnCacheControl ? `CDN-Cache-Control: ${o.cdnCacheControl} (expected here; the edge refused it)` : "no CDN-Cache-Control";
  return { verdict: "pass", reason: `HTTP ${o.status}, ${o.cacheHeaderName ?? "no cache header"}: ${o.cacheHeader ?? "(none)"}, ${marker}` };
}

function selfTest() {
  const cases = [
    {
      name: "HIT on the second attempt passes",
      observations: [{ status: 200, cacheHeader: "MISS" }, { status: 200, cacheHeader: "HIT" }],
      verdict: "pass",
    },
    {
      // Cloudflare's own vocabulary, which the site reads once it is served from
      // Cloud Run behind Cloudflare rather than from Vercel. Without these cases
      // the new header names are added and never exercised, which is the shape of
      // change that passes review and fails in production.
      name: "Cloudflare HIT passes",
      observations: [{ status: 200, cacheHeader: "MISS", cacheHeaderName: "cf-cache-status" }, { status: 200, cacheHeader: "HIT", cacheHeaderName: "cf-cache-status" }],
      verdict: "pass",
    },
    {
      name: "Cloudflare STALE counts as served from the edge",
      observations: [{ status: 200, cacheHeader: "STALE", cacheHeaderName: "cf-cache-status" }],
      verdict: "pass",
    },
    {
      // The one that matters: DYNAMIC is what an Atlas page returns when no Cache
      // Rule names it, i.e. exactly the regression this check exists to see. It
      // must NOT read as cached however many times it is observed.
      name: "Cloudflare DYNAMIC never passes, however many attempts",
      observations: [
        { status: 200, cacheHeader: "DYNAMIC", cacheHeaderName: "cf-cache-status" },
        { status: 200, cacheHeader: "DYNAMIC", cacheHeaderName: "cf-cache-status" },
        { status: 200, cacheHeader: "DYNAMIC", cacheHeaderName: "cf-cache-status" },
      ],
      verdict: "warn",
    },
    {
      name: "Cloudflare EXPIRED went to the origin, so it is not a hit",
      observations: [{ status: 200, cacheHeader: "EXPIRED", cacheHeaderName: "cf-cache-status" }],
      verdict: "warn",
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

  // readCacheHeader is the only new code the `classify` cases above cannot
  // reach, because they hand classify its observations directly and never go
  // through `probe`. Untested, the whole Cloudflare addition would be a constant
  // list nothing consults.
  const headerCases = [
    { name: "reads Vercel's header", headers: { "x-vercel-cache": "HIT" }, expect: ["x-vercel-cache", "HIT"] },
    { name: "reads Cloudflare's header", headers: { "cf-cache-status": "hit" }, expect: ["cf-cache-status", "HIT"] },
    { name: "Vercel wins when both are present", headers: { "x-vercel-cache": "MISS", "cf-cache-status": "HIT" }, expect: ["x-vercel-cache", "MISS"] },
    { name: "neither present reads as no header", headers: {}, expect: [null, null] },
  ];
  let headerFailed = 0;
  for (const { name, headers, expect } of headerCases) {
    const got = readCacheHeader(new Headers(headers));
    if (got.name !== expect[0] || got.value !== expect[1]) {
      console.error(`check-live-repository-cache: SELF-TEST FAILED — ${name}: expected ${JSON.stringify(expect)}, got ${JSON.stringify([got.name, got.value])}`);
      headerFailed += 1;
    }
  }

  const neverSharedCases = [
    { name: "origin marking a payload cacheable fails", o: { status: 307, cdnCacheControl: "max-age=300", cacheHeader: "DYNAMIC", cacheHeaderName: "cf-cache-status" }, verdict: "fail" },
    { name: "a Cloudflare HIT on a payload request fails", o: { status: 200, cacheHeader: "HIT", cacheHeaderName: "cf-cache-status" }, verdict: "fail" },
    { name: "a Cloudflare STALE counts as served from the edge", o: { status: 200, cacheHeader: "STALE", cacheHeaderName: "cf-cache-status" }, verdict: "fail" },
    { name: "a Vercel HIT is fine, its key honours Vary", o: { status: 200, cacheHeader: "HIT", cacheHeaderName: "x-vercel-cache" }, verdict: "pass" },
    { name: "Cloudflare DYNAMIC with no marker passes", o: { status: 307, cacheHeader: "DYNAMIC", cacheHeaderName: "cf-cache-status" }, verdict: "pass" },
    { name: "a thrown request fails rather than passing on silence", o: { status: 0, cacheHeader: null }, verdict: "fail" },
    { name: "a 500 with no marker fails, it is not a pass", o: { status: 500, cacheHeader: "DYNAMIC", cacheHeaderName: "cf-cache-status" }, verdict: "fail" },
    { name: "a 404 with no marker fails", o: { status: 404, cacheHeader: null }, verdict: "fail" },
    { name: "edge-only: the origin's marker is expected and passes", o: { status: 200, cdnCacheControl: "max-age=300", cacheHeader: "DYNAMIC", cacheHeaderName: "cf-cache-status" }, edgeOnly: true, verdict: "pass" },
    { name: "edge-only: a Cloudflare HIT still fails", o: { status: 200, cdnCacheControl: "max-age=300", cacheHeader: "HIT", cacheHeaderName: "cf-cache-status" }, edgeOnly: true, verdict: "fail" },
  ];
  for (const { name, o, edgeOnly, verdict } of neverSharedCases) {
    const got = classifyNeverShared(o, { edgeOnly });
    if (got.verdict !== verdict) {
      console.error(`check-live-repository-cache: SELF-TEST FAILED — never-shared ${name}: expected ${verdict}, got ${got.verdict} (${got.reason})`);
      headerFailed += 1;
    }
  }

  let failed = headerFailed;
  for (const { name, observations, verdict } of cases) {
    const got = classify(observations);
    if (got.verdict !== verdict) {
      console.error(`check-live-repository-cache: SELF-TEST FAILED — ${name}: expected ${verdict}, got ${got.verdict} (${got.reason})`);
      failed += 1;
    }
  }
  if (failed > 0) process.exit(1);
  console.log(`check-live-repository-cache: self-test ok (${cases.length} classify cases + ${headerCases.length} header cases + ${neverSharedCases.length} never-shared cases, pass/warn/fail all exercised)`);
}

async function probe(url, headers = {}) {
  try {
    const res = await fetch(url, { redirect: "manual", headers });
    const { name, value } = readCacheHeader(res.headers);
    return { status: res.status, cacheHeader: value, cacheHeaderName: name, cdnCacheControl: res.headers.get("cdn-cache-control"), mitigated: res.headers.get("cf-mitigated") };
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
      `check-live-repository-cache: ${path} attempt ${attempt}/${ATTEMPTS} — status ${observation.status}, ${observation.cacheHeaderName ?? "no cache header"}: ${observation.cacheHeader ?? "(none)"}`,
    );
    const runningVerdict = classify(observations);
    if (runningVerdict.verdict === "pass") break;
    if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  return { path, ...classify(observations), challenged: observations.every((o) => Boolean(o.mitigated)) };
}

async function main() {
  const results = await Promise.all(CHECKED_PATHS.map((path) => checkPath(path)));
  // The never-shared probes run BEFORE the challenged verdict is reached, not after
  // it. The first version decided from the three cache paths alone and exited, so a
  // never-shared request that came back unchallenged AND wrong was never even sent.
  // (Sourcery, PR 933.)
  const neverShared = [];
  for (const probeSpec of NEVER_SHARED) {
    neverShared.push({ ...probeSpec, observation: await probe(`${SITE_ORIGIN}${probeSpec.path}`, probeSpec.headers) });
  }
  // See check-live-pages.mjs for why: from a GitHub runner, with Bot Fight Mode on
  // by the owner's ruling (ai-ops 348), every request is challenged every time.
  // EVERY one of them, cache paths and never-shared alike, or it is a failure like
  // any other.
  const everyProbeChallenged = results.length > 0
    && results.every((result) => result.challenged)
    && neverShared.every(({ observation }) => Boolean(observation.mitigated));
  if (process.argv.includes("--challenged-ok") && everyProbeChallenged) {
    console.log(`::notice::Cloudflare challenged all ${results.length + neverShared.length} cache probes against ${SITE_ORIGIN}, so this run verified nothing. Expected from a GitHub runner while Bot Fight Mode is on (ai-ops 348). Read the cache from an ordinary connection after a change to the cache rule: node scripts/check-live-repository-cache.mjs`);
    process.exit(0);
  }
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
  for (const { path, headers, what, edgeOnly, observation } of neverShared) {
    const { verdict, reason } = classifyNeverShared(observation, { edgeOnly });
    const sent = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join(", ") || "no extra headers";
    if (verdict === "pass") {
      console.log(`check-live-repository-cache: PASS never shared: ${path} with ${sent} (${what}) — ${reason}`);
    } else {
      console.log(`::error::check-live-repository-cache: FAIL never shared: ${path} with ${sent} (${what}) — ${reason}`);
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
