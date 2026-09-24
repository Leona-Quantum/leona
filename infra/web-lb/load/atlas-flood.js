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
// Cloudflare, from Cloud Armor and from Cloud Run are three different findings:
//   cloudrun  body is "Rate exceeded." (Cloud Run: no available instance)
//   armor     x-cloud-trace-context present, not Cloud Run's body (the LB answered)
//   cloudflare no x-cloud-trace-context (never reached Google)
//   app       anything else that reached the service
//
// Point it only at a hostname you own and that serves no real visitors.
import http from "k6/http";
import { Counter } from "k6/metrics";
import { SharedArray } from "k6/data";

const HOST = __ENV.HOST || "https://gcp-preview.leonaqt.com";
const CRAWL_RPS = Number(__ENV.CRAWL_RPS || 40);
const VISITOR_RPS = Number(__ENV.VISITOR_RPS || 2);
const MINUTES = Number(__ENV.MINUTES || 5);
const UA = "leona-loadtest/1 (+infra/web-lb/load)";

const urls = new SharedArray("crawler", () => {
  const d = JSON.parse(open("./crawler-urls-20260924.json"));
  return [d.map, d.node];
});

const VISITOR_PATHS = [
  "/", "/", "/", "/about", "/pricing", "/repository",
  "/repository/amplitude-estimation", "/opengraph-image", "/robots.txt",
];

const resp = new Counter("resp");

export const options = {
  discardResponseBodies: false,
  scenarios: {
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
  },
};

// `Via: 1.1 google` is added by Google's front end, so it is on everything that
// reached the load balancer — including a response Cloudflare then cached, which
// is why `Cf-Cache-Status: HIT` is read first. `X-Cloud-Trace-Context` is NOT a
// usable witness through k6: Cloudflare passes it to curl and it was absent on
// every k6 response measured, so this does not key on it.
function who(r) {
  if (r.status === 0) return "network";
  const body = typeof r.body === "string" ? r.body.slice(0, 40) : "";
  if (r.status === 429 && body.startsWith("Rate exceeded.")) return "cloudrun";
  if ((r.headers["Cf-Cache-Status"] || "") === "HIT") return "cf-cache";
  const google = /google/i.test(r.headers["Via"] || "");
  if (!google) return "cloudflare";
  if (r.status === 429 || r.status === 403) return r.headers["X-Leona-Shed"] ? "app" : "armor";
  return "app";
}

function record(scenario, cls, r) {
  resp.add(1, { scenario, cls, code: String(r.status), src: who(r) });
}

let staticChunk = null;

export function crawler() {
  const [map, node] = urls;
  const isMap = Math.random() < 0.65;
  const list = isMap ? map : node;
  const path = list[Math.floor(Math.random() * list.length)];
  const sep = path.includes("?") ? "&" : "?";
  const bust = `${__VU}-${__ITER}-${Math.floor(Math.random() * 1e9)}`;
  const r = http.get(`${HOST}${path}${sep}lt=${bust}`, {
    headers: { "User-Agent": UA + " crawler" }, timeout: "60s",
    tags: { name: isMap ? "map?" : "node?" },
  });
  record("crawler", isMap ? "map" : "node", r);
}

export function visitor() {
  let path = VISITOR_PATHS[Math.floor(Math.random() * VISITOR_PATHS.length)];
  if (Math.random() < 0.15) {
    if (!staticChunk) {
      const home = http.get(`${HOST}/`, { headers: { "User-Agent": UA + " visitor" } });
      const m = typeof home.body === "string" ? home.body.match(/\/_next\/static\/[^"]+\.js/) : null;
      staticChunk = m ? m[0] : "/robots.txt";
    }
    path = staticChunk;
  }
  const r = http.get(`${HOST}${path}`, {
    headers: { "User-Agent": UA + " visitor" }, timeout: "60s", tags: { name: path },
  });
  const cls = path === "/" ? "home" : path.startsWith("/_next/") ? "static" : path.startsWith("/repository") ? "atlas" : "page";
  record("visitor", cls, r);
}
