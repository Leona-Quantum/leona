#!/usr/bin/env node
/**
 * The routes that must still be prerendered.
 *
 * ## The failure this guards, which nothing else can see
 *
 * Next puts the root not-found boundary and the root layout in EVERY route's
 * render tree. A Dynamic API called in either — `cookies()`, `headers()`, or
 * anything reaching one — opts every page in the application out of static
 * rendering. Not the page that called it. All of them.
 *
 * That is how this site came to serve `cache-control: private, no-cache,
 * no-store` on every public page with `x-vercel-cache: MISS` on three
 * consecutive identical requests, while each individual page looked innocent.
 * It is also why an audit of the ten public pages found real Dynamic APIs and
 * still missed the disqualifying one: `app/not-found.tsx` renders on no route
 * and appears in no route's source.
 *
 * Nothing about the symptom points at the cause. A page that will not cache
 * renders correctly, returns 200, passes every test, and deploys green. The
 * only place the truth is legible is the build's own route table, which is what
 * this reads.
 *
 * ## What it does and does not prove
 *
 * It proves these routes were PRERENDERED by `next build`. It does not prove
 * the CDN serves them from the edge — that needs `x-vercel-cache: HIT` on a
 * repeat request against a real deployment, and no build artefact can stand in
 * for it. Prerendering is necessary and not sufficient; this catches the
 * regression that makes the sufficient half impossible.
 *
 * ## Usage
 *
 *   node scripts/check-static-routes.mjs --self-test
 *   node scripts/check-static-routes.mjs --dist apps/web/.next
 *
 * `--self-test` builds a manifest that is missing a required route and asserts
 * the checker fails on it, then builds a complete one and asserts it passes. A
 * checker that cannot fail has not been shown to work — this repository has
 * been caught by that three times (the `app_rw` grant, the corpus gates on a
 * lint chain, `npx tsc` in a worktree with no node_modules), so the self-test
 * is mandatory rather than nice to have.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { insideRepoSelfTest, resolveInsideRepo } from "./lib/inside-repo.mjs";

/**
 * Routes that must be prerendered, each with the reason it is on the list —
 * because a bare path tells a future reader nothing about whether removing it
 * is allowed.
 *
 * Adding a public page? Add it here. Deleting a line is a decision that this
 * page may stop being served from the edge, and it should be made on purpose.
 */
const LOCALES = ["en", "ja"];

/**
 * The clean paths middleware rewrites into `app/[locale]/`. Kept in step with
 * `apps/web/lib/routed-paths.ts` by `routed-paths.test.ts`, which checks that
 * list against the filesystem — this one only has to name what must CACHE, and
 * every entry becomes one prerendered route per locale.
 */
const LOCALE_ROUTES = ["", "/contact", "/pricing", "/privacy", "/terms", "/workspace"];

/**
 * Atlas routes that prerender, which is NOT the same set as the Atlas routes
 * that reach the CDN — and the difference is the thing to understand before
 * editing either list.
 *
 * `/repository/layers` and `/repository/layers/[id]` are around 96% of this
 * site's traffic and they are deliberately absent here. Both resolve search
 * parameters during render so a shared link arrives already panned and
 * expanded with JavaScript off, and Next opts any page reading `searchParams`
 * into request-time rendering. They cannot prerender, so requiring them here
 * would be requiring the build to do something the framework forbids. They are
 * cached in front of the render instead, by `Vercel-CDN-Cache-Control` in
 * `apps/web/next.config.ts`, and `public-revalidate.test.ts` is what asserts
 * that header still covers them.
 *
 * `/repository/claims` reads no search parameters and fetches nothing, so it is
 * the one Atlas route this check can speak for.
 */
const LOCALE_ATLAS_ROUTES = ["/repository/claims"];

export const REQUIRED_STATIC_ROUTES = [
  { route: "/_not-found", why: "the boundary in every route's tree; dynamic here makes the whole app dynamic" },
  { route: "/demo", why: "public marketing page, no per-visitor content" },
  { route: "/dev/ui", why: "static component gallery" },
  { route: "/lab", why: "public marketing page, no per-visitor content" },
  { route: "/open-source", why: "public marketing page, no per-visitor content" },
  ...LOCALES.flatMap((locale) =>
    LOCALE_ROUTES.map((path) => ({
      route: `/${locale}${path}`,
      why: `public page served from the CDN at ${path === "" ? "/" : path} via the ${locale} rewrite`,
    })),
  ),
  ...LOCALES.flatMap((locale) =>
    LOCALE_ATLAS_ROUTES.map((path) => ({
      route: `/${locale}${path}`,
      why: `Atlas page with no searchParams and no corpus fetch, served from the CDN at ${path} via the ${locale} rewrite`,
    })),
  ),
];

/** Pure, so `--self-test` exercises the same code path CI does. */
export function missingRoutes(manifest, required = REQUIRED_STATIC_ROUTES) {
  const prerendered = new Set(Object.keys(manifest?.routes ?? {}));
  return required.filter((entry) => !prerendered.has(entry.route));
}

/* ==========================================================================
 * The other direction: routes that must NEVER be prerendered.
 * ========================================================================== */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIR = resolve(REPO_ROOT, "apps", "web");

/**
 * Calls that make a render per-visitor, and therefore uncacheable.
 *
 * The rule these encode, as an orchestrator ruling rather than a taste call:
 * **any route whose render path reaches `getMajoranaAuth()`, or otherwise reads
 * a Dynamic API for per-visitor state, must never be statically prerendered.**
 * That is derivable from the code, which is why this list is call names and the
 * route list below is computed rather than typed out.
 *
 * `getPublicLocale()` is in scope through `cookies()`: a render that reads a
 * cookie cannot be shared between two readers whatever the cookie means. It is
 * also the exact call that made every page in the app dynamic before #539, so a
 * page reaching it again should fail one of these two checks in both directions.
 */
const PERSONALIZED_CALLS = [
  { pattern: /\bgetMajoranaAuth\s*\(/, what: "getMajoranaAuth()" },
  { pattern: /\bwithAuth\s*\(/, what: "withAuth()" },
  { pattern: /\bgetMajoranaSignInUrl\s*\(/, what: "getMajoranaSignInUrl()" },
  { pattern: /\bcookies\s*\(\s*\)/, what: "cookies()" },
  { pattern: /\bheaders\s*\(\s*\)/, what: "headers()" },
  { pattern: /\bdraftMode\s*\(\s*\)/, what: "draftMode()" },
];

const ROUTE_FILES = ["page.tsx", "page.ts", "page.jsx", "page.js", "route.ts", "route.js"];
/** In every descendant route's render tree, so their calls are the route's calls. */
const INHERITED_FILES = ["layout.tsx", "layout.ts", "template.tsx", "template.ts"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * The URL a route file answers on, with App Router's non-URL segments removed:
 * route groups `(app)`, parallel slots `@modal`, and interception prefixes
 * `(.)`/`(..)`/`(...)`. Dynamic segments are kept as written — matching them
 * against the manifest's concrete paths is `routeMatcher`'s job.
 */
export function routeUrlFromFile(appRelativePath) {
  const parts = appRelativePath.split("/");
  parts.pop(); // the page.tsx / route.ts itself
  const segments = [];
  for (const part of parts) {
    if (part.startsWith("@")) continue; // parallel slot
    if (/^\(\.+\)/.test(part)) {
      segments.push(part.replace(/^\(\.+\)/, ""));
      continue;
    }
    if (part.startsWith("(") && part.endsWith(")")) continue; // route group
    segments.push(part);
  }
  return `/${segments.join("/")}`.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1");
}

/** A route pattern to a matcher against the manifest's concrete prerendered paths. */
export function routeMatcher(routePattern) {
  const source = routePattern
    .split("/")
    .map((segment) => {
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return "(?:[^/]+(?:/[^/]+)*)?"; // optional catch-all
      if (/^\[\.\.\..+\]$/.test(segment)) return "[^/]+(?:/[^/]+)*"; // catch-all
      if (/^\[.+\]$/.test(segment)) return "[^/]+"; // one dynamic segment
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/")
    .replace(/\/\(\?:\[\^\/\]\+\(\?:\/\[\^\/\]\+\)\*\)\?$/, "(?:/[^/]+(?:/[^/]+)*)?");
  return new RegExp(`^${source}$`);
}

function resolveImport(fromFile, specifier, webDir) {
  let base;
  if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else if (specifier.startsWith("@/")) base = resolve(webDir, specifier.slice(2));
  else return null; // bare package — not our source
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...SOURCE_EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Every source file that contributes to one route's render, following relative
 * and `@/`-aliased imports transitively. `unresolved` is returned rather than
 * swallowed: a resolver that quietly finds nothing would classify every route as
 * impersonal and pass this check vacuously, which is the failure mode the
 * self-test's floor exists to catch.
 */
export function traceClosure(entryFiles, webDir) {
  const seen = new Set();
  const unresolved = [];
  const queue = [...entryFiles];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;
      const resolved = resolveImport(file, specifier, webDir);
      if (resolved === null) unresolved.push(`${relative(webDir, file)} -> ${specifier}`);
      else if (!seen.has(resolved)) queue.push(resolved);
    }
  }
  return { files: seen, unresolved };
}

/**
 * Every route whose render reaches a per-visitor call, computed from `app/`.
 *
 * Computed rather than listed so it stays correct as routes are added — a
 * hand-written list of route names is the thing that goes stale silently, and a
 * stale list here would read as "checked" while covering nothing.
 */
export function personalizedRoutes(webDir) {
  const appDir = join(webDir, "app");
  const all = walkFiles(appDir);
  const routes = [];
  const unresolved = [];
  for (const file of all) {
    const name = file.split("/").pop();
    if (!ROUTE_FILES.includes(name)) continue;
    const appRelative = relative(appDir, file);
    // The route file plus every layout/template above it: Next renders those in
    // this route's tree, so a Dynamic API in one of them is this route's too.
    const entries = [file];
    let dir = dirname(file);
    while (dir.startsWith(appDir)) {
      for (const inherited of INHERITED_FILES) {
        const candidate = join(dir, inherited);
        if (existsSync(candidate)) entries.push(candidate);
      }
      if (dir === appDir) break;
      dir = dirname(dir);
    }
    const closure = traceClosure(entries, webDir);
    unresolved.push(...closure.unresolved);
    let hit = null;
    for (const contributor of closure.files) {
      const text = readFileSync(contributor, "utf8");
      for (const { pattern, what } of PERSONALIZED_CALLS) {
        if (pattern.test(text)) {
          hit = { what, via: relative(webDir, contributor) };
          break;
        }
      }
      if (hit) break;
    }
    if (hit) {
      routes.push({
        route: routeUrlFromFile(appRelative),
        file: relative(webDir, file),
        why: `renders ${hit.what} (${hit.via})`,
      });
    }
  }
  return { routes, unresolved: [...new Set(unresolved)] };
}

/**
 * Split the traced routes into the ones this check enforces and the ones it
 * cannot speak for.
 *
 * The tracer reads whole files, so a call behind a condition looks identical to
 * one that always runs. Two different conditions put routes in this bucket, and
 * they are worth telling apart:
 *
 * - **A runtime prop.** `PublicSite` with `chrome="static"` short-circuits
 *   `getMajoranaAuth()` with a ternary (`components/public-site.tsx:77-80`),
 *   which is what lets the six `[locale]` pages prerender at all.
 * - **A build-time feature flag.** `/demo` and `/lab` call `notFound()` before
 *   reaching `getPublicLocale()` when their flag is off (`app/demo/page.tsx:9`,
 *   `app/lab/page.tsx:35`) — so they prerender as a 404. Turn either flag ON at
 *   build time and the page reaches `cookies()`, goes dynamic, and
 *   `missingRoutes` starts failing with a message pointing at `layout.tsx`,
 *   which is the wrong place entirely. That is a live fragility in the REQUIRED
 *   list rather than in this one, and it is recorded here because this is where
 *   the evidence for it surfaced.
 *
 * So a route that is BOTH traced as personalized and named in
 * `REQUIRED_STATIC_ROUTES` is not a contradiction to fail on — it is a route
 * whose safety rests on a runtime guard that no static read can verify. It is
 * reported and not enforced, because the regression is already covered from the
 * other side: drop `chrome="static"` and the call runs, `headers()` makes the
 * page dynamic, and `missingRoutes` fails on the very same route. The two halves
 * of this file catch that change in opposite directions, which is the argument
 * for not duplicating it as a failure here.
 */
export function partitionPersonalized(traced, required = REQUIRED_STATIC_ROUTES) {
  const requiredPaths = required.map((entry) => entry.route);
  const seen = new Set();
  const forbidden = [];
  const guardedOutsideThisCheck = [];
  for (const entry of traced) {
    if (seen.has(entry.route)) continue;
    seen.add(entry.route);
    const matcher = routeMatcher(entry.route);
    if (requiredPaths.some((path) => matcher.test(path))) guardedOutsideThisCheck.push(entry);
    else forbidden.push(entry);
  }
  return { forbidden, guardedOutsideThisCheck };
}

/** Pure, like `missingRoutes`, so the self-test drives the same code CI does. */
export function forbiddenPrerendered(manifest, forbidden) {
  const prerendered = Object.keys(manifest?.routes ?? {});
  const found = [];
  for (const entry of forbidden) {
    const matcher = routeMatcher(entry.route);
    for (const path of prerendered) {
      if (matcher.test(path)) found.push({ ...entry, prerenderedAs: path });
    }
  }
  return found;
}

function readManifest(dist) {
  const path = join(dist, "prerender-manifest.json");
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(`no prerender manifest at ${path}.`);
    console.error("Run `pnpm --filter @majorana/web build` first — a missing manifest is");
    console.error("not an empty one, and reporting it clean would be the failure this guards.");
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`prerender manifest at ${path} is not valid JSON: ${error.message}`);
    process.exit(1);
  }
}

export function selfTest() {
  const failures = [];
  const complete = { routes: Object.fromEntries(REQUIRED_STATIC_ROUTES.map((e) => [e.route, {}])) };

  if (missingRoutes(complete).length !== 0) {
    failures.push("a manifest containing every required route was reported as missing some");
  }

  for (const entry of REQUIRED_STATIC_ROUTES) {
    const routes = { ...complete.routes };
    delete routes[entry.route];
    const found = missingRoutes({ routes });
    if (!found.some((f) => f.route === entry.route)) {
      failures.push(`dropping ${entry.route} from the manifest did not fail the check`);
    }
  }

  // The empty and absent cases, which are the ones that would silently pass.
  if (missingRoutes({ routes: {} }).length !== REQUIRED_STATIC_ROUTES.length) {
    failures.push("an empty manifest did not report every route missing");
  }
  if (missingRoutes({}).length !== REQUIRED_STATIC_ROUTES.length) {
    failures.push("a manifest with no `routes` key did not report every route missing");
  }

  // ---- the forbidden-static direction ------------------------------------
  //
  // The floor first, and it is the assertion that matters most here. Every
  // other check below passes just as happily against a tracer that resolved
  // nothing: an empty personalized set produces an empty forbidden set, matches
  // no manifest key, and reports the build clean. This repository has shipped
  // that shape of bug three times, so the tracer has to prove it found the app
  // before anything it says is believed.
  const traced = personalizedRoutes(WEB_DIR);
  if (traced.unresolved.length > 0) {
    failures.push(
      `import tracing left ${traced.unresolved.length} unresolved specifier(s), ` +
        `so the personalized-route set is incomplete: ${traced.unresolved[0]}`,
    );
  }
  if (traced.routes.length === 0) {
    failures.push(
      "traced zero personalized routes — this app has an authenticated area, so a " +
        "zero here means the tracer is broken, not that the app is impersonal",
    );
  }
  const { forbidden, guardedOutsideThisCheck } = partitionPersonalized(traced.routes);
  if (forbidden.length === 0) {
    failures.push("traced no forbidden-static routes; /account alone should appear");
  }
  if (!forbidden.some((entry) => entry.route === "/account")) {
    // Not a hand-picked list — one known-authenticated route, asserted so the
    // partition cannot quietly move everything into the guarded bucket.
    failures.push("/account was not classified as forbidden-static");
  }

  // Failable in both directions, against the real traced list.
  const clean = { routes: { "/demo": {} } };
  if (forbiddenPrerendered(clean, forbidden).length !== 0) {
    failures.push("a manifest with no personalized route was reported as having one");
  }
  for (const entry of forbidden.slice(0, 5)) {
    const concrete = entry.route.replace(/\[\[?\.{0,3}([^\]]+)\]?\]/g, "x");
    const planted = { routes: { [concrete]: {} } };
    if (forbiddenPrerendered(planted, forbidden).length === 0) {
      failures.push(`prerendering ${concrete} (${entry.route}) did not fail the check`);
    }
  }

  // The matcher itself, since everything above rests on it.
  if (!routeMatcher("/library/[artifactId]").test("/library/abc")) {
    failures.push("a dynamic segment did not match a concrete path");
  }
  if (routeMatcher("/library/[artifactId]").test("/library/abc/def")) {
    failures.push("a single dynamic segment matched two path segments");
  }
  if (!routeMatcher("/repository/folders/[[...path]]").test("/repository/folders")) {
    failures.push("an optional catch-all did not match its empty case");
  }
  if (routeMatcher("/account").test("/accountant")) {
    failures.push("a static route matched a longer path");
  }

  if (guardedOutsideThisCheck.length === 0) {
    failures.push(
      "expected the [locale] pages to trace as personalized-but-required; none did, " +
        "which means the tracer stopped seeing PublicSite",
    );
  }

  // The shared containment rule, folded into the self-test this script already
  // runs in CI. Kept here rather than in a test file of its own because nothing
  // in this repo discovers `scripts/*.mjs` tests — a self-test that no step
  // invokes is the mechanism nobody armed.
  failures.push(...insideRepoSelfTest(REPO_ROOT));

  return failures;
}

function main(argv) {
  if (argv.includes("--self-test")) {
    const failures = selfTest();
    if (failures.length > 0) {
      console.error("static-route checker is broken:");
      for (const line of failures) console.error(`  - ${line}`);
      process.exit(1);
    }
    const traced = partitionPersonalized(personalizedRoutes(WEB_DIR).routes);
    console.log(
      `static-route checker self-test passed ` +
        `(${REQUIRED_STATIC_ROUTES.length} must prerender, ` +
        `${traced.forbidden.length} must not, ` +
        `${traced.guardedOutsideThisCheck.length} conditional, not enforced)`,
    );
    return;
  }

  const distIndex = argv.indexOf("--dist");
  if (distIndex === -1 || !argv[distIndex + 1]) {
    console.error("usage: check-static-routes.mjs --dist <next-build-dir> | --self-test");
    process.exit(1);
  }

  // See scripts/lib/inside-repo.mjs. The flag was checked for presence only; a
  // present value is not a contained one.
  const contained = resolveInsideRepo(REPO_ROOT, argv[distIndex + 1]);
  if (contained.error) {
    console.error(`--dist ${contained.error}`);
    process.exit(1);
  }
  const manifest = readManifest(contained.path);
  const missing = missingRoutes(manifest);
  if (missing.length > 0) {
    console.error(`${missing.length} route(s) that must be prerendered are being server-rendered on demand:`);
    for (const entry of missing) console.error(`  ${entry.route}  — ${entry.why}`);
    console.error("");
    console.error("The usual cause is NOT the page. Check `app/layout.tsx` and");
    console.error("`app/not-found.tsx` for a Dynamic API — `cookies()`, `headers()`, or");
    console.error("anything reaching one, including `getPublicLocale()`, `getMajoranaAuth()`");
    console.error("and `getMajoranaSignInUrl()`. Either one makes every route in the app");
    console.error("dynamic, and the page you are looking at will be innocent.");
    process.exit(1);
  }

  // The other direction. Not a live vulnerability today and the message says so:
  // every route below reaches `headers()` through `getMajoranaAuth()`, and Next
  // makes such a page dynamic on its own, so this cannot currently fire. It is
  // here as defence against a future change that removes that coupling — a
  // cached auth read, a refactor that hoists the call, or a move off Next's
  // rendering model — because at that point the symptom is one reader being
  // served another reader's page, and nothing else in CI would notice.
  const traced = personalizedRoutes(WEB_DIR);
  if (traced.unresolved.length > 0) {
    console.error(`import tracing left ${traced.unresolved.length} unresolved specifier(s):`);
    for (const line of traced.unresolved.slice(0, 10)) console.error(`  ${line}`);
    console.error("The personalized-route set is incomplete, so this check cannot be believed.");
    process.exit(1);
  }
  const { forbidden, guardedOutsideThisCheck } = partitionPersonalized(traced.routes);
  const leaked = forbiddenPrerendered(manifest, forbidden);
  if (leaked.length > 0) {
    console.error(`${leaked.length} route(s) that read per-visitor state were PRERENDERED:`);
    for (const entry of leaked) {
      console.error(`  ${entry.prerenderedAs}  (${entry.route}) — ${entry.why}`);
    }
    console.error("");
    console.error("A prerendered response is served from the CDN to every reader, so this");
    console.error("would hand one visitor a page rendered for another. Either the route must");
    console.error("stay dynamic, or the per-visitor read must leave its render path.");
    process.exit(1);
  }
  console.log(
    `all ${REQUIRED_STATIC_ROUTES.length} required routes are prerendered; ` +
      `none of the ${forbidden.length} personalized routes is ` +
      `(${guardedOutsideThisCheck.length} required-static route(s) reach a per-visitor call behind a condition this check cannot read)`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
