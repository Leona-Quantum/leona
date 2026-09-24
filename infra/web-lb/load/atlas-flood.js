// Reproduce the 2026-09-24 incident shape against a hostname that is NOT
// production, and measure what an innocent visitor meets while it runs.
//
//   k6 run -e HOST=https://gcp-preview.leonaqt.com -e CRAWL_RPS=40 -e MINUTES=5 \
//     --out json=run.json infra/web-lb/load/atlas-flood.js
//   python3 infra/web-lb/load/summarise.py run.json
//
// Two streams run at once:
//
// - `crawler` replays the URLs the crawler actually requested (the map with
//   ?focus=&open=… and node pages with ?open=…, taken from the request log and
//   stored beside this file), each with a unique `lt=` value so that every
//   request misses Cloudflare's cache exactly as the real ones did. The real
//   rate was ~58 requests/s; CRAWL_RPS sets this one.
// - `visitor` asks for what a person arriving at the site asks for, at
//   VISITOR_RPS, with NO cache-buster: the home page (which Cloudflare does not
//   cache, so it reaches the origin every time), marketing pages, the Atlas
//   index and a record page, a static chunk and the OG image.
//
// Every response is recorded with WHO answered it, because a 429 from
// Cloudflare, from Cloud Armor and from Cloud Run are three different findings
// (`who()` in lib.js says how each is told apart):
//   cloudrun     body is "Rate exceeded." (Cloud Run: no available instance)
//   cf-cache     Cloudflare served it from cache; the origin was not asked
//   cf-challenge Cloudflare challenged the client (Bot Fight Mode / a rule)
//   cloudflare   no `Via: … google` — Cloudflare answered without asking Google
//   armor        reached Google, 429/403, not Cloud Run's body
//   app          anything else that reached the service
//
// Two streams, selectable with SCENARIO=crawler|visitor|both. The distributed
// run puts `crawler` on many GitHub Actions runners and the legitimate-user
// load on one more, behaving like a real Atlas reader (see browse.js) rather
// than this file's own `visitor` scenario, which is the lighter single-page
// shape used for quick, one-address checks (see
// .github/workflows/loadtest-atlas.yml and README.md).
//
// Point it only at a hostname you own and that serves no real visitors.
import http from "k6/http";
import { SharedArray } from "k6/data";
import { record, startDelay, UA_BASE } from "./lib.js";

const HOST = __ENV.HOST || "https://gcp-preview.leonaqt.com";
const CRAWL_RPS = Number(__ENV.CRAWL_RPS || 40);
const VISITOR_RPS = Number(__ENV.VISITOR_RPS || 2);
const MINUTES = Number(__ENV.MINUTES || 5);
// Which streams this process runs: "both" (default), "crawler" or "visitor".
// The distributed test runs `crawler` on many machines (many source IPs, each
// under Cloudflare's per-IP limit — the shape the real crawler must have had
// to put ~58 requests/s on the origin for hours) and `visitor` on one more.
const SCENARIO = __ENV.SCENARIO || "both";
// Unix seconds; every process waits for it so that separately started
// machines load the origin at the same time.
const START_AT = Number(__ENV.START_AT || 0);

const urls = new SharedArray("crawler", () => {
  const d = JSON.parse(open("./crawler-urls-20260924.json"));
  return [d.map, d.node];
});

const VISITOR_PATHS = [
  "/", "/", "/", "/about", "/pricing", "/repository",
  "/repository/amplitude-estimation", "/opengraph-image", "/robots.txt",
];

export const options = {
  discardResponseBodies: false,
  scenarios: Object.fromEntries(Object.entries({
    crawler: {
      executor: "constant-arrival-rate", exec: "crawler",
      rate: CRAWL_RPS, timeUnit: "1s", duration: `${MINUTES}m`,
      preAllocatedVUs: Math.max(20, CRAWL_RPS * 3), maxVUs: Math.max(60, CRAWL_RPS * 8),
    },
    visitor: {
      executor: "constant-arrival-rate", exec: "visitor",
      rate: VISITOR_RPS, timeUnit: "1s", duration: `${MINUTES}m`,
      preAllocatedVUs: 10, maxVUs: 60,
    },
  }).filter(([name]) => SCENARIO === "both" || SCENARIO === name)
    .map(([name, sc]) => [name, { ...sc, startTime: `${startDelay(START_AT)}s` }])),
};

let staticChunk = null;

export function crawler() {
  const [map, node] = urls;
  const isMap = Math.random() < 0.65;
  const list = isMap ? map : node;
  const path = list[Math.floor(Math.random() * list.length)];
  const sep = path.includes("?") ? "&" : "?";
  const bust = `${__VU}-${__ITER}-${Math.floor(Math.random() * 1e9)}`;
  const r = http.get(`${HOST}${path}${sep}lt=${bust}`, {
    headers: { "User-Agent": UA_BASE + " crawler" }, timeout: "60s",
    tags: { name: isMap ? "map?" : "node?" },
  });
  record("crawler", isMap ? "map" : "node", r);
}

export function visitor() {
  let path = VISITOR_PATHS[Math.floor(Math.random() * VISITOR_PATHS.length)];
  if (Math.random() < 0.15) {
    if (!staticChunk) {
      const home = http.get(`${HOST}/`, { headers: { "User-Agent": UA_BASE + " visitor" } });
      const m = typeof home.body === "string" ? home.body.match(/\/_next\/static\/[^"]+\.js/) : null;
      staticChunk = m ? m[0] : "/robots.txt";
    }
    path = staticChunk;
  }
  const r = http.get(`${HOST}${path}`, {
    headers: { "User-Agent": UA_BASE + " visitor" }, timeout: "60s", tags: { name: path },
  });
  const cls = path === "/" ? "home" : path.startsWith("/_next/") ? "static" : path.startsWith("/repository") ? "atlas" : "page";
  record("visitor", cls, r);
}
