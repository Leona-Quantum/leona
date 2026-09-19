#!/usr/bin/env node
/**
 * Compare the same routes on two stacks and report where they disagree.
 *
 * Phase 3 of the GCP migration (ai-ops `gcp-migration-20260912`) is a week of
 * running Vercel and Cloud Run side by side. This is what "side by side" means
 * concretely: fetch the same path from both, and say what differs.
 *
 * ## What it compares, and why not the bytes
 *
 * Byte-identical is the wrong bar and would fail on every page. The rendered
 * HTML legitimately differs between the two: Vercel injects a deployment id
 * attribute on <html>, the two carry different build ids in their asset paths,
 * and Sentry/analytics tags differ by design. So the comparison is on the things
 * that are supposed to be identical — status, the document title, the <html lang>,
 * the count of rendered links, and a size band — and the noisy parts are
 * normalised out explicitly rather than by a similarity threshold. A threshold
 * would pass a page missing a whole section as long as the rest matched.
 *
 * ## Authentication
 *
 * The Cloud Run copy is private until the load balancer is in front of it, so it
 * needs an identity token:
 *
 *   TOKEN=$(gcloud auth print-identity-token) \
 *   node scripts/compare-web-stacks.mjs --candidate https://majorana-web-....run.app
 *
 * Once it is behind the load balancer, point --candidate at the address with a
 * Host header instead and drop the token.
 */

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const BASELINE = opt("baseline", "https://leonaqt.com");
const CANDIDATE = opt("candidate", process.env.LEONA_CANDIDATE_ORIGIN);
const LIMIT = Number(opt("limit", "40"));
const TOKEN = process.env.TOKEN ?? "";
const SELF_TEST = args.includes("--self-test");

/**
 * Everything that is ALLOWED to differ, removed before comparing. Each entry
 * names why, because an unexplained normalisation is how a real difference gets
 * hidden: the next person to see a spurious diff adds a rule, and the rule that
 * silences it also silences something else.
 */
const NORMALISERS = [
  [/ data-dpl-id="[^"]*"/g, ""],            // Vercel stamps its deployment id on <html>
  [/\/_next\/static\/[^/"']+\//g, "/_next/static/BUILD/"], // per-build asset hash
  [/"buildId":"[^"]*"/g, '"buildId":"BUILD"'],
  [/[0-9a-f]{40}/g, "SHA"],                  // commit shas in release tags
  [/nonce="[^"]*"/g, 'nonce="N"'],
];

export function fingerprint(html) {
  let s = html;
  for (const [re, to] of NORMALISERS) s = s.replace(re, to);
  return {
    title: (s.match(/<title>([^<]*)<\/title>/) ?? [, null])[1],
    lang: (s.match(/<html[^>]*\blang="([^"]*)"/) ?? [, null])[1],
    links: (s.match(/<a\s/g) ?? []).length,
    headings: (s.match(/<h[12][\s>]/g) ?? []).length,
    bytes: s.length,
  };
}

/**
 * A difference is reported when a field that must match does not, or when the
 * normalised sizes differ by more than this. The band exists because content the
 * two stacks render from the same source can still differ by a few bytes of
 * whitespace; it is a percentage of the smaller side so a large page does not get
 * a proportionally larger licence to differ.
 */
const SIZE_BAND = 0.02;

export function compare(path, a, b) {
  if (a.status !== b.status) return { path, verdict: "differ", why: `status ${a.status} vs ${b.status}` };
  if (a.status !== 200) return { path, verdict: "same", why: `both ${a.status}` };
  const fa = a.fingerprint, fb = b.fingerprint;
  for (const field of ["title", "lang"]) {
    if (fa[field] !== fb[field]) {
      return { path, verdict: "differ", why: `${field}: ${JSON.stringify(fa[field])} vs ${JSON.stringify(fb[field])}` };
    }
  }
  for (const field of ["links", "headings"]) {
    if (fa[field] !== fb[field]) {
      return { path, verdict: "differ", why: `${field}: ${fa[field]} vs ${fb[field]}` };
    }
  }
  const smaller = Math.min(fa.bytes, fb.bytes);
  const drift = Math.abs(fa.bytes - fb.bytes) / (smaller || 1);
  if (drift > SIZE_BAND) {
    return { path, verdict: "differ", why: `size ${fa.bytes} vs ${fb.bytes} (${(drift * 100).toFixed(1)}%)` };
  }
  return { path, verdict: "same", why: `${fa.bytes} bytes, ${fa.links} links` };
}

async function get(origin, path, withToken) {
  const headers = withToken && TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
  try {
    const res = await fetch(`${origin}${path}`, { headers, redirect: "manual" });
    const body = res.status === 200 ? await res.text() : "";
    return { status: res.status, fingerprint: fingerprint(body) };
  } catch (err) {
    return { status: 0, fingerprint: fingerprint(""), error: err instanceof Error ? err.message : String(err) };
  }
}

function selfTest() {
  const cases = [
    ["identical pages are the same", { status: 200, fingerprint: fingerprint("<html lang=\"en\"><title>T</title><a ><a ><h1 >") },
      { status: 200, fingerprint: fingerprint("<html lang=\"en\"><title>T</title><a ><a ><h1 >") }, "same"],
    ["a different title is reported", { status: 200, fingerprint: fingerprint("<html lang=\"en\"><title>T</title>") },
      { status: 200, fingerprint: fingerprint("<html lang=\"en\"><title>OTHER</title>") }, "differ"],
    ["a missing section shows up as a link count", { status: 200, fingerprint: fingerprint("<title>T</title><a ><a ><a >") },
      { status: 200, fingerprint: fingerprint("<title>T</title><a >") }, "differ"],
    ["a different status is reported", { status: 200, fingerprint: fingerprint("") }, { status: 500, fingerprint: fingerprint("") }, "differ"],
    ["two 404s agree", { status: 404, fingerprint: fingerprint("") }, { status: 404, fingerprint: fingerprint("") }, "same"],
    // The normalisers must actually hide the things they name, or every page
    // reports a difference and the whole comparison becomes noise nobody reads.
    ["Vercel's deployment id is normalised away", { status: 200, fingerprint: fingerprint('<html data-dpl-id="dpl_abc" lang="en"><title>T</title>') },
      { status: 200, fingerprint: fingerprint('<html lang="en"><title>T</title>') }, "same"],
    ["per-build asset hashes are normalised away", { status: 200, fingerprint: fingerprint('<title>T</title><script src="/_next/static/aaaa/x.js">') },
      { status: 200, fingerprint: fingerprint('<title>T</title><script src="/_next/static/bbbb/x.js">') }, "same"],
  ];
  let failed = 0;
  for (const [name, a, b, want] of cases) {
    const got = compare("/t", a, b);
    if (got.verdict !== want) { console.error(`SELF-TEST FAILED — ${name}: expected ${want}, got ${got.verdict} (${got.why})`); failed += 1; }
  }
  if (failed) process.exit(1);
  console.log(`compare-web-stacks: self-test ok (${cases.length} cases)`);
}

async function routes() {
  const res = await fetch(`${BASELINE}/sitemap.xml`);
  const xml = await res.text();
  const all = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname || "/");
  // Spread the sample across route shapes rather than taking the first N, which
  // on this sitemap would be 40 consecutive paper pages and would say nothing
  // about the Atlas, the marketing pages or the 404.
  const byShape = new Map();
  for (const p of all) {
    const shape = p.split("/").slice(0, 3).join("/") || "/";
    if (!byShape.has(shape)) byShape.set(shape, []);
    byShape.get(shape).push(p);
  }
  const picked = [];
  let round = 0;
  while (picked.length < LIMIT && round < 200) {
    for (const list of byShape.values()) if (list[round] && picked.length < LIMIT) picked.push(list[round]);
    round += 1;
  }
  picked.push("/this-route-does-not-exist");
  return picked;
}

// Only act when this file IS the command. Without the guard, importing it to
// exercise `fingerprint` or `compare` runs the whole comparison as a side effect
// of the import — which is how a test file ends up unable to test the thing it
// imports, and it cost a diagnosis cycle here.
const isEntryPoint = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (!isEntryPoint) { /* imported for its exports */ }
else if (SELF_TEST) { selfTest(); }
else if (!CANDIDATE) {
  console.error("compare-web-stacks: --candidate <origin> (or LEONA_CANDIDATE_ORIGIN) is required");
  process.exit(2);
} else {
  const paths = await routes();
  console.log(`compare-web-stacks: ${paths.length} routes, ${BASELINE} vs ${CANDIDATE}`);
  const results = [];
  for (const path of paths) {
    const [a, b] = await Promise.all([get(BASELINE, path, false), get(CANDIDATE, path, true)]);
    const r = compare(path, a, b);
    results.push(r);
    if (r.verdict === "differ") console.log(`  DIFFER  ${path} — ${r.why}`);
  }
  const differ = results.filter((r) => r.verdict === "differ");
  console.log(`\n${results.length - differ.length}/${results.length} identical; ${differ.length} differ`);
  process.exit(differ.length ? 1 : 0);
}
