import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  isPublicPath,
  isUnauthenticatedForAuthKit,
  matchesUnauthenticatedGlob,
  PUBLIC_PATHS,
  workosUnauthenticatedPaths,
} from "./public-paths.ts";

/**
 * The bug this file exists for.
 *
 * `/auth/sign-in/error` is the page that explains that the identity provider
 * did not answer. It was public to `isPublicPath()` and gated by AuthKit,
 * because a bare `/auth/sign-in` entry matches that path ONLY in Next.js
 * matcher glob syntax. So the one page written for a WorkOS outage would have
 * redirected the visitor to WorkOS.
 */
test("a page under /auth/sign-in is not gated behind signing in", () => {
  assert.equal(isPublicPath("/auth/sign-in/error"), true);
  assert.equal(
    isUnauthenticatedForAuthKit("/auth/sign-in/error"),
    true,
    "AuthKit would 307 the sign-in failure page to the provider that just failed",
  );
});

/**
 * The general invariant, so the next path added under a public one cannot fall
 * back into the gate. Asserting behaviour rather than list membership: the
 * failure mode was never a missing string, it was two matchers reading the same
 * string differently.
 */
test("both matchers agree about every public path and its subtree", () => {
  for (const path of PUBLIC_PATHS) {
    assert.equal(
      isUnauthenticatedForAuthKit(path),
      isPublicPath(path),
      `the two matchers disagree about ${path}`,
    );
    // "/" is the home page, not the whole site: neither matcher may treat it as
    // a subtree, or every gated route in the app becomes public.
    const child = path === "/" ? "/dashboard" : `${path}/child`;
    assert.equal(
      isUnauthenticatedForAuthKit(child),
      isPublicPath(child),
      `the two matchers disagree about ${child}`,
    );
  }
});

test("the root entry never publishes the whole site", () => {
  assert.equal(isPublicPath("/"), true);
  assert.equal(isUnauthenticatedForAuthKit("/"), true);
  for (const gated of ["/dashboard", "/run", "/account", "/studio", "/api/runs"]) {
    assert.equal(isPublicPath(gated), false, `${gated} must stay gated`);
    assert.equal(isUnauthenticatedForAuthKit(gated), false, `${gated} must stay gated`);
  }
});

test("the glob form spells out a subtree for every entry except the root", () => {
  assert.deepEqual(
    workosUnauthenticatedPaths(["/", "/repository", "/auth/sign-in"]),
    ["/", "/repository", "/repository/:path*", "/auth/sign-in", "/auth/sign-in/:path*"],
  );
});

test("a bare glob entry matches that path only, which is the asymmetry itself", () => {
  assert.equal(matchesUnauthenticatedGlob("/auth/sign-in", "/auth/sign-in"), true);
  assert.equal(matchesUnauthenticatedGlob("/auth/sign-in", "/auth/sign-in/error"), false);
  assert.equal(matchesUnauthenticatedGlob("/auth/sign-in/:path*", "/auth/sign-in"), true);
  assert.equal(matchesUnauthenticatedGlob("/auth/sign-in/:path*", "/auth/sign-in/error"), true);
  // A sibling that merely shares a prefix is not in the subtree.
  assert.equal(matchesUnauthenticatedGlob("/auth/sign-in/:path*", "/auth/sign-instead"), false);
});

/**
 * Every public path is real. A path listed here with no route behind it is
 * dead weight that publishes nothing; worse, it reads as a deliberate exposure
 * decision that nobody can check. `[locale]` holds the rewritten public pages,
 * so a path is satisfied by a directory under `app/` or under `app/[locale]/`.
 */
test("every public path has a route behind it", () => {
  const appDir = fileURLToPath(new URL("../app/", import.meta.url));
  const served = (dir: string): boolean => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    return entries.some((entry) =>
      (entry.isFile() && /^(page|route)\.(tsx?|jsx?)$/.test(entry.name))
      || (entry.isDirectory() && served(join(dir, entry.name))));
  };
  for (const path of PUBLIC_PATHS) {
    if (path === "/") continue;
    const segments = path.slice(1);
    assert.equal(
      served(join(appDir, segments)) || served(join(appDir, "[locale]", segments)),
      true,
      `${path} is in PUBLIC_PATHS but nothing under app/ answers it`,
    );
  }
});

/**
 * The negative arm for ai-ops 183, and the one that actually catches the
 * mistake worth catching.
 *
 * `/api/qapps/public` is public; `/api/qapps` — the SIGNED-IN list, which
 * returns every Qapp the caller owns including `quantum_source` — is not, and
 * must never become so by someone shortening the entry by one segment. The two
 * differ by seven characters and the wrong one exposes a tenant's generated
 * source.
 *
 * Asserted against BOTH matchers, because they read the same string differently
 * and this file exists because of that asymmetry. A test that only checked
 * `isPublicPath` would pass on a list AuthKit gates anyway.
 */
test("the public Qapp list is public and the signed-in Qapp list is not", () => {
  assert.equal(isPublicPath("/api/qapps/public"), true);
  assert.equal(isUnauthenticatedForAuthKit("/api/qapps/public"), true);

  assert.equal(isPublicPath("/api/qapps"), false);
  assert.equal(isUnauthenticatedForAuthKit("/api/qapps"), false);
});

/**
 * The subtree this entry really publishes, stated as a test rather than left in
 * a comment.
 *
 * `app/api/qapps/public/` has no children, but the sibling dynamic segment
 * `app/api/qapps/[qappKey]/` matches these two paths as well — measured against
 * a dev server, where `GET /api/qapps/public/executions` answers 405 (the route
 * exists and is POST-only) rather than 404. So the middleware stops gating them
 * the moment this entry lands.
 *
 * That is intended and argued for on the entry itself: each of those handlers
 * calls `getMajoranaAuth({ ensureSignedIn: true })` before it does anything.
 * This test pins the SCOPE of what was published, so that a future reader sees
 * the two routes named rather than having to rediscover the precedence rule.
 */
test("publishing the public Qapp list also un-gates the two dynamic siblings", () => {
  for (const path of ["/api/qapps/public/executions", "/api/qapps/public/visibility"]) {
    assert.equal(isPublicPath(path), true, `${path} is inside the published subtree`);
    assert.equal(isUnauthenticatedForAuthKit(path), true, `${path} is inside the published subtree`);
  }
});
