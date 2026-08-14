import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * A test file nobody runs is worse than no test file.
 *
 * `package.json`'s `test` script names all ~90 suites by hand. A new
 * `lib/*.test.ts` that is not added to that list is never executed, and the
 * failure is invisible in the worst way: the suite passes locally when the
 * author runs it directly, CI reports a green `test` job, and the count of
 * passing tests goes UP because the other suites still run. Nothing anywhere
 * says a file was skipped.
 *
 * The Python side already has this guard —
 * `test_every_live_suite_is_named_by_a_workflow` — and it caught two `*_live.py`
 * suites that had reached disk without ever running. The TypeScript side had
 * none, which was found while adding a test that would itself have gone
 * unwired.
 */
const WEB_DIR = fileURLToPath(new URL("../", import.meta.url));
const LIB_DIR = fileURLToPath(new URL("./", import.meta.url));

test("every lib test file is named in package.json's test script", () => {
  const pkg = JSON.parse(readFileSync(`${WEB_DIR}package.json`, "utf8"));
  const script: string = pkg.scripts?.test ?? "";
  assert.ok(script.length > 0, "package.json has no test script to check against");

  const onDisk = readdirSync(LIB_DIR)
    .filter((name) => name.endsWith(".test.ts"))
    .sort();
  // If this ever reads empty the assertions below are vacuous, so say so.
  assert.ok(onDisk.length > 10, `only found ${onDisk.length} test files; the glob is probably wrong`);

  const unwired = onDisk.filter((name) => !script.includes(`lib/${name}`));
  assert.deepEqual(
    unwired,
    [],
    `these test files exist but are never run:\n  ${unwired.join("\n  ")}\nAdd them to the "test" script in apps/web/package.json.`,
  );
});

test("the test script names no file that has been deleted", () => {
  const pkg = JSON.parse(readFileSync(`${WEB_DIR}package.json`, "utf8"));
  const named = (pkg.scripts?.test ?? "").match(/lib\/[\w.-]+\.test\.ts/g) ?? [];
  const onDisk = new Set(readdirSync(LIB_DIR));
  // A stale name makes `node --test` exit non-zero on every run, which is loud
  // rather than silent — but it is loud in a way that reads as "the tests are
  // broken", and someone will reach for the wrong fix.
  const missing = named.filter((path: string) => !onDisk.has(path.slice("lib/".length)));
  assert.deepEqual(missing, [], `the test script names files that no longer exist:\n  ${missing.join("\n  ")}`);
});
