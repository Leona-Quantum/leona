/**
 * Refuse a path argument that resolves outside the repository.
 *
 * The build scripts each take a directory or file from their own CLI flag —
 * `--dist`, `--state` — and hand it straight to `readFileSync`, `readdirSync`
 * or `writeFileSync`. `resolve(ROOT, value)` looks like it confines the result
 * and does not: a value beginning `../` resolves cleanly to somewhere else, and
 * an absolute value discards `ROOT` entirely.
 *
 * ## This is a tidy pass, not an incident, and the distinction matters
 *
 * The "attacker" here is whoever is already running the script, and none of
 * these is reachable by a visitor — they run in CI and on a developer's laptop
 * against paths the workflow file supplies. Nothing about this is a live
 * exposure, and saying otherwise would be the kind of inflated framing that
 * makes the next real finding easier to ignore.
 *
 * What it *is*: the same shape leona #681 fixed in `check-paper-register.mjs`,
 * left in four other places. The value of closing it is that a check script
 * which writes wherever its argument points is one copy-paste away from being
 * called with an argument someone else controls — a matrix entry, an
 * environment variable, a workflow input — and at that point the guard has to
 * exist already, because nobody adds one while wiring up a matrix.
 *
 * ## Why a shared module rather than a fifth copy
 *
 * `check-paper-register.mjs` grew its own `resolveBundleTarget`, which also does
 * bundle-label validation it alone needs. Copying the containment half into four
 * more files would mean five versions of one rule, and the first one to be fixed
 * without the others becomes the wrong answer that still looks authoritative.
 * That file is deliberately left alone here — it works, it has a self-test, and
 * rewriting a working guard to share code is a worse trade than the duplication.
 */

import { isAbsolute, relative, resolve } from "node:path";

/**
 * Resolve `candidate` against `rootDir` and refuse it if it lands outside.
 *
 * Returns `{ path }` or `{ error }` — never throws and never exits, so a
 * self-test can assert a refusal without taking the process down, and the caller
 * decides what a refusal means for it.
 *
 * `allowRoot` because the two uses differ: `--dist apps/web/.next` is a
 * directory inside the tree and the root itself would be a mistake, while a
 * caller that legitimately means "the repository" should say so explicitly
 * rather than have it fall out of a comparison.
 */
export function resolveInsideRepo(rootDir, candidate, { allowRoot = false } = {}) {
  if (typeof candidate !== "string" || candidate === "") {
    return { error: "path is empty" };
  }
  const root = resolve(rootDir);
  const path = resolve(root, candidate);
  const inside = relative(root, path);
  if (inside === "") {
    return allowRoot ? { path } : { error: `path is the repository root itself: ${candidate}` };
  }
  // `..` as the first segment is the traversal case; `isAbsolute` catches the
  // Windows case where `relative()` across drives returns an absolute path
  // rather than a chain of `..`.
  if (inside.startsWith("..") || isAbsolute(inside)) {
    return { error: `path escapes the repository root: ${candidate}` };
  }
  return { path };
}

/**
 * The refusals every caller should share, plus a proof the fixture still bites.
 *
 * Returned as a list of failure strings rather than asserted, so each script can
 * fold it into the `--self-test` output it already prints.
 *
 * The last check is the one that keeps this honest: an unguarded `resolve()`
 * would happily accept the first fixture, so the test asserts that the fixture
 * really does escape. Without it, a future change that made every input look
 * contained would turn all the refusals above into assertions about nothing.
 */
export function insideRepoSelfTest(rootDir) {
  const failures = [];
  const refuse = (candidate, why, options) => {
    const got = resolveInsideRepo(rootDir, candidate, options);
    if (!got.error) failures.push(`${why}: accepted ${JSON.stringify(candidate)}`);
  };
  const accept = (candidate, why, options) => {
    const got = resolveInsideRepo(rootDir, candidate, options);
    if (got.error) failures.push(`${why}: refused a real call site — ${got.error}`);
  };

  refuse("../../etc/passwd", "parent traversal");
  refuse("apps/../../outside", "traversal after a valid prefix");
  refuse("/etc/passwd", "absolute path");
  refuse("", "empty path");
  refuse(undefined, "missing path");
  refuse(".", "the repository root, without allowRoot");

  accept("apps/web/.next", "a real --dist value");
  accept("scripts", "a plain subdirectory");
  accept(".", "the root when the caller allows it", { allowRoot: true });

  const escaped = resolve(resolve(rootDir), "../../etc/passwd");
  if (!relative(resolve(rootDir), escaped).startsWith("..")) {
    failures.push("the traversal fixture no longer escapes the root, so the refusals prove nothing");
  }
  return failures;
}
