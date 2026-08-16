import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

/**
 * The WorkOS authorization URL may be minted in a Route Handler, and nowhere else.
 *
 * ## The outage this exists to prevent
 *
 * On 2026-08-16 an `@workos-inc/authkit-nextjs` 2.17 -> 4.3 upgrade made every
 * `chrome="full"` page return HTTP 500 in production for over an hour, and the
 * upgrade was reverted (PR 654) rather than diagnosed under the outage. Two
 * Aikido security PRs have been blocked behind it since.
 *
 * The cause is not an API change — nothing about the signature moved, which is
 * why `tsc` was clean. `getSignInUrl()` calls `setPKCECookie()`, which calls
 * `cookies().set()`, and **Next.js permits a cookie write only in a Server
 * Action or a Route Handler**. A Server Component that reaches it throws
 * `Cookies can only be modified in a Server Action or Route Handler`, which is
 * a 500 on the page.
 *
 * Under v2 that was dormant rather than absent: PKCE was opt-in behind
 * `WORKOS_ENABLE_PKCE`, and with it off `getAuthorizationUrl()` returned
 * `pkceCookieValue: undefined` and `setPKCECookie` returned early without
 * writing. v4 makes PKCE unconditional. So three render-time callers that had
 * worked for months all began to 500 on the same deploy:
 * `app/repository/[slug]/page.tsx`, `components/public-site.tsx` (every page
 * using the default `chrome="full"` — `/repository/papers`,
 * `/repository/folders`), and, without throwing, `app/api/auth/session/route.ts`,
 * which instead accumulated a ~600-byte PKCE verifier cookie per poll.
 *
 * ## Why a test and not a comment
 *
 * The rule was already written down — `app/auth/sign-in/route.ts` and
 * `lib/sign-in.ts` both explain that the per-request hand-off belongs after the
 * click — and three call sites violated it anyway, because prose does not fail
 * a build. Every other check passed on the broken deploy: 1252 web tests, a
 * clean typecheck, a green deploy and a green `web-deploy-watch`. The live-page
 * probe added afterwards (`scripts/check-live-pages.mjs`) does catch it, but
 * only after a deployment exists. This catches it on the PR.
 *
 * The guard is deliberately about IMPORTS rather than about the 500: a call
 * that mints the URL during a render is wrong even on a version where it
 * happens not to throw, because it also makes the page uncacheable and puts a
 * one-shot challenge into HTML a CDN may store.
 */

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const ROOTS = ["app", "components", "lib"];

const SKIP_DIRS = new Set(["node_modules", ".next", ".next-agent", ".next-agent-b", ".next-prod-agent"]);

/**
 * The AuthKit exports that mint an authorization URL, and therefore write the
 * PKCE verifier cookie. `signOut` is not here: it also writes cookies, but it
 * is reached from `app/auth/sign-out/route.ts`, a Route Handler, and it has no
 * render-time shape to guard against.
 */
const MINTING_EXPORTS = ["getSignInUrl", "getSignUpUrl"];

/**
 * The one module allowed to import them, and the one module allowed to call the
 * wrapper it exposes. Both are paths, compared exactly.
 *
 * `lib/auth.ts` wraps them as `getMajoranaAuthorizationUrl()`;
 * `app/auth/sign-in/route.ts` is the Route Handler that calls it after a click.
 * Widening either list is a decision about where a cookie may be written, so it
 * should be made in a review, which is what failing here forces.
 */
const MAY_IMPORT_MINTER = ["lib/auth.ts"];
const MAY_CALL_WRAPPER = ["lib/auth.ts", "app/auth/sign-in/route.ts"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** POSIX-shaped, so the expected lists above read the same on every platform. */
function repoPath(full: string): string {
  return relative(webRoot, full).split(sep).join("/");
}

function allSources(): string[] {
  return ROOTS.flatMap((root) => sourceFiles(join(webRoot, root)));
}

/**
 * Strip comments before matching.
 *
 * Several of these files discuss `getSignInUrl` at length in exactly the
 * comments that explain this rule — including the one above. A guard that
 * counted those would fail on its own documentation, so it would be deleted,
 * and then it would catch nothing.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
}

test("only lib/auth.ts imports the AuthKit sign-in URL minters", () => {
  const offenders: string[] = [];

  for (const full of allSources()) {
    const body = code(readFileSync(full, "utf8"));
    // Any import clause naming the package, in any form: named, namespace,
    // default, or bare. The specifier is what matters, then the named bindings.
    // Index 0 is the whole match; the leading comma skips it. Getting this
    // wrong makes every check below compare a clause against a package name,
    // which finds nothing and reports a clean tree — the exact shape of a guard
    // that passes on the bug it exists to catch.
    for (const [, clause, specifier] of body.matchAll(
      /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g,
    )) {
      if (specifier !== "@workos-inc/authkit-nextjs") continue;
      // `import type { … }` is erased and cannot call anything.
      if (/^\s*type\s/.test(clause)) continue;
      const named = MINTING_EXPORTS.filter((name) =>
        new RegExp(`(^|[{,\\s])${name}\\s*(,|\\}|$|\\s+as\\s)`).test(clause),
      );
      // A namespace import hands over every export, this one included.
      const namespaced = /^\s*\*\s+as\s+\w+/.test(clause);
      if (named.length > 0 || namespaced) offenders.push(repoPath(full));
    }
  }

  assert.deepEqual(
    [...new Set(offenders)].sort(),
    [...MAY_IMPORT_MINTER].sort(),
    "A module outside lib/auth.ts imports getSignInUrl/getSignUpUrl from AuthKit. " +
      "Those write the PKCE verifier cookie, which Next.js allows only in a Server " +
      "Action or a Route Handler — from a render it is an HTTP 500. Link to " +
      "majoranaSignInPath() from lib/sign-in.ts instead and let " +
      "app/auth/sign-in/route.ts mint the real URL after the click.",
  );
});

test("only the sign-in Route Handler calls getMajoranaAuthorizationUrl", () => {
  const callers: string[] = [];

  for (const full of allSources()) {
    const body = code(readFileSync(full, "utf8"));
    if (/\bgetMajoranaAuthorizationUrl\b/.test(body)) callers.push(repoPath(full));
  }

  assert.deepEqual(
    callers.sort(),
    [...MAY_CALL_WRAPPER].sort(),
    "getMajoranaAuthorizationUrl() mints the WorkOS URL and writes a PKCE cookie. " +
      "It is reachable only from a Route Handler. If a page needs a sign-in link, " +
      "it wants the constant majoranaSignInPath() from lib/sign-in.ts.",
  );
});

/**
 * The positive half. The two tests above would both pass if every sign-in
 * control were deleted, so this asserts the replacement is actually in place on
 * the surfaces that had the bug.
 */
test("the pages that 500'd link to the constant sign-in path", () => {
  const surfaces = [
    "app/repository/[slug]/page.tsx",
    "components/public-site.tsx",
    "app/api/auth/session/route.ts",
  ];

  for (const surface of surfaces) {
    const body = code(readFileSync(join(webRoot, surface), "utf8"));
    assert.match(
      body,
      /majoranaSignInPath\s*\(/,
      `${surface} should build its sign-in href with majoranaSignInPath()`,
    );
  }
});
