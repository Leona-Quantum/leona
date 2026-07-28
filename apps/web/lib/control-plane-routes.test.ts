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
 * A bare `fetch` is the one way to reintroduce an untimed call without
 * tripping anything above. Anchored on the call forms that actually appear in
 * a route body so that prose mentioning `fetch()` in a comment does not fail
 * the build.
 */
test("no route calls fetch directly", () => {
  for (const { name, source } of routes) {
    assert.doesNotMatch(
      source,
      /(?:await|return|=)\s+fetch\s*\(/,
      `${name} calls fetch directly; use fetchControlPlane or openControlPlaneStream`,
    );
  }
});
