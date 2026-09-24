// Ordinary people browsing, as the origin sees them — alone or many behind one
// address (every virtual user here shares the machine's address, which is the
// shared-IP test: a classroom, an office, a university NAT).
//
//   k6 run -e VUS=30 -e MINUTES=10 --out json=b.json infra/web-lb/load/browse.js
//   python3 infra/web-lb/load/summarise.py b.json
//
// One virtual user is one person on a loop through what the site's own pages
// make a browser send (measured in a real browser on 2026-09-24, see the
// incident note §5): a document load, the prefetches the page's links fire, and
// then client-side navigations, which are RSC requests (`RSC: 1` and an `_rsc=`
// cache-buster, exactly as Next's router sends them) rather than documents.
// The Atlas MAP is the exception, and the expensive one: it links with plain
// `<a href>`, never `next/link` (repository-converge-view.tsx: a `<Link>` would
// skip the cross-document view transition the map's zoom is built on), so every
// click there is a full DOCUMENT load of a new `?focus=&open=` URL — a Cloudflare
// cache miss and a ~1 s server render — with no prefetch in front of it. Think
// time between steps is 2-6 s, which is a brisk reader rather than an average one.
//
// Nothing here busts Cloudflare's cache on purpose: what reaches the origin is
// what a real reader's requests would make reach it.
import http from "k6/http";
import { sleep } from "k6";
import { Counter } from "k6/metrics";
import { SharedArray } from "k6/data";

const HOST = __ENV.HOST || "https://gcp-preview.leonaqt.com";
const VUS = Number(__ENV.VUS || 30);
const MINUTES = Number(__ENV.MINUTES || 10);
// Prefetch requests a page's links fire on load. Measured on the map page.
const PREFETCH = Number(__ENV.PREFETCH || 0);
const UA = "leona-loadtest/1 (+infra/web-lb/load) browse";

const urls = new SharedArray("map-states", () => {
  const d = JSON.parse(open("./crawler-urls-20260924.json"));
  return d.map.concat(d.node);
});

const resp = new Counter("resp");

export const options = {
  scenarios: { browse: { executor: "constant-vus", vus: VUS, duration: `${MINUTES}m`, exec: "browse" } },
};

function who(r) {
  if (r.status === 0) return "network";
  const body = typeof r.body === "string" ? r.body.slice(0, 40) : "";
  if (r.status === 429 && body.startsWith("Rate exceeded.")) return "cloudrun";
  if ((r.headers["Cf-Cache-Status"] || "") === "HIT") return "cf-cache";
  if (r.headers["Cf-Mitigated"]) return "cf-challenge";
  if (!/google/i.test(r.headers["Via"] || "")) return "cloudflare";
  if (r.status === 429 || r.status === 403) return "armor";
  return "app";
}

function get(path, cls, rsc) {
  const headers = { "User-Agent": UA };
  let url = `${HOST}${path}`;
  if (rsc) {
    headers.RSC = "1";
    if (rsc === "prefetch") headers["Next-Router-Prefetch"] = "1";
    url += `${path.includes("?") ? "&" : "?"}_rsc=${Math.random().toString(36).slice(2, 7)}`;
  }
  const r = http.get(url, { headers, timeout: "60s", tags: { name: cls } });
  resp.add(1, { scenario: "browse", cls: rsc ? `${cls}:${rsc === "prefetch" ? "prefetch" : "rsc"}` : cls, code: String(r.status), src: who(r) });
  return r;
}

function think() { sleep(2 + Math.random() * 4); }

function mapState() {
  // A real map state, not a random string: the renderer does the same work a
  // reader's click makes it do.
  const u = urls[Math.floor(Math.random() * urls.length)];
  return u;
}

export function browse() {
  get("/", "home");
  think();
  get("/repository", "atlas", "nav");
  think();
  for (let i = 0; i < PREFETCH; i++) get(`/repository/layers/${["block-encoding", "qsvt-transform", "linear-system"][i % 3]}`, "atlas", "prefetch");
  think();
  // The map is a document load, from the Atlas page's link and on every click.
  get("/repository/layers", "map");
  // Exploring the map: a few clicks, each a new server-rendered state.
  const clicks = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < clicks; i++) {
    think();
    get(mapState(), "map");
  }
  think();
  get("/repository/amplitude-estimation", "record", "nav");
  think();
  get("/about", "page", "nav");
  think();
}
