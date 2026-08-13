import assert from "node:assert/strict";
import test from "node:test";
import {
  PAGEVIEW_LOG_MARKER,
  isPrefetch,
  isProbablyBot,
  pageviewLoggingEnabled,
  pageviewSignal,
  publicRoute,
  referrerHost,
  type HeaderLookup,
} from "./pageview-signal.ts";

/** A `Headers`-shaped double over a plain object, lowercased like the real one. */
function headers(entries: Record<string, string> = {}): HeaderLookup {
  const lower = new Map(Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

/** A user agent that must survive every filter, so "0" is never the only result. */
const REAL_BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

test("the four approved routes are the ones that count", () => {
  assert.equal(publicRoute("/"), "/");
  assert.equal(publicRoute("/repository"), "/repository");
  assert.equal(publicRoute("/repository/layers"), "/repository/layers");
  assert.equal(publicRoute("/repository/grover-search"), "/repository/[slug]");
});

test("the layers page is not swallowed by the slug bucket", () => {
  // "layers" is a valid slug shape. If the `[slug]` branch ran first, the map's
  // layers view would be counted as an entry read and the one surface the
  // wrap-vs-grow argument is about would have no number of its own.
  assert.equal(publicRoute("/repository/layers"), "/repository/layers");
  assert.notEqual(publicRoute("/repository/layers"), "/repository/[slug]");
});

test("a trailing slash is the same page, not a fifth route", () => {
  assert.equal(publicRoute("/repository/"), "/repository");
  assert.equal(publicRoute("/repository/layers/"), "/repository/layers");
  assert.equal(publicRoute("/repository/grover-search/"), "/repository/[slug]");
});

test("private and unknown paths are not counted", () => {
  // Every one of these reaches the same middleware. Counting any of them would
  // put authenticated app traffic into a number reported as public readership.
  for (const path of ["/studio", "/library", "/run", "/account", "/api/runs", "/pricing", "/terms"]) {
    assert.equal(publicRoute(path), null, path);
  }
  // Nothing is served below an entry.
  assert.equal(publicRoute("/repository/grover-search/raw"), null);
});

test("scanner noise below /repository is rejected on slug shape", () => {
  for (const path of [
    "/repository/wp-login.php",
    "/repository/.env",
    "/repository/../etc/passwd",
    "/repository/Grover_Search",
    "/repository/",
  ]) {
    assert.notEqual(publicRoute(path), "/repository/[slug]", path);
  }
});

test("speculative fetches are excluded, real navigations are not", () => {
  assert.equal(isPrefetch(headers({ "next-router-prefetch": "1" })), true);
  assert.equal(isPrefetch(headers({ "x-middleware-prefetch": "1" })), true);
  assert.equal(isPrefetch(headers({ purpose: "prefetch" })), true);
  assert.equal(isPrefetch(headers({ "Sec-Purpose": "prefetch;anonymous-client-ip" })), true);
  assert.equal(isPrefetch(headers({ "sec-purpose": "prerender" })), true);

  // A client-side navigation carries RSC but no prefetch marker, and IS a read.
  assert.equal(isPrefetch(headers({ rsc: "1" })), false);
  // The positive control: an ordinary document request must pass.
  assert.equal(isPrefetch(headers({ "user-agent": REAL_BROWSER })), false);
});

test("automated clients are excluded, and a real browser is not", () => {
  for (const ua of [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "curl/8.4.0",
    "node-fetch/1.0",
    "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0",
    "facebookexternalhit/1.1",
  ]) {
    assert.equal(isProbablyBot(ua), true, ua);
  }
  // No UA is our own SSR egress or a script, never a reader.
  assert.equal(isProbablyBot(null), true);
  assert.equal(isProbablyBot("   "), true);
  // The positive control. A filter that rejects everything reports nobody read
  // the map, which is indistinguishable from the answer we are looking for.
  assert.equal(isProbablyBot(REAL_BROWSER), false);
});

test("only somebody else's host is kept, and only the host", () => {
  assert.equal(referrerHost("https://news.ycombinator.com/item?id=1", "leonaqt.com"), "news.ycombinator.com");
  // A referrer's query string is their visitor's data, not ours to store.
  assert.equal(referrerHost("https://www.google.com/search?q=secret+terms", "leonaqt.com"), "www.google.com");
  // Our own navigation is not an arrival.
  assert.equal(referrerHost("https://leonaqt.com/repository", "leonaqt.com"), null);
  assert.equal(referrerHost(null, "leonaqt.com"), null);
  assert.equal(referrerHost("not a url", "leonaqt.com"), null);
});

test("a counted read writes a route pattern, a UTC day, and nothing else", () => {
  const signal = pageviewSignal({
    pathname: "/repository/grover-search",
    headers: headers({ "user-agent": REAL_BROWSER, referer: "https://news.ycombinator.com/item?id=1" }),
    selfHost: "leonaqt.com",
    now: new Date("2026-08-14T23:30:00.000Z"),
  });
  assert.deepEqual(signal, {
    evt: PAGEVIEW_LOG_MARKER,
    route: "/repository/[slug]",
    day: "2026-08-14",
    ref: "news.ycombinator.com",
  });
  // The whole payload is those four keys. If an identifier is ever added, this
  // is the assertion that has to be deleted to do it.
  assert.deepEqual(Object.keys(signal ?? {}).sort(), ["day", "evt", "ref", "route"]);
  // The slug the visitor read is not in the record.
  assert.equal(JSON.stringify(signal).includes("grover-search"), false);
});

test("the day is UTC, not the reader's and not the owner's", () => {
  // 23:30 UTC on the 14th is already the 15th in Tokyo and still the 14th in
  // California. The bucket is UTC so that a run of daily counts is comparable
  // with itself; anyone reading it must not assume local days.
  const signal = pageviewSignal({
    pathname: "/",
    headers: headers({ "user-agent": REAL_BROWSER }),
    selfHost: "leonaqt.com",
    now: new Date("2026-08-14T23:30:00.000Z"),
  });
  assert.equal(signal?.day, "2026-08-14");
});

test("prefetches, bots, and private paths produce no line at all", () => {
  const base = {
    headers: headers({ "user-agent": REAL_BROWSER }),
    selfHost: "leonaqt.com",
    now: new Date("2026-08-14T12:00:00.000Z"),
  };
  assert.equal(pageviewSignal({ ...base, pathname: "/studio" }), null);
  assert.equal(
    pageviewSignal({
      ...base,
      pathname: "/repository",
      headers: headers({ "user-agent": REAL_BROWSER, "next-router-prefetch": "1" }),
    }),
    null,
  );
  assert.equal(
    pageviewSignal({ ...base, pathname: "/repository", headers: headers({ "user-agent": "curl/8.4.0" }) }),
    null,
  );
  // The positive control again, at the level that matters: with the same
  // fixtures minus the disqualifier, a line IS produced.
  assert.equal(pageviewSignal({ ...base, pathname: "/repository" })?.route, "/repository");
});

test("the counter is on unless somebody turns it off", () => {
  // Default-on is the point: a flag nobody sets makes the counter report zero
  // reads, which reads exactly like the finding it was built to test for.
  assert.equal(pageviewLoggingEnabled({}), true);
  assert.equal(pageviewLoggingEnabled({ LEONA_PAGEVIEW_LOG: "" }), true);
  assert.equal(pageviewLoggingEnabled({ LEONA_PAGEVIEW_LOG: "on" }), true);
  assert.equal(pageviewLoggingEnabled({ LEONA_PAGEVIEW_LOG: "off" }), false);
  assert.equal(pageviewLoggingEnabled({ LEONA_PAGEVIEW_LOG: "OFF" }), false);
  assert.equal(pageviewLoggingEnabled({ LEONA_PAGEVIEW_LOG: "0" }), false);
  assert.equal(pageviewLoggingEnabled({ LEONA_PAGEVIEW_LOG: "false" }), false);
});
