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
//
// A LANE OR CARD CLICK ON AN ALREADY-OPEN MAP IS ALSO AN RSC REQUEST, corrected
// 2026-09-24 21:40 UTC from a real-browser re-measurement: clicking a lane sent
// `GET /repository/layers?open=…&sel=…&_rsc=<token>` with header `RSC: 1`, not a
// document load. The document-load, ~1 s-server-render shape the 2026-09-24
// incident actually saw was arrivals at a specific `?open=` URL from OUTSIDE the
// app (a shared link, a bookmark, a crawler with no browser session) — this
// script models that as the rarer "deep link" arrival (`DEEP_LINK_RATE` of
// sessions), and everything else as clicks inside an already-open map. Next
// does not expose the router-state hash for an arbitrary `open=`/`sel=` value
// the way it does for a handful of fixed links, so a map click's `_rsc` is a
// fresh random token per click rather than the learned value `rscParam` computes
// for the small, fixed set of header links (see `get()`).
//
// Think time between steps is 2-6 s, which is a brisk reader rather than an
// average one.
//
// Nothing here busts Cloudflare's cache on purpose: what reaches the origin is
// what a real reader's requests would make reach it.
//
// Also models back/forward (a click to a state already visited this session,
// same RSC cost as any other map click) and the occasional static chunk fetch a
// page load or cache miss produces.
import http from "k6/http";
import { sleep } from "k6";
import { SharedArray } from "k6/data";
import { record, startDelay, UA_BASE } from "./lib.js";

const HOST = __ENV.HOST || "https://gcp-preview.leonaqt.com";
const VUS = Number(__ENV.VUS || 30);
const MINUTES = Number(__ENV.MINUTES || 10);
// Unix seconds; lets this run start in lockstep with the crawler matrix (see
// atlas-flood.js and .github/workflows/loadtest-atlas.yml).
const START_AT = Number(__ENV.START_AT || 0);
// What a home-page view fires after the document, measured in a real browser on
// gcp-preview 2026-09-24: the session probe, then RSC prefetches of the header's
// links — each link twice, with different `_rsc` values (two router states).
// None of it is cached by Cloudflare (RSC is DYNAMIC), so all of it reaches the
// origin. The Atlas and map pages fire none: the map links with plain anchors.
const HOME_FOLLOW_UPS = ["/api/auth/session",
  "/workspace", "/repository", "/about", "/pricing", "/contact", "/",
  "/workspace", "/repository", "/about", "/pricing", "/contact", "/"];
const UA = UA_BASE + " browse";
// A minority of sessions arrive at a specific map state from OUTSIDE the app
// (a shared link, a bookmark) rather than by clicking through an already-open
// map -- see the file header. That arrival is a document load; everything
// else is an RSC click.
const DEEP_LINK_RATE = 0.1;

const urls = new SharedArray("map-states", () => {
  const d = JSON.parse(open("./crawler-urls-20260924.json"));
  return d.map.concat(d.node);
});

export const options = {
  scenarios: {
    browse: {
      executor: "constant-vus", vus: VUS, duration: `${MINUTES}m`, exec: "browse",
      startTime: `${startDelay(START_AT)}s`,
    },
  },
};

// Next validates `_rsc` against a hash of the router headers and 307s a request
// whose value does not match (measured: a random `_rsc` always costs a redirect
// hop). A browser computes the hash, so it never pays that hop; this learns the
// right value once per (path, kind) from the redirect and reuses it, so the
// origin sees what a browser's navigation would make it see. An earlier run of
// this script used random values and sent 5,278 extra 307s in ten minutes.
const rscFor = {};
function rscParam(path, headers) {
  const key = `${path}|${headers["Next-Router-Prefetch"] || ""}`;
  if (rscFor[key] === undefined) {
    const probe = http.get(`${HOST}${path}${path.includes("?") ? "&" : "?"}_rsc=x`, { headers, redirects: 0, timeout: "60s", tags: { name: "rsc-probe" } });
    const m = (probe.headers["Location"] || "").match(/_rsc=([^&]+)/);
    rscFor[key] = m ? m[1] : "x";
  }
  return rscFor[key];
}

// A map click's own `_rsc`: unlike the handful of fixed links `rscParam`
// learns a value for, the map's `open=`/`sel=` state is combinatorial, so
// there is no small state space to learn against. Real clicks were measured
// sending a fresh token each time, not a validated hash, so this doesn't
// pretend to compute the "right" one either.
function randomRsc() {
  return Math.random().toString(36).slice(2, 10);
}

function get(path, cls, rsc) {
  const headers = { "User-Agent": UA };
  let url = `${HOST}${path}`;
  if (rsc) {
    headers.RSC = "1";
    if (rsc === "prefetch") headers["Next-Router-Prefetch"] = "1";
    const rscValue = rsc === "mapclick" ? randomRsc() : rscParam(path, headers);
    url += `${path.includes("?") ? "&" : "?"}_rsc=${rscValue}`;
  }
  const r = http.get(url, { headers, timeout: "60s", tags: { name: cls } });
  const suffix = rsc === "prefetch" ? "prefetch" : "rsc";
  record("browse", rsc ? `${cls}:${suffix}` : cls, r);
  return r;
}

function think() { sleep(2 + Math.random() * 4); }

function mapState() {
  // A real map state, not a random string: the renderer does the same work a
  // reader's click makes it do.
  const u = urls[Math.floor(Math.random() * urls.length)];
  return u;
}

// A page load or a cache miss pulls in a JS chunk; a static chunk on this
// site is served through the same Cloudflare -> LB -> Cloud Run path as
// everything else, so it belongs in the non-Atlas request count. Fetched at
// most once per VU (browsers cache it after the first load).
let staticChunk = null;
function maybeStatic() {
  if (Math.random() >= 0.15) return;
  if (!staticChunk) {
    const home = http.get(`${HOST}/`, { headers: { "User-Agent": UA } });
    const m = typeof home.body === "string" ? home.body.match(/\/_next\/static\/[^"]+\.js/) : null;
    staticChunk = m ? m[0] : "/robots.txt";
  }
  const r = http.get(`${HOST}${staticChunk}`, { headers: { "User-Agent": UA }, timeout: "60s", tags: { name: "static" } });
  record("browse", "static", r);
}

export function browse() {
  get("/", "home");
  maybeStatic();
  for (const p of HOME_FOLLOW_UPS) {
    if (p === "/api/auth/session") get(p, "session");
    else get(p, p === "/" ? "home" : p.startsWith("/repository") ? "atlas" : "page", "prefetch");
  }
  think();
  get("/repository", "atlas", "nav");
  think();
  // Arrival at the map: either the index (a document load, from the Atlas
  // page's own link) followed by clicking around inside it, or -- the
  // minority case -- straight to a specific state from outside the app (a
  // shared link), which is ALSO a document load, but with no index step and
  // no RSC header. Either way, everything that follows from an already-open
  // map is an RSC click (see the file header).
  const visited = [];
  if (Math.random() < DEEP_LINK_RATE) {
    const state = mapState();
    get(state, "map"); // deep link: plain document GET, no RSC
    visited.push(state);
  } else {
    get("/repository/layers", "map"); // the bare index
  }
  // Exploring the map: a few clicks, each an RSC request for a new state,
  // plus back/forward through states already seen this session -- same RSC
  // cost as a new click.
  const clicks = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < clicks; i++) {
    think();
    const goBack = visited.length > 1 && Math.random() < 0.3;
    const state = goBack ? visited[visited.length - 2] : mapState();
    get(state, "map", "mapclick");
    if (!goBack) visited.push(state);
  }
  if (visited.length > 1 && Math.random() < 0.4) {
    // back once, then forward again to the state that was current before it.
    think();
    get(visited[visited.length - 2], "map", "mapclick");
    think();
    get(visited[visited.length - 1], "map", "mapclick");
  }
  think();
  get("/repository/amplitude-estimation", "record", "nav");
  think();
  get("/about", "page", "nav");
  think();
}
