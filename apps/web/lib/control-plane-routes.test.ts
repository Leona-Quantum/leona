import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Every BFF route reaches the control plane the same way.
 *
 * `control-plane.test.ts` proves the helper aborts, classifies and answers
 * correctly. It cannot prove the routes *use* it, and that is the half that
 * actually decays: the timeout pass migrated twenty-eight routes and missed
 * one, which kept a hand-written `502` and therefore reported a hung upstream
 * as a refused one. Nothing failed — the route compiled, typechecked and
 * behaved plausibly.
 *
 * So this reads the routes as text and asserts the invariant across all of
 * them at once. It is a lint, not a unit test, and it is deliberately blunt:
 * the next route someone adds inherits the timeout or fails here.
 */

const API_DIR = fileURLToPath(new URL("../app/api", import.meta.url));

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

const routes = routeFiles(API_DIR).map((path) => ({
  name: path.slice(API_DIR.length + 1),
  source: readFileSync(path, "utf8"),
}));

const proxies = routes.filter(({ source }) =>
  /\b(?:fetchControlPlane|openControlPlaneStream)\s*\(/.test(source),
);

/**
 * The positive control. Every assertion below is a `for` loop over a list, and
 * a loop over an empty list passes — a walk that silently stopped finding
 * routes (a moved directory, a renamed file convention) would turn this whole
 * file green while checking nothing.
 *
 * The bounds are loose on purpose: they exist to catch "found nothing", not to
 * be edited every time a route is added.
 */
test("the sweep actually found the routes it claims to check", () => {
  assert.ok(routes.length >= 25, `expected to find the BFF routes, found ${routes.length}`);
  assert.ok(
    proxies.length >= 25,
    `expected most routes to proxy the control plane, found ${proxies.length} of ${routes.length}`,
  );
});

test("every route that calls the control plane answers failure through the helper", () => {
  for (const { name, source } of proxies) {
    // A call, not merely the import: the route this test was written for kept
    // its own `502` while the import sat unused two lines above it.
    assert.match(
      source,
      /\bcontrolPlaneUnavailable\s*\(/,
      `${name} calls the control plane but does not answer through controlPlaneUnavailable`,
    );
  }
});

/**
 * The specific shape of the miss: a route with its own `502` cannot report a
 * timeout as a `504`, because it never looked at the error. Routes that do not
 * call the control plane are exempt by construction — `account/profile` talks
 * to the WorkOS SDK and owns its own `502` legitimately.
 */
test("no control-plane route hand-writes its own gateway status", () => {
  for (const { name, source } of proxies) {
    assert.doesNotMatch(
      source,
      /status:\s*50[24]\b/,
      `${name} writes its own gateway status; controlPlaneUnavailable decides 502 vs 504`,
    );
  }
});

test("no route builds a control-plane URL of its own", () => {
  for (const { name, source } of routes) {
    assert.doesNotMatch(
      source,
      /NEXT_PUBLIC_API_URL/,
      `${name} reads the base URL directly; use controlPlaneUrl so the timeout comes with it`,
    );
  }
});

/**
 * Blank out comments and string bodies so the scan below sees code only.
 *
 * The first version of this file anchored on `await|return|= fetch(` purely to
 * avoid one comment in `account/profile` that mentions `fetch()` in prose. That
 * bought a false negative for every other call form — `fetch(url);` on its own
 * line, `void fetch(url)`, `globalThis.fetch(url)` — each of which is an untimed
 * call that would have passed. Removing the prose instead lets the check be the
 * obvious one.
 *
 * Characters are replaced rather than deleted so that nothing new abuts
 * anything else and creates a match that was not in the source.
 *
 * Known limit: a regular-expression literal containing an odd quote would be
 * misread as opening a string. No route contains one, and `no route calls fetch
 * directly` failing loudly is the failure mode, not passing quietly.
 */
export function stripCommentsAndStrings(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//" || two === "/*") {
      const end =
        two === "//"
          ? (source.indexOf("\n", i) + 1 || source.length + 1) - 1
          : (source.indexOf("*/", i) + 2 || source.length + 2) - 2 + 2;
      out += " ".repeat(end - i);
      i = end;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      out += " ";
      i += 1;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      out += " ";
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * The stripper is the load-bearing half of the test below, so it is checked
 * against the cases that motivated it rather than trusted. Without the first
 * assertion the scan fails on a comment; without the rest it passes on a real
 * untimed call.
 */
test("the comment stripper keeps code and drops prose", () => {
  assert.doesNotMatch(stripCommentsAndStrings("// opaque to a fetch() caller"), /\bfetch\s*\(/);
  assert.doesNotMatch(stripCommentsAndStrings('/* see fetch(x) */'), /\bfetch\s*\(/);
  assert.doesNotMatch(stripCommentsAndStrings('const s = "fetch(evil)";'), /\bfetch\s*\(/);
  for (const call of [
    "fetch(url);",
    "void fetch(url);",
    "const r = (await fetch(url));",
    "return globalThis.fetch(url);",
    "await  fetch (url);",
  ]) {
    assert.match(stripCommentsAndStrings(call), /\bfetch\s*\(/, `should have caught: ${call}`);
  }
  // The helpers must not read as a bare `fetch` — the name only differs after
  // the point the pattern stops looking.
  assert.doesNotMatch(stripCommentsAndStrings("await fetchControlPlane(u);"), /\bfetch\s*\(/);
});

/**
 * A bare `fetch` is the one way to reintroduce an untimed call without
 * tripping anything above.
 */
test("no route calls fetch directly", () => {
  for (const { name, source } of routes) {
    assert.doesNotMatch(
      stripCommentsAndStrings(source),
      /\bfetch\s*\(/,
      `${name} calls fetch directly; use fetchControlPlane or openControlPlaneStream`,
    );
  }
});
