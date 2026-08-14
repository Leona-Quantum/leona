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
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
];

/** Pure, so `--self-test` exercises the same code path CI does. */
export function missingRoutes(manifest, required = REQUIRED_STATIC_ROUTES) {
  const prerendered = new Set(Object.keys(manifest?.routes ?? {}));
  return required.filter((entry) => !prerendered.has(entry.route));
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
    console.log(`static-route checker self-test passed (${REQUIRED_STATIC_ROUTES.length} routes)`);
    return;
  }

  const distIndex = argv.indexOf("--dist");
  if (distIndex === -1 || !argv[distIndex + 1]) {
    console.error("usage: check-static-routes.mjs --dist <next-build-dir> | --self-test");
    process.exit(1);
  }

  const manifest = readManifest(argv[distIndex + 1]);
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
  console.log(`all ${REQUIRED_STATIC_ROUTES.length} required routes are prerendered`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
