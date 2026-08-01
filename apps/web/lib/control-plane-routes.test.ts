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

/**
 * Every `/api/…` path the browser fetches has a route file behind it.
 *
 * The BFF is a directory tree, so a missing handler is not a broken import or a
 * type error — it is a Next 404, and the only place it appears is in a browser
 * with the feature in front of you. `shared/…/versions/[versionId]/route.ts`
 * was missing for exactly this reason: the control plane answered 200 at that
 * path, every Python test passed, the shared-project page listed its circuits
 * correctly, and opening one silently did nothing.
 *
 * The match is by SHAPE. A whole `${…}` segment becomes a wildcard and a
 * `[param]` directory matches any single segment, so this asserts the tree has
 * a handler at that depth rather than trying to guess ids.
 */
const CLIENT_DIRS = ["lib", "components", "app"];
const WEB_DIR = fileURLToPath(new URL("..", import.meta.url));

/**
 * Comments only — the strings are the thing being read here, which is why
 * `stripCommentsAndStrings` above is the wrong tool. Without this, a path
 * written in a docstring counts as a fetch.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.name === "node_modules" || entry.name.startsWith(".next")) return [];
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

/** Route templates the tree can serve, as segment arrays. */
const servedRoutes = routeFiles(API_DIR).map((path) =>
  path.slice(API_DIR.length + 1).replace(/\/route\.ts$/, "").split("/"),
);

/**
 * `/api/x/${id}/y?q=1` → `["x", "*", "y"]`.
 *
 * A `${…}` that is a WHOLE segment is a path parameter and becomes a wildcard.
 * One glued to the end of a segment — `/api/artifacts${query}` — is a query
 * string being appended, so it is dropped rather than treated as a segment
 * nobody serves.
 */
export function apiSegments(path: string): string[] {
  return path
    .replace(/[?#].*$/, "")
    .split("/")
    .slice(2)
    .map((part) => (/^\$\{[^}]*\}$/.test(part) ? "*" : part.replace(/\$\{[^}]*\}/g, "")))
    .filter((part) => part.length > 0);
}

export function isServed(segments: string[]): boolean {
  return servedRoutes.some(
    (route) =>
      route.length === segments.length &&
      route.every((part, index) => part.startsWith("[") || part === segments[index]),
  );
}

const fetched = CLIENT_DIRS.flatMap((dir) => sourceFiles(`${WEB_DIR}${dir}`)).flatMap((path) => {
  const source = stripComments(readFileSync(path, "utf8"));
  return [...source.matchAll(/["\'`](\/api\/[^"\'`\s]*)["\'`]/g)].map((match) => ({
    name: path.slice(WEB_DIR.length),
    path: match[1],
  }));
});

test("the api-path sweep found paths to check", () => {
  // The same positive control the sweep above has: a regex that stopped
  // matching would make the assertion below a loop over nothing.
  assert.ok(fetched.length >= 15, `expected client /api/ paths, found ${fetched.length}`);
});

test("every /api path the client fetches has a route handler", () => {
  const missing = fetched
    .filter(({ path }) => apiSegments(path).length > 0 && !isServed(apiSegments(path)))
    .map(({ name, path }) => `${path} (from ${name})`);
  assert.deepEqual(missing, [], `no BFF route handles: ${missing.join(", ")}`);
});

test("the path matcher is not vacuous", () => {
  // Without these, a bug making `isServed` always true would hide every missing
  // route and the test above would pass forever.
  assert.equal(isServed(["definitely", "not", "a", "route"]), false);
  assert.equal(isServed(["workspace", "projects"]), true);
  assert.equal(isServed(["workspace", "projects", "*", "shares"]), true);
  assert.deepEqual(apiSegments("/api/artifacts${query}"), ["artifacts"]);
  assert.deepEqual(apiSegments("/api/runs/${id}/events/stream"), ["runs", "*", "events", "stream"]);
  assert.deepEqual(apiSegments("/api/usage?window=7"), ["usage"]);
  assert.doesNotMatch(stripComments("// see /api/nowhere"), /\/api\/nowhere/);
  assert.match(stripComments('const u = "/api/usage";'), /\/api\/usage/);
});
