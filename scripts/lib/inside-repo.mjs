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
 * What it *is*: the same shape leona PR 681 fixed in `check-paper-register.mjs`,
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

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Resolve the real location of `path`, tolerating a path that does not exist yet.
 *
 * `realpathSync` throws on a missing path, and `--state` names a file that is
 * usually absent on the first run — so this walks up to the nearest ancestor
 * that does exist, resolves *that*, and re-appends the segments it climbed over.
 * The point is that the ancestors are where a symlink can hide: a `--state` of
 * `tmp/link/state.json` is contained lexically no matter what `tmp/link` is.
 */
function realpathOfNearestExisting(path) {
  let current = path;
  const climbed = [];
  for (;;) {
    try {
      return join(realpathSync(current), ...climbed);
    } catch {
      const parent = dirname(current);
      // Filesystem root reached without finding anything that exists. Nothing
      // to canonicalise, so hand back what we were given and let the lexical
      // check below be the answer.
      if (parent === current) return path;
      climbed.unshift(basename(current));
      current = parent;
    }
  }
}

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
 *
 * ## Canonical, not merely lexical — a symlink defeats the lexical form
 *
 * The first version of this compared `resolve()`/`relative()` output only, which
 * is string arithmetic: a path *under an in-repo symlink pointing out of the
 * tree* is contained lexically and not contained in fact, and `mkdirSync` and
 * `writeFileSync` follow the link. Raised by a scanner on the PR that added
 * this, and taken rather than argued, because a guard whose own docstring says
 * it confines writes has to actually confine them — the alternative is the
 * shape this repo already knows, a check that reads as protection and is not.
 *
 * That it is hard to *exploit* here is beside the point and is why it stayed
 * Low: the caller is whoever already runs the script. What makes it worth
 * closing is that a CI checkout is not only our own files, and the whole reason
 * this guard exists is the day the argument stops coming from a workflow file
 * we wrote.
 *
 * The root is canonicalised too, or the comparison is between a real path and a
 * symlinked one and every candidate looks external — on macOS `/tmp` is a
 * symlink to `/private/tmp`, which is exactly where a self-test builds its
 * fixtures.
 */
export function resolveInsideRepo(rootDir, candidate, { allowRoot = false } = {}) {
  if (typeof candidate !== "string" || candidate === "") {
    return { error: "path is empty" };
  }
  const root = realpathOfNearestExisting(resolve(rootDir));
  const path = realpathOfNearestExisting(resolve(root, candidate));
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

  failures.push(...symlinkEscapeSelfTest(rootDir));
  return failures;
}

/**
 * Build a real symlink that points out of the tree and check it is refused.
 *
 * Asserted against a link that exists on disk rather than against a string,
 * because the whole failure this covers is the difference between the two — a
 * lexical check passes every string form of this and still writes outside.
 *
 * Both arms: the link itself must be refused, and so must a path *under* it
 * that does not exist yet, which is the `--state` shape. The second is the one
 * a fix can miss, because `realpathSync` throws on a missing leaf and the naive
 * repair is to skip canonicalisation whenever the path is absent — which is
 * every first run.
 */
function symlinkEscapeSelfTest(rootDir) {
  const failures = [];
  let sandbox;
  try {
    sandbox = mkdtempSync(join(tmpdir(), "inside-repo-selftest-"));
  } catch {
    // No writable temp directory. Report rather than skip silently: a self-test
    // that quietly does nothing is the thing this module is trying not to be.
    return ["could not create a temp directory, so the symlink arm did not run"];
  }
  try {
    const outside = join(sandbox, "outside");
    mkdirSync(outside, { recursive: true });
    const link = join(resolve(rootDir), ".inside-repo-selftest-link");
    rmSync(link, { force: true });
    symlinkSync(outside, link);
    try {
      const name = basename(link);
      if (!resolveInsideRepo(rootDir, name).error) {
        failures.push("a symlink pointing outside the repository was accepted");
      }
      // The `--state` shape: a file that does not exist yet, under that link.
      if (!resolveInsideRepo(rootDir, `${name}/state.json`).error) {
        failures.push("a not-yet-existing path UNDER an escaping symlink was accepted");
      }
      // Control: the same shape through a directory that is NOT a link must
      // still be accepted, or the guard has simply started refusing everything.
      if (resolveInsideRepo(rootDir, "scripts/does-not-exist-yet.json").error) {
        failures.push("canonicalisation now refuses an ordinary path that does not exist yet");
      }
    } finally {
      rmSync(link, { force: true });
    }
  } catch (error) {
    failures.push(`the symlink arm could not run: ${error.message}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  return failures;
}
