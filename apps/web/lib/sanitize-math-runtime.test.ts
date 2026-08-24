import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import test from "node:test";

/**
 * Can the deployed runtime actually LOAD the sanitizer?
 *
 * ## Why a whole test file for one `require`
 *
 * Because "it loads" is the assumption every other test in `sanitize-math.test.ts`
 * rests on, and it is the one that was false in production for eight days while
 * all of them stayed green.
 *
 * `leona 690` wired `sanitizeMathHtml` into the KaTeX render path. Every route
 * that draws mathematics returned 500 on production; `leona 693` withdrew the
 * call to restore service and recorded that it *"did NOT reproduce locally,
 * which is the part worth recording"*, attributing the difference to Vercel
 * tracing files differently from a local `node_modules` tree.
 *
 * That attribution was wrong, and the real cause reproduces locally in one
 * command — which is what this file is.
 *
 * ## The measurement
 *
 * A probe route deployed to a Vercel preview on 2026-08-24 reported its own
 * runtime:
 *
 *     node        v24.18.0
 *     execArgv    [..., "--no-experimental-detect-module",
 *                       "--no-experimental-require-module", ...]
 *     NODE_OPTIONS null
 *
 * **Vercel turns `require(esm)` off explicitly.** So the reasoning in
 * `sanitize-math.ts` — that `engines.node: 24.x` is the honest fix because
 * `require(esm)` arrived in 22.12 — is true of Node and false of the place this
 * code runs. No version bump can reach it, and no local run has the flag unless
 * it is asked for.
 *
 * jsdom 27 and later depend on `@exodus/bytes`, which is ESM-only, and jsdom is
 * itself `"type": "commonjs"` — so jsdom's own `require()` of that package
 * throws `ERR_REQUIRE_ESM` under the flag. `pnpm-workspace.yaml` holds jsdom at
 * 26.1.0 for exactly this reason and says so.
 *
 * ## What this asserts, and what it deliberately does not
 *
 * It asserts the module loads and sanitizes under the flag production uses. It
 * does NOT re-test what the sanitizer keeps or removes — `sanitize-math.test.ts`
 * owns that, and duplicating it here would give two files that fail together and
 * say the same thing.
 *
 * A child process rather than a dynamic import: the flag is a process-level
 * setting, and this suite's own process does not have it. Reproducing the
 * production runtime means running one.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Exercised through `isomorphic-dompurify` rather than through
 * `./sanitize-math.ts`, because the child runs plain node with no TypeScript
 * loader and the failure being guarded lives in the dependency, not in our
 * wrapper around it. `sanitize-math.ts` has one import and this is it — kept
 * true by the assertion below, which fails if that stops being the case.
 */
const PROBE = `
const DOMPurify = require("isomorphic-dompurify");
const out = DOMPurify.sanitize("<span>x</span><script>alert(1)</script>");
process.stdout.write(JSON.stringify({ ok: true, out }));
`;

test("the sanitizer loads under the flag Vercel's Node runtime sets", () => {
  const stdout = execFileSync(
    process.execPath,
    ["--no-experimental-require-module", "-e", PROBE],
    { cwd: HERE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  const result = JSON.parse(stdout) as { ok: boolean; out: string };
  assert.equal(result.ok, true);
  // Loading is the claim; this only confirms the loaded thing is the sanitizer
  // and not some stub that resolved under the same name.
  assert.equal(result.out.includes("<script>"), false);
  assert.equal(result.out.includes("<span>x</span>"), true);
});

test("sanitize-math.ts depends on nothing else that could fail the same way", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./sanitize-math.ts", import.meta.url), "utf8"),
  );
  const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  // If this file grows a second runtime dependency, the probe above stops
  // covering it and this fails rather than quietly narrowing.
  assert.deepEqual(imports, ["isomorphic-dompurify"]);
});
