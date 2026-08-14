#!/usr/bin/env node
/**
 * Every `apps/web/lib/*.test.ts` is in the `test` script. Nothing else says so.
 *
 * The web app has no test runner config: `pnpm --filter @majorana/web test` is a single
 * `node --test` invocation with fifty file paths written out by hand. A test
 * file that is not on that line is not a failing test — it is a file nobody
 * runs, and it stays green forever because it never executes. There is no
 * symptom to notice.
 *
 * Found on 2026-08-01 by writing `lib/project-shares.test.ts` and watching
 * `pnpm test` pass without it. The list happened to be complete at that moment,
 * so this gate starts life with nothing to report — which is the point of
 * adding it before the first real omission rather than after.
 *
 * The reverse direction is checked too: a path left on the line after its file
 * is deleted makes `node --test` exit non-zero with a message about a missing
 * file, which reads like a broken test rather than a stale list.
 *
 * Usage: node scripts/check-test-list.mjs [--self-test]
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "apps", "web");
const LIB = join(WEB, "lib");

/** Paths named on the `test` script line, as written there. */
export function listedTests(testScript) {
  return new Set(testScript.match(/lib\/[A-Za-z0-9._-]+\.test\.ts/g) ?? []);
}

export function compare(testScript, actualFiles) {
  const listed = listedTests(testScript);
  return {
    unrun: actualFiles.filter((file) => !listed.has(file)).sort(),
    stale: [...listed].filter((file) => !actualFiles.includes(file)).sort(),
  };
}

function selfTest() {
  // A positive control. A checker that reports "clean" is indistinguishable
  // from one that looked at nothing, and this one is a grep over a string.
  const script = "node --test lib/a.test.ts lib/b.test.ts";
  const result = compare(script, ["lib/a.test.ts", "lib/c.test.ts"]);
  const ok =
    result.unrun.length === 1 &&
    result.unrun[0] === "lib/c.test.ts" &&
    result.stale.length === 1 &&
    result.stale[0] === "lib/b.test.ts";
  if (!ok) {
    console.error("check-test-list: SELF-TEST FAILED", JSON.stringify(result));
    process.exit(1);
  }
  console.log("check-test-list: self-test ok (detects both an unrun file and a stale entry)");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

if (!existsSync(LIB)) {
  console.error(`check-test-list: ${LIB} not found — run from the repo root`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(WEB, "package.json"), "utf8"));
const testScript = pkg.scripts?.test ?? "";
const actual = readdirSync(LIB)
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => `lib/${file}`);

if (actual.length === 0) {
  console.error("check-test-list: found no lib/*.test.ts at all — that cannot be right");
  process.exit(1);
}

const { unrun, stale } = compare(testScript, actual);

if (unrun.length || stale.length) {
  for (const file of unrun) {
    console.error(`check-test-list: ${file} exists but is not in apps/web's "test" script`);
  }
  for (const file of stale) {
    console.error(`check-test-list: "test" script names ${file}, which does not exist`);
  }
  console.error("Fix apps/web/package.json's `test` script.");
  process.exit(1);
}

console.log(`check-test-list: clean (${actual.length} suites, all run)`);
